function loadPage() {
  jest.resetModules()
  let pageDef
  const callFunction = jest.fn().mockResolvedValue({ result: { data: [] } })
  const database = jest.fn(() => ({ collection: jest.fn() }))
  global.wx = {
    navigateTo: jest.fn(),
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    cloud: { callFunction, database }
  }
  global.Page = (def) => { pageDef = def }
  require('../index')
  return { pageDef, callFunction, database }
}

function makeCtx(def) {
  return {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
}

afterEach(() => {
  delete global.wx
  delete global.Page
})

test('loadBracketsList uses fresh cached admin data without calling cloud', async () => {
  const { pageDef, callFunction, database } = loadPage()
  wx.getStorageSync.mockReturnValue({
    value: {
      bracketsList: [{ _id: 'b1', tournamentId: 't1' }],
      tournamentsMap: { t1: { name: 'Cached Open' } }
    },
    updatedAt: 1000,
    expiresAt: Date.now() + 60 * 1000
  })
  const ctx = makeCtx(pageDef)

  await ctx.loadBracketsList()

  expect(callFunction).not.toHaveBeenCalled()
  expect(database).not.toHaveBeenCalled()
  expect(ctx.data.loading).toBe(false)
  expect(ctx.data.bracketsList).toEqual([{ _id: 'b1', tournamentId: 't1' }])
  expect(ctx.data.tournamentsMap.t1.name).toBe('Cached Open')
})
