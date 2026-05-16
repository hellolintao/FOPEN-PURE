const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const award = require('./lib/award')
const { aggregateRanks } = require('./lib/aggregate')
const { aggregateWeeklyPlayerDelta } = require('./lib/weekly-delta')
const { getCurrentNaturalWeek } = require('./lib/week-window')
const { enrichRecent } = require('./lib/player-stats')
const { computeH2H } = require('./lib/player-h2h')

exports.main = async (event) => {
  const { action } = event
  try {
    if (action === 'rankAggregate')    return await rankAggregate(event)
    if (action === 'recompute')        return await recompute(event)

    // 兼容 wrappers (旧前端契约保持)
    if (action === 'rankList')         return await rankListCompat(event)
    if (action === 'playerStats')      return await playerStatsCompat(event)
    if (action === 'playerH2H')        return await playerH2HCompat(event)
    if (action === 'recalculateMatch') return await recalculateMatchCompat(event)

    return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } }
  } catch (e) {
    console.error('[points-engine]', action, e)
    return { success: false, error: { code: 'INTERNAL', message: e.message } }
  }
}

// ─── New actions ────────────────────────────────────────────────

async function rankAggregate({ seasonId, type = 'singles', pageSize = 100 }) {
  if (!seasonId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId 必填' } }
  const list = await aggregateRanks({ db, seasonId, type, pageSize })
  return { success: true, data: { rankList: await joinMembers(list) } }
}

async function recompute({ tournamentId }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  const tRes = await db.collection('tournaments').doc(tournamentId).get()
  const t = tRes.data
  if (!t) return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }
  const rows = (await db.collection('match_results').where({ tournamentId, resultStatus: 'confirmed' }).limit(500).get()).data
  let count = 0
  for (const r of rows) {
    if (r.bye) continue
    const rule = (t.pointsRules && t.pointsRules.winLoss) || { win: 20, loss: 10, walkover: 0 }
    const entries = award.buildAwardEntries(r, rule, t.type)
    await replacePointsAwarded(r._id, { source: 'match', entries })
    count++
  }
  return { success: true, data: { count } }
}

// ─── Compat wrappers (旧前端 contract) ──────────────────────────

async function rankListCompat({ type = 'singles', currentSeasonId }) {
  if (!currentSeasonId) return { success: true, data: { rankList: [] } }
  const list = await aggregateRanks({ db, seasonId: currentSeasonId, type, pageSize: 100 })
  const joined = await joinMembers(list)
  const withWinRate = joined.map(row => {
    const matches = (row.winCount || 0) + (row.lossCount || 0)
    return { ...row, winRate: matches > 0 ? row.winCount / matches : 0 }
  })
  const memberIds = withWinRate.map(row => row._id)
  const snapshotMap = await fetchLatestSnapshotMap({ seasonId: currentSeasonId, type, memberIds })
  const out = withWinRate.map((row, i) => {
    const currentRank = i + 1
    const snap = snapshotMap.get(row._id)
    return { ...row, trendDelta: snap ? (snap.rank - currentRank) : null }
  })
  return { success: true, data: { rankList: out } }
}

async function fetchLatestSnapshotMap({ seasonId, type, memberIds }) {
  if (!memberIds || memberIds.length === 0) return new Map()
  const out = new Map()
  const chunkSize = 20
  for (let i = 0; i < memberIds.length; i += chunkSize) {
    const chunk = memberIds.slice(i, i + chunkSize)
    for (const memberId of chunk) {
      const res = await db.collection('rank_snapshots')
        .where({ seasonId, type, memberId })
        .orderBy('effectiveAt', 'desc')
        .orderBy('computedAt', 'desc')
        .limit(1)
        .get()
      const row = res && res.data && res.data[0]
      if (row) out.set(memberId, row)
    }
  }
  return out
}

async function fetchRankHistory({ seasonId, type, memberId, limit = 12 }) {
  if (!seasonId) return []
  const res = await db.collection('rank_snapshots')
    .where({ seasonId, type, memberId })
    .orderBy('weekStart', 'desc')
    .limit(limit)
    .get()
  const rows = (res && res.data) || []
  return rows
    .map(r => ({ weekStart: r.weekStart, rank: r.rank }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0))
}

async function playerStatsCompat({ playerId, currentSeasonId }) {
  if (!playerId) return { success: false, error: { code: 'INVALID_ARG', message: 'playerId 必填' } }
  const seasonId = currentSeasonId
  const buckets = {
    singles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 },
    doubles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 }
  }
  const currentRank = { singles: null, doubles: null }
  if (seasonId) {
    for (const t of ['singles', 'doubles']) {
      const list = await aggregateRanks({ db, seasonId, type: t, pageSize: 100 })
      const idx = list.findIndex(x => x.memberId === playerId)
      const me = idx >= 0 ? list[idx] : null
      if (me) {
        currentRank[t] = idx + 1
        const winCount = me.wins || 0
        const lossCount = me.losses || 0
        const matches = winCount + lossCount
        buckets[t] = {
          winCount,
          lossCount,
          totalPoints: me.totalPoints || 0,
          winRate: matches > 0 ? winCount / matches : 0
        }
      }
    }
  }
  // recent: 最近 10 场该选手参与的 confirmed match_results
  const rawRecent = await fetchRecentForPlayer(playerId)
  const tournamentIds = [...new Set(rawRecent.map(r => r.tournamentId).filter(Boolean))]
  const memberIds = [...new Set(rawRecent.flatMap(r => (
    ((r.pointsAwarded && r.pointsAwarded.entries) || []).map(e => e.memberId)
  )).filter(Boolean))]
  const [tRows, mRows] = await Promise.all([
    tournamentIds.length > 0
      ? db.collection('tournaments').where({ _id: _.in(tournamentIds) }).get().then(r => r.data || [])
      : Promise.resolve([]),
    memberIds.length > 0
      ? db.collection('members').where({ _id: _.in(memberIds) }).get().then(r => r.data || [])
      : Promise.resolve([])
  ])
  const tournamentsMap = new Map(tRows.map(t => [t._id, t]))
  const membersMap = new Map(mRows.map(m => [m._id, m]))
  const recent = enrichRecent(rawRecent, playerId, tournamentsMap, membersMap)
  const [rhSingles, rhDoubles] = await Promise.all([
    fetchRankHistory({ seasonId, type: 'singles', memberId: playerId }),
    fetchRankHistory({ seasonId, type: 'doubles', memberId: playerId })
  ])
  const rankHistory = { singles: rhSingles, doubles: rhDoubles }
  const week = getCurrentNaturalWeek()
  const [wsSingles, wsDoubles] = await Promise.all([
    aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId, week }),
    aggregateWeeklyPlayerDelta({ db, seasonId, type: 'doubles', playerId, week })
  ])
  const weeklySnapshot = { singles: wsSingles, doubles: wsDoubles }
  return { success: true, data: { stats: buckets, currentRank, rankHistory, weeklySnapshot, recent } }
}

async function playerH2HCompat({ playerId, currentSeasonId }) {
  if (!playerId) return { success: false, error: { code: 'INVALID_ARG', message: 'playerId 必填' } }

  const memberRes = await db.collection('members').doc(playerId).get().catch(() => ({ data: null }))
  if (!memberRes || !memberRes.data) {
    return { success: false, error: { code: 'NOT_FOUND', message: playerId } }
  }

  if (!currentSeasonId) return { success: true, data: { singles: [], doubles: [] } }

  let rows = []
  try {
    rows = (await db.collection('match_results')
      .where({ seasonId: currentSeasonId, resultStatus: 'confirmed', playerIds: _.in([playerId]) })
      .limit(1000)
      .get()).data || []
  } catch (e) {
    rows = []
  }

  const allOpponentIds = new Set()
  for (const row of rows) {
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    for (const entry of entries) {
      if (entry.memberId && entry.memberId !== playerId) allOpponentIds.add(entry.memberId)
    }
  }

  const membersMap = new Map()
  const ids = [...allOpponentIds]
  const chunkSize = 50
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const res = await db.collection('members').where({ _id: _.in(chunk) }).get()
    for (const member of (res.data || [])) membersMap.set(member._id, member)
  }

  const singlesRows = rows.filter(row => row.tournamentType === 'singles')
  const doublesRows = rows.filter(row => row.tournamentType === 'doubles')
  return {
    success: true,
    data: {
      singles: computeH2H(singlesRows, playerId, membersMap),
      doubles: computeH2H(doublesRows, playerId, membersMap)
    }
  }
}

async function recalculateMatchCompat({ matchId }) {
  if (!matchId) return { success: false, error: { code: 'INVALID_ARG', message: 'matchId 必填' } }
  // matchId 可能是 sourceMatchId（前端原意）或 doc _id；优先尝试 sourceMatchId 查找
  let row = null
  const bySource = await db.collection('match_results').where({ sourceMatchId: matchId }).limit(1).get()
  if (bySource.data && bySource.data.length > 0) {
    row = bySource.data[0]
  } else {
    const byDocId = await db.collection('match_results').doc(matchId).get().catch(() => ({ data: null }))
    row = byDocId.data
  }
  if (!row) return { success: false, error: { code: 'NOT_FOUND', message: matchId } }
  const tRes = await db.collection('tournaments').doc(row.tournamentId).get()
  const t = tRes.data
  if (!t) return { success: false, error: { code: 'NOT_FOUND', message: row.tournamentId } }
  const rule = (t.pointsRules && t.pointsRules.winLoss) || { win: 20, loss: 10, walkover: 0 }
  const entries = award.buildAwardEntries(row, rule, t.type)
  const pointsAwarded = { source: 'match', entries }
  await replacePointsAwarded(row._id, pointsAwarded)
  return { success: true, data: { pointsAwarded } }
}

// ─── Helpers ────────────────────────────────────────────────────

async function replacePointsAwarded(resultId, pointsAwarded) {
  if (_ && typeof _.remove === 'function') {
    await db.collection('match_results').doc(resultId).update({
      data: { pointsAwarded: _.remove() }
    })
  }
  await db.collection('match_results').doc(resultId).update({ data: { pointsAwarded } })
}

async function joinMembers(list) {
  if (!list || list.length === 0) return []
  const memberIds = list.map(x => x.memberId)
  const members = (await db.collection('members').where({ _id: _.in(memberIds) }).get()).data
  const memberMap = Object.fromEntries(members.map(m => [m._id, m]))
  return list.map(x => ({
    _id: x.memberId,
    name: (memberMap[x.memberId] && memberMap[x.memberId].name) || x.memberId,
    avatarUrl: (memberMap[x.memberId] && memberMap[x.memberId].avatarUrl) || '',
    totalPoints: x.totalPoints || 0,
    winCount: x.wins || 0,
    lossCount: x.losses || 0
  }))
}

async function fetchRecentForPlayer(playerId) {
  // Phase 8 写入 playerIds 扁平字段；也兼容旧 winnerId/loserId 路径
  let rows = []
  try {
    rows = (await db.collection('match_results')
      .where({ playerIds: _.in([playerId]), resultStatus: 'confirmed' })
      .orderBy('createTime', 'desc')
      .limit(10).get()).data
  } catch (e) {
    rows = []
  }
  if (rows && rows.length > 0) return rows
  // 兜底：旧 schema
  const winR = (await db.collection('match_results').where({ winnerId: playerId, resultStatus: 'confirmed' }).orderBy('createTime', 'desc').limit(10).get()).data
  const loseR = (await db.collection('match_results').where({ loserId: playerId, resultStatus: 'confirmed' }).orderBy('createTime', 'desc').limit(10).get()).data
  return [...winR, ...loseR].sort((a, b) => new Date(b.createTime) - new Date(a.createTime)).slice(0, 10)
}
