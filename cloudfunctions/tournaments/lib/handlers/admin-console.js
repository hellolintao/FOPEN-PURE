async function adminConsoleSnapshot(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  try {
    const [pending, drafts, ongoing] = await Promise.all([
      ctx.db.aggregateSubmitted(),
      ctx.db.listDrafts(ctx.callerMemberId),
      ctx.db.listOngoing(),
    ])
    const total = pending.reduce((s, p) => s + (p.count || 0), 0)
    return {
      pendingConfirm: { total, byTournament: pending },
      myDrafts: drafts,
      ongoing,
    }
  } catch (e) {
    const err = new Error('SNAPSHOT_FAILED')
    err.code = 'SNAPSHOT_FAILED'
    err.cause = e.message
    throw err
  }
}

module.exports = { adminConsoleSnapshot }
