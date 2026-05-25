function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    navigateTo: jest.fn(),
    showModal: jest.fn(),
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
      Object.assign(this.data, patch)
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
