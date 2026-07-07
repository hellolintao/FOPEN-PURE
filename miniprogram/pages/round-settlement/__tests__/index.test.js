const fs = require('fs')
const path = require('path')

function loadPage(callFunctionImpl) {
  jest.resetModules()
  let pageDef
  global.wx = {
    cloud: {
      callFunction: jest.fn(callFunctionImpl || (() => Promise.resolve({ result: { success: true, data: null } })))
    }
  }
  global.Page = def => { pageDef = def }
  require('../index')
  return pageDef
}

function makeCtx(def) {
  return {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
}

describe('round-settlement privacy boundary', () => {
  test('does not use frontend direct database reads', () => {
    const js = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')

    expect(js).not.toContain('wx.cloud.database')
    expect(js).not.toContain("db.collection('seasons')")
  })

  test('loadSeason reads season through cloud function', async () => {
    const pageDef = loadPage(({ name, data }) => {
      if (name === 'seasons' && data.action === 'get') {
        return Promise.resolve({ result: { success: true, data: { _id: data.id, name: '2026 赛季' } } })
      }
      return Promise.resolve({ result: { success: true, data: null } })
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadSeason('season_2026')

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'seasons',
      data: { action: 'get', id: 'season_2026' }
    })
    expect(ctx.data.seasonName).toBe('2026 赛季')
  })
})
