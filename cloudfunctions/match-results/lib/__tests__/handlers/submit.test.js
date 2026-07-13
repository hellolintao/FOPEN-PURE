const { confirmAll, reconfirmMatch, voidMatch } = require('../../handlers/submit')

function makeCtx(overrides = {}) {
  return {
    submitter: { _id: 'admin1', isAdmin: true },
    stateSvc: {
      confirmAll: jest.fn(async () => ({ confirmedCount: 2 })),
      reconfirmMatch: jest.fn(async () => ({ ok: true })),
    },
    afterSettlement: jest.fn(async ({ successIds }) => ({
      analyticsStatus: 'success',
      analyticsMessage: '排行榜已更新',
      settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }],
      refreshedMatchIds: successIds,
    })),
    afterSettlementByTournament: jest.fn(async ({ tournamentId }) => ({
      analyticsStatus: 'success',
      analyticsMessage: '排行榜已更新',
      settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }],
      refreshedTournamentId: tournamentId,
    })),
    ...overrides,
  }
}

test('reconfirmMatch returns analytics metadata without changing the success contract', async () => {
  const ctx = makeCtx()
  const result = await reconfirmMatch(ctx, { matchId: 'm1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null } })

  expect(ctx.afterSettlement).toHaveBeenCalledWith({ successIds: ['m1'], requestId: 'reconfirmMatch:m1' })
  expect(result).toMatchObject({ ok: true, analyticsStatus: 'success', analyticsMessage: '排行榜已更新' })
})

test('confirmAll refreshes analytics by tournament when confirmed rows are unknown', async () => {
  const ctx = makeCtx()
  const result = await confirmAll(ctx, { tournamentId: 't1' })

  expect(ctx.afterSettlementByTournament).toHaveBeenCalledWith({ tournamentId: 't1', requestId: 'confirmAll:t1' })
  expect(result).toMatchObject({ confirmedCount: 2, analyticsStatus: 'success' })
})

test('reconfirmMatch returns skipped analytics envelope when ctx.afterSettlement is missing', async () => {
  const ctx = makeCtx({ afterSettlement: undefined })
  const result = await reconfirmMatch(ctx, { matchId: 'm1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null } })

  expect(result).toMatchObject({
    ok: true,
    analyticsStatus: 'skipped',
    analyticsMessage: '',
    settlementImpact: [],
  })
})

test('confirmAll returns skipped analytics envelope when ctx.afterSettlementByTournament is missing', async () => {
  const ctx = makeCtx({ afterSettlementByTournament: undefined })
  const result = await confirmAll(ctx, { tournamentId: 't1' })

  expect(result).toMatchObject({
    confirmedCount: 2,
    analyticsStatus: 'skipped',
    analyticsMessage: '',
    settlementImpact: [],
  })
})

test('voidMatch checks score-write access before mutating a match', async () => {
  const err = new Error('赛程发布后才能录入成绩')
  err.code = 'SCHEDULE_NOT_PUBLISHED'
  const ctx = makeCtx({
    stateSvc: {
      assertSchedulePublishedForMatch: jest.fn(async () => { throw err }),
      voidMatch: jest.fn()
    }
  })

  await expect(voidMatch(ctx, { matchId: 'm1', reason: '未完赛' }))
    .rejects.toMatchObject({ code: 'SCHEDULE_NOT_PUBLISHED' })
  expect(ctx.stateSvc.assertSchedulePublishedForMatch).toHaveBeenCalledWith('m1')
  expect(ctx.stateSvc.voidMatch).not.toHaveBeenCalled()
})

test('confirmAll checks score-write access before confirming or settling a tournament', async () => {
  const err = new Error('赛程发布后才能录入成绩')
  err.code = 'SCHEDULE_NOT_PUBLISHED'
  const afterSettlementByTournament = jest.fn()
  const ctx = makeCtx({
    stateSvc: {
      assertSchedulePublishedForTournament: jest.fn(async () => { throw err }),
      confirmAll: jest.fn()
    },
    afterSettlementByTournament
  })

  await expect(confirmAll(ctx, { tournamentId: 't1' }))
    .rejects.toMatchObject({ code: 'SCHEDULE_NOT_PUBLISHED' })
  expect(ctx.stateSvc.assertSchedulePublishedForTournament).toHaveBeenCalledWith('t1')
  expect(ctx.stateSvc.confirmAll).not.toHaveBeenCalled()
  expect(afterSettlementByTournament).not.toHaveBeenCalled()
})
