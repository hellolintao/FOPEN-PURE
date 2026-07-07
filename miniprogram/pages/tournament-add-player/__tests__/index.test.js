const fs = require('fs')
const path = require('path')

function loadPage(options = {}) {
  jest.resetModules()
  let pageDef
  const tournament = options.tournament || { _id: 't1', name: 'FU Open', type: 'singles' }
  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({ get: jest.fn(async () => ({ data: tournament })) }))
    }))
  }
  global.wx = {
    showToast: jest.fn(),
    vibrateShort: jest.fn(),
    cloud: {
      database: jest.fn(() => db),
      callFunction: jest.fn(({ name }) => {
        if (name === 'tournaments') {
          return Promise.resolve({ result: { success: true, data: tournament } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      })
    }
  }
  global.Page = def => { pageDef = def }
  require('../index')
  return { pageDef, db }
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

describe('tournament-add-player privacy-facing copy', () => {
  test('member picker does not expose phone search or display fields', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('搜索会员昵称')
    expect(wxml).not.toContain('手机号')
    expect(wxml).not.toContain('phone')
  })

  test('loads tournament through cloud function instead of direct collection read', async () => {
    const { pageDef, db } = loadPage()
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.loadTournament()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournaments',
      data: { action: 'get', id: 't1' }
    })
    expect(db.collection).not.toHaveBeenCalledWith('tournaments')
    expect(ctx.data.tournament).toEqual({ _id: 't1', name: 'FU Open', type: 'singles' })
  })
})
