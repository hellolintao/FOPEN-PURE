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

// ---------------------------------------------------------------------------
// Action: bulkSet — 幂等批量设置赛事报名名单 (Phase 7 Task 3)
// ---------------------------------------------------------------------------

async function handleBulkSet(event) {
  const { tournamentId, registrations } = event

  // 1. Validate required args
  if (!tournamentId) {
    return {
      success: false,
      error: { code: 'INVALID_ARG', message: 'tournamentId 不能为空' }
    }
  }
  if (!Array.isArray(registrations)) {
    return {
      success: false,
      error: { code: 'INVALID_ARG', message: 'registrations 必须是数组' }
    }
  }

  // 2. Read the tournament doc
  let tournament
  try {
    const tournamentRes = await db.collection('tournaments').doc(tournamentId).get()
    tournament = tournamentRes.data
  } catch (e) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: tournamentId }
    }
  }
  if (!tournament) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: tournamentId }
    }
  }

  // 3. Validate ALL entries and assemble docs BEFORE any DB writes
  const errors = []
  const docs = registrations.map((r, i) => {
    const entryErrors = []

    if (!r.playerId) entryErrors.push(`[${i}] playerId 不能为空`)
    if (!r.playerName || r.playerName.trim() === '') entryErrors.push(`[${i}] playerName 不能为空`)
    if (tournament.type === 'doubles' && !r.partnerId) {
      entryErrors.push(`[${i}] doubles 赛事需要 partnerId`)
    }

    errors.push(...entryErrors)

    return {
      _id: generateRegistrationId(tournamentId, i),
      tournamentId,
      seasonId: tournament.seasonId,
      type: tournament.type,
      playerId: r.playerId,
      playerName: r.playerName,
      partnerId: r.partnerId || null,
      partnerName: r.partnerName || null,
      teamName: r.teamName || null,
      seed: r.seed || (i + 1),
      registrationStatus: 'confirmed',
      createTime: db.serverDate()
    }
  })

  // 4. If any validation errors, return without touching DB
  if (errors.length > 0) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: errors.join('; '),
        errors
      }
    }
  }

  // 5. Delete old registrations, then write new ones
  try {
    const existingRes = await db.collection('tournament_registrations')
      .where({ tournamentId })
      .get()
    const existing = existingRes.data || []
    await Promise.all(
      existing.map(doc => db.collection('tournament_registrations').doc(doc._id).remove())
    )
  } catch (e) {
    console.error('bulkSet: 删除旧报名失败', e)
    return {
      success: false,
      error: { code: 'DB_ERROR', message: '删除旧报名失败' }
    }
  }

  try {
    await Promise.all(
      docs.map(doc => db.collection('tournament_registrations').add({ data: doc }))
    )
  } catch (e) {
    console.error('bulkSet: 写入新报名失败', e)
    return {
      success: false,
      error: { code: 'DB_ERROR', message: '写入新报名失败' }
    }
  }

  return { success: true, data: { count: docs.length } }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

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

      case 'bulkSet':
        return await handleBulkSet(event)

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
