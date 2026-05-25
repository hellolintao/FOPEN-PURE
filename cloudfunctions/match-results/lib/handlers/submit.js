// migrated legacy: submit / confirmAll / reconfirmMatch
async function submit(ctx, event) {
  const submitter = ctx.submitter
  await assertSchedulePublishedForMatch(ctx, event.matchId)
  await ctx.stateSvc.submitResult({ matchId: event.matchId, score: event.score, submitter })
  return { ok: true }
}

async function confirmAll(ctx, event) {
  const admin = ctx.submitter
  await assertSchedulePublishedForTournament(ctx, event.tournamentId)
  const r = await ctx.stateSvc.confirmAll({ tournamentId: event.tournamentId, admin })
  return r
}

async function reconfirmMatch(ctx, event) {
  const admin = ctx.submitter
  await assertSchedulePublishedForMatch(ctx, event.matchId)
  await ctx.stateSvc.reconfirmMatch({ matchId: event.matchId, newScore: event.newScore, admin })
  return { ok: true }
}

async function voidMatch(ctx, event) {
  const admin = ctx.submitter
  return ctx.stateSvc.voidMatch({ matchId: event.matchId, reason: event.reason, admin })
}

async function assertSchedulePublishedForMatch(ctx, matchId) {
  if (ctx.stateSvc && typeof ctx.stateSvc.assertSchedulePublishedForMatch === 'function') {
    await ctx.stateSvc.assertSchedulePublishedForMatch(matchId)
  }
}

async function assertSchedulePublishedForTournament(ctx, tournamentId) {
  if (ctx.stateSvc && typeof ctx.stateSvc.assertSchedulePublishedForTournament === 'function') {
    await ctx.stateSvc.assertSchedulePublishedForTournament(tournamentId)
  }
}

module.exports = { submit, confirmAll, reconfirmMatch, voidMatch }
