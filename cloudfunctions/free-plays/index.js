const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const collection = db.collection('free_plays')

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

async function handleBulkSet({ tournamentId, items }) {
  if (!tournamentId) return fail('INVALID_ARG', 'tournamentId 必填')
  if (!Array.isArray(items)) return fail('INVALID_ARG', 'items 必须是数组')

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
  const res = await collection
    .where({ tournamentId })
    .orderBy('courtId', 'asc')
    .orderBy('queueOrder', 'asc')
    .get()
  return ok({ items: res.data || [] })
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
        return await handleBulkSet(event)
      case 'create':
        return await handleCreate(event)
      case 'list':
        return await handleList(event)
      case 'remove':
        return await handleRemove(event)
      default:
        return fail('UNKNOWN_ACTION', `未知 action: ${action}`)
    }
  } catch (e) {
    console.error('[free-plays] error', e)
    return fail('INTERNAL', e.message || 'internal error')
  }
}
