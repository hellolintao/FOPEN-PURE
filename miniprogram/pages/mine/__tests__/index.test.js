function loadPage(callFunctionImpl) {
  jest.resetModules()
  let pageDef
  const app = {
    globalData: { currentMember: null, isAdmin: false },
    refreshIdentity: jest.fn().mockResolvedValue(null)
  }
  global.getApp = () => app
  global.wx = {
    navigateTo: jest.fn(),
    showModal: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showToast: jest.fn(),
    cloud: {
      callFunction: jest.fn(callFunctionImpl)
    }
  }
  global.Page = (def) => { pageDef = def }
  require('../index')
  return { pageDef, app }
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

describe('mine onLogin', () => {
  test('unregistered user navigates to register mode and does not call members.add', () => {
    const { pageDef } = loadPage((options) => {
      if (options.name === 'members' && options.data.action === 'get') {
        options.success({ result: { data: [] } })
      }
    })
    const ctx = makeCtx(pageDef)

    ctx.onLogin()

    expect(wx.showLoading).toHaveBeenCalledWith({ title: '登录中...' })
    expect(wx.hideLoading).toHaveBeenCalled()
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/edit-profile/index?mode=register' })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction.mock.calls[0][0]).toMatchObject({
      name: 'members',
      data: { action: 'get' }
    })
    expect(
      wx.cloud.callFunction.mock.calls.some(([options]) => (
        options.name === 'members' && options.data && options.data.action === 'add'
      ))
    ).toBe(false)
  })

  test('existing user logs in and updates state/global data', () => {
    const user = {
      _id: 'member-1',
      name: '张三',
      avatarUrl: 'cloud://avatar',
      admin: true
    }
    const { pageDef, app } = loadPage((options) => {
      if (options.name === 'members' && options.data.action === 'get') {
        options.success({ result: { data: [user] } })
      }
    })
    const ctx = makeCtx(pageDef)
    ctx.loadUserPoints = jest.fn()

    ctx.onLogin()

    expect(ctx.data).toMatchObject({
      isLogin: true,
      isAdmin: true,
      currentMemberId: 'member-1',
      userInfo: {
        avatarUrl: 'cloud://avatar',
        name: '张三'
      }
    })
    expect(app.globalData.currentMember).toBe(user)
    expect(app.globalData.isAdmin).toBe(true)
    expect(ctx.loadUserPoints).toHaveBeenCalledWith('member-1')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '登录成功', icon: 'success' })
  })

  test('existing user without public display consent is not prompted to publish real identity', () => {
    const user = {
      _id: 'member-1',
      name: '张三',
      avatarUrl: 'cloud://avatar',
      publicProfileConsent: false
    }
    const { pageDef, app } = loadPage((options) => {
      if (options.name === 'members' && options.data.action === 'get') {
        options.success({ result: { data: [user] } })
        return
      }
    })
    const ctx = makeCtx(pageDef)
    ctx.loadUserPoints = jest.fn()

    ctx.onLogin()

    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({ action: 'update' })
    }))
    expect(app.globalData.currentMember).toMatchObject({
      _id: 'member-1',
      publicProfileConsent: false
    })
  })

  test('onLogin does not query identity when official privacy authorization is rejected', () => {
    const { pageDef } = loadPage(jest.fn())
    wx.requirePrivacyAuthorize = jest.fn(({ fail }) => fail({ errMsg: 'requirePrivacyAuthorize:fail' }))
    const ctx = makeCtx(pageDef)

    ctx.onLogin()

    expect(wx.requirePrivacyAuthorize).toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请先同意微信隐私授权', icon: 'none' })
  })

  test('applyMember does not show legacy protocol prompt for optional public display', () => {
    const user = {
      _id: 'member-1',
      name: '张三',
      publicProfileConsent: false
    }
    const { pageDef } = loadPage(jest.fn())
    const ctx = makeCtx(pageDef)

    ctx.applyMember(user)

    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.navigateTo).not.toHaveBeenCalledWith({ url: '/pages/privacy-policy/index' })
  })

  test('checkLogin uses global currentMember without calling members.get again', () => {
    const user = {
      _id: 'member-1',
      name: '张三',
      avatarUrl: 'cloud://avatar',
      admin: false
    }
    const { pageDef, app } = loadPage(jest.fn())
    app.globalData.currentMember = user
    const ctx = makeCtx(pageDef)
    ctx.loadUserPoints = jest.fn()

    ctx.checkLogin()

    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(ctx.data.currentMemberId).toBe('member-1')
    expect(ctx.loadUserPoints).toHaveBeenCalledWith('member-1')
  })

  test('checkLogin silently restores an existing member after app restart', async () => {
    const restored = {
      _id: 'member-restored',
      name: '恢复用户',
      avatarUrl: 'cloud://restored-avatar',
      admin: true
    }
    const { pageDef, app } = loadPage(jest.fn())
    app.refreshIdentity.mockResolvedValueOnce(restored)
    const ctx = makeCtx(pageDef)
    ctx.loadUserPoints = jest.fn()

    await ctx.checkLogin()

    expect(app.refreshIdentity).toHaveBeenCalledTimes(1)
    expect(wx.requirePrivacyAuthorize).toBeUndefined()
    expect(ctx.data).toMatchObject({
      isLogin: true,
      isAdmin: true,
      currentMemberId: 'member-restored',
      userInfo: {
        avatarUrl: 'cloud://restored-avatar',
        name: '恢复用户'
      }
    })
    expect(ctx.loadUserPoints).toHaveBeenCalledWith('member-restored')
  })

  test('checkLogin leaves visitor logged out when silent identity restore finds no member', async () => {
    const { pageDef } = loadPage(jest.fn())
    const ctx = makeCtx(pageDef)

    await ctx.checkLogin()

    expect(ctx.data).toMatchObject({
      isLogin: false,
      isAdmin: false,
      totalPoints: 0
    })
  })

  test('loadUserPoints uses fresh cached total without calling match-results', async () => {
    const { pageDef } = loadPage(jest.fn())
    wx.getStorageSync = jest.fn().mockReturnValue({
      value: { totalPoints: 88 },
      updatedAt: 1000,
      expiresAt: Date.now() + 60 * 1000
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadUserPoints('member-1')

    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(ctx.data.totalPoints).toBe(88)
  })

  test('legal entries open privacy policy and user agreement', () => {
    const { pageDef } = loadPage(jest.fn())
    const ctx = makeCtx(pageDef)

    ctx.onOpenPrivacyPolicy()
    ctx.onOpenUserAgreement()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/privacy-policy/index' })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/user-agreement/index' })
  })
})
