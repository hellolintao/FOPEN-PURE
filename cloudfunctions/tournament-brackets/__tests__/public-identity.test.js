let mockState

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function valueMatches(actual, expected) {
  if (expected && typeof expected === 'object') {
    if (Array.isArray(expected.$in)) return expected.$in.includes(actual)
  }
  return actual === expected
}

function matchesQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true
  if (Array.isArray(query.$or)) return query.$or.some(condition => matchesQuery(doc, condition))
  return Object.entries(query).every(([key, expected]) => valueMatches(doc[key], expected))
}

function collectionFor(name) {
  const makeQuery = (query = {}) => {
    let currentQuery = query
    let order = null
    const chain = {
      where(nextQuery) {
        currentQuery = nextQuery || {}
        return chain
      },
      orderBy(field, direction) {
        order = { field, direction }
        return chain
      },
      limit() {
        return chain
      },
      skip() {
        return chain
      },
      async get() {
        let data = Array.from((mockState.collections[name] || new Map()).values())
          .filter(doc => matchesQuery(doc, currentQuery))
        if (order) {
          data = data.slice().sort((a, b) => {
            const diff = (a[order.field] || 0) > (b[order.field] || 0) ? 1 : -1
            return order.direction === 'desc' ? -diff : diff
          })
        }
        return { data: clone(data) }
      },
      async count() {
        const data = Array.from((mockState.collections[name] || new Map()).values())
          .filter(doc => matchesQuery(doc, currentQuery))
        return { total: data.length }
      }
    }
    return chain
  }

  return {
    doc(id) {
      return {
        get: jest.fn(async () => ({ data: clone((mockState.collections[name] || new Map()).get(id)) || null })),
        update: jest.fn(async () => ({ updated: 1 })),
        remove: jest.fn(async () => ({ removed: 1 })),
      }
    },
    where(query) {
      return makeQuery(query)
    },
    orderBy(field, direction) {
      return makeQuery().orderBy(field, direction)
    },
    add: jest.fn(async ({ data }) => ({ _id: data && data._id })),
  }
}

const mockDb = {
  command: {
    or: jest.fn(conditions => ({ $or: conditions })),
    in: jest.fn(values => ({ $in: values })),
    set: jest.fn(value => value),
  },
  serverDate: jest.fn(() => 'SERVER_DATE'),
  collection: jest.fn(name => collectionFor(name)),
}

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test-env',
  getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
  database: jest.fn(() => mockDb),
}))

const { main } = require('../index')

beforeEach(() => {
  mockState = {
    openid: 'viewer-openid',
    collections: {
      members: new Map([
        ['viewer', { _id: 'viewer', openid: 'viewer-openid', admin: false }],
        ['member-private', { _id: 'member-private', name: 'Private Player', avatarUrl: '/private.png', publicProfileConsent: false }],
        ['member-public', { _id: 'member-public', name: 'Visible Player', avatarUrl: '/visible.png', publicProfileConsent: true }],
      ]),
      tournament_brackets: new Map([
        ['bracket-1', {
          _id: 'bracket-1',
          tournamentId: 't1',
          round: 1,
          type: 'singles',
          matches: [{
            matchId: 'match-1',
            round: 1,
            position: 1,
            player1: {
              id: 'member-private',
              name: 'Raw Private Name',
              avatarUrl: '/raw-private.png',
              openid: 'private-openid',
              phone: '13800000000',
              publicProfileConsent: false
            },
            player2: {
              id: 'member-public',
              name: 'Raw Public Name',
              avatarUrl: '/raw-public.png',
              admin: true
            },
            winner: {
              id: 'member-private',
              name: 'Raw Private Name',
              avatarUrl: '/raw-private.png',
              publicProfileConsentAt: '2026-06-01T00:00:00+08:00'
            },
            resultStatus: 'confirmed'
          }]
        }]
      ]),
    }
  }
  jest.clearAllMocks()
})

test('getByTournament returns match participant avatars without sensitive fields for non-admin callers', async () => {
  const res = await main({ action: 'getByTournament', tournamentId: 't1' })

  expect(res.data).toHaveLength(1)
  const match = res.data[0].matches[0]
  expect(match.player1).toMatchObject({
    id: 'member-private',
    name: 'Private Player',
    avatarUrl: '/private.png',
    publicProfileVisible: false
  })
  expect(match.player2).toMatchObject({
    id: 'member-public',
    name: 'Visible Player',
    avatarUrl: '/visible.png',
    publicProfileVisible: true
  })
  expect(match.winner).toMatchObject({
    id: 'member-private',
    name: 'Private Player',
    avatarUrl: '/private.png',
    publicProfileVisible: false
  })
  for (const side of [match.player1, match.player2, match.winner]) {
    expect(side).not.toHaveProperty('openid')
    expect(side).not.toHaveProperty('phone')
    expect(side).not.toHaveProperty('admin')
    expect(side).not.toHaveProperty('publicProfileConsent')
    expect(side).not.toHaveProperty('publicProfileConsentAt')
  }
})

test('getByTournament replaces stale match identity when the member no longer exists', async () => {
  mockState.collections.tournament_brackets.set('bracket-missing-member', {
    _id: 'bracket-missing-member',
    tournamentId: 't-missing-member',
    round: 1,
    type: 'singles',
    matches: [{
      matchId: 'match-missing-member',
      round: 1,
      position: 1,
      player1: {
        id: 'deleted-member',
        name: 'Deleted Player Real Name',
        avatarUrl: '/deleted-player.png',
        openid: 'deleted-openid',
        phone: '13900000000'
      },
      winner: {
        id: 'deleted-member',
        name: 'Deleted Player Real Name',
        avatarUrl: '/deleted-player.png'
      },
      resultStatus: 'confirmed'
    }]
  })

  const res = await main({ action: 'getByTournament', tournamentId: 't-missing-member' })

  const match = res.data[0].matches[0]
  for (const side of [match.player1, match.winner]) {
    expect(side).toMatchObject({
      id: 'deleted-member',
      name: '选手01',
      avatarUrl: '/images/icons/default-avatar.png',
      publicProfileVisible: false
    })
    expect(side).not.toHaveProperty('openid')
    expect(side).not.toHaveProperty('phone')
    expect(side.name).not.toBe('Deleted Player Real Name')
  }
})
