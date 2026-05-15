async function finishedRecent(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 5, 1), 20)
  const rows = await ctx.db.listFinished(limit)
  return {
    items: rows.map(t => ({
      tournamentId: t._id,
      name: t.name,
      format: t.format,
      completedAt: t.completedAt,
      winnerLabel: t.winnerLabel || '',
    })),
  }
}

module.exports = { finishedRecent }
