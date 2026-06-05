function loadPage() {
  jest.resetModules()
  let pageDef
  global.getApp = () => ({ globalData: { currentMember: { _id: 'me' } } })
  global.wx = {
    navigateTo: jest.fn(),
    showToast: jest.fn(),
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    removeStorageSync: jest.fn(),
  }
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../index')
  return pageDef
}

test('header copy says rank data updates every 2 hours', () => {
  const fs = require('fs')
  const path = require('path')
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8')

  expect(wxml).toContain('每2小时更新')
  expect(wxml).not.toContain('每日23:30更新')
  expect(wxml).not.toContain('实时更新')
})

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
  callFunction.mockResolvedValue({ result: { data: { rankList: [{ memberId: 'A', winCount: 3, lossCount: 1, winRate: 0.75 }] } } })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadRank()

  expect(callFunction).toHaveBeenCalledWith({
    name: 'points-engine',
    data: { action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' },
    config: { timeout: 20000 },
  })
  expect(ctx.data.rankList).toEqual([{ memberId: 'A', winCount: 3, lossCount: 1, winRate: 0.75, winRatePct: '75%' }])
  expect(ctx.data.loading).toBe(false)
})

test('loadRank uses an extended cloud timeout for cold rank cache rebuilds', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValue({ result: { data: { rankList: [] } } })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadRank()

  expect(callFunction).toHaveBeenCalledWith({
    name: 'points-engine',
    data: { action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' },
    config: { timeout: 20000 },
  })
})

test('loadRank caches populated rank rows for 2 hours', async () => {
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1000)
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValue({
    result: { data: { rankList: [{ memberId: 'A', winCount: 3, lossCount: 1, winRate: 0.75 }] } }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadRank()

  const cacheEntry = wx.setStorageSync.mock.calls[0][1]
  expect(cacheEntry.expiresAt).toBe(1000 + 2 * 60 * 60 * 1000)
  nowSpy.mockRestore()
})

test('loadHero caches weekly star data for 2 hours', async () => {
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2000)
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValue({
    result: { data: { mode: 'current', star: { memberId: 'A' }, subtitle: 'hot' } }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadHero()

  const cacheEntry = wx.setStorageSync.mock.calls[0][1]
  expect(cacheEntry.expiresAt).toBe(2000 + 2 * 60 * 60 * 1000)
  nowSpy.mockRestore()
})

test('loadHero renders cached weekly star but still refreshes from cloud', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  wx.getStorageSync.mockReturnValue({
    value: {
      starHero: { mode: 'current', star: { memberId: 'OLD' }, subtitle: '旧缓存' }
    },
    updatedAt: 1000,
    expiresAt: Date.now() + 60 * 1000
  })
  callFunction.mockResolvedValue({
    result: { data: { mode: 'empty', weekStart: '2026-05-25', weekEnd: '2026-05-31', star: null, subtitle: null } }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadHero()

  expect(callFunction).toHaveBeenCalledWith({
    name: 'weekly-star',
    data: { action: 'current', seasonId: 'season_2026', type: 'singles' }
  })
  expect(ctx.data.starHero).toEqual({
    mode: 'empty',
    weekStart: '2026-05-25',
    weekEnd: '2026-05-31',
    star: null,
    subtitle: null
  })
})

test('weekly star hero copy uses previous-week language', () => {
  const fs = require('fs')
  const path = require('path')
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8')

  expect(wxml).toContain('上周之星')
  expect(wxml).not.toContain('等本周首场')
})

test('rank page passes the June-only Pride skin flag to weekly star and personal highlight', () => {
  const fs = require('fs')
  const path = require('path')
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8')

  expect(wxml).toContain("{{isPrideMonthSkinActive ? 'theme-pride-month' : ''}}")
  expect(wxml).toContain('star-pride-waves pride-s-curve')
  expect(wxml).toContain('pride-wave-green')
  expect(wxml).toContain('pride-highlight="{{isPrideMonthSkinActive && currentMember && item._id === currentMember._id}}"')
})

test('loadRank shows 0% for played matches and dash only for no matches', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValue({
    result: {
      data: {
        rankList: [
          { memberId: 'A', winCount: 0, lossCount: 8, winRate: 0 },
          { memberId: 'B', winCount: 0, lossCount: 0, winRate: 0 },
        ],
      },
    },
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadRank()

  expect(ctx.data.rankList[0].winRatePct).toBe('0%')
  expect(ctx.data.rankList[1].winRatePct).toBe('—')
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

test('loadRank renders fresh 2-hour page cache before refreshing cloud profile data', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  wx.getStorageSync.mockReturnValue({
    value: {
      rankList: [
        { _id: 'A', name: '旧头像用户', avatarUrl: 'stale.png', winCount: 1, lossCount: 0, winRate: 1, winRatePct: '100%' }
      ]
    },
    updatedAt: 1000,
    expiresAt: Date.now() + 60 * 1000
  })
  callFunction.mockResolvedValue({
    result: {
      data: {
        rankList: [
          { _id: 'A', name: '新头像用户', avatarUrl: 'fresh.png', winCount: 1, lossCount: 0, winRate: 1 }
        ]
      }
    }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadRank()

  expect(callFunction).toHaveBeenCalledWith({
    name: 'points-engine',
    data: { action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' },
    config: { timeout: 20000 },
  })
  expect(ctx.data.rankList).toEqual([
    { _id: 'A', name: '新头像用户', avatarUrl: 'fresh.png', winCount: 1, lossCount: 0, winRate: 1, winRatePct: '100%' }
  ])
})

test('loadRank ignores fresh empty page cache and fetches cloud data', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  wx.getStorageSync.mockReturnValue({
    value: { rankList: [] },
    updatedAt: 1000,
    expiresAt: Date.now() + 60 * 1000
  })
  callFunction.mockResolvedValue({
    result: {
      data: {
        rankList: [
          { _id: 'A', winCount: 2, lossCount: 0, winRate: 1 }
        ]
      }
    }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })

  await ctx.loadRank()

  expect(callFunction).toHaveBeenCalledWith({
    name: 'points-engine',
    data: { action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' },
    config: { timeout: 20000 },
  })
  expect(ctx.data.rankList).toEqual([
    { _id: 'A', winCount: 2, lossCount: 0, winRate: 1, winRatePct: '100%' }
  ])
})

test('loadRank surfaces cloud failure envelopes instead of showing an empty list', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  callFunction.mockResolvedValue({
    result: {
      success: false,
      error: { code: 'INTERNAL', message: 'database index missing' }
    }
  })
  const ctx = makeCtx(def, {
    activeTab: 'singles',
    seasonYear: 2026,
    rankList: [{ _id: 'existing' }]
  })

  await ctx.loadRank()

  expect(wx.showToast).toHaveBeenCalledWith({ title: '加载失败', icon: 'none', duration: 2000 })
  expect(ctx.data.rankList).toEqual([{ _id: 'existing' }])
  errorSpy.mockRestore()
})
