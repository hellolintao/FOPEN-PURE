function loadPage(options = {}) {
  jest.resetModules()
  let pageDef
  const app = options.app || { globalData: {} }
  const registrations = options.registrations || []
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
        get: jest.fn().mockResolvedValue({ data: [] })
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
      return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: null }) })) }
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
    stopPullDownRefresh: jest.fn(),
    cloud: {
      database: jest.fn(() => db),
      callFunction: jest.fn().mockResolvedValue({ result: { success: true, data: [] } })
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
})
