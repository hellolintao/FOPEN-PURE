const { pendingReviewItems, pendingEntryGroups } = require('../../handlers/query')

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

test('pendingEntryGroups FORBIDDEN: non-admin', async () => {
  const ctx = makeQueryCtx({ isAdmin: false })
  await expect(pendingEntryGroups(ctx, { limit: 50 }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('pendingEntryGroups returns only playable pending matches for existing active tournaments', async () => {
  const updateTime = new Date('2026-05-18T10:00:00.000Z')
  const ctx = makeQueryCtx({
    rows: [
      {
        _id: 'mr_pending',
        sourceMatchId: 'source_pending',
        tournamentId: 't_active',
        resultStatus: 'pending',
        round: 1,
        position: 1,
        player1: { id: 'p1', name: '杜导' },
        player2: { id: 'p2', name: '小野马' },
        updateTime,
      },
      {
        _id: 'mr_confirmed',
        tournamentId: 't_active',
        resultStatus: 'confirmed',
        round: 1,
        position: 2,
        player1: { id: 'p3', name: 'A' },
        player2: { id: 'p4', name: 'B' },
        updateTime,
      },
      {
        _id: 'mr_deleted_tournament',
        tournamentId: 't_deleted',
        resultStatus: 'pending',
        round: 1,
        position: 1,
        player1: { id: 'p5', name: 'C' },
        player2: { id: 'p6', name: 'D' },
        updateTime,
      },
      {
        _id: 'mr_completed_tournament',
        tournamentId: 't_completed',
        resultStatus: 'pending',
        round: 1,
        position: 1,
        player1: { id: 'p7', name: 'E' },
        player2: { id: 'p8', name: 'F' },
        updateTime,
      },
      {
        _id: 'mr_waiting_slot',
        tournamentId: 't_active',
        resultStatus: 'pending',
        round: 2,
        position: 1,
        player1: { id: 'p1', name: '杜导' },
        player2: null,
        updateTime,
      },
    ],
    tournaments: {
      t_active: { _id: 't_active', name: '5.17常规赛', status: 'ongoing', format: 'regular' },
      t_completed: { _id: 't_completed', name: '已结束赛事', status: 'completed', format: 'regular' },
    },
  })

  const result = await pendingEntryGroups(ctx, { limit: 50 })

  expect(result.groups).toHaveLength(1)
  expect(result.groups[0]).toMatchObject({
    _id: 't_active:1',
    tournamentId: 't_active',
    tournamentName: '5.17常规赛',
    round: 1,
    updateTime,
    matches: [{
      matchId: 'source_pending',
      resultId: 'mr_pending',
      player1: { id: 'p1', name: '杜导' },
      player2: { id: 'p2', name: '小野马' },
    }],
  })
  expect(result.truncated).toBe(false)
})
