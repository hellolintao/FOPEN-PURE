// v2.1 batch handlers — batchConfirm + batchSubmit

const { isActiveScoreRow } = require('../active-row')
const { canExposeScoreRows } = require('./query')

const STALE_MESSAGE = '该比分已被其他管理员处理（数据已更新）'
const SCHEDULE_NOT_PUBLISHED = {
  code: 'SCHEDULE_NOT_PUBLISHED',
  message: '赛程发布后才能录入成绩'
}

function isoToTime(iso) {
  if (!iso) return NaN
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : NaN
}

async function runAfterSettlement(ctx, successIds, requestId) {
  if (!ctx || typeof ctx.afterSettlement !== 'function') {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  if (!Array.isArray(successIds) || successIds.length === 0) {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  try {
    return await ctx.afterSettlement({ successIds, requestId })
  } catch (err) {
    return {
      analyticsStatus: 'failed',
      analyticsMessage: '比分已确认，数据分析稍后重算',
      settlementImpact: [],
    }
  }
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
    const inactiveFailure = buildInactiveScoreRowFailure(current, matchId, requestId)
    if (inactiveFailure) {
      failures.push(inactiveFailure)
      mergedResults[matchId] = { state: 'failure', code: inactiveFailure.code, message: inactiveFailure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const scheduleFailure = await buildScheduleFailure(ctx, current, matchId, requestId)
    if (scheduleFailure) {
      failures.push(scheduleFailure)
      mergedResults[matchId] = { state: 'failure', code: scheduleFailure.code, message: scheduleFailure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
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

  const analytics = await runAfterSettlement(ctx, successIds, requestId)
  return { requestId, successIds, failures, ...analytics }
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
    const inactiveFailure = buildInactiveScoreRowFailure(current, matchId, requestId)
    if (inactiveFailure) {
      failures.push(inactiveFailure)
      mergedResults[matchId] = { state: 'failure', code: inactiveFailure.code, message: inactiveFailure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const scheduleFailure = await buildScheduleFailure(ctx, current, matchId, requestId)
    if (scheduleFailure) {
      failures.push(scheduleFailure)
      mergedResults[matchId] = { state: 'failure', code: scheduleFailure.code, message: scheduleFailure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
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
      if (ctx.db.clearMatchFields) {
        await ctx.db.clearMatchFields(matchId, ['score'])
      }
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
    const inactiveFailure = buildInactiveScoreRowFailure(current, matchId, requestId)
    if (inactiveFailure) {
      failures.push(inactiveFailure)
      mergedResults[matchId] = { state: 'failure', code: inactiveFailure.code, message: inactiveFailure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const scheduleFailure = await buildScheduleFailure(ctx, current, matchId, requestId)
    if (scheduleFailure) {
      failures.push(scheduleFailure)
      mergedResults[matchId] = { state: 'failure', code: scheduleFailure.code, message: scheduleFailure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
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

  const analytics = await runAfterSettlement(ctx, successIds, requestId)
  return { requestId, successIds, failures, ...analytics }
}

function scoresDiffer(a, b) {
  const a0 = a && a.sets && a.sets[0]
  const b0 = b && b.sets && b.sets[0]
  if (!a0 || !b0) return true
  return a0.a !== b0.a || a0.b !== b0.b || (a.tiebreak || null) !== (b.tiebreak || null)
}

function buildInactiveScoreRowFailure(match, matchId, requestId) {
  if (!isActiveScoreRow(match)) {
    return { matchId, code: 'INVALID_STATE', message: '成绩记录已失效，请重新打开页面', retryable: false, requestId }
  }
  return null
}

async function buildScheduleFailure(ctx, match, matchId, requestId) {
  if (!match || !match.tournamentId || !ctx.db || typeof ctx.db.getTournament !== 'function') return null
  const tournament = await ctx.db.getTournament(match.tournamentId)
  if (!isScheduleBlocked(tournament)) return null
  return {
    matchId,
    code: SCHEDULE_NOT_PUBLISHED.code,
    message: SCHEDULE_NOT_PUBLISHED.message,
    retryable: false,
    requestId
  }
}

async function applyScheduleImpact(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const { tournamentId, mode, matches, queues, dryRun } = payload || {}
  if (!tournamentId || !['keep_time_only', 'invalidate_scores'].includes(mode) || !Array.isArray(matches) || !Array.isArray(queues)) {
    const err = new Error('INVALID_PAYLOAD')
    err.code = 'INVALID_PAYLOAD'
    throw err
  }
  if (!ctx.db || typeof ctx.db.listMatchesByTournament !== 'function') {
    const err = new Error('INVALID_CONTEXT')
    err.code = 'INVALID_CONTEXT'
    throw err
  }

  const rows = await ctx.db.listMatchesByTournament(tournamentId)
  const confirmedRows = (rows || []).filter(row => isActiveScoreRow(row) && row.resultStatus === 'confirmed')
  const nextByMatchId = buildProposedMatchMap(matches, queues)
  const affected = confirmedRows
    .map(row => ({ row, impact: classifyScheduleImpact(row, nextByMatchId) }))
    .filter(item => item.impact.resultChanged || item.impact.slotChanged)

  const resultAffected = affected.filter(item => item.impact.resultChanged)
  const slotOnlyAffected = affected.filter(item => item.impact.slotChanged && !item.impact.resultChanged)
  if (resultAffected.length > 0 && mode !== 'invalidate_scores') {
    const err = new Error('赛程变更影响已确认成绩，请选择清空比分并重新录入')
    err.code = 'SCHEDULE_IMPACT_REQUIRES_INVALIDATION'
    throw err
  }

  if (dryRun) {
    return {
      affectedCount: affected.length,
      invalidatedIds: [],
      requiresInvalidation: resultAffected.length > 0
    }
  }

  const now = ctx.nowDate || ctx.confirmedAtNow || new Date()
  const invalidatedIds = resultAffected.map(item => item.row._id).filter(Boolean)
  for (const item of resultAffected) {
    const row = item.row
    if (!row || !row._id) continue
    if (typeof ctx.db.archiveMatchResult === 'function') {
      await ctx.db.archiveMatchResult(buildHistoryResult(row, now, ctx.callerMemberId))
    }
    if (item.impact.resultChanged && typeof ctx.db.clearDownstream === 'function') {
      await ctx.db.clearDownstream(tournamentId, row)
    }
    await ctx.db.updateMatch(row._id, buildPendingResetPatch(now))
  }
  for (const item of slotOnlyAffected) {
    const row = item.row
    if (!row || !row._id) continue
    const patch = buildSafeSchedulePatch(item.impact.next, now)
    await ctx.db.updateMatch(row._id, patch)
  }
  if (invalidatedIds.length > 0 && typeof ctx.db.removeTournamentPoints === 'function') {
    await ctx.db.removeTournamentPoints(tournamentId)
  }
  if (invalidatedIds.length > 0 && typeof ctx.db.markTournamentOngoing === 'function') {
    await ctx.db.markTournamentOngoing(tournamentId, { status: 'ongoing', completedAt: null, updateTime: now })
  }

  return {
    affectedCount: affected.length,
    invalidatedIds,
    requiresInvalidation: resultAffected.length > 0
  }
}

function buildHistoryResult(row, now, invalidatedBy) {
  const archiveId = buildHistoryId(row, now)
  return {
    ...row,
    _id: archiveId,
    matchKind: 'history',
    archivedFrom: row._id,
    resultStatus: 'invalidated',
    invalidatedAt: now,
    invalidatedBy,
    updateTime: now
  }
}

function buildHistoryId(row, now) {
  const stamp = now instanceof Date ? now.toISOString() : String(now || Date.now())
  return `history_${row._id}_${stamp.replace(/[^0-9A-Za-z]/g, '')}`
}

function buildPendingResetPatch(now) {
  return {
    score: null,
    scoreDetail: null,
    resultStatus: 'pending',
    status: 'pending',
    winner: null,
    winnerId: null,
    loserId: null,
    pointsAwarded: null,
    confirmedBy: null,
    confirmedAt: null,
    submittedBy: null,
    submittedAt: null,
    updateTime: now
  }
}

function buildSafeSchedulePatch(next, now) {
  const patch = { updateTime: now }
  if (next && Object.prototype.hasOwnProperty.call(next, 'courtId')) patch.courtId = next.courtId
  if (next && Object.prototype.hasOwnProperty.call(next, 'queueOrder')) patch.queueOrder = next.queueOrder
  if (next && Object.prototype.hasOwnProperty.call(next, 'scheduledStart')) patch.scheduledStart = next.scheduledStart
  if (next && Object.prototype.hasOwnProperty.call(next, 'courtName')) patch.courtName = next.courtName
  return patch
}

function buildProposedMatchMap(matches, queues) {
  const queueMap = new Map()
  for (const q of queues || []) {
    for (const item of (q && q.items) || []) {
      const matchId = item && (item.matchId || item.sourceMatchId)
      if (!matchId || item.kind === 'freePlay') continue
      queueMap.set(matchId, {
        courtId: q.courtId || item.courtId || '',
        queueOrder: Object.prototype.hasOwnProperty.call(item, 'order') ? item.order : null,
        scheduledStart: Object.prototype.hasOwnProperty.call(item, 'scheduledStart') ? item.scheduledStart : undefined,
        courtName: q.courtName || item.courtName || undefined
      })
    }
  }
  const out = new Map()
  for (const match of matches || []) {
    const matchId = match && (match.matchId || match.sourceMatchId)
    if (!matchId) continue
    const queue = queueMap.get(matchId) || {}
    out.set(matchId, {
      matchId,
      player1: match.player1 || null,
      player2: match.player2 || null,
      courtId: Object.prototype.hasOwnProperty.call(queue, 'courtId') ? queue.courtId : (match.courtId || ''),
      queueOrder: Object.prototype.hasOwnProperty.call(queue, 'queueOrder')
        ? queue.queueOrder
        : (Object.prototype.hasOwnProperty.call(match, 'queueOrder') ? match.queueOrder : null),
      scheduledStart: Object.prototype.hasOwnProperty.call(queue, 'scheduledStart') && queue.scheduledStart !== undefined
        ? queue.scheduledStart
        : match.scheduledStart,
      courtName: Object.prototype.hasOwnProperty.call(queue, 'courtName') && queue.courtName !== undefined
        ? queue.courtName
        : match.courtName
    })
  }
  return out
}

function classifyScheduleImpact(row, nextByMatchId) {
  const sourceMatchId = row.sourceMatchId || row.matchId || row._id
  const next = sourceMatchId ? nextByMatchId.get(sourceMatchId) : null
  if (!next) return { resultChanged: true, slotChanged: true }
  return {
    resultChanged: playerKey(row.player1) !== playerKey(next.player1) ||
      playerKey(row.player2) !== playerKey(next.player2),
    slotChanged: (row.courtId || '') !== (next.courtId || '') ||
      normalizeOrder(row.queueOrder) !== normalizeOrder(next.queueOrder),
    next
  }
}

function playerKey(player) {
  if (!player) return ''
  return [
    player.id || '',
    player.partnerId || '',
    player.name || '',
    player.partnerName || ''
  ].join(':')
}

function normalizeOrder(value) {
  return value === undefined ? null : value
}

function isScheduleBlocked(tournament) {
  return !!(tournament && !canExposeScoreRows(tournament))
}

module.exports = { batchConfirm, batchSubmit, batchAdminSave, applyScheduleImpact }
