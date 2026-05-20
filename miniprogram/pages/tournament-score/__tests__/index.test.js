function loadPage() {
  jest.resetModules()
  let pageDef
  global.getApp = () => ({
    globalData: {
      isAdmin: true,
      currentMember: { _id: 'admin1', admin: true },
    },
  })
  global.wx = {
    cloud: { callFunction: jest.fn() },
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
