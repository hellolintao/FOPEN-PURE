function loadApp() {
  jest.resetModules()
  let appDef
  global.wx = {
    cloud: {
      init: jest.fn()
    }
  }
  global.getCurrentPages = jest.fn(() => [])
  global.App = (def) => {
    appDef = def
  }
  jest.mock('../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../app')
  return appDef
}

describe('app launch identity loading', () => {
  test('onLaunch initializes cloud and exposes the startup identity promise', () => {
    const app = loadApp()
    const identityReady = Promise.resolve({ _id: 'm1' })
    app.refreshIdentity = jest.fn().mockReturnValue(identityReady)

    app.onLaunch()

    expect(wx.cloud.init).toHaveBeenCalledWith({
      env: 'cloud1-0gthnke69a09f52a',
      traceUser: true
    })
    expect(app.refreshIdentity).toHaveBeenCalledTimes(1)
    expect(app.identityReady).toBe(identityReady)
  })

  test('refreshIdentity fetches member identity on demand', async () => {
    const app = loadApp()
    const { callFunction } = require('../utils/cloud')
    callFunction.mockResolvedValueOnce({
      result: {
        data: [{ _id: 'm1', name: '张三', admin: true }]
      }
    })

    await app.refreshIdentity()

    expect(callFunction).toHaveBeenCalledWith({
      name: 'members',
      data: { action: 'get' }
    })
    expect(app.globalData.currentMember).toMatchObject({ _id: 'm1' })
    expect(app.globalData.isAdmin).toBe(true)
  })

  test('refreshIdentity accepts the legacy isAdmin member field', async () => {
    const app = loadApp()
    const { callFunction } = require('../utils/cloud')
    callFunction.mockResolvedValueOnce({
      result: {
        data: [{ _id: 'm1', name: '张三', isAdmin: true }]
      }
    })

    await app.refreshIdentity()

    expect(app.globalData.isAdmin).toBe(true)
  })

  test('refreshIdentity only grants admin access for strict boolean flags', async () => {
    const app = loadApp()
    const { callFunction } = require('../utils/cloud')
    callFunction.mockResolvedValueOnce({
      result: {
        data: [{ _id: 'm1', admin: 'true', isAdmin: 1 }]
      }
    })

    await app.refreshIdentity()

    expect(app.globalData.isAdmin).toBe(false)
  })

  test('a transient startup failure clears the cached identity promise so a later request can retry', async () => {
    const app = loadApp()
    const { callFunction } = require('../utils/cloud')
    callFunction
      .mockRejectedValueOnce(new Error('identity unavailable'))
      .mockResolvedValueOnce({ result: { data: [{ _id: 'm1', name: '张三' }] } })

    app.onLaunch()
    await app.identityReady

    expect(app.identityReady).toBeNull()

    app.identityReady = app.refreshIdentity()
    await app.identityReady

    expect(callFunction).toHaveBeenCalledTimes(2)
    expect(app.globalData.currentMember).toMatchObject({ _id: 'm1' })
  })

  test('a successful empty member lookup stays cached as a guest identity result', async () => {
    const app = loadApp()
    const { callFunction } = require('../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { data: [] } })

    app.onLaunch()
    const identityReady = app.identityReady
    await identityReady

    expect(app.identityReady).toBe(identityReady)
    expect(app.globalData.currentMember).toBeNull()
    expect(app.globalData.isAdmin).toBe(false)
  })
})
