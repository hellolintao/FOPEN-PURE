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
      const rowsForQuery = query => {
        const rows = Object.values(mockState.rows || {})
        if (!query || Object.keys(query).length === 0) return rows
        if (query.tournamentId) return rows.filter(row => row.tournamentId === query.tournamentId)
        if (query.$and) {
          return query.$and.reduce((acc, part) => acc.filter(row => {
            if (part.tournamentId) return row.tournamentId === part.tournamentId
            return true
          }), rows)
        }
        return rows
      }
      return {
        doc: id => ({
          get: jest.fn(async () => ({ data: mockState.rows[id] || null })),
          update: jest.fn(async ({ data }) => {
            mockState.rows[id] = { ...(mockState.rows[id] || { _id: id }), ...data }
            return { updated: 1 }
          }),
          remove: jest.fn(async () => {
            delete mockState.rows[id]
            return { removed: 1 }
          }),
        }),
        where: jest.fn(query => mockChainableQuery(rowsForQuery(query))),
        add: jest.fn(async ({ data }) => {
          mockState.rows[data._id] = { ...data }
          return { _id: data._id }
        }),
      }
    }

    if (name === 'tournaments') {
      return {
        doc: id => ({
          get: jest.fn(async () => ({ data: mockState.tournaments[id] || null })),
        }),
        where: jest.fn(() => mockChainableQuery([])),
      }
    }

    if (name === 'members') {
      return {
        where: jest.fn(() => mockChainableQuery(mockState.member ? [mockState.member] : [])),
      }
    }

    return {
      doc: () => ({ get: jest.fn(async () => ({ data: null })) }),
      where: jest.fn(() => mockChainableQuery([])),
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

function setState({ scheduleStatus, isAdmin = false }) {
  const tournament = { _id: 't1' }
  if (scheduleStatus !== 'missing') tournament.scheduleStatus = scheduleStatus
  mockState = {
    openid: isAdmin ? 'admin-openid' : 'member-openid',
    member: { _id: isAdmin ? 'admin1' : 'member1', openid: isAdmin ? 'admin-openid' : 'member-openid', isAdmin },
    rows: {
      r1: { _id: 'r1', tournamentId: 't1', resultStatus: 'pending' },
    },
    tournaments: { t1: tournament },
  }
}

const validMatchData = {
  tournamentId: 't1',
  round: 1,
  type: 'singles',
  players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
  status: 'completed',
  winnerId: 'a',
  loserId: 'b',
  score: '4-2',
}

describe('direct get schedule visibility gate', () => {
  test.each([
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 'draft' },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: 'draft' },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 'none' },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: 'none' },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: null },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: '' },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 'ready' },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: false },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 0 },
  ])('blocks non-admin $action when scheduleStatus is $scheduleStatus', async ({ action, payload, scheduleStatus }) => {
    setState({ scheduleStatus })

    const res = await main({ action, ...payload })

    expect(res).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '赛程发布后才能录入成绩' },
    })
  })

  test.each([
    ['missing'],
    ['published'],
  ])('allows non-admin direct get when scheduleStatus is %s', async (scheduleStatus) => {
    setState({ scheduleStatus })

    const res = await main({ action: 'get', id: 'r1' })

    expect(res).toEqual({ data: mockState.rows.r1 })
  })

  test('allows admin direct get when scheduleStatus is draft', async () => {
    setState({ scheduleStatus: 'draft', isAdmin: true })

    const res = await main({ action: 'getById', id: 'r1' })

    expect(res).toEqual({ data: mockState.rows.r1 })
  })

  test('blocks non-admin getByTournament when scheduleStatus is draft', async () => {
    setState({ scheduleStatus: 'draft' })

    const res = await main({ action: 'getByTournament', data: { tournamentId: 't1' } })

    expect(res).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '赛程发布后才能录入成绩' },
    })
  })

  test('allows legacy getByTournament when scheduleStatus is missing', async () => {
    setState({ scheduleStatus: 'missing' })

    const res = await main({ action: 'getByTournament', data: { tournamentId: 't1' } })

    expect(res).toEqual({ data: [mockState.rows.r1] })
  })

  test('filters non-admin broad list to published and legacy tournaments', async () => {
    setState({ scheduleStatus: 'published' })
    mockState.tournaments = {
      published: { _id: 'published', scheduleStatus: 'published' },
      draft: { _id: 'draft', scheduleStatus: 'draft' },
      legacy: { _id: 'legacy' },
    }
    mockState.rows = {
      publishedRow: { _id: 'publishedRow', tournamentId: 'published', resultStatus: 'pending' },
      draftRow: { _id: 'draftRow', tournamentId: 'draft', resultStatus: 'pending' },
      legacyRow: { _id: 'legacyRow', tournamentId: 'legacy', resultStatus: 'pending' },
    }

    const res = await main({ action: 'list', data: {} })

    expect(res.data.map(row => row._id)).toEqual(['publishedRow', 'legacyRow'])
  })

  test('admin broad list includes draft tournament rows', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    mockState.tournaments = {
      draft: { _id: 'draft', scheduleStatus: 'draft' },
    }
    mockState.rows = {
      draftRow: { _id: 'draftRow', tournamentId: 'draft', resultStatus: 'pending' },
    }

    const res = await main({ action: 'list', data: {} })

    expect(res.data.map(row => row._id)).toEqual(['draftRow'])
  })

  test('filters non-admin getByPlayer to published and legacy tournaments', async () => {
    setState({ scheduleStatus: 'published' })
    mockState.tournaments = {
      published: { _id: 'published', scheduleStatus: 'published' },
      draft: { _id: 'draft', scheduleStatus: 'draft' },
      legacy: { _id: 'legacy' },
    }
    mockState.rows = {
      publishedRow: { _id: 'publishedRow', tournamentId: 'published', winnerId: 'p1', resultStatus: 'pending' },
      draftRow: { _id: 'draftRow', tournamentId: 'draft', winnerId: 'p1', resultStatus: 'pending' },
      legacyRow: { _id: 'legacyRow', tournamentId: 'legacy', winnerId: 'p1', resultStatus: 'pending' },
    }

    const res = await main({ action: 'getByPlayer', data: { playerId: 'p1' } })

    expect(res.data.map(row => row._id)).toEqual(['publishedRow', 'legacyRow'])
  })

  test('bulkUpsertScheduledMatches preserves group stage fields', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    mockState.tournaments.t1 = {
      _id: 't1',
      seasonId: 'season_2026',
      type: 'singles',
      format: 'group_knockout',
      scheduleStatus: 'published'
    }

    const result = await main({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 't1',
      matches: [{
        matchId: 'gk_t1_gA_p1',
        matchKind: 'group',
        stage: 'group',
        groupCode: 'A',
        round: 1,
        position: 1,
        type: 'singles',
        player1: { id: 'a1', name: 'A1' },
        player2: { id: 'a2', name: 'A2' }
      }],
      queues: []
    })

    expect(result.success).toBe(true)
    expect(mockState.rows.result_t1_gk_t1_gA_p1).toMatchObject({
      matchKind: 'group',
      stage: 'group',
      groupCode: 'A',
      tournamentType: 'singles',
      playerIds: ['a1', 'a2']
    })
  })
})

describe('direct legacy score writes schedule gate', () => {
  test.each([
    ['add', { data: { ...validMatchData, _id: 'r_add' } }],
    ['update', { id: 'r1', data: validMatchData }],
    ['updateScore', { id: 'r1', data: { score: '4-2', winnerId: 'a', loserId: 'b' } }],
    ['submit-result', { data: { matchId: 'r1', submittedBy: 'member1', role: 'player', winnerIds: ['a'], score: '4-2' } }],
  ])('blocks %s when scheduleStatus is draft', async (action, payload) => {
    setState({ scheduleStatus: 'draft' })

    const res = await main({ action, ...payload })

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' },
    })
  })

  test.each([
    ['missing'],
    ['published'],
  ])('allows updateScore when scheduleStatus is %s', async (scheduleStatus) => {
    setState({ scheduleStatus })

    const res = await main({
      action: 'updateScore',
      id: 'r1',
      data: { score: '4-2', winnerId: 'a', loserId: 'b' },
    })

    expect(res).toEqual({ updated: 1 })
    expect(mockState.rows.r1.score).toBe('4-2')
  })

  test('blocks non-admin bulkUpsertScheduledMatches', async () => {
    setState({ scheduleStatus: 'published' })

    const res = await main({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 't1',
      matches: [],
      queues: [],
    })

    expect(res).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '需要管理员权限' },
    })
  })

  test('allows admin bulkUpsertScheduledMatches past auth gate', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })

    const res = await main({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 't1',
      matches: [],
      queues: [],
    })

    expect(res).toEqual({ success: true, data: { count: 0 } })
  })
})
