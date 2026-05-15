// migrated legacy: submit / confirmAll / reconfirmMatch
async function submit(ctx, event) {
  const submitter = ctx.submitter
  await ctx.stateSvc.submitResult({ matchId: event.matchId, score: event.score, submitter })
  return { ok: true }
}

async function confirmAll(ctx, event) {
  const admin = ctx.submitter
  const r = await ctx.stateSvc.confirmAll({ tournamentId: event.tournamentId, admin })
  return r
}

async function reconfirmMatch(ctx, event) {
  const admin = ctx.submitter
  await ctx.stateSvc.reconfirmMatch({ matchId: event.matchId, newScore: event.newScore, admin })
  return { ok: true }
}

module.exports = { submit, confirmAll, reconfirmMatch }
