let mockState

jest.mock('wx-server-sdk', () => {
  const op = (__op, value) => ({ __op, value })
  const command = {
    in: value => op('in', value),
    remove: () => op('remove')
  }

  function rowMatches(row, filter) {
    if (!filter) return true
    for (const [key, value] of Object.entries(filter)) {
      if (value && value.__op === 'in') {
        if (!value.value.includes(row[key])) return false
      } else if (row[key] !== value) {
        return false
      }
    }
    return true
  }

  function makeCollection(name) {
    return {
      doc(id) {
        return {
          get: async () => ({ data: mockState.collections[name].get(id) || null }),
          update: async ({ data }) => {
            const current = mockState.collections[name].get(id)
            if (!current) return { stats: { updated: 0 } }
            const next = { ...current }
            for (const [key, value] of Object.entries(data)) {
              if (value && value.__op === 'remove') delete next[key]
              else next[key] = value
            }
            mockState.collections[name].set(id, next)
            return { stats: { updated: 1 } }
          }
        }
      },
      where(filter) {
        const chain = {
          get: async () => ({
            data: [...mockState.collections[name].values()].filter(row => rowMatches(row, filter))
          }),
          limit() {
            return chain
          }
        }
        return chain
      }
    }
  }

  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => ({ command, collection: makeCollection }))
  }
})

function groupRow(id, player1, player2, winnerId) {
  return {
    _id: id,
    tournamentId: 't1',
    seasonId: 's1',
    tournamentType: 'singles',
    stage: 'group',
    matchKind: 'group',
    round: 1,
    resultStatus: 'confirmed',
    player1: { id: player1 },
    player2: { id: player2 },
    winner: { id: winnerId },
    pointsAwarded: { source: 'stale', entries: [{ memberId: player1, points: 999 }] }
  }
}

function koRow(id, round, player1, player2, winnerId) {
  return {
    _id: id,
    tournamentId: 't1',
    seasonId: 's1',
    tournamentType: 'singles',
    stage: 'knockout',
    matchKind: 'bracket',
    round,
    resultStatus: 'confirmed',
    player1: { id: player1 },
    player2: { id: player2 },
    winner: { id: winnerId },
    pointsAwarded: { source: 'stale', entries: [{ memberId: player1, points: 999 }] }
  }
}

function pendingGroupRow(id, player1, player2) {
  return {
    _id: id,
    tournamentId: 't1',
    seasonId: 's1',
    tournamentType: 'singles',
    stage: 'group',
    matchKind: 'group',
    round: 1,
    resultStatus: 'pending',
    player1: { id: player1 },
    player2: { id: player2 },
    pointsAwarded: {
      source: 'stale',
      entries: [{ memberId: player1, points: 999, rank: 'stale' }]
    }
  }
}

function seedState() {
  mockState = {
    collections: {
      tournaments: new Map([
        ['t1', { _id: 't1', format: 'group_knockout', bracketSize: 16, type: 'singles', seasonId: 's1' }]
      ]),
      match_results: new Map()
    }
  }

  const rows = [
    groupRow('g_a1_a3', 'a1', 'a3', 'a1'),
    groupRow('g_a2_a4', 'a2', 'a4', 'a2'),
    groupRow('g_c2_c4', 'c2', 'c4', 'c2'),
    koRow('qf_1', 1, 'a1', 'c2', 'a1'),
    koRow('qf_2', 1, 'b1', 'd2', 'b1'),
    koRow('qf_3', 1, 'c1', 'a2', 'a2'),
    koRow('qf_4', 1, 'd1', 'b2', 'd1'),
    koRow('sf_1', 2, 'a1', 'b1', 'a1'),
    koRow('sf_2', 2, 'a2', 'd1', 'd1'),
    koRow('final', 3, 'a1', 'd1', 'a1')
  ]
  rows.forEach(row => mockState.collections.match_results.set(row._id, row))
}

beforeEach(() => {
  jest.resetModules()
  seedState()
})

test('recompute dispatches group_knockout to group_knockout branch, not default winLoss path', async () => {
  const { main } = require('../index')

  const res = await main({ action: 'recompute', tournamentId: 't1' })

  expect(res).toMatchObject({ success: true, data: { source: 'group_knockout', count: 11 } })
  expect(mockState.collections.match_results.get('g_a1_a3').pointsAwarded.source).toBe('group_knockout')
  expect(mockState.collections.match_results.get('g_a2_a4').pointsAwarded.source).toBe('group_knockout')
  expect(mockState.collections.match_results.get('g_a1_a3').pointsAwarded.entries).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ memberId: 'a1' })])
  )
  expect(mockState.collections.match_results.get('g_a2_a4').pointsAwarded.entries).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ memberId: 'a2' })])
  )
})

test('group_knockout recompute persists one entry per player idempotently and completes tournament', async () => {
  const { main } = require('../index')

  await main({ action: 'recompute', tournamentId: 't1' })
  const second = await main({ action: 'recompute', tournamentId: 't1' })

  expect(second).toMatchObject({ success: true, data: { source: 'group_knockout', count: 11 } })
  expect(mockState.collections.tournaments.get('t1').groupKnockoutPhase).toBe('completed')
  expect(mockState.collections.tournaments.get('t1').updateTime).toBeInstanceOf(Date)

  const rows = [...mockState.collections.match_results.values()]
  const entries = rows.flatMap(row => row.pointsAwarded.entries.map(entry => ({ ...entry, rowId: row._id })))
  const byMember = new Map(entries.map(entry => [entry.memberId, entry]))

  expect(entries).toHaveLength(11)
  expect(new Set(entries.map(entry => entry.memberId)).size).toBe(11)
  expect(byMember.get('a1')).toMatchObject({ rowId: 'final', points: 500, rank: 'champion' })
  expect(byMember.get('d1')).toMatchObject({ rowId: 'final', points: 350, rank: 'runnerUp' })
  expect(byMember.get('b1')).toMatchObject({ rowId: 'sf_1', points: 250, rank: 'semifinal' })
  expect(byMember.get('c2')).toMatchObject({ rowId: 'qf_1', points: 180, rank: 'quarterfinal' })
  expect(byMember.get('a3')).toMatchObject({ rowId: 'g_a1_a3', points: 25, rank: 'group' })
})

test('group_knockout recompute rejects incomplete bracket without mutating stale points or phase', async () => {
  mockState.collections.match_results.delete('final')
  mockState.collections.tournaments.set('t1', {
    ...mockState.collections.tournaments.get('t1'),
    groupKnockoutPhase: 'group_completed',
  })
  const beforeRows = new Map([...mockState.collections.match_results.entries()].map(([id, row]) => [id, { ...row, pointsAwarded: row.pointsAwarded && { ...row.pointsAwarded } }]))
  const { main } = require('../index')

  const res = await main({ action: 'recompute', tournamentId: 't1' })

  expect(res).toMatchObject({
    success: false,
    error: { code: 'GROUP_KNOCKOUT_NOT_READY' }
  })
  expect(mockState.collections.tournaments.get('t1').groupKnockoutPhase).toBe('group_completed')
  for (const [id, row] of beforeRows) {
    expect(mockState.collections.match_results.get(id).pointsAwarded).toEqual(row.pointsAwarded)
  }
})

test('group_knockout recompute rejects active pending rows without clearing stale points', async () => {
  mockState.collections.match_results.set('pending_stale', pendingGroupRow('pending_stale', 'pending_a', 'pending_b'))
  mockState.collections.tournaments.set('t1', {
    ...mockState.collections.tournaments.get('t1'),
    groupKnockoutPhase: 'knockout_published',
  })
  const { main } = require('../index')

  const res = await main({ action: 'recompute', tournamentId: 't1' })

  expect(res).toMatchObject({
    success: false,
    error: { code: 'GROUP_KNOCKOUT_NOT_READY' }
  })
  expect(mockState.collections.tournaments.get('t1').groupKnockoutPhase).toBe('knockout_published')
  expect(mockState.collections.match_results.get('pending_stale').pointsAwarded).toEqual({
    source: 'stale',
    entries: [{ memberId: 'pending_a', points: 999, rank: 'stale' }]
  })
})
