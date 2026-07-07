const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COLLECTION_NAME = 'free_plays'
const collection = db.collection(COLLECTION_NAME)

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION_NAME)
  } catch (e) {
    // 已存在等错误忽略
  }
}

function generateId(tournamentId, courtId, order) {
  const prefix = (tournamentId || '').replace('tournament_', '')
  return `fp_${prefix}_${courtId}_${order}_${Date.now()}`
}

function fail(code, message) {
  return { success: false, error: { code, message } }
}

function ok(data) {
  return { success: true, data }
}

function isAdminMember(member) {
  return !!(member && (member.admin === true || member.isAdmin === true))
}

async function resolveMemberByOpenid(openid) {
  if (!openid) return null
  const query = _ && typeof _.or === 'function'
    ? _.or([{ openid }, { openId: openid }])
    : { openid }
  const res = await db.collection('members').where(query).get().catch(() => ({ data: [] }))
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

async function handleBulkSet({ tournamentId, items }) {
  if (!tournamentId) return fail('INVALID_ARG', 'tournamentId 必填')
  if (!Array.isArray(items)) return fail('INVALID_ARG', 'items 必须是数组')

  await ensureCollection()
  const existing = await collection.where({ tournamentId }).get().catch(() => ({ data: [] }))
  for (const doc of (existing.data || [])) {
    await collection.doc(doc._id).remove().catch(() => null)
  }

  const docs = items.map((it, i) => ({
    _id: it._id || generateId(tournamentId, it.courtId, it.queueOrder !== undefined ? it.queueOrder : i),
    tournamentId,
    courtId: it.courtId,
    queueOrder: it.queueOrder !== undefined ? it.queueOrder : i,
    playerIds: Array.isArray(it.playerIds) ? it.playerIds : [],
    createdBy: it.createdBy || null,
    createTime: db.serverDate()
  }))

  for (const d of docs) {
    await collection.add({ data: d }).catch(() => null)
  }

  return ok({ count: docs.length })
}

async function handleCreate({ tournamentId, courtId, queueOrder, playerIds, createdBy }) {
  if (!tournamentId) return fail('INVALID_ARG', 'tournamentId 必填')
  if (!courtId) return fail('INVALID_ARG', 'courtId 必填')
  await ensureCollection()
  const order = queueOrder !== undefined ? queueOrder : 0
  const _id = generateId(tournamentId, courtId, order)
  await collection.add({
    data: {
      _id,
      tournamentId,
      courtId,
      queueOrder: order,
      playerIds: Array.isArray(playerIds) ? playerIds : [],
      createdBy: createdBy || null,
      createTime: db.serverDate()
    }
  })
  return ok({ id: _id })
}

async function handleList({ tournamentId }) {
  if (!tournamentId) return fail('INVALID_ARG', 'tournamentId 必填')
  try {
    const res = await collection
      .where({ tournamentId })
      .orderBy('courtId', 'asc')
      .orderBy('queueOrder', 'asc')
      .get()
    return ok({ items: res.data || [] })
  } catch (e) {
    if (e && (e.errCode === -502005 || /not exist/i.test(e.errMsg || ''))) {
      return ok({ items: [] })
    }
    throw e
  }
}

async function handleRemove({ id }) {
  if (!id) return fail('INVALID_ARG', 'id 必填')
  await collection.doc(id).remove()
  return ok({ id })
}

exports.main = async (event) => {
  const { action } = event
  try {
    switch (action) {
      case 'bulkSet':
        {
          const adminGate = await requireAdmin()
          if (adminGate) return adminGate
        }
        return await handleBulkSet(event)
      case 'create':
        {
          const adminGate = await requireAdmin()
          if (adminGate) return adminGate
        }
        return await handleCreate(event)
      case 'list':
        return await handleList(event)
      case 'remove':
        {
          const adminGate = await requireAdmin()
          if (adminGate) return adminGate
        }
        return await handleRemove(event)
      default:
        return fail('UNKNOWN_ACTION', `未知 action: ${action}`)
    }
  } catch (e) {
    console.error('[free-plays] error', e)
    return fail('INTERNAL', e.message || 'internal error')
  }
}
