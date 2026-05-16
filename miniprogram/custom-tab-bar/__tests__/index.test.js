function loadTabBar({ isAdmin = false, route = 'pages/home/index' } = {}) {
  let componentConfig

  jest.resetModules()
  global.Component = jest.fn(config => {
    componentConfig = config
  })
  global.getApp = jest.fn(() => ({ globalData: { isAdmin } }))
  global.getCurrentPages = jest.fn(() => [{ route }])
  global.wx = { switchTab: jest.fn() }

  require('../index.js')

  const ctx = {
    data: { ...componentConfig.data },
    setData(update) {
      this.data = { ...this.data, ...update }
    }
  }

  return { componentConfig, ctx }
}

describe('custom tab bar', () => {
  afterEach(() => {
    delete global.Component
    delete global.getApp
    delete global.getCurrentPages
    delete global.wx
  })

  test('shows admin tabs in the requested order with remix line icons', () => {
    const { componentConfig, ctx } = loadTabBar({
      isAdmin: true,
      route: 'pages/rank/index'
    })

    componentConfig.methods.refresh.call(ctx)

    expect(ctx.data.list.map(item => item.text)).toEqual(['首页', '赛事', '排行', '管理', '我的'])
    expect(ctx.data.list.map(item => item.iconPath)).toEqual([
      '/images/icons/ri/home-line.png',
      '/images/icons/ri/calendar-event-line.png',
      '/images/icons/ri/trophy-line.png',
      '/images/icons/ri/settings-3-line.png',
      '/images/icons/ri/user-line.png'
    ])
    expect(ctx.data.list.map(item => item.selectedIconPath)).toEqual([
      '/images/icons/ri/home-fill.png',
      '/images/icons/ri/calendar-event-fill.png',
      '/images/icons/ri/trophy-fill.png',
      '/images/icons/ri/settings-3-fill.png',
      '/images/icons/ri/user-fill.png'
    ])
    expect(ctx.data.selected).toBe('/pages/rank/index')
  })

  test('hides the management tab for non-admin users', () => {
    const { componentConfig, ctx } = loadTabBar({ isAdmin: false })

    componentConfig.methods.refresh.call(ctx)

    expect(ctx.data.list.map(item => item.text)).toEqual(['首页', '赛事', '排行', '我的'])
    expect(ctx.data.list.some(item => item.pagePath === '/pages/manage/index')).toBe(false)
  })

  test('app.json tab bar icon paths use formats accepted by the simulator', () => {
    const appConfig = require('../../app.json')
    const supportedIcon = /\.(png|jpe?g)$/i

    for (const item of appConfig.tabBar.list) {
      expect(item.iconPath).toMatch(supportedIcon)
      expect(item.selectedIconPath).toMatch(supportedIcon)
    }
  })
})
