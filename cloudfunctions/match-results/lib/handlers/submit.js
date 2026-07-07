// migrated legacy: submit / confirmAll / reconfirmMatch
async function runAfterSettlement(ctx, successIds, requestId) {
  if (!ctx || typeof ctx.afterSettlement !== 'function') {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  if (!Array.isArray(successIds) || successIds.length === 0) {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  try {
    return await ctx.afterSettlement({ successIds, requestId })
  } catch (err) {
    return { analyticsStatus: 'failed', analyticsMessage: '比分已确认，数据分析稍后重算', settlementImpact: [] }
  }
}

async function runAfterSettlementByTournament(ctx, tournamentId, requestId) {
  if (!ctx || typeof ctx.afterSettlementByTournament !== 'function') {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  if (!tournamentId) {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  try {
    return await ctx.afterSettlementByTournament({ tournamentId, requestId })
  } catch (err) {
    return { analyticsStatus: 'failed', analyticsMessage: '比分已确认，数据分析稍后重算', settlementImpact: [] }
  }
}

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
  const analytics = await runAfterSettlementByTournament(ctx, event.tournamentId, `confirmAll:${event.tournamentId}`)
  return { ...r, ...analytics }
}

async function reconfirmMatch(ctx, event) {
  const admin = ctx.submitter
  await assertSchedulePublishedForMatch(ctx, event.matchId)
  const r = await ctx.stateSvc.reconfirmMatch({ matchId: event.matchId, newScore: event.newScore, admin })
  const analytics = await runAfterSettlement(ctx, [event.matchId], `reconfirmMatch:${event.matchId}`)
  return { ok: true, ...(r || {}), ...analytics }
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
