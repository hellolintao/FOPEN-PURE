jest.mock('wx-server-sdk', () => {
  const db = {
    command: {},
    collection: jest.fn(() => ({})),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: '' })),
  }
})

const { __test__ } = require('../index')

function makeMemberDb(member) {
  let whereFilter = null
  return {
    get whereFilter() {
      return whereFilter
    },
    collection: jest.fn(() => ({
      where: filter => {
        whereFilter = filter
        return {
          get: async () => ({ data: member ? [member] : [] }),
        }
      },
    })),
  }
}

test('resolveMemberByOpenid matches openid and openId rows', async () => {
  const command = { or: conditions => ({ $or: conditions }) }
  const db = makeMemberDb({ _id: 'memberA', openId: 'wx_openid_A', admin: true })

  const member = await __test__.resolveMemberByOpenid('wx_openid_A', db, command)

  expect(db.whereFilter).toEqual({ $or: [{ openid: 'wx_openid_A' }, { openId: 'wx_openid_A' }] })
  expect(member).toEqual(expect.objectContaining({ _id: 'memberA', openid: 'wx_openid_A' }))
})

test('isAdminMember accepts admin and isAdmin flags', () => {
  expect(__test__.isAdminMember({ admin: true })).toBe(true)
  expect(__test__.isAdminMember({ isAdmin: true })).toBe(true)
  expect(__test__.isAdminMember({ admin: false, isAdmin: false })).toBe(false)
})

test('validateTournament accepts regular mixed tournament', () => {
  const errors = __test__.validateTournament({
    name: '混合常规赛',
    type: 'mixed',
    format: 'regular',
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    schedulePlan: validSchedulePlan(),
    pointsRules: validPointsRules()
  }, { isDraft: false })

  expect(errors).toEqual([])
})

test('validateTournament rejects knockout mixed tournament', () => {
  const errors = __test__.validateTournament({
    name: '混合淘汰赛',
    type: 'mixed',
    format: 'knockout',
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    maxPlayers: 8,
    schedulePlan: validSchedulePlan(),
    pointsRules: validPointsRules()
  }, { isDraft: false })

  expect(errors).toContain('淘汰赛不支持 mixed 类型')
})

function validSchedulePlan() {
  return {
    slotMinutes: 20,
    courts: [
      {
        courtId: 'c1',
        name: '1号场',
        slots: ['2026-05-25T08:00', '2026-05-25T08:20', '2026-05-25T08:40']
      }
    ]
  }
}

function validPointsRules() {
  return {
    winLoss: { win: 20, loss: 10, walkover: 0 },
    placement: { champion: 100, runnerUp: 60, semifinal: 30, quarterfinal: 10, participation: 5 }
  }
}
