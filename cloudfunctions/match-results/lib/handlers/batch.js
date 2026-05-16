// v2.1 batch handlers — batchConfirm + batchSubmit

const STALE_MESSAGE = '该比分已被其他管理员处理（数据已更新）'

function isoToTime(iso) {
  if (!iso) return NaN
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : NaN
}

async function batchConfirm(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const { matches, requestId } = payload || {}
  if (!Array.isArray(matches) || matches.length === 0 || !requestId) {
    const err = new Error('INVALID_PAYLOAD')
    err.code = 'INVALID_PAYLOAD'
    throw err
  }
  for (const m of matches) {
    if (!m || !m.matchId || !m.expectedUpdateTime) {
      const err = new Error('INVALID_PAYLOAD')
      err.code = 'INVALID_PAYLOAD'
      throw err
    }
  }

  const now = ctx.confirmedAtNow || new Date()
  const existingLog = await ctx.db.getRequestLog(requestId)
  const baseResults = (existingLog && existingLog.results) || {}
  const mergedResults = { ...baseResults }

  const successIds = []
  const failures = []

  for (const item of matches) {
    const { matchId, expectedUpdateTime } = item
    const prior = mergedResults[matchId]
    if (prior && prior.state === 'success') {
      successIds.push(matchId)
      continue
    }
    const current = await ctx.db.getMatch(matchId)
    if (!current) {
      const failure = { matchId, code: 'INVALID_STATE', message: '比赛不存在', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    if (current.resultStatus !== 'submitted') {
      const failure = { matchId, code: 'INVALID_STATE', message: '状态不是 submitted', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const expected = isoToTime(expectedUpdateTime)
    const actual = current.updateTime instanceof Date ? current.updateTime.getTime() : isoToTime(current.updateTime)
    if (!Number.isFinite(expected) || expected !== actual) {
      const failure = { matchId, code: 'STALE_VERSION', message: STALE_MESSAGE, retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'STALE_VERSION', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    try {
      await ctx.confirmOne(current)
      successIds.push(matchId)
      mergedResults[matchId] = { state: 'success', confirmedAt: now, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    } catch (e) {
      const code = e.code || 'DB_CONFLICT'
      const retryable = ['CLOUD_TIMEOUT', 'DB_CONFLICT'].includes(code)
      const failure = { matchId, code, message: e.message || code, retryable, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code, message: failure.message, retryable, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    }
  }

  await ctx.db.upsertRequestLog(requestId, {
    _id: requestId,
    action: 'batchConfirm',
    callerOpenid: ctx.callerOpenid,
    callerMemberId: ctx.callerMemberId,
    firstSeenAt: existingLog ? existingLog.firstSeenAt : now,
    lastSeenAt: now,
    results: mergedResults,
    closedAt: existingLog ? existingLog.closedAt : null,
  })

  return { requestId, successIds, failures }
}

async function batchSubmit(ctx, payload) {
  const { submissions, requestId } = payload || {}
  if (!Array.isArray(submissions) || submissions.length === 0 || !requestId) {
    const err = new Error('INVALID_PAYLOAD')
    err.code = 'INVALID_PAYLOAD'
    throw err
  }
  for (const s of submissions) {
    if (!s || !s.matchId || !s.score) {
      const err = new Error('INVALID_PAYLOAD')
      err.code = 'INVALID_PAYLOAD'
      throw err
    }
  }

  const now = ctx.nowDate || new Date()
  const existingLog = await ctx.db.getRequestLog(requestId)
  const baseResults = (existingLog && existingLog.results) || {}
  const mergedResults = { ...baseResults }
  const successIds = []
  const failures = []

  for (const item of submissions) {
    const { matchId, score } = item
    const prior = mergedResults[matchId]
    if (prior && prior.state === 'success') {
      successIds.push(matchId)
      continue
    }
    const current = await ctx.db.getMatch(matchId)
    if (!current) {
      const failure = { matchId, code: 'INVALID_STATE', message: '比赛不存在', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const playerIds = current.playerIds || []
    if (!playerIds.includes(ctx.callerMemberId)) {
      const failure = { matchId, code: 'FORBIDDEN', message: '非参赛方', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'FORBIDDEN', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    if (current.resultStatus === 'confirmed') {
      const failure = { matchId, code: 'CANNOT_OVERWRITE_CONFIRMED', message: '已确认比分不能再修改', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'CANNOT_OVERWRITE_CONFIRMED', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const sets0 = score.sets && score.sets[0]
    const validation = ctx.validateScore(sets0 ? sets0.a : null, sets0 ? sets0.b : null, score.tiebreak || null)
    if (!validation || !validation.valid) {
      const failure = { matchId, code: 'INVALID_SCORE', message: validation && validation.error || 'INVALID_SCORE', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_SCORE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    try {
      await ctx.db.updateMatch(matchId, { resultStatus: 'submitted', score, submittedBy: ctx.callerMemberId, submittedAt: now, updateTime: now })
      successIds.push(matchId)
      mergedResults[matchId] = { state: 'success', confirmedAt: now, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    } catch (e) {
      const failure = { matchId, code: 'DB_CONFLICT', message: e.message || 'DB_CONFLICT', retryable: true, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'DB_CONFLICT', message: failure.message, retryable: true, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    }
  }

  await ctx.db.upsertRequestLog(requestId, {
    _id: requestId,
    action: 'batchSubmit',
    callerOpenid: ctx.callerOpenid,
    callerMemberId: ctx.callerMemberId,
    firstSeenAt: existingLog ? existingLog.firstSeenAt : now,
    lastSeenAt: now,
    results: mergedResults,
    closedAt: existingLog ? existingLog.closedAt : null,
  })

  return { requestId, successIds, failures }
}

async function batchAdminSave(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const { matches, requestId } = payload || {}
  if (!Array.isArray(matches) || matches.length === 0 || !requestId) {
    const err = new Error('INVALID_PAYLOAD')
    err.code = 'INVALID_PAYLOAD'
    throw err
  }
  for (const m of matches) {
    if (!m || !m.matchId || !m.score) {
      const err = new Error('INVALID_PAYLOAD')
      err.code = 'INVALID_PAYLOAD'
      throw err
    }
  }

  const now = ctx.confirmedAtNow || new Date()
  const existingLog = await ctx.db.getRequestLog(requestId)
  const baseResults = (existingLog && existingLog.results) || {}
  const mergedResults = { ...baseResults }

  const successIds = []
  const failures = []

  for (const item of matches) {
    const { matchId, score } = item
    const prior = mergedResults[matchId]
    if (prior && prior.state === 'success') {
      successIds.push(matchId)
      continue
    }

    const current = await ctx.db.getMatch(matchId)
    if (!current) {
      const failure = { matchId, code: 'INVALID_STATE', message: '比赛不存在', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    if (current.resultStatus === 'confirmed' && !scoresDiffer(current.score, score)) {
      const failure = { matchId, code: 'INVALID_STATE', message: '比分未变更', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }

    const sets0 = score.sets && score.sets[0]
    const validation = ctx.validateScore(sets0 ? sets0.a : null, sets0 ? sets0.b : null, score.tiebreak || null)
    if (!validation || !validation.valid) {
      const failure = { matchId, code: 'INVALID_SCORE', message: validation && validation.error || 'INVALID_SCORE', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_SCORE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }

    try {
      await ctx.confirmOne(current, score)
      successIds.push(matchId)
      mergedResults[matchId] = { state: 'success', confirmedAt: now, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    } catch (e) {
      const code = e.code || e.message || 'DB_CONFLICT'
      const retryable = ['CLOUD_TIMEOUT', 'DB_CONFLICT'].includes(code)
      const failure = { matchId, code, message: e.message || code, retryable, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code, message: failure.message, retryable, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    }
  }

  await ctx.db.upsertRequestLog(requestId, {
    _id: requestId,
    action: 'batchAdminSave',
    callerOpenid: ctx.callerOpenid,
    callerMemberId: ctx.callerMemberId,
    firstSeenAt: existingLog ? existingLog.firstSeenAt : now,
    lastSeenAt: now,
    results: mergedResults,
    closedAt: existingLog ? existingLog.closedAt : null,
  })

  return { requestId, successIds, failures }
}

function scoresDiffer(a, b) {
  const a0 = a && a.sets && a.sets[0]
  const b0 = b && b.sets && b.sets[0]
  if (!a0 || !b0) return true
  return a0.a !== b0.a || a0.b !== b0.b || (a.tiebreak || null) !== (b.tiebreak || null)
}

module.exports = { batchConfirm, batchSubmit, batchAdminSave }
