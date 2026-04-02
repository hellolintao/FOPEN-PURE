// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('tournaments')

// 生成赛事ID
function generateTournamentId() {
  const year = new Date().getFullYear()
  const timestamp = Date.now()
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return `tournament_${year}_${timestamp.toString().slice(-6)}_${random}`
}

// 数据验证函数
function validateTournament(data) {
  const errors = []

  // 必填字段验证
  if (!data.name || data.name.trim() === '') {
    errors.push('赛事名称不能为空')
  }
  if (!data.type || !['singles', 'doubles'].includes(data.type)) {
    errors.push('赛事类型必须是 singles 或 doubles')
  }
  if (!data.format || !['regular', 'knockout'].includes(data.format)) {
    errors.push('赛制必须是 regular(常规赛) 或 knockout(淘汰赛)')
  }
  if (!data.startDate) {
    errors.push('开始日期不能为空')
  }

  // 日期验证
  if (data.startDate && data.endDate) {
    const start = new Date(data.startDate)
    const end = new Date(data.endDate)
    if (start > end) {
      errors.push('结束日期不能早于开始日期')
    }
  }

  // 配置验证
  if (data.config) {
    const { maxPlayers, totalRounds, playersPerMatch, eliminationType } = data.config

    if (maxPlayers && (maxPlayers < 2 || maxPlayers > 64)) {
      errors.push('参赛人数必须在 2-64 之间')
    }

    if (totalRounds && (totalRounds < 1 || totalRounds > 8)) {
      errors.push('轮数必须在 1-8 之间')
    }

    if (playersPerMatch && ![2, 4].includes(playersPerMatch)) {
      errors.push('每场比赛人数必须是 2(单打) 或 4(双打)')
    }

    if (eliminationType && !['single', 'double'].includes(eliminationType)) {
      errors.push('淘汰类型必须是 single(单败) 或 double(双败)')
    }
  }

  return errors
}

exports.main = async (event, context) => {
  const { action, data, page = 1, pageSize = 10, keyword, id, status, _id } = event
  const now = db.serverDate()
  switch (action) {
    case 'add': {
      console.log('收到新增数据:', JSON.stringify(data, null, 2))

      // 数据验证
      const errors = validateTournament(data)
      if (errors.length > 0) {
        console.log('验证失败:', errors)
        return { errMsg: 'validation failed', errors }
      }

      // 生成赛事ID
      const tournamentId = data._id || generateTournamentId()

      // 新增赛事 - 直接使用前端传来的数据，确保完整
      const addData = {
        _id: tournamentId,
        seasonId: data.seasonId,
        name: data.name,
        type: data.type,
        format: data.format || 'regular',
        startDate: data.startDate,
        endDate: data.endDate,
        location: data.location,
        status: data.status || 'upcoming',
        description: data.description || '',

        // 直接使用前端传来的配置和积分规则，如果不存在则使用默认值
        config: data.config || {
          maxPlayers: 16,
          currentRound: 1,
          totalRounds: 4,
          playersPerMatch: 2,
          eliminationType: 'single',
          seedPlayers: []
        },

        pointsRules: data.pointsRules || {
          win: 100,
          loss: 20,
          walkover: 50,
          bonusByRound: {
            1: 0,
            2: 0,
            3: 0,
            4: 0,
            5: 0
          }
        },

        createTime: now,
        updateTime: now
      }

      console.log('准备插入数据库的数据:', JSON.stringify(addData, null, 2))

      return await collection.add({
        data: addData
      })
    }
    case 'get': {
      // 获取单个赛事
      return await collection.doc(id).get()
    }
    case 'update': {
      console.log('收到更新数据:', JSON.stringify(data, null, 2))

      // 数据验证
      const errors = validateTournament(data)
      if (errors.length > 0) {
        console.log('验证失败:', errors)
        return { errMsg: 'validation failed', errors }
      }

      // 更新赛事 - 确保包含所有字段
      const updateData = {
        ...data,
        updateTime: now
      }

      console.log('准备更新的数据:', JSON.stringify(updateData, null, 2))

      return await collection.doc(id).update({
        data: updateData
      })
    }
    case 'updateConfig': {
      // 更新赛事配置
      return await collection.doc(id).update({
        data: {
          config: data.config,
          updateTime: now
        }
      })
    }
    case 'updatePointsRules': {
      // 更新积分规则
      return await collection.doc(id).update({
        data: {
          pointsRules: data.pointsRules,
          updateTime: now
        }
      })
    }
    case 'updateStatus': {
      // 更新赛事状态
      return await collection.doc(_id || id).update({
        data: {
          status,
          updateTime: now
        }
      })
    }
    case 'delete': {
      // 删除赛事
      return await collection.doc(_id || id).remove()
    }
    case 'list': {
      // 分页查询赛事，支持按名称模糊搜索，并聚合赛季名称
      const query = []
      if (keyword) {
        query.push({ name: db.RegExp({ regexp: keyword, options: 'i' }) })
      }
      if (status) {
        query.push({ status })
      }
      if (data && data.type) {
        query.push({ type: data.type })
      }
      if (data && data.seasonId) {
        query.push({ seasonId: data.seasonId })
      }
      // 查询赛事列表
      const tournamentsRes = await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('startDate', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      const tournaments = tournamentsRes.data || []
      // 获取所有涉及的seasonId
      const seasonIds = [...new Set(tournaments.map(t => t.seasonId).filter(Boolean))]
      let seasonMap = {}
      if (seasonIds.length > 0) {
        console.log('seasonIds', seasonIds)
        const seasonsRes = await db.collection('seasons').where({ '_id': _.in(seasonIds) }).get();
        (seasonsRes.data || []).forEach(s => { seasonMap[s['_id']] = s.name })
      }
      // 聚合seasonName
      const result = tournaments.map(t => ({
        ...t,
        seasonName: seasonMap[t.seasonId] || '-'
      }))
      return { data: result }
    }
    case 'getStats': {
      // 获取赛事统计信息
      const totalCount = await collection.count()
      const upcomingCount = await collection.where({ status: 'upcoming' }).count()
      const ongoingCount = await collection.where({ status: 'ongoing' }).count()
      const completedCount = await collection.where({ status: 'completed' }).count()

      return {
        data: {
          total: totalCount.total,
          upcoming: upcomingCount.total,
          ongoing: ongoingCount.total,
          completed: completedCount.total
        }
      }
    }
    default:
      return { errMsg: 'invalid action' }
  }
}