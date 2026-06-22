const fs = require('fs')
const path = require('path')

describe('tournament-add-player privacy-facing copy', () => {
  test('member picker does not expose phone search or display fields', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('搜索会员昵称')
    expect(wxml).not.toContain('手机号')
    expect(wxml).not.toContain('phone')
  })
})
