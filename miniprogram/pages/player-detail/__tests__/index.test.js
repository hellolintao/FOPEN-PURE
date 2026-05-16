function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    navigateTo: jest.fn(),
    showToast: jest.fn(),
  }
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
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

test('setStateFromResponses maps stats, rank subtitle, h2h visible list, and recent data', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    seasonYear: 2026,
    h2hExpanded: { singles: false, doubles: false },
  })
  const h2hSingles = Array.from({ length: 6 }, (_, i) => ({
    playerId: `P${i}`,
    name: `Player ${i}`,
  }))
  const recent = [{ matchId: 'm1', result: 'W' }]

  ctx.setStateFromResponses({
    player: { _id: 'A', name: 'Alice', playStyle: 'all-court' },
    statsData: {
      stats: {
        singles: { winCount: 3, lossCount: 1, totalPoints: 40, winRate: 0.75 },
        doubles: { winCount: 0, lossCount: 0, totalPoints: 0 },
      },
      currentRank: { singles: 2, doubles: null },
      rankHistory: { singles: [{ rank: 2 }], doubles: [] },
      recent,
    },
    h2hData: { singles: h2hSingles, doubles: [{ playerId: 'D1', name: 'Doubles 1' }] },
  })

  expect(ctx.data.stats.singles).toMatchObject({ winCount: 3, lossCount: 1, totalPoints: 40 })
  expect(ctx.data.singlesPct).toBe('75%')
  expect(ctx.data.rankSubtitle).toBe('S2026 · 单打 #2 · 双打 未上榜')
  expect(ctx.data.h2hVisible.singles).toEqual(h2hSingles.slice(0, 5))
  expect(ctx.data.h2hVisible.doubles).toEqual([{ playerId: 'D1', name: 'Doubles 1' }])
  expect(ctx.data.recent).toBe(recent)
})

test('onH2HTap navigates to player detail', () => {
  const def = loadPage()
  const ctx = makeCtx(def)

  ctx.onH2HTap({ detail: { playerId: 'B' } })

  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/player-detail/index?id=B' })
})
