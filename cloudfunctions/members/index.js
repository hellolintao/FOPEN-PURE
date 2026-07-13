// 云函数入口文件
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('members')
const { toPublicIdentity } = require('../_shared/public-profile')

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
  'avatarUrl',
  'status',
  'admin',
  'playStyle',
  'publicProfileConsent'
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
  if (Object.prototype.hasOwnProperty.call(payload, 'publicProfileConsent')) {
    payload.publicProfileConsent = payload.publicProfileConsent === true
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
    publicProfileConsent,
    publicProfileConsentAt,
    ...publicProfile
  } = member
  const identity = toPublicIdentity(member)
  return {
    ...publicProfile,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    playStyle: identity.publicProfileVisible ? (publicProfile.playStyle || '') : '',
    publicProfileVisible: identity.publicProfileVisible
  }
}

function stripLegacyPhoneField(member) {
  if (!member) return member
  const safeMember = { ...member }
  delete safeMember.phone
  return safeMember
}

function withPublicProfileConsentMetadata(payload, now) {
  if (!Object.prototype.hasOwnProperty.call(payload, 'publicProfileConsent')) return payload
  return {
    ...payload,
    publicProfileConsentAt: payload.publicProfileConsent ? now : null
  }
}

function hasSelfServiceTarget(data, id) {
  data = normalizePayload(data)
  return !!(
    id ||
    data._id ||
    data.id ||
    data.memberId ||
    data.openid ||
    data.openId
  )
}

function isCloudFileId(value) {
  return typeof value === 'string' && value.startsWith('cloud://')
}

const DELETE_PAGE_SIZE = 100
const DELETED_MEMBER_ID = 'deleted-member'
const DELETED_MEMBER_NAME = '已删除用户'

function isMissingCollectionOrDocument(err) {
  const text = `${(err && (err.errMsg || err.message || err.code)) || ''}`
  return (err && err.errCode === -502005) ||
    /collection not exists|Db or Table not exist|not exist|document.*does not exist|not found/i.test(text)
}

function compactFilters(filters) {
  return filters.filter(Boolean)
}

function inFilter(values) {
  return _.in(Array.from(new Set(values.filter(Boolean))))
}

function stripDocumentId(row = {}) {
  const { _id, ...rest } = row
  return rest
}

function removedCount(result) {
  return (result && result.stats && result.stats.removed) || (result && result.removed) || 0
}

async function fetchDocs(collectionName, filter = {}, pageSize = DELETE_PAGE_SIZE) {
  const rows = []
  for (let skip = 0; ; skip += pageSize) {
    try {
      const res = await db.collection(collectionName)
        .where(filter)
        .skip(skip)
        .limit(pageSize)
        .get()
      const page = (res && res.data) || []
      rows.push(...page)
      if (page.length < pageSize) break
    } catch (err) {
      if (isMissingCollectionOrDocument(err)) return rows
      throw err
    }
  }
  return rows
}

async function fetchUniqueDocsByFilters(collectionName, filters) {
  const byId = new Map()
  for (const filter of compactFilters(filters)) {
    const rows = await fetchDocs(collectionName, filter)
    rows.forEach(row => {
      if (row && row._id && !byId.has(row._id)) byId.set(row._id, row)
    })
  }
  return Array.from(byId.values())
}

async function removeDocs(collectionName, docs) {
  let removed = 0
  for (const doc of docs || []) {
    if (!doc || !doc._id) continue
    try {
      const result = await db.collection(collectionName).doc(doc._id).remove()
      removed += removedCount(result) || 1
    } catch (err) {
      if (!isMissingCollectionOrDocument(err)) throw err
    }
  }
  return removed
}

async function removeDocsByFilters(collectionName, filters) {
  return removeDocs(collectionName, await fetchUniqueDocsByFilters(collectionName, filters))
}

async function removeAllDocs(collectionName) {
  return removeDocs(collectionName, await fetchDocs(collectionName, {}))
}

async function updateDocs(collectionName, docs, transform) {
  let updated = 0
  for (const doc of docs || []) {
    if (!doc || !doc._id) continue
    const data = transform(doc)
    try {
      await db.collection(collectionName).doc(doc._id).update({ data })
      updated += 1
    } catch (err) {
      if (!isMissingCollectionOrDocument(err)) throw err
    }
  }
  return updated
}

function targetIdentifiers(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [values]).filter(Boolean)))
}

function hasTargetIdentifier(value, identifiers) {
  return identifiers.includes(value)
}

function stringWithoutTargetIdentifiers(value, identifiers) {
  if (!hasTargetIdentifier(value, identifiers) && !(typeof value === 'string' && value.includes(','))) return value
  const parts = String(value).split(',').map(part => part.trim()).filter(Boolean)
  if (!parts.some(part => hasTargetIdentifier(part, identifiers))) return value
  return parts.map(part => hasTargetIdentifier(part, identifiers) ? DELETED_MEMBER_ID : part).join(',')
}

function anonymizeMemberReferences(value, identifiers) {
  identifiers = targetIdentifiers(identifiers)
  if (identifiers.length === 0 || value == null) return value
  if (typeof value === 'string') return stringWithoutTargetIdentifiers(value, identifiers)
  if (Array.isArray(value)) return value.map(item => anonymizeMemberReferences(item, identifiers))
  if (typeof value !== 'object') return value

  const out = {}
  for (const [key, child] of Object.entries(value)) {
    out[key] = anonymizeMemberReferences(child, identifiers)
  }

  const matchesPrimaryId = ['id', 'playerId', 'memberId', '_id', 'openid', 'openId', 'unionid'].some(key => hasTargetIdentifier(value[key], identifiers))
  const matchesPartnerId = hasTargetIdentifier(value.partnerId, identifiers)
  if (matchesPrimaryId || matchesPartnerId) {
    for (const key of ['id', 'playerId', 'memberId', '_id', 'partnerId', 'openid', 'openId', 'unionid']) {
      if (hasTargetIdentifier(out[key], identifiers)) out[key] = DELETED_MEMBER_ID
    }
    for (const key of ['name', 'playerName', 'memberName', 'nickName', 'nickname', 'partnerName', 'teamName']) {
      if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = DELETED_MEMBER_NAME
    }
    for (const key of ['avatarUrl', 'playerAvatarUrl', 'memberAvatarUrl', 'partnerAvatarUrl']) {
      if (Object.prototype.hasOwnProperty.call(out, key)) out[key] = ''
    }
    if (Object.prototype.hasOwnProperty.call(out, 'publicProfileVisible')) out.publicProfileVisible = false
    if (Object.prototype.hasOwnProperty.call(out, 'partnerPublicProfileVisible')) out.partnerPublicProfileVisible = false
  }
  return out
}

function valueContainsTargetIdentifier(value, identifiers) {
  identifiers = targetIdentifiers(identifiers)
  if (identifiers.length === 0 || value == null) return false
  if (typeof value === 'string') {
    if (hasTargetIdentifier(value, identifiers)) return true
    if (value.includes(',')) {
      return value.split(',').map(part => part.trim()).some(part => hasTargetIdentifier(part, identifiers))
    }
    return false
  }
  if (Array.isArray(value)) return value.some(item => valueContainsTargetIdentifier(item, identifiers))
  if (typeof value === 'object') return Object.values(value).some(item => valueContainsTargetIdentifier(item, identifiers))
  return false
}

function selfDataFilters(memberId, openid) {
  return compactFilters([
    memberId && { memberId },
    memberId && { playerId: memberId },
    memberId && { partnerId: memberId },
    memberId && { playerIds: inFilter([memberId]) },
    memberId && { memberIds: inFilter([memberId]) },
    openid && { openid },
    openid && { openId: openid }
  ])
}

async function deleteCloudAvatar(member) {
  const avatarUrl = member && member.avatarUrl
  if (!isCloudFileId(avatarUrl) || typeof cloud.deleteFile !== 'function') return 0
  try {
    await cloud.deleteFile({ fileList: [avatarUrl] })
    return 1
  } catch (err) {
    console.warn('[members] delete avatar file failed', err)
    return 0
  }
}

async function deleteSelfData(openid) {
  const member = await resolveCallerMember()
  const memberId = member && member._id
  const identifiers = targetIdentifiers([memberId, openid])
  const summary = {
    avatarFilesDeleted: await deleteCloudAvatar(member),
    registrationsRemoved: await removeDocsByFilters('tournament_registrations', selfDataFilters(memberId, openid)),
    matchResultsAnonymized: 0,
    tournamentBracketsAnonymized: 0,
    tournamentPointsRemoved: await removeDocsByFilters('tournament_points', selfDataFilters(memberId, openid)),
    rankSnapshotsRemoved: await removeDocsByFilters('rank_snapshots', selfDataFilters(memberId, openid)),
    rankCacheRemoved: await removeAllDocs('rank_cache'),
    weeklyStarsRemoved: await removeAllDocs('weekly_stars'),
    memberRemoved: 0
  }

  if (identifiers.length > 0) {
    const matchDocs = (await fetchDocs('match_results', {}))
      .filter(row => valueContainsTargetIdentifier(row, identifiers))
    summary.matchResultsAnonymized = await updateDocs('match_results', matchDocs, row => stripDocumentId(anonymizeMemberReferences(row, identifiers)))
  }

  if (memberId) {
    const bracketDocs = (await fetchDocs('tournament_brackets', {}))
      .filter(row => valueContainsTargetIdentifier(row, [memberId]))
    summary.tournamentBracketsAnonymized = await updateDocs('tournament_brackets', bracketDocs, row => stripDocumentId(anonymizeMemberReferences(row, identifiers)))
  }

  summary.memberRemoved = await removeDocsByFilters('members', compactFilters([
    memberId && { _id: memberId },
    openid && { openid },
    openid && { openId: openid }
  ]))
  return { success: true, data: summary }
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

async function resolveSafeMemberRows(members = []) {
  return await resolveAvatarDisplayUrls((members || []).map(stripLegacyPhoneField))
}

function contentSecurityFailure(code, message) {
  return {
    success: false,
    error: {
      code,
      message
    }
  }
}

function contentRiskFailure() {
  return contentSecurityFailure('CONTENT_SECURITY_RISK', '发布内容含违规信息')
}

function contentCheckUnavailableFailure(message) {
  return contentSecurityFailure('CONTENT_SECURITY_UNAVAILABLE', message || '内容安全检测失败，请稍后重试')
}

function isSecurityOpenApiAvailable(methodName) {
  return !!(
    cloud.openapi &&
    cloud.openapi.security &&
    typeof cloud.openapi.security[methodName] === 'function'
  )
}

function getSecurityErrorCode(value) {
  if (!value) return null
  const rawCode = value.errCode !== undefined ? value.errCode : value.errcode
  if (rawCode === undefined || rawCode === null || rawCode === '') return null
  const code = Number(rawCode)
  return Number.isFinite(code) ? code : null
}

function isContentRiskCode(code) {
  return Number(code) === 87014
}

function hasSecurityApiError(result) {
  const code = getSecurityErrorCode(result)
  return code !== null && code !== 0
}

function hasUnsafeSecurityResult(result) {
  const suggest = result && result.result && result.result.suggest
  return !!(suggest && suggest !== 'pass')
}

async function checkProfileTextContent(content, openid) {
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) return { success: true }
  if (!openid) {
    return contentSecurityFailure('MEMBER_REQUIRED', '请先登录')
  }
  if (!isSecurityOpenApiAvailable('msgSecCheck')) {
    return contentCheckUnavailableFailure()
  }

  try {
    const result = await cloud.openapi.security.msgSecCheck({
      openid,
      scene: 1,
      version: 2,
      content: text
    })
    const errCode = getSecurityErrorCode(result)
    if (isContentRiskCode(errCode)) {
      return contentRiskFailure()
    }
    if (hasSecurityApiError(result)) {
      return contentCheckUnavailableFailure()
    }
    if (hasUnsafeSecurityResult(result)) {
      return contentRiskFailure()
    }
    return { success: true, data: result }
  } catch (err) {
    if (isContentRiskCode(getSecurityErrorCode(err))) {
      return contentRiskFailure()
    }
    console.warn('[members] profile text content security check failed', err)
    return contentCheckUnavailableFailure()
  }
}

function inferImageContentType(fileID) {
  const extMatch = String(fileID || '').toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/)
  const ext = extMatch ? extMatch[1] : ''
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/jpeg'
}

function normalizeFileContent(fileContent) {
  if (Buffer.isBuffer(fileContent)) return fileContent
  if (fileContent instanceof ArrayBuffer) return Buffer.from(fileContent)
  if (ArrayBuffer.isView(fileContent)) {
    return Buffer.from(fileContent.buffer, fileContent.byteOffset, fileContent.byteLength)
  }
  return null
}

async function downloadCloudFileContent(fileID) {
  if (typeof cloud.downloadFile !== 'function') return null
  const result = await cloud.downloadFile({ fileID })
  return normalizeFileContent(result && (result.fileContent || result.buffer))
}

async function checkAvatarFileContent(fileID, openid) {
  if (!isCloudFileId(fileID)) return { success: true }
  if (!openid) {
    return contentSecurityFailure('MEMBER_REQUIRED', '请先登录')
  }
  if (!isSecurityOpenApiAvailable('imgSecCheck')) {
    return contentCheckUnavailableFailure('头像安全检测失败，请稍后重试')
  }

  let fileContent = null
  try {
    fileContent = await downloadCloudFileContent(fileID)
  } catch (err) {
    console.warn('[members] download avatar file for content security failed', err)
  }
  if (!fileContent) {
    return contentCheckUnavailableFailure('头像安全检测失败，请稍后重试')
  }

  try {
    const result = await cloud.openapi.security.imgSecCheck({
      media: {
        contentType: inferImageContentType(fileID),
        value: fileContent
      }
    })
    const errCode = getSecurityErrorCode(result)
    if (isContentRiskCode(errCode)) {
      return contentRiskFailure()
    }
    if (hasSecurityApiError(result)) {
      return contentCheckUnavailableFailure('头像安全检测失败，请稍后重试')
    }
    if (hasUnsafeSecurityResult(result)) {
      return contentRiskFailure()
    }
    return {
      success: true,
      data: {
        checked: true
      }
    }
  } catch (err) {
    if (isContentRiskCode(getSecurityErrorCode(err))) {
      return contentRiskFailure()
    }
    console.warn('[members] avatar content security check failed', err)
    return contentCheckUnavailableFailure('头像安全检测失败，请稍后重试')
  }
}

async function validateProfileContent(payload, openid) {
  const textCheck = await checkProfileTextContent(payload && payload.name, openid)
  if (textCheck.success === false) return textCheck

  const avatarCheck = await checkAvatarFileContent(payload && payload.avatarUrl, openid)
  if (avatarCheck.success === false) return avatarCheck

  return { success: true }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, data, page = 1, pageSize = 10, keyword, _id } = event

  switch (action) {
    case 'add': {
      // 新增会员，openid唯一
      let payload = stripSelfServiceOnlyFields(sanitizeAndTrimMemberPayload(data))
      const v = validateMemberAdd(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const exist = await collection.where({ openid }).get()
      if (exist.data && exist.data.length > 0) {
        return { errMsg: 'already registered', data: stripLegacyPhoneField(exist.data[0]) }
      }
      const contentCheck = await validateProfileContent(payload, openid)
      if (contentCheck.success === false) return contentCheck
      const now = db.serverDate()
      payload = withPublicProfileConsentMetadata(payload, now)
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
        return { data: stripLegacyPhoneField(claimedMember) }
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
      const result = await collection.where(_.or([
        { openid },
        { openId: openid }
      ])).get()
      return {
        ...result,
        data: (result.data || []).map(stripLegacyPhoneField)
      }
    }
    case 'update': {
      // 更新会员信息 by openid
      let payload = stripSelfServiceOnlyFields(sanitizeAndTrimMemberPayload(data))
      const v = validateMemberData(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const contentCheck = await validateProfileContent(payload, openid)
      if (contentCheck.success === false) return contentCheck
      const now = db.serverDate()
      payload = withPublicProfileConsentMetadata(payload, now)
      return await collection.where({ openid }).update({
        data: {
          ...payload,
          updateTime: now
        }
      })
    }
    case 'claimSelf': {
      let payload = stripSelfServiceOnlyFields(sanitizeAndTrimMemberPayload(data))
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
      const contentCheck = await validateProfileContent(payload, openid)
      if (contentCheck.success === false) return contentCheck
      const now = db.serverDate()
      payload = withPublicProfileConsentMetadata(payload, now)
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
      return { data: stripLegacyPhoneField({ ...existing, ...updateData }) }
    }
    case 'checkAvatarContent': {
      const fileID = data && (data.fileID || data.avatarUrl)
      if (!fileID) {
        return { success: false, error: { code: 'MISSING_PARAM', message: 'fileID is required' } }
      }
      return await checkAvatarFileContent(fileID, openid)
    }
    case 'revokePublicProfile': {
      if (!openid) {
        return { success: false, error: { code: 'MEMBER_REQUIRED', message: '请先登录' } }
      }
      const now = db.serverDate()
      return await collection.where({ openid }).update({
        data: {
          publicProfileConsent: false,
          publicProfileConsentAt: null,
          updateTime: now
        }
      })
    }
    case 'delete': {
      // 删除会员 by openid
      if (!openid) {
        return { success: false, error: { code: 'MEMBER_REQUIRED', message: '请先登录' } }
      }
      if (hasSelfServiceTarget(data, _id)) {
        return {
          success: false,
          error: { code: 'SELF_SCOPE_ONLY', message: '只能删除当前账号资料' }
        }
      }
      return await collection.where({ openid }).remove()
    }
    case 'deleteSelf': {
      if (!openid) {
        return { success: false, error: { code: 'MEMBER_REQUIRED', message: '请先登录' } }
      }
      return await deleteSelfData(openid)
    }
    case 'search': {
      const forbidden = await requireAdmin()
      if (forbidden) return forbidden
      // 支持按昵称模糊搜索，分页
      const query = []
      if (keyword) {
        query.push({ name: db.RegExp({ regexp: keyword, options: 'i' }) })
      }
      const result = await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
      return {
        ...result,
        data: await resolveSafeMemberRows(result.data || [])
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
        data: await resolveSafeMemberRows(result.data || [])
      }
    }
    case 'updateById': {
      // 根据_id更新会员信息
      if (!_id) {
        return { errMsg: '_id is required' }
      }
      const forbidden = await requireAdmin()
      if (forbidden) return forbidden
      let payload = sanitizeAndTrimMemberPayload(data)
      const v = validateMemberData(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const contentCheck = await validateProfileContent(payload, openid)
      if (contentCheck.success === false) return contentCheck
      const now = db.serverDate()
      payload = withPublicProfileConsentMetadata(payload, now)
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
