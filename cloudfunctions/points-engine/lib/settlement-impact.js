function buildSettlementImpact({ type = '', beforeRankRows = [], afterRankRows = [], affectedMemberIds = [] } = {}) {
  const before = rankMap(beforeRankRows)
  const after = rankMap(afterRankRows)
  return [...new Set((affectedMemberIds || []).filter(Boolean))]
    .map(memberId => impactFor(type, memberId, before.get(memberId), after.get(memberId)))
    .filter(Boolean)
}

function rankMap(rows) {
  const map = new Map()
  ;(rows || []).forEach((row, index) => {
    const memberId = row && (row._id || row.memberId)
    if (!memberId) return
    map.set(memberId, {
      memberId,
      name: row.name || memberId,
      totalPoints: Number(row.totalPoints) || 0,
      rank: Number(row.rank) || index + 1
    })
  })
  return map
}

function impactFor(type, memberId, before, after) {
  if (!after) return null
  const pointsDelta = after.totalPoints - (before ? before.totalPoints : 0)
  const rankDelta = before ? before.rank - after.rank : null
  return {
    impactKey: `${type}:${memberId}`,
    type,
    typeLabel: ladderTypeLabel(type),
    memberId,
    name: after.name || (before && before.name) || memberId,
    pointsDelta,
    rankDelta,
    trendLabel: trendLabel(rankDelta)
  }
}

function ladderTypeLabel(type) {
  if (type === 'singles') return '单打'
  if (type === 'doubles') return '双打'
  return type || ''
}

function trendLabel(rankDelta) {
  if (rankDelta == null) return '首次进入榜单'
  if (rankDelta > 0) return `▲${rankDelta}`
  if (rankDelta < 0) return `▼${Math.abs(rankDelta)}`
  return '持平'
}

module.exports = { buildSettlementImpact }
