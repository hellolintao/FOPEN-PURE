// query handlers: submittedQueue / listByTournament / listByPlayer / pendingReviewItems
async function submittedQueue(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
async function listByTournament(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
async function listByPlayer(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}

async function pendingReviewItems(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const tournamentId = (payload && payload.tournamentId) || null
  const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 50, 1), 100)

  const total = await ctx.db.countMatchResults({ resultStatus: 'submitted', tournamentId })
  const rows = await ctx.db.queryMatchResults({ resultStatus: 'submitted', tournamentId, limit })

  const tournamentIds = [...new Set(rows.map(r => r.tournamentId))]
  const tournamentDocs = await ctx.db.getTournamentsByIds(tournamentIds)
  const tMap = Object.fromEntries(tournamentDocs.map(t => [t._id, t]))

  const submitterIds = [...new Set(rows.map(r => r.submittedBy).filter(Boolean))]
  const memberDocs = submitterIds.length ? await ctx.db.getMembersByIds(submitterIds) : []
  const mMap = Object.fromEntries(memberDocs.map(m => [m._id, m]))

  const items = rows.map(r => ({
    matchId: r._id,
    tournamentId: r.tournamentId,
    tournamentName: tMap[r.tournamentId] && tMap[r.tournamentId].name || r.tournamentId,
    round: r.round,
    position: r.position,
    scheduledStartLabel: r.scheduledStart ? formatTime(r.scheduledStart) : '',
    courtName: r.courtName || '',
    p1: r.player1 || {},
    p2: r.player2 || {},
    score: r.score || null,
    isDoubles: !!(r.player1 && r.player1.partnerName),
    submitter: r.submittedBy && mMap[r.submittedBy]
      ? { memberId: r.submittedBy, name: mMap[r.submittedBy].name }
      : null,
    submittedAt: r.submittedAt || null,
    updateTime: r.updateTime,
  }))

  return { items, truncated: total > limit }
}

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

module.exports = { submittedQueue, listByTournament, listByPlayer, pendingReviewItems }
