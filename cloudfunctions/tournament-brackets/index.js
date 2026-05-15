// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('tournament_brackets')
const { advanceWinner, finalRoundOf } = require('./lib/generator')

// 生成对位表ID
function generateBracketId(tournamentId, round) {
  const tournamentIdWithoutPrefix = tournamentId.replace('tournament_', '')
  return `bracket_${tournamentIdWithoutPrefix}_round_${round}`
}

// 生成比赛ID
function generateMatchId(tournamentId, round, position) {
  const tournamentIdWithoutPrefix = tournamentId.replace('tournament_', '')
  return `match_${tournamentIdWithoutPrefix}_r${round}_m${position}`
}

// 验证对位表数据
function validateBracket(data) {
  const errors = []

  if (!data.tournamentId) {
    errors.push('赛事ID不能为空')
  }

  if (!data.round || data.round < 1) {
    errors.push('轮数必须大于0')
  }

  if (!data.type || !['singles', 'doubles'].includes(data.type)) {
    errors.push('类型必须是 singles 或 doubles')
  }

  if (!data.matches || !Array.isArray(data.matches)) {
    errors.push('比赛列表必须是数组')
  }

  // 验证每场比赛
  if (data.matches) {
    data.matches.forEach((match, index) => {
      if (match.player1 !== null && match.player1 !== undefined) {
        if (match.player1.id === undefined) {
          errors.push(`第${index + 1}场比赛 player1 缺 id`)
        }
      }
      if (match.player2 !== null && match.player2 !== undefined) {
        if (match.player2.id === undefined) {
          errors.push(`第${index + 1}场比赛 player2 缺 id`)
        }
      }
      if (match.position === undefined || match.position < 1) {
        errors.push(`第${index + 1}场比赛位置无效`)
      }
      if (!match.matchId) {
        errors.push(`第${index + 1}场比赛缺少matchId`)
      }
      if (match.status && !['pending', 'ongoing', 'completed'].includes(match.status)) {
        errors.push(`第${index + 1}场比赛状态无效`)
      }
    })
  }

  // 验证下一轮对位映射
  if (data.nextRoundMatches && Array.isArray(data.nextRoundMatches)) {
    data.nextRoundMatches.forEach((mapping, index) => {
      if (!mapping.nextMatchPosition || mapping.nextMatchPosition < 1) {
        errors.push(`下一轮映射${index + 1}的nextMatchPosition无效`)
      }
      if (!mapping.fromMatchPositions || !Array.isArray(mapping.fromMatchPositions)) {
        errors.push(`下一轮映射${index + 1}的fromMatchPositions必须是数组`)
      }
    })
  }

  return errors
}

exports.main = async (event, context) => {
  const { action, data, id, tournamentId, round, matchId, position } = event
  const now = db.serverDate()

  try {
    switch (action) {
      case 'add': {
        // 新增对位表
        const errors = validateBracket(data)
        if (errors.length > 0) {
          return { errMsg: 'validation failed', errors }
        }

        const bracketId = data._id || generateBracketId(data.tournamentId, data.round)

        const addData = {
          _id: bracketId,
          tournamentId: data.tournamentId,
          round: data.round,
          type: data.type,
          matches: data.matches.map(m => ({
            ...m,
            matchId: m.matchId || generateMatchId(data.tournamentId, data.round, m.position)
          })),
          nextRoundMatches: data.nextRoundMatches || [],
          createTime: now,
          updateTime: now
        }

        return await collection.add({
          data: addData
        })
      }

      case 'update': {
        // 更新对位表
        const errors = validateBracket(data)
        if (errors.length > 0) {
          return { errMsg: 'validation failed', errors }
        }

        const updateData = {
          ...data,
          updateTime: now
        }

        return await collection.doc(id).update({
          data: updateData
        })
      }

      case 'delete': {
        // 删除对位表
        return await collection.doc(id).remove()
      }

      case 'get': {
        // 获取单个对位表
        return await collection.doc(id).get()
      }

      case 'getByTournament': {
        // 根据赛事ID获取所有轮次的对位表
        const result = await collection
          .where({ tournamentId })
          .orderBy('round', 'asc')
          .get()

        return { data: result.data }
      }

      case 'getByRound': {
        // 根据赛事ID和轮次获取对位表
        const result = await collection
          .where({
            tournamentId,
            round: round
          })
          .get()

        return { data: result.data }
      }

      case 'list': {
        // 分页查询对位表
        const { page = 1, pageSize = 10, filterTournamentId } = event
        const query = filterTournamentId ? { tournamentId: filterTournamentId } : {}

        const result = await collection
          .where(query)
          .orderBy('createTime', 'desc')
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .get()

        const countResult = await collection.where(query).count()

        return {
          data: result.data,
          total: countResult.total,
          page,
          pageSize
        }
      }

      case 'updateMatch': {
        // 更新单场比赛
        if (!id || !matchId) {
          return { errMsg: '对位表ID和比赛ID不能为空' }
        }

        const bracket = await collection.doc(id).get()
        if (!bracket.data) {
          return { errMsg: '对位表不存在' }
        }

        const matches = bracket.data.matches
        const matchIndex = matches.findIndex(m => m.matchId === matchId)

        if (matchIndex === -1) {
          return { errMsg: '比赛不存在' }
        }

        matches[matchIndex] = {
          ...matches[matchIndex],
          ...data.match
        }

        return await collection.doc(id).update({
          data: {
            matches: matches,
            updateTime: now
          }
        })
      }

      case 'updateMatchScore': {
        // 更新比赛比分
        if (!id || !matchId) {
          return { errMsg: '对位表ID和比赛ID不能为空' }
        }

        const bracket = await collection.doc(id).get()
        if (!bracket.data) {
          return { errMsg: '对位表不存在' }
        }

        const matches = bracket.data.matches
        const matchIndex = matches.findIndex(m => m.matchId === matchId)

        if (matchIndex === -1) {
          return { errMsg: '比赛不存在' }
        }

        matches[matchIndex] = {
          ...matches[matchIndex],
          winner: data.winner,
          score: data.score,
          status: data.status || 'completed'
        }

        return await collection.doc(id).update({
          data: {
            matches: matches,
            updateTime: now
          }
        })
      }

      case 'updateMatchStatus': {
        // 更新比赛状态
        if (!id || !matchId) {
          return { errMsg: '对位表ID和比赛ID不能为空' }
        }

        const bracket = await collection.doc(id).get()
        if (!bracket.data) {
          return { errMsg: '对位表不存在' }
        }

        const matches = bracket.data.matches
        const matchIndex = matches.findIndex(m => m.matchId === matchId)

        if (matchIndex === -1) {
          return { errMsg: '比赛不存在' }
        }

        matches[matchIndex] = {
          ...matches[matchIndex],
          status: data.status,
          scheduledStart: data.scheduledStart || data.scheduledTime || matches[matchIndex].scheduledStart || matches[matchIndex].scheduledTime,
          scheduledSlotId: data.scheduledSlotId || matches[matchIndex].scheduledSlotId,
          courtId: data.courtId || matches[matchIndex].courtId
        }

        return await collection.doc(id).update({
          data: {
            matches: matches,
            updateTime: now
          }
        })
      }

      case 'getStats': {
        // 获取对位表统计信息
        if (!tournamentId) {
          return { errMsg: '赛事ID不能为空' }
        }

        const result = await collection.where({ tournamentId }).get()
        const brackets = result.data

        let totalMatches = 0
        let completedMatches = 0
        let ongoingMatches = 0
        let pendingMatches = 0

        brackets.forEach(bracket => {
          if (bracket.matches) {
            totalMatches += bracket.matches.length
            bracket.matches.forEach(match => {
              if (match.status === 'completed') completedMatches++
              else if (match.status === 'ongoing') ongoingMatches++
              else pendingMatches++
            })
          }
        })

        return {
          data: {
            totalRounds: brackets.length,
            totalMatches,
            completedMatches,
            ongoingMatches,
            pendingMatches
          }
        }
      }

      case 'saveInitialMatches':
        return await handleSaveInitialMatches(event)

      case 'saveSchedule':
        return await handleSaveSchedule(event)

      case 'regenerateDraft':
        return await handleRegenerateDraft(event)

      default: {
        return { errMsg: 'invalid action' }
      }
    }
  } catch (err) {
    console.error('云函数执行出错:', err)
    return {
      errMsg: err.message || '操作失败',
      error: err
    }
  }
}

// ─── New action handlers (Phase 7) ───────────────────────────────────────────

async function handleSaveInitialMatches({ tournamentId, matches }) {
  if (!tournamentId) {
    return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  }
  if (!Array.isArray(matches) || matches.length === 0) {
    return { success: false, error: { code: 'INVALID_ARG', message: 'matches 不能为空' } }
  }

  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (!tournament) {
    return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }
  }

  // Validate R1 matches structure
  const errs = []
  matches.forEach((m, i) => {
    if (m.round !== 1) errs.push(`第 ${i + 1} 场 round 必须 = 1`)
    if (!m.matchId) errs.push(`第 ${i + 1} 场缺 matchId`)
    if (m.position === undefined || m.position === null) errs.push(`第 ${i + 1} 场缺 position`)
  })
  if (errs.length) {
    return { success: false, error: { code: 'VALIDATION_FAILED', message: errs.join('; '), errors: errs } }
  }

  // Wipe old brackets for this tournament
  const oldBrackets = await collection.where({ tournamentId }).get().catch(() => ({ data: [] }))
  for (const b of (oldBrackets.data || [])) {
    await collection.doc(b._id).remove().catch(() => null)
  }

  // Write R1
  const r1Id = `bracket_${tournamentId.replace('tournament_', '')}_round_1`
  await collection.add({
    data: {
      _id: r1Id,
      tournamentId,
      round: 1,
      type: tournament.type,
      matches,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  let finalRound = 1
  if (tournament.format === 'knockout') {
    const slots = matches.length * 2
    finalRound = finalRoundOf(slots)
    // Pre-create R2..finalRound skeleton
    for (let r = 2; r <= finalRound; r++) {
      const count = matches.length / Math.pow(2, r - 1)
      const placeholderMatches = Array.from({ length: count }, (_, i) => ({
        matchId: `match_r${r}_p${i + 1}_${Date.now()}_${i}`,
        round: r,
        position: i + 1,
        player1: null,
        player2: null,
        bye: false,
        status: 'pending',
        resultStatus: 'pending',
        winner: null,
        courtId: null,
        queueOrder: null
      }))
      const docId = `bracket_${tournamentId.replace('tournament_', '')}_round_${r}`
      await collection.add({
        data: {
          _id: docId,
          tournamentId,
          round: r,
          type: tournament.type,
          matches: placeholderMatches,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
    }

    // Auto-advance BYE winners to R2
    for (const m of matches) {
      if (m.bye === true && m.winner) {
        const patch = advanceWinner({ round: 1, position: m.position, winner: m.winner, isFinal: finalRound === 1 })
        if (patch) await fillNextSlot(tournamentId, patch)
      }
    }
  }

  return { success: true, data: { count: matches.length, finalRound } }
}

async function fillNextSlot(tournamentId, { nextRound, nextPosition, slot, winner }) {
  const docId = `bracket_${tournamentId.replace('tournament_', '')}_round_${nextRound}`
  const docRes = await collection.doc(docId).get().catch(() => null)
  const doc = docRes && docRes.data
  if (!doc) return
  const idx = doc.matches.findIndex(x => x.position === nextPosition)
  if (idx < 0) return
  const newMatches = doc.matches.map((m, i) => i === idx ? { ...m, [slot]: winner } : m)
  await collection.doc(docId).update({
    data: { matches: newMatches, updateTime: db.serverDate() }
  })
}

async function handleSaveSchedule({ tournamentId, queues }) {
  if (!tournamentId) {
    return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  }
  if (!Array.isArray(queues)) {
    return { success: false, error: { code: 'INVALID_ARG', message: 'queues 必须是数组' } }
  }

  const matchAssignments = new Map()
  for (const q of queues) {
    if (!Array.isArray(q.items)) continue
    for (const item of q.items) {
      if (item.kind === 'match') {
        matchAssignments.set(item.matchId, { courtId: q.courtId, queueOrder: item.order })
      }
    }
  }

  const r1Id = `bracket_${tournamentId.replace('tournament_', '')}_round_1`
  const r1Res = await collection.doc(r1Id).get().catch(() => null)
  const r1 = r1Res && r1Res.data
  if (!r1) {
    return { success: false, error: { code: 'NOT_FOUND', message: r1Id } }
  }

  const updated = r1.matches.map(m => {
    const a = matchAssignments.get(m.matchId)
    if (!a) return m
    return { ...m, courtId: a.courtId, queueOrder: a.queueOrder }
  })

  await collection.doc(r1Id).update({
    data: { matches: updated, updateTime: db.serverDate() }
  })

  // Mirror queues into tournament.schedulePlan.queues — 不能用 dot-path
  // 因为有的旧 draft schedulePlan 字段可能为 null/缺失，dot-path 在 null 上写会报
  // "Cannot create field 'queues' in element {schedulePlan: null}"
  const tRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const curSP = (tRes && tRes.data && tRes.data.schedulePlan && typeof tRes.data.schedulePlan === 'object')
    ? tRes.data.schedulePlan
    : { slotMinutes: 20, courts: [], queues: [] }
  const nextSP = { ...curSP, queues }
  await db.collection('tournaments').doc(tournamentId).update({
    data: { schedulePlan: nextSP, updateTime: db.serverDate() }
  })

  return { success: true, data: { count: updated.filter(m => m.courtId).length } }
}

async function handleRegenerateDraft({ tournamentId }) {
  if (!tournamentId) {
    return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  }

  async function wipe(collectionName) {
    const res = await db.collection(collectionName).where({ tournamentId }).get().catch(() => ({ data: [] }))
    for (const doc of (res.data || [])) {
      await db.collection(collectionName).doc(doc._id).remove().catch(() => null)
    }
  }

  await wipe('tournament_brackets')
  await wipe('match_results')
  await wipe('free_plays')

  // 同样避免 dot-path 在 null 字段上写
  const tRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const curSP = (tRes && tRes.data && tRes.data.schedulePlan && typeof tRes.data.schedulePlan === 'object')
    ? tRes.data.schedulePlan
    : { slotMinutes: 20, courts: [], queues: [] }
  const nextSP = { ...curSP, queues: [] }
  await db.collection('tournaments').doc(tournamentId).update({
    data: { schedulePlan: nextSP, updateTime: db.serverDate() }
  }).catch(() => null)

  return { success: true }
}
