function loadPage() {
  jest.resetModules()
  let pageDef
  global.getApp = () => ({ globalData: { currentMember: { _id: 'me' } } })
  global.wx = {
    navigateTo: jest.fn(),
    showToast: jest.fn(),
  }
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...def.data, ...data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
}

test('loadRank maps decimal win rate to percent label', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValue({ result: { data: { rankList: [{ memberId: 'A', winRate: 0.75 }] } } })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadRank()

  expect(callFunction).toHaveBeenCalledWith({
    name: 'points-engine',
    data: { action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' },
  })
  expect(ctx.data.rankList).toEqual([{ memberId: 'A', winRate: 0.75, winRatePct: '75%' }])
  expect(ctx.data.loading).toBe(false)
})

test('onStarTap navigates to player detail', () => {
  const def = loadPage()
  const ctx = makeCtx(def, { starHero: { star: { memberId: 'A' } } })

  ctx.onStarTap()

  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/player-detail/index?id=A' })
})

test('onTabChange changes active tab and reloads rank and hero', () => {
  const def = loadPage()
  const ctx = makeCtx(def, { activeTab: 'singles' })
  ctx.loadRank = jest.fn()
  ctx.loadHero = jest.fn()

  ctx.onTabChange({ detail: { value: 'doubles' }, currentTarget: { dataset: {} } })

  expect(ctx.data.activeTab).toBe('doubles')
  expect(ctx.loadRank).toHaveBeenCalled()
  expect(ctx.loadHero).toHaveBeenCalled()
})
