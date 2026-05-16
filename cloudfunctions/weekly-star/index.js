const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { getPreviousNaturalWeek, getCurrentNaturalWeek, getWeekId, toDateKey } = require('./lib/week-window')
const { resolveCurrentWeeklyStar } = require('./lib/current')
const { computeWeeklyStarsFromRows } = require('./lib/weekly-star')
const { buildSnapshotRows } = require('./lib/snapshot-writer')
const { aggregateRanks } = require('./lib/aggregate')

exports.main = async (event = {}) => {
  const action = event.action || 'compute'
  try {
    if (action === 'current') return await current(event)
    if (action === 'latest') return await latest(event)
    if (action === 'compute') return await compute(event)
    if (action === 'recomputeRankSnapshots') return await recomputeRankSnapshots(event)
    return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } }
  } catch (err) {
    console.error('[weekly-star]', action, err)
    return { success: false, error: { code: 'INTERNAL', message: err.message } }
  }
}

async function latest({ seasonId = `season_${new Date().getFullYear()}` }) {
  const rows = (await db.collection('weekly_stars')
    .where({ seasonId })
    .orderBy('weekStart', 'desc')
    .limit(1)
    .get()).data
  return { success: true, data: rows[0] || null }
}

async function current({ seasonId = `season_${new Date().getFullYear()}`, type = 'singles', now }) {
  if (type !== 'singles' && type !== 'doubles') {
    return { success: false, error: { code: 'INVALID_PAYLOAD', message: 'type must be singles|doubles' } }
  }
  const week = getCurrentNaturalWeek(now ? new Date(now) : new Date())
  const data = await resolveCurrentWeeklyStar({ db, seasonId, type, week })
  return { success: true, data }
}

async function recomputeRankSnapshots({ seasonId = `season_${new Date().getFullYear()}`, weekStart, baseline = false, now }) {
  const admin = await resolveAdmin()
  if (!admin) return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } }

  const computedAt = new Date(now || Date.now())
  let week
  if (baseline) {
    const day = toDateKey(computedAt)
    week = { weekId: `baseline_${day}`, weekStart: day, weekEnd: day, end: computedAt }
  } else {
    if (!weekStart) {
      return { success: false, error: { code: 'INVALID_PAYLOAD', message: 'weekStart required when baseline=false' } }
    }
    const start = new Date(weekStart)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    week = { weekId: getWeekId(start), weekStart: toDateKey(start), weekEnd: toDateKey(end), end }
  }

  let totalRows = 0
  for (const type of ['singles', 'doubles']) {
    const ranked = await aggregateRanks({ db, seasonId, type, asOf: baseline ? null : week.end })
    const rows = buildSnapshotRows({
      ranked,
      week,
      seasonId,
      type,
      snapshotKind: baseline ? 'baseline' : 'weekly',
      computedAt
    })
    for (const row of rows) {
      await upsert('rank_snapshots', row._id, row)
    }
    totalRows += rows.length
  }
  return { success: true, data: { weekId: week.weekId, totalRows } }
}

async function resolveAdmin() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) return null
  const res = await db.collection('members').where({ openid }).get()
  const member = res && res.data && res.data[0]
  if (!member) return null
  const isAdmin = typeof member.admin === 'boolean' ? member.admin : !!member.isAdmin
  return isAdmin ? member : null
}

async function compute({ seasonId = `season_${new Date().getFullYear()}`, now }) {
  const week = getPreviousNaturalWeek(now ? new Date(now) : new Date())
  const [matches, placementRows] = await Promise.all([
    fetchAll('match_results', { seasonId, resultStatus: 'confirmed' }),
    fetchTournamentPoints(seasonId, week)
  ])

  const memberIds = Array.from(new Set([
    ...matches.flatMap(row => ((row.pointsAwarded && row.pointsAwarded.entries) || []).map(entry => entry.memberId)),
    ...placementRows.map(row => row.memberId)
  ].filter(Boolean)))
  const members = await fetchMembersByIds(memberIds)

  const doc = {
    ...computeWeeklyStarsFromRows({ week, matches, placementRows, members, seasonId }),
    computedAt: db.serverDate()
  }

  await upsert('weekly_stars', doc._id, doc)
  const computedAt = new Date()
  for (const type of ['singles', 'doubles']) {
    const ranked = await aggregateRanks({ db, seasonId, type, asOf: week.end })
    const rows = buildSnapshotRows({ ranked, week, seasonId, type, snapshotKind: 'weekly', computedAt })
    for (const row of rows) {
      await upsert('rank_snapshots', row._id, row)
    }
  }
  return { success: true, data: doc }
}

async function fetchTournamentPoints(seasonId, week) {
  try {
    return await fetchAll('tournament_points', {
      seasonId,
      createTime: _.gte(week.start).and(_.lte(week.end))
    })
  } catch (err) {
    const msg = `${err.errMsg || err.message || err.code || ''}`
    if ((err && err.errCode === -502005) || /collection not exists|Db or Table not exist|not exist|collection/i.test(msg)) return []
    throw err
  }
}

async function fetchAll(collectionName, filter, pageSize = 100) {
  const out = []
  for (let skip = 0; skip < 5000; skip += pageSize) {
    const page = (await db.collection(collectionName).where(filter).skip(skip).limit(pageSize).get()).data || []
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

async function fetchMembersByIds(memberIds, chunkSize = 20) {
  if (!memberIds || memberIds.length === 0) return []
  const out = []
  for (let i = 0; i < memberIds.length; i += chunkSize) {
    const chunk = memberIds.slice(i, i + chunkSize)
    const rows = (await db.collection('members').where({ _id: _.in(chunk) }).get()).data || []
    out.push(...rows)
  }
  return out
}

async function upsert(collectionName, id, data) {
  const collection = db.collection(collectionName)
  const existing = await collection.doc(id).get().catch(() => null)
  if (existing && existing.data) {
    await collection.doc(id).update({ data })
    return
  }
  await collection.add({ data: { ...data, _id: id } })
}
