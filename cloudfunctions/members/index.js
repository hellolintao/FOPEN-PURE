// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('members')

const VALID_PLAY_STYLES = [
  'ice-cow',
  'vers',
  'iron-lady',
  'moon-queen',
  'grinder',
  'slicer'
]

const ALLOWED_MEMBER_FIELDS = [
  'name',
  'phone',
  'avatarUrl',
  'status',
  'admin',
  'playStyle'
]

function normalizePayload(data) {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) {
    return {}
  }

  return data
}

function validateMemberData(data = {}) {
  data = normalizePayload(data)
  const errors = []

  if (data.playStyle != null && data.playStyle !== '' && !VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`)
  }

  return { valid: errors.length === 0, errors }
}

function validateMemberAdd(data = {}) {
  data = normalizePayload(data)
  const errors = []

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('name 不能为空')
  }

  if (data.playStyle == null || data.playStyle === '') {
    errors.push('playStyle 不能为空')
  } else if (!VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`)
  }

  return { valid: errors.length === 0, errors }
}

function sanitizeMemberPayload(data = {}) {
  data = normalizePayload(data)
  const payload = {}

  for (const field of ALLOWED_MEMBER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      payload[field] = data[field]
    }
  }

  return payload
}

function sanitizeAndTrimMemberPayload(data) {
  const payload = sanitizeMemberPayload(data || {})
  if (typeof payload.name === 'string') {
    payload.name = payload.name.trim()
  }
  return payload
}

function stripSelfServiceOnlyFields(payload) {
  const { admin, status, ...selfServicePayload } = payload
  return selfServicePayload
}

function isAdminMember(member) {
  return !!(member && (member.admin === true || member.isAdmin === true))
}

async function resolveCallerMember() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) return null
  const res = await collection.where(_.or([
    { openid },
    { openId: openid }
  ])).get()
  return (res.data || [])[0] || null
}

async function requireAdmin() {
  const member = await resolveCallerMember()
  if (!isAdminMember(member)) {
    return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } }
  }
  return null
}

function publicMemberProfile(member) {
  if (!member) return member
  const {
    openid,
    openId,
    unionid,
    phone,
    admin,
    isAdmin,
    ...publicProfile
  } = member
  return publicProfile
}

function isCloudFileId(value) {
  return typeof value === 'string' && value.startsWith('cloud://')
}

async function resolveAvatarDisplayUrls(members = []) {
  if (!Array.isArray(members) || members.length === 0 || typeof cloud.getTempFileURL !== 'function') {
    return members
  }

  const fileList = Array.from(new Set(
    members
      .map(member => member && member.avatarUrl)
      .filter(isCloudFileId)
  ))

  if (fileList.length === 0) return members

  try {
    const res = await cloud.getTempFileURL({ fileList })
    const urlByFileId = new Map()
    ;(res.fileList || []).forEach(file => {
      if (file && file.fileID && file.tempFileURL) {
        urlByFileId.set(file.fileID, file.tempFileURL)
      }
    })

    if (urlByFileId.size === 0) return members

    return members.map(member => {
      if (!member || !urlByFileId.has(member.avatarUrl)) return member
      return {
        ...member,
        avatarUrl: urlByFileId.get(member.avatarUrl)
      }
    })
  } catch (err) {
    console.warn('[members] resolveAvatarDisplayUrls failed', err)
    return members
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, data, page = 1, pageSize = 10, keyword, _id } = event

  switch (action) {
    case 'add': {
      // 新增会员，openid唯一
      const payload = stripSelfServiceOnlyFields(sanitizeAndTrimMemberPayload(data))
      const v = validateMemberAdd(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const exist = await collection.where({ openid }).get()
      if (exist.data && exist.data.length > 0) {
        return { errMsg: 'already registered', data: exist.data[0] }
      }
      const now = db.serverDate()
      const unclaimed = await collection.where({
        name: payload.name,
        claimStatus: 'unclaimed'
      }).get()
      const claimableMembers = (unclaimed.data || []).filter(member => !member.openid && !member.openId)
      if (claimableMembers.length > 1) {
        return {
          success: false,
          error: { code: 'CLAIM_CONFLICT', message: '姓名匹配到多条待认领会员，请联系管理员处理' }
        }
      }
      if (claimableMembers.length === 1) {
        const claimUpdateData = {
          ...payload,
          openid,
          claimStatus: 'claimed',
          status: 'active',
          admin: false,
          isAdmin: false,
          updateTime: now
        }
        const claimedMember = {
          ...claimableMembers[0],
          ...claimUpdateData
        }
        const claimResult = await collection.where({
          _id: claimableMembers[0]._id,
          claimStatus: 'unclaimed',
          openid: _.exists(false),
          openId: _.exists(false)
        }).update({
          data: claimUpdateData
        })
        const updated = (claimResult && claimResult.stats && claimResult.stats.updated) || (claimResult && claimResult.updated) || 0
        if (updated <= 0) {
          return {
            success: false,
            error: { code: 'CLAIM_CONFLICT', message: '会员认领失败，记录可能已被其他用户认领，请刷新后重试' }
          }
        }
        return { data: claimedMember }
      }
      return await collection.add({
        data: {
          ...payload,
          openid,
          status: 'active',
          admin: false,
          claimStatus: 'claimed',
          createTime: now,
          updateTime: now
        }
      })
    }
    case 'get': {
      // 获取会员信息 by openid
      if (!openid) {
        return { data: [] }
      }
      return await collection.where({ openid }).get()
    }
    case 'update': {
      // 更新会员信息 by openid
      const payload = stripSelfServiceOnlyFields(sanitizeAndTrimMemberPayload(data))
      const v = validateMemberData(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const now = db.serverDate()
      return await collection.where({ openid }).update({
        data: {
          ...payload,
          updateTime: now
        }
      })
    }
    case 'claimSelf': {
      const payload = stripSelfServiceOnlyFields(sanitizeAndTrimMemberPayload(data))
      const v = validateMemberAdd(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      if (!openid) {
        return { success: false, error: { code: 'MEMBER_REQUIRED', message: '请先登录' } }
      }
      const existingRes = await collection.where({ openid }).get()
      const existing = (existingRes.data || [])[0]
      if (!existing) {
        return { success: false, error: { code: 'MEMBER_REQUIRED', message: '请先完善资料' } }
      }
      const now = db.serverDate()
      const updateData = {
        ...payload,
        claimStatus: 'claimed',
        status: 'active',
        updateTime: now
      }
      const updateResult = await collection.where({ openid }).update({ data: updateData })
      const updated = (updateResult && updateResult.stats && updateResult.stats.updated) || (updateResult && updateResult.updated) || 0
      if (updated <= 0) {
        return {
          success: false,
          error: { code: 'CLAIM_FAILED', message: '认领失败' }
        }
      }
      return { data: { ...existing, ...updateData } }
    }
    case 'delete': {
      // 删除会员 by openid
      return await collection.where({ openid }).remove()
    }
    case 'search': {
      const forbidden = await requireAdmin()
      if (forbidden) return forbidden
      // 支持按姓名或手机号模糊搜索，分页
      const query = []
      if (keyword) {
        query.push(
          _.or([
            { name: db.RegExp({ regexp: keyword, options: 'i' }) },
            { phone: db.RegExp({ regexp: keyword, options: 'i' }) }
          ])
        )
      }
      const result = await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      return {
        ...result,
        data: await resolveAvatarDisplayUrls(result.data || [])
      }
    }
    case 'list': {
      const forbidden = await requireAdmin()
      if (forbidden) return forbidden
      // 获取会员列表，支持状态过滤和分页
      const query = []
      if (data && data.status) {
        query.push({ status: data.status })
      }
      const result = await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      return {
        ...result,
        data: await resolveAvatarDisplayUrls(result.data || [])
      }
    }
    case 'updateById': {
      // 根据_id更新会员信息
      if (!_id) {
        return { errMsg: '_id is required' }
      }
      const forbidden = await requireAdmin()
      if (forbidden) return forbidden
      const payload = sanitizeAndTrimMemberPayload(data)
      const v = validateMemberData(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const now = db.serverDate()
      return await collection.doc(_id).update({
        data: {
          ...payload,
          updateTime: now
        }
      })
    }
    case 'deleteById': {
      // 根据_id删除会员
      if (!_id) {
        return { errMsg: '_id is required' }
      }
      const forbidden = await requireAdmin()
      if (forbidden) return forbidden
      return await collection.doc(_id).remove()
    }
    case 'getById': {
      if (!_id) {
        return { success: false, error: { code: 'MISSING_PARAM', message: '_id is required' } };
      }
      const result = await collection.doc(_id).get();
      return { data: publicMemberProfile(result.data) };
    }
    default:
      return { errMsg: 'invalid action' }
  }
}

exports.__test__ = {
  isAdminMember,
  publicMemberProfile
}
