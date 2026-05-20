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

test('setStateFromResponses maps stats, rank subtitle, active singles data, and recent data split by type', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    seasonYear: 2026,
    h2hExpanded: { singles: false, doubles: false },
  })
  const h2hSingles = Array.from({ length: 6 }, (_, i) => ({
    memberId: `P${i}`,
    name: `Player ${i}`,
  }))
  const recent = [
    { _id: 'm1', tournamentType: 'singles', result: 'W' },
    { _id: 'm2', tournamentType: 'doubles', result: 'L' },
  ]

  ctx.setStateFromResponses({
    player: { _id: 'A', name: 'Alice', playStyle: 'moon-queen' },
    statsData: {
      stats: {
        singles: { winCount: 3, lossCount: 1, totalPoints: 40, winRate: 0.75 },
        doubles: { winCount: 0, lossCount: 0, totalPoints: 0 },
      },
      currentRank: { singles: 2, doubles: null },
      rankHistory: { singles: [{ rank: 2 }], doubles: [] },
      recent,
    },
    h2hData: { singles: h2hSingles, doubles: [{ memberId: 'D1', name: 'Doubles 1' }] },
  })

  expect(ctx.data.stats.singles).toMatchObject({ winCount: 3, lossCount: 1, totalPoints: 40 })
  expect(ctx.data.singlesPct).toBe('75%')
  expect(ctx.data.rankSubtitle).toBe('S2026 · 单打 #2 · 双打 未上榜')
  expect(ctx.data.h2hVisible.singles).toEqual(h2hSingles.slice(0, 5))
  expect(ctx.data.h2hVisible.doubles).toEqual([{ memberId: 'D1', name: 'Doubles 1' }])
  expect(ctx.data.recent).toBe(recent)
  expect(ctx.data.recentByType).toEqual({
    singles: [recent[0]],
    doubles: [recent[1]],
  })
  expect(ctx.data.activeTypeLabel).toBe('单打')
  expect(ctx.data.activeStats).toMatchObject({ winCount: 3, lossCount: 1, totalPoints: 40 })
  expect(ctx.data.activePct).toBe('75%')
  expect(ctx.data.activeRankHistory).toEqual([{ rank: 2 }])
  expect(ctx.data.activeH2H).toEqual(h2hSingles)
  expect(ctx.data.activeH2HVisible).toEqual(h2hSingles.slice(0, 5))
  expect(ctx.data.activeRecent).toEqual([recent[0]])
})

test('onTabChange switches player detail data to doubles without refetching', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    seasonYear: 2026,
    activeTab: 'singles',
    h2hExpanded: { singles: false, doubles: false },
  })
  const recent = [
    { _id: 's1', tournamentType: 'singles' },
    { _id: 'd1', tournamentType: 'doubles' },
  ]

  ctx.setStateFromResponses({
    player: { _id: 'A', name: 'Alice', playStyle: 'vers' },
    statsData: {
      stats: {
        singles: { winCount: 1, lossCount: 1, totalPoints: 20, winRate: 0.5 },
        doubles: { winCount: 4, lossCount: 1, totalPoints: 90, winRate: 0.8 },
      },
      currentRank: { singles: 5, doubles: 2 },
      rankHistory: { singles: [{ rank: 5 }], doubles: [{ rank: 3 }, { rank: 2 }] },
      recent,
    },
    h2hData: {
      singles: [{ memberId: 'S', name: 'Singles' }],
      doubles: [{ memberId: 'D', name: 'Doubles', wins: 2, losses: 0 }],
    },
  })

  ctx.onTabChange({ detail: { value: 'doubles' } })

  expect(ctx.data.activeTab).toBe('doubles')
  expect(ctx.data.activeTypeLabel).toBe('双打')
  expect(ctx.data.activeStats).toMatchObject({ winCount: 4, lossCount: 1, totalPoints: 90 })
  expect(ctx.data.activePct).toBe('80%')
  expect(ctx.data.activeRankHistory).toEqual([{ rank: 3 }, { rank: 2 }])
  expect(ctx.data.activeH2H).toEqual([{ memberId: 'D', name: 'Doubles', wins: 2, losses: 0 }])
  expect(ctx.data.activeH2HVisible).toEqual([{ memberId: 'D', name: 'Doubles', wins: 2, losses: 0 }])
  expect(ctx.data.activeRecent).toEqual([recent[1]])
})

test('onH2HTap navigates to player detail', () => {
  const def = loadPage()
  const ctx = makeCtx(def)

  ctx.onH2HTap({ detail: { playerId: 'B' } })

  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/player-detail/index?id=B' })
})

test('onRecentTap navigates to tournament score anchored to that match', () => {
  const def = loadPage()
  const ctx = makeCtx(def)

  ctx.onRecentTap({ currentTarget: { dataset: { tournamentid: 't1', matchid: 'm1' } } })

  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: '/pages/tournament-score/index?tournamentId=t1&matchId=m1',
  })
})

test('recent match rows expose tap target data in wxml', () => {
  const fs = require('fs')
  const path = require('path')
  loadPage()

  const wxml = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8')

  expect(wxml).toContain('bindtap="onRecentTap"')
  expect(wxml).toContain('data-tournamentid="{{item.tournamentId}}"')
  expect(wxml).toContain('data-matchid="{{item.matchId || item.sourceMatchId || item._id}}"')
})

test('_formatPlayStyle returns label for new slug, fallback for unknown', () => {
  const def = loadPage()
  const ctx = makeCtx(def)

  expect(ctx._formatPlayStyle({ playStyle: 'vers' })).toBe('Vers')
  expect(ctx._formatPlayStyle({ playStyle: 'baseliner' })).toBe('打法未设置')
  expect(ctx._formatPlayStyle({})).toBe('打法未设置')
})
