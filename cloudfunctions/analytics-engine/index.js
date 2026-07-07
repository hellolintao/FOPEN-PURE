const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const { analyticsPlayerId, pairAnalyticsId, pairKey } = require('./lib/ids')
const { sideMembers } = require('./lib/teams')
const { buildPlayerAnalytics } = require('./lib/player-analytics')
const { buildPairAnalytics } = require('./lib/pair-analytics')
const { resolveAnalyticsIdentities } = require('./lib/identity')

exports.main = async (event = {}) => main(event)

async function main(event = {}) {
  const action = event.action || ''
  try {
    if (action === 'refreshAfterSettlement') return await refreshAfterSettlement(event)
    if (action === 'rebuildSeason') return await rebuildSeason(event)
    if (action === 'getPlayerAnalytics') return await getPlayerAnalytics(event)
    if (action === 'getPairAnalytics') return await getPairAnalytics(event)
    return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } }
  } catch (err) {
    await writeJob({
      jobType: action || 'unknown',
      seasonId: event.seasonId || '',
      status: 'failed',
      affectedMemberIds: event.affectedMemberIds || [],
      matchIds: event.matchIds || [],
      error: err.message || String(err)
    }).catch(() => null)
    return { success: false, error: { code: err.code || 'INTERNAL', message: err.message || String(err) } }
  }
}

async function refreshAfterSettlement({ seasonId, affectedMemberIds = [], matchIds = [] }) {
  if (!seasonId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId required' } }

  const affected = [...new Set((affectedMemberIds || []).filter(Boolean))]
  await ensureCollections()

  const rows = await fetchSeasonRows(seasonId)
  const membersById = await fetchMembersByIds([...new Set(rows.flatMap(row => row.playerIds || []))])

  const playerRows = []
  for (const memberId of affected) {
    const doc = buildPlayerAnalytics({
      seasonId,
      memberId,
      rows,
      membersById,
      rankRowsByType: { singles: [], doubles: [] }
    })
    await upsert('player_analytics', doc._id, doc)
    playerRows.push(doc)
  }

  const pairIds = collectAffectedPairs(rows, affected)
  const pairRows = []
  for (const pairMemberIds of pairIds) {
    const doc = buildPairAnalytics({ seasonId, pairMemberIds, rows, membersById })
    await upsert('pair_analytics', doc._id, doc)
    pairRows.push(doc)
  }

  await writeJob({
    jobType: 'refreshAfterSettlement',
    seasonId,
    status: 'success',
    affectedMemberIds: affected,
    matchIds,
    error: ''
  })

  return {
    success: true,
    data: {
      playerCount: playerRows.length,
      pairCount: pairRows.length,
      analyticsStatus: 'success'
    }
  }
}

async function rebuildSeason({ seasonId }) {
  if (!seasonId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId required' } }
  const rows = await fetchSeasonRows(seasonId)
  const affected = [...new Set(rows.flatMap(row => row.playerIds || []))]
  return refreshAfterSettlement({
    seasonId,
    affectedMemberIds: affected,
    matchIds: rows.map(row => row._id).filter(Boolean)
  })
}

async function getPlayerAnalytics({ seasonId, memberId }) {
  if (!seasonId || !memberId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId and memberId required' } }
  const res = await db.collection('player_analytics').doc(analyticsPlayerId(seasonId, memberId)).get().catch(() => ({ data: null }))
  if (!res.data) return { success: true, data: null }
  const membersById = await fetchMembersForAnalyticsDoc(res.data)
  return { success: true, data: resolveAnalyticsIdentities(res.data, membersById) }
}

async function getPairAnalytics({ seasonId, memberId }) {
  if (!seasonId || !memberId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId and memberId required' } }
  const rows = await db.collection('pair_analytics').where({ seasonId, memberIds: _.in([memberId]) }).limit(100).get()
  return { success: true, data: rows.data || [] }
}

async function fetchSeasonRows(seasonId) {
  const out = []
  const pageSize = 100
  let skip = 0
  while (true) {
    const page = (await db.collection('match_results')
      .where({ seasonId, resultStatus: 'confirmed' })
      .orderBy('createTime', 'asc')
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get()).data || []
    out.push(...page)
    if (page.length < pageSize) break
    skip += pageSize
  }
  return out
}

async function fetchMembersByIds(ids) {
  const out = new Map()
  const unique = [...new Set((ids || []).filter(Boolean))]
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const res = await db.collection('members').where({ _id: _.in(chunk) }).get()
    for (const member of (res.data || [])) out.set(member._id, member)
  }
  return out
}

function collectAffectedPairs(rows, affectedMemberIds) {
  const affected = new Set(affectedMemberIds)
  const map = new Map()
  for (const row of rows || []) {
    if (!row || row.tournamentType !== 'doubles') continue
    for (const side of [row.player1, row.player2]) {
      const ids = sideMembers(side).map(member => member.memberId)
      if (ids.length !== 2 || !ids.some(id => affected.has(id))) continue
      const normalized = pairKey(ids)
      map.set(normalized.pairId, normalized.memberIds)
    }
  }
  return [...map.values()]
}

async function upsert(collectionName, id, data) {
  const collection = db.collection(collectionName)
  const existing = await collection.doc(id).get().catch(() => ({ data: null }))
  if (existing && existing.data) {
    const { _id, ...patch } = data
    await collection.doc(id).update({ data: patch })
  } else {
    await collection.add({ data: { ...data, _id: id } })
  }
}

async function writeJob({ jobType, seasonId, status, affectedMemberIds, matchIds, error }) {
  const now = new Date()
  await db.collection('analytics_jobs').add({
    data: {
      _id: `analytics_${jobType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      jobType,
      seasonId,
      status,
      affectedMemberIds,
      matchIds,
      error,
      createTime: now,
      updateTime: now
    }
  })
}

async function ensureCollections() {
  if (!db || typeof db.createCollection !== 'function') return
  for (const name of ['player_analytics', 'pair_analytics', 'analytics_jobs']) {
    await db.createCollection(name).catch(() => null)
  }
}

async function fetchMembersForAnalyticsDoc(doc) {
  return fetchMembersByIds(collectMemberIdsFromAnalyticsDoc(doc))
}

function collectMemberIdsFromAnalyticsDoc(doc) {
  const ids = new Set()

  if (doc && doc.memberId) ids.add(doc.memberId)

  const visitTeam = team => (team || []).forEach(member => {
    if (member && member.memberId) ids.add(member.memberId)
  })
  const visitRows = rows => (rows || []).forEach(row => {
    visitTeam(row.subjectTeam)
    visitTeam(row.opponentTeam)
  })

  if (doc && doc.doubles) visitRows(doc.doubles.teamH2H)
  visitRows(doc && doc.recentMatches)

  return [...ids]
}

module.exports = { main, collectAffectedPairs }
