const {
  GROUP_CODES,
  GROUP_KNOCKOUT_PHASES,
  defaultGroupKnockoutPoints,
  validateGroupAssignments,
  generateGroupMatches,
  generateKnockoutMatches,
  knockoutBracketDocId,
  groupBracketDocId,
  calculateGroupStandings
} = require('../group-knockout')

const players = ids => ids.map(id => ({ playerId: id, playerName: id.toUpperCase(), registrationId: `reg_${id}` }))

function groups16() {
  const ids = players(['a1','a2','a3','a4','b1','b2','b3','b4','c1','c2','c3','c4','d1','d2','d3','d4'])
  return GROUP_CODES.map((code, groupIndex) => ({
    groupCode: code,
    slots: [1, 2, 3, 4].map((slotNo, i) => ({ slotNo, ...ids[groupIndex * 4 + i] }))
  }))
}

function groups12() {
  const ids = players(['a1','a2','a3','b1','b2','b3','c1','c2','c3','d1','d2','d3'])
  return GROUP_CODES.map((code, groupIndex) => ({
    groupCode: code,
    slots: [1, 2, 3].map((slotNo, i) => ({ slotNo, ...ids[groupIndex * 3 + i] }))
  }))
}

describe('group knockout rules', () => {
  test('exposes supported phases and default points', () => {
    expect(GROUP_KNOCKOUT_PHASES).toContain('group_draft')
    expect(defaultGroupKnockoutPoints(12).placement.champion).toBe(250)
    expect(defaultGroupKnockoutPoints(16).group.win).toBe(50)
  })

  test('validates complete 16 draw groups', () => {
    expect(validateGroupAssignments({ bracketSize: 16, groups: groups16() })).toEqual([])
  })

  test('rejects missing slots and duplicate players', () => {
    const groups = groups16()
    groups[2].slots = groups[2].slots.slice(0, 3)
    groups[3].slots[0] = { ...groups[3].slots[0], playerId: 'a1' }
    expect(validateGroupAssignments({ bracketSize: 16, groups })).toEqual([
      'C组必须有 4 位选手',
      '选手 a1 重复出现在多个小组'
    ])
  })

  test('rejects duplicate group codes and unknown group codes', () => {
    const groups = groups16()
    groups[3] = { ...groups[3], groupCode: 'A' }
    groups.push({
      groupCode: 'E',
      slots: [1, 2, 3, 4].map((slotNo, i) => ({ slotNo, ...players(['e1','e2','e3','e4'])[i] }))
    })
    expect(validateGroupAssignments({ bracketSize: 16, groups })).toEqual(expect.arrayContaining([
      'A组重复出现',
      'E组不是支持的小组'
    ]))
  })

  test('generates 16-sign group matches in fixed slot order', () => {
    const matches = generateGroupMatches({ tournamentId: 'tournament_1', bracketSize: 16, groups: groups16(), now: 1700000000000 })
    expect(matches).toHaveLength(24)
    expect(matches.filter(m => m.groupCode === 'A').map(m => [m.groupSlot1, m.groupSlot2])).toEqual([
      [1, 4], [2, 3], [1, 3], [2, 4], [1, 2], [3, 4]
    ])
    expect(matches[0]).toMatchObject({
      matchId: 'gk_1_gA_p1_1700000000000',
      matchKind: 'group',
      stage: 'group',
      groupCode: 'A',
      round: 1,
      position: 1,
      type: 'singles'
    })
  })

  test('generates 12-sign group matches in fixed slot order', () => {
    const matches = generateGroupMatches({ tournamentId: 'tournament_12', bracketSize: 12, groups: groups12(), now: 1700000000000 })
    expect(matches).toHaveLength(12)
    expect(matches.filter(m => m.groupCode === 'A').map(m => [m.groupSlot1, m.groupSlot2])).toEqual([
      [1, 2], [1, 3], [2, 3]
    ])
    expect(matches.map(m => m.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(matches.every(m => m.status === 'pending')).toBe(true)
  })

  test('builds fixed knockout bracket from frozen seeds', () => {
    const seeds = {
      A1: { id: 'a1', name: 'A1' },
      A2: { id: 'a2', name: 'A2' },
      B1: { id: 'b1', name: 'B1' },
      B2: { id: 'b2', name: 'B2' },
      C1: { id: 'c1', name: 'C1' },
      C2: { id: 'c2', name: 'C2' },
      D1: { id: 'd1', name: 'D1' },
      D2: { id: 'd2', name: 'D2' }
    }
    const brackets = generateKnockoutMatches({ tournamentId: 'tournament_1', seeds, now: 1700000000000 })
    expect(brackets).toHaveLength(3)
    expect(brackets[0]).toMatchObject({
      _id: 'bracket_1_knockout_round_1',
      bracketId: 'bracket_1_knockout_round_1',
      tournamentId: 'tournament_1',
      format: 'group_knockout',
      type: 'singles',
      stage: 'knockout',
      round: 1
    })
    expect(brackets[0].matches[0]).toMatchObject({
      matchKind: 'bracket',
      stage: 'knockout',
      player1: { id: 'a1', name: 'A1' },
      player2: { id: 'b2', name: 'B2' }
    })
    expect(brackets[0].matches.map(m => [m.player1Source, m.player2Source])).toEqual([
      ['A1', 'B2'], ['B1', 'A2'], ['C1', 'D2'], ['D1', 'C2']
    ])
    expect(brackets[1].matches[0]).toMatchObject({
      matchKind: 'bracket',
      stage: 'knockout',
      player1: null,
      player2: null
    })
    expect(brackets[1].matches[0].player1Source).toBeUndefined()
    expect(groupBracketDocId('tournament_1', 'A')).toBe('bracket_1_group_A')
    expect(knockoutBracketDocId('tournament_1', 2)).toBe('bracket_1_knockout_round_2')
  })

  test('uses null players for missing knockout seeds', () => {
    const brackets = generateKnockoutMatches({
      tournamentId: 'tournament_1',
      seeds: { A1: { id: 'a1', name: 'A1' } },
      now: 1700000000000
    })
    expect(brackets[0].matches[0]).toMatchObject({
      player1Source: 'A1',
      player2Source: 'B2',
      player1: { id: 'a1', name: 'A1' },
      player2: null
    })
  })
})

function row(id, groupCode, player1, player2, a, b, overrides = {}) {
  const winner = a > b ? player1 : player2
  return {
    _id: `result_${id}`,
    sourceMatchId: id,
    stage: 'group',
    matchKind: 'group',
    groupCode,
    player1: { id: player1, name: player1.toUpperCase() },
    player2: { id: player2, name: player2.toUpperCase() },
    score: { sets: [{ a, b }], tiebreak: null },
    resultStatus: 'confirmed',
    winner: { id: winner, name: winner.toUpperCase() },
    ...overrides
  }
}

function unresolvedTieRows() {
  return [
    row('m1', 'A', 'a', 'b', 4, 2),
    row('m2', 'A', 'a', 'c', 2, 4),
    row('m3', 'A', 'b', 'c', 4, 2)
  ]
}

describe('calculateGroupStandings', () => {
  test('orders two-player tie by head-to-head', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c', 'd'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('m1', 'A', 'a', 'b', 4, 1),
      row('m2', 'A', 'a', 'c', 4, 1),
      row('m3', 'A', 'd', 'a', 4, 1),
      row('m4', 'A', 'b', 'c', 4, 1),
      row('m5', 'A', 'b', 'd', 4, 1),
      row('m6', 'A', 'c', 'd', 4, 1)
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.map(r => r.playerId)).toEqual(['a', 'b', 'c', 'd'])
    expect(standings.A.manualTiebreakRequired).toBe(false)
    expect(standings.A.rows[0].headToHead).toBe('beat b')
    expect(standings.A.rows[1].headToHead).toBe('lost to a')
    expect(standings.A.rows.map(r => ({ id: r.playerId, source: r.source, promoted: r.promoted }))).toEqual([
      { id: 'a', source: 'A1', promoted: true },
      { id: 'b', source: 'A2', promoted: true },
      { id: 'c', source: '', promoted: false },
      { id: 'd', source: '', promoted: false }
    ])
  })

  test('three-player circular tie uses gameDiff over recursive head-to-head', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('m1', 'A', 'a', 'b', 4, 3),
      row('m2', 'A', 'b', 'c', 4, 1),
      row('m3', 'A', 'c', 'a', 4, 0)
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.map(r => ({ id: r.playerId, gameDiff: r.gameDiff }))).toEqual([
      { id: 'b', gameDiff: 2 },
      { id: 'c', gameDiff: 1 },
      { id: 'a', gameDiff: -3 }
    ])
    expect(standings.A.rows[0].playerId).toBe('b')
    expect(standings.A.rows.map(r => r.headToHead)).toEqual(['', '', ''])
  })

  test('marks unresolved ties for manual ordering', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = unresolvedTieRows()
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.manualTiebreakRequired).toBe(true)
  })

  test('counts tied set games and derives winner from tiebreak', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('tb1', 'A', 'a', 'b', 3, 3, {
        score: { sets: [{ a: 3, b: 3 }], tiebreak: { a: 7, b: 5 } },
        winner: null
      })
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.map(r => ({ id: r.playerId, wins: r.wins, losses: r.losses, totalGamesWon: r.totalGamesWon, gameDiff: r.gameDiff }))).toEqual([
      { id: 'a', wins: 1, losses: 0, totalGamesWon: 3, gameDiff: 0 },
      { id: 'b', wins: 0, losses: 1, totalGamesWon: 3, gameDiff: 0 }
    ])
  })

  test('derives tied set winner from string tiebreak without explicit winner', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('tb-string', 'A', 'a', 'b', 3, 3, {
        score: { sets: [{ a: 3, b: 3 }], tiebreak: '5-7' },
        winner: undefined,
        winnerId: undefined
      })
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.map(r => ({ id: r.playerId, wins: r.wins, losses: r.losses, totalGamesWon: r.totalGamesWon, gameDiff: r.gameDiff }))).toEqual([
      { id: 'b', wins: 1, losses: 0, totalGamesWon: 3, gameDiff: 0 },
      { id: 'a', wins: 0, losses: 1, totalGamesWon: 3, gameDiff: 0 }
    ])
  })

  test('uses explicit winner fields for tied set winners', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c', 'd'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('w1', 'A', 'a', 'b', 3, 3, {
        score: { sets: [{ a: 3, b: 3 }], tiebreak: null },
        winner: { id: 'a', name: 'A' }
      }),
      row('w2', 'A', 'c', 'd', 3, 3, {
        score: { sets: [{ a: 3, b: 3 }], tiebreak: null },
        winner: null,
        winnerId: 'c'
      })
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.find(r => r.playerId === 'a').wins).toBe(1)
    expect(standings.A.rows.find(r => r.playerId === 'c').wins).toBe(1)
    expect(standings.A.rows.find(r => r.playerId === 'b').losses).toBe(1)
    expect(standings.A.rows.find(r => r.playerId === 'd').losses).toBe(1)
  })

  test('uses totalGamesWon after wins and gameDiff are tied', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('tg1', 'A', 'a', 'b', 4, 2),
      row('tg2', 'A', 'b', 'c', 6, 4),
      row('tg3', 'A', 'c', 'a', 5, 3)
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.map(r => ({ id: r.playerId, wins: r.wins, gameDiff: r.gameDiff, totalGamesWon: r.totalGamesWon }))).toEqual([
      { id: 'c', wins: 1, gameDiff: 0, totalGamesWon: 9 },
      { id: 'b', wins: 1, gameDiff: 0, totalGamesWon: 8 },
      { id: 'a', wins: 1, gameDiff: 0, totalGamesWon: 7 }
    ])
    expect(standings.A.manualTiebreakRequired).toBe(false)
  })

  test('ignores pending knockout and bracket rows while accepting rows without explicit stage markers', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('valid-missing-markers', 'A', 'a', 'b', 4, 1, { stage: undefined, matchKind: undefined }),
      row('pending', 'A', 'c', 'a', 4, 0, { resultStatus: 'pending' }),
      row('knockout', 'A', 'b', 'a', 4, 0, { stage: 'knockout' }),
      row('bracket', 'A', 'b', 'c', 4, 0, { matchKind: 'bracket' })
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    const statsByPlayer = Object.fromEntries(standings.A.rows.map(r => [
      r.playerId,
      { wins: r.wins, losses: r.losses, totalGamesWon: r.totalGamesWon }
    ]))
    expect(statsByPlayer).toEqual({
      a: { wins: 1, losses: 0, totalGamesWon: 4 },
      b: { wins: 0, losses: 1, totalGamesWon: 1 },
      c: { wins: 0, losses: 0, totalGamesWon: 0 }
    })
  })

  test('manual override freezes requested ordering', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase(), registrationId: `reg_${id}` }))
    }]
    const override = { finalRows: [{ playerId: 'c' }, { playerId: 'a' }, { playerId: 'b' }], overrideBy: 'admin1' }
    const standings = calculateGroupStandings({ groups, results: [], manualOverrides: { A: override } })
    expect(standings.A.rows.map(r => ({ id: r.playerId, rank: r.rank, source: r.source, promoted: r.promoted }))).toEqual([
      { id: 'c', rank: 1, source: 'A1', promoted: true },
      { id: 'a', rank: 2, source: 'A2', promoted: true },
      { id: 'b', rank: 3, source: '', promoted: false }
    ])
    expect(standings.A.manualOverride).toBe(override)
    expect(standings.A.manualTiebreakRequired).toBe(false)
  })

  test('partial manual override does not clear unresolved tie', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const override = { finalRows: [{ playerId: 'c' }, { playerId: 'a' }], overrideBy: 'admin1' }
    const standings = calculateGroupStandings({ groups, results: unresolvedTieRows(), manualOverrides: { A: override } })
    expect(standings.A.rows.map(r => r.playerId)).toEqual(['a', 'b', 'c'])
    expect(standings.A.manualTiebreakRequired).toBe(true)
    expect(standings.A.manualOverride).toBeUndefined()
    expect(standings.A.overrideError).toEqual(expect.any(String))
  })

  test('duplicate and unknown manual override does not clear unresolved tie', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const override = { finalRows: [{ playerId: 'c' }, { playerId: 'c' }, { playerId: 'x' }], overrideBy: 'admin1' }
    const standings = calculateGroupStandings({ groups, results: unresolvedTieRows(), manualOverrides: { A: override } })
    expect(standings.A.rows.map(r => r.playerId)).toEqual(['a', 'b', 'c'])
    expect(standings.A.manualTiebreakRequired).toBe(true)
    expect(standings.A.manualOverride).toBeUndefined()
    expect(standings.A.overrideError).toEqual(expect.any(String))
  })
})
