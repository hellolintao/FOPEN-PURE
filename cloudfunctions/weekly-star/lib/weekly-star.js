const { toPublicIdentity } = require('../../_shared/public-profile')

function getTime(row) {
  return new Date(row.confirmedAt || row.createTime || row.updateTime || 0).getTime()
}

function inWeek(row, week) {
  const t = getTime(row)
  return t >= week.start.getTime() && t <= week.end.getTime()
}

function add(map, memberId, points) {
  if (!memberId) return
  map[memberId] = (map[memberId] || 0) + (Number(points) || 0)
}

function topStar(map, membersById) {
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return null
  const [memberId, points] = sorted[0]
  const member = membersById[memberId] || {}
  const identity = toPublicIdentity(member, { rank: 1 })
  return {
    memberId,
    name: identity.name,
    avatarUrl: identity.avatarUrl,
    publicProfileVisible: identity.publicProfileVisible,
    points
  }
}

function computeWeeklyStarsFromRows({ week, matches, placementRows, members, seasonId }) {
  const buckets = { singles: {}, doubles: {} }

  for (const row of matches || []) {
    if (row.seasonId !== seasonId) continue
    if (row.resultStatus !== 'confirmed') continue
    if (!inWeek(row, week)) continue
    const type = row.tournamentType
    if (!buckets[type]) continue
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    for (const entry of entries) {
      add(buckets[type], entry.memberId, entry.points)
    }
  }

  for (const row of placementRows || []) {
    if (row.seasonId !== seasonId) continue
    if (!inWeek(row, week)) continue
    const type = row.tournamentType
    if (!buckets[type]) continue
    add(buckets[type], row.memberId, row.points)
  }

  const membersById = Object.fromEntries((members || []).map(member => [member._id, member]))
  return {
    _id: `${seasonId}_${week.weekId}`,
    seasonId,
    weekId: week.weekId,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    singlesStar: topStar(buckets.singles, membersById),
    doublesStar: topStar(buckets.doubles, membersById)
  }
}

module.exports = { computeWeeklyStarsFromRows }
