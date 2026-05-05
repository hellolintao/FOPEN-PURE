const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()

// 生成报名ID
function generateRegistrationId(tournamentId, index) {
  const tournamentIdWithoutPrefix = tournamentId.replace('tournament_', '')
  const indexStr = index.toString().padStart(3, '0')
  return `reg_${tournamentIdWithoutPrefix}_${indexStr}`
}

// 验证报名数据
function validateRegistration(data, isUpdate = false) {
  const errors = []

  if (!isUpdate) {
    if (!data.tournamentId) {
      errors.push('赛事ID不能为空')
    }
  }

  if (!data.seasonId) {
    errors.push('赛季ID不能为空')
  }

  if (!data.type || !['singles', 'doubles'].includes(data.type)) {
    errors.push('参赛类型必须是 singles 或 doubles')
  }

  if (!data.playerId) {
    errors.push('参赛选手ID不能为空')
  }

  if (!data.playerName || data.playerName.trim() === '') {
    errors.push('参赛选手姓名不能为空')
  }

  // 双打需要额外字段
  if (data.type === 'doubles') {
    if (!data.partnerId) {
      errors.push('双打需要搭档ID')
    }
    if (!data.partnerName || data.partnerName.trim() === '') {
      errors.push('双打需要搭档姓名')
    }
    if (!data.teamName || data.teamName.trim() === '') {
      errors.push('双打需要队伍名称')
    }
  }

  if (data.seed !== undefined && (data.seed < 1 || data.seed > 64)) {
    errors.push('种子排名必须在1-64之间')
  }

  if (data.status && !['registered', 'confirmed', 'withdrew'].includes(data.status)) {
    errors.push('状态必须是 registered, confirmed 或 withdrew')
  }

  return errors
}

exports.main = async (event, context) => {
  const { action, data, id, tournamentId, seasonId } = event

  const wxContext = cloud.getWXContext()

  try {
    switch (action) {
      case 'add': {
        // 添加报名
        const validationErrors = validateRegistration(data)
        if (validationErrors.length > 0) {
          return {
            errMsg: 'validation failed',
            errors: validationErrors
          }
        }

        // 查询当前赛事的报名数量
        const countResult = await db.collection('tournament_registrations')
          .where({
            tournamentId: data.tournamentId
          })
          .count()

        const registrationId = generateRegistrationId(data.tournamentId, countResult.total + 1)

        const now = new Date().toISOString()

        const registration = {
          _id: registrationId,
          tournamentId: data.tournamentId,
          seasonId: data.seasonId,
          type: data.type,
          playerId: data.playerId,
          playerName: data.playerName,
          partnerId: data.type === 'doubles' ? data.partnerId : '',
          partnerName: data.type === 'doubles' ? data.partnerName : '',
          teamName: data.type === 'doubles' ? data.teamName : '',
          seed: data.seed || countResult.total + 1,
          status: data.status || 'registered',
          registerTime: now,
          createTime: now
        }

        const result = await db.collection('tournament_registrations').add({
          data: registration
        })

        return {
          success: true,
          data: registration,
          _id: result._id
        }
      }

      case 'update': {
        // 更新报名
        if (!id) {
          return {
            errMsg: '报名ID不能为空'
          }
        }

        const validationErrors = validateRegistration(data, true)
        if (validationErrors.length > 0) {
          return {
            errMsg: 'validation failed',
            errors: validationErrors
          }
        }

        const updateData = {
          ...data,
          updateTime: new Date().toISOString()
        }

        const result = await db.collection('tournament_registrations').doc(id).update({
          data: updateData
        })

        return {
          success: true,
          _id: id
        }
      }

      case 'delete': {
        // 删除报名
        if (!id) {
          return {
            errMsg: '报名ID不能为空'
          }
        }

        const result = await db.collection('tournament_registrations').doc(id).remove()

        return {
          success: true,
          _id: id
        }
      }

      case 'get': {
        // 获取单个报名
        if (!id) {
          return {
            errMsg: '报名ID不能为空'
          }
        }

        const result = await db.collection('tournament_registrations').doc(id).get()

        return {
          success: true,
          data: result.data
        }
      }

      case 'list': {
        // 获取报名列表
        const { tournamentId: filterTournamentId, status: filterStatus, pageSize = 20, pageNum = 1 } = event

        const query = {}
        if (filterTournamentId) {
          query.tournamentId = filterTournamentId
        }
        if (filterStatus) {
          query.status = filterStatus
        }

        const result = await db.collection('tournament_registrations')
          .where(query)
          .orderBy('seed', 'asc')
          .skip((pageNum - 1) * pageSize)
          .limit(pageSize)
          .get()

        const countResult = await db.collection('tournament_registrations')
          .where(query)
          .count()

        return {
          success: true,
          data: result.data,
          total: countResult.total,
          pageNum,
          pageSize
        }
      }

      case 'getStats': {
        // 获取赛事报名统计
        if (!tournamentId) {
          return {
            errMsg: '赛事ID不能为空'
          }
        }

        const result = await db.collection('tournament_registrations')
          .where({
            tournamentId
          })
          .get()

        const registrations = result.data

        const stats = {
          total: registrations.length,
          singles: registrations.filter(r => r.type === 'singles').length,
          doubles: registrations.filter(r => r.type === 'doubles').length,
          registered: registrations.filter(r => r.status === 'registered').length,
          confirmed: registrations.filter(r => r.status === 'confirmed').length,
          withdrew: registrations.filter(r => r.status === 'withdrew').length
        }

        return {
          success: true,
          data: stats
        }
      }

      case 'updateStatus': {
        // 更新报名状态
        if (!id) {
          return {
            errMsg: '报名ID不能为空'
          }
        }

        const { status } = event
        if (!status || !['registered', 'confirmed', 'withdrew'].includes(status)) {
          return {
            errMsg: '状态必须是 registered, confirmed 或 withdrew'
          }
        }

        const result = await db.collection('tournament_registrations').doc(id).update({
          data: {
            status,
            updateTime: new Date().toISOString()
          }
        })

        return {
          success: true,
          _id: id,
          status
        }
      }

      case 'updateSeed': {
        // 更新种子排名
        if (!id) {
          return {
            errMsg: '报名ID不能为空'
          }
        }

        const { seed } = event
        if (!seed || seed < 1 || seed > 64) {
          return {
            errMsg: '种子排名必须在1-64之间'
          }
        }

        const result = await db.collection('tournament_registrations').doc(id).update({
          data: {
            seed,
            updateTime: new Date().toISOString()
          }
        })

        return {
          success: true,
          _id: id,
          seed
        }
      }

      default: {
        return {
          errMsg: '未知的操作类型'
        }
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
