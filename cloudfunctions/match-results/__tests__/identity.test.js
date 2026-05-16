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

test('resolveSubmitterByOpenid matches legacy openId member rows', async () => {
  const db = makeMemberDb({ _id: 'memberA', openId: 'wx_openid_A', admin: false })
  const command = { or: conditions => ({ $or: conditions }) }

  const submitter = await __test__.resolveSubmitterByOpenid('wx_openid_A', db, command)

  expect(db.whereFilter).toEqual({ $or: [{ openid: 'wx_openid_A' }, { openId: 'wx_openid_A' }] })
  expect(submitter).toEqual({ _id: 'memberA', openid: 'wx_openid_A', isAdmin: false })
})

test('resolveSubmitterByOpenid normalizes admin from admin or isAdmin flags', async () => {
  const command = { or: conditions => ({ $or: conditions }) }

  await expect(__test__.resolveSubmitterByOpenid('oa', makeMemberDb({ _id: 'adminA', openid: 'oa', admin: true }), command))
    .resolves.toEqual({ _id: 'adminA', openid: 'oa', isAdmin: true })
  await expect(__test__.resolveSubmitterByOpenid('ob', makeMemberDb({ _id: 'adminB', openId: 'ob', isAdmin: true }), command))
    .resolves.toEqual({ _id: 'adminB', openid: 'ob', isAdmin: true })
})
