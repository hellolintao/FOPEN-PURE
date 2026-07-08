const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

const db = cloud.database()
const _ = db.command
const {
  selfRegister,
  withdrawRegistration
} = require('./lib/service')
const { isActiveRegistration } = require('../_shared/tournament-phase')
const { toPublicIdentity } = require('../_shared/public-profile')

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

  if (!data.type || !['singles', 'doubles', 'mixed'].includes(data.type)) {
    errors.push('参赛类型必须是 singles、doubles 或 mixed')
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

function fail(code, message) {
  return { success: false, error: { code, message } }
}

function isAdminMember(member) {
  return !!(member && (member.admin === true || member.isAdmin === true))
}

function isSensitivePublicField(key) {
  const normalized = String(key || '').toLowerCase()
  return normalized.includes('openid') ||
    normalized.includes('phone') ||
    normalized.includes('admin') ||
    normalized.includes('publicprofileconsent') ||
    normalized.includes('playstyle')
}

function stripSensitivePublicFields(row = {}) {
  return Object.keys(row).reduce((acc, key) => {
    if (!isSensitivePublicField(key)) acc[key] = row[key]
    return acc
  }, {})
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

async function getMembersByIds(ids, database = db, command = _) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()
  const query = command && typeof command.in === 'function'
    ? { _id: command.in(uniqueIds) }
    : { _id: uniqueIds }
  const res = await database.collection('members').where(query).get().catch(() => ({ data: [] }))
  return new Map((res.data || []).map(member => [member._id, member]))
}

function registrationMemberIds(rows = []) {
  const ids = []
  for (const row of rows || []) {
    if (row && row.playerId) ids.push(row.playerId)
    if (row && row.partnerId) ids.push(row.partnerId)
  }
  return ids
}

function registrationRowWithMemberIdentity(row = {}, membersById, index, options = {}) {
  const safe = options.stripSensitive ? stripSensitivePublicFields(row) : { ...row }
  if (options.stripSensitive) {
    delete safe.name
    delete safe.avatarUrl
  }
  if (row.playerId) {
    const identity = toPublicIdentity(membersById.get(row.playerId), { rank: row.seed, index })
    safe.playerName = identity.name
    safe.playerAvatarUrl = identity.avatarUrl
    safe.playerPublicProfileVisible = identity.publicProfileVisible
  }

  if (row.partnerId) {
    const identity = toPublicIdentity(membersById.get(row.partnerId), { rank: row.seed, index })
    safe.partnerName = identity.name
    safe.partnerAvatarUrl = identity.avatarUrl
    safe.partnerPublicProfileVisible = identity.publicProfileVisible
  }

  return safe
}

async function registrationRowsWithMemberIdentity(rows = [], options = {}) {
  const membersById = await getMembersByIds(registrationMemberIds(rows))
  return (rows || []).map((row, index) => registrationRowWithMemberIdentity(row, membersById, index, options))
}

async function publicRegistrationRows(rows = []) {
  return registrationRowsWithMemberIdentity(rows, { stripSensitive: true })
}

async function adminRegistrationRows(rows = []) {
  return registrationRowsWithMemberIdentity(rows, { stripSensitive: false })
}

async function shouldReturnAdminRegistrationRows(wxContext) {
  const openid = wxContext && wxContext.OPENID
  const member = await resolveMemberByOpenid(openid)
  return isAdminMember(member)
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
    // 双打：仅 knockout（固定搭档）报名时强制要求 partnerId；
    // regular doubles 报名是个人，组队在排程阶段随机生成。
    if (tournament.type === 'doubles' && tournament.format === 'knockout' && !r.partnerId) {
      entryErrors.push(`[${i}] 淘汰赛双打报名必须携带 partnerId`)
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

function buildServiceCtx(wxContext) {
  return {
    openid: wxContext && wxContext.OPENID,
    now: () => new Date().toISOString(),
    serverDate: () => db.serverDate(),
    inc: (delta) => _.inc(delta),
    runTransaction: async (handler) => db.runTransaction(async (transaction) => {
      return handler(buildTransactionDb(transaction))
    }),
    db: {
      updateBracketMatches
    }
  }
}

function buildTransactionDb(database) {
  return {
    getTournament: async (tournamentId) => {
      const res = await database.collection('tournaments').doc(tournamentId).get().catch(() => null)
      return res && res.data
    },
    getMemberByOpenid: async (openid) => {
      if (!openid) return null
      const query = _ && typeof _.or === 'function'
        ? _.or([{ openid }, { openId: openid }])
        : { openid }
      const res = await database.collection('members').where(query).get().catch(() => ({ data: [] }))
      return (res.data || [])[0] || null
    },
    listRegistrations: async (tournamentId) => {
      const query = database.collection('tournament_registrations').where({ tournamentId })
      const res = await limitQuery(query, 1000).get()
      return res.data || []
    },
    upsertRegistration: async (id, data) => {
      const collection = database.collection('tournament_registrations')
      const existing = await collection.doc(id).get().catch(() => null)
      if (existing && existing.data) {
        if (!isSameRegistrationIdentity(existing.data, data)) {
          const err = new Error('报名ID已被其他报名占用')
          err.code = 'REGISTRATION_ID_CONFLICT'
          throw err
        }
        await collection.doc(id).update({ data: stripId(data) })
      } else {
        await collection.add({ data: { ...data, _id: id } })
      }
    },
    updateRegistration: async (id, data) => {
      await database.collection('tournament_registrations').doc(id).update({ data: stripId(data) })
    },
    updateTournament: async (tournamentId, data) => {
      await database.collection('tournaments').doc(tournamentId).update({ data })
    },
    listMatchResults: async (tournamentId) => {
      const query = database.collection('match_results').where({ tournamentId })
      const res = await limitQuery(query, 1000).get()
      return res.data || []
    },
    listBrackets: async (tournamentId) => {
      const query = database.collection('tournament_brackets').where({ tournamentId })
      const res = await limitQuery(query, 1000).get()
      return res.data || []
    }
  }
}

function limitQuery(query, n) {
  return query && typeof query.limit === 'function' ? query.limit(n) : query
}

function stripId(data = {}) {
  const { _id, ...rest } = data
  return rest
}

function isSameRegistrationIdentity(existing = {}, next = {}) {
  const existingMemberId = existing.playerId || existing.memberId
  const nextMemberId = next.playerId || next.memberId
  return !!(
    existing.tournamentId &&
    next.tournamentId &&
    existing.tournamentId === next.tournamentId &&
    existingMemberId &&
    nextMemberId &&
    existingMemberId === nextMemberId
  )
}

function getRegistrationStatus(registration = {}) {
  return registration.registrationStatus || registration.status || 'confirmed'
}

async function updateBracketMatches(tournamentId, patches, updateTime) {
  for (const patch of (patches || [])) {
    if (!patch || !patch.bracketId) continue
    await db.collection('tournament_brackets').doc(patch.bracketId).update({
      data: {
        matches: patch.matches,
        updateTime: updateTime || db.serverDate()
      }
    })
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

exports.main = async (event, context) => {
  const { action, data, id, tournamentId, seasonId } = event

  const wxContext = cloud.getWXContext()

  try {
    switch (action) {
      case 'selfRegister':
        return await selfRegister(buildServiceCtx(wxContext), event)

      case 'withdraw':
        return await withdrawRegistration(buildServiceCtx(wxContext), event)

      case 'add': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate

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
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate

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
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate

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
        const adminRows = await shouldReturnAdminRegistrationRows(wxContext)
        const data = adminRows
          ? (await adminRegistrationRows(result.data ? [result.data] : []))[0]
          : (await publicRegistrationRows(result.data ? [result.data] : []))[0]

        return {
          success: true,
          data
        }
      }

      case 'list': {
        // 获取报名列表
        const listData = (event && event.data) || {}
        const {
          tournamentId: eventTournamentId,
          status: eventStatus,
          registrationStatus: eventRegistrationStatus,
          pageSize: eventPageSize,
          pageNum: eventPageNum
        } = event
        const filterTournamentId = eventTournamentId || listData.tournamentId
        const filterStatus = eventStatus || listData.status
        const filterRegistrationStatus = eventRegistrationStatus || listData.registrationStatus
        const pageSize = eventPageSize || listData.pageSize || 20
        const pageNum = eventPageNum || listData.pageNum || 1

        const query = {}
        if (filterTournamentId) {
          query.tournamentId = filterTournamentId
        }
        const statusFilter = filterRegistrationStatus || filterStatus

        if (statusFilter) {
          const result = await db.collection('tournament_registrations')
            .where(query)
            .orderBy('seed', 'asc')
            .limit(1000)
            .get()
          const filtered = (result.data || [])
            .filter(row => getRegistrationStatus(row) === statusFilter)
          const offset = (pageNum - 1) * pageSize
          const pageRows = filtered.slice(offset, offset + pageSize)
          const adminRows = await shouldReturnAdminRegistrationRows(wxContext)

          return {
            success: true,
            data: adminRows ? await adminRegistrationRows(pageRows) : await publicRegistrationRows(pageRows),
            total: filtered.length,
            pageNum,
            pageSize
          }
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
        const adminRows = await shouldReturnAdminRegistrationRows(wxContext)

        return {
          success: true,
          data: adminRows ? await adminRegistrationRows(result.data || []) : await publicRegistrationRows(result.data || []),
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

        const registrations = result.data || []
        const activeRegistrations = registrations.filter(isActiveRegistration)

        const stats = {
          total: registrations.length,
          singles: registrations.filter(r => r.type === 'singles').length,
          doubles: registrations.filter(r => r.type === 'doubles').length,
          registered: registrations.filter(r => (r.registrationStatus || r.status) === 'registered').length,
          confirmed: activeRegistrations.length,
          withdrew: registrations.filter(r => !isActiveRegistration(r)).length
        }

        return {
          success: true,
          data: stats
        }
      }

      case 'updateStatus': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate

        // 更新报名状态
        if (!id) {
          return {
            errMsg: '报名ID不能为空'
          }
        }

        const { status } = event
        if (status === 'registered') {
          return {
            success: false,
            error: {
              code: 'INVALID_STATUS',
              message: 'registered 状态已废弃，请使用 confirmed 或 withdrew'
            }
          }
        }

        if (!status || !['confirmed', 'withdrew'].includes(status)) {
          return {
            errMsg: '状态必须是 confirmed 或 withdrew'
          }
        }

        const result = await db.collection('tournament_registrations').doc(id).update({
          data: {
            ...buildStatusUpdate(status),
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
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate

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

      case 'bulkSet': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleBulkSet(event)
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

exports.__test__ = {
  validateRegistration,
  buildServiceCtx,
  isAdminMember,
  resolveMemberByOpenid,
}

function buildStatusUpdate(status) {
  return { registrationStatus: status }
}
