// 云函数入口文件
const cloud = require('wx-server-sdk')
const { validateResultSubmission } = require('./lib/validate')
const { canExposeScoreRows } = require('./lib/handlers/query')
const { isActiveScoreRow } = require('./lib/active-row')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('match_results')

const { createMatchStateService } = require('./lib/state')
const awardLib = require('./lib/award')
const scoreRule = require('./lib/score-rule')
const stateSvc = createMatchStateService({ db, awardLib, scoreRule })
const VOID_MARKERS_COLLECTION = 'match_result_voids'

function resolveMatchType(match, tournamentOrType) {
  const fallback = typeof tournamentOrType === 'string'
    ? tournamentOrType
    : (tournamentOrType && tournamentOrType.type)
  return (match && (match.type || match.tournamentType)) || fallback || 'singles'
}

// 收集选手 ID（兼容 singles/doubles，跳过 BYE）
function collectPlayerIds(m, tournamentOrType) {
  const type = resolveMatchType(m, tournamentOrType)
  const ids = []
  const push = obj => {
    if (obj && obj.id && obj.id !== 'BYE') {
      ids.push(obj.id)
      if (type === 'doubles' && obj.partnerId) ids.push(obj.partnerId)
    }
  }
  push(m.player1)
  push(m.player2)
  return ids
}

// 生成比赛ID
function generateMatchId(tournamentId, round, matchIndex) {
  return `match_${tournamentId.split('_')[1]}_${tournamentId.split('_')[2]}_r${round}_m${matchIndex}`
}

// Phase 8 helpers — resolve current openid → member doc with isAdmin
// Historical member documents use `admin`; Phase 8 state service expects
// `isAdmin`. Keep both accepted so older member rows and newer test fixtures
// resolve to the same role.
async function resolveSubmitter() {
  const wxContext = cloud.getWXContext()
  if (!wxContext || !wxContext.OPENID) return null
  return resolveSubmitterByOpenid(wxContext.OPENID)
}

async function resolveSubmitterByOpenid(openid, database = db, command = _) {
  if (!openid) return null
  const r = await database.collection('members').where(command.or([
    { openid },
    { openId: openid }
  ])).get()
  const m = r.data[0]
  if (!m) return null
  return {
    _id: m._id,
    openid: m.openid || m.openId || openid,
    isAdmin: (typeof m.admin === 'boolean') ? m.admin : !!m.isAdmin
  }
}

function ok(data) { return { success: true, data } }
function fail(code, message) { return { success: false, error: { code, message } } }

const SCHEDULE_NOT_PUBLISHED_MESSAGE = '赛程发布后才能录入成绩'

async function guardDirectScoreRowRead(row) {
  if (!row || !row.tournamentId) return null
  if (!isActiveScoreRow(row)) return fail('NOT_FOUND', '比赛不存在')
  const tournamentRes = await db.collection('tournaments').doc(row.tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (canExposeScoreRows(tournament)) return null
  const submitter = await resolveSubmitter()
  if (submitter && submitter.isAdmin) return null
  return fail('FORBIDDEN', '赛程发布后才能录入成绩')
}

async function guardDirectScoreWriteByTournamentId(tournamentId) {
  if (!tournamentId) return null
  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (!isScheduleWriteBlocked(tournament)) return null
  return fail('SCHEDULE_NOT_PUBLISHED', SCHEDULE_NOT_PUBLISHED_MESSAGE)
}

async function guardDirectScoreWriteForRow(row, fallbackTournamentId) {
  if (row && !isActiveScoreRow(row)) return fail('INVALID_STATE', '成绩记录已失效，请重新打开页面')
  return guardDirectScoreWriteByTournamentId((row && row.tournamentId) || fallbackTournamentId)
}

async function requireAdmin() {
  const submitter = await resolveSubmitter()
  if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
  if (!submitter.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
  return null
}

async function guardScoreRowsReadByTournamentId(tournamentId) {
  if (!tournamentId) return null
  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (canExposeScoreRows(tournament)) return null
  const submitter = await resolveSubmitter()
  if (submitter && submitter.isAdmin) return null
  return fail('FORBIDDEN', SCHEDULE_NOT_PUBLISHED_MESSAGE)
}

async function filterScoreRowsVisibleToSubmitter(result) {
  const activeResult = filterActiveScoreRowsResult(result)
  const rows = activeResult && activeResult.data
  if (!Array.isArray(rows) || rows.length === 0) return activeResult

  const submitter = await resolveSubmitter()
  if (submitter && submitter.isAdmin) return activeResult

  const tournamentCache = new Map()
  const visibleRows = []
  for (const row of rows) {
    if (!row || !row.tournamentId) {
      visibleRows.push(row)
      continue
    }
    if (!tournamentCache.has(row.tournamentId)) {
      const tournamentRes = await db.collection('tournaments').doc(row.tournamentId).get().catch(() => null)
      tournamentCache.set(row.tournamentId, tournamentRes && tournamentRes.data)
    }
    if (canExposeScoreRows(tournamentCache.get(row.tournamentId))) {
      visibleRows.push(row)
    }
  }
  return { ...activeResult, data: visibleRows }
}

function isScheduleWriteBlocked(tournament) {
  return !!(tournament && !canExposeScoreRows(tournament))
}

function filterActiveScoreRowsResult(result) {
  if (!result || !Array.isArray(result.data)) return result
  return { ...result, data: result.data.filter(isActiveScoreRow) }
}

// 数据验证函数
function validateMatchResult(data) {
  const errors = []

  // 必填字段验证
  if (!data.tournamentId || data.tournamentId.trim() === '') {
    errors.push('赛事ID不能为空')
  }
  if (!data.round || data.round < 1) {
    errors.push('轮次必须大于等于1')
  }
  if (!data.type || !['singles', 'doubles'].includes(data.type)) {
    errors.push('比赛类型必须是 singles 或 doubles')
  }
  if (!data.players || !Array.isArray(data.players) || data.players.length !== 2) {
    errors.push('选手数据必须且只能是2人')
  }
  if (!data.status || !['pending', 'ongoing', 'completed', 'cancelled'].includes(data.status)) {
    errors.push('比赛状态必须是 pending、ongoing、completed 或 cancelled')
  }

  // 选手数据验证
  if (data.players && data.players.length === 2) {
    data.players.forEach((player, index) => {
      if (!player.id || player.id.trim() === '') {
        errors.push(`第${index + 1}位选手ID不能为空`)
      }
      if (!player.name || player.name.trim() === '') {
        errors.push(`第${index + 1}位选手姓名不能为空`)
      }
    })
  }

  // 比分数据验证
  if (data.status === 'completed') {
    if (!data.winnerId || data.winnerId.trim() === '') {
      errors.push('比赛完成时必须指定获胜者')
    }
    if (!data.loserId || data.loserId.trim() === '') {
      errors.push('比赛完成时必须指定失败者')
    }
    if (!data.score || data.score.trim() === '') {
      errors.push('比赛完成时必须填写比分')
    }
  }

  return errors
}

// Phase 7 Task 9 – bulk upsert scheduled match_results (R1 payload + R2+ skeletons)
async function handleBulkUpsert({ tournamentId, matches, queues }) {
  try {
    if (!tournamentId) {
      return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
    }
    if (!Array.isArray(matches)) {
      return { success: false, error: { code: 'INVALID_ARG', message: 'matches 必须是数组' } }
    }

    const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
    const tournament = tournamentRes && tournamentRes.data
    if (!tournament) {
      return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }
    }

    // Build queueMap: matchId → { courtId, queueOrder }
    const queueMap = new Map()
    for (const q of (queues || [])) {
      if (!Array.isArray(q.items)) continue
      for (const item of q.items) {
        if (item.kind === 'match') {
          queueMap.set(item.matchId, { courtId: q.courtId, queueOrder: item.order })
        }
      }
    }

    const seen = new Set()
    const now = db.serverDate()
    const prefix = tournamentId.replace('tournament_', '')

    // 1. Upsert R1 payload matches
    for (const m of matches) {
      const docId = `result_${prefix}_${m.matchId}`
      seen.add(docId)
      const isBye = m.bye === true
      const q = queueMap.get(m.matchId)
      const matchType = resolveMatchType(m, tournament)
      const playerIds = collectPlayerIds(m, matchType)

      const doc = {
        _id: docId,
        tournamentId,
        seasonId: tournament.seasonId,
        tournamentType: matchType,
        format: tournament.format || '',
        stage: m.stage || (m.matchKind === 'group' ? 'group' : ''),
        groupCode: m.groupCode || '',
        groupSlot1: m.groupSlot1 || null,
        groupSlot2: m.groupSlot2 || null,
        matchKind: m.matchKind || 'bracket',
        sourceMatchId: m.matchId,
        round: m.round,
        position: m.position,
        player1: m.player1,
        player2: m.player2,
        playerIds,
        courtId: isBye ? null : (q ? q.courtId : null),
        queueOrder: isBye ? null : (q ? q.queueOrder : null),
        score: null,
        resultStatus: isBye ? 'confirmed' : 'pending',
        winner: isBye ? m.winner : null,
        winnerId: isBye && m.winner ? m.winner.id : null,
        loserId: null,
        confirmedBy: null,
        confirmedAt: null,
        pointsAwarded: isBye ? { source: 'match', entries: [] } : null,
        updateTime: now
      }

      const existingRes = await collection.doc(docId).get().catch(() => null)
      const existing = existingRes && existingRes.data
      if (existing) {
        await collection.doc(docId).update({
          data: mergeScheduledMatchDoc(existing, doc)
        })
      } else {
        await collection.add({ data: { ...doc, createTime: now } })
      }
    }

    // 2. Pre-create R2+ skeleton match_results from tournament_brackets
    const skeletonRes = await db.collection('tournament_brackets')
      .where(tournament.format === 'group_knockout'
        ? { tournamentId, stage: 'knockout', round: _.gt(1) }
        : { tournamentId, round: _.gt(1) })
      .get()
      .catch(() => ({ data: [] }))
    for (const bracket of (skeletonRes.data || [])) {
      for (const m of (bracket.matches || [])) {
        const docId = `result_${prefix}_${m.matchId}`
        if (seen.has(docId)) continue
        seen.add(docId)
        const matchType = resolveMatchType(m, tournament)
        const playerIds = collectPlayerIds(m, matchType)
        const doc = {
          _id: docId,
          tournamentId,
          seasonId: tournament.seasonId,
          tournamentType: matchType,
          format: tournament.format || '',
          stage: m.stage || bracket.stage || '',
          groupCode: m.groupCode || bracket.groupCode || '',
          groupSlot1: m.groupSlot1 || null,
          groupSlot2: m.groupSlot2 || null,
          matchKind: 'bracket',
          sourceMatchId: m.matchId,
          round: m.round,
          position: m.position,
          player1: m.player1 || null,
          player2: m.player2 || null,
          playerIds,
          courtId: null,
          queueOrder: null,
          score: null,
          resultStatus: 'pending',
          winner: m.winner || null,
          winnerId: m.winner ? m.winner.id : null,
          loserId: null,
          confirmedBy: null,
          confirmedAt: null,
          pointsAwarded: null,
          updateTime: now
        }
        const existingRes = await collection.doc(docId).get().catch(() => null)
        const existing = existingRes && existingRes.data
        if (existing) {
          await collection.doc(docId).update({ data: mergeScheduledMatchDoc(existing, doc) })
        } else {
          await collection.add({ data: { ...doc, createTime: now } })
        }
      }
    }

    // 3. Delete orphan rows (this tournament, bracket/regularRound/extra kinds, not in seen)
    const orphanRes = await collection.where({
      tournamentId,
      matchKind: _.in(['bracket', 'regularRound', 'extra', 'group'])
    }).get().catch(() => ({ data: [] }))
    for (const doc of (orphanRes.data || [])) {
      if (canRemoveOrphanMatchDoc(doc, seen)) {
        await collection.doc(doc._id).remove().catch(() => null)
      }
    }

    return { success: true, data: { count: seen.size } }
  } catch (e) {
    console.error('[match-results.bulkUpsertScheduledMatches] error', e)
    return { success: false, error: { code: e.code || 'INTERNAL', message: e.message } }
  }
}

function mergeScheduledMatchDoc(existing, scheduled) {
  const merged = { ...scheduled, createTime: existing && existing.createTime }
  if (!existing || !isActiveScoreRow(existing)) return merged
  if (!hasPreservableScoreState(existing)) return merged
  if (!hasSameResultIdentity(existing, scheduled)) {
    throw createScheduleImpactInvalidationError()
  }
  return {
    ...merged,
    score: existing.score,
    scoreDetail: existing.scoreDetail,
    resultStatus: existing.resultStatus,
    status: existing.status || merged.status,
    winner: existing.winner,
    winnerId: existing.winnerId,
    loserId: existing.loserId,
    submissions: existing.submissions,
    submittedBy: existing.submittedBy,
    submittedAt: existing.submittedAt,
    confirmedBy: existing.confirmedBy,
    confirmedAt: existing.confirmedAt,
    pointsAwarded: existing.pointsAwarded
  }
}

function shouldRemoveOrphanMatchDoc(doc, seen) {
  if (!doc || !doc._id || seen.has(doc._id)) return false
  if (doc.matchKind === 'history' || doc.archivedFrom || doc.resultStatus === 'invalidated') return false
  return true
}

function canRemoveOrphanMatchDoc(doc, seen) {
  if (!shouldRemoveOrphanMatchDoc(doc, seen)) return false
  if (isActiveScoreRow(doc) && hasPreservableScoreState(doc)) {
    throw createScheduleImpactInvalidationError()
  }
  return true
}

function hasPreservableScoreState(row) {
  return row && ['submitted', 'confirmed'].includes(row.resultStatus)
}

function createScheduleImpactInvalidationError() {
  const err = new Error('赛程变更影响已确认成绩，请先清空比分并重新发布')
  err.code = 'SCHEDULE_IMPACT_REQUIRES_INVALIDATION'
  return err
}

function hasSameResultIdentity(existing, scheduled) {
  return resultIdentityKey(existing) === resultIdentityKey(scheduled)
}

function resultIdentityKey(row) {
  if (!row) return ''
  return [
    row.sourceMatchId || row.matchId || row._id || '',
    playerIdentityKey(row.player1),
    playerIdentityKey(row.player2)
  ].join('|')
}

function playerIdentityKey(player) {
  if (!player) return ''
  return [
    player.id || '',
    player.partnerId || '',
    player.sourceMatchId || player.fromMatchId || '',
    player.name || '',
    player.partnerName || ''
  ].join(':')
}

// Phase 9 v2.1 — ctx builder helpers for new handler routes

function buildBatchCtx(submitter, isAdminFlag) {
  const scoreRule = require('./lib/score-rule')
  return {
    callerOpenid: submitter.openid,
    callerMemberId: submitter._id,
    isAdmin: isAdminFlag,
    confirmedAtNow: new Date(),
    nowDate: new Date(),
    db: {
      getMatch: async (id) => {
        const r = await db.collection('match_results').doc(id).get().catch(() => null)
        return r ? r.data : null
      },
      getTournament: async (tournamentId) => {
        const r = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
        return r ? r.data : null
      },
      listMatchesByTournament: async (tournamentId) => (await collection.where({ tournamentId }).limit(500).get()).data,
      updateMatch: async (id, patch) => {
        await db.collection('match_results').doc(id).update({ data: patch })
      },
      archiveMatchResult: async (doc) => {
        if (typeof db.createCollection === 'function') {
          await db.createCollection('match_result_history').catch(() => null)
        }
        await db.collection('match_result_history').add({ data: doc })
      },
      clearDownstream: async (tournamentId, row) => {
        await stateSvc.clearDownstream(tournamentId, row)
      },
      removeTournamentPoints: async (tournamentId) => {
        await db.collection('tournament_points').where({ tournamentId }).remove().catch(() => null)
      },
      markTournamentOngoing: async (tournamentId, patch) => {
        await db.collection('tournaments').doc(tournamentId).update({ data: patch }).catch(() => null)
      },
      clearMatchFields: async (id, fields) => {
        const data = {}
        for (const field of fields || []) data[field] = _.remove()
        if (Object.keys(data).length === 0) return
        await db.collection('match_results').doc(id).update({ data })
      },
      getRequestLog: async (id) => {
        const r = await db.collection('_request_log').doc(id).get().catch(() => null)
        return r ? r.data : null
      },
      upsertRequestLog: async (id, doc) => {
        const exists = await db.collection('_request_log').doc(id).get().catch(() => null)
        if (exists && exists.data) {
          await db.collection('_request_log').doc(id).update({ data: doc })
        } else {
          await db.collection('_request_log').add({ data: doc })
        }
      },
    },
    confirmOne: async (current, scoreOverride) => {
      const score = scoreOverride || current.score
      const matchId = resolveStateMatchId(current)
      if (current.resultStatus === 'confirmed') {
        return stateSvc.reconfirmMatch({ matchId, newScore: score, admin: submitter })
      }
      return stateSvc.submitResult({ matchId, score, submitter })
    },
    validateScore: scoreRule.validateScore,
  }
}

function resolveStateMatchId(current) {
  return current && (current._id || current.sourceMatchId)
}

function buildQueryCtx(submitter) {
  return {
    isAdmin: submitter && submitter.isAdmin,
    db: {
      queryMatchResults: async ({ resultStatus, tournamentId, limit }) => {
        const where = { resultStatus }
        if (tournamentId) where.tournamentId = tournamentId
        const rows = (await db.collection('match_results').where(where).orderBy('updateTime', 'desc').limit(limit).get()).data
        return excludeVoidMarkedRows(rows)
      },
      countMatchResults: async ({ resultStatus, tournamentId }) => {
        const where = { resultStatus }
        if (tournamentId) where.tournamentId = tournamentId
        const r = await db.collection('match_results').where(where).count()
        return r.total
      },
      getTournamentsByIds: async (ids) => {
        if (!ids.length) return []
        return (await db.collection('tournaments').where({ _id: _.in(ids) }).get()).data
      },
      getTournament: async (tournamentId) => {
        const r = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
        return r ? r.data : null
      },
      getMembersByIds: async (ids) => {
        if (!ids.length) return []
        return (await db.collection('members').where({ _id: _.in(ids) }).get()).data
      },
      pagedFetchSubmitted: async () => excludeVoidMarkedRows(await pagedFetchSubmitted()),
      listByTournament: async (tournamentId) => {
        const rows = (await collection
          .where({ tournamentId })
          .orderBy('round', 'asc')
          .orderBy('position', 'asc')
          .orderBy('createTime', 'asc')
          .limit(500)
          .get()).data
        return applyVoidMarkersToRows(rows)
      },
      listByPlayerNotConfirmed: async (memberId) => {
        const rows = (await collection.where({
          playerIds: _.in([memberId]),
          resultStatus: _.neq('confirmed'),
        }).orderBy('round', 'asc').limit(200).get()).data
        return excludeVoidMarkedRows(rows)
      },
    },
  }
}

async function applyVoidMarkersToRows(rows) {
  const list = rows || []
  if (!list.length) return list
  const markers = await listVoidMarkersForRows(list)
  if (!markers.length) return list
  const byResultId = new Map()
  const bySourceMatchId = new Map()
  for (const marker of markers) {
    if (marker.resultId) byResultId.set(marker.resultId, marker)
    if (marker.sourceMatchId) bySourceMatchId.set(marker.sourceMatchId, marker)
  }
  return list.map(row => {
    const marker = byResultId.get(row._id) || bySourceMatchId.get(row.sourceMatchId || row.matchId)
    if (!marker) return row
    return {
      ...row,
      noScore: true,
      voided: true,
      voidReason: marker.reason || '未完赛',
      voidedBy: marker.markedBy || '',
      voidedAt: marker.markedAt || null
    }
  })
}

async function excludeVoidMarkedRows(rows) {
  const marked = await applyVoidMarkersToRows(rows)
  return marked.filter(row => !(row && row.noScore === true))
}

async function listVoidMarkersForRows(rows) {
  const tournamentIds = [...new Set((rows || []).map(row => row && row.tournamentId).filter(Boolean))]
  if (!tournamentIds.length) return []
  try {
    const where = tournamentIds.length === 1 ? { tournamentId: tournamentIds[0] } : { tournamentId: _.in(tournamentIds) }
    const res = await db.collection(VOID_MARKERS_COLLECTION).where(where).limit(500).get()
    return res.data || []
  } catch (e) {
    if (isCollectionMissing(e)) return []
    throw e
  }
}

function isCollectionMissing(e) {
  const text = `${(e && (e.errMsg || e.message || e.code)) || ''}`
  return (e && e.errCode === -502005) || /collection not exists|Db or Table not exist|not exist/i.test(text)
}

function buildSubmitCtx(submitter) {
  return {
    submitter,
    stateSvc,
  }
}

function buildSummaryCtx(submitter) {
  return {
    callerMemberId: submitter._id,
    db: {
      queryMyPending: async (mid) => (await db.collection('match_results').where({
        playerIds: _.in([mid]),
        resultStatus: 'pending',
      }).orderBy('scheduledStart', 'asc').limit(50).get()).data,
      queryMySubmitted: async (mid) => (await db.collection('match_results').where({
        playerIds: _.in([mid]),
        resultStatus: 'submitted',
      }).orderBy('submittedAt', 'desc').limit(50).get()).data,
      queryMyConfirmed: async (mid, limit) => (await db.collection('match_results').where({
        playerIds: _.in([mid]),
        resultStatus: 'confirmed',
      }).orderBy('confirmedAt', 'desc').limit(limit).get()).data,
      queryMyRegistrations: async (mid) => {
        const [byPlayer, byPartner, byMember, byPlayerIds, byMemberIds] = await Promise.all([
          db.collection('tournament_registrations').where({ playerId: mid }).limit(100).get(),
          db.collection('tournament_registrations').where({ partnerId: mid }).limit(100).get(),
          db.collection('tournament_registrations').where({ memberId: mid }).limit(100).get(),
          db.collection('tournament_registrations').where({ playerIds: _.in([mid]) }).limit(100).get(),
          db.collection('tournament_registrations').where({ memberIds: _.in([mid]) }).limit(100).get(),
        ])
        const rows = [
          ...((byPlayer && byPlayer.data) || []),
          ...((byPartner && byPartner.data) || []),
          ...((byMember && byMember.data) || []),
          ...((byPlayerIds && byPlayerIds.data) || []),
          ...((byMemberIds && byMemberIds.data) || []),
        ]
        const map = new Map()
        rows.forEach((row, index) => {
          const key = row._id || `${row.tournamentId || ''}:${row.playerId || ''}:${row.partnerId || ''}:${index}`
          if (!map.has(key)) map.set(key, row)
        })
        return [...map.values()]
      },
      getTournamentsByIds: async (ids) => {
        if (!ids.length) return []
        return (await db.collection('tournaments').where({ _id: _.in(ids) }).get()).data
      },
    },
  }
}

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, _id, id } = event
  const now = db.serverDate()

  switch (action) {
    case 'add': {
      // 数据验证
      const errors = validateMatchResult(data)
      if (errors.length > 0) {
        return { errMsg: 'validation failed', errors }
      }
      const scheduleGate = await guardDirectScoreWriteByTournamentId(data.tournamentId)
      if (scheduleGate) return scheduleGate

      // 检查是否已存在相同的比赛
      const existingMatch = await collection.where({
        tournamentId: data.tournamentId,
        round: data.round,
        'players.0.id': data.players[0].id,
        'players.1.id': data.players[1].id
      }).get()

      if (existingMatch.data && existingMatch.data.length > 0) {
        return { errMsg: 'match already exists', data: existingMatch.data[0] }
      }

      // 生成比赛ID
      const matchId = data._id || generateMatchId(
        data.tournamentId,
        data.round,
        Date.now().toString().slice(-4)
      )

      // 新增比赛数据
      const addData = {
        _id: matchId,
        tournamentId: data.tournamentId,
        round: data.round,
        type: data.type,
        players: data.players,
        score: data.score || '',
        scoreDetail: data.scoreDetail || null,
        winnerId: data.winnerId || null,
        loserId: data.loserId || null,
        pointsAwarded: data.pointsAwarded || null,
        status: data.status || 'pending',
        resultStatus: data.resultStatus || 'pending',
        submissions: Array.isArray(data.submissions) ? data.submissions : [],
        confirmedAt: data.confirmedAt || null,
        confirmedBy: data.confirmedBy || null,
        disputeReason: data.disputeReason || '',
        matchTime: data.matchTime || null,
        courtId: data.courtId || null,
        scheduledStart: data.scheduledStart || null,
        scheduledSlotId: data.scheduledSlotId || '',
        createTime: now,
        updateTime: now
      }

      return await collection.add({
        data: addData
      })
    }

    case 'get': {
      // 获取单场比赛
      if (!id && !_id) {
        return { errMsg: '_id or id is required' }
      }
      const result = await collection.doc(_id || id).get()
      const forbidden = await guardDirectScoreRowRead(result && result.data)
      if (forbidden) return forbidden
      return result
    }

    case 'getById': {
      // 获取单场比赛（通过ID）
      if (!id && !_id) {
        return { errMsg: 'id is required' }
      }
      const result = await collection.doc(id || _id).get()
      const forbidden = await guardDirectScoreRowRead(result && result.data)
      if (forbidden) return forbidden
      return result
    }

    case 'update': {
      if (!_id && !id) {
        return { errMsg: '_id or id is required' }
      }

      // 数据验证
      const errors = validateMatchResult(data)
      if (errors.length > 0) {
        return { errMsg: 'validation failed', errors }
      }
      const current = await collection.doc(_id || id).get().catch(() => null)
      const scheduleGate = await guardDirectScoreWriteForRow(current && current.data, data && data.tournamentId)
      if (scheduleGate) return scheduleGate

      // 更新比赛数据
      const updateData = {
        tournamentId: data.tournamentId,
        round: data.round,
        type: data.type,
        players: data.players,
        score: data.score || '',
        scoreDetail: data.scoreDetail || null,
        winnerId: data.winnerId || null,
        loserId: data.loserId || null,
        pointsAwarded: data.pointsAwarded || null,
        status: data.status,
        matchTime: data.matchTime || null,
        courtId: data.courtId || null,
        updateTime: now
      }

      return await collection.doc(_id || id).update({
        data: updateData
      })
    }

    case 'delete': {
      // 删除比赛
      if (!_id && !id) {
        return { errMsg: '_id or id is required' }
      }
      return await collection.doc(_id || id).remove()
    }

    case 'list': {
      // 分页查询比赛列表，支持多条件过滤
      const query = []

      if (data && data.tournamentId) {
        const scheduleGate = await guardScoreRowsReadByTournamentId(data.tournamentId)
        if (scheduleGate) return scheduleGate
        query.push({ tournamentId: data.tournamentId })
      }
      if (data && data.round) {
        query.push({ round: data.round })
      }
      if (data && data.type) {
        query.push({ type: data.type })
      }
      if (data && data.status) {
        query.push({ status: data.status })
      }
      if (data && data.winnerId) {
        query.push({ winnerId: data.winnerId })
      }
      if (data && data.loserId) {
        query.push({ loserId: data.loserId })
      }
      if (data && data.playerId) {
        // 查询包含指定选手的比赛（winnerId 或 loserId 中包含该选手id）
        const playerId = data.playerId
        query.push(_.or([
          { winnerId: db.RegExp({ regexp: `(^|,)${playerId}(,|$)` }) },
          { loserId: db.RegExp({ regexp: `(^|,)${playerId}(,|$)` }) }
        ]))
      }

      const result = await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      return data && data.tournamentId
        ? filterActiveScoreRowsResult(result)
        : await filterScoreRowsVisibleToSubmitter(result)
    }

    case 'getByTournament': {
      // 获取指定赛事的所有比赛
      if (!data || !data.tournamentId) {
        return { errMsg: 'tournamentId is required' }
      }
      const scheduleGate = await guardScoreRowsReadByTournamentId(data.tournamentId)
      if (scheduleGate) return scheduleGate

      const query = { tournamentId: data.tournamentId }
      if (data.round) {
        query.round = data.round
      }

      return filterActiveScoreRowsResult(await collection
        .where(query)
        .orderBy('round', 'asc')
        .orderBy('createTime', 'asc')
        .get())
    }

    case 'getByPlayer': {
      // 获取指定选手的所有比赛
      if (!data || !data.playerId) {
        return { errMsg: 'playerId is required' }
      }

      const playerId = data.playerId
      const query = _.or([
        { winnerId: db.RegExp({ regexp: `(^|,)${playerId}(,|$)` }) },
        { loserId: db.RegExp({ regexp: `(^|,)${playerId}(,|$)` }) }
      ])

      return filterScoreRowsVisibleToSubmitter(await collection
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get())
    }

    case 'updateStatus': {
      // 更新比赛状态
      if (!_id && !id) {
        return { errMsg: '_id or id is required' }
      }
      if (!data || !data.status) {
        return { errMsg: 'status is required' }
      }

      return await collection.doc(_id || id).update({
        data: {
          status: data.status,
          updateTime: now
        }
      })
    }

    case 'updateScore': {
      // 更新比分
      if (!_id && !id) {
        return { errMsg: '_id or id is required' }
      }
      if (!data) {
        return { errMsg: 'score data is required' }
      }
      const current = await collection.doc(_id || id).get().catch(() => null)
      const scheduleGate = await guardDirectScoreWriteForRow(current && current.data)
      if (scheduleGate) return scheduleGate

      const updateData = {
        score: data.score,
        scoreDetail: data.scoreDetail,
        updateTime: now
      }

      if (data.winnerId) {
        updateData.winnerId = data.winnerId
      }
      if (data.loserId) {
        updateData.loserId = data.loserId
      }
      if (data.pointsAwarded) {
        updateData.pointsAwarded = data.pointsAwarded
      }
      if (data.status) {
        updateData.status = data.status
      }

      // 更新players中的isWinner
      if (data.winnerId && data.players) {
        updateData.players = data.players.map(p => ({
          ...p,
          isWinner: p.id === data.winnerId
        }))
      }

      return await collection.doc(_id || id).update({
        data: updateData
      })
    }

    case 'getStats': {
      // 获取比赛统计信息
      const totalCount = await collection.count()
      const pendingCount = await collection.where({ status: 'pending' }).count()
      const ongoingCount = await collection.where({ status: 'ongoing' }).count()
      const completedCount = await collection.where({ status: 'completed' }).count()
      const cancelledCount = await collection.where({ status: 'cancelled' }).count()

      let tournamentStats = {}
      if (data && data.tournamentId) {
        const totalByTournament = await collection.where({ tournamentId: data.tournamentId }).count()
        const completedByTournament = await collection.where({
          tournamentId: data.tournamentId,
          status: 'completed'
        }).count()
        tournamentStats = {
          total: totalByTournament.total,
          completed: completedByTournament.total
        }
      }

      return {
        data: {
          total: totalCount.total,
          pending: pendingCount.total,
          ongoing: ongoingCount.total,
          completed: completedCount.total,
          cancelled: cancelledCount.total,
          ...tournamentStats
        }
      }
    }

    case 'submit-result': {
      // 玩家/管理员提交比分；完整对账状态机在 Phase 5 实现，本期仅记录提交。
      const v = validateResultSubmission(data || {})
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      if (!data.matchId) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: 'matchId 不能为空' } }
      }
      const match = await collection.doc(data.matchId).get()
      const scheduleGate = await guardDirectScoreWriteForRow(match && match.data)
      if (scheduleGate) return scheduleGate
      const submissions = (match.data.submissions || []).filter(s => s.submittedBy !== data.submittedBy)
      submissions.push({
        submittedBy: data.submittedBy,
        role: data.role,
        winnerIds: data.winnerIds,
        score: data.score || '',
        submittedAt: db.serverDate()
      })
      await collection.doc(data.matchId).update({
        data: { submissions, resultStatus: 'pending', updateTime: now }
      })
      return { success: true, data: { resultStatus: 'pending' } }
    }

    case 'bulkUpsertScheduledMatches': {
      const adminGate = await requireAdmin()
      if (adminGate) return adminGate
      return await handleBulkUpsert(event)
    }

    case 'submit': {
      const { submit } = require('./lib/handlers/submit')
      const submitter = await resolveSubmitter()
      if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
      try {
        const ctx = buildSubmitCtx(submitter)
        const data = await submit(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || e.message || 'INTERNAL', e.message)
      }
    }

    case 'confirmAll': {
      const { confirmAll } = require('./lib/handlers/submit')
      const submitter = await resolveSubmitter()
      if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
      try {
        const ctx = buildSubmitCtx(submitter)
        const data = await confirmAll(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || e.message || 'INTERNAL', e.message)
      }
    }

    case 'reconfirmMatch': {
      const { reconfirmMatch } = require('./lib/handlers/submit')
      const submitter = await resolveSubmitter()
      if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
      try {
        const ctx = buildSubmitCtx(submitter)
        const data = await reconfirmMatch(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || e.message || 'INTERNAL', e.message)
      }
    }

    case 'voidMatch': {
      const { voidMatch } = require('./lib/handlers/submit')
      const submitter = await resolveSubmitter()
      if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
      try {
        const ctx = buildSubmitCtx(submitter)
        const data = await voidMatch(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.message || 'INTERNAL', e.message)
      }
    }


    case 'batchConfirm': {
      const { batchConfirm } = require('./lib/handlers/batch')
      const payload = event.payload || event
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) {
          return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限', requestId: payload && payload.requestId } }
        }
        const ctx = buildBatchCtx(submitter, true)
        const data = await batchConfirm(ctx, payload)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message, requestId: payload && payload.requestId } }
        return { success: false, error: { code: 'INTERNAL', message: e.message, requestId: payload && payload.requestId } }
      }
    }
    case 'batchSubmit': {
      const { batchSubmit } = require('./lib/handlers/batch')
      const payload = event.payload || event
      try {
        const submitter = await resolveSubmitter()
        if (!submitter) return { success: false, error: { code: 'FORBIDDEN', message: '请登录', requestId: payload && payload.requestId } }
        const ctx = buildBatchCtx(submitter, false)
        const data = await batchSubmit(ctx, payload)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message, requestId: payload && payload.requestId } }
        return { success: false, error: { code: 'INTERNAL', message: e.message, requestId: payload && payload.requestId } }
      }
    }
    case 'batchAdminSave': {
      const { batchAdminSave } = require('./lib/handlers/batch')
      const payload = event.payload || event
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) {
          return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限', requestId: payload && payload.requestId } }
        }
        const ctx = buildBatchCtx(submitter, true)
        const data = await batchAdminSave(ctx, payload)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message, requestId: payload && payload.requestId } }
        return { success: false, error: { code: 'INTERNAL', message: e.message, requestId: payload && payload.requestId } }
      }
    }
    case 'applyScheduleImpact': {
      const { applyScheduleImpact } = require('./lib/handlers/batch')
      const payload = event.payload || event
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) {
          return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } }
        }
        const ctx = buildBatchCtx(submitter, true)
        const data = await applyScheduleImpact(ctx, payload)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message } }
        return { success: false, error: { code: 'INTERNAL', message: e.message } }
      }
    }
    case 'pendingReviewItems': {
      const { pendingReviewItems } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } }
        const ctx = buildQueryCtx(submitter)
        const data = await pendingReviewItems(ctx, event.payload || event)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message } }
        return { success: false, error: { code: 'INTERNAL', message: e.message } }
      }
    }
    case 'pendingEntryGroups': {
      const { pendingEntryGroups } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } }
        const ctx = buildQueryCtx(submitter)
        const data = await pendingEntryGroups(ctx, event.payload || event)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message } }
        return { success: false, error: { code: 'INTERNAL', message: e.message } }
      }
    }
    case 'mySummary': {
      const { mySummary } = require('./lib/handlers/my-summary')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter) return { success: false, error: { code: 'FORBIDDEN', message: '请登录' } }
        const ctx = buildSummaryCtx(submitter)
        const data = await mySummary(ctx, event.payload || event)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message } }
        return { success: false, error: { code: 'INTERNAL', message: e.message } }
      }
    }
    case 'submittedQueue': {
      const { submittedQueue } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return fail('UNAUTHORIZED', '需要管理员权限')
        const ctx = buildQueryCtx(submitter)
        const data = await submittedQueue(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }

    case 'listByTournament': {
      const { listByTournament } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        const ctx = buildQueryCtx(submitter || { isAdmin: false })
        const data = await listByTournament(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }

    case 'listByPlayer': {
      const { listByPlayer } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        const ctx = buildQueryCtx(submitter || { isAdmin: false })
        const data = await listByPlayer(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }

    default:
      return { errMsg: 'invalid action' }
  }
}

// Phase 8 — page through submitted match_results using compound cursor
async function pagedFetchSubmitted() {
  const out = []
  const pageSize = 100
  let last = null
  for (let safety = 0; safety < 100; safety++) {
    const filter = last
      ? _.and([
          { resultStatus: 'submitted' },
          _.or([
            { createTime: _.gt(last.createTime) },
            _.and([{ createTime: last.createTime }, { _id: _.gt(last._id) }])
          ])
        ])
      : { resultStatus: 'submitted' }
    const res = await collection.where(filter).orderBy('createTime', 'asc').orderBy('_id', 'asc').limit(pageSize).get()
    const page = res.data
    out.push(...page)
    if (page.length < pageSize) break
    last = { createTime: page[page.length - 1].createTime, _id: page[page.length - 1]._id }
  }
  return out
}

exports.__test__ = {
  collectPlayerIds,
  resolveMatchType,
  resolveSubmitterByOpenid,
  resolveStateMatchId,
  guardDirectScoreRowRead,
  mergeScheduledMatchDoc,
  shouldRemoveOrphanMatchDoc,
}
