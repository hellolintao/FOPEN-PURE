const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const COLLECTION_NAME = 'courts'
const collection = db.collection(COLLECTION_NAME)

async function ensureCollection() {
  try {
    await db.createCollection(COLLECTION_NAME)
  } catch (e) {
    // -501001 / "already exists" 等错误忽略；其他权限错误也吞掉，让真实操作再报
  }
}

function fail(code, message) {
  return { success: false, error: { code, message } }
}

function ok(data) {
  return { success: true, data }
}

function generateCourtId() {
  return `court_${Date.now()}_${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`
}

async function handleList() {
  try {
    const res = await collection
      .where({ enabled: true })
      .orderBy('createTime', 'asc')
      .get()
    return ok({ courts: res.data || [] })
  } catch (e) {
    // 集合不存在等错误下也返回空列表
    if (e && (e.errCode === -502005 || /not exist/i.test(e.errMsg || ''))) {
      return ok({ courts: [] })
    }
    throw e
  }
}

async function handleCreate({ name, location }) {
  if (!name || !String(name).trim()) return fail('INVALID_ARG', 'name 必填')
  await ensureCollection()
  const _id = generateCourtId()
  const now = db.serverDate()
  const doc = {
    _id,
    courtId: _id,
    name: String(name).trim(),
    location: location ? String(location).trim() : '',
    enabled: true,
    createTime: now,
    updateTime: now
  }
  await collection.add({ data: doc })
  return ok({ id: _id, court: doc })
}

async function handleUpdate({ id, data }) {
  if (!id) return fail('INVALID_ARG', 'id 必填')
  if (!data || typeof data !== 'object') return fail('INVALID_ARG', 'data 必填')
  const patch = { ...data, updateTime: db.serverDate() }
  // never allow overriding _id or courtId via patch
  delete patch._id
  delete patch.courtId
  await collection.doc(id).update({ data: patch })
  return ok({ id })
}

exports.main = async (event) => {
  const { action } = event
  try {
    switch (action) {
      case 'list':
        return await handleList()
      case 'create':
        return await handleCreate(event)
      case 'update':
        return await handleUpdate(event)
      default:
        return fail('UNKNOWN_ACTION', `未知 action: ${action}`)
    }
  } catch (e) {
    console.error('[courts] error', e)
    return fail('INTERNAL', e.message || 'internal error')
  }
}
