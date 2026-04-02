// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('match_results')

// 生成比赛ID
function generateMatchId(tournamentId, round, matchIndex) {
  return `match_${tournamentId.split('_')[1]}_${tournamentId.split('_')[2]}_r${round}_m${matchIndex}`
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

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, _id, id } = event
  const now = db.serverDate()

  switch (action) {
    case 'add': {
      console.log('收到新增比赛数据:', JSON.stringify(data, null, 2))

      // 数据验证
      const errors = validateMatchResult(data)
      if (errors.length > 0) {
        console.log('验证失败:', errors)
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
        matchTime: data.matchTime || null,
        courtId: data.courtId || null,
        createTime: now,
        updateTime: now
      }

      console.log('准备插入数据库的数据:', JSON.stringify(addData, null, 2))

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

    case 'update': {
      console.log('收到更新比赛数据:', JSON.stringify(data, null, 2))

      if (!_id && !id) {
        return { errMsg: '_id or id is required' }
      }

      // 数据验证
      const errors = validateMatchResult(data)
      if (errors.length > 0) {
        console.log('验证失败:', errors)
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

      console.log('准备更新的数据:', JSON.stringify(updateData, null, 2))

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

      console.log('准备更新的比分数据:', JSON.stringify(updateData, null, 2))

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

    default:
      return { errMsg: 'invalid action' }
  }
}
