function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    navigateTo: jest.fn(),
    switchTab: jest.fn(),
  }
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ call: jest.fn() }))
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...def.data, ...data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
  }
}

test('_load maps mySummary response into loaded summary state', async () => {
  const def = loadPage()
  const { call } = require('../../../utils/cloud')
  call.mockResolvedValue({
    ok: true,
    data: {
      pendingCount: 2,
      pending: [
        { tournamentId: 't1', matchId: 'mr1' },
        { tournamentId: 't2', matchId: 'mr2' },
      ],
      submitted: [],
    },
  })
  const ctx = makeCtx(def)

  await ctx._load()

  expect(call).toHaveBeenCalledWith('match-results', { action: 'mySummary', payload: { historyLimit: 10 } })
  expect(ctx.data.loadState).toBe('loaded')
  expect(ctx.data.summary).toMatchObject({ pendingCount: 2 })
})

test('onPendingRow navigates to tournament score anchor', () => {
  const def = loadPage()
  const ctx = makeCtx(def)

  ctx.onPendingRow({ currentTarget: { dataset: { tournamentid: 't1', matchid: 'mr1' } } })

  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: '/pages/tournament-score/index?tournamentId=t1&matchId=mr1',
  })
})

test('onRecordNow opens first pending match', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    summary: {
      pending: [
        { tournamentId: 't1', matchId: 'mr1' },
        { tournamentId: 't2', matchId: 'mr2' },
      ],
    },
  })

  ctx.onRecordNow()

  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: '/pages/tournament-score/index?tournamentId=t1&matchId=mr1',
  })
})
