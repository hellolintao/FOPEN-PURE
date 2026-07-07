jest.mock('../../../utils/page-cache', () => ({ removeCachesByPrefix: jest.fn() }))

function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    navigateTo: jest.fn(),
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

test('starts with empty snapshot shape for refreshing render safety', () => {
  const def = loadPage()

  expect(def.data.snapshot).toMatchObject({
    pendingConfirm: { total: 0, byTournament: [] },
    myDrafts: [],
    ongoing: [],
    registrationOpen: [],
    pendingSchedule: [],
    scheduleDrafts: [],
    scheduleRevisions: [],
  })
})

test('_loadSnapshot normalizes legacy snapshot data missing new groups', async () => {
  const def = loadPage()
  const { call } = require('../../../utils/cloud')
  call.mockResolvedValue({
    ok: true,
    data: {
      pendingConfirm: { total: 0, byTournament: [] },
      myDrafts: [],
      ongoing: [],
    },
  })
  const ctx = makeCtx(def)

  await ctx._loadSnapshot('refreshing')

  expect(call).toHaveBeenCalledWith('tournaments', { action: 'adminConsoleSnapshot', payload: {} })
  expect(ctx.data.loadState).toBe('loaded')
  expect(ctx.data.snapshot).toMatchObject({
    pendingConfirm: { total: 0, byTournament: [] },
    myDrafts: [],
    ongoing: [],
    registrationOpen: [],
    pendingSchedule: [],
    scheduleDrafts: [],
    scheduleRevisions: [],
  })
})

test('_applyResult clears rank and player-detail caches after successful batchConfirm analytics metadata', () => {
  const def = loadPage()
  const { removeCachesByPrefix } = require('../../../utils/page-cache')
  removeCachesByPrefix.mockClear()
  const ctx = makeCtx(def, {
    sheet: { ...def.data.sheet, requestId: 'req_confirm', result: null },
  })

  ctx._applyResult({
    ok: true,
    data: {
      requestId: 'req_confirm',
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

test('onSheetRetry clears rank and player-detail caches after per-row batchConfirm analytics success', async () => {
  const def = loadPage()
  const { call } = require('../../../utils/cloud')
  const { removeCachesByPrefix } = require('../../../utils/page-cache')
  removeCachesByPrefix.mockClear()
  call.mockResolvedValueOnce({
    ok: true,
    data: {
      items: [{
        matchId: 'm1',
        tournamentId: 't1',
        updateTime: '2026-05-16T09:10:00.000Z',
      }],
    },
  })
  call.mockResolvedValueOnce({
    ok: true,
    data: {
      requestId: 'req_confirm',
      successIds: ['m1'],
      failures: [],
      analyticsStatus: 'success',
      analyticsMessage: '排行榜已更新',
      settlementImpact: [{ memberId: 'A', trendLabel: '▲1', pointsDelta: 20 }],
    },
  })
  const ctx = makeCtx(def, {
    sheet: {
      ...def.data.sheet,
      requestId: 'req_confirm',
      tournamentIdScope: 't1',
      items: [{ matchId: 'm1', tournamentId: 't1', updateTime: '2026-05-16T09:00:00.000Z' }],
      result: {
        requestId: 'req_confirm',
        successIds: [],
        failures: [{ matchId: 'm1', code: 'DB_CONFLICT', retryable: true }],
      },
    },
  })

  await ctx.onSheetRetry({ detail: { failureIds: ['m1'] } })

  expect(removeCachesByPrefix).toHaveBeenCalledWith('rank:')
  expect(removeCachesByPrefix).toHaveBeenCalledWith('player-detail:')
  expect(ctx.data.sheet.result.analyticsMessage).toBe('排行榜已更新')
})
