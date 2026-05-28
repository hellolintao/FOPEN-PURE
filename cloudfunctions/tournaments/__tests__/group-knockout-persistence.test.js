const mockAdd = jest.fn()
const mockServerDateValue = { __type: 'serverDate' }

jest.mock('wx-server-sdk', () => {
  const db = {
    command: {},
    serverDate: jest.fn(() => mockServerDateValue),
    collection: jest.fn(() => ({
      add: mockAdd,
    })),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: '' })),
  }
})

const { main, __test__ } = require('../index')

describe('group_knockout persistence', () => {
  beforeEach(() => {
    mockAdd.mockReset()
    mockAdd.mockResolvedValue({ _id: 'tournament_group_knockout_16' })
  })

  test('normalizes group knockout payload defaults', () => {
    expect(__test__.normalizeTournamentPayload({
      format: 'group_knockout',
      bracketSize: 12,
      maxPlayers: 16,
      scheduleStatus: 'published',
    })).toEqual(expect.objectContaining({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 12,
      maxPlayers: 12,
      scheduleStatus: 'none',
      groupDrawMode: 'onsite',
      groupKnockoutPhase: 'group_draft',
      groupRankSnapshot: null,
      knockoutSeedSnapshot: null,
    }))
  })

  test('create persists normalized group knockout fields', async () => {
    const result = await main({
      action: 'create',
      data: validTournament({
        _id: 'tournament_group_knockout_16',
        format: 'group_knockout',
        type: 'doubles',
        bracketSize: 16,
        maxPlayers: 24,
        scheduleStatus: 'published',
        schedulePlan: null,
        groupDrawMode: 'random',
        groupKnockoutPhase: 'knockout_published',
        groupRankSnapshot: [{ groupCode: 'A', ranks: [] }],
        knockoutSeedSnapshot: [{ seed: 1, source: 'A1' }],
      }),
    })

    expect(result.success).toBe(true)
    expect(mockAdd).toHaveBeenCalledTimes(1)
    expect(mockAdd.mock.calls[0][0].data).toEqual(expect.objectContaining({
      _id: 'tournament_group_knockout_16',
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      maxPlayers: 16,
      scheduleStatus: 'none',
      schedulePlan: null,
      groupDrawMode: 'random',
      groupKnockoutPhase: 'knockout_published',
      groupRankSnapshot: [{ groupCode: 'A', ranks: [] }],
      knockoutSeedSnapshot: [{ seed: 1, source: 'A1' }],
    }))
  })
})

function validTournament(overrides = {}) {
  return {
    name: '小组赛淘汰赛',
    type: 'singles',
    format: 'regular',
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    schedulePlan: {
      slotMinutes: 20,
      courts: [
        {
          courtId: 'c1',
          name: '1号场地',
          slots: [{ slotId: 's1', start: '08:00', end: '08:20' }],
        },
      ],
    },
    pointsRules: {
      winLoss: { win: 100, loss: 20, walkover: 50 },
      placement: {
        champion: 500,
        runnerUp: 300,
        semifinal: 150,
        quarterfinal: 75,
        participation: 10,
      },
    },
    ...overrides,
  }
}
