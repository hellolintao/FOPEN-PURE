function loadPage() {
  jest.resetModules()
  let pageDef
  const app = { globalData: {} }
  global.wx = {
    showToast: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showModal: jest.fn(),
    navigateBack: jest.fn(),
    cloud: { callFunction: jest.fn() }
  }
  global.getApp = () => app
  global.__testApp = app
  global.Page = (def) => { pageDef = def }
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: JSON.parse(JSON.stringify({ ...def.data, ...data })),
    setData(patch) {
      for (const key of Object.keys(patch)) {
        if (key.includes('.')) {
          const [head, ...rest] = key.split('.')
          let cur = this.data[head]
          for (let i = 0; i < rest.length - 1; i++) cur = cur[rest[i]]
          cur[rest[rest.length - 1]] = patch[key]
        } else {
          this.data[key] = patch[key]
        }
      }
    }
  }
}

describe('member-edit entry', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('无 member query 时提示并返回，且不调用 members.add', () => {
    jest.useFakeTimers()
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.onLoad({})
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择要编辑的会员', icon: 'none' })
    jest.runAllTimers()
    expect(wx.navigateBack).toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test('member query 格式非法时提示并返回，且不调用云函数', () => {
    jest.useFakeTimers()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.onLoad({ member: encodeURIComponent('{bad json') })
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择要编辑的会员', icon: 'none' })
    jest.runAllTimers()
    expect(wx.navigateBack).toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test('member query 缺少 _id 时视为非法入口', () => {
    jest.useFakeTimers()
    const def = loadPage()
    const ctx = makeCtx(def)
    const member = { name: '张三', status: 'active', admin: false, playStyle: 'vers' }
    ctx.onLoad({ member: encodeURIComponent(JSON.stringify(member)) })
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择要编辑的会员', icon: 'none' })
    jest.runAllTimers()
    expect(wx.navigateBack).toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test('有效 member query 设置 playStyleIndex', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    const member = { _id: 'm1', name: '张三', status: 'active', admin: false, playStyle: 'iron-lady' }
    ctx.onLoad({ member: encodeURIComponent(JSON.stringify(member)) })
    expect(ctx.data.memberId).toBe('m1')
    expect(ctx.data.playStyleIndex).toBe(2)
    expect(ctx.data.member.playStyle).toBe('iron-lady')
  })

  test('有效 member query 中非法 playStyle 会规范化为空', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    const member = { _id: 'm1', name: '张三', status: 'active', admin: false, playStyle: 'baseliner' }
    ctx.onLoad({ member: encodeURIComponent(JSON.stringify(member)) })
    expect(ctx.data.memberId).toBe('m1')
    expect(ctx.data.playStyleIndex).toBe(-1)
    expect(ctx.data.member.playStyle).toBe('')
  })
})

describe('member-edit submit', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test('缺少姓名时阻止提交', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.member = { name: '', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: 'vers' }
    ctx.onSubmit()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请填写必填项', icon: 'none' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test('缺少状态时阻止提交', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: '', admin: false, playStyle: 'vers' }
    ctx.onSubmit()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请填写必填项', icon: 'none' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test('编辑提交 payload 携带 playStyle，且不调用 add', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.memberId = 'm1'
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: 'vers' }
    ctx.onSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    const call = wx.cloud.callFunction.mock.calls[0][0]
    expect(call.data.action).toBe('updateById')
    expect(call.data.action).not.toBe('add')
    expect(call.data.data.playStyle).toBe('vers')
  })

  test('编辑提交 payload 仅包含允许更新字段', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.memberId = 'm1'
    ctx.data.member = {
      _id: 'should-not-nest',
      name: '张三',
      phone: '13800000000',
      avatarUrl: 'https://example.com/avatar.jpg',
      status: 'active',
      admin: true,
      playStyle: 'moon-queen',
      createTime: '2026-01-01',
      arbitrary: 'drop me'
    }
    ctx.onSubmit()
    const call = wx.cloud.callFunction.mock.calls[0][0]
    expect(call.data.data).toEqual({
      name: '张三',
      phone: '13800000000',
      status: 'active',
      admin: true,
      playStyle: 'moon-queen'
    })
  })

  test('编辑已有会员不强制打法', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.memberId = 'm1'
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: '' }
    ctx.onSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    const call = wx.cloud.callFunction.mock.calls[0][0]
    expect(call.data.action).toBe('updateById')
  })

  test('非法打法 slug 被前端拦截', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: 'baseliner' }
    ctx.onSubmit()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '打法选项不合法', icon: 'none' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test('云函数返回 success=false 时提示失败且不返回', () => {
    const def = loadPage()
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({ result: { success: false, error: { message: '服务端拒绝保存' } } })
    })
    const ctx = makeCtx(def)
    ctx.data.memberId = 'm1'
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: 'vers' }
    ctx.onSubmit()
    expect(wx.hideLoading).toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '服务端拒绝保存', icon: 'none' })
    expect(wx.navigateBack).not.toHaveBeenCalled()
    expect(global.__testApp.globalData.memberUpdate).toBeUndefined()
  })

  test('保存成功后写入 memberUpdate 并延迟返回', () => {
    jest.useFakeTimers()
    const def = loadPage()
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({ result: { success: true } })
    })
    const ctx = makeCtx(def)
    ctx.data.memberId = 'm1'
    ctx.data.member = { name: '张三', phone: '13800000000', avatarUrl: 'x.jpg', status: 'active', admin: true, playStyle: 'grinder' }
    ctx.onSubmit()
    expect(global.__testApp.globalData.memberUpdate).toEqual({
      _id: 'm1',
      name: '张三',
      phone: '13800000000',
      status: 'active',
      admin: true,
      playStyle: 'grinder'
    })
    expect(wx.navigateBack).not.toHaveBeenCalled()
    jest.runAllTimers()
    expect(wx.navigateBack).toHaveBeenCalled()
  })
})

describe('member-edit picker', () => {
  test('onPickPlayStyle 写入 slug 与 index', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.onPickPlayStyle({ detail: { value: '2' } })
    expect(ctx.data.playStyleIndex).toBe(2)
    expect(ctx.data.member.playStyle).toBe('iron-lady')
  })
})
