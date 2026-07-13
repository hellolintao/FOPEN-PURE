const fs = require('fs')
const path = require('path')

jest.mock('../../../utils/page-cache', () => ({
  removeCachesByPrefix: jest.fn()
}))

const PRIVACY_PAGE_CACHE_PREFIXES = ['rank:', 'home:', 'mine:', 'match:', 'manage:']

function loadPage(callFunctionImpl, member = {}) {
  jest.resetModules()
  let pageDef
  const app = {
    globalData: {
      currentMember: {
        _id: 'member-self',
        name: '张三',
        publicProfileConsent: true,
        ...member
      },
      isAdmin: false
    }
  }
  global.getApp = () => app
  global.wx = {
    navigateTo: jest.fn(),
    showModal: jest.fn(options => {
      if (options && typeof options.success === 'function') options.success({ confirm: true })
    }),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showToast: jest.fn(),
    cloud: {
      callFunction: jest.fn(callFunctionImpl || (() => Promise.resolve({ result: { success: true } })))
    }
  }
  global.Page = (def) => { pageDef = def }
  require('../index')
  const pageCache = require('../../../utils/page-cache')
  pageCache.removeCachesByPrefix.mockClear()
  return { pageDef, app, pageCache }
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: JSON.parse(JSON.stringify({ ...def.data, ...data })),
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
}

describe('setting privacy controls', () => {
  test('app.json no longer registers the legacy tournament-view route', () => {
    const appConfig = require('../../../app.json')

    expect(appConfig.pages).not.toContain('pages/tournament-view/index')
  })

  test('renders privacy policy, user agreement, revoke, and delete controls', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('bindtap="onOpenPrivacyPolicy"')
    expect(wxml).toContain('bindtap="onOpenUserAgreement"')
    expect(wxml).toContain('bindtap="onRevokePublicProfile"')
    expect(wxml).toContain('bindtap="onDeleteAccount"')
  })

  test('legal copy is updated to 2026年6月30日 and references Settings controls', () => {
    const privacy = fs.readFileSync(path.join(__dirname, '../../privacy-policy/index.wxml'), 'utf8')
    const agreement = fs.readFileSync(path.join(__dirname, '../../user-agreement/index.wxml'), 'utf8')

    expect(privacy).toContain('更新日期：2026年6月30日')
    expect(agreement).toContain('更新日期：2026年6月30日')
    expect(privacy).toContain('设置页')
    expect(privacy).toContain('撤回公开展示授权')
    expect(privacy).toContain('删除账号资料')
    expect(agreement).toContain('设置页')
    expect(agreement).toContain('撤回公开展示授权')
  })

  test('onOpenPrivacyPolicy and onOpenUserAgreement navigate to legal pages', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)

    ctx.onOpenPrivacyPolicy()
    ctx.onOpenUserAgreement()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/privacy-policy/index' })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/user-agreement/index' })
  })

  test('onRevokePublicProfile calls self-scoped revoke action, updates local member consent, and clears privacy page caches', async () => {
    const { pageDef, app, pageCache } = loadPage(() => Promise.resolve({ result: { success: true } }))
    const ctx = makeCtx(pageDef, { currentMember: app.globalData.currentMember })

    await ctx.onRevokePublicProfile()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'members',
      data: { action: 'revokePublicProfile' }
    })
    expect(app.globalData.currentMember).toMatchObject({ _id: 'member-self', publicProfileConsent: false })
    expect(ctx.data.currentMember).toMatchObject({ _id: 'member-self', publicProfileConsent: false })
    expect(pageCache.removeCachesByPrefix.mock.calls.map(call => call[0])).toEqual(PRIVACY_PAGE_CACHE_PREFIXES)
  })

  test('onDeleteAccount calls self-scoped deletion action, clears local member state, and clears privacy page caches', async () => {
    const { pageDef, app, pageCache } = loadPage(() => Promise.resolve({ result: { success: true } }))
    app.identityReady = Promise.resolve(app.globalData.currentMember)
    const ctx = makeCtx(pageDef, { currentMember: app.globalData.currentMember })

    await ctx.onDeleteAccount()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'members',
      data: { action: 'deleteSelf' }
    })
    expect(app.globalData.currentMember).toBeNull()
    expect(app.globalData.isAdmin).toBe(false)
    expect(app.identityReady).toBeNull()
    expect(ctx.data.currentMember).toBeNull()
    expect(pageCache.removeCachesByPrefix.mock.calls.map(call => call[0])).toEqual(PRIVACY_PAGE_CACHE_PREFIXES)
  })
})
