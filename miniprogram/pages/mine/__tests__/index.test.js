function loadPage(callFunctionImpl) {
  jest.resetModules()
  let pageDef
  const app = { globalData: { currentMember: null, isAdmin: false } }
  global.getApp = () => app
  global.wx = {
    navigateTo: jest.fn(),
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
})
