function loadPage() {
  jest.resetModules()
  let pageDef
  const callFunction = jest.fn().mockResolvedValue({ result: { data: [] } })
  const database = jest.fn(() => ({ collection: jest.fn() }))
  const call = jest.fn().mockResolvedValue({ ok: true, data: { groups: [] } })
  jest.doMock('../../../utils/cloud', () => ({ call }))
  global.wx = {
    navigateTo: jest.fn(),
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    cloud: { callFunction, database }
  }
  global.Page = (def) => { pageDef = def }
  require('../index')
  return { pageDef, callFunction, database, call }
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

test('loadBracketsList refreshes fresh cached admin data so stale pending cards disappear', async () => {
  const { pageDef, callFunction, database, call } = loadPage()
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

  expect(call).toHaveBeenCalledWith('match-results', {
    action: 'pendingEntryGroups',
    payload: { limit: 50 }
  })
  expect(callFunction).not.toHaveBeenCalled()
  expect(database).not.toHaveBeenCalled()
  expect(ctx.data.loading).toBe(false)
  expect(ctx.data.bracketsList).toEqual([])
  expect(ctx.data.tournamentsMap).toEqual({})
})

test('loadBracketsList maps pending entry groups into bracket cards', async () => {
  const { pageDef, call, callFunction, database } = loadPage()
  wx.getStorageSync.mockReturnValue(null)
  call.mockResolvedValue({
    ok: true,
    data: {
      groups: [{
        _id: 't1:1',
        tournamentId: 't1',
        tournamentName: '5.17常规赛',
        seasonName: 'S1',
        round: 1,
        updateTime: '2026-05-18T16:44:11.706Z',
        matches: [{
          matchId: 'm1',
          resultId: 'result_t1_m1',
          player1: { id: 'p1', name: 'Ella' },
          player2: { id: 'p2', name: '海伦' },
          resultStatus: 'pending'
        }]
      }]
    }
  })
  const ctx = makeCtx(pageDef)

  await ctx.loadBracketsList()

  expect(callFunction).not.toHaveBeenCalled()
  expect(database).not.toHaveBeenCalled()
  expect(ctx.data.bracketsList).toEqual([{
    _id: 't1:1',
    tournamentId: 't1',
    tournamentName: '5.17常规赛',
    seasonName: 'S1',
    round: 1,
    updateTime: '2026-05-18T16:44:11.706Z',
    matches: [{
      matchId: 'm1',
      resultId: 'result_t1_m1',
      player1: { id: 'p1', name: 'Ella' },
      player2: { id: 'p2', name: '海伦' },
      resultStatus: 'pending'
    }]
  }])
  expect(ctx.data.tournamentsMap).toEqual({
    t1: { name: '5.17常规赛', seasonName: 'S1' }
  })
})
