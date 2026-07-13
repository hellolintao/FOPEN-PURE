let mockState

function mockChainableQuery(data = []) {
  const query = {
    get: jest.fn(async () => ({ data })),
    count: jest.fn(async () => ({ total: data.length })),
    orderBy: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
  }
  return query
}

function mockMatchesValue(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if (Object.prototype.hasOwnProperty.call(expected, '$in')) {
      return Array.isArray(actual)
        ? actual.some(value => expected.$in.includes(value))
        : expected.$in.includes(actual)
    }
    if (Object.prototype.hasOwnProperty.call(expected, '$neq')) return actual !== expected.$neq
    if (Object.prototype.hasOwnProperty.call(expected, 'regexp')) {
      return new RegExp(expected.regexp, expected.options || '').test(String(actual || ''))
    }
  }
  return actual === expected
}

function mockMatchesQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true
  if (query.$and) return query.$and.every(part => mockMatchesQuery(doc, part))
  if (query.$or) return query.$or.some(part => mockMatchesQuery(doc, part))
  return Object.entries(query).every(([key, expected]) => mockMatchesValue(doc[key], expected))
}

jest.mock('wx-server-sdk', () => {
  const command = {
    or: conditions => ({ $or: conditions }),
    and: conditions => ({ $and: conditions }),
    in: values => ({ $in: values }),
    neq: value => ({ $neq: value }),
    gt: value => ({ $gt: value }),
  }

  function collection(name) {
    if (name === 'match_results') {
      const rowsForQuery = query => Object.values(mockState.rows || {})
        .filter(row => mockMatchesQuery(row, query))
      return {
        add: jest.fn(async ({ data }) => {
          mockState.rows[data._id] = { ...data }
          return { _id: data._id }
        }),
        doc: jest.fn(id => ({
          get: jest.fn(async () => ({ data: mockState.rows[id] || null })),
          update: jest.fn(async ({ data }) => {
            mockState.rows[id] = { ...(mockState.rows[id] || { _id: id }), ...data }
            return { updated: 1 }
          }),
          remove: jest.fn(async () => {
            delete mockState.rows[id]
            return { removed: 1 }
          }),
        })),
        where: jest.fn(query => mockChainableQuery(rowsForQuery(query))),
      }
    }

    if (name === 'tournaments') {
      return {
        doc: jest.fn(id => ({ get: jest.fn(async () => ({ data: mockState.tournaments[id] || null })) })),
        where: jest.fn(query => mockChainableQuery(
          Object.values(mockState.tournaments || {}).filter(row => mockMatchesQuery(row, query))
        )),
      }
    }

    if (name === 'members') {
      return {
        where: jest.fn(query => mockChainableQuery(
          Object.values(mockState.members || {}).filter(member => mockMatchesQuery(member, query))
        )),
      }
    }

    return {
      where: jest.fn(() => mockChainableQuery([])),
      doc: jest.fn(() => ({ get: jest.fn(async () => ({ data: null })) })),
    }
  }

  const db = {
    command,
    collection: jest.fn(collection),
    serverDate: jest.fn(() => 'server-date'),
    RegExp: jest.fn(options => options),
  }

  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
  }
})

const { main } = require('../index')

function resetState({ isAdmin = false } = {}) {
  mockState = {
    openid: isAdmin ? 'admin-openid' : 'member-openid',
    members: {
      caller: {
        _id: isAdmin ? 'admin1' : 'member1',
        openid: isAdmin ? 'admin-openid' : 'member-openid',
        isAdmin,
      },
      private: {
        _id: 'private',
        name: 'Private Player',
        avatarUrl: '/private.png',
        publicProfileConsent: false,
      },
      public: {
        _id: 'public',
        name: 'Visible Player',
        avatarUrl: '/visible.png',
        publicProfileConsent: true,
      },
    },
    tournaments: {
      t1: { _id: 't1', scheduleStatus: 'published' },
    },
    rows: {
      r1: publicFacingRow(),
    },
  }
}

describe('legacy match-results public identity and auth', () => {
  beforeEach(() => resetState())

  test.each([
    ['get', () => ({ action: 'get', id: 'r1' }), res => res.data],
    ['getById', () => ({ action: 'getById', id: 'r1' }), res => res.data],
    ['list', () => ({ action: 'list', data: { tournamentId: 't1' } }), res => res.data[0]],
    ['getByTournament', () => ({ action: 'getByTournament', data: { tournamentId: 't1' } }), res => res.data[0]],
    ['getByPlayer', () => ({ action: 'getByPlayer', data: { playerId: 'private' } }), res => res.data[0]],
  ])('returns public identity without sensitive fields for non-admin legacy %s', async (_action, buildEvent, pickRow) => {
    const res = await main(buildEvent())
    const row = pickRow(res)

    expect(row.player1).toMatchObject({
      id: 'private',
      name: 'Private Player',
      avatarUrl: '/private.png',
      publicProfileVisible: false,
    })
    expect(row.player2).toMatchObject({
      id: 'public',
      name: 'Visible Player',
      avatarUrl: '/visible.png',
      publicProfileVisible: true,
    })
    expect(row.winner).toMatchObject({
      id: 'private',
      name: 'Private Player',
      avatarUrl: '/private.png',
      publicProfileVisible: false,
    })
    expect(row.players[0]).toMatchObject({
      id: 'private',
      name: 'Private Player',
      avatarUrl: '/private.png',
      publicProfileVisible: false,
    })
    expect(row.players[1]).toMatchObject({
      id: 'public',
      name: 'Visible Player',
      avatarUrl: '/visible.png',
      publicProfileVisible: true,
    })
    for (const identity of [row.player1, row.player2, row.winner, ...row.players]) {
      expect(identity).not.toHaveProperty('openid')
      expect(identity).not.toHaveProperty('openId')
      expect(identity).not.toHaveProperty('unionid')
      expect(identity).not.toHaveProperty('phone')
      expect(identity).not.toHaveProperty('admin')
      expect(identity).not.toHaveProperty('publicProfileConsent')
      expect(identity).not.toHaveProperty('publicProfileConsentAt')
    }
  })

  test.each([
    ['get', { action: 'get', id: 'r1' }, res => res.data],
    ['getById', { action: 'getById', id: 'r1' }, res => res.data],
    ['getByTournament', { action: 'getByTournament', data: { tournamentId: 't1' } }, res => res.data[0]],
  ])('admin legacy %s keeps raw score-row identities', async (_action, event, pickRow) => {
    resetState({ isAdmin: true })

    const res = await main(event)

    expect(pickRow(res).player1).toMatchObject({
      name: 'Raw Private Name',
      openid: 'private-openid',
      unionid: 'private-unionid',
      publicProfileConsent: false,
    })
  })

  test.each([
    ['add', () => ({ action: 'add', data: validMatchData({ _id: 'new-match' }) })],
    ['update', () => ({ action: 'update', id: 'r1', data: validMatchData() })],
    ['delete', () => ({ action: 'delete', id: 'r1' })],
    ['updateStatus', () => ({ action: 'updateStatus', id: 'r1', data: { status: 'completed' } })],
    ['updateScore', () => ({ action: 'updateScore', id: 'r1', data: { score: '4-2', winnerId: 'private', loserId: 'public' } })],
  ])('blocks non-admin legacy match-result mutation %s', async (_action, buildEvent) => {
    const res = await main(buildEvent())

    expect(res).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '需要管理员权限' },
    })
  })
})

function publicFacingRow() {
  return {
    _id: 'r1',
    tournamentId: 't1',
    round: 1,
    type: 'singles',
    status: 'completed',
    resultStatus: 'confirmed',
    winnerId: 'private',
    loserId: 'public',
    playerIds: ['private', 'public'],
    player1: {
      id: 'private',
      name: 'Raw Private Name',
      avatarUrl: '/raw-private.png',
      openid: 'private-openid',
      unionid: 'private-unionid',
      phone: '13800000000',
      publicProfileConsent: false,
    },
    player2: {
      id: 'public',
      name: 'Raw Public Name',
      avatarUrl: '/raw-public.png',
      admin: true,
    },
    winner: {
      id: 'private',
      name: 'Raw Private Name',
      avatarUrl: '/raw-private.png',
      publicProfileConsentAt: '2026-06-01T00:00:00+08:00',
    },
    players: [
      {
        id: 'private',
        name: 'Raw Private Name',
        avatarUrl: '/raw-private.png',
        openId: 'private-openId',
      },
      {
        id: 'public',
        name: 'Raw Public Name',
        avatarUrl: '/raw-public.png',
        publicProfileConsent: true,
      },
    ],
  }
}

function validMatchData(overrides = {}) {
  return {
    tournamentId: 't1',
    round: 1,
    type: 'singles',
    players: [
      { id: 'private', name: 'Private Player' },
      { id: 'public', name: 'Visible Player' },
    ],
    status: 'completed',
    winnerId: 'private',
    loserId: 'public',
    score: '4-2',
    ...overrides,
  }
}
