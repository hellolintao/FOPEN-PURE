// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('tournament_brackets')
const { advanceWinner, finalRoundOf } = require('./lib/generator')
const {
  GROUP_CODES,
  expectedGroupSize,
  validateGroupAssignments,
  generateGroupMatches: buildGroupMatches,
  calculateGroupStandings,
  generateKnockoutMatches,
  groupBracketDocId,
  knockoutBracketDocId,
} = require('./lib/group-knockout')

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

  if (!data.type || !['singles', 'doubles', 'mixed'].includes(data.type)) {
    errors.push('类型必须是 singles、doubles 或 mixed')
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

function fail(code, message) {
  return { success: false, error: { code, message } }
}

function phaseLocked(currentPhase) {
  return {
    success: false,
    error: {
      code: 'PHASE_LOCKED',
      message: '当前阶段不允许调整小组签表',
      currentPhase
    }
  }
}

function isAdminMember(member) {
  return !!(member && (member.admin === true || member.isAdmin === true))
}

async function resolveMemberByOpenid(openid, database = db, command = _) {
  if (!openid) return null
  const query = command && typeof command.or === 'function'
    ? command.or([{ openid }, { openId: openid }])
    : { openid }
  const res = await database.collection('members').where(query).get().catch(() => ({ data: [] }))
  const member = (res.data || [])[0]
  return member ? { ...member, openid: member.openid || member.openId || openid } : null
}

async function requireAdmin() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) return fail('FORBIDDEN', '需要登录')
  const member = await resolveMemberByOpenid(openid)
  if (!isAdminMember(member)) return fail('FORBIDDEN', '需要管理员权限')
  return null
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

      case 'saveInitialMatches': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleSaveInitialMatches(event)
      }

      case 'saveSchedule': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleSaveSchedule(event)
      }

      case 'saveGroups': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleSaveGroups(event)
      }

      case 'generateGroupMatches': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleGenerateGroupMatches(event)
      }

      case 'getGroupKnockoutBracket': {
        return await handleGetGroupKnockoutBracket(event)
      }

      case 'confirmKnockoutSeeds': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleConfirmKnockoutSeeds(event)
      }

      case 'resetGroups': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleResetGroups(event)
      }

      case 'resetKnockoutSeeds': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleResetKnockoutSeeds(event)
      }

      case 'regenerateDraft': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleRegenerateDraft(event)
      }

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

function buildDefaultScheduleCtx() {
  return {
    db: {
      getBracket: id => collection.doc(id).get().catch(() => null),
      updateBracket: (id, data) => collection.doc(id).update({ data }),
      getTournament: id => db.collection('tournaments').doc(id).get().catch(() => null),
      updateTournament: (id, data) => db.collection('tournaments').doc(id).update({ data }),
    },
    serverDate: () => db.serverDate(),
    set: value => _.set(value),
  }
}

async function handleSaveSchedule(event) {
  return handleSaveScheduleWithCtx(buildDefaultScheduleCtx(), event)
}

async function loadGroupKnockoutTournament(tournamentId) {
  if (!tournamentId) {
    return { error: fail('INVALID_ARG', 'tournamentId 必填') }
  }

  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (!tournament) {
    return { error: fail('NOT_FOUND', tournamentId) }
  }
  if (tournament.format !== 'group_knockout') {
    return { error: fail('INVALID_FORMAT', '赛事不是小组赛+淘汰赛赛制') }
  }

  return { tournament }
}

function manualOverridesFromTournament(tournament) {
  const snapshot = tournament && tournament.groupRankSnapshot
  if (!snapshot || typeof snapshot !== 'object') return null
  return snapshot.manualOverrides || null
}

async function loadGroupKnockoutContext(tournamentId) {
  const [tournamentRes, groupRes, bracketRes, resultRes] = await Promise.all([
    db.collection('tournaments').doc(tournamentId).get().catch(() => null),
    db.collection('tournament_groups').where({ tournamentId }).get().catch(() => ({ data: [] })),
    collection.where({ tournamentId }).get().catch(() => ({ data: [] })),
    db.collection('match_results').where({ tournamentId }).get().catch(() => ({ data: [] })),
  ])

  const tournament = tournamentRes && tournamentRes.data
  const groups = orderGroups(groupRes && groupRes.data ? groupRes.data : [])
  const brackets = bracketRes && bracketRes.data ? bracketRes.data : []
  const results = resultRes && resultRes.data ? resultRes.data : []
  const standingsResults = enrichGroupResultsForStandings(results, brackets)
  const standings = calculateGroupStandings({
    groups,
    results: standingsResults,
    manualOverrides: manualOverridesFromTournament(tournament),
  })

  return { tournament, groups, brackets, results, standings }
}

async function removeDocsByQuery(targetCollection, query) {
  const oldDocs = await targetCollection.where(query).get().catch(() => ({ data: [] }))
  let removed = 0
  for (const doc of (oldDocs.data || [])) {
    if (doc && doc._id) {
      await targetCollection.doc(doc._id).remove().catch(() => null)
      removed += 1
    }
  }
  return removed
}

async function removeDocsById(targetCollection, docs) {
  let removed = 0
  for (const doc of (docs || [])) {
    if (doc && doc._id) {
      await targetCollection.doc(doc._id).remove().catch(() => null)
      removed += 1
    }
  }
  return removed
}

function orderGroups(groups) {
  return (groups || []).slice().sort((a, b) => {
    const aIndex = GROUP_CODES.indexOf(a && a.groupCode)
    const bIndex = GROUP_CODES.indexOf(b && b.groupCode)
    if (aIndex === -1 && bIndex === -1) return String(a && a.groupCode).localeCompare(String(b && b.groupCode))
    if (aIndex === -1) return 1
    if (bIndex === -1) return -1
    return aIndex - bIndex
  })
}

function currentGroupKnockoutPhase(tournament) {
  return Object.prototype.hasOwnProperty.call(tournament, 'groupKnockoutPhase')
    ? tournament.groupKnockoutPhase
    : 'group_draft'
}

function sortGroupBrackets(brackets) {
  return (brackets || []).slice().sort((a, b) => {
    const groupDiff = GROUP_CODES.indexOf(a.groupCode) - GROUP_CODES.indexOf(b.groupCode)
    if (groupDiff) return groupDiff
    return (a.round || 0) - (b.round || 0)
  })
}

function sortRoundBrackets(brackets) {
  return (brackets || []).slice().sort((a, b) => (a.round || 0) - (b.round || 0))
}

async function handleGetGroupKnockoutBracket({ tournamentId }) {
  if (!tournamentId) {
    return fail('INVALID_ARG', 'tournamentId 必填')
  }

  const ctx = await loadGroupKnockoutContext(tournamentId)
  if (!ctx.tournament) {
    return fail('NOT_FOUND', tournamentId)
  }
  if (ctx.tournament.format !== 'group_knockout') {
    return fail('INVALID_FORMAT', '赛事不是小组赛+淘汰赛赛制')
  }

  const groupBrackets = ctx.brackets.filter(bracket => bracket.stage === 'group')
  const knockoutBrackets = ctx.brackets.filter(bracket => bracket.stage === 'knockout')

  return {
    success: true,
    data: {
      tournament: ctx.tournament,
      groups: ctx.groups,
      standings: ctx.standings,
      groupBrackets: sortGroupBrackets(groupBrackets),
      knockoutBrackets: sortRoundBrackets(knockoutBrackets)
    }
  }
}

function groupMatchCountForBracketSize(bracketSize) {
  const size = expectedGroupSize(bracketSize)
  return size > 1 ? (size * (size - 1)) / 2 : 0
}

function isActiveScoreRow(row) {
  return !!(
    row &&
    row.resultStatus !== 'invalidated' &&
    row.matchKind !== 'history' &&
    row.matchKind !== 'audit' &&
    !row.archivedFrom
  )
}

function resultSourceMatchId(result) {
  return result && (result.sourceMatchId || result.matchId || '')
}

function expectedGroupMatchesByIdFromBrackets(brackets) {
  const expectedMatchesById = new Map()
  for (const bracket of (brackets || []).filter(item => item && item.stage === 'group')) {
    const matches = Array.isArray(bracket.matches) ? bracket.matches : []
    for (const match of matches) {
      const matchId = match && match.matchId
      if (!matchId || expectedMatchesById.has(matchId)) continue
      expectedMatchesById.set(matchId, {
        matchId,
        groupCode: bracket.groupCode || match.groupCode,
        playerIds: [playerIdOf(match.player1), playerIdOf(match.player2)].filter(Boolean)
      })
    }
  }
  return expectedMatchesById
}

function couldBeGroupResultForExpectedMatch(result) {
  return !!(
    result &&
    result.stage !== 'knockout' &&
    result.matchKind !== 'bracket'
  )
}

function enrichGroupResultsForStandings(results, brackets) {
  const expectedMatchesById = expectedGroupMatchesByIdFromBrackets(brackets)
  return (Array.isArray(results) ? results : []).map(result => {
    const expected = expectedMatchesById.get(resultSourceMatchId(result))
    if (!expected || !couldBeGroupResultForExpectedMatch(result)) return result
    return {
      ...result,
      stage: result.stage || 'group',
      matchKind: result.matchKind || 'group',
      groupCode: result.groupCode || expected.groupCode
    }
  })
}

function playerIdOf(player) {
  return player && (player.id || player.playerId || player._id)
}

function resultParticipantId(result, side) {
  const player = result && result[side]
  return playerIdOf(player) || (result && (result[`${side}Id`] || result[`${side}PlayerId`]))
}

function samePlayerPair(expectedIds, actualIds) {
  if (expectedIds.length !== 2 || actualIds.length !== 2) return false
  return expectedIds.slice().sort().join('::') === actualIds.slice().sort().join('::')
}

function confirmedGroupResult(result, expectedMatchesById) {
  const sourceMatchId = resultSourceMatchId(result)
  const expected = expectedMatchesById && expectedMatchesById.get(sourceMatchId)
  return !!(
    result &&
    isActiveScoreRow(result) &&
    result.resultStatus === 'confirmed' &&
    (
      (expected && couldBeGroupResultForExpectedMatch(result)) ||
      (result.stage !== 'knockout' && (result.matchKind == null || result.matchKind === 'group') && GROUP_CODES.includes(result.groupCode))
    )
  )
}

function isGroupResult(result, expectedMatchesById) {
  if (!isActiveScoreRow(result)) return false
  const sourceMatchId = resultSourceMatchId(result)
  return !!(
    result.stage === 'group' ||
    (expectedMatchesById && expectedMatchesById.has(sourceMatchId) && couldBeGroupResultForExpectedMatch(result))
  )
}

function groupNotReady(message, groupCodes, details) {
  return {
    success: false,
    error: {
      code: 'GROUPS_NOT_READY',
      message,
      groupCodes,
      details
    }
  }
}

function validateConfirmReady(ctx) {
  const assignmentErrors = validateGroupAssignments({
    bracketSize: ctx.tournament.bracketSize,
    groups: ctx.groups,
  })
  if (assignmentErrors.length) {
    return { error: groupNotReady('小组分组未就绪', GROUP_CODES, assignmentErrors) }
  }

  const groupBrackets = sortGroupBrackets(ctx.brackets.filter(bracket => bracket.stage === 'group'))
  const groupBracketCodes = new Set(groupBrackets.map(bracket => bracket.groupCode))
  if (groupBrackets.length !== GROUP_CODES.length || !GROUP_CODES.every(groupCode => groupBracketCodes.has(groupCode))) {
    return { error: groupNotReady('小组赛签表未全部生成', GROUP_CODES.filter(groupCode => !groupBracketCodes.has(groupCode))) }
  }

  const expectedCount = groupMatchCountForBracketSize(ctx.tournament.bracketSize)
  if (!expectedCount) {
    return { error: groupNotReady('签位规模必须是 12 或 16', GROUP_CODES) }
  }

  const expectedMatches = []
  const expectedMatchesById = new Map()
  const bracketShapeErrors = []
  const duplicateExpectedMatchIds = []
  for (const groupCode of GROUP_CODES) {
    const bracket = groupBrackets.find(item => item.groupCode === groupCode)
    const matches = Array.isArray(bracket && bracket.matches) ? bracket.matches : []
    if (matches.length !== expectedCount) {
      bracketShapeErrors.push(`${groupCode}组小组赛签表应有 ${expectedCount} 场`)
    }
    for (const match of matches) {
      const matchId = match && match.matchId
      if (!matchId) {
        bracketShapeErrors.push(`${groupCode}组小组赛签表存在缺少 matchId 的比赛`)
        continue
      }
      if (expectedMatchesById.has(matchId)) duplicateExpectedMatchIds.push(matchId)
      const expected = {
        matchId,
        groupCode,
        playerIds: [playerIdOf(match.player1), playerIdOf(match.player2)].filter(Boolean)
      }
      expectedMatches.push(expected)
      expectedMatchesById.set(matchId, expected)
    }
  }
  if (bracketShapeErrors.length || duplicateExpectedMatchIds.length) {
    return {
      error: groupNotReady('小组赛签表未就绪', GROUP_CODES, {
        bracketShapeErrors,
        duplicateExpectedMatchIds
      })
    }
  }

  const resultsByMatchId = new Map()
  const unrelatedResultIds = []
  const playerMismatchSourceMatchIds = []
  for (const result of ctx.results.filter(row => confirmedGroupResult(row, expectedMatchesById))) {
    const sourceMatchId = resultSourceMatchId(result)
    const expected = expectedMatchesById.get(sourceMatchId)
    const effectiveGroupCode = result.groupCode || (expected && expected.groupCode)
    if (!expected || effectiveGroupCode !== expected.groupCode) {
      unrelatedResultIds.push(result._id || sourceMatchId)
      continue
    }

    const actualPlayerIds = [resultParticipantId(result, 'player1'), resultParticipantId(result, 'player2')].filter(Boolean)
    if (!samePlayerPair(expected.playerIds, actualPlayerIds)) {
      playerMismatchSourceMatchIds.push(sourceMatchId)
    }

    if (!resultsByMatchId.has(sourceMatchId)) resultsByMatchId.set(sourceMatchId, [])
    resultsByMatchId.get(sourceMatchId).push(result)
  }

  const missingSourceMatchIds = []
  const duplicateSourceMatchIds = []
  for (const expected of expectedMatches) {
    const matchedRows = resultsByMatchId.get(expected.matchId) || []
    if (matchedRows.length === 0) missingSourceMatchIds.push(expected.matchId)
    if (matchedRows.length > 1) duplicateSourceMatchIds.push(expected.matchId)
  }

  if (
    missingSourceMatchIds.length ||
    duplicateSourceMatchIds.length ||
    unrelatedResultIds.length ||
    playerMismatchSourceMatchIds.length
  ) {
    return {
      error: groupNotReady('小组赛成绩未全部确认', GROUP_CODES, {
        missingSourceMatchIds,
        duplicateSourceMatchIds,
        unrelatedResultIds,
        playerMismatchSourceMatchIds
      })
    }
  }

  const sourceResultIdsByGroupCode = GROUP_CODES.reduce((acc, groupCode) => {
    acc[groupCode] = []
    return acc
  }, {})
  const sourceResultIds = []
  for (const expected of expectedMatches) {
    const result = resultsByMatchId.get(expected.matchId)[0]
    const resultId = result._id || resultSourceMatchId(result)
    sourceResultIds.push(resultId)
    sourceResultIdsByGroupCode[expected.groupCode].push(resultId)
  }

  return { sourceResultIds, sourceResultIdsByGroupCode }
}

function standingRowToPlayer(row) {
  return {
    id: row.playerId,
    name: row.playerName,
    registrationId: row.registrationId || null
  }
}

function buildKnockoutSeeds(standings) {
  const seeds = {}
  for (const groupCode of GROUP_CODES) {
    const rows = standings[groupCode] && standings[groupCode].rows
    if (!Array.isArray(rows) || rows.length < 2) return null
    seeds[`${groupCode}1`] = standingRowToPlayer(rows[0])
    seeds[`${groupCode}2`] = standingRowToPlayer(rows[1])
  }
  return seeds
}

function buildSeedSources(standings, sourceResultIdsByGroupCode) {
  const seedSources = {}
  for (const groupCode of GROUP_CODES) {
    const rows = standings[groupCode] && standings[groupCode].rows
    if (!Array.isArray(rows)) continue
    rows.slice(0, 2).forEach((row, index) => {
      const rank = index + 1
      seedSources[`${groupCode}${rank}`] = {
        groupCode,
        rank,
        playerId: row.playerId,
        registrationId: row.registrationId || null,
        sourceResultIds: (sourceResultIdsByGroupCode && sourceResultIdsByGroupCode[groupCode]) || []
      }
    })
  }
  return seedSources
}

function deterministicKnockoutDocIdsFor(tournamentId) {
  return [1, 2, 3].map(round => knockoutBracketDocId(tournamentId, round))
}

function knockoutSourceMatchIdsFromBrackets(brackets, tournamentId) {
  const deterministicIdSet = new Set(deterministicKnockoutDocIdsFor(tournamentId))
  const sourceMatchIds = new Set()
  for (const bracket of (brackets || [])) {
    if (!bracket || (bracket.stage !== 'knockout' && !deterministicIdSet.has(bracket._id))) continue
    const matches = Array.isArray(bracket.matches) ? bracket.matches : []
    for (const match of matches) {
      if (match && match.matchId) sourceMatchIds.add(match.matchId)
    }
  }
  return sourceMatchIds
}

function isKnockoutResult(result, expectedGroupSourceMatchIds, knockoutSourceMatchIds) {
  if (!isActiveScoreRow(result)) return false
  const sourceMatchId = resultSourceMatchId(result)
  return !!(
    result.stage === 'knockout' ||
    (sourceMatchId && knockoutSourceMatchIds.has(sourceMatchId)) ||
    (result.matchKind === 'bracket' && !expectedGroupSourceMatchIds.has(sourceMatchId))
  )
}

function getOpenidSafe() {
  try {
    const wxContext = cloud.getWXContext()
    return (wxContext && wxContext.OPENID) || ''
  } catch (e) {
    return ''
  }
}

async function handleConfirmKnockoutSeeds({ tournamentId }) {
  if (!tournamentId) {
    return fail('INVALID_ARG', 'tournamentId 必填')
  }

  const ctx = await loadGroupKnockoutContext(tournamentId)
  if (!ctx.tournament) {
    return fail('NOT_FOUND', tournamentId)
  }
  if (ctx.tournament.format !== 'group_knockout') {
    return fail('INVALID_FORMAT', '赛事不是小组赛+淘汰赛赛制')
  }

  const phase = currentGroupKnockoutPhase(ctx.tournament)
  if (phase !== 'group_completed') {
    return phaseLocked(phase)
  }

  const expectedGroupSourceMatchIds = new Set(expectedGroupMatchesByIdFromBrackets(ctx.brackets).keys())
  const knockoutSourceMatchIds = knockoutSourceMatchIdsFromBrackets(ctx.brackets, tournamentId)
  const activeKnockoutResults = ctx.results.filter(result => isKnockoutResult(result, expectedGroupSourceMatchIds, knockoutSourceMatchIds))
  const confirmedKnockoutResults = activeKnockoutResults.filter(result => result.resultStatus === 'confirmed')
  if (confirmedKnockoutResults.length) {
    return {
      success: false,
      error: {
        code: 'KNOCKOUT_ALREADY_STARTED',
        message: '淘汰赛已有确认成绩，不能重新确认 8 强',
        resultIds: confirmedKnockoutResults.map(result => result._id || resultSourceMatchId(result))
      }
    }
  }

  const ready = validateConfirmReady(ctx)
  if (ready.error) return ready.error

  const manualTiebreakGroupCodes = GROUP_CODES.filter(groupCode => (
    ctx.standings[groupCode] && ctx.standings[groupCode].manualTiebreakRequired
  ))
  if (manualTiebreakGroupCodes.length) {
    return {
      success: false,
      error: {
        code: 'MANUAL_TIEBREAK_REQUIRED',
        message: '存在需要手动排序的小组',
        groupCodes: manualTiebreakGroupCodes
      }
    }
  }

  const seeds = buildKnockoutSeeds(ctx.standings)
  if (!seeds) {
    return groupNotReady('小组排名不足', GROUP_CODES)
  }

  const now = db.serverDate()
  const deterministicKnockoutDocIds = deterministicKnockoutDocIdsFor(tournamentId)
  const deterministicIdSet = new Set(deterministicKnockoutDocIds)
  for (const docId of deterministicKnockoutDocIds) {
    await collection.doc(docId).remove().catch(() => null)
  }
  for (const bracket of ctx.brackets.filter(item => item.stage === 'knockout')) {
    if (bracket && bracket._id && !deterministicIdSet.has(bracket._id)) {
      await collection.doc(bracket._id).remove().catch(() => null)
    }
  }

  const resultCollection = db.collection('match_results')
  for (const result of activeKnockoutResults.filter(row => row.resultStatus !== 'confirmed')) {
    if (result && result._id) {
      await resultCollection.doc(result._id).remove().catch(() => null)
    }
  }

  const knockoutDocs = generateKnockoutMatches({ tournamentId, seeds }).map(doc => ({
    ...doc,
    createTime: now,
    updateTime: now
  }))
  for (const doc of knockoutDocs) {
    await collection.add({
      data: doc
    })
  }

  const confirmedBy = getOpenidSafe()
  const manualOverrides = manualOverridesFromTournament(ctx.tournament)
  const groupRankSnapshot = {
    groups: ctx.standings,
    manualOverrides,
    sourceResultIds: ready.sourceResultIds,
    metadata: {
      confirmedBy,
      confirmedAt: now
    },
    version: 1
  }
  const knockoutSeedSnapshot = {
    seeds,
    bracket: knockoutDocs,
    bracketDocIds: knockoutDocs.map(doc => doc._id),
    seedSources: buildSeedSources(ctx.standings, ready.sourceResultIdsByGroupCode),
    metadata: {
      confirmedBy,
      confirmedAt: now
    },
    version: 1
  }
  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      groupRankSnapshot,
      knockoutSeedSnapshot,
      groupKnockoutPhase: 'knockout_published',
      updateTime: now
    }
  })

  return { success: true, data: { seeds, knockoutRounds: knockoutDocs.length } }
}

async function handleResetGroups({ tournamentId }) {
  if (!tournamentId) {
    return fail('INVALID_ARG', 'tournamentId 必填')
  }

  const ctx = await loadGroupKnockoutContext(tournamentId)
  if (!ctx.tournament) {
    return fail('NOT_FOUND', tournamentId)
  }
  if (ctx.tournament.format !== 'group_knockout') {
    return fail('INVALID_FORMAT', '赛事不是小组赛+淘汰赛赛制')
  }

  const phase = currentGroupKnockoutPhase(ctx.tournament)
  if (phase !== 'group_published') {
    return phaseLocked(phase)
  }

  const expectedGroupMatchesById = expectedGroupMatchesByIdFromBrackets(ctx.brackets)
  const activeGroupResults = ctx.results.filter(result => isGroupResult(result, expectedGroupMatchesById))
  const confirmedGroupResults = ctx.results.filter(result => confirmedGroupResult(result, expectedGroupMatchesById))
  if (confirmedGroupResults.length) {
    return {
      success: false,
      error: {
        code: 'GROUP_ALREADY_STARTED',
        message: '小组赛已有确认成绩，不能撤回分组',
        resultIds: confirmedGroupResults.map(result => result._id || resultSourceMatchId(result))
      }
    }
  }

  const resultCollection = db.collection('match_results')
  const removedBrackets = await removeDocsByQuery(collection, { tournamentId, stage: 'group' })
  const removedStageRows = await removeDocsByQuery(resultCollection, { tournamentId, stage: 'group' })
  const removedLegacyRows = await removeDocsById(
    resultCollection,
    activeGroupResults.filter(result => result.stage !== 'group')
  )
  const removedRows = removedStageRows + removedLegacyRows
  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      groupRankSnapshot: null,
      groupKnockoutPhase: 'group_draft',
      updateTime: db.serverDate()
    }
  })

  return { success: true, data: { removedBrackets, removedRows } }
}

async function archiveKnockoutSeedSnapshot(tournamentId, snapshot, overwrittenAt) {
  if (!snapshot) return
  await db.collection('tournament_snapshots').add({
    data: {
      _id: `snapshot_${tournamentId}_knockoutSeedSnapshot_${Date.now()}`,
      tournamentId,
      kind: 'knockoutSeedSnapshot',
      snapshot,
      overwrittenAt
    }
  })
}

async function handleResetKnockoutSeeds({ tournamentId }) {
  if (!tournamentId) {
    return fail('INVALID_ARG', 'tournamentId 必填')
  }

  const ctx = await loadGroupKnockoutContext(tournamentId)
  if (!ctx.tournament) {
    return fail('NOT_FOUND', tournamentId)
  }
  if (ctx.tournament.format !== 'group_knockout') {
    return fail('INVALID_FORMAT', '赛事不是小组赛+淘汰赛赛制')
  }

  const phase = currentGroupKnockoutPhase(ctx.tournament)
  if (phase !== 'knockout_published') {
    return phaseLocked(phase)
  }

  const expectedGroupSourceMatchIds = new Set(expectedGroupMatchesByIdFromBrackets(ctx.brackets).keys())
  const knockoutSourceMatchIds = knockoutSourceMatchIdsFromBrackets(ctx.brackets, tournamentId)
  const activeKnockoutResults = ctx.results.filter(result => isKnockoutResult(result, expectedGroupSourceMatchIds, knockoutSourceMatchIds))
  const confirmedKnockoutResults = activeKnockoutResults.filter(result => result.resultStatus === 'confirmed')
  if (confirmedKnockoutResults.length) {
    return {
      success: false,
      error: {
        code: 'KNOCKOUT_ALREADY_STARTED',
        message: '淘汰赛已有确认成绩，不能撤回淘汰赛签表',
        resultIds: confirmedKnockoutResults.map(result => result._id || resultSourceMatchId(result))
      }
    }
  }

  const resultCollection = db.collection('match_results')
  const deterministicKnockoutDocIds = deterministicKnockoutDocIdsFor(tournamentId)
  const deterministicIdSet = new Set(deterministicKnockoutDocIds)
  const knockoutBracketIdsToRemove = new Set(deterministicKnockoutDocIds)
  for (const bracket of ctx.brackets) {
    if (!bracket || !bracket._id) continue
    if (bracket.stage === 'knockout' && !deterministicIdSet.has(bracket._id)) {
      knockoutBracketIdsToRemove.add(bracket._id)
    }
  }
  let removedBrackets = 0
  for (const docId of knockoutBracketIdsToRemove) {
    const knownDoc = ctx.brackets.find(bracket => bracket && bracket._id === docId)
    const result = await collection.doc(docId).remove().catch(() => null)
    if (result && typeof result.removed === 'number') {
      removedBrackets += result.removed
    } else if (result && result.stats && typeof result.stats.removed === 'number') {
      removedBrackets += result.stats.removed
    } else if (knownDoc) {
      removedBrackets += 1
    }
  }
  const removedStageRows = await removeDocsByQuery(resultCollection, { tournamentId, stage: 'knockout' })
  const removedLegacyRows = await removeDocsById(
    resultCollection,
    activeKnockoutResults.filter(result => result.stage !== 'knockout')
  )
  const removedRows = removedStageRows + removedLegacyRows
  const now = db.serverDate()
  await archiveKnockoutSeedSnapshot(tournamentId, ctx.tournament.knockoutSeedSnapshot, now)
  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      knockoutSeedSnapshot: null,
      groupRankSnapshot: null,
      groupKnockoutPhase: 'group_completed',
      updateTime: now
    }
  })

  return { success: true, data: { removedBrackets, removedRows } }
}

async function handleSaveGroups({ tournamentId, groups }) {
  const loaded = await loadGroupKnockoutTournament(tournamentId)
  if (loaded.error) return loaded.error

  const phase = currentGroupKnockoutPhase(loaded.tournament)
  if (phase !== 'group_draft') {
    return phaseLocked(phase)
  }

  const errors = validateGroupAssignments({
    bracketSize: loaded.tournament.bracketSize,
    groups,
  })
  if (errors.length) {
    return {
      success: false,
      error: { code: 'VALIDATION_FAILED', message: errors.join('; '), errors }
    }
  }

  const now = db.serverDate()
  const groupCollection = db.collection('tournament_groups')
  await removeDocsByQuery(groupCollection, { tournamentId })

  for (const group of orderGroups(groups)) {
    await groupCollection.add({
      data: {
        _id: `group_${tournamentId}_${group.groupCode}`,
        tournamentId,
        groupCode: group.groupCode,
        slots: group.slots,
        createTime: now,
        updateTime: now
      }
    })
  }

  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      updateTime: now
    }
  })

  return { success: true, data: { count: GROUP_CODES.length } }
}

async function handleGenerateGroupMatches({ tournamentId }) {
  const loaded = await loadGroupKnockoutTournament(tournamentId)
  if (loaded.error) return loaded.error

  const phase = currentGroupKnockoutPhase(loaded.tournament)
  if (phase !== 'group_draft') {
    return phaseLocked(phase)
  }

  const groupCollection = db.collection('tournament_groups')
  const groupRes = await groupCollection.where({ tournamentId }).get().catch(() => ({ data: [] }))
  const groups = orderGroups(groupRes.data || [])
  const errors = validateGroupAssignments({
    bracketSize: loaded.tournament.bracketSize,
    groups,
  })
  if (errors.length) {
    return {
      success: false,
      error: { code: 'VALIDATION_FAILED', message: errors.join('; '), errors }
    }
  }

  await removeDocsByQuery(collection, { tournamentId, stage: 'group' })

  const now = db.serverDate()
  const matches = buildGroupMatches({
    tournamentId,
    bracketSize: loaded.tournament.bracketSize,
    groups,
  })
  const matchesByGroupCode = GROUP_CODES.reduce((acc, groupCode) => {
    acc[groupCode] = matches.filter(match => match.groupCode === groupCode)
    return acc
  }, {})

  for (const groupCode of GROUP_CODES) {
    await collection.add({
      data: {
        _id: groupBracketDocId(tournamentId, groupCode),
        tournamentId,
        format: 'group_knockout',
        stage: 'group',
        groupCode,
        round: 1,
        type: 'singles',
        matches: matchesByGroupCode[groupCode],
        createTime: now,
        updateTime: now
      }
    })
  }

  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      groupKnockoutPhase: 'group_published',
      updateTime: now
    }
  })

  return { success: true, data: { count: matches.length } }
}

async function handleSaveScheduleWithCtx(ctx, { tournamentId, queues }) {
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
  const r1Res = await ctx.db.getBracket(r1Id)
  const r1 = r1Res && r1Res.data
  if (!r1) {
    return { success: false, error: { code: 'NOT_FOUND', message: r1Id } }
  }

  const updated = r1.matches.map(m => {
    const a = matchAssignments.get(m.matchId)
    if (!a) return m
    return { ...m, courtId: a.courtId, queueOrder: a.queueOrder }
  })

  await ctx.db.updateBracket(r1Id, {
    matches: updated,
    updateTime: ctx.serverDate()
  })

  // Mirror queues into tournament.schedulePlan.queues — 必须用 _.set() 整体替换
  // 否则 TCB 会把对象展开成 dot-path（schedulePlan.queues），遇到旧 doc
  // schedulePlan=null 时会报 "Cannot create field 'queues' in element {schedulePlan: null}"
  const tRes = await ctx.db.getTournament(tournamentId)
  const curSP = (tRes && tRes.data && tRes.data.schedulePlan && typeof tRes.data.schedulePlan === 'object')
    ? tRes.data.schedulePlan
    : { slotMinutes: 20, courts: [], queues: [] }
  const nextSP = { ...curSP, queues }
  await ctx.db.updateTournament(tournamentId, {
    schedulePlan: ctx.set(nextSP),
    updateTime: ctx.serverDate()
  })
  // Intentionally NOT writing scheduleStatus here. Higher-level callers
  // (tournaments.saveScheduleDraft / tournaments.publishSchedule) own that field.

  return { success: true, data: { count: updated.filter(m => m.courtId).length } }
}

function markMatchesForRevision(matches, playerId) {
  if (!Array.isArray(matches)) return []
  return matches.map(match => {
    const affected = !!playerId && (
      (match.player1 && match.player1.id === playerId) ||
      (match.player2 && match.player2.id === playerId)
    )
    return affected ? { ...match, needsRevision: true } : match
  })
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

  // 同样用 _.set() 整体替换避免 dot-path 在 null 字段上写
  const tRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const curSP = (tRes && tRes.data && tRes.data.schedulePlan && typeof tRes.data.schedulePlan === 'object')
    ? tRes.data.schedulePlan
    : { slotMinutes: 20, courts: [], queues: [] }
  const nextSP = { ...curSP, queues: [] }
  await db.collection('tournaments').doc(tournamentId).update({
    data: { schedulePlan: _.set(nextSP), updateTime: db.serverDate() }
  }).catch(() => null)

  return { success: true }
}

exports.__test__ = {
  validateBracket,
  markMatchesForRevision,
  handleSaveScheduleWithCtx,
  makeScheduleCtx: ({ tournament, r1 }) => {
    const ctx = {
      bracketUpdates: [],
      tournamentUpdates: [],
      db: {
        getBracket: jest.fn(async id => (r1 && id === r1._id ? { data: r1 } : null)),
        updateBracket: jest.fn(async (id, data) => {
          ctx.bracketUpdates.push({ id, data })
        }),
        getTournament: jest.fn(async id => (tournament && (!tournament._id || id === tournament._id) ? { data: tournament } : null)),
        updateTournament: jest.fn(async (id, data) => {
          ctx.tournamentUpdates.push({ id, data })
        }),
      },
      serverDate: () => 'server-date',
      set: value => value,
    }
    return ctx
  },
}
