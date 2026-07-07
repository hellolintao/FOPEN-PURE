const mockTournaments = new Map()
const mockUpdates = []
const mockServerDateValue = { __type: 'serverDate' }

const mockAdd = jest.fn(async ({ data }) => {
  const id = data._id || `generated_${mockTournaments.size + 1}`
  mockTournaments.set(id, { ...data, _id: id })
  return { _id: id }
})

const mockCollection = jest.fn((name) => {
  if (name === 'members') {
    return {
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ data: [{ _id: 'admin1', openid: 'admin-openid', admin: true }] })),
      })),
    }
  }

  if (name !== 'tournaments') {
    return {
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ data: [] })),
      })),
    }
  }

  return {
    add: mockAdd,
    doc: jest.fn((id) => ({
      get: jest.fn(async () => {
        if (!mockTournaments.has(id)) throw new Error('not found')
        return { data: mockTournaments.get(id) }
      }),
      update: jest.fn(async ({ data }) => {
        const current = mockTournaments.get(id) || { _id: id }
        mockUpdates.push({ id, data })
        mockTournaments.set(id, { ...current, ...data })
        return { stats: { updated: 1 } }
      }),
    })),
  }
})

jest.mock('wx-server-sdk', () => {
  const db = {
    command: {
      or: jest.fn((conditions) => ({ $or: conditions })),
      set: jest.fn((value) => value),
    },
    serverDate: jest.fn(() => mockServerDateValue),
    collection: mockCollection,
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: 'admin-openid' })),
  }
})

const { main } = require('../index')

describe('group_knockout persistence', () => {
  beforeEach(() => {
    mockTournaments.clear()
    mockUpdates.length = 0
    mockAdd.mockClear()
    mockCollection.mockClear()
  })

  test.each([
    ['explicit non-singles type', { type: 'doubles' }, '小组赛+淘汰赛只支持 singles 类型'],
    ['explicit empty type', { type: '' }, '小组赛+淘汰赛只支持 singles 类型'],
    ['explicit null type', { type: null }, '小组赛+淘汰赛只支持 singles 类型'],
    ['explicit mismatched maxPlayers', { maxPlayers: 12 }, '小组赛+淘汰赛 maxPlayers 必须等于 bracketSize'],
    ['explicit null maxPlayers', { maxPlayers: null }, '小组赛+淘汰赛 maxPlayers 必须等于 bracketSize'],
    ['explicit published scheduleStatus', { scheduleStatus: 'published' }, '小组赛+淘汰赛 scheduleStatus 必须是 none'],
  ])('create rejects %s before persistence normalization', async (_label, overrides, expectedError) => {
    const result = await main({
      action: 'create',
      data: validGroupTournament({
        _id: 'tournament_invalid_group',
        ...overrides,
      }),
    })

    expect(result.success).toBe(false)
    expect(result.error.errors).toContain(expectedError)
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockTournaments.has('tournament_invalid_group')).toBe(false)
  })

  test('legacy add rejects explicit null maxPlayers before persistence normalization', async () => {
    const result = await main({
      action: 'add',
      data: validGroupTournament({
        _id: 'tournament_legacy_add_null_max',
        maxPlayers: null,
      }),
    })

    expect(result.errMsg).toBe('validation failed')
    expect(result.errors).toContain('小组赛+淘汰赛 maxPlayers 必须等于 bracketSize')
    expect(mockAdd).not.toHaveBeenCalled()
    expect(mockTournaments.has('tournament_legacy_add_null_max')).toBe(false)
  })

  test('create defaults missing group knockout fields after validation', async () => {
    const data = validGroupTournament({
      _id: 'tournament_group_defaults',
      bracketSize: 16,
    })
    delete data.type
    delete data.maxPlayers
    delete data.scheduleStatus
    delete data.groupDrawMode
    delete data.groupKnockoutPhase

    const result = await main({ action: 'create', data })

    expect(result.success).toBe(true)
    expect(mockTournaments.get('tournament_group_defaults')).toEqual(expect.objectContaining({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      maxPlayers: 16,
      scheduleStatus: 'none',
      groupDrawMode: 'onsite',
      groupKnockoutPhase: 'group_draft',
      groupRankSnapshot: null,
      knockoutSeedSnapshot: null,
    }))
  })

  test('legacy add persists normalized group knockout defaults', async () => {
    const data = validGroupTournament({
      _id: 'tournament_legacy_add',
      bracketSize: 12,
    })
    delete data.maxPlayers
    delete data.scheduleStatus
    delete data.groupDrawMode
    delete data.groupKnockoutPhase

    await main({ action: 'add', data })

    expect(mockTournaments.get('tournament_legacy_add')).toEqual(expect.objectContaining({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 12,
      maxPlayers: 12,
      scheduleStatus: 'none',
      groupDrawMode: 'onsite',
      groupKnockoutPhase: 'group_draft',
    }))
  })

  test('legacy update persists normalized group knockout defaults', async () => {
    mockTournaments.set('tournament_legacy_update', { _id: 'tournament_legacy_update', name: '旧赛事' })
    const data = validGroupTournament({
      name: '旧入口更新',
      bracketSize: 12,
    })
    delete data.maxPlayers
    delete data.scheduleStatus

    await main({ action: 'update', id: 'tournament_legacy_update', data })

    expect(mockTournaments.get('tournament_legacy_update')).toEqual(expect.objectContaining({
      name: '旧入口更新',
      format: 'group_knockout',
      bracketSize: 12,
      maxPlayers: 12,
      scheduleStatus: 'none',
    }))
  })

  test('legacy update rejects explicit null maxPlayers without persisting it', async () => {
    mockTournaments.set('tournament_legacy_update_null', currentGroupTournament({
      _id: 'tournament_legacy_update_null',
      maxPlayers: 16,
    }))

    const result = await main({
      action: 'update',
      id: 'tournament_legacy_update_null',
      data: validGroupTournament({ maxPlayers: null }),
    })

    expect(result.errMsg).toBe('validation failed')
    expect(result.errors).toContain('小组赛+淘汰赛 maxPlayers 必须等于 bracketSize')
    expect(mockUpdates).toEqual([])
    expect(mockTournaments.get('tournament_legacy_update_null').maxPlayers).toBe(16)
  })

  test('updateNew rejects bad maxPlayers patch against current bracketSize', async () => {
    mockTournaments.set('tournament_update_new', currentGroupTournament({
      bracketSize: 16,
      maxPlayers: 16,
    }))

    const result = await main({
      action: 'updateNew',
      id: 'tournament_update_new',
      data: { maxPlayers: 14 },
    })

    expect(result.success).toBe(false)
    expect(result.error.errors).toContain('小组赛+淘汰赛 maxPlayers 必须等于 bracketSize')
    expect(mockUpdates).toEqual([])
  })

  test('updateNew rejects explicit null maxPlayers patch without persisting it', async () => {
    mockTournaments.set('tournament_update_new_null', currentGroupTournament({
      _id: 'tournament_update_new_null',
      bracketSize: 16,
      maxPlayers: 16,
    }))

    const result = await main({
      action: 'updateNew',
      id: 'tournament_update_new_null',
      data: { maxPlayers: null },
    })

    expect(result.success).toBe(false)
    expect(result.error.errors).toContain('小组赛+淘汰赛 maxPlayers 必须等于 bracketSize')
    expect(mockUpdates).toEqual([])
    expect(mockTournaments.get('tournament_update_new_null').maxPlayers).toBe(16)
  })

  test('updateNew derives maxPlayers when bracketSize changes', async () => {
    mockTournaments.set('tournament_resize', currentGroupTournament({
      bracketSize: 16,
      maxPlayers: 16,
    }))

    const result = await main({
      action: 'updateNew',
      id: 'tournament_resize',
      data: { bracketSize: 12 },
    })

    expect(result.success).toBe(true)
    expect(mockUpdates[0].data).toEqual(expect.objectContaining({
      bracketSize: 12,
      maxPlayers: 12,
    }))
    expect(mockUpdates[0].data).not.toHaveProperty('groupRankSnapshot')
    expect(mockUpdates[0].data).not.toHaveProperty('knockoutSeedSnapshot')
  })

  test('partial updateNew does not rewrite unrelated group knockout state', async () => {
    mockTournaments.set('tournament_partial', currentGroupTournament({
      groupDrawMode: 'preset',
      groupKnockoutPhase: 'group_published',
      groupRankSnapshot: [{ groupCode: 'A', ranks: [{ memberId: 'm1' }] }],
      knockoutSeedSnapshot: [{ seed: 1, source: 'A1' }],
    }))

    const result = await main({
      action: 'updateNew',
      id: 'tournament_partial',
      data: { name: '只改名称' },
    })

    expect(result.success).toBe(true)
    expect(mockUpdates[0].data).toEqual({
      name: '只改名称',
      updateTime: mockServerDateValue,
    })
  })
})

function validGroupTournament(overrides = {}) {
  return {
    name: '小组赛淘汰赛',
    type: 'singles',
    format: 'group_knockout',
    bracketSize: 16,
    maxPlayers: 16,
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    schedulePlan: null,
    pointsRules: validPointsRules(),
    ...overrides,
  }
}

function currentGroupTournament(overrides = {}) {
  return {
    _id: 'tournament_current',
    status: 'upcoming',
    scheduleStatus: 'none',
    groupDrawMode: 'onsite',
    groupKnockoutPhase: 'group_draft',
    groupRankSnapshot: null,
    knockoutSeedSnapshot: null,
    ...validGroupTournament(),
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
