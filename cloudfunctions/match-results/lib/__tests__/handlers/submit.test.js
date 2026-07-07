const { confirmAll, reconfirmMatch } = require('../../handlers/submit')

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
