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
  matchResults = [],
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
    if (call.name === 'match-results' && action === 'listByTournament') {
      return { result: { success: true, data: { results: matchResults } } }
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

test('group knockout published bracket page shows bottom score entry', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_published', bracketSize: 12 }
  })

  expect(ctx.data.showGroupScoreEntry).toBe(true)
  expect(ctx.data.groupScoreActionLabel).toBe('录入小组赛赛果')

  ctx.onEnterScore()
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1' })
})

test('group knockout bracket page merges score results into group matches', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_published', bracketSize: 12 },
    groupKnockoutBracket: {
      groups: [],
      standings: {},
      groupBrackets: [{
        _id: 'bracket_A',
        groupCode: 'A',
        stage: 'group',
        matches: [{
          matchId: 'match_A_1_2',
          player1: { id: 'p1', name: 'Ella' },
          player2: { id: 'p2', name: '老板' },
          resultStatus: 'pending'
        }]
      }],
      knockoutBrackets: []
    },
    matchResults: [{
      _id: 'result_A_1_2',
      sourceMatchId: 'match_A_1_2',
      resultStatus: 'confirmed',
      score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
      winner: { id: 'p1', name: 'Ella' }
    }]
  })

  expect(ctx.data.groupKnockout.groupBrackets[0].matches[0]).toMatchObject({
    resultStatus: 'confirmed',
    score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
    __scoreLabel: '4:2',
    __statusLabel: '已确认',
    __player1Winner: true,
    __player2Winner: false
  })
})

test('group knockout bracket page decorates knockout tree with score results', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'knockout_published', bracketSize: 12 },
    groupKnockoutBracket: {
      groups: [],
      standings: {},
      groupBrackets: [],
      knockoutBrackets: [{
        _id: 'ko1',
        round: 1,
        stage: 'knockout',
        matches: [{
          matchId: 'qf1',
          round: 1,
          position: 1,
          player1Source: 'A1',
          player2Source: 'C2',
          player1: { id: 'p1', name: 'Ella' },
          player2: { id: 'p8', name: '林大' },
          resultStatus: 'pending'
        }]
      }]
    },
    matchResults: [{
      _id: 'result_qf1',
      sourceMatchId: 'qf1',
      resultStatus: 'confirmed',
      score: { sets: [{ a: 3, b: 3 }], tiebreak: '7-5' },
      winner: { id: 'p8', name: '林大' }
    }]
  })

  expect(ctx.data.groupKnockout.knockoutBrackets[0].matches[0]).toMatchObject({
    __scoreLabel: '3:3 (7-5)',
    __player1Winner: false,
    __player2Winner: true
  })
})

test('group knockout match node opens score page anchored to that match', () => {
  const def = loadPageDef()
  const ctx = makeCtx(def, { tournamentId: 't1' })

  ctx.onMatchScoreTap({ currentTarget: { dataset: { matchId: 'match_A_1_2' } } })

  expect(wx.navigateTo).toHaveBeenCalledWith({
    url: '/pages/tournament-score/index?tournamentId=t1&matchId=match_A_1_2'
  })
})

test('group knockout draft bracket page does not show bottom score entry', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_draft', bracketSize: 12 }
  })

  expect(ctx.data.showGroupScoreEntry).toBe(false)
})

test('raw draft overrides a stale published group phase on the bracket page', async () => {
  const ctx = await loadPage({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      status: 'draft',
      groupKnockoutPhase: 'group_published',
      bracketSize: 12
    }
  })

  expect(ctx.data.effectiveGroupKnockoutPhase).toBe('group_draft')
  expect(ctx.data.groupKnockoutReadOnly).toBe(false)
  expect(ctx.data.showGroupScoreEntry).toBe(false)
})

test('cancelled group draft bracket is history-only and cannot generate matches', async () => {
  const calls = []
  const ctx = await loadPage({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      status: 'cancelled',
      groupKnockoutPhase: 'group_draft',
      bracketSize: 12
    },
    cloudCalls: calls
  })

  expect(ctx.data.effectiveGroupKnockoutPhase).toBe('group_draft')
  expect(ctx.data.groupKnockoutReadOnly).toBe(true)
  expect(ctx.data.showGroupScoreEntry).toBe(false)

  await ctx.onGenerateGroupMatches()

  expect(calls).toEqual([])
  expect(wx.showToast).toHaveBeenCalledWith({ title: '赛事已取消，仅可查看历史', icon: 'none' })
})

test('cancelled published bracket cannot navigate to score entry', async () => {
  const ctx = await loadPage({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      status: 'cancelled',
      groupKnockoutPhase: 'group_published',
      bracketSize: 12
    }
  })

  expect(ctx.data.showGroupScoreEntry).toBe(false)
  ctx.onMatchScoreTap({ currentTarget: { dataset: { matchId: 'match_A_1_2' } } })

  expect(wx.navigateTo).not.toHaveBeenCalled()
  expect(wx.showToast).toHaveBeenCalledWith({ title: '赛事已取消，仅可查看历史', icon: 'none' })
})

test('group arrangement markup uses the resolved phase and hides editors for read-only history', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '..', 'index.wxml'), 'utf8')

  expect(wxml).toContain("effectiveGroupKnockoutPhase === 'group_draft' && !groupKnockoutReadOnly")
  expect(wxml).not.toContain("tournament.groupKnockoutPhase === 'group_draft'")
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

test('group knockout arrange group picker selects a full group at once', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_draft', bracketSize: 12 },
    registrations: [
      { _id: 'reg1', playerId: 'p1', playerName: 'Alpha', registrationStatus: 'confirmed' },
      { _id: 'reg2', playerId: 'p2', playerName: 'Beta', registrationStatus: 'confirmed' },
      { _id: 'reg3', playerId: 'p3', playerName: 'Gamma', registrationStatus: 'confirmed' },
      { _id: 'reg4', playerId: 'p4', playerName: 'Delta', registrationStatus: 'confirmed' }
    ]
  })

  ctx.onArrangeGroupTap({ currentTarget: { dataset: { groupIndex: 0 } } })
  expect(ctx.data.arrangePicker).toMatchObject({
    show: true,
    title: 'A组 选择3位球员',
    maxSelect: 3,
    selectedIds: []
  })

  ctx.onArrangePickerSelect({ currentTarget: { dataset: { id: 'p1' } } })
  ctx.onArrangePickerSelect({ currentTarget: { dataset: { id: 'p2' } } })
  ctx.onArrangePickerSelect({ currentTarget: { dataset: { id: 'p3' } } })
  ctx.onArrangePickerSelect({ currentTarget: { dataset: { id: 'p4' } } })
  expect(ctx.data.arrangePicker.selectedIds).toEqual(['p1', 'p2', 'p3'])
  expect(wx.showToast).toHaveBeenCalledWith({ title: '本组最多 3 位', icon: 'none' })

  ctx.onArrangePickerConfirm()
  expect(ctx.data.arrangeGroups[0].slots).toEqual([
    { slotNo: 1, playerId: 'p1', playerName: 'Alpha', registrationId: 'reg1' },
    { slotNo: 2, playerId: 'p2', playerName: 'Beta', registrationId: 'reg2' },
    { slotNo: 3, playerId: 'p3', playerName: 'Gamma', registrationId: 'reg3' }
  ])

  ctx.onArrangeGroupTap({ currentTarget: { dataset: { groupIndex: 1 } } })
  expect(ctx.data.arrangePicker.members.map(p => p._id)).toEqual(['p4'])
})

test('knockout source labels are gated to first round in markup', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('round.round === 1 && match.player1Source')
  expect(wxml).toContain('round.round === 1 && match.player2Source')
})

test('knockout tab renders bracket tree instead of schedule-style rows', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('class="ko-tree-scroll"')
  expect(wxml).toContain('class="ko-match-card')
  expect(wxml).toContain('{{match.__scoreLabel ||')
})

test('knockout tab describes the current quarterfinal source pairings', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('A1-B2 · B1-A2 · C1-D2 · D1-C2')
  expect(wxml).not.toContain('A1-C2 · B1-D2 · C1-A2 · D1-B2')
})

test('winner names render as lime tags in group and knockout brackets', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../index.wxss'), 'utf8')

  expect(wxml).toContain('gk-player {{match.__player1Winner ?')
  expect(wxml).toContain('ko-side {{match.__player1Winner ?')
  expect(wxss).toMatch(/\.gk-player\.winner\s*\{[^}]*background:\s*var\(--color-lime\)/)
  expect(wxss).toMatch(/\.ko-side\.winner \.ko-player\s*\{[^}]*background:\s*var\(--color-lime\)/)
})

test('group knockout bracket page decorates semantic round labels and progress', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'knockout_published', bracketSize: 12 },
    groupKnockoutBracket: {
      groups: [],
      standings: {},
      groupBrackets: [{
        _id: 'bracket_A',
        groupCode: 'A',
        stage: 'group',
        matches: [
          { matchId: 'g1', player1: { id: 'a1' }, player2: { id: 'a2' }, resultStatus: 'pending' },
          { matchId: 'g2', player1: { id: 'a1' }, player2: { id: 'a3' }, resultStatus: 'pending' }
        ]
      }],
      knockoutBrackets: [{
        _id: 'ko1',
        round: 1,
        stage: 'knockout',
        matches: [
          { matchId: 'qf1', round: 1, position: 1, player1: { id: 'a1' }, player2: { id: 'c2' }, resultStatus: 'pending' },
          { matchId: 'qf2', round: 1, position: 2, player1: { id: 'b1' }, player2: { id: 'd2' }, resultStatus: 'pending' }
        ]
      }, {
        _id: 'ko2',
        round: 2,
        stage: 'knockout',
        matches: [{ matchId: 'sf1', round: 2, position: 1, player1: null, player2: null, resultStatus: 'pending' }]
      }, {
        _id: 'ko3',
        round: 3,
        stage: 'knockout',
        matches: [{ matchId: 'final', round: 3, position: 1, player1: null, player2: null, resultStatus: 'pending' }]
      }]
    },
    matchResults: [
      { _id: 'result_g1', sourceMatchId: 'g1', resultStatus: 'confirmed', score: { sets: [{ a: 4, b: 2 }] } },
      { _id: 'result_qf1', sourceMatchId: 'qf1', resultStatus: 'confirmed', score: { sets: [{ a: 4, b: 1 }] } }
    ]
  })

  expect(ctx.data.groupKnockout.groupBrackets[0]).toMatchObject({
    __title: 'A组',
    __kicker: 'GROUP A',
    __scoreProgressText: '1/2 已确认'
  })
  expect(ctx.data.groupKnockout.knockoutBrackets.map(round => round.__roundLabel)).toEqual(['8强', '半决赛', '决赛'])
  expect(ctx.data.groupKnockout.knockoutBrackets[0].__scoreProgressText).toBe('1/2 已确认')
})
