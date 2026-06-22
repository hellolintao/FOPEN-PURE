const fs = require('fs')
const path = require('path')

function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    showToast: jest.fn(),
    cloud: {
      callFunction: jest.fn(),
      database: jest.fn()
    }
  }
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

describe('tournament-add-players-doubles privacy handling', () => {
  test('member selector UI does not expose phone search or display fields', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('搜索会员昵称')
    expect(wxml).not.toContain('手机号')
    expect(wxml).not.toContain('phone')
  })

  test('local member filtering only matches nickname, not legacy phone fields', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      searchKeyword: '138',
      memberList: [
        { _id: 'm1', name: '小叶', phone: '13800000000' },
        { _id: 'm2', name: '138号选手' }
      ]
    })

    ctx.onSearch()

    expect(ctx.data.filteredMemberList).toEqual([
      { _id: 'm2', name: '138号选手' }
    ])
  })
})
