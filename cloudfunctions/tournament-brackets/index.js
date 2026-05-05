// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('tournament_brackets')

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
      if (!match.player1 || !match.player1.id) {
        errors.push(`第${index + 1}场比赛缺少player1`)
      }
      if (!match.player2 || !match.player2.id) {
        errors.push(`第${index + 1}场比赛缺少player2`)
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
          scheduledTime: data.scheduledTime || matches[matchIndex].scheduledTime,
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
