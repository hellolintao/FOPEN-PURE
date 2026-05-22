function loadPage() {
  jest.resetModules()
  let pageDef
  const app = { globalData: {} }
  global.wx = {
    showToast: jest.fn(),
    showModal: jest.fn(),
    navigateBack: jest.fn(),
    redirectTo: jest.fn(),
    pageScrollTo: jest.fn(),
    showShareMenu: jest.fn(),
    showActionSheet: jest.fn(),
    cloud: { callFunction: jest.fn() }
  }
  global.getApp = () => app
  global.Page = def => { pageDef = def }
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  const ctx = {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) {
      Object.keys(patch).forEach(key => {
        if (!key.includes('.')) {
          this.data[key] = patch[key]
          return
        }
        const parts = key.split('.')
        let cur = this.data
        for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]]
        cur[parts[parts.length - 1]] = patch[key]
      })
    }
  }
  Object.assign(ctx.data, data)
  return ctx
}

const players = [
  { playerId: 'p1', playerName: 'A' },
  { playerId: 'p2', playerName: 'B' },
  { playerId: 'p3', playerName: 'C' },
  { playerId: 'p4', playerName: 'D' },
]

describe('tournament-edit mixed regular flow', () => {
  test('regular tournament defaults to mixed', () => {
    const def = loadPage()

    expect(def.data.form.format).toBe('regular')
    expect(def.data.form.type).toBe('mixed')
  })

  test('switching format to knockout moves mixed type back to singles', () => {
    const def = loadPage()
    const ctx = makeCtx(def)

    ctx.onChipTap({ currentTarget: { dataset: { k: 'format', v: 'knockout' } } })

    expect(ctx.data.form.format).toBe('knockout')
    expect(ctx.data.form.type).toBe('singles')
  })

  test('mixed type is blocked for knockout tournaments', () => {
    const def = loadPage()
    const ctx = makeCtx(def, { form: { ...def.data.form, format: 'knockout', type: 'singles' } })

    ctx.onChipTap({ currentTarget: { dataset: { k: 'type', v: 'mixed' } } })

    expect(ctx.data.form.type).toBe('singles')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '淘汰赛不支持混合', icon: 'none' })
  })

  test('mixed regular default schedule alternates singles, doubles, free play each hour', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      selectedPlayers: players,
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-17T08:00', '2026-05-17T08:20', '2026-05-17T08:40'] }]
    })

    ctx.applyDefaultSchedule()

    const queue = ctx.data.queues[0]
    expect(queue.items.map(item => item.kind)).toEqual(['match', 'match', 'freePlay'])
    expect(ctx.data.matches.map(match => match.type)).toEqual(['singles', 'doubles'])
    expect(ctx.data.freePlays).toHaveLength(1)
    expect(ctx.regularScheduleNeedsBuild()).toBe(false)
  })

  test('mixed regular schedule rebuilds when match type pattern is stale', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      matches: [
        { matchId: 'm1', type: 'singles' },
        { matchId: 'm2', type: 'singles' },
      ],
      queues: [{
        courtId: 'c1',
        items: [
          { kind: 'match', matchId: 'm1', order: 0 },
          { kind: 'match', matchId: 'm2', order: 1 },
          { kind: 'freePlay', matchId: 'fp1', order: 2 },
        ]
      }],
      schedulePlanCourts: [{ courtId: 'c1', slots: ['T08:00', 'T08:20', 'T08:40'] }]
    })

    expect(ctx.regularScheduleNeedsBuild()).toBe(true)
  })

  test('mixed tournaments require at least four players', () => {
    const def = loadPage()
    const ctx = makeCtx(def)

    expect(ctx._minPlayers()).toBe(4)
  })

  test('resolveSeasonId uses active season returned by seasons.getCurrent for the start date', async () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    wx.cloud.callFunction.mockResolvedValueOnce({
      result: {
        success: true,
        data: {
          seasonId: 'season_1740000000000',
          season: { _id: 'season_1740000000000', name: '2026 Spring' }
        }
      }
    })

    await expect(ctx.resolveSeasonId('2026-05-19')).resolves.toBe('season_1740000000000')
    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'seasons',
      data: { action: 'getCurrent', date: '2026-05-19' }
    })
  })

  test('resolveSeasonId falls back to nested season id from getCurrent data', async () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    wx.cloud.callFunction.mockResolvedValueOnce({
      result: {
        success: true,
        data: {
          season: { _id: 'season_nested', name: 'Nested' }
        }
      }
    })

    await expect(ctx.resolveSeasonId('2026-05-19')).resolves.toBe('season_nested')
  })

  test('resolveSeasonId falls back to top-level id from getCurrent data', async () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    wx.cloud.callFunction.mockResolvedValueOnce({
      result: {
        success: true,
        data: { _id: 'season_top_level' }
      }
    })

    await expect(ctx.resolveSeasonId('2026-05-19')).resolves.toBe('season_top_level')
  })

  test('resolveSeasonId falls back to season year when getCurrent has no id', async () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    wx.cloud.callFunction.mockRejectedValueOnce(new Error('cloud unavailable'))

    await expect(ctx.resolveSeasonId('2026-05-19')).resolves.toBe('season_2026')
  })
})

describe('tournament-edit registration publishing flow', () => {
  test('step 2 requires registration deadline before publishing registration', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, { tournamentId: 't1', form: { ...def.data.form, registrationDeadlineAt: '' } })

    await ctx.onPublishRegistration()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择报名截止', icon: 'none' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'tournaments',
      data: expect.objectContaining({ action: 'publishRegistration' })
    }))
  })

  test('step 2 publishes registration and opens registration detail entry', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 2,
      form: { ...def.data.form, name: '5月周末赛', registrationDeadlineAt: '2026-05-24T18:00:00+08:00' },
      selectedPlayers: players,
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
    })
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: { id: 't1' } } })

    await ctx.onPublishRegistration()

    expect(ctx.data.step).toBe(2)
    expect(ctx.data.registrationPublished).toBe(true)
    expect(ctx.data.sharePath).toBe('/pages/tournament-detail/index?id=t1&entry=register')
    expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/tournament-detail/index?id=t1&entry=register' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'match-results',
      data: expect.objectContaining({ action: 'bulkUpsertScheduledMatches' })
    }))
  })

  test('step 2 can publish registration without preselected players', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 2,
      form: { ...def.data.form, name: '5月周末赛', registrationDeadlineAt: '2026-05-24T18:00:00+08:00' },
      selectedPlayers: [],
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
    })
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: { id: 't1' } } })

    await ctx.onPublishRegistration()

    expect(ctx.data.registrationPublished).toBe(true)
    expect(ctx.data.sharePath).toBe('/pages/tournament-detail/index?id=t1&entry=register')
    expect(wx.redirectTo).toHaveBeenCalledWith({ url: '/pages/tournament-detail/index?id=t1&entry=register' })
    expect(wx.showToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('至少选') }))
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'tournament-registrations',
      data: expect.objectContaining({ action: 'bulkSet' })
    }))
  })

  test('publish registration failure does not open share menu', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 2,
      form: { ...def.data.form, registrationDeadlineAt: '2026-05-24T18:00:00+08:00' },
      selectedPlayers: players,
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
    })
    wx.cloud.callFunction
      .mockResolvedValueOnce({ result: { success: true, data: [] } })
      .mockResolvedValueOnce({ result: { success: false, error: { message: 'deadline expired' } } })

    await ctx.onPublishRegistration()

    expect(ctx.data.registrationPublished).toBe(false)
    expect(wx.showShareMenu).not.toHaveBeenCalled()
    expect(wx.redirectTo).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: 'deadline expired', icon: 'none' })
  })

  test('step 2 blocks registration publishing after schedule draft has started', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 2,
      scheduleStarted: true,
      form: { ...def.data.form, registrationDeadlineAt: '2026-05-24T18:00:00+08:00' },
      selectedPlayers: players,
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
    })

    await ctx.onPublishRegistration()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '请先清空排程草稿再重新开放报名', icon: 'none' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(wx.showShareMenu).not.toHaveBeenCalled()
    expect(wx.redirectTo).not.toHaveBeenCalled()
  })

  test('publish registration handles rejected cloud calls with fallback toast', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 2,
      form: { ...def.data.form, registrationDeadlineAt: '2026-05-24T18:00:00+08:00' },
      selectedPlayers: players,
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
    })
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    wx.cloud.callFunction.mockRejectedValueOnce(new Error('network down'))

    await expect(ctx.onPublishRegistration()).resolves.toBeUndefined()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '发布失败', icon: 'none' })
    expect(wx.showShareMenu).not.toHaveBeenCalled()
    expect(wx.redirectTo).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('share message uses registration share path after publishing', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      registrationPublished: true,
      sharePath: '/pages/tournament-detail/index?id=t1&entry=register',
      form: { ...def.data.form, name: '5月周末赛' }
    })

    expect(ctx.onShareAppMessage()).toEqual({
      title: '5月周末赛',
      path: '/pages/tournament-detail/index?id=t1&entry=register'
    })
  })

  test('timeline share uses encoded registration query after publishing', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't 1',
      registrationPublished: true,
      sharePath: '/pages/tournament-detail/index?id=t%201&entry=register',
      form: { ...def.data.form, name: '5月周末赛' }
    })

    expect(ctx.onShareTimeline()).toEqual({
      title: '5月周末赛',
      query: 'id=t%201&entry=register'
    })
  })

  test('manage registration scrolls to the registration management section', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      step: 2,
      registrationPublished: true
    })

    ctx.onManageRegistration()

    expect(ctx.data.step).toBe(2)
    expect(wx.pageScrollTo).toHaveBeenCalledWith({ selector: '.registration-card', duration: 240 })
  })

  test('step 2 next still enters schedule directly', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      selectedPlayers: players,
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
    })
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: [] } })

    await ctx.commitStep2()

    expect(ctx.data.step).toBe(3)
  })

  test('hydrateDraft reads registration publishing state from existing tournament', async () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    wx.cloud.callFunction
      .mockResolvedValueOnce({
        result: {
          success: true,
          data: {
            _id: 't1',
            name: '5月周末赛',
            registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
            registrationPublishedAt: '2026-05-21T12:00:00+08:00',
            scheduleStatus: 'draft',
            schedulePlan: { courts: [], queues: [] }
          }
        }
      })
      .mockResolvedValueOnce({ result: { success: true, data: [] } })
      .mockResolvedValueOnce({ result: { success: true, data: [] } })
      .mockResolvedValueOnce({ result: { success: true, data: { items: [] } } })

    await ctx.hydrateDraft('t1')

    expect(ctx.data.form.registrationDeadlineAt).toBe('2026-05-24T18:00:00+08:00')
    expect(ctx.data.registrationPublished).toBe(true)
    expect(ctx.data.scheduleStarted).toBe(true)
    expect(ctx.data.sharePath).toBe('/pages/tournament-detail/index?id=t1&entry=register')
  })

  test('step 3 save draft does not generate score rows', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 3,
      matches: [{ matchId: 'm1', round: 1, position: 1 }],
      queues: []
    })
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: {} } })

    await ctx.onSaveScheduleDraft()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournaments',
      data: { action: 'saveScheduleDraft', id: 't1', schedulePlan: expect.any(Object) }
    })
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'match-results',
      data: expect.objectContaining({ action: 'bulkUpsertScheduledMatches' })
    }))
  })

  test('step 3 save draft handles rejected cloud calls with fallback toast', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 3,
      matches: [{ matchId: 'm1', round: 1, position: 1 }],
      queues: []
    })
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    wx.cloud.callFunction.mockRejectedValueOnce(new Error('network down'))

    await expect(ctx.onSaveScheduleDraft()).resolves.toBeUndefined()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '保存草稿失败', icon: 'none' })
    errSpy.mockRestore()
  })

  test('step 3 publish schedule delegates score row generation to tournaments action', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 3,
      matches: [{ matchId: 'm1', round: 1, position: 1 }],
      queues: []
    })
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: {} } })

    await ctx.onPublishSchedule()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournaments',
      data: { action: 'publishSchedule', id: 't1' }
    })
    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
      name: 'match-results',
      data: expect.objectContaining({ action: 'bulkUpsertScheduledMatches' })
    }))
  })

  test('step 3 publish schedule handles rejected cloud calls with fallback toast', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      step: 3,
      matches: [{ matchId: 'm1', round: 1, position: 1 }],
      queues: []
    })
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    wx.cloud.callFunction.mockRejectedValueOnce(new Error('network down'))

    await expect(ctx.onPublishSchedule()).resolves.toBeUndefined()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '发布赛程失败', icon: 'none' })
    expect(wx.redirectTo).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('edit-schedule impact confirmation offers score handling choices for changed confirmed rows', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      scheduleEditMode: true,
      matchResultRows: [{ sourceMatchId: 'm1', resultStatus: 'confirmed' }],
      originalScheduleSnapshot: { m1: { courtId: 'c1', queueOrder: 0 } },
      matches: [{ matchId: 'm1', courtId: 'c2' }],
      queues: [{ courtId: 'c2', items: [{ kind: 'match', matchId: 'm1', order: 1 }] }]
    })
    wx.showActionSheet.mockImplementation(({ success }) => success({ tapIndex: 0 }))

    await expect(ctx.confirmScheduleEditImpact()).resolves.toBe('keep_time_only')

    expect(wx.showActionSheet).toHaveBeenCalledWith(expect.objectContaining({
      itemList: ['保留比分，仅改场地/时间', '清空比分并重新录入', '取消编辑']
    }))
    expect(ctx.data.scheduleImpactChoice).toBe('keep_time_only')
  })

  test('edit-schedule impact confirmation is skipped when confirmed rows are unaffected', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      scheduleEditMode: true,
      matchResultRows: [{ sourceMatchId: 'm1', resultStatus: 'confirmed' }],
      originalScheduleSnapshot: {
        m1: { sourceMatchId: 'm1', courtId: 'c1', queueOrder: 0, player1Key: 'p1:::', player2Key: 'p2:::' }
      },
      matches: [{ matchId: 'm1', courtId: 'c1', player1: { id: 'p1' }, player2: { id: 'p2' } }],
      queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] }]
    })

    await expect(ctx.confirmScheduleEditImpact()).resolves.toBe('none')

    expect(wx.showActionSheet).not.toHaveBeenCalled()
  })

  test('edit-schedule impact confirmation is required when players change at the same slot', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      scheduleEditMode: true,
      matchResultRows: [{ sourceMatchId: 'm1', resultStatus: 'confirmed' }],
      originalScheduleSnapshot: {
        m1: { courtId: 'c1', queueOrder: 0, player1Key: 'p1', player2Key: 'p2' }
      },
      matches: [{ matchId: 'm1', courtId: 'c1', player1: { id: 'p3' }, player2: { id: 'p2' } }],
      queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] }]
    })
    wx.showActionSheet.mockImplementation(({ success }) => success({ tapIndex: 1 }))

    await expect(ctx.confirmScheduleEditImpact()).resolves.toBe('invalidate_scores')

    expect(wx.showActionSheet).toHaveBeenCalled()
    expect(ctx.data.scheduleImpactChoice).toBe('invalidate_scores')
  })

  test('invalidate score impact is sent to backend before schedule writes continue', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      scheduleEditMode: true,
      matchResultRows: [{ sourceMatchId: 'm1', resultStatus: 'confirmed' }],
      originalScheduleSnapshot: {
        m1: { courtId: 'c1', queueOrder: 0, player1Key: 'p1', player2Key: 'p2' }
      },
      matches: [{ matchId: 'm1', round: 1, position: 1, player1: { id: 'p3' }, player2: { id: 'p2' } }],
      queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] }]
    })
    wx.showActionSheet.mockImplementation(({ success }) => success({ tapIndex: 1 }))
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: {} } })

    await expect(ctx.persistScheduleBase()).resolves.toBe(true)

    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'match-results',
      data: expect.objectContaining({
        action: 'applyScheduleImpact',
        tournamentId: 't1',
        mode: 'invalidate_scores',
        matches: ctx.data.matches,
        queues: ctx.data.queues,
      })
    })
    expect(wx.cloud.callFunction).toHaveBeenCalledWith({
      name: 'tournament-brackets',
      data: expect.objectContaining({ action: 'saveInitialMatches' })
    })
  })

  test('keep-time-only schedule edit saves queues without rewriting initial bracket matches', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      scheduleEditMode: true,
      matchResultRows: [{ sourceMatchId: 'm1', resultStatus: 'confirmed' }],
      originalScheduleSnapshot: {
        m1: { courtId: 'c1', queueOrder: 0, player1Key: 'p1:::', player2Key: 'p2:::' }
      },
      matches: [{ matchId: 'm1', round: 1, position: 1, player1: { id: 'p1' }, player2: { id: 'p2' } }],
      queues: [{ courtId: 'c2', items: [{ kind: 'match', matchId: 'm1', order: 2 }] }]
    })
    wx.showActionSheet.mockImplementation(({ success }) => success({ tapIndex: 0 }))
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: {} } })

    await expect(ctx.persistScheduleBase()).resolves.toBe(true)

    const calls = wx.cloud.callFunction.mock.calls.map(([arg]) => arg)
    expect(calls).not.toContainEqual({
      name: 'tournament-brackets',
      data: expect.objectContaining({ action: 'saveInitialMatches' })
    })
    expect(calls).toContainEqual({
      name: 'tournament-brackets',
      data: expect.objectContaining({ action: 'saveSchedule' })
    })
  })

  test('published schedule edit invalidates confirmed rows before publish triggers score-row upsert', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      scheduleEditMode: true,
      matchResultRows: [{ sourceMatchId: 'm1', resultStatus: 'confirmed' }],
      originalScheduleSnapshot: {
        m1: { courtId: 'c1', queueOrder: 0, player1Key: 'p1', player2Key: 'p2' }
      },
      matches: [{ matchId: 'm1', round: 1, position: 1, player1: { id: 'p3' }, player2: { id: 'p2' } }],
      queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] }]
    })
    wx.showActionSheet.mockImplementation(({ success }) => success({ tapIndex: 1 }))
    wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: {} } })

    await expect(ctx.persistPublishedSchedule()).resolves.toBe(true)

    const calls = wx.cloud.callFunction.mock.calls.map(([arg]) => arg)
    const realImpactIndex = calls.findIndex(arg =>
      arg.name === 'match-results' &&
      arg.data.action === 'applyScheduleImpact' &&
      arg.data.dryRun === false
    )
    const publishIndex = calls.findIndex(arg =>
      arg.name === 'tournaments' &&
      arg.data.action === 'publishSchedule'
    )
    expect(realImpactIndex).toBeGreaterThanOrEqual(0)
    expect(publishIndex).toBeGreaterThanOrEqual(0)
    expect(realImpactIndex).toBeLessThan(publishIndex)
  })

  test('published keep-time-only edit blocks result-affecting changes before publish', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      tournamentId: 't1',
      scheduleEditMode: true,
      matchResultRows: [{ sourceMatchId: 'm1', resultStatus: 'confirmed' }],
      originalScheduleSnapshot: {
        m1: { courtId: 'c1', queueOrder: 0, player1Key: 'p1', player2Key: 'p2' }
      },
      matches: [{ matchId: 'm1', round: 1, position: 1, player1: { id: 'p3' }, player2: { id: 'p2' } }],
      queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] }]
    })
    wx.showActionSheet.mockImplementation(({ success }) => success({ tapIndex: 0 }))
    wx.cloud.callFunction.mockImplementation(async ({ name, data }) => {
      if (name === 'match-results' && data.action === 'applyScheduleImpact') {
        return {
          result: {
            success: false,
            error: {
              code: 'SCHEDULE_IMPACT_REQUIRES_INVALIDATION',
              message: '赛程变更影响已确认成绩，请选择清空比分并重新录入'
            }
          }
        }
      }
      return { result: { success: true, data: {} } }
    })

    await expect(ctx.persistPublishedSchedule()).resolves.toBe(false)

    expect(wx.cloud.callFunction).not.toHaveBeenCalledWith({
      name: 'tournaments',
      data: { action: 'publishSchedule', id: 't1' }
    })
    expect(wx.showToast).toHaveBeenCalledWith({
      title: '赛程变更影响已确认成绩，请选择清空比分并重新录入',
      icon: 'none'
    })
  })
})
