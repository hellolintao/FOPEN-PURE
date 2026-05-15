const { pendingReviewItems } = require('../../handlers/query')

function makeQueryCtx({ rows = [], tournaments = {}, members = {}, isAdmin = true } = {}) {
  const queries = []
  return {
    isAdmin,
    queries,
    db: {
      queryMatchResults: async ({ resultStatus, tournamentId, limit }) => {
        queries.push({ resultStatus, tournamentId, limit })
        return rows.filter(r =>
          (!tournamentId || r.tournamentId === tournamentId) &&
          (!resultStatus || r.resultStatus === resultStatus)
        ).slice(0, limit)
      },
      countMatchResults: async ({ resultStatus, tournamentId }) =>
        rows.filter(r =>
          (!tournamentId || r.tournamentId === tournamentId) &&
          (!resultStatus || r.resultStatus === resultStatus)
        ).length,
      getTournamentsByIds: async (ids) => ids.map(id => tournaments[id]).filter(Boolean),
      getMembersByIds: async (ids) => ids.map(id => members[id]).filter(Boolean),
    },
  }
}

test('pendingReviewItems FORBIDDEN: non-admin', async () => {
  const ctx = makeQueryCtx({ isAdmin: false })
  await expect(pendingReviewItems(ctx, { tournamentId: null, limit: 50 }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('pendingReviewItems returns items with updateTime field', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeQueryCtx({
    rows: [
      {
        _id: 'mr_a', tournamentId: 't1', resultStatus: 'submitted',
        round: 'R1', position: 3, courtName: '1号场', scheduledStart: new Date(),
        player1: { name: '王明', partnerName: '李强' },
        player2: { name: '张明', partnerName: '赵亮' },
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        submittedBy: 'mA', submittedAt: new Date(), updateTime,
      },
    ],
    tournaments: { t1: { _id: 't1', name: 'XXX 杯', format: 'regular' } },
    members: { mA: { _id: 'mA', name: '王明' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: null, limit: 50 })
  expect(result.items).toHaveLength(1)
  expect(result.items[0]).toMatchObject({
    matchId: 'mr_a',
    tournamentId: 't1',
    tournamentName: 'XXX 杯',
    updateTime: updateTime,
  })
  expect(result.truncated).toBe(false)
})

test('pendingReviewItems filters by tournamentId', async () => {
  const ctx = makeQueryCtx({
    rows: [
      { _id: 'mr_a', tournamentId: 't1', resultStatus: 'submitted', round: 'R1', position: 1, score: {}, updateTime: new Date(), player1: {}, player2: {} },
      { _id: 'mr_b', tournamentId: 't2', resultStatus: 'submitted', round: 'R1', position: 1, score: {}, updateTime: new Date(), player1: {}, player2: {} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' }, t2: { _id: 't2', name: 'B' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: 't1', limit: 50 })
  expect(result.items).toHaveLength(1)
  expect(result.items[0].tournamentId).toBe('t1')
})

test('pendingReviewItems truncated when over limit', async () => {
  const rows = Array.from({ length: 80 }).map((_, i) => ({
    _id: `mr_${i}`, tournamentId: 't1', resultStatus: 'submitted',
    round: 'R1', position: i, score: {}, updateTime: new Date(),
    player1: {}, player2: {},
  }))
  const ctx = makeQueryCtx({
    rows,
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: null, limit: 50 })
  expect(result.items).toHaveLength(50)
  expect(result.truncated).toBe(true)
})
