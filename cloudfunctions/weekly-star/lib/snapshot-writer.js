function buildSnapshotRows({ ranked, week, seasonId, type, snapshotKind, computedAt }) {
  return ranked.map((entry, index) => ({
    _id: `rs_${seasonId}_${week.weekId}_${type}_${entry.memberId}`,
    seasonId,
    weekId: week.weekId,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    effectiveAt: week.end,
    type,
    memberId: entry.memberId,
    rank: index + 1,
    totalPoints: entry.totalPoints || 0,
    wins: entry.wins || 0,
    losses: entry.losses || 0,
    snapshotKind,
    computedAt
  }))
}

module.exports = { buildSnapshotRows }
