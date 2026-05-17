function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    showToast: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showModal: jest.fn(),
    navigateBack: jest.fn(),
    cloud: { callFunction: jest.fn() }
  }
  global.getApp = () => ({ globalData: {} })
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

  test('有效 member query 设置 playStyleIndex', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    const member = { _id: 'm1', name: '张三', status: 'active', admin: false, playStyle: 'iron-lady' }
    ctx.onLoad({ member: encodeURIComponent(JSON.stringify(member)) })
    expect(ctx.data.memberId).toBe('m1')
    expect(ctx.data.playStyleIndex).toBe(2)
    expect(ctx.data.member.playStyle).toBe('iron-lady')
  })
})

describe('member-edit submit', () => {
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
