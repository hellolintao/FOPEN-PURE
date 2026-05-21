async function mySummary(ctx, payload) {
  const memberId = ctx.callerMemberId
  if (!memberId) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const historyLimit = Math.min(Math.max(parseInt(payload && payload.historyLimit, 10) || 10, 1), 50)

  const [pendingRows, submittedRows, confirmedRows] = await Promise.all([
    ctx.db.queryMyPending(memberId),
    ctx.db.queryMySubmitted(memberId),
    ctx.db.queryMyConfirmed(memberId, historyLimit),
  ])

  const tIds = [...new Set([...pendingRows, ...submittedRows, ...confirmedRows].map(r => r.tournamentId))]
  const tournamentDocs = tIds.length ? await ctx.db.getTournamentsByIds(tIds) : []
  const tMap = Object.fromEntries(tournamentDocs.map(t => [t._id, t]))

  function opponentLabel(m) {
    if (!m.player2) return ''
    if (m.player2.partnerName) return `${m.player2.name || '?'} / ${m.player2.partnerName}`
    return m.player2.name || ''
  }
  function partnerLabel(m) {
    if (m.player1 && m.player1.partnerName) return `${m.player1.name || '?'} / ${m.player1.partnerName}`
    return ''
  }
  function sumPoints(awarded) {
    if (!awarded || !Array.isArray(awarded.entries)) return 0
    return awarded.entries
      .filter(e => e.memberId === memberId)
      .reduce((s, e) => s + (e.points || 0), 0)
  }
  function includesMember(value) {
    if (!value) return false
    if (Array.isArray(value)) return value.includes(memberId)
    if (typeof value === 'string') return value.split(',').map(id => id.trim()).includes(memberId)
    if (typeof value === 'object') {
      return value.id === memberId ||
        value.partnerId === memberId ||
        includesMember(value.ids) ||
        includesMember(value.memberIds)
    }
    return false
  }
  function isWinner(m) {
    const entries = (m.pointsAwarded && Array.isArray(m.pointsAwarded.entries)) ? m.pointsAwarded.entries : []
    if (entries.some(e => e.memberId === memberId && e.role === 'winner')) return true
    if (entries.some(e => e.memberId === memberId && e.role === 'loser')) return false
    return includesMember(m.winner) || includesMember(m.winnerId) || includesMember(m.winnerIds)
  }

  return {
    pending: pendingRows.map(m => ({
      matchId: m._id,
      tournamentId: m.tournamentId,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      position: m.position,
      scheduledStart: m.scheduledStart || null,
      courtName: m.courtName || '',
      p1: m.player1 || {},
      p2: m.player2 || {},
      partnerLabel: partnerLabel(m),
      isDoubles: !!(m.player1 && m.player1.partnerName),
    })),
    submitted: submittedRows.map(m => ({
      matchId: m._id,
      tournamentId: m.tournamentId,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      score: m.score,
      submittedAt: m.submittedAt,
      opponentLabel: opponentLabel(m),
    })),
    confirmed: confirmedRows.map(m => ({
      matchId: m._id,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      score: m.score,
      isWinner: isWinner(m),
      pointsEarned: sumPoints(m.pointsAwarded),
      confirmedAt: m.confirmedAt,
    })),
  }
}

module.exports = { mySummary }
