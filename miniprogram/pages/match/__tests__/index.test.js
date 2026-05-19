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
    cloud: {
      database: jest.fn(() => db),
      callFunction: jest.fn(({ name, data }) => {
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
    getTabBar: jest.fn(() => ({ refresh: jest.fn() })),
    setData(patch) {
      Object.assign(this.data, patch)
    }
  }
}

describe('match page tournament entry permissions', () => {
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
})
