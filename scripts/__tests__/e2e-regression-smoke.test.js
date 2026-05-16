const { BUSINESS_COLLECTIONS } = require('../cleanup-test-data')
const {
  runE2ERegressionSmoke,
  seedFixture,
  runReadOnlySmoke,
} = require('../e2e-regression-smoke')
const {
  selectActors,
  buildE2EFixture,
} = require('../lib/e2e-fixture')

const members = [
  { _id: 'admin', name: 'Admin', admin: true, openid: 'oa' },
  { _id: 'A', name: 'A' },
  { _id: 'B', name: 'B' },
  { _id: 'C', name: 'C' },
  { _id: 'D', name: 'D' },
  { _id: 'E', name: 'E' },
]

const courts = [
  { _id: 'court1', courtId: 'court1', name: 'Court 1', enabled: true },
  { _id: 'court2', courtId: 'court2', name: 'Court 2', enabled: true },
]

const seasons = [
  { _id: 'season_2026', name: '2026' },
]

function makeFakeDb(extraRows = {}) {
  const rows = {
    members: members.map(row => ({ ...row })),
    courts: courts.map(row => ({ ...row })),
    seasons: seasons.map(row => ({ ...row })),
    ...Object.fromEntries(BUSINESS_COLLECTIONS.map(name => [name, []])),
    ...Object.fromEntries(
      Object.entries(extraRows).map(([name, collectionRows]) => [
        name,
        collectionRows.map(row => ({ ...row })),
      ])
    ),
  }
  const writes = []

  return {
    rows,
    writes,
    collection(name) {
      if (!rows[name]) rows[name] = []
      return {
        count: async () => ({ total: rows[name].length }),
        where: filter => makeQuery(rows[name].filter(row => rowMatches(row, filter))),
        limit: n => ({ get: async () => ({ data: rows[name].slice(0, n).map(row => ({ ...row })) }) }),
        get: async () => ({ data: rows[name].map(row => ({ ...row })) }),
        doc: id => ({
          get: async () => ({ data: rows[name].find(row => row._id === id) || null }),
          set: async ({ data }) => {
            writes.push({ collection: name, _id: id, data })
            const row = { _id: id, ...data }
            const index = rows[name].findIndex(existing => existing._id === id)
            if (index >= 0) rows[name][index] = row
            else rows[name].push(row)
            return { _id: id }
          },
          remove: async () => {
            rows[name] = rows[name].filter(row => row._id !== id)
            return { deleted: 1 }
          },
        }),
      }
    },
  }
}

function makeQuery(data) {
  return {
    limit: n => ({ get: async () => ({ data: data.slice(0, n).map(row => ({ ...row })) }) }),
    get: async () => ({ data: data.map(row => ({ ...row })) }),
  }
}

function rowMatches(row, filter) {
  if (!filter) return true
  return Object.entries(filter).every(([key, value]) => row[key] === value)
}

function makeSmokeCallFunction(calls) {
  return async (name, data) => {
    calls.push({ name, data })
    if (name !== 'points-engine') return { result: { success: false, error: 'unexpected function' } }

    if (data.action === 'rankList') {
      return {
        result: {
          success: true,
          data: {
            rankList: [
              { _id: 'A', totalPoints: 160, winCount: 3 },
              { _id: 'B', totalPoints: 40, winCount: 0 },
            ],
          },
        },
      }
    }
    if (data.action === 'playerStats') {
      return {
        result: {
          success: true,
          data: {
            playerId: 'A',
            stats: {
              singles: { totalPoints: 160, wins: 3, winCount: 3 },
            },
            recent: [{ opponentId: 'B', result: 'win' }],
          },
        },
      }
    }
    if (data.action === 'playerH2H') {
      return {
        result: {
          success: true,
          data: {
            playerId: 'A',
            singles: [{ memberId: 'B', wins: 2, losses: 0 }],
            doubles: [],
          },
        },
      }
    }
    return { result: { success: false, error: 'unexpected action' } }
  }
}

function buildFixture() {
  return buildE2EFixture({
    actors: selectActors({ members, courts }),
    seasonId: 'season_2026',
    now: new Date('2026-05-17T10:00:00.000Z'),
  })
}

function makeReadOnlySmokeCallFunction(overrides = {}) {
  const responses = {
    rankList: {
      result: {
        success: true,
        data: {
          rankList: [
            { _id: 'A', totalPoints: 160, winCount: 3 },
            { _id: 'B', totalPoints: 40, winCount: 0 },
          ],
        },
      },
    },
    playerStats: {
      result: {
        success: true,
        data: {
          stats: {
            singles: { totalPoints: 160, winCount: 3 },
          },
          recent: [{ opponentId: 'B', result: 'win' }],
        },
      },
    },
    playerH2H: {
      result: {
        success: true,
        data: {
          singles: [{ memberId: 'B', wins: 2, losses: 0 }],
          doubles: [],
        },
      },
    },
    ...overrides,
  }

  return async (name, data) => {
    if (name !== 'points-engine') return { result: { success: false, error: { code: 'UNEXPECTED_FUNCTION', message: name } } }
    return responses[data.action]
  }
}

describe('runE2ERegressionSmoke', () => {
  test('cleanup-seed-smoke clears business rows, seeds fixture, and runs read-only points-engine checks', async () => {
    const calls = []
    const logs = []
    const db = makeFakeDb({
      tournaments: [{ _id: 'old_tournament', name: 'old' }],
      match_results: [{ _id: 'old_match' }],
    })

    const result = await runE2ERegressionSmoke({
      db,
      callFunction: makeSmokeCallFunction(calls),
      mode: 'cleanup-seed-smoke',
      seasonId: 'season_2026',
      now: new Date('2026-05-17T10:00:00.000Z'),
      log: message => logs.push(message),
    })

    expect(result.mode).toBe('cleanup-seed-smoke')
    expect(result.fixture.ids.regularSinglesTournamentId).toBe('e2e_regular_singles_20260517_1000')
    expect(result.smoke.map(check => check.name)).toEqual([
      'rankList.singles',
      'playerStats.A',
      'playerH2H.A',
    ])
    expect(db.rows.tournaments.find(row => row._id === 'old_tournament')).toBeUndefined()
    expect(db.rows.match_results.find(row => row._id === 'old_match')).toBeUndefined()
    expect(db.rows.tournaments.find(row => row._id === result.fixture.ids.regularSinglesTournamentId)).toEqual(
      expect.objectContaining({ name: 'E2E_Regular_Singles_20260517_1000' })
    )
    expect(db.rows.tournaments.find(row => row._id === result.fixture.ids.regularSinglesTournamentId)).not.toHaveProperty('_id', undefined)
    expect(calls.map(call => call.data.action)).toEqual(['rankList', 'playerStats', 'playerH2H'])
    expect(calls[0]).toEqual({
      name: 'points-engine',
      data: { action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' },
    })
    expect(logs).toContain('[smoke] rankList.singles: ok')
  })

  test('seed-only leaves existing business rows in place and skips smoke calls', async () => {
    const calls = []
    const db = makeFakeDb({
      tournaments: [{ _id: 'old_tournament', name: 'old' }],
    })

    const result = await runE2ERegressionSmoke({
      db,
      callFunction: makeSmokeCallFunction(calls),
      mode: 'seed-only',
      seasonId: 'season_2026',
      now: new Date('2026-05-17T10:00:00.000Z'),
      log: () => {},
    })

    expect(result.smoke).toEqual([])
    expect(db.rows.tournaments.find(row => row._id === 'old_tournament')).toEqual({ _id: 'old_tournament', name: 'old' })
    expect(db.rows.tournaments.find(row => row._id === result.fixture.ids.regularSinglesTournamentId)).toBeTruthy()
    expect(calls).toEqual([])
  })

  test('cleanup-only clears business rows without seeding fixture data', async () => {
    const db = makeFakeDb({
      tournaments: [{ _id: 'old_tournament', name: 'old' }],
      match_results: [{ _id: 'old_match' }],
    })

    const result = await runE2ERegressionSmoke({
      db,
      callFunction: async () => { throw new Error('unexpected smoke call') },
      mode: 'cleanup-only',
      seasonId: 'season_2026',
      now: new Date('2026-05-17T10:00:00.000Z'),
      log: () => {},
    })

    expect(result).toEqual({ mode: 'cleanup-only', fixture: null, smoke: [] })
    expect(db.rows.tournaments).toEqual([])
    expect(db.rows.match_results).toEqual([])
  })

  test('requires at least one season before cleanup or seed', async () => {
    const db = makeFakeDb({ seasons: [] })

    await expect(runE2ERegressionSmoke({
      db,
      callFunction: async () => {},
      mode: 'seed-only',
      seasonId: 'season_2026',
      log: () => {},
    })).rejects.toThrow(/at least one season/)
  })
})

describe('runReadOnlySmoke contract checks', () => {
  test('requires exact A totals computed from fixture', async () => {
    const fixture = buildFixture()

    await expect(runReadOnlySmoke({
      callFunction: makeReadOnlySmokeCallFunction({
        rankList: {
          result: {
            success: true,
            data: { rankList: [{ _id: 'A', totalPoints: 161, winCount: 3 }] },
          },
        },
      }),
      fixture,
      seasonId: 'season_2026',
      log: () => {},
    })).rejects.toThrow(/rankList\.singles totalPoints/)
  })

  test('missing success true fails', async () => {
    await expect(runReadOnlySmoke({
      callFunction: makeReadOnlySmokeCallFunction({
        rankList: {
          result: {
            data: {
              rankList: [{ _id: 'A', totalPoints: 160, winCount: 3 }],
            },
          },
        },
      }),
      fixture: buildFixture(),
      seasonId: 'season_2026',
      log: () => {},
    })).rejects.toThrow(/rankList\.singles.*success true/)
  })

  test('rankList renamed or missing fails', async () => {
    await expect(runReadOnlySmoke({
      callFunction: makeReadOnlySmokeCallFunction({
        rankList: {
          result: {
            success: true,
            data: {
              rows: [{ _id: 'A', totalPoints: 160, winCount: 3 }],
            },
          },
        },
      }),
      fixture: buildFixture(),
      seasonId: 'season_2026',
      log: () => {},
    })).rejects.toThrow(/rankList\.singles.*data\.rankList/)
  })

  test('playerStats missing stats.singles fails', async () => {
    await expect(runReadOnlySmoke({
      callFunction: makeReadOnlySmokeCallFunction({
        playerStats: {
          result: {
            success: true,
            data: {
              singles: { totalPoints: 160, winCount: 3 },
              recent: [{ opponentId: 'B' }],
            },
          },
        },
      }),
      fixture: buildFixture(),
      seasonId: 'season_2026',
      log: () => {},
    })).rejects.toThrow(/playerStats\.A.*data\.stats\.singles/)
  })

  test('playerH2H malformed singles fails', async () => {
    await expect(runReadOnlySmoke({
      callFunction: makeReadOnlySmokeCallFunction({
        playerH2H: {
          result: {
            success: true,
            data: {
              singles: { memberId: 'B', wins: 2, losses: 0 },
              doubles: [],
            },
          },
        },
      }),
      fixture: buildFixture(),
      seasonId: 'season_2026',
      log: () => {},
    })).rejects.toThrow(/playerH2H\.A.*data\.singles/)
  })

  test('cloud error includes code and message', async () => {
    await expect(runReadOnlySmoke({
      callFunction: makeReadOnlySmokeCallFunction({
        rankList: {
          result: {
            success: false,
            error: { code: 'INVALID_ARG', message: 'season required' },
          },
        },
      }),
      fixture: buildFixture(),
      seasonId: 'season_2026',
      log: () => {},
    })).rejects.toThrow(/INVALID_ARG: season required/)
  })
})

describe('seedFixture', () => {
  test('uses _id as document id and strips _id from stored data payload', async () => {
    const db = makeFakeDb()

    await seedFixture(db, {
      tournaments: [{ _id: 't1', name: 'Tournament One' }],
    }, () => {})

    expect(db.writes).toEqual([
      { collection: 'tournaments', _id: 't1', data: { name: 'Tournament One' } },
    ])
    expect(db.rows.tournaments).toEqual([{ _id: 't1', name: 'Tournament One' }])
  })

  test('rejects fixture rows without _id', async () => {
    const db = makeFakeDb()

    await expect(seedFixture(db, {
      tournaments: [{ name: 'Missing id' }],
    }, () => {})).rejects.toThrow(/requires _id/)
  })
})
