function loadPage(app) {
  jest.resetModules()
  let pageDef
  global.getApp = () => app
  global.wx = {
    switchTab: jest.fn(),
    navigateTo: jest.fn(),
    showToast: jest.fn(),
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn()
  }
  global.Page = def => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../index')
  return pageDef
}

function makeCtx(def) {
  return {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (!key.includes('.')) {
          this.data[key] = value
          continue
        }
        const parts = key.split('.')
        let target = this.data
        for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]]
        target[parts[parts.length - 1]] = value
      }
    }
  }
}

describe('home stats', () => {
  afterEach(() => {
    delete global.getApp
    delete global.wx
    delete global.Page
  })

  test('maps player detail style singles and doubles stats', async () => {
    const member = { _id: 'member-1', name: '乐乐' }
    const app = { globalData: { currentMember: member, isAdmin: true } }
    const def = loadPage(app)
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValue({
      result: {
        data: {
          stats: {
            singles: { winCount: 15, lossCount: 0, totalPoints: 2940 },
            doubles: { winCount: 18, lossCount: 2, totalPoints: 1780, winRate: 0.9 }
          }
        }
      }
    })
    const ctx = makeCtx(def)

    await ctx.loadHome()

    expect(ctx.data.myStats).toEqual({
      singles: { wins: 15, total: 15, winRateLabel: '100%', totalPoints: 2940 },
      doubles: { wins: 18, total: 20, winRateLabel: '90%', totalPoints: 1780 }
    })
  })

  test('uses fresh cached home stats without calling cloud', async () => {
    const member = { _id: 'member-1', name: '乐乐' }
    const app = { globalData: { currentMember: member, isAdmin: false } }
    const def = loadPage(app)
    const { callFunction } = require('../../../utils/cloud')
    wx.getStorageSync.mockReturnValue({
      value: {
        myStats: {
          singles: { wins: 1, total: 2, winRateLabel: '50%', totalPoints: 30 },
          doubles: { wins: 0, total: 0, winRateLabel: '—', totalPoints: 0 }
        }
      },
      updatedAt: 1000,
      expiresAt: Date.now() + 60 * 1000
    })
    const ctx = makeCtx(def)

    await ctx.loadHome()

    expect(callFunction).not.toHaveBeenCalled()
    expect(ctx.data.myStats.singles.totalPoints).toBe(30)
  })

  test('home page exposes a June-only Pride skin class and label', () => {
    const fs = require('fs')
    const path = require('path')
    const wxml = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8')

    expect(wxml).toContain("{{isPrideMonthSkinActive ? 'theme-pride-month' : ''}}")
    expect(wxml).toContain('hero-pride-waves pride-s-curve')
    expect(wxml).toContain('pride-wave-orange')
    expect(wxml).toContain('hero-bg-num-blur')
    expect(wxml).toContain('PRIDE MONTH')
  })

  test('home Pride wave uses violet as a compact trailing band', () => {
    const fs = require('fs')
    const path = require('path')
    const wxss = fs.readFileSync(path.join(__dirname, '..', 'index.wxss'), 'utf8')

    expect(wxss).toContain('.hero-pride-waves .pride-wave-violet')
    expect(wxss).toContain('top: 342rpx;')
    expect(wxss).toContain('height: 104rpx;')
  })

  test('home Pride wave gives red orange and yellow more visual weight', () => {
    const fs = require('fs')
    const path = require('path')
    const wxss = fs.readFileSync(path.join(__dirname, '..', 'index.wxss'), 'utf8')

    expect(wxss).toContain('.hero-pride-waves .pride-wave-red')
    expect(wxss).toContain('height: 154rpx;')
    expect(wxss).toContain('height: 168rpx;')
    expect(wxss).toContain('height: 164rpx;')
  })
})
