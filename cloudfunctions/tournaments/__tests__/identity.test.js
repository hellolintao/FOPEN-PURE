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
