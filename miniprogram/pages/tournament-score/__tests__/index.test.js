jest.mock('../../../utils/page-cache', () => ({ removeCachesByPrefix: jest.fn() }))

function loadPage({ app: appOverride = {}, tournament = null, matchResults = [] } = {}) {
  jest.resetModules()
  let pageDef
  global.getApp = () => ({
    globalData: {
      isAdmin: true,
      currentMember: { _id: 'admin1', admin: true },
      ...((appOverride && appOverride.globalData) || {}),
    },
    ...appOverride,
  })
  global.wx = {
    cloud: {
      callFunction: jest.fn(async ({ name, data }) => {
        if (name === 'tournaments' && data && data.action === 'get') {
          return { result: { data: { tournament } } }
        }
        if (name === 'match-results' && data && data.action === 'listByTournament') {
          return { result: { success: true, data: { results: matchResults } } }
        }
        return { result: { success: true, data: {} } }
      }),
    },
    createSelectorQuery: jest.fn(() => ({ select: () => ({ boundingClientRect: () => ({ exec: jest.fn() }) }) })),
    pageScrollTo: jest.fn(),
    showModal: jest.fn(),
    showToast: jest.fn(),
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
      for (const [key, value] of Object.entries(patch)) {
        if (!key.includes('.')) {
          this.data[key] = value
          continue
        }
        const parts = key.split('.')
        let target = this.data
        for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]]
        target[parts[parts.length - 1]] = value
      }
    },
  }
}

const matchA = {
  _id: 'result_t1_m1',
  sourceMatchId: 'm1',
  tournamentId: 't1',
  round: 1,
  position: 1,
  player1: { id: 'p1', name: 'A' },
  player2: { id: 'p2', name: 'B' },
  resultStatus: 'pending',
}

const matchB = {
  _id: 'result_t1_m2',
  sourceMatchId: 'm2',
  tournamentId: 't1',
  round: 1,
  position: 2,
  player1: { id: 'p3', name: 'C' },
  player2: { id: 'p4', name: 'D' },
  resultStatus: 'pending',
}

test('admin bottom button is enabled when any valid score draft exists', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    isAdmin: true,
    tournament: { _id: 't1', name: '周赛', format: 'regular' },
    rowsByRound: [{ round: 1, matches: [matchA, matchB] }],
    draftMap: {
      m1: {
        matchId: 'm1',
        canEdit: true,
        filled: true,
        dirty: true,
        isConfirmed: false,
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
      },
    },
  })

  expect(ctx.computeBottomState()).toMatchObject({
    bottomLabel: '确认和保存比赛',
    bottomCount: 1,
    bottomDisabled: false,
  })
})

test('admin confirmation sheet uses local score drafts instead of loading submitted queue', async () => {
  const def = loadPage()
  const { call } = require('../../../utils/cloud')
  const ctx = makeCtx(def, {
    isAdmin: true,
    tournamentId: 't1',
    tournament: { _id: 't1', name: '周赛', format: 'regular' },
    rowsByRound: [{ round: 1, matches: [matchA] }],
    draftMap: {
      m1: {
        matchId: 'm1',
        canEdit: true,
        filled: true,
        dirty: true,
        isConfirmed: false,
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
      },
    },
  })

  await ctx.onAdminBatchSheet()

  expect(call).not.toHaveBeenCalledWith('match-results', expect.objectContaining({ action: 'pendingReviewItems' }))
  expect(ctx.data.sheet).toMatchObject({
    visible: true,
    title: '确认和保存比赛',
    mode: 'adminSave',
    items: [{
      matchId: 'result_t1_m1',
      sourceMatchId: 'm1',
      score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
    }],
  })
})

test('member bottom button opens submit sheet with dirty local drafts', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    isAdmin: false,
    tournamentId: 't1',
    tournament: { _id: 't1', name: '周赛', format: 'regular' },
    rowsByRound: [{ round: 1, matches: [matchA] }],
    draftMap: {
      m1: {
        matchId: 'm1',
        canEdit: true,
        filled: true,
        dirty: true,
        isConfirmed: false,
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
      },
    },
  })

  ctx.onPlayerBatchSheet()

  expect(ctx.data.sheet).toMatchObject({
    visible: true,
    title: '提交比分',
    mode: 'submit',
    items: [{ matchId: 'result_t1_m1', sourceMatchId: 'm1' }],
  })
})

test('confirmed match with void marker is excluded from scoreable totals', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {})
  const voided = {
    ...matchA,
    resultStatus: 'confirmed',
    status: 'completed',
    score: null,
    winner: null,
    winnerId: null,
    pointsAwarded: { source: 'match', entries: [] },
  }

  expect(ctx.isNoScoreMatch(voided)).toBe(true)
  expect(ctx.isPlayableMatch(voided)).toBe(false)
})

test('group knockout score rows group by group then knockout round', async () => {
  const pageDef = loadPage({
    tournament: { _id: 't1', format: 'group_knockout', type: 'singles', groupKnockoutPhase: 'group_published' },
    matchResults: [
      { _id: 'g1', sourceMatchId: 'g1', stage: 'group', matchKind: 'group', groupCode: 'A', round: 1, position: 1, resultStatus: 'pending', player1: { id: 'a1' }, player2: { id: 'a2' } },
      { _id: 'qf1', sourceMatchId: 'qf1', stage: 'knockout', matchKind: 'bracket', round: 1, position: 1, resultStatus: 'pending', player1: { id: 'a1' }, player2: { id: 'c2' } },
    ],
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.rowsByRound.map(row => row.label)).toEqual(['A组', '8强'])
})

test('group knockout legacy rows without stage or group stay visible under fallback group', async () => {
  const legacyRow = {
    _id: 'legacy1',
    sourceMatchId: 'legacy1',
    round: 4,
    position: 1,
    resultStatus: 'pending',
    player1: { id: 'a1' },
    player2: { id: 'a2' },
  }
  const pageDef = loadPage({
    tournament: { _id: 't1', format: 'group_knockout', type: 'singles', groupKnockoutPhase: 'group_published' },
    matchResults: [legacyRow],
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.rowsByRound).toMatchObject([
    { round: 'other', label: '其他', matches: [{ _id: 'legacy1' }] },
  ])
  expect(ctx.data.totalCount).toBe(1)
  expect(ctx.getAllMatches().map(row => row._id)).toEqual(['legacy1'])
  expect(ctx.getAllMatches()).toHaveLength(ctx.data.totalCount)
})

test('syncIdentity does not refresh identity while browsing public score results', async () => {
  const app = {
    globalData: { currentMember: null, isAdmin: false },
    refreshIdentity: jest.fn().mockResolvedValue(null),
  }
  const pageDef = loadPage({ app })
  const ctx = makeCtx(pageDef)

  await ctx.syncIdentity()

  expect(app.refreshIdentity).not.toHaveBeenCalled()
  expect(ctx.data.currentMemberId).toBe('')
})

test('group knockout legacy fallback row can still be anchored', async () => {
  const pageDef = loadPage({
    tournament: { _id: 't1', format: 'group_knockout', type: 'singles', groupKnockoutPhase: 'group_published' },
    matchResults: [{
      _id: 'legacy_result_1',
      sourceMatchId: 'legacy_match_1',
      round: 4,
      position: 1,
      resultStatus: 'pending',
      player1: { id: 'a1' },
      player2: { id: 'a2' },
    }],
  })
  const ctx = makeCtx(pageDef)
  ctx.onLoad({ tournamentId: 't1', resultId: 'legacy_result_1' })

  await ctx.refresh()

  expect(ctx.data.rowsByRound[0].label).toBe('其他')
  expect(ctx.getAnchorRowId()).toBe('legacy_match_1')
})

test('void match calls cloud action and refreshes rows', async () => {
  const def = loadPage()
  wx.cloud.callFunction.mockResolvedValueOnce({ result: { success: true, data: { ok: true } } })
  const ctx = makeCtx(def, {})
  ctx.refresh = jest.fn()

  await ctx.onVoidMatch({ detail: { matchId: 'm1' } })

  expect(wx.cloud.callFunction).toHaveBeenCalledWith({
    name: 'match-results',
    data: { action: 'voidMatch', matchId: 'm1', reason: '未完赛' },
  })
  expect(ctx.refresh).toHaveBeenCalled()
})

test('void match shows deployment hint when cloud action is missing', async () => {
  const def = loadPage()
  wx.cloud.callFunction.mockResolvedValueOnce({ result: { errMsg: 'invalid action' } })
  const ctx = makeCtx(def, {})
  ctx.refresh = jest.fn()

  await ctx.onVoidMatch({ detail: { matchId: 'result_t1_m1' } })

  expect(wx.showToast).toHaveBeenCalledWith({
    title: '云函数未更新，请部署 match-results',
    icon: 'none',
  })
  expect(ctx.refresh).not.toHaveBeenCalled()
})

test('sheet close hides sheet and refreshes rows', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    sheet: { visible: true, title: '', mode: 'submit', items: [], result: null, requestId: 'req' },
  })
  ctx.refresh = jest.fn()

  ctx.onSheetClose()

  expect(ctx.data.sheet.visible).toBe(false)
  expect(ctx.refresh).toHaveBeenCalled()
})

test('anchor row id resolves result id to source match id', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    anchorMatchId: 'result_t1_m1',
    rowsByRound: [{ round: 1, matches: [matchA] }],
  })

  expect(ctx.getAnchorRowId()).toBe('m1')
})

test('resultId option anchors score page to the matching row', () => {
  const def = loadPage()
  const ctx = makeCtx(def)

  ctx.onLoad({ tournamentId: 't1', resultId: 'result_t1_m1' })

  expect(ctx.data.anchorMatchId).toBe('result_t1_m1')
  expect(ctx.getAnchorRowId([{ round: 1, matches: [matchA] }])).toBe('m1')
})

test.each([
  ['resultId', { resultId: 'result_t1_m1' }],
  ['matchId', { matchId: 'm1' }],
])('%s option marks target row after refresh', async (_label, anchor) => {
  const pageDef = loadPage({
    tournament: { _id: 't1', scheduleStatus: 'published' },
    matchResults: [matchA, matchB],
  })
  const ctx = makeCtx(pageDef)
  ctx.onLoad({ tournamentId: 't1', ...anchor })

  await ctx.refresh()

  expect(ctx.data.rowsByRound[0].matches.map(row => ({ id: row._id, isTarget: row.isTarget }))).toEqual([
    { id: 'result_t1_m1', isTarget: true },
    { id: 'result_t1_m2', isTarget: false },
  ])
})

test.each([
  ['resultId', { resultId: 'result_t1_m1' }],
  ['matchId', { matchId: 'm1' }],
])('%s option gives target row a scrollable id when sourceMatchId is missing', async (_label, anchor) => {
  const noSourceMatch = {
    ...matchA,
    sourceMatchId: undefined,
    matchId: 'm1',
  }
  const pageDef = loadPage({
    tournament: { _id: 't1', scheduleStatus: 'published' },
    matchResults: [noSourceMatch],
  })
  const ctx = makeCtx(pageDef)
  ctx.onLoad({ tournamentId: 't1', ...anchor })

  await ctx.refresh()

  expect(ctx.data.rowsByRound[0].matches[0]).toMatchObject({
    _id: 'result_t1_m1',
    matchId: 'm1',
    rowAnchorId: 'm1',
    isTarget: true,
  })
  expect(ctx.getAnchorRowId()).toBe('m1')
})

test.each(['draft', 'none'])('%s schedule blocks score page with clear message', async (scheduleStatus) => {
  const pageDef = loadPage({
    tournament: { _id: 't1', scheduleStatus, name: '5月周末赛' },
    matchResults: [matchA],
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.rowsByRound).toEqual([])
  expect(ctx.data.empty).toBe(true)
  expect(ctx.data.error).toBe('赛程发布后才能录入成绩')
})

test('group knockout published group phase allows scoring before schedule is published', async () => {
  const pageDef = loadPage({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      scheduleStatus: 'none',
      groupKnockoutPhase: 'group_published',
    },
    matchResults: [matchA],
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.scheduleGateBlocked).toBe(false)
  expect(ctx.data.rowsByRound[0].matches).toHaveLength(1)
  expect(ctx.data.totalCount).toBe(1)
  expect(ctx.data.error).toBe('')
})

test('group knockout draft phase remains blocked even when match rows exist', async () => {
  const pageDef = loadPage({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      scheduleStatus: 'none',
      groupKnockoutPhase: 'group_draft',
    },
    matchResults: [matchA],
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.scheduleGateBlocked).toBe(true)
  expect(ctx.data.rowsByRound).toEqual([])
  expect(ctx.data.error).toBe('赛程发布后才能录入成绩')
})

test.each([
  ['draft with stale published phase', { status: 'draft', groupKnockoutPhase: 'group_published' }],
  ['cancelled with published phase', { status: 'cancelled', groupKnockoutPhase: 'group_published' }],
  ['completed without phase', { status: 'completed' }],
  ['settled with invalid phase', { status: 'settled', groupKnockoutPhase: 'unknown_phase' }]
])('group knockout %s remains score-write blocked', async (_label, fields) => {
  const pageDef = loadPage({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      scheduleStatus: 'none',
      ...fields
    },
    matchResults: [matchA]
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.scheduleGateBlocked).toBe(true)
  expect(ctx.data.rowsByRound).toEqual([])
  expect(ctx.data.error).toBe('赛程发布后才能录入成绩')
})

test.each([
  ['trimmed published phase', { status: 'upcoming', groupKnockoutPhase: ' group_published ' }],
  ['settled resettlement phase', { status: 'settled', groupKnockoutPhase: 'knockout_published' }]
])('group knockout %s allows the score page', async (_label, fields) => {
  const pageDef = loadPage({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      scheduleStatus: 'none',
      ...fields
    },
    matchResults: [matchA]
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.scheduleGateBlocked).toBe(false)
  expect(ctx.data.rowsByRound[0].matches).toHaveLength(1)
})

test('admin adjust mode can edit confirmed rows', async () => {
  const pageDef = loadPage({
    app: { globalData: { isAdmin: true, currentMember: { _id: 'admin1' } } },
    tournament: { _id: 't1', scheduleStatus: 'published' },
    matchResults: [{
      ...matchA,
      _id: 'r1',
      sourceMatchId: 'm1',
      resultStatus: 'confirmed',
      player1: { id: 'a', name: 'A' },
      player2: { id: 'b', name: 'B' },
    }],
  })
  const ctx = makeCtx(pageDef)
  ctx.onLoad({ tournamentId: 't1', mode: 'adjust' })

  await ctx.refresh()

  expect(ctx.data.mode).toBe('adjust')
  expect(ctx.data.adjustMode).toBe(true)
  expect(ctx.data.rowsByRound[0].matches[0].canAdminAdjust).toBe(true)
})

test('_applySheetResult clears rank and player-detail caches after admin analytics success', () => {
  const def = loadPage()
  const { removeCachesByPrefix } = require('../../../utils/page-cache')
  removeCachesByPrefix.mockClear()
  const ctx = makeCtx(def, {
    sheet: { visible: true, title: '', mode: 'adminSave', items: [{ matchId: 'm1' }], result: null, requestId: 'req' },
  })

  ctx._applySheetResult({
    ok: true,
    data: {
      requestId: 'req',
      successIds: ['m1'],
      failures: [],
      analyticsStatus: 'success',
      analyticsMessage: '排行榜已更新',
      settlementImpact: [{ memberId: 'A', trendLabel: '▲1', pointsDelta: 20 }],
    },
  }, [{ matchId: 'm1' }])

  expect(removeCachesByPrefix).toHaveBeenCalledWith('rank:')
  expect(removeCachesByPrefix).toHaveBeenCalledWith('player-detail:')
  expect(ctx.data.sheet.result.analyticsMessage).toBe('排行榜已更新')
})

test('onReconfirm clears rank and player-detail caches after direct analytics success', async () => {
  const def = loadPage()
  const { removeCachesByPrefix } = require('../../../utils/page-cache')
  removeCachesByPrefix.mockClear()
  wx.cloud.callFunction.mockResolvedValue({
    result: {
      success: true,
      data: {
        ok: true,
        analyticsStatus: 'success',
        analyticsMessage: '排行榜已更新',
        settlementImpact: [{ memberId: 'A', trendLabel: '▲1', pointsDelta: 20 }],
      },
    },
  })
  const ctx = makeCtx(def)
  ctx.refresh = jest.fn(async () => null)

  await ctx.onReconfirm({ detail: { matchId: 'm1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null } } })

  expect(removeCachesByPrefix).toHaveBeenCalledWith('rank:')
  expect(removeCachesByPrefix).toHaveBeenCalledWith('player-detail:')
})
