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
    if (Object.prototype.hasOwnProperty.call(expected, '$gt')) {
      return actual > expected.$gt
    }
    if (Object.prototype.hasOwnProperty.call(expected, '$neq')) {
      return actual !== expected.$neq
    }
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
      const rowsForQuery = query => {
        const rows = Object.values(mockState.rows || {})
        return rows.filter(row => mockMatchesQuery(row, query))
      }
      return {
        doc: id => ({
          get: jest.fn(async () => {
            if (mockState.failNextMatchGet) {
              mockState.failNextMatchGet = false
              throw new Error('DB_UNAVAILABLE')
            }
            return { data: mockState.rows[id] || null }
          }),
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

    if (name === 'tournament_brackets') {
      return {
        where: jest.fn(query => mockChainableQuery(
          (mockState.brackets || []).filter(bracket => mockMatchesQuery(bracket, query))
        )),
      }
    }

    if (name === 'tournaments') {
      return {
        doc: id => ({
          get: jest.fn(async () => {
            if (mockState.failNextTournamentGet) {
              mockState.failNextTournamentGet = false
              throw new Error('DB_UNAVAILABLE')
            }
            return { data: mockState.tournaments[id] || null }
          }),
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
    brackets: [],
    tournaments: { t1: tournament },
    failNextMatchGet: false,
    failNextTournamentGet: false,
  }
}

function setGroupKnockoutTournament() {
  mockState.tournaments.t1 = {
    _id: 't1',
    seasonId: 'season_2026',
    type: 'singles',
    format: 'group_knockout',
    scheduleStatus: 'published'
  }
}

function groupScoreRow(overrides = {}) {
  return {
    _id: 'result_t1_gk_t1_gA_p1',
    tournamentId: 't1',
    seasonId: 'season_2026',
    tournamentType: 'singles',
    format: 'group_knockout',
    matchKind: 'group',
    sourceMatchId: 'gk_t1_gA_p1',
    stage: 'group',
    groupCode: 'A',
    round: 1,
    position: 1,
    player1: { id: 'a1', name: 'A1' },
    player2: { id: 'a2', name: 'A2' },
    playerIds: ['a1', 'a2'],
    resultStatus: 'pending',
    ...overrides
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

  test('allows non-admin direct get for group knockout group-published tournament when scheduleStatus is none', async () => {
    setState({ scheduleStatus: 'none' })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      groupKnockoutPhase: 'group_published',
      scheduleStatus: 'none',
    }

    const res = await main({ action: 'get', id: 'r1' })

    expect(res).toEqual({ data: mockState.rows.r1 })
  })

  test('allows non-admin direct get for a legacy completed group knockout without phase', async () => {
    setState({ scheduleStatus: 'none' })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      status: 'completed',
      scheduleStatus: 'none'
    }

    const res = await main({ action: 'getById', id: 'r1' })

    expect(res).toEqual({ data: mockState.rows.r1 })
  })

  test('blocks non-admin direct get for group knockout draft tournament when scheduleStatus is none', async () => {
    setState({ scheduleStatus: 'none' })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      groupKnockoutPhase: 'group_draft',
      scheduleStatus: 'none',
    }

    const res = await main({ action: 'getById', id: 'r1' })

    expect(res).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '赛程发布后才能录入成绩' },
    })
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
    setGroupKnockoutTournament()

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

  test.each(['submitted', 'confirmed'])('bulkUpsertScheduledMatches refuses to remove %s group rows', async (resultStatus) => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    setGroupKnockoutTournament()
    const staleRow = groupScoreRow({
      _id: 'result_t1_stale_group',
      sourceMatchId: 'stale_group',
      resultStatus,
      score: '4-2',
      confirmedBy: resultStatus === 'confirmed' ? 'admin1' : null
    })
    mockState.rows[staleRow._id] = staleRow
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    let result
    try {
      result = await main({
        action: 'bulkUpsertScheduledMatches',
        tournamentId: 't1',
        matches: [],
        queues: []
      })
    } finally {
      errorSpy.mockRestore()
    }

    expect(result).toEqual({
      success: false,
      error: {
        code: 'SCHEDULE_IMPACT_REQUIRES_INVALIDATION',
        message: '赛程变更影响已确认成绩，请先清空比分并重新发布'
      }
    })
    expect(mockState.rows.result_t1_stale_group).toEqual(staleRow)
  })

  test('bulkUpsertScheduledMatches removes pending stale group rows', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    setGroupKnockoutTournament()
    mockState.rows.result_t1_stale_group = groupScoreRow({
      _id: 'result_t1_stale_group',
      sourceMatchId: 'stale_group',
      resultStatus: 'pending'
    })

    const result = await main({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 't1',
      matches: [],
      queues: []
    })

    expect(result).toEqual({ success: true, data: { count: 0 } })
    expect(mockState.rows.result_t1_stale_group).toBeUndefined()
  })

  test('bulkUpsertScheduledMatches preserves confirmed group row on same-id schedule merge', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    setGroupKnockoutTournament()
    mockState.rows.result_t1_gk_t1_gA_p1 = groupScoreRow({
      stage: '',
      groupCode: '',
      resultStatus: 'confirmed',
      score: '4-2',
      confirmedBy: 'admin1',
      confirmedAt: 'confirmed-at'
    })

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
      stage: 'group',
      groupCode: 'A',
      score: '4-2',
      resultStatus: 'confirmed',
      confirmedBy: 'admin1',
      confirmedAt: 'confirmed-at'
    })
  })

  test('bulkUpsertScheduledMatches precreates only knockout skeletons for group knockout tournaments', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    setGroupKnockoutTournament()
    mockState.brackets = [
      {
        _id: 'group_round_2',
        tournamentId: 't1',
        stage: 'group',
        round: 2,
        matches: [{ matchId: 'gk_t1_group_r2_p1', round: 2, position: 1, type: 'singles' }]
      },
      {
        _id: 'knockout_round_2',
        tournamentId: 't1',
        stage: 'knockout',
        round: 2,
        matches: [{ matchId: 'gk_t1_knockout_r2_p1', round: 2, position: 1, type: 'singles' }]
      }
    ]

    const groupKnockoutResult = await main({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 't1',
      matches: [],
      queues: []
    })

    expect(groupKnockoutResult).toEqual({ success: true, data: { count: 1 } })
    expect(mockState.rows.result_t1_gk_t1_group_r2_p1).toBeUndefined()
    expect(mockState.rows.result_t1_gk_t1_knockout_r2_p1).toMatchObject({
      stage: 'knockout',
      matchKind: 'bracket',
      round: 2
    })

    setState({ scheduleStatus: 'published', isAdmin: true })
    mockState.tournaments.t1 = {
      _id: 't1',
      seasonId: 'season_2026',
      type: 'singles',
      format: 'knockout',
      scheduleStatus: 'published'
    }
    mockState.brackets = [
      {
        _id: 'regular_round_1',
        tournamentId: 't1',
        round: 1,
        matches: [{ matchId: 'regular_r1_p1', round: 1, position: 1, type: 'singles' }]
      },
      {
        _id: 'regular_round_2',
        tournamentId: 't1',
        round: 2,
        matches: [{ matchId: 'regular_r2_p1', round: 2, position: 1, type: 'singles' }]
      }
    ]

    const regularResult = await main({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 't1',
      matches: [],
      queues: []
    })

    expect(regularResult).toEqual({ success: true, data: { count: 1 } })
    expect(mockState.rows.result_t1_regular_r1_p1).toBeUndefined()
    expect(mockState.rows.result_t1_regular_r2_p1).toMatchObject({
      matchKind: 'bracket',
      round: 2
    })
  })
})

describe('direct legacy score writes schedule gate', () => {
  test.each([
    ['add', { data: { ...validMatchData, _id: 'r_add' } }],
    ['update', { id: 'r1', data: validMatchData }],
    ['updateScore', { id: 'r1', data: { score: '4-2', winnerId: 'a', loserId: 'b' } }],
  ])('blocks admin %s when scheduleStatus is draft', async (action, payload) => {
    setState({ scheduleStatus: 'draft', isAdmin: true })

    const res = await main({ action, ...payload })

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' },
    })
  })

  test('blocks participant submit-result when scheduleStatus is draft', async () => {
    setState({ scheduleStatus: 'draft' })

    const res = await main({
      action: 'submit-result',
      data: { matchId: 'r1', submittedBy: 'member1', role: 'player', winnerIds: ['a'], score: '4-2' }
    })

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' },
    })
  })

  test.each([
    ['missing'],
    ['published'],
  ])('allows admin updateScore when scheduleStatus is %s', async (scheduleStatus) => {
    setState({ scheduleStatus, isAdmin: true })

    const res = await main({
      action: 'updateScore',
      id: 'r1',
      data: { score: '4-2', winnerId: 'a', loserId: 'b' },
    })

    expect(res).toEqual({ updated: 1 })
    expect(mockState.rows.r1.score).toBe('4-2')
  })

  test('allows admin updateScore for group knockout group-published tournament when scheduleStatus is none', async () => {
    setState({ scheduleStatus: 'none', isAdmin: true })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      groupKnockoutPhase: 'group_published',
      scheduleStatus: 'none',
    }

    const res = await main({
      action: 'updateScore',
      id: 'r1',
      data: { score: '4-2', winnerId: 'a', loserId: 'b' },
    })

    expect(res).toEqual({ updated: 1 })
    expect(mockState.rows.r1.score).toBe('4-2')
  })

  test('blocks updateScore for group knockout draft tournament when scheduleStatus is none', async () => {
    setState({ scheduleStatus: 'none', isAdmin: true })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      groupKnockoutPhase: 'group_draft',
      scheduleStatus: 'none',
    }

    const res = await main({
      action: 'updateScore',
      id: 'r1',
      data: { score: '4-2', winnerId: 'a', loserId: 'b' },
    })

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' },
    })
  })

  test('blocks updateScore for cancelled group knockout even when its phase is published', async () => {
    setState({ scheduleStatus: 'none', isAdmin: true })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      status: 'cancelled',
      groupKnockoutPhase: 'group_published',
      scheduleStatus: 'none'
    }

    const res = await main({
      action: 'updateScore',
      id: 'r1',
      data: { score: '4-2', winnerId: 'a', loserId: 'b' }
    })

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' }
    })
    expect(mockState.rows.r1.score).toBeUndefined()
  })

  test('direct score write fails closed when the tournament lookup throws', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    mockState.failNextTournamentGet = true

    await expect(main({
      action: 'updateScore',
      id: 'r1',
      data: { score: '4-2', winnerId: 'a', loserId: 'b' }
    })).rejects.toThrow('DB_UNAVAILABLE')

    expect(mockState.rows.r1.score).toBeUndefined()
  })

  test('direct score write fails closed when the source row lookup throws', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    mockState.failNextMatchGet = true

    await expect(main({
      action: 'updateScore',
      id: 'r1',
      data: { score: '4-2', winnerId: 'a', loserId: 'b' }
    })).rejects.toThrow('DB_UNAVAILABLE')

    expect(mockState.rows.r1.score).toBeUndefined()
  })

  test('batch context propagates tournament lookup failures', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    mockState.failNextTournamentGet = true
    const { buildBatchCtx } = require('../index').__test__
    const ctx = buildBatchCtx({ _id: 'admin1', openid: 'admin-openid' }, true)

    await expect(ctx.db.getTournament('t1')).rejects.toThrow('DB_UNAVAILABLE')
  })

  test('blocks moving an active score row into a cancelled group knockout', async () => {
    setState({ scheduleStatus: 'published', isAdmin: true })
    mockState.tournaments.t2 = {
      _id: 't2',
      format: 'group_knockout',
      status: 'cancelled',
      groupKnockoutPhase: 'group_published',
      scheduleStatus: 'none'
    }

    const res = await main({
      action: 'update',
      id: 'r1',
      data: { ...validMatchData, tournamentId: 't2' }
    })

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' }
    })
    expect(mockState.rows.r1.tournamentId).toBe('t1')
  })

  test.each([
    ['delete', { action: 'delete', id: 'r1' }],
    ['updateStatus', { action: 'updateStatus', id: 'r1', data: { status: 'completed' } }],
    ['voidMatch', { action: 'voidMatch', matchId: 'r1', reason: '未完赛' }]
  ])('blocks %s for a cancelled group knockout', async (_label, event) => {
    setState({ scheduleStatus: 'none', isAdmin: true })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      status: 'cancelled',
      groupKnockoutPhase: 'group_published',
      scheduleStatus: 'none'
    }

    const res = await main(event)

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' }
    })
    expect(mockState.rows.r1).toMatchObject({ _id: 'r1', resultStatus: 'pending' })
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

  test('blocks bulkUpsertScheduledMatches for a cancelled group knockout', async () => {
    setState({ scheduleStatus: 'none', isAdmin: true })
    mockState.tournaments.t1 = {
      _id: 't1',
      format: 'group_knockout',
      status: 'cancelled',
      groupKnockoutPhase: 'group_published',
      scheduleStatus: 'none'
    }

    const res = await main({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 't1',
      matches: [],
      queues: []
    })

    expect(res).toEqual({
      success: false,
      error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' }
    })
    expect(mockState.rows.r1).toMatchObject({ _id: 'r1', resultStatus: 'pending' })
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
