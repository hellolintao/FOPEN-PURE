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
  throw new Error('NOT_IMPLEMENTED')
}

module.exports = { batchConfirm, batchSubmit }
