function loadPage(options = {}) {
  jest.resetModules()
  let pageDef
  const app = options.app || { globalData: {}, refreshIdentity: jest.fn().mockResolvedValue(null) }
  const tournaments = options.tournaments || [{ _id: 't1', name: 'FU Open', type: 'singles' }]
  const registrationsByTournament = options.registrationsByTournament || {}
  const resultRowsByTournament = options.resultRowsByTournament || {}
  const tournamentsCollection = {
    get: jest.fn().mockResolvedValue({ data: tournaments })
  }
  const db = {
    collection: jest.fn(name => {
      if (name === 'tournaments') return tournamentsCollection
      return { get: jest.fn().mockResolvedValue({ data: [] }) }
    })
  }
  global.getApp = () => app
  global.wx = {
    navigateTo: jest.fn(),
    getStorageSync: jest.fn(),
    setStorageSync: jest.fn(),
    cloud: {
      database: jest.fn(() => db),
      callFunction: jest.fn(({ name, data }) => {
        if (name === 'tournaments') {
          return Promise.resolve({
            result: {
              success: true,
              data: { tournaments, total: tournaments.length }
            }
          })
        }
        if (name === 'match-results') {
          return Promise.resolve({
            result: {
              success: true,
              data: { results: resultRowsByTournament[data.tournamentId] || [] }
            }
          })
        }
        return Promise.resolve({
          result: {
            success: true,
            data: registrationsByTournament[data.tournamentId] || []
          }
        })
      })
    }
  }
  global.Page = def => { pageDef = def }
  require('../index')
  return { pageDef, app, db }
}

function makeCtx(def) {
  return {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    __patches: [],
    getTabBar: jest.fn(() => ({ refresh: jest.fn() })),
    setData(patch) {
      this.__patches.push(patch)
      Object.assign(this.data, patch)
    }
  }
}

describe('match page tournament entry permissions', () => {
  test('starts in loading state and guards empty state until loading finishes', () => {
    const fs = require('fs')
    const path = require('path')
    const { pageDef } = loadPage()
    const wxml = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8')

    expect(pageDef.data.loading).toBe(true)
    expect(wxml).toContain('<view class="match-skeleton" wx:if="{{loading && tournaments.length === 0}}">')
    expect(wxml).toContain('<skeleton-loader rows="{{6}}" />')
    expect(wxml).toContain('<view wx:if="{{!loading && tournaments.length === 0}}" class="match-empty">')
  })

  test('opens unified tournament detail page from events list', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)

    ctx.onItemTap({ currentTarget: { dataset: { id: 't1' } } })

    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-detail/index?id=t1' })
  })

  test('decorates admin events as editable', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { isAdmin: true }, refreshIdentity: jest.fn().mockResolvedValue(null) }
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__permissionLabel).toBe('可编辑')
    expect(ctx.data.tournaments[0].__permissionKind).toBe('admin')
  })

  test('sorts tournaments by creation time descending so newest appears first', async () => {
    const { pageDef } = loadPage({
      tournaments: [
        { _id: 'old', name: '旧赛事', type: 'singles', createTime: '2026-05-20T10:00:00+08:00' },
        { _id: 'new', name: '新赛事', type: 'singles', createTime: '2026-05-22T10:00:00+08:00' },
        { _id: 'mid', name: '中间赛事', type: 'singles', createdAt: '2026-05-21T10:00:00+08:00' }
      ]
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments.map(t => t._id)).toEqual(['new', 'mid', 'old'])
  })

  test('loads tournaments through cloud function instead of direct collection read', async () => {
    const { pageDef, db } = loadPage()
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournaments',
      data: expect.objectContaining({ action: 'list', pageSize: 100 })
    })
    expect(db.collection).not.toHaveBeenCalledWith('tournaments')
  })

  test('does not refresh identity while browsing public tournament list', async () => {
    const app = { globalData: {}, refreshIdentity: jest.fn().mockResolvedValue(null) }
    const { pageDef } = loadPage({ app })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(app.refreshIdentity).not.toHaveBeenCalled()
  })

  test('decorates admin schedule-published events as editable', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { isAdmin: true }, refreshIdentity: jest.fn().mockResolvedValue(null) },
      tournaments: [{ _id: 't1', name: 'FU Open', type: 'singles', scheduleStatus: 'published' }]
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__permissionLabel).toBe('可编辑')
    expect(ctx.data.tournaments[0].__permissionKind).toBe('admin')
  })

  test('decorates participant events as scoreable', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false }, refreshIdentity: jest.fn().mockResolvedValue(null) },
      registrationsByTournament: {
        t1: [{ playerId: 'm1', playerName: 'A', status: 'registered' }]
      }
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__permissionLabel).toBe('可录分')
    expect(ctx.data.tournaments[0].__permissionKind).toBe('participant')
  })

  test('decorates participant schedule-published events as registered', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false }, refreshIdentity: jest.fn().mockResolvedValue(null) },
      tournaments: [{ _id: 't1', name: 'FU Open', type: 'singles', scheduleStatus: 'published' }],
      registrationsByTournament: {
        t1: [{ playerId: 'm1', playerName: 'A', registrationStatus: 'confirmed' }]
      }
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__permissionLabel).toBe('已报名')
    expect(ctx.data.tournaments[0].__permissionKind).toBe('participant')
  })

  test('decorates registration open tournament as available to register for viewer', async () => {
    const { pageDef } = loadPage({
      tournaments: [{
        _id: 't1',
        name: '5月周末赛',
        format: 'regular',
        type: 'singles',
        registrationPublishedAt: '2099-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2099-05-24T18:00:00+08:00',
        scheduleStatus: 'none'
      }]
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__statusLabel).toBe('报名中')
    expect(ctx.data.tournaments[0].__permissionLabel).toBe('可报名')
  })

  test('decorates participant pending schedule as waiting for schedule', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false }, refreshIdentity: jest.fn().mockResolvedValue(null) },
      tournaments: [{
        _id: 't1',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'none'
      }],
      registrationsByTournament: { t1: [{ playerId: 'm1', registrationStatus: 'confirmed' }] }
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__permissionLabel).toBe('等待赛程')
  })

  test('decorates non-participant events as view only', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm2' }, isAdmin: false }, refreshIdentity: jest.fn().mockResolvedValue(null) },
      registrationsByTournament: {
        t1: [{ playerId: 'm1', playerName: 'A', status: 'registered' }]
      }
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__permissionLabel).toBe('仅查看')
    expect(ctx.data.tournaments[0].__permissionKind).toBe('viewer')
  })

  test('decorates tournament status display fields', async () => {
    const { pageDef } = loadPage({
      tournaments: [{ _id: 't1', name: 'FU Open', type: 'singles', status: 'live' }]
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__statusKind).toBe('ongoing')
    expect(ctx.data.tournaments[0].__statusLabel).toBe('进行中')
    expect(ctx.data.tournaments[0].__statusHint).toBe('赛事进行中')
  })

  test('decorates all-confirmed stale upcoming event as settled', async () => {
    const { pageDef } = loadPage({
      tournaments: [{ _id: 't1', name: 'FU Open', type: 'singles', status: 'upcoming' }],
      resultRowsByTournament: {
        t1: [
          { player1: { id: 'A' }, player2: { id: 'B' }, resultStatus: 'confirmed' },
          { player1: { id: 'C' }, player2: { id: 'D' }, resultStatus: 'confirmed' }
        ]
      }
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.data.tournaments[0].__statusKind).toBe('settled')
    expect(ctx.data.tournaments[0].__statusLabel).toBe('已结算')
  })

  test('uses fresh cached tournament list without hitting database', async () => {
    const { pageDef, db } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false }, refreshIdentity: jest.fn().mockResolvedValue(null) }
    })
    wx.getStorageSync.mockReturnValue({
      value: { tournaments: [{ _id: 'cached-t1', name: 'Cached Open' }] },
      updatedAt: 1000,
      expiresAt: Date.now() + 60 * 1000
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(db.collection).not.toHaveBeenCalled()
    expect(ctx.data.tournaments).toEqual([{ _id: 'cached-t1', name: 'Cached Open' }])
  })

  test('deleted tournament dirty flag bypasses fresh cache and removes stale card immediately', async () => {
    const { pageDef, app, db } = loadPage({
      app: {
        globalData: {
          currentMember: { _id: 'm1' },
          isAdmin: true,
          tournamentListDirty: true,
          deletedTournamentId: 'deleted-t2'
        },
        refreshIdentity: jest.fn().mockResolvedValue(null)
      },
      tournaments: [{ _id: 't1', name: 'Still Here', type: 'singles' }]
    })
    wx.getStorageSync.mockReturnValue({
      value: {
        tournaments: [
          { _id: 't1', name: 'Still Here' },
          { _id: 'deleted-t2', name: 'Deleted Event' }
        ]
      },
      updatedAt: 1000,
      expiresAt: Date.now() + 60 * 1000
    })
    const ctx = makeCtx(pageDef)

    await ctx.loadTournaments()

    expect(ctx.__patches[0]).toEqual({
      tournaments: [{ _id: 't1', name: 'Still Here' }],
      loading: false
    })
    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournaments',
      data: expect.objectContaining({ action: 'list', pageSize: 100 })
    })
    expect(db.collection).not.toHaveBeenCalledWith('tournaments')
    expect(ctx.data.tournaments).toEqual([
      expect.objectContaining({ _id: 't1', name: 'Still Here' })
    ])
    expect(app.globalData.tournamentListDirty).toBe(false)
    expect(app.globalData.deletedTournamentId).toBe('')
  })
})
