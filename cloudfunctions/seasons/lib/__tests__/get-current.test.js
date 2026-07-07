function makeCollection(rows) {
  const docApi = {
    get: jest.fn().mockResolvedValue({ data: rows[0] || null }),
    update: jest.fn().mockResolvedValue({ stats: { updated: 1 } }),
    remove: jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  }
  const collection = {
    where: jest.fn(() => collection),
    orderBy: jest.fn(() => collection),
    limit: jest.fn(() => collection),
    skip: jest.fn(() => collection),
    get: jest.fn().mockResolvedValue({ data: rows }),
    add: jest.fn().mockResolvedValue({ _id: 'season-created' }),
    doc: jest.fn(() => docApi)
  }
  return collection
}

function loadFunction(rows = [], options = {}) {
  jest.resetModules()
  const collection = makeCollection(rows)
  const memberCollection = {
    where: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ data: options.member ? [options.member] : [] })
    }))
  }
  const db = {
    command: { and: jest.fn() },
    collection: jest.fn(name => (name === 'members' ? memberCollection : collection)),
    serverDate: jest.fn(() => 'server-date'),
    RegExp: jest.fn(options => options)
  }
  jest.doMock('wx-server-sdk', () => ({
    DYNAMIC_CURRENT_ENV: 'test-env',
    init: jest.fn(),
    getWXContext: jest.fn(() => ({ OPENID: options.openid || 'openid-a' })),
    database: jest.fn(() => db)
  }), { virtual: true })
  return { seasonsFunction: require('../../index'), collection, memberCollection, db }
}

describe('seasons.getCurrent', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('uses event.date before event.data.date', async () => {
    const seasons = [{ _id: 'season_1', name: 'Season 1' }]
    const collection = makeCollection(seasons)
    const selectCurrentSeason = jest.fn(() => seasons[0])
    const { seasonsFunction: { __test__ } } = loadFunction()

    await __test__.getCurrentSeason(
      { date: '2026-05-19', data: { date: '2025-01-01' } },
      { collection, selectCurrentSeason, today: () => '2024-01-01' }
    )

    expect(selectCurrentSeason).toHaveBeenCalledWith(seasons, '2026-05-19')
  })

  test('uses event.data.date when event.date is absent', async () => {
    const seasons = [{ _id: 'season_1', name: 'Season 1' }]
    const collection = makeCollection(seasons)
    const selectCurrentSeason = jest.fn(() => seasons[0])
    const { seasonsFunction: { __test__ } } = loadFunction()

    await __test__.getCurrentSeason(
      { data: { date: '2026-05-20' } },
      { collection, selectCurrentSeason, today: () => '2024-01-01' }
    )

    expect(selectCurrentSeason).toHaveBeenCalledWith(seasons, '2026-05-20')
  })

  test('uses today when no event date is provided', async () => {
    const seasons = [{ _id: 'season_1', name: 'Season 1' }]
    const collection = makeCollection(seasons)
    const selectCurrentSeason = jest.fn(() => seasons[0])
    const { seasonsFunction: { __test__ } } = loadFunction()

    await __test__.getCurrentSeason(
      { data: {} },
      { collection, selectCurrentSeason, today: () => '2026-05-21' }
    )

    expect(selectCurrentSeason).toHaveBeenCalledWith(seasons, '2026-05-21')
  })

  test('uses Asia Shanghai business date when today falls across a UTC boundary', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:30:00+08:00'))
    const seasons = [{ _id: 'season_1', name: 'Season 1' }]
    const collection = makeCollection(seasons)
    const selectCurrentSeason = jest.fn(() => seasons[0])
    const { seasonsFunction: { __test__ } } = loadFunction()

    await __test__.getCurrentSeason(
      {},
      { collection, selectCurrentSeason }
    )
    expect(selectCurrentSeason).toHaveBeenCalledWith(seasons, '2026-01-01')
  })

  test('fetches seasons ordered by startDate desc', async () => {
    const seasons = [{ _id: 'season_1', name: 'Season 1' }]
    const collection = makeCollection(seasons)
    const { seasonsFunction: { __test__ } } = loadFunction()

    await __test__.getCurrentSeason(
      { date: '2026-05-19' },
      { collection, selectCurrentSeason: jest.fn(() => seasons[0]) }
    )

    expect(collection.where).toHaveBeenCalledWith({})
    expect(collection.orderBy).toHaveBeenCalledWith('startDate', 'desc')
    expect(collection.limit).toHaveBeenCalledWith(100)
    expect(collection.get).toHaveBeenCalledTimes(1)
  })

  test('returns success response with selected season data', async () => {
    const season = { _id: 'season_1740000000000', name: '2026 Spring' }
    const { seasonsFunction: { __test__ } } = loadFunction()

    const result = await __test__.getCurrentSeason(
      { date: '2026-05-19' },
      { collection: makeCollection([season]), selectCurrentSeason: jest.fn(() => season) }
    )

    expect(result).toEqual({
      success: true,
      data: {
        season,
        seasonId: 'season_1740000000000',
        name: '2026 Spring'
      }
    })
  })

  test('returns NOT_FOUND when no season is selected', async () => {
    const { seasonsFunction: { __test__ } } = loadFunction()

    const result = await __test__.getCurrentSeason(
      { date: '2026-05-19' },
      { collection: makeCollection([]), selectCurrentSeason: jest.fn(() => null) }
    )

    expect(result).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: '未找到当前赛季' }
    })
  })

  test('exports.main routes getCurrent action through the switch branch', async () => {
    const season = {
      _id: 'season_1740000000000',
      name: '2026 Spring',
      status: 'active',
      startDate: '2026-01-01',
      endDate: '2026-12-31'
    }
    const { seasonsFunction, collection } = loadFunction([season])

    const result = await seasonsFunction.main({ action: 'getCurrent', date: '2026-05-19' }, {})

    expect(collection.orderBy).toHaveBeenCalledWith('startDate', 'desc')
    expect(result).toEqual({
      success: true,
      data: {
        season,
        seasonId: 'season_1740000000000',
        name: '2026 Spring'
      }
    })
  })

  test.each([
    ['add', { data: { _id: 'season_2026', name: '2026', startDate: '2026-01-01', endDate: '2026-12-31' } }],
    ['update', { id: 'season_2026', data: { name: '2026 Updated' } }],
    ['delete', { id: 'season_2026' }]
  ])('%s rejects non-admin legacy season mutation before writing', async (action, payload) => {
    const { seasonsFunction, collection } = loadFunction([], {
      member: { _id: 'member-a', openid: 'openid-a', admin: false }
    })

    const result = await seasonsFunction.main({ action, ...payload }, {})

    expect(result).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '需要管理员权限' }
    })
    expect(collection.add).not.toHaveBeenCalled()
    expect(collection.doc().update).not.toHaveBeenCalled()
    expect(collection.doc().remove).not.toHaveBeenCalled()
  })
})
