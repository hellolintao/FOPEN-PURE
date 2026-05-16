function resolveOpponentIds(row, playerId) {
  const type = row && row.tournamentType
  const entries = (row && row.pointsAwarded && row.pointsAwarded.entries) || []

  if (type === 'singles') {
    if (!entries.some(entry => entry.memberId === playerId)) return []
    return entries
      .filter(entry => entry.memberId !== playerId)
      .map(entry => entry.memberId)
  }

  if (type === 'doubles') {
    const mine = entries.find(entry => entry.memberId === playerId)
    if (!mine) return []

    if (mine.team != null) {
      return entries
        .filter(entry => entry.team != null && entry.team !== mine.team)
        .map(entry => entry.memberId)
    }

    if (mine.role) {
      return entries
        .filter(entry => entry.memberId !== playerId && entry.role && entry.role !== mine.role)
        .map(entry => entry.memberId)
    }

    return []
  }

  return []
}

function toTimestamp(value) {
  if (!value) return null
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

function computeH2H(rows, playerId, membersMap) {
  const byOpponent = new Map()

  for (const row of rows || []) {
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    const mine = entries.find(entry => entry.memberId === playerId)
    if (!mine) continue

    const opponentIds = resolveOpponentIds(row, playerId)
    const playedAt = row.confirmedAt || row.createTime || null
    const playedAtTime = toTimestamp(playedAt)

    for (const opponentId of opponentIds) {
      const current = byOpponent.get(opponentId) || {
        memberId: opponentId,
        wins: 0,
        losses: 0,
        lastPlayedAt: null
      }

      if (mine.role === 'winner') current.wins += 1
      else if (mine.role === 'loser') current.losses += 1

      const currentTime = toTimestamp(current.lastPlayedAt)
      if (!current.lastPlayedAt || (playedAtTime != null && (currentTime == null || playedAtTime > currentTime))) {
        current.lastPlayedAt = playedAt
      }

      byOpponent.set(opponentId, current)
    }
  }

  return [...byOpponent.values()]
    .map(row => {
      const member = membersMap.get(row.memberId)
      return {
        memberId: row.memberId,
        name: (member && member.name) || row.memberId,
        avatarUrl: (member && member.avatarUrl) || '',
        wins: row.wins,
        losses: row.losses,
        lastPlayedAt: row.lastPlayedAt
      }
    })
    .sort((a, b) => {
      const aTotal = a.wins + a.losses
      const bTotal = b.wins + b.losses
      if (bTotal !== aTotal) return bTotal - aTotal
      return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0
    })
}

module.exports = { resolveOpponentIds, computeH2H }
