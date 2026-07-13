const fs = require('fs')
const path = require('path')

describe('tournament-detail WXML layout', () => {
  test('orders phase, hero, roster, schedule, points, results, and delete sections in main content', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
    const markers = [
      '<!-- PHASE -->',
      '<!-- HERO -->',
      '<!-- REGISTRATIONS -->',
      '<!-- SCHEDULE -->',
      '<!-- POINTS RULES -->',
      '<!-- RESULTS -->',
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
    expect(positions[4]).toBeLessThan(positions[5])
    expect(positions[5]).toBeLessThan(positions[6])
  })

  test('uses a standings table above stable keyed result match rows', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('wx:for="{{resultDisplay.standings}}" wx:key="standingKey"')
    expect(wxml).not.toContain('wx:for="{{resultDisplay.leaders}}"')
    expect(wxml).toContain('wx:for="{{group.matches}}" wx:for-item="match" wx:key="matchId"')
  })

  test('uses localized hero labels and a full-width wrapping court time row', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('比赛时间')
    expect(wxml).toContain('报名截止')
    expect(wxml).toContain('地点')
    expect(wxml).toContain('场地时间')
    expect(wxml).toContain('hero-meta-block hero-meta-wide hero-meta-court-time')
    expect(wxml).toContain('hero-meta-val hero-meta-val-wrap')
    expect(wxml).not.toContain('>DATE<')
    expect(wxml).not.toContain('>DEADLINE<')
    expect(wxml).not.toContain('>COURT TIME<')
  })

  test('binds current-member schedule highlight classes', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
    const wxss = fs.readFileSync(path.join(__dirname, '../index.wxss'), 'utf8')

    expect(wxml).toContain("{{cell.__isMine ? 'cell-mine' : ''}}")
    expect(wxml).toContain("{{cell.__player1Mine ? 'player-mine' : ''}}")
    expect(wxml).toContain("{{cell.__player2Mine ? 'player-mine' : ''}}")
    expect(wxml).not.toContain('mine-badge')
    expect(wxml).not.toContain('我的</view>')
    expect(wxss).not.toContain('inset 8rpx 0 0 var(--color-ink)')
  })

  test('frontend creator logic does not compare WeChat openid fields', () => {
    const js = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8')

    expect(js).not.toContain('createdByOpenid')
    expect(js).not.toContain('member.openid')
    expect(js).not.toContain('member.openId')
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
  const currentSeason = options.currentSeason || null
  const members = options.members || []
  const membersById = Object.fromEntries(members.map(member => [member._id, member]))
  const safeRegistrations = options.safeRegistrations || registrations.map(reg => ({
    ...reg,
    playerAvatarUrl: reg.playerAvatarUrl || (membersById[reg.playerId] && membersById[reg.playerId].avatarUrl) || reg.avatarUrl || '',
    partnerAvatarUrl: reg.partnerAvatarUrl || (membersById[reg.partnerId] && membersById[reg.partnerId].avatarUrl) || ''
  }))
  const callFunction = options.callFunction
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
    pageScrollTo: jest.fn(),
    createSelectorQuery: jest.fn(() => ({
      select: jest.fn(() => ({
        boundingClientRect: jest.fn(callback => {
          callback({ top: 180 })
          return { exec: jest.fn() }
        })
      }))
    })),
    stopPullDownRefresh: jest.fn(),
    cloud: {
      database: jest.fn(() => db),
      callFunction: jest.fn(({ name, data }) => {
        if (name === 'tournaments' && data && data.action === 'get') {
          return Promise.resolve({ result: { success: true, data: tournament } })
        }
        if (callFunction) return callFunction({ name, data })
        if (name === 'tournament-registrations') {
          return Promise.resolve({ result: { success: true, data: safeRegistrations, total: safeRegistrations.length } })
        }
        if (name === 'match-results') {
          return Promise.resolve({ result: { success: true, data: { results: matchResults } } })
        }
        if (name === 'seasons') {
          if (data && data.action === 'get' && options.rejectSeasonGet) {
            return Promise.reject(new Error('season get failed'))
          }
          if (data && data.action === 'getCurrent') {
            return Promise.resolve({ result: { success: true, data: currentSeason } })
          }
          const id = data && data.id
          return Promise.resolve({ result: { data: seasons[id] || null } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      })
    }
  }
  global.Page = def => { pageDef = def }
  require('../index')
  return { pageDef, app, db, registrationChain, memberChain }
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

async function loadDetail(options = {}) {
  const { pageDef } = loadPage({
    ...options,
    app: options.app || { globalData: { currentMember: { _id: 'admin1' }, isAdmin: !!options.isAdmin } }
  })
  const ctx = makeCtx(pageDef, { tournamentId: (options.tournament && options.tournament._id) || 't1' })

  await ctx.refresh()

  return ctx
}

describe('tournament-detail score permissions', () => {
  test('loads tournament detail through cloud function instead of direct collection read', async () => {
    const { pageDef, db } = loadPage({
      tournament: {
        _id: 't1',
        name: 'FU Open',
        type: 'singles',
        format: 'regular',
        startDate: '2026-05-25',
        scheduleStatus: 'published'
      },
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false } }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.loadTournamentDetail()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournaments',
      data: { action: 'get', id: 't1' }
    })
    expect(db.collection).not.toHaveBeenCalledWith('tournaments')
  })

  test('cold-start participant share entry restores identity before deriving footer actions', async () => {
    const app = {
      globalData: { currentMember: null, isAdmin: false },
      refreshIdentity: jest.fn().mockImplementation(async () => {
        app.globalData.currentMember = { _id: 'm1', name: 'Alice' }
        return app.globalData.currentMember
      })
    }
    const { pageDef } = loadPage({
      tournament: {
        _id: 't1',
        name: 'FU Open',
        type: 'singles',
        format: 'regular',
        scheduleStatus: 'published'
      },
      registrations: [{ _id: 'r1', playerId: 'm1', playerName: 'Alice', status: 'registered' }],
      app
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', entry: 'register' })

    await ctx.refresh()

    expect(ctx.data.footerActions.map(action => action.key)).toEqual(['share', 'enterScore'])
    expect(app.refreshIdentity).toHaveBeenCalledTimes(1)
  })

  test('failed cold-start identity restoration keeps the viewer public-only', async () => {
    const app = {
      globalData: { currentMember: null, isAdmin: false },
      refreshIdentity: jest.fn().mockRejectedValue(new Error('identity unavailable'))
    }
    const { pageDef } = loadPage({
      tournament: {
        _id: 't1',
        name: 'FU Open',
        type: 'singles',
        format: 'regular',
        scheduleStatus: 'published'
      },
      registrations: [{ _id: 'r1', playerId: 'm1', playerName: 'Alice', status: 'registered' }],
      app
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', entry: 'register' })

    await ctx.refresh()

    expect(ctx.data.footerActions.map(action => action.key)).toEqual(['share'])
    expect(app.refreshIdentity).toHaveBeenCalledTimes(1)
  })

  test('group knockout draft shows edit and arrange bracket footer actions', async () => {
    const ctx = await loadDetail({
      tournament: { _id: 't1', format: 'group_knockout', type: 'singles', bracketSize: 16, groupKnockoutPhase: 'group_draft', status: 'upcoming', scheduleStatus: 'none' },
      isAdmin: true
    })
    expect(ctx.data.footerActions.map(a => a.key)).toEqual(['share', 'edit', 'arrangeGroupBracket'])
    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '编辑', '安排签表'])
  })

  test('group knockout published shows score action', async () => {
    const ctx = await loadDetail({
      tournament: { _id: 't1', format: 'group_knockout', type: 'singles', bracketSize: 16, groupKnockoutPhase: 'group_published', status: 'upcoming', scheduleStatus: 'published' },
      isAdmin: true
    })
    expect(ctx.data.footerActions.map(a => a.key)).toContain('enterScore')
  })

  test('group knockout completed knockout keeps bracket score and resettle actions', async () => {
    const ctx = await loadDetail({
      tournament: { _id: 't1', format: 'group_knockout', type: 'singles', bracketSize: 16, groupKnockoutPhase: 'knockout_published', status: 'completed', scheduleStatus: 'none' },
      isAdmin: true
    })
    expect(ctx.data.footerActions.map(a => a.key)).toEqual(expect.arrayContaining([
      'viewBracket',
      'enterScore',
      'resettleGroupKnockout'
    ]))
  })

  test('group knockout knockout phase uses score label even when registration deadline is still open', async () => {
    const ctx = await loadDetail({
      tournament: {
        _id: 't1',
        format: 'group_knockout',
        type: 'singles',
        bracketSize: 12,
        groupKnockoutPhase: 'knockout_published',
        status: 'upcoming',
        startDate: '2026-05-29',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-31T23:59:00+08:00',
        scheduleStatus: 'none'
      },
      isAdmin: true
    })

    expect(ctx.data.tournamentDisplay.statusLabel).toBe('淘汰赛进行中')
    expect(ctx.data.scoreActionLabel).toBe('录入赛果')
    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '查看签表', '录入赛果'])
    expect(ctx.data.footerActions.map(a => a.key)).toEqual(['share', 'viewBracket', 'enterScore'])
  })

  test('registration open member sees registration phase and register CTA', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm2' }, isAdmin: false } },
      tournament: {
        _id: 't1',
        name: '5月周末赛',
        type: 'singles',
        format: 'regular',
        startDate: '2026-05-25',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
        scheduleStatus: 'none'
      },
      registrations: []
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', entry: 'register', now: '2026-05-21T12:00:00+08:00' })

    await ctx.refresh()

    expect(ctx.data.phase).toBe('registration_open')
    expect(ctx.data.primaryActionLabel).toBe('我要报名')
    expect(ctx.data.showRegistrationStatusCard).toBe(false)
    expect(ctx.data.selfRegistrationSupported).toBe(true)
  })

  test('builds hero display fields for season, location, deadlines, and full court time', async () => {
    const { pageDef } = loadPage({
      tournament: {
        _id: 't1',
        name: '测试05224',
        type: 'mixed',
        format: 'regular',
        status: 'upcoming',
        seasonId: 'season_1740000000000',
        location: '海峡奥体网球场',
        startDate: '2026-05-22',
        registrationDeadlineAt: '2026-05-31T23:59:00+08:00',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        scheduleStatus: 'none',
        schedulePlan: {
          slotMinutes: 20,
          courts: [
            {
              courtId: 'c1',
              name: '比赛2',
              location: '室内A区',
              slots: [
                '2026-05-22T08:00',
                '2026-05-22T08:20',
                '2026-05-22T08:40',
                '2026-05-22T09:00',
                '2026-05-22T09:20',
                '2026-05-22T09:40'
              ]
            },
            {
              courtId: 'c2',
              name: '中心场',
              location: '西门',
              slots: ['2026-05-22T14:00', '2026-05-22T14:20']
            }
          ]
        }
      },
      seasons: {
        season_1740000000000: { _id: 'season_1740000000000', name: '2026 春季赛' }
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', now: '2026-05-21T12:00:00+08:00' })

    await ctx.refresh()

    expect(ctx.data.tournamentDisplay).toMatchObject({
      seasonText: '2026 春季赛',
      matchTimeText: '2026-05-22',
      locationText: '海峡奥体网球场',
      registrationDeadlineLabel: '5月31日 23:59',
      withdrawDeadlineLabel: '5月21日 24:00',
      courtTimeText: '比赛2（室内A区）：08:00-10:00；中心场（西门）：14:00-14:40'
    })
  })

  test('falls back to current season when direct season lookup fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { pageDef } = loadPage({
        rejectSeasonGet: true,
        tournament: { _id: 't1', name: '测试05224', type: 'mixed', format: 'regular', status: 'upcoming', seasonId: 'stale_season', startDate: '2026-05-22' },
        currentSeason: {
          seasonId: 'season_1740000000000',
          season: { _id: 'season_1740000000000', name: '2026 春季赛' }
        }
      })
      const ctx = makeCtx(pageDef, { tournamentId: 't1' })

      await ctx.loadTournamentDetail()

      expect(ctx.data.tournament.seasonName).toBe('2026 春季赛')
      expect(ctx.data.tournamentDisplay.seasonText).toBe('2026 春季赛')
    } finally {
      warnSpy.mockRestore()
    }
  })

  test('registered member before withdraw deadline sees withdraw CTA and no waiting button', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false } },
      tournament: {
        _id: 't1',
        startDate: '2026-05-24',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'none'
      },
      registrations: [{ _id: 'reg1', playerId: 'm1', registrationStatus: 'confirmed' }]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', now: '2026-05-23T23:00:00+08:00' })

    await ctx.refresh()

    expect(ctx.data.phase).toBe('pending_schedule')
    expect(ctx.data.primaryActionLabel).toBe('退出报名')
    expect(ctx.data.showWaitingScheduleButton).toBe(false)
  })

  test('admin pending schedule sees share edit and arrange actions', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'admin1' }, isAdmin: true } },
      tournament: {
        _id: 't1',
        startDate: '2026-05-24',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'none'
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '编辑', '安排对局'])
  })

  test('registration open non-creator admin can register while keeping edit action', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'admin2', openid: 'openid-admin2', admin: true }, isAdmin: true } },
      tournament: {
        _id: 't1',
        createdBy: 'admin1',
        type: 'singles',
        format: 'regular',
        startDate: '2026-05-25',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
        scheduleStatus: 'none'
      },
      registrations: []
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', now: '2026-05-21T12:00:00+08:00' })

    await ctx.refresh()

    expect(ctx.data.isAdmin).toBe(true)
    expect(ctx.data.isCreator).toBe(false)
    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '编辑', '我要报名', '安排对局'])
    expect(ctx.data.primaryActionLabel).toBe('安排对局')
  })

  test('registration open non-creator admin does not see self-register CTA when capacity is full', async () => {
    const registrations = Array.from({ length: 12 }, (_, index) => ({
      _id: `reg${index + 1}`,
      playerId: `m${index + 1}`,
      playerName: `P${index + 1}`,
      registrationStatus: 'confirmed'
    }))
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'admin2', openid: 'openid-admin2', admin: true }, isAdmin: true } },
      tournament: {
        _id: 't1',
        createdBy: 'admin1',
        type: 'singles',
        format: 'knockout',
        maxPlayers: 12,
        startDate: '2026-05-25',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
        scheduleStatus: 'none'
      },
      registrations
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', now: '2026-05-21T12:00:00+08:00' })

    await ctx.refresh()

    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '编辑', '安排对局'])
    expect(ctx.data.footerActions.map(a => a.key)).not.toContain('registerSelf')
  })

  test('registration open creator admin keeps management actions without self-register CTA', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'admin1', openid: 'openid-admin1', admin: true }, isAdmin: true } },
      tournament: {
        _id: 't1',
        createdBy: 'admin1',
        type: 'singles',
        format: 'regular',
        startDate: '2026-05-25',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
        scheduleStatus: 'none'
      },
      registrations: []
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', now: '2026-05-21T12:00:00+08:00' })

    await ctx.refresh()

    expect(ctx.data.isCreator).toBe(true)
    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '编辑', '安排对局'])
    expect(ctx.data.footerActions.map(a => a.key)).not.toContain('registerSelf')
  })

  test('schedule published shows schedule before roster and hides registration module', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', scheduleStatus: 'published', status: 'upcoming', schedulePlan: { courts: [] } }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.phase).toBe('schedule_published')
    expect(ctx.data.showRegistrationModule).toBe(false)
    expect(ctx.data.showScheduleSection).toBe(true)
  })

  test('schedule view marks current member matches for default highlight', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false } },
      tournament: {
        _id: 't1',
        scheduleStatus: 'published',
        status: 'upcoming',
        schedulePlan: {
          courts: [
            { courtId: 'c1', name: '1号场', slots: ['2026-05-25T18:00:00+08:00'] },
            { courtId: 'c2', name: '2号场', slots: ['2026-05-25T18:00:00+08:00'] }
          ]
        }
      },
      callFunction: ({ name, data }) => {
        if (name === 'tournament-brackets' && data && data.action === 'getByTournament') {
          return Promise.resolve({
            result: {
              success: true,
              data: [{
                round: 1,
                matches: [
                  {
                    matchId: 'mine-match',
                    courtId: 'c1',
                    queueOrder: 0,
                    matchKind: 'regularRound',
                    player1: { id: 'm1', name: '陈一' },
                    player2: { id: 'm2', name: '王五' }
                  },
                  {
                    matchId: 'other-match',
                    courtId: 'c2',
                    queueOrder: 0,
                    matchKind: 'regularRound',
                    player1: { id: 'm3', name: '张三' },
                    player2: { id: 'm4', name: '李四' }
                  }
                ]
              }]
            }
          })
        }
        if (name === 'match-results') {
          return Promise.resolve({ result: { success: true, data: { results: [] } } })
        }
        return Promise.resolve({ result: { success: true, data: { items: [] } } })
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    const cells = ctx.data.scheduleRows[0].cells
    expect(cells[0]).toMatchObject({
      matchId: 'mine-match',
      __isMine: true,
      __player1Mine: true,
      __player2Mine: false
    })
    expect(cells[1]).toMatchObject({
      matchId: 'other-match',
      __isMine: false,
      __player1Mine: false,
      __player2Mine: false
    })
  })

  test('legacy tournament keeps existing schedule and confirmed results visible', async () => {
    const { pageDef } = loadPage({
      tournament: {
        _id: 'legacy1',
        name: 'Legacy Cup',
        status: 'upcoming',
        startDate: '2026-05-25',
        schedulePlan: {
          slotMinutes: 20,
          courts: [{ courtId: 'c1', name: '1号场', slots: ['2026-05-25T18:00:00+08:00'] }]
        }
      },
      registrations: [
        { playerId: 'A', playerName: 'A', registrationStatus: 'confirmed' },
        { playerId: 'B', playerName: 'B', registrationStatus: 'confirmed' }
      ],
      matchResults: [
        {
          _id: 'm1',
          player1: { id: 'A', name: 'A' },
          player2: { id: 'B', name: 'B' },
          winner: { id: 'A', name: 'A' },
          score: { sets: [{ a: 4, b: 2 }] },
          resultStatus: 'confirmed'
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 'legacy1' })

    await ctx.refresh()

    expect(ctx.data.phase).toBe('legacy')
    expect(ctx.data.showScheduleSection).toBe(true)
    expect(ctx.data.showResultsSection).toBe(true)
    expect(ctx.data.resultDisplay.visible).toBe(true)
    expect(ctx.data.scheduleCourts).toHaveLength(1)
  })

  test('schedule published admin can edit schedule and enter score from footer', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'admin1' }, isAdmin: true } },
      tournament: { _id: 't1', scheduleStatus: 'published', status: 'upcoming', schedulePlan: { courts: [] } }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '编辑赛程', '录入成绩'])
  })

  test('results admin can adjust results from footer without registration module', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'admin1' }, isAdmin: true } },
      tournament: { _id: 't1', scheduleStatus: 'published', status: 'completed', schedulePlan: { courts: [] } }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.phase).toBe('results')
    expect(ctx.data.showRegistrationModule).toBe(false)
    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '调整成绩'])
  })

  test('knockout doubles hides unsupported self-register CTA', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm2' }, isAdmin: false } },
      tournament: {
        _id: 't1',
        type: 'doubles',
        format: 'knockout',
        startDate: '2026-05-25',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
        scheduleStatus: 'none'
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1', now: '2026-05-21T12:00:00+08:00' })

    await ctx.refresh()

    expect(ctx.data.selfRegistrationSupported).toBe(false)
    expect(ctx.data.primaryActionLabel).toBe('')
    expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享'])
  })

  test('onRegisterSelf cancels guest login without refreshing identity or registering', async () => {
    const app = {
      globalData: { currentMember: null, isAdmin: false },
      refreshIdentity: jest.fn().mockResolvedValue(null)
    }
    const { pageDef } = loadPage({ app })
    wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: false }))
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })
    ctx.refresh = jest.fn()

    await ctx.onRegisterSelf()

    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '登录后报名',
      confirmText: '去登录'
    }))
    expect(app.refreshIdentity).not.toHaveBeenCalled()
    expect(wx.navigateTo).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'tournament-registrations'
    }))
    expect(ctx.refresh).not.toHaveBeenCalled()
  })

  test('onRegisterSelf returns registered guest to registration section without auto-registering', async () => {
    const app = {
      globalData: { currentMember: null, isAdmin: false },
      refreshIdentity: jest.fn().mockImplementation(async () => {
        app.globalData.currentMember = { _id: 'm1', name: 'Alice', claimStatus: 'claimed' }
        return app.globalData.currentMember
      })
    }
    const { pageDef } = loadPage({ app })
    wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: true }))
    const ctx = makeCtx(pageDef, { tournamentId: 't1', entry: '' })
    ctx.refresh = jest.fn()

    await ctx.onRegisterSelf()

    expect(app.refreshIdentity).toHaveBeenCalled()
    expect(ctx.data.entry).toBe('register')
    expect(ctx.refresh).toHaveBeenCalled()
    expect(wx.navigateTo).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'tournament-registrations'
    }))
  })

  test('onRegisterSelf sends unregistered guest to register flow without auto-registering', async () => {
    const app = {
      globalData: { currentMember: null, isAdmin: false },
      refreshIdentity: jest.fn().mockResolvedValue(null)
    }
    const { pageDef } = loadPage({ app })
    wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: true }))
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })
    ctx.refresh = jest.fn()

    await ctx.onRegisterSelf()

    expect(app.refreshIdentity).toHaveBeenCalled()
    expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/edit-profile/index?mode=register&from=tournament-register&tournamentId=t1',
      events: expect.objectContaining({
        registrationIdentityReady: expect.any(Function)
      })
    }))
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'tournament-registrations'
    }))
    expect(ctx.refresh).not.toHaveBeenCalled()
  })

  test('onRegisterSelf navigates to edit profile for unclaimed identity', async () => {
    const member = { _id: 'm1', claimStatus: 'unclaimed' }
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: member, isAdmin: false } }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })
    ctx.refresh = jest.fn()

    await ctx.onRegisterSelf()

    expect(wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/edit-profile/index?mode=register&from=tournament-register&tournamentId=t1',
      events: expect.objectContaining({
        registrationIdentityReady: expect.any(Function)
      })
    }))
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'tournament-registrations'
    }))
  })

  test('onRegisterSelf lets bound non-creator admin register without opening profile editor', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'admin2', openid: 'openid-admin2', admin: true }, isAdmin: true } },
      callFunction: ({ name }) => {
        if (name === 'tournament-registrations') {
          return Promise.resolve({ result: { success: true, data: { registrationId: 'reg_admin2' } } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      }
    })
    const ctx = makeCtx(pageDef, {
      tournamentId: 't1',
      tournament: { _id: 't1', createdBy: 'admin1' },
      isCreator: false
    })
    ctx.refresh = jest.fn()

    await ctx.onRegisterSelf()

    expect(wx.navigateTo).not.toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/pages/edit-profile/index')
    }))
    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournament-registrations',
      data: { action: 'selfRegister', tournamentId: 't1' }
    })
    expect(ctx.refresh).toHaveBeenCalled()
  })

  test('onRegisterSelf lets bound legacy member register without opening profile editor', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1', openid: 'openid-a', name: 'Alice' }, isAdmin: false } },
      callFunction: ({ name }) => {
        if (name === 'tournament-registrations') {
          return Promise.resolve({ result: { success: true, data: { registrationId: 'reg_m1' } } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      }
    })
    const ctx = makeCtx(pageDef, {
      tournamentId: 't1',
      tournament: { _id: 't1', createdBy: 'admin1' },
      isCreator: false
    })
    ctx.refresh = jest.fn()

    await ctx.onRegisterSelf()

    expect(wx.navigateTo).not.toHaveBeenCalledWith(expect.objectContaining({
      url: expect.stringContaining('/pages/edit-profile/index')
    }))
    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournament-registrations',
      data: { action: 'selfRegister', tournamentId: 't1' }
    })
    expect(ctx.refresh).toHaveBeenCalled()
  })

  test('onRegisterSelf maps backend registration errors to clear toast', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1', openid: 'openid-a', claimStatus: 'claimed' }, isAdmin: false } },
      callFunction: ({ name }) => {
        if (name === 'tournament-registrations') {
          return Promise.resolve({ result: { success: false, error: { code: 'CAPACITY_FULL' } } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })
    ctx.refresh = jest.fn()

    await ctx.onRegisterSelf()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '名额已满', icon: 'none' })
    expect(ctx.refresh).not.toHaveBeenCalled()
  })

  test('onWithdrawSelf confirms modal and maps withdraw errors', async () => {
    const { pageDef } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1', claimStatus: 'claimed' }, isAdmin: false } },
      callFunction: ({ name }) => {
        if (name === 'tournament-registrations') {
          return Promise.resolve({ result: { success: false, error: { code: 'WITHDRAW_CLOSED' } } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      }
    })
    wx.showModal.mockImplementationOnce(({ success }) => success({ confirm: true }))
    const ctx = makeCtx(pageDef, { tournamentId: 't1', withdrawDeadlineLabel: '5月23日 24:00' })
    ctx.refresh = jest.fn()

    await ctx.onWithdrawSelf()

    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '退出报名',
      content: '确定退出本次赛事？退赛截止为 5月23日 24:00'
    }))
    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournament-registrations',
      data: { action: 'withdraw', tournamentId: 't1' }
    })
    expect(wx.showToast).toHaveBeenCalledWith({ title: '已过退赛截止时间', icon: 'none' })
    expect(ctx.refresh).not.toHaveBeenCalled()
  })

  test('onConfirmScheduleRevision does not refresh when backend returns failure', async () => {
    const { pageDef } = loadPage({
      callFunction: ({ name }) => {
        if (name === 'tournaments') {
          return Promise.resolve({ result: { success: false, error: { message: '没有权限' } } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })
    ctx.refresh = jest.fn()

    await ctx.onConfirmScheduleRevision()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '没有权限', icon: 'none' })
    expect(ctx.refresh).not.toHaveBeenCalled()
  })

  test('onConfirmScheduleRevision handles backend rejection without refreshing', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { pageDef } = loadPage({
      callFunction: ({ name }) => {
        if (name === 'tournaments') return Promise.reject(new Error('network'))
        return Promise.resolve({ result: { success: true, data: [] } })
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })
    ctx.refresh = jest.fn()

    await ctx.onConfirmScheduleRevision()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '确认失败', icon: 'none' })
    expect(ctx.refresh).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

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

  test('loadRegistrations consumes safe cloud rows without direct roster database reads', async () => {
    const safeRows = [
      {
        _id: 'reg-safe-1',
        tournamentId: 't1',
        playerId: 'm1',
        playerName: '选手01',
        playerAvatarUrl: '/images/icons/default-avatar.png',
        registrationStatus: 'confirmed',
        seed: 1
      },
      {
        _id: 'reg-safe-2',
        tournamentId: 't1',
        playerId: 'm2',
        playerName: 'Visible Player',
        playerAvatarUrl: '/visible.png',
        registrationStatus: 'confirmed',
        seed: 2
      }
    ]
    const { pageDef, db } = loadPage({
      app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false } },
      registrations: [{
        _id: 'reg-raw',
        tournamentId: 't1',
        playerId: 'm1',
        playerName: 'Raw Private Name',
        registrationStatus: 'confirmed'
      }],
      members: [{ _id: 'm1', avatarUrl: '/raw-private.png' }],
      callFunction: ({ name, data }) => {
        if (name === 'tournament-registrations' && data.action === 'list') {
          return Promise.resolve({ result: { success: true, data: safeRows, total: safeRows.length } })
        }
        return Promise.resolve({ result: { success: true, data: [] } })
      }
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.loadRegistrations()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournament-registrations',
      data: expect.objectContaining({
        action: 'list',
        tournamentId: 't1'
      })
    })
    expect(db.collection).not.toHaveBeenCalledWith('tournament_registrations')
    expect(db.collection).not.toHaveBeenCalledWith('members')
    expect(ctx.data.isParticipant).toBe(true)
    expect(ctx.data.registrations).toEqual([
      expect.objectContaining({
        playerId: 'm1',
        playerName: '选手01',
        avatarUrl: '/images/icons/default-avatar.png'
      }),
      expect.objectContaining({
        playerId: 'm2',
        playerName: 'Visible Player',
        avatarUrl: '/visible.png'
      })
    ])
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

  test('groups group knockout result display by group and knockout stages', async () => {
    const { pageDef } = loadPage({
      tournament: { _id: 't1', name: 'Group Cup', type: 'singles', format: 'group_knockout', bracketSize: 12, groupKnockoutPhase: 'completed', status: 'completed' },
      matchResults: [
        {
          _id: 'g-a1',
          stage: 'group',
          matchKind: 'group',
          groupCode: 'A',
          round: 1,
          position: 1,
          player1: { id: 'A1', name: 'Ella' },
          player2: { id: 'A2', name: '老板' },
          score: { sets: [{ a: 4, b: 2 }] },
          winner: { id: 'A1', name: 'Ella' },
          resultStatus: 'confirmed'
        },
        {
          _id: 'g-b1',
          stage: 'group',
          matchKind: 'group',
          groupCode: 'B',
          round: 1,
          position: 1,
          player1: { id: 'B1', name: '抖抖' },
          player2: { id: 'B2', name: '乐乐' },
          score: { sets: [{ a: 3, b: 3 }], tiebreak: '7-5' },
          winner: { id: 'B1', name: '抖抖' },
          resultStatus: 'confirmed'
        },
        {
          _id: 'qf1',
          stage: 'knockout',
          matchKind: 'bracket',
          round: 1,
          position: 1,
          player1: { id: 'A1', name: 'Ella' },
          player2: { id: 'C2', name: '林大' },
          score: { sets: [{ a: 4, b: 1 }] },
          winner: { id: 'A1', name: 'Ella' },
          resultStatus: 'confirmed'
        },
        {
          _id: 'sf1',
          stage: 'knockout',
          matchKind: 'bracket',
          round: 2,
          position: 1,
          player1: { id: 'A1', name: 'Ella' },
          player2: { id: 'B1', name: '抖抖' },
          score: { sets: [{ a: 2, b: 4 }] },
          winner: { id: 'B1', name: '抖抖' },
          resultStatus: 'confirmed'
        },
        {
          _id: 'final',
          stage: 'knockout',
          matchKind: 'bracket',
          round: 3,
          position: 1,
          player1: { id: 'B1', name: '抖抖' },
          player2: { id: 'D1', name: '杜导' },
          score: { sets: [{ a: 4, b: 2 }] },
          winner: { id: 'B1', name: '抖抖' },
          resultStatus: 'confirmed'
        }
      ]
    })
    const ctx = makeCtx(pageDef, { tournamentId: 't1' })

    await ctx.refresh()

    expect(ctx.data.resultDisplay.groups.map(group => group.label)).toEqual([
      '小组赛 A组',
      '小组赛 B组',
      '淘汰赛 8强',
      '淘汰赛 半决赛',
      '淘汰赛 决赛'
    ])
    expect(ctx.data.resultDisplay.groups.map(group => group.key)).toEqual([
      'group-A',
      'group-B',
      'knockout-1',
      'knockout-2',
      'knockout-3'
    ])
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
    jest.useFakeTimers().setSystemTime(new Date('2026-06-05T15:30:00+08:00'))
    try {
      const { pageDef } = loadPage()
      const ctx = makeCtx(pageDef, {
        tournamentId: 't1',
        tournament: { _id: 't1', name: '五月排位赛', status: 'ongoing' }
      })

      expect(ctx.onShareAppMessage()).toEqual({
        title: '五月排位赛 · 进行中',
        path: '/pages/tournament-detail/index?id=t1',
        imageUrl: '/images/share-registration/june-2026-registration-share-01.jpg'
      })
    } finally {
      jest.useRealTimers()
    }
  })

  test('shares registration-open detail with registration entry path', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-05T15:30:00+08:00'))
    try {
      const { pageDef } = loadPage()
      const ctx = makeCtx(pageDef, {
        tournamentId: 't1',
        showRegistrationModule: true,
        tournament: { _id: 't1', name: '五月排位赛', status: 'upcoming' }
      })

      expect(ctx.onShareAppMessage()).toEqual({
        title: '五月排位赛 · 待开始',
        path: '/pages/tournament-detail/index?id=t1&entry=register',
        imageUrl: '/images/share-registration/june-2026-registration-share-01.jpg'
      })
      expect(ctx.onShareTimeline()).toEqual({
        title: '五月排位赛 · 待开始',
        query: 'id=t1&entry=register',
        imageUrl: '/images/share-registration/june-2026-registration-share-02.jpg'
      })
    } finally {
      jest.useRealTimers()
    }
  })

  test('shares published schedule detail with schedule cover images', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-05T15:30:00+08:00'))
    try {
      const { pageDef } = loadPage()
      const ctx = makeCtx(pageDef, {
        tournamentId: 't1',
        tournament: {
          _id: 't1',
          name: '七月周末赛',
          status: 'upcoming',
          scheduleStatus: 'published'
        }
      })

      expect(ctx.onShareAppMessage()).toEqual({
        title: '七月周末赛 · 赛程已发布',
        path: '/pages/tournament-detail/index?id=t1',
        imageUrl: '/images/share-schedule/schedule-share-01.jpg'
      })
      expect(ctx.onShareTimeline()).toEqual({
        title: '七月周末赛 · 赛程已发布',
        query: 'id=t1',
        imageUrl: '/images/share-schedule/schedule-share-02.jpg'
      })
    } finally {
      jest.useRealTimers()
    }
  })

  test('shares group knockout published phase with schedule cover images while scheduleStatus remains none', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-05T15:30:00+08:00'))
    try {
      const { pageDef } = loadPage()
      const ctx = makeCtx(pageDef, {
        tournamentId: 't1',
        tournament: {
          _id: 't1',
          name: '小组淘汰赛',
          format: 'group_knockout',
          type: 'singles',
          groupKnockoutPhase: 'group_published',
          status: 'upcoming',
          scheduleStatus: 'none'
        }
      })

      expect(ctx.onShareAppMessage()).toEqual({
        title: '小组淘汰赛 · 小组赛进行中',
        path: '/pages/tournament-detail/index?id=t1',
        imageUrl: '/images/share-schedule/schedule-share-01.jpg'
      })
    } finally {
      jest.useRealTimers()
    }
  })
})
