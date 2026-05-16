function deriveRoundLabel(tournament, round) {
  if (!tournament) return null
  if (tournament.format !== 'knockout') return null

  const total = tournament.totalRounds ||
    (tournament.config && tournament.config.totalRounds) ||
    (tournament.maxPlayers >= 2 ? Math.ceil(Math.log2(tournament.maxPlayers)) : 0)
  if (!round || total <= 0) return null

  const gap = total - round
  if (gap === 0) return 'F'
  if (gap === 1) return 'SF'
  if (gap === 2) return 'QF'
  return `R${round}`
}

function enrichRecent(rows, playerId, tournamentsMap, membersMap) {
  return (rows || []).map(row => {
    const tournament = tournamentsMap.get(row.tournamentId) || null
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    const mine = entries.find(e => e.memberId === playerId)
    const opponentEntry = row.tournamentType === 'doubles' && mine && mine.role
      ? entries.find(e => e.memberId !== playerId && e.role && e.role !== mine.role)
      : entries.find(e => e.memberId !== playerId)
    const opponentId = opponentEntry ? opponentEntry.memberId : null
    const opponentMember = opponentId ? membersMap.get(opponentId) : null

    return {
      _id: row._id,
      tournamentId: row.tournamentId,
      tournamentName: tournament ? (tournament.name || '') : '',
      tournamentFormat: tournament ? (tournament.format || null) : null,
      round: row.round,
      roundLabel: deriveRoundLabel(tournament, row.round),
      score: row.score || '',
      opponentId,
      opponentName: opponentMember ? (opponentMember.name || opponentId) : (opponentId || ''),
      won: mine ? mine.role === 'winner' : false,
      pointsAwarded: mine ? (mine.points || 0) : 0,
      createTime: row.createTime,
      confirmedAt: row.confirmedAt || null
    }
  })
}

module.exports = { deriveRoundLabel, enrichRecent }
