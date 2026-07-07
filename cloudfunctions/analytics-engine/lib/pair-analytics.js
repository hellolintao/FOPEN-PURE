const { pairAnalyticsId, pairKey } = require('./ids')
const { resultRoleForMember, sideMembers } = require('./teams')

function buildPairAnalytics({ seasonId, pairMemberIds, rows }) {
  const normalized = pairKey(pairMemberIds)
  const pairSet = new Set(normalized.memberIds)
  const pairRows = (rows || [])
    .filter(row => row && row.tournamentType === 'doubles' && row.resultStatus === 'confirmed')
    .filter(row => rowHasPair(row, pairSet))
    .sort((a, b) => timeOf(b) - timeOf(a))
  let wins = 0
  let losses = 0
  const matchups = new Map()
  for (const row of pairRows) {
    const role = resultRoleForMember(row, normalized.memberIds[0])
    if (role === 'winner') wins += 1
    else if (role === 'loser') losses += 1
    const opponent = opponentMembers(row, pairSet)
    if (opponent.length === 2) {
      const opponentKey = pairKey(opponent.map(member => member.memberId))
      const current = matchups.get(opponentKey.pairId) || {
        opponentPairId: opponentKey.pairId,
        opponentMemberIds: opponentKey.memberIds,
        wins: 0,
        losses: 0,
        lastPlayedAt: null
      }
      if (role === 'winner') current.wins += 1
      else if (role === 'loser') current.losses += 1
      if (!current.lastPlayedAt || timeOf(row) > timeOf({ confirmedAt: current.lastPlayedAt })) {
        current.lastPlayedAt = row.confirmedAt || row.createTime || null
      }
      matchups.set(opponentKey.pairId, current)
    }
  }
  return {
    _id: pairAnalyticsId(seasonId, normalized.memberIds),
    seasonId,
    pairId: normalized.pairId,
    memberIds: normalized.memberIds,
    matches: pairRows.length,
    wins,
    losses,
    winRate: pairRows.length > 0 ? wins / pairRows.length : 0,
    recentMatches: pairRows.slice(0, 5).map(row => ({ matchId: row._id, confirmedAt: row.confirmedAt || row.createTime || null })),
    matchups: [...matchups.values()].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || a.opponentPairId.localeCompare(b.opponentPairId)),
    updatedAt: new Date(),
    sourceVersion: 1
  }
}

function rowHasPair(row, pairSet) {
  return [row.player1, row.player2].some(side => {
    const ids = sideMembers(side).map(member => member.memberId)
    return ids.length === 2 && ids.every(id => pairSet.has(id))
  })
}

function opponentMembers(row, pairSet) {
  for (const side of [row.player1, row.player2]) {
    const members = sideMembers(side)
    if (members.length === 2 && members.every(member => !pairSet.has(member.memberId))) return members
  }
  return []
}

function timeOf(row) {
  return new Date((row && (row.confirmedAt || row.createTime)) || 0).getTime() || 0
}

module.exports = { buildPairAnalytics, rowHasPair, opponentMembers }
