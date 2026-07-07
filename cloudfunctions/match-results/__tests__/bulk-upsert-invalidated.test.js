jest.mock('wx-server-sdk', () => {
  const db = {
    command: {
      gt: value => ({ $gt: value }),
      in: values => ({ $in: values }),
    },
    collection: jest.fn(() => ({})),
    serverDate: jest.fn(() => 'server-date'),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
  }
})

const { __test__ } = require('../index')
const { __test__: queryTest } = require('../lib/handlers/query')

const confirmedRow = {
  _id: 'result_t1_m1',
  createTime: 'created-at',
  tournamentId: 't1',
  sourceMatchId: 'm1',
  resultStatus: 'confirmed',
  player1: { id: 'a', name: 'A' },
  player2: { id: 'b', name: 'B' },
  playerIds: ['a', 'b'],
  courtId: 'c1',
  queueOrder: 0,
  score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
  winner: { id: 'a', name: 'A' },
  winnerId: 'a',
  loserId: 'b',
  confirmedBy: 'admin1',
  confirmedAt: 'confirmed-at',
  pointsAwarded: { entries: [{ memberId: 'a', points: 20 }] },
}

test('bulk upsert merge preserves confirmed score state for player-equivalent schedule-only update', () => {
  const scheduled = {
    _id: 'result_t1_m1',
    tournamentId: 't1',
    sourceMatchId: 'm1',
    resultStatus: 'pending',
    player1: { id: 'a', name: 'A' },
    player2: { id: 'b', name: 'B' },
    playerIds: ['a', 'b'],
    courtId: 'c2',
    queueOrder: 3,
    score: null,
    winner: null,
    winnerId: null,
    pointsAwarded: null,
    createTime: 'new-created-at',
  }

  expect(__test__.mergeScheduledMatchDoc(confirmedRow, scheduled)).toMatchObject({
    _id: 'result_t1_m1',
    createTime: 'created-at',
    courtId: 'c2',
    queueOrder: 3,
    resultStatus: 'confirmed',
    score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
    winnerId: 'a',
    loserId: 'b',
    confirmedBy: 'admin1',
    confirmedAt: 'confirmed-at',
    pointsAwarded: { entries: [{ memberId: 'a', points: 20 }] },
  })
})

test('bulk upsert merge refuses result-affecting overwrite of confirmed row without invalidation', () => {
  const scheduled = {
    _id: 'result_t1_m1',
    tournamentId: 't1',
    sourceMatchId: 'm1',
    resultStatus: 'pending',
    player1: { id: 'c', name: 'C' },
    player2: { id: 'b', name: 'B' },
    playerIds: ['c', 'b'],
    courtId: 'c1',
    queueOrder: 0,
    score: null,
    winner: null,
    winnerId: null,
    pointsAwarded: null,
  }

  expect(() => __test__.mergeScheduledMatchDoc(confirmedRow, scheduled))
    .toThrow('赛程变更影响已确认成绩，请先清空比分并重新发布')
})

test('bulk upsert merge leaves canonical row pending after schedule-impact invalidation reset', () => {
  const existing = {
    ...confirmedRow,
    resultStatus: 'pending',
    score: null,
    winner: null,
    winnerId: null,
    loserId: null,
    confirmedBy: null,
    confirmedAt: null,
    pointsAwarded: null,
    invalidatedAt: undefined,
    invalidatedBy: undefined,
  }
  const scheduled = {
    _id: 'result_t1_m1',
    tournamentId: 't1',
    sourceMatchId: 'm1',
    resultStatus: 'pending',
    player1: { id: 'c', name: 'C' },
    player2: { id: 'b', name: 'B' },
    playerIds: ['c', 'b'],
    courtId: 'c1',
    queueOrder: 0,
    score: null,
    winner: null,
    winnerId: null,
    pointsAwarded: null,
  }

  expect(__test__.mergeScheduledMatchDoc(existing, scheduled)).toMatchObject({
    _id: 'result_t1_m1',
    resultStatus: 'pending',
    player1: { id: 'c', name: 'C' },
    score: null,
    winner: null,
    pointsAwarded: null,
  })
  expect(__test__.mergeScheduledMatchDoc(existing, scheduled).invalidatedAt).toBeUndefined()
})

test('bulk upsert keeps history rows out of orphan cleanup and removes stale active rows', () => {
  const seen = new Set(['result_t1_m2'])

  expect(__test__.shouldRemoveOrphanMatchDoc({
    _id: 'history_result_t1_m1_1',
    resultStatus: 'invalidated',
    matchKind: 'history',
    archivedFrom: 'result_t1_m1',
  }, seen)).toBe(false)

  expect(__test__.shouldRemoveOrphanMatchDoc({
    _id: 'result_t1_m3',
    resultStatus: 'pending',
  }, seen)).toBe(true)
})

test('confirmed row invalidation history plus bulk merge exposes one active pending canonical row', async () => {
  const canonicalAfterImpact = {
    ...confirmedRow,
    resultStatus: 'pending',
    score: null,
    winner: null,
    winnerId: null,
    loserId: null,
    confirmedBy: null,
    confirmedAt: null,
    pointsAwarded: null,
  }
  const scheduled = {
    _id: 'result_t1_m1',
    tournamentId: 't1',
    sourceMatchId: 'm1',
    resultStatus: 'pending',
    player1: { id: 'c', name: 'C' },
    player2: { id: 'b', name: 'B' },
    playerIds: ['c', 'b'],
    courtId: 'c3',
    queueOrder: 1,
    score: null,
    winner: null,
    winnerId: null,
    pointsAwarded: null,
  }
  const active = __test__.mergeScheduledMatchDoc(canonicalAfterImpact, scheduled)
  const history = {
    ...confirmedRow,
    _id: 'history_result_t1_m1_1',
    tournamentId: 't1',
    matchKind: 'history',
    archivedFrom: 'result_t1_m1',
    resultStatus: 'invalidated',
    invalidatedAt: 'invalidated-at',
    invalidatedBy: 'admin1',
  }

  const res = await queryTest.listByTournamentWithCtx({
    isAdmin: true,
    db: {
      getTournament: async () => ({ _id: 't1', scheduleStatus: 'published' }),
      listByTournament: async () => [active, history],
    },
  }, { tournamentId: 't1' })

  expect(res.results).toEqual([expect.objectContaining({
    _id: 'result_t1_m1',
    resultStatus: 'pending',
    score: null,
    player1: { id: 'c', name: 'C' },
  })])
  expect(history).toMatchObject({
    archivedFrom: 'result_t1_m1',
    resultStatus: 'invalidated',
    score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
  })
})
