const { mySummary } = require('../../handlers/my-summary')

function makeCtx({ memberId = 'mA', allMatches = [], tournaments = {} } = {}) {
  return {
    callerMemberId: memberId,
    db: {
      queryMyPending: async (mid) => allMatches.filter(m =>
        m.resultStatus === 'pending' &&
        (m.playerIds || []).includes(mid)
      ),
      queryMySubmitted: async (mid) => allMatches.filter(m =>
        m.resultStatus === 'submitted' &&
        (m.playerIds || []).includes(mid)
      ),
      queryMyConfirmed: async (mid, limit) => allMatches.filter(m =>
        m.resultStatus === 'confirmed' &&
        (m.playerIds || []).includes(mid)
      ).slice(0, limit),
      getTournamentsByIds: async (ids) => ids.map(id => tournaments[id]).filter(Boolean),
    },
  }
}

test('mySummary returns three buckets', async () => {
  const ctx = makeCtx({
    allMatches: [
      { _id: 'mr_p', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mA', 'mB'], round: 'R1', position: 1, player1: { name: '我' }, player2: { name: '对手' } },
      { _id: 'mr_s', tournamentId: 't1', resultStatus: 'submitted', playerIds: ['mA', 'mB'], round: 'R1', position: 2, score: { sets: [{ a: 4, b: 2 }] }, submittedAt: new Date() },
      { _id: 'mr_c', tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'], round: 'R2', position: 1, score: { sets: [{ a: 4, b: 0 }] },
        pointsAwarded: { entries: [{ memberId: 'mA', points: 15, role: 'winner' }] }, confirmedAt: new Date() },
    ],
    tournaments: { t1: { _id: 't1', name: 'XXX 杯' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending).toHaveLength(1)
  expect(result.submitted).toHaveLength(1)
  expect(result.confirmed).toHaveLength(1)
  expect(result.confirmed[0].pointsEarned).toBe(15)
})

test('mySummary pending matches partnerId', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      { _id: 'mr_p', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mX', 'mY', 'mA'], round: 'R1', position: 1, player1: {}, player2: {} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending).toHaveLength(1)
})

test('mySummary confirmed pointsEarned aggregates only my entries', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      { _id: 'mr_c', tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'], round: 'F', position: 1, score: {},
        pointsAwarded: { entries: [
          { memberId: 'mA', points: 15, role: 'winner' },
          { memberId: 'mA', points: 5, role: 'placement' },
          { memberId: 'mB', points: 8, role: 'loser' },
        ]} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.confirmed[0].pointsEarned).toBe(20)  // 15 + 5
})

test('mySummary treats admin caller as player and does not include non-participant pending admin work', async () => {
  const ctx = makeCtx({
    memberId: 'admin1',
    allMatches: [
      { _id: 'mine_pending', tournamentId: 't1', resultStatus: 'pending', playerIds: ['admin1', 'mA'], round: 1, position: 1, player1: { name: 'Admin' }, player2: { name: 'A' } },
      { _id: 'other_submitted', tournamentId: 't1', resultStatus: 'submitted', playerIds: ['mB', 'mC'], round: 1, position: 2, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
    ],
    tournaments: { t1: { _id: 't1', name: 'E2E' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending.map(x => x.matchId)).toEqual(['mine_pending'])
  expect(result.submitted).toEqual([])
})

test('mySummary respects historyLimit', async () => {
  const matches = Array.from({ length: 15 }).map((_, i) => ({
    _id: `mr_${i}`, tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'],
    round: 'R1', position: i, score: {}, pointsAwarded: { entries: [] }, confirmedAt: new Date(),
  }))
  const ctx = makeCtx({ allMatches: matches, tournaments: { t1: { _id: 't1', name: 'A' } } })
  const result = await mySummary(ctx, { historyLimit: 5 })
  expect(result.confirmed).toHaveLength(5)
})
