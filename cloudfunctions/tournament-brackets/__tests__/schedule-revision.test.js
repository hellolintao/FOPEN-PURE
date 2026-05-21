jest.mock('wx-server-sdk', () => {
  const db = {
    command: {},
    collection: jest.fn(() => ({})),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
  }
})

const { __test__ } = require('../index')

test('saveSchedule writes schedulePlan but NEVER touches scheduleStatus (low-level primitive)', async () => {
  const ctx = __test__.makeScheduleCtx({
    tournament: { _id: 't1', scheduleStatus: 'none', schedulePlan: { slotMinutes: 20, courts: [] } },
    r1: { _id: 'bracket_t1_round_1', matches: [{ matchId: 'm1', round: 1, position: 1 }] }
  })

  const res = await __test__.handleSaveScheduleWithCtx(ctx, { tournamentId: 't1', queues: [] })

  expect(res.success).toBe(true)
  const tournamentWrites = ctx.db.updateTournament.mock.calls.map(c => c[1])
  for (const write of tournamentWrites) {
    expect(write).not.toHaveProperty('scheduleStatus')
  }
})

test('markMatchesForRevision sets needsRevision on affected matches only', () => {
  const matches = [
    { matchId: 'm1', player1: { id: 'p1' }, player2: { id: 'p2' } },
    { matchId: 'm2', player1: { id: 'p3' }, player2: { id: 'p4' } }
  ]

  expect(__test__.markMatchesForRevision(matches, 'p1')).toEqual([
    { matchId: 'm1', player1: { id: 'p1' }, player2: { id: 'p2' }, needsRevision: true },
    { matchId: 'm2', player1: { id: 'p3' }, player2: { id: 'p4' } }
  ])
  expect(__test__.markMatchesForRevision(matches, 'p1')).not.toBe(matches)
})
