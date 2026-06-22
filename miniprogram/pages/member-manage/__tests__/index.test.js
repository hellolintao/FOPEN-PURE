const fs = require('fs')
const path = require('path')

function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    showToast: jest.fn(),
    previewImage: jest.fn(),
    navigateTo: jest.fn(),
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
      Object.assign(this.data, patch)
    }
  }
}

describe('member-manage member formatting', () => {
  test('admin roster UI does not expose phone search or display fields', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('搜索会员昵称')
    expect(wxml).not.toContain('手机号')
    expect(wxml).not.toContain('phone')
  })

  test('formatMember marks unclaimed members while keeping status label data', () => {
    const def = loadPage()
    const ctx = makeCtx(def)

    const member = ctx.formatMember({
      _id: 'm1',
      name: '待认领用户',
      status: 'active',
      claimStatus: 'unclaimed',
      createTime: '2026-05-01T00:00:00.000Z'
    })

    expect(member.claimLabel).toBe('待认领')
    expect(member.claimClass).toBe('unclaimed')
    expect(member.status).toBe('active')
    expect(member.formattedTime).toBe('2026-05-01')
  })

  test('formatMember does not expose claim label for claimed or regular members', () => {
    const def = loadPage()
    const ctx = makeCtx(def)

    expect(ctx.formatMember({
      _id: 'm1',
      name: '已认领用户',
      status: 'active',
      claimStatus: 'claimed'
    }).claimLabel).toBe('')
    expect(ctx.formatMember({
      _id: 'm2',
      name: '普通用户',
      status: 'active'
    }).claimLabel).toBe('')
  })
})

describe('member-manage list updates', () => {
  test('updateMemberItem refreshes claim badge fields for realtime admin list updates', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      memberList: [
        ctxSeedMember('m1', { claimStatus: 'claimed' }),
        ctxSeedMember('m2', { claimStatus: 'unclaimed' })
      ]
    })

    ctx.updateMemberItem({
      _id: 'm1',
      name: '张三',
      phone: '13800000000',
      status: 'active',
      admin: false,
      playStyle: 'vers',
      claimStatus: 'unclaimed'
    })

    expect(ctx.data.memberList[0]).toMatchObject({
      _id: 'm1',
      claimStatus: 'unclaimed',
      claimLabel: '待认领',
      claimClass: 'unclaimed'
    })
    expect(ctx.data.memberList[0]).not.toHaveProperty('phone')
    expect(ctx.data.memberList[1].claimLabel).toBe('待认领')
  })

  test('onAvatarError marks the failed avatar so the row can fall back to initials', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      memberList: [
        ctxSeedMember('m1', { avatarUrl: 'https://example.com/a.jpg' }),
        ctxSeedMember('m2', { avatarUrl: 'cloud://private-avatar' })
      ]
    })

    ctx.onAvatarError({ currentTarget: { dataset: { id: 'm2' } } })

    expect(ctx.data.memberList[0].avatarLoadFailed).toBeFalsy()
    expect(ctx.data.memberList[1].avatarLoadFailed).toBe(true)
  })
})

function ctxSeedMember(_id, overrides = {}) {
  return {
    _id,
    name: '会员',
    status: 'active',
    formattedTime: '2026-05-01',
    claimLabel: overrides.claimStatus === 'unclaimed' ? '待认领' : '',
    claimClass: overrides.claimStatus === 'unclaimed' ? 'unclaimed' : '',
    ...overrides
  }
}
