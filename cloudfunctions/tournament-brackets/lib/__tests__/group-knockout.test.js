const {
  GROUP_CODES,
  GROUP_KNOCKOUT_PHASES,
  defaultGroupKnockoutPoints,
  validateGroupAssignments,
  generateGroupMatches,
  generateKnockoutMatches,
  knockoutBracketDocId,
  groupBracketDocId
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
      player2: { id: 'c2', name: 'C2' }
    })
    expect(brackets[0].matches.map(m => [m.player1Source, m.player2Source])).toEqual([
      ['A1', 'C2'], ['B1', 'D2'], ['C1', 'A2'], ['D1', 'B2']
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
      player2Source: 'C2',
      player1: { id: 'a1', name: 'A1' },
      player2: null
    })
  })
})
