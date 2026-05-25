const mockState = {
  tournaments: {},
  registrations: []
}

function collectionFor(name) {
  return {
    doc: jest.fn((id) => ({
      get: jest.fn(async () => ({ data: mockState.tournaments[id] || null }))
    })),
    where: jest.fn((query) => ({
      get: jest.fn(async () => {
        if (name === 'tournament_registrations') {
          return {
            data: mockState.registrations.filter(row => row.tournamentId === query.tournamentId)
          }
        }
        return { data: [] }
      })
    }))
  }
}

const mockDb = {
  collection: jest.fn(collectionFor)
}

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test-env',
  database: jest.fn(() => mockDb),
  callFunction: jest.fn()
}), { virtual: true })

describe('scheduler-engine active registration filtering', () => {
  let main
  let warnSpy

  beforeEach(() => {
    jest.resetModules()
    mockState.tournaments = {
      t1: {
        _id: 't1',
        type: 'singles',
        format: 'regular',
        courtTimeGrid: {
          slots: [{ slotId: 'slot-1', start: '2026-05-24T09:00:00+08:00', availableCourtIds: ['c1'] }]
        },
        config: { totalRounds: 1 }
      }
    }
    mockState.registrations = [
      { _id: 'reg_a', tournamentId: 't1', playerId: 'A', playerName: 'Alice', status: 'confirmed', registrationStatus: 'confirmed' },
      { _id: 'reg_b', tournamentId: 't1', playerId: 'B', playerName: 'Bob', status: 'confirmed', registrationStatus: 'withdrew' },
      { _id: 'reg_c', tournamentId: 't1', playerId: 'C', playerName: 'Carol', status: 'confirmed', registrationStatus: 'confirmed' },
      { _id: 'reg_d', tournamentId: 't1', playerId: 'D', playerName: 'Dan', status: 'confirmed', registrationStatus: 'withdrew' }
    ]
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    ;({ main } = require('../index'))
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  test('excludes registrationStatus=withdrew even when legacy status remains confirmed', async () => {
    const result = await main({ action: 'preview', tournamentId: 't1', totalRounds: 1 })

    expect(result.success).toBe(true)
    const matches = [...result.data.scheduled, ...result.data.unscheduled]
    expect(matches).toHaveLength(1)
    const playerIds = matches.flatMap(match => [match.player1.id, match.player2.id])
    expect(playerIds.sort()).toEqual(['A', 'C'])
  })
})
