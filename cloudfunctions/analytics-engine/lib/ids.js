function analyticsPlayerId(seasonId, memberId) {
  return `pa_${seasonId}_${memberId}`
}

function pairKey(memberIds) {
  const filtered = (memberIds || []).filter(Boolean)
  if (filtered.length !== 2) {
    const err = new Error('PAIR_REQUIRES_TWO_MEMBERS')
    err.code = err.message
    throw err
  }
  const ids = [...new Set(filtered)].sort()
  if (ids.length !== 2) {
    const err = new Error('PAIR_REQUIRES_TWO_DISTINCT_MEMBERS')
    err.code = err.message
    throw err
  }
  return { pairId: `${ids[0]}__${ids[1]}`, memberIds: ids }
}

function pairAnalyticsId(seasonId, memberIds) {
  return `pair_${seasonId}_${pairKey(memberIds).pairId}`
}

module.exports = { analyticsPlayerId, pairKey, pairAnalyticsId }
