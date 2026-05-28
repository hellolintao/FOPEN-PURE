const fs = require('fs')
const path = require('path')

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
  registrations = [],
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
    if (call.name === 'tournament-registrations' && action === 'list') {
      return { result: { success: true, data: registrations } }
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

test('group knockout data starts with safe empty payload shape', () => {
  const def = loadPageDef()
  expect(def.data.groupKnockout).toEqual({
    groups: [],
    groupBrackets: [],
    knockoutBrackets: [],
    standings: {}
  })
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

test('group knockout arrange slots pick registered players and exclude assigned players', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_draft', bracketSize: 12 },
    registrations: [
      { _id: 'reg1', playerId: 'p1', playerName: 'Alpha', registrationStatus: 'confirmed' },
      { _id: 'reg2', playerId: 'p2', playerName: 'Beta', registrationStatus: 'confirmed' },
      { _id: 'reg3', playerId: 'p3', playerName: 'Withdrawn', registrationStatus: 'withdrew' }
    ]
  })

  expect(ctx.data.registrationCandidates.map(p => p._id)).toEqual(['p1', 'p2'])

  ctx.onArrangeSlotTap({ currentTarget: { dataset: { groupIndex: 0, slotIndex: 0 } } })
  expect(ctx.data.arrangePicker.show).toBe(true)
  expect(ctx.data.arrangePicker.members.map(p => p._id)).toEqual(['p1', 'p2'])

  ctx.onArrangePickerSelect({ currentTarget: { dataset: { id: 'p1' } } })
  ctx.onArrangePickerConfirm()
  expect(ctx.data.arrangeGroups[0].slots[0]).toMatchObject({
    playerId: 'p1',
    playerName: 'Alpha',
    registrationId: 'reg1'
  })

  ctx.onArrangeSlotTap({ currentTarget: { dataset: { groupIndex: 0, slotIndex: 1 } } })
  expect(ctx.data.arrangePicker.members.map(p => p._id)).toEqual(['p2'])
})

test('knockout source labels are gated to first round in markup', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('round.round === 1 && match.player1Source')
  expect(wxml).toContain('round.round === 1 && match.player2Source')
})
