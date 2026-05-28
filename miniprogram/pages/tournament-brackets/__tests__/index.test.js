function loadPageDef() {
  jest.resetModules()
  let pageDef
  global.wx = {
    navigateTo: jest.fn(),
    showToast: jest.fn(),
    cloud: { callFunction: jest.fn() },
  }
  global.Page = (def) => { pageDef = def }
  require('../index')
  return pageDef
}

async function loadPage({
  tournament = { _id: 't1', format: 'knockout', scheduleStatus: 'published' },
  groupKnockoutBracket = { groups: [], groupBrackets: [], knockoutBrackets: [], standings: {} },
  cloudCalls = [],
  mode,
} = {}) {
  const def = loadPageDef()
  const ctx = makeCtx(def)
  wx.cloud.callFunction.mockImplementation(async (call) => {
    const action = call.data && call.data.action
    if (action === 'saveGroups' || action === 'generateGroupMatches') {
      cloudCalls.push(call)
    }
    if (call.name === 'tournaments' && action === 'get') {
      return { result: { success: true, data: tournament } }
    }
    if (call.name === 'tournament-brackets' && action === 'getGroupKnockoutBracket') {
      return { result: { success: true, data: groupKnockoutBracket } }
    }
    return { result: { success: true, data: [] } }
  })
  await ctx.onLoad({ id: tournament._id || 't1', mode })
  return ctx
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

function completeArrangeGroups12() {
  return ['A', 'B', 'C', 'D'].map(groupCode => ({
    groupCode,
    slots: [1, 2, 3].map(slotNo => ({
      slotNo,
      playerId: `${groupCode}${slotNo}`,
      playerName: `${groupCode}${slotNo}`,
    })),
  }))
}

test('edit schedule opens tournament edit in schedule-impact mode', () => {
  const def = loadPageDef()
  const ctx = makeCtx(def, { tournamentId: 't1' })

  ctx.onEditSchedule()

  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: '/pages/tournament-edit/index?id=t1&step=3&mode=edit-schedule',
  })
})

test('group knockout bracket page has only group and knockout tabs', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_draft', bracketSize: 16 },
    groupKnockoutBracket: { groups: [], groupBrackets: [], knockoutBrackets: [], standings: {} }
  })
  expect(ctx.data.tabs.map(t => t.key)).toEqual(['group', 'knockout'])
})

test('arrange mode saves groups then generates group matches', async () => {
  const calls = []
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_draft', bracketSize: 12 },
    cloudCalls: calls
  })
  ctx.setData({ arrangeGroups: completeArrangeGroups12() })
  await ctx.onGenerateGroupMatches()
  expect(calls.map(call => call.data.action)).toEqual(['saveGroups', 'generateGroupMatches'])
})
