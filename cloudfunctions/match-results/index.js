// 云函数入口文件
const cloud = require('wx-server-sdk')
const { validateResultSubmission } = require('./lib/validate')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('match_results')

const { createMatchStateService } = require('./lib/state')
const awardLib = require('./lib/award')
const scoreRule = require('./lib/score-rule')
const stateSvc = createMatchStateService({ db, awardLib, scoreRule })

// 收集选手 ID（兼容 singles/doubles，跳过 BYE）
function collectPlayerIds(m, type) {
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
  const r = await db.collection('members').where({ openid: wxContext.OPENID }).get()
  const m = r.data[0]
  if (!m) return null
  return { _id: m._id, isAdmin: (typeof m.admin === 'boolean') ? m.admin : !!m.isAdmin }
}

function ok(data) { return { success: true, data } }
function fail(code, message) { return { success: false, error: { code, message } } }

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
      const playerIds = collectPlayerIds(m, tournament.type)

      const doc = {
        _id: docId,
        tournamentId,
        seasonId: tournament.seasonId,
        tournamentType: tournament.type,
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
          data: { ...doc, createTime: existing.createTime }
        })
      } else {
        await collection.add({ data: { ...doc, createTime: now } })
      }
    }

    // 2. Pre-create R2+ skeleton match_results from tournament_brackets
    const skeletonRes = await db.collection('tournament_brackets')
      .where({ tournamentId, round: _.gt(1) })
      .get()
      .catch(() => ({ data: [] }))
    for (const bracket of (skeletonRes.data || [])) {
      for (const m of (bracket.matches || [])) {
        const docId = `result_${prefix}_${m.matchId}`
        if (seen.has(docId)) continue
        seen.add(docId)
        const playerIds = collectPlayerIds(m, tournament.type)
        const doc = {
          _id: docId,
          tournamentId,
          seasonId: tournament.seasonId,
          tournamentType: tournament.type,
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
          await collection.doc(docId).update({ data: { ...doc, createTime: existing.createTime } })
        } else {
          await collection.add({ data: { ...doc, createTime: now } })
        }
      }
    }

    // 3. Delete orphan rows (this tournament, bracket/regularRound/extra kinds, not in seen)
    const orphanRes = await collection.where({
      tournamentId,
      matchKind: _.in(['bracket', 'regularRound', 'extra'])
    }).get().catch(() => ({ data: [] }))
    for (const doc of (orphanRes.data || [])) {
      if (!seen.has(doc._id)) {
        await collection.doc(doc._id).remove().catch(() => null)
      }
    }

    return { success: true, data: { count: seen.size } }
  } catch (e) {
    console.error('[match-results.bulkUpsertScheduledMatches] error', e)
    return { success: false, error: { code: 'INTERNAL', message: e.message } }
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
      return await collection.doc(_id || id).get()
    }

    case 'getById': {
      // 获取单场比赛（通过ID）
      if (!id && !_id) {
        return { errMsg: 'id is required' }
      }
      return await collection.doc(id || _id).get()
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

      return await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    }

    case 'getByTournament': {
      // 获取指定赛事的所有比赛
      if (!data || !data.tournamentId) {
        return { errMsg: 'tournamentId is required' }
      }

      const query = { tournamentId: data.tournamentId }
      if (data.round) {
        query.round = data.round
      }

      return await collection
        .where(query)
        .orderBy('round', 'asc')
        .orderBy('createTime', 'asc')
        .get()
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

      return await collection
        .where(query)
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
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

    case 'bulkUpsertScheduledMatches':
      return await handleBulkUpsert(event)

    case 'submit': {
      const submitter = await resolveSubmitter()
      if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
      try {
        await stateSvc.submitResult({ matchId: event.matchId, score: event.score, submitter })
        return ok({ ok: true })
      } catch (e) {
        return fail(e.message || 'INTERNAL', e.message)
      }
    }

    case 'confirmAll': {
      const submitter = await resolveSubmitter()
      if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
      try {
        const r = await stateSvc.confirmAll({ tournamentId: event.tournamentId, admin: submitter })
        return ok(r)
      } catch (e) {
        return fail(e.message || 'INTERNAL', e.message)
      }
    }

    case 'reconfirmMatch': {
      const submitter = await resolveSubmitter()
      if (!submitter) return fail('UNAUTHORIZED', '用户未注册')
      try {
        await stateSvc.reconfirmMatch({ matchId: event.matchId, newScore: event.newScore, admin: submitter })
        return ok({ ok: true })
      } catch (e) {
        return fail(e.message || 'INTERNAL', e.message)
      }
    }


    case 'submittedQueue': {
      const submitter = await resolveSubmitter()
      if (!submitter || !submitter.isAdmin) return fail('UNAUTHORIZED', '需要管理员权限')
      try {
        const rows = await pagedFetchSubmitted()
        if (rows.length === 0) return ok({ items: [] })
        const grouped = {}
        for (const r of rows) grouped[r.tournamentId] = (grouped[r.tournamentId] || 0) + 1
        const tournamentIds = Object.keys(grouped)
        const tournaments = (await db.collection('tournaments').where({ _id: _.in(tournamentIds) }).get()).data
        const tMap = Object.fromEntries(tournaments.map(t => [t._id, t]))
        return ok({
          items: tournamentIds.map(tid => ({
            tournamentId: tid,
            tournamentName: tMap[tid] && tMap[tid].name ? tMap[tid].name : tid,
            submittedCount: grouped[tid]
          }))
        })
      } catch (e) {
        return fail('INTERNAL', e.message)
      }
    }

    case 'listByTournament': {
      try {
        if (!event.tournamentId) return fail('INVALID_ARG', 'tournamentId 必填')
        const results = (await collection
          .where({ tournamentId: event.tournamentId })
          .orderBy('round', 'asc')
          .orderBy('position', 'asc')
          .orderBy('createTime', 'asc')
          .limit(500)
          .get()).data
        return ok({ results })
      } catch (e) {
        return fail('INTERNAL', e.message)
      }
    }

    case 'listByPlayer': {
      try {
        if (!event.memberId) return fail('INVALID_ARG', 'memberId 必填')
        const matches = (await collection.where({
          playerIds: _.in([event.memberId]),
          resultStatus: _.neq('confirmed')
        }).orderBy('round', 'asc').limit(200).get()).data
        return ok({ matches })
      } catch (e) {
        return fail('INTERNAL', e.message)
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
