const fs = require('fs')
const path = require('path')

describe('tournament-detail WXML layout', () => {
  test('orders results, schedule, roster, points, and delete sections in main content', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
    const markers = [
      '<!-- RESULTS -->',
      '<!-- SCHEDULE -->',
      '<!-- REGISTRATIONS -->',
      '<!-- POINTS RULES -->',
      '<!-- DELETE -->'
    ]
    const positions = markers.map(marker => wxml.indexOf(marker))

    positions.forEach(position => {
      expect(position).toBeGreaterThan(-1)
    })
    expect(positions[0]).toBeLessThan(positions[1])
    expect(positions[1]).toBeLessThan(positions[2])
    expect(positions[2]).toBeLessThan(positions[3])
    expect(positions[3]).toBeLessThan(positions[4])
  })

  test('uses a standings table above stable keyed result match rows', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('wx:for="{{resultDisplay.standings}}" wx:key="standingKey"')
    expect(wxml).not.toContain('wx:for="{{resultDisplay.leaders}}"')
    expect(wxml).toContain('wx:for="{{group.matches}}" wx:for-item="match" wx:key="matchId"')
  })
})

function loadPage(options = {}) {
  jest.resetModules()
  let pageDef
  const app = options.app || { globalData: {} }
  const registrations = options.registrations || []
  const tournament = options.tournament === undefined ? null : options.tournament
  const matchResults = options.matchResults || []
  const seasons = options.seasons || {}
  const members = options.members || []
  const registrationChain = {
    where: jest.fn(() => ({
      orderBy: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: registrations })
      }))
    }))
  }
  const memberChain = {
    where: jest.fn(() => ({
      field: jest.fn(() => ({
        get: jest.fn().mockResolvedValue({ data: members })
      }))
    }))
  }
  const db = {
    command: {
      neq: jest.fn(value => ({ $neq: value })),
      in: jest.fn(value => ({ $in: value }))
    },
    collection: jest.fn(name => {
      if (name === 'tournament_registrations') return registrationChain
      if (name === 'members') return memberChain
      return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: tournament }) })) }
    })
  }
  global.getApp = () => app
  global.wx = {
    navigateTo: jest.fn(),
    navigateBack: jest.fn(),
    showToast: jest.fn(),
    showModal: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showShareMenu: jest.fn(),
    stopPullDownRefresh: jest.fn(),
    cloud: {
      database: jest.fn(() => db),
      callFunction: jest.fn(({ name, data }) => {
        if (name === 'match-results') {
          return Promise.resolve({ result: { success: true, data: { results: matchResults } } })
        }
        if (name === 'seasons') {
          const id = data && data.id
          return Promise.resolve({ result: { data: seasons[id] || null } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      })
    }
  }
  global.Page = def => { pageDef = def }
  require('../index')
  return { pageDef, app }
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...JSON.parse(JSON.stringify(def.data)), ...data },
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
}

describe('tournament-detail score permissions', () => {
  test('participant can enter score page', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false } },
      registrations: [{ playerId: 'm1', playerName: 'A', status: 'registered' }]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.loadRegistrations()
    ctx.onEnterScore()

    expect(ctx.data.isParticipant).toBe(true)
    expect(ctx.data.canEnterScore).toBe(true)
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1' })
  })

  test('viewer sees toast instead of entering score page', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef, {
      tournamentId: 't1',
      isAdmin: false,
      isParticipant: false,
      canEnterScore: false
    })

    ctx.onEnterScore()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '仅参赛者可录入', icon: 'none' })
    expect(wx.navigateTo).not.toHaveBeenCalled()
  })

  test('admin can enter score page', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef, {
      tournamentId: 't1',
      isAdmin: true,
      canEnterScore: true
    })

    ctx.onEnterScore()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1' })
  })

  test('delete success marks tournament list dirty before navigating back', () => {
    jest.useFakeTimers()
    const { pageDef, app } = loadPage({ app: { globalData: {} } })
    wx.showModal.mockImplementation(({ success }) => success({ confirm: true }))
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({ result: { success: true } })
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't-delete' })

    ctx.onDelete()

    expect(app.globalData.tournamentListDirty).toBe(true)
    expect(app.globalData.deletedTournamentId).toBe('t-delete')
    jest.advanceTimersByTime(500)
    expect(wx.navigateBack).toHaveBeenCalled()
    jest.useRealTimers()
  })

  test('completed tournament allows viewer to open score page as results', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef, {
      tournamentId: 't1',
      tournament: { _id: 't1', name: 'Finals', status: 'completed' },
      isAdmin: false,
      isParticipant: false,
      canEnterScore: false,
      canOpenScore: true
    })

    ctx.onEnterScore()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1' })
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test('loads status display fields for detail hero and footer action', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Finals', type: 'singles', format: 'regular', status: 'completed' }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.loadTournamentDetail()

    expect(ctx.data.tournamentDisplay.statusLabel).toBe('已结算')
    expect(ctx.data.tournamentDisplay.statusKind).toBe('settled')
    expect(ctx.data.scoreActionLabel).toBe('查看成绩')
    expect(ctx.data.shareEnabled).toBe(true)
  })

  test('loads seasonName from seasonId for detail hero', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: '五月排位赛', type: 'singles', format: 'regular', status: 'upcoming', seasonId: 'season_1740000000000' },
      seasons: {
        season_1740000000000: { _id: 'season_1740000000000', name: '2026 春季赛' }
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.loadTournamentDetail()

    expect(ctx.data.tournament.seasonName).toBe('2026 春季赛')
  })

  test('loads stale upcoming tournament with all confirmed matches as settled', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Finals', type: 'singles', format: 'regular', status: 'upcoming' },
      matchResults: [
        { player1: { id: 'A' }, player2: { id: 'B' }, resultStatus: 'confirmed' },
        { player1: { id: 'C' }, player2: { id: 'D' }, resultStatus: 'confirmed' }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.tournamentDisplay.statusLabel).toBe('已结算')
    expect(ctx.data.scoreActionLabel).toBe('查看成绩')
    expect(ctx.data.canOpenScore).toBe(true)
  })

  test('shows final result display only when all playable matches are confirmed', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Finals', type: 'singles', format: 'regular', status: 'completed' },
      matchResults: [
        {
          _id: 'r1',
          tournamentId: 't1',
          round: 1,
          position: 1,
          player1: { id: 'A', name: 'A' },
          player2: { id: 'B', name: 'B' },
          score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
          winner: { id: 'A', name: 'A' },
          resultStatus: 'confirmed',
          pointsAwarded: {
            entries: [
              { memberId: 'A', points: 20, role: 'winner' },
              { memberId: 'B', points: 10, role: 'loser' }
            ]
          }
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.resultDisplay.visible).toBe(true)
    expect(ctx.data.resultDisplay.completedText).toBe('已完成 1 / 1 场')
    expect(ctx.data.resultDisplay.groups[0].matches[0]).toMatchObject({
      p1Label: 'A',
      p2Label: 'B',
      scoreText: '4:2',
      winnerLabel: 'A',
      pointsText: '+20 / +10'
    })
  })

  test('hides final result display while any playable match is unconfirmed', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Finals', type: 'singles', format: 'regular', status: 'ongoing' },
      matchResults: [
        {
          player1: { id: 'A', name: 'A' },
          player2: { id: 'B', name: 'B' },
          resultStatus: 'confirmed',
          score: { sets: [{ a: 4, b: 1 }] }
        },
        {
          player1: { id: 'C', name: 'C' },
          player2: { id: 'D', name: 'D' },
          resultStatus: 'submitted',
          score: { sets: [{ a: 4, b: 3 }] }
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.resultDisplay.visible).toBe(false)
  })

  test('ignores BYE sentinel sides when building final result display and summary', async () => {
    const matchResults = [
      {
        _id: 'bye-row',
        round: 1,
        position: 1,
        player1: { id: 'BYE', name: 'BYE' },
        player2: { id: 'C', name: 'C' },
        resultStatus: 'confirmed'
      },
      {
        _id: 'real-row',
        round: 2,
        position: 1,
        player1: { id: 'A', name: 'A' },
        player2: { id: 'B', name: 'B' },
        score: { sets: [{ a: 4, b: 2 }] },
        winner: { id: 'A', name: 'A' },
        resultStatus: 'confirmed'
      }
    ]
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Finals', type: 'singles', format: 'regular', status: 'completed' },
      matchResults
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.matchResultRows).toEqual(matchResults)
    expect(ctx.data.resultSummary).toEqual({ playableCount: 1, confirmedCount: 1 })
    expect(ctx.data.resultDisplay.visible).toBe(true)
    expect(ctx.data.resultDisplay.completedText).toBe('已完成 1 / 1 场')
    expect(ctx.data.resultDisplay.groups).toHaveLength(1)
    expect(ctx.data.resultDisplay.groups[0].label).toBe('ROUND 02')
    expect(ctx.data.resultDisplay.groups[0].matches[0].matchId).toBe('real-row')
  })

  test('formats doubles and tiebreak result rows without inventing missing points', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Doubles', type: 'doubles', format: 'regular', status: 'completed' },
      matchResults: [
        {
          round: 1,
          position: 1,
          player1: { id: 'A', name: 'A', partnerId: 'B', partnerName: 'B' },
          player2: { id: 'C', name: 'C', partnerId: 'D', partnerName: 'D' },
          score: { sets: [{ a: 3, b: 3 }], tiebreak: '7-5' },
          winner: { id: 'A', name: 'A', partnerId: 'B', partnerName: 'B' },
          resultStatus: 'confirmed'
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    const row = ctx.data.resultDisplay.groups[0].matches[0]
    expect(row.p1Label).toBe('A / B')
    expect(row.p2Label).toBe('C / D')
    expect(row.scoreText).toBe('3:3 (7-5)')
    expect(row.pointsText).toBe('')
  })

  test('builds unique fallback match ids when persisted result ids are missing', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Fallback ids', type: 'singles', format: 'regular', status: 'completed' },
      matchResults: [
        {
          round: 1,
          position: 1,
          player1: { id: 'A', name: 'A' },
          player2: { id: 'B', name: 'B' },
          score: { sets: [{ a: 4, b: 2 }] },
          winner: { id: 'A', name: 'A' },
          resultStatus: 'confirmed'
        },
        {
          round: 1,
          position: 1,
          player1: { id: 'C', name: 'C' },
          player2: { id: 'D', name: 'D' },
          score: { sets: [{ a: 4, b: 1 }] },
          winner: { id: 'C', name: 'C' },
          resultStatus: 'confirmed'
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    const matchIds = ctx.data.resultDisplay.groups[0].matches.map(row => row.matchId)
    expect(matchIds.every(Boolean)).toBe(true)
    expect(new Set(matchIds).size).toBe(matchIds.length)
  })

  test('builds member standings sorted by earned points with avatar and point type columns', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Mixed Round Robin', type: 'mixed', format: 'regular', status: 'completed' },
      registrations: [
        { playerId: 'A', playerName: '艾拉', seed: 1, status: 'registered' },
        { playerId: 'B', playerName: '柏木', seed: 2, status: 'registered' },
        { playerId: 'C', playerName: '陈辰', seed: 3, status: 'registered' },
        { playerId: 'D', playerName: '丁丁', seed: 4, status: 'registered' }
      ],
      members: [
        { _id: 'A', avatarUrl: '/avatars/a.png' },
        { _id: 'C', avatarUrl: '/avatars/c.png' }
      ],
      matchResults: [
        {
          round: 1,
          position: 1,
          tournamentType: 'singles',
          player1: { id: 'A', name: 'A' },
          player2: { id: 'B', name: 'B' },
          score: { sets: [{ a: 4, b: 2 }] },
          winner: { id: 'A', name: 'A' },
          resultStatus: 'confirmed',
          pointsAwarded: { entries: [{ memberId: 'A', points: 20 }, { memberId: 'B', points: 10 }] }
        },
        {
          round: 1,
          position: 2,
          tournamentType: 'doubles',
          player1: { id: 'C', name: 'C', partnerId: 'D', partnerName: 'D' },
          player2: { id: 'A', name: 'A', partnerId: 'B', partnerName: 'B' },
          score: { sets: [{ a: 4, b: 1 }] },
          winner: { id: 'C', name: 'C', partnerId: 'D', partnerName: 'D' },
          resultStatus: 'confirmed',
          pointsAwarded: {
            entries: [
              { memberId: 'C', points: 20 },
              { memberId: 'D', points: 20 },
              { memberId: 'A', points: 10 },
              { memberId: 'B', points: 10 }
            ]
          }
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.resultDisplay.standings).toEqual([
      expect.objectContaining({
        standingKey: 'A',
        rank: 1,
        memberName: '艾拉',
        avatarUrl: '/avatars/a.png',
        recordText: '1胜1负',
        singlesPoints: 20,
        doublesPoints: 10,
        singlesPointsText: '20',
        doublesPointsText: '10'
      }),
      expect.objectContaining({
        standingKey: 'C',
        rank: 2,
        memberName: '陈辰',
        avatarUrl: '/avatars/c.png',
        recordText: '1胜0负',
        singlesPoints: 0,
        doublesPoints: 20,
        singlesPointsText: '0',
        doublesPointsText: '20'
      }),
      expect.objectContaining({
        standingKey: 'D',
        rank: 3,
        memberName: '丁丁',
        recordText: '1胜0负',
        totalPoints: 20
      }),
      expect.objectContaining({
        standingKey: 'B',
        rank: 4,
        memberName: '柏木',
        recordText: '0胜2负',
        totalPoints: 20
      })
    ])
  })

  test('keeps standings rows separate when distinct players share a display name', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Round Robin', type: 'singles', format: 'regular', status: 'completed' },
      matchResults: [
        {
          round: 1,
          position: 1,
          player1: { id: 'alex-1', name: 'Alex' },
          player2: { id: 'blake', name: 'Blake' },
          score: { sets: [{ a: 4, b: 2 }] },
          winner: { id: 'alex-1', name: 'Alex' },
          resultStatus: 'confirmed',
          pointsAwarded: { entries: [{ memberId: 'alex-1', points: 30 }, { memberId: 'blake', points: 0 }] }
        },
        {
          round: 1,
          position: 2,
          player1: { id: 'alex-2', name: 'Alex' },
          player2: { id: 'casey', name: 'Casey' },
          score: { sets: [{ a: 4, b: 1 }] },
          winner: { id: 'alex-2', name: 'Alex' },
          resultStatus: 'confirmed',
          pointsAwarded: { entries: [{ memberId: 'alex-2', points: 20 }, { memberId: 'casey', points: 0 }] }
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.resultDisplay.standings.map(item => ({
      standingKey: item.standingKey,
      memberName: item.memberName,
      singlesPoints: item.singlesPoints,
      recordText: item.recordText
    }))).toEqual([
      { standingKey: 'alex-1', memberName: 'Alex', singlesPoints: 30, recordText: '1胜0负' },
      { standingKey: 'alex-2', memberName: 'Alex', singlesPoints: 20, recordText: '1胜0负' },
      { standingKey: 'blake', memberName: 'Blake', singlesPoints: 0, recordText: '0胜1负' },
      { standingKey: 'casey', memberName: 'Casey', singlesPoints: 0, recordText: '0胜1负' }
    ])
  })

  test('builds knockout standings from the highest-round final members', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Cup', type: 'singles', format: 'knockout', status: 'completed' },
      matchResults: [
        {
          round: 2,
          position: 1,
          player1: { id: 'A', name: 'A' },
          player2: { id: 'C', name: 'C' },
          score: { sets: [{ a: 2, b: 4 }] },
          winner: { id: 'C', name: 'C' },
          resultStatus: 'confirmed'
        },
        {
          round: 1,
          position: 1,
          player1: { id: 'A', name: 'A' },
          player2: { id: 'B', name: 'B' },
          score: { sets: [{ a: 4, b: 2 }] },
          winner: { id: 'A', name: 'A' },
          resultStatus: 'confirmed'
        },
        {
          round: 1,
          position: 2,
          player1: { id: 'C', name: 'C' },
          player2: { id: 'D', name: 'D' },
          score: { sets: [{ a: 4, b: 1 }] },
          winner: { id: 'C', name: 'C' },
          resultStatus: 'confirmed'
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.resultDisplay.standings.map(item => ({
      standingKey: item.standingKey,
      memberName: item.memberName,
      recordText: item.recordText
    }))).toEqual([
      { standingKey: 'C', memberName: 'C', recordText: '2胜0负' },
      { standingKey: 'A', memberName: 'A', recordText: '1胜1负' },
      { standingKey: 'B', memberName: 'B', recordText: '0胜1负' },
      { standingKey: 'D', memberName: 'D', recordText: '0胜1负' }
    ])
  })

  test('shares tournament detail to WeChat with status in title', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef, {
      tournamentId: 't1',
      tournament: { _id: 't1', name: '五月排位赛', status: 'ongoing' }
    })

    expect(ctx.onShareAppMessage()).toEqual({
      title: '五月排位赛 · 进行中',
      path: '/pages/tournament-detail/index?id=t1'
    })
  })
})
