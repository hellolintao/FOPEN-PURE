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
    if (Object.prototype.hasOwnProperty.call(expected, '$in')) return expected.$in.includes(actual)
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
    set: value => value,
  }

  function collection(name) {
    if (name === 'tournaments') {
      const rowsForQuery = query => Object.values(mockState.tournaments || {})
        .filter(row => mockMatchesQuery(row, query))
      return {
        add: jest.fn(async ({ data }) => {
          mockState.tournaments[data._id] = { ...data }
          return { _id: data._id }
        }),
        doc: jest.fn(id => ({
          get: jest.fn(async () => ({ data: mockState.tournaments[id] || null })),
          update: jest.fn(async ({ data }) => {
            mockState.tournaments[id] = { ...(mockState.tournaments[id] || { _id: id }), ...data }
            return { updated: 1 }
          }),
          remove: jest.fn(async () => {
            delete mockState.tournaments[id]
            return { removed: 1 }
          }),
        })),
        where: jest.fn(query => mockChainableQuery(rowsForQuery(query))),
      }
    }

    if (name === 'members') {
      return {
        where: jest.fn(query => mockChainableQuery(
          Object.values(mockState.members || {}).filter(member => mockMatchesQuery(member, query))
        )),
      }
    }

    if (name === 'seasons') {
      return {
        where: jest.fn(query => mockChainableQuery(
          Object.values(mockState.seasons || {}).filter(season => mockMatchesQuery(season, query))
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
        admin: isAdmin,
      },
    },
    tournaments: {
      t1: {
        _id: 't1',
        name: 'FU Open',
        type: 'singles',
        format: 'regular',
        startDate: '2026-05-25',
        seasonId: 'season_2026',
        createdBy: 'admin1',
        createdByOpenid: 'admin-openid',
        openid: 'raw-openid',
        openId: 'raw-openId',
        unionid: 'raw-unionid',
        phone: '13800000000',
        publicProfileConsent: true,
        admin: true,
      },
    },
    seasons: {
      season_2026: { _id: 'season_2026', name: '2026 赛季' },
    },
  }
}

describe('tournaments public read sanitization and legacy auth', () => {
  beforeEach(() => resetState())

  test('non-admin get omits openid-like internal fields', async () => {
    const res = await main({ action: 'get', id: 't1' })

    expect(res.data).toEqual(expect.objectContaining({
      _id: 't1',
      name: 'FU Open',
      createdBy: 'admin1',
    }))
    for (const key of ['createdByOpenid', 'openid', 'openId', 'unionid', 'phone', 'publicProfileConsent', 'admin']) {
      expect(res.data).not.toHaveProperty(key)
    }
  })

  test('non-admin list omits openid-like internal fields', async () => {
    const res = await main({ action: 'list', page: 1, pageSize: 10 })

    expect(res.success).toBe(true)
    expect(res.data.tournaments).toHaveLength(1)
    expect(res.data.tournaments[0]).toEqual(expect.objectContaining({
      _id: 't1',
      seasonName: '2026 赛季',
      createdBy: 'admin1',
    }))
    for (const key of ['createdByOpenid', 'openid', 'openId', 'unionid', 'phone', 'publicProfileConsent', 'admin']) {
      expect(res.data.tournaments[0]).not.toHaveProperty(key)
    }
  })

  test('admin get keeps internal fields for management flows', async () => {
    resetState({ isAdmin: true })

    const res = await main({ action: 'get', id: 't1' })

    expect(res.data.createdByOpenid).toBe('admin-openid')
    expect(res.data.openId).toBe('raw-openId')
  })

  test.each([
    ['add', () => ({ action: 'add', data: validTournament({ _id: 't-new' }) })],
    ['create', () => ({ action: 'create', data: validTournament({ _id: 't-new' }) })],
    ['update', () => ({ action: 'update', id: 't1', data: validTournament({ name: '更新赛事' }) })],
    ['updateNew', () => ({ action: 'updateNew', id: 't1', data: { name: '新入口更新' } })],
    ['updateConfig', () => ({ action: 'updateConfig', id: 't1', data: { config: { maxPlayers: 16 } } })],
    ['updatePointsRules', () => ({ action: 'updatePointsRules', id: 't1', data: { pointsRules: validPointsRules() } })],
    ['updateStatus', () => ({ action: 'updateStatus', id: 't1', status: 'completed' })],
    ['delete', () => ({ action: 'delete', id: 't1' })],
  ])('blocks non-admin tournament mutation %s', async (_action, buildEvent) => {
    const res = await main(buildEvent())

    expect(res).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '需要管理员权限' },
    })
  })
})

function validTournament(overrides = {}) {
  return {
    name: '5月周末赛',
    type: 'singles',
    format: 'regular',
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    schedulePlan: null,
    pointsRules: validPointsRules(),
    ...overrides,
  }
}

function validPointsRules() {
  return {
    winLoss: { win: 100, loss: 20, walkover: 50 },
    placement: {
      champion: 500,
      runnerUp: 300,
      semifinal: 150,
      quarterfinal: 75,
      participation: 10,
    },
  }
}
