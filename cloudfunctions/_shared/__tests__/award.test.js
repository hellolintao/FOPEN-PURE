const { buildAwardEntries, buildPlacementEntries, ROLE_WINNER, ROLE_LOSER, finalRoundOf } = require('../award')

function singlesMatch(winnerId, loserId) {
  return {
    matchKind: 'bracket',
    player1: { id: winnerId, name: winnerId },
    player2: { id: loserId, name: loserId },
    winner: { id: winnerId, name: winnerId }
  }
}

function doublesMatch(winnerIds, loserIds) {
  return {
    matchKind: 'regularRound',
    player1: { id: winnerIds[0], partnerId: winnerIds[1] },
    player2: { id: loserIds[0], partnerId: loserIds[1] },
    winner: { id: winnerIds[0], partnerId: winnerIds[1] }
  }
}

describe('buildAwardEntries · winLoss', () => {
  const rule = { win: 20, loss: 10, walkover: 0 }

  test('单打胜场 → 2 条 entries', () => {
    const m = singlesMatch('A', 'B')
    const entries = buildAwardEntries(m, rule, 'singles')
    expect(entries).toEqual([
      { memberId: 'A', points: 20, role: ROLE_WINNER },
      { memberId: 'B', points: 10, role: ROLE_LOSER }
    ])
  })

  test('双打胜场 → 4 条 entries（2 win + 2 loss）', () => {
    const m = doublesMatch(['A1', 'A2'], ['B1', 'B2'])
    const entries = buildAwardEntries(m, rule, 'doubles')
    expect(entries).toHaveLength(4)
    expect(entries.filter(e => e.role === ROLE_WINNER).map(e => e.memberId).sort()).toEqual(['A1', 'A2'])
    expect(entries.filter(e => e.role === ROLE_LOSER).map(e => e.memberId).sort()).toEqual(['B1', 'B2'])
    expect(entries.every(e => e.role === ROLE_WINNER ? e.points === 20 : e.points === 10)).toBe(true)
  })

  test('BYE walkover → entries 为空', () => {
    const m = { ...singlesMatch('A', 'BYE'), bye: true, status: 'walkover' }
    expect(buildAwardEntries(m, rule, 'singles')).toEqual([])
  })

  test('无 winner → entries 为空', () => {
    const m = { player1: { id: 'A' }, player2: { id: 'B' }, winner: null }
    expect(buildAwardEntries(m, rule, 'singles')).toEqual([])
  })
})

describe('buildAwardEntries · 备选 winner 定位路径', () => {
  const rule = { win: 20, loss: 10, walkover: 0 }

  test('winner 是 player2.id（单打）→ 输者为 player1', () => {
    const m = {
      player1: { id: 'A' },
      player2: { id: 'B' },
      winner: { id: 'B' }
    }
    const entries = buildAwardEntries(m, rule, 'singles')
    expect(entries).toEqual([
      { memberId: 'B', points: 20, role: ROLE_WINNER },
      { memberId: 'A', points: 10, role: ROLE_LOSER }
    ])
  })

  test('winner.id 仅匹配 player1.partnerId（双打）→ 输者为 player2', () => {
    const m = {
      player1: { id: 'A1', partnerId: 'A2' },
      player2: { id: 'B1', partnerId: 'B2' },
      winner: { id: 'A2', partnerId: 'A1' }
    }
    const entries = buildAwardEntries(m, rule, 'doubles')
    const winners = entries.filter(e => e.role === ROLE_WINNER).map(e => e.memberId).sort()
    const losers  = entries.filter(e => e.role === ROLE_LOSER).map(e => e.memberId).sort()
    expect(winners).toEqual(['A1', 'A2'])
    expect(losers).toEqual(['B1', 'B2'])
  })

  test('winner.id 仅匹配 player2.partnerId（双打）→ 输者为 player1', () => {
    const m = {
      player1: { id: 'A1', partnerId: 'A2' },
      player2: { id: 'B1', partnerId: 'B2' },
      winner: { id: 'B2', partnerId: 'B1' }
    }
    const entries = buildAwardEntries(m, rule, 'doubles')
    const winners = entries.filter(e => e.role === ROLE_WINNER).map(e => e.memberId).sort()
    const losers  = entries.filter(e => e.role === ROLE_LOSER).map(e => e.memberId).sort()
    expect(winners).toEqual(['B1', 'B2'])
    expect(losers).toEqual(['A1', 'A2'])
  })

  test('winner 找不到对手（孤立 winner）→ 仅写赢者条目', () => {
    const m = {
      player1: { id: 'X' },
      player2: { id: 'Y' },
      winner: { id: 'Z' }
    }
    const entries = buildAwardEntries(m, rule, 'singles')
    expect(entries).toEqual([
      { memberId: 'Z', points: 20, role: ROLE_WINNER }
    ])
  })
})

describe('finalRoundOf', () => {
  test('4 槽 → 2', () => expect(finalRoundOf(4)).toBe(2))
  test('8 槽 → 3', () => expect(finalRoundOf(8)).toBe(3))
  test('16 槽 → 4', () => expect(finalRoundOf(16)).toBe(4))
  test('< 2 → 1', () => expect(finalRoundOf(1)).toBe(1))
})

describe('buildPlacementEntries', () => {
  const placement = { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 }

  test('4 人 / 4 槽 / final=2 → 无 QF / 无 participation', () => {
    const brackets = [
      { round: 1, matches: [
        { matchId: 'r1m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } },
        { matchId: 'r1m2', winner: { id: 'C' }, player1: { id: 'C' }, player2: { id: 'D' } }
      ]},
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'C' } }
      ]}
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const byId = Object.fromEntries(entries.map(e => [e.memberId, e]))
    expect(byId['A']).toEqual(expect.objectContaining({ rank: 'champion', points: 100 }))
    expect(byId['C']).toEqual(expect.objectContaining({ rank: 'runnerUp', points: 70 }))
    expect(byId['B']).toEqual(expect.objectContaining({ rank: 'semifinal', points: 50 }))
    expect(byId['D']).toEqual(expect.objectContaining({ rank: 'semifinal', points: 50 }))
  })

  test('双打 placement → 队伍内 2 人各拿同一个桶的积分', () => {
    const brackets = [
      { round: 1, matches: [
        { matchId: 'r1m1', winner: { id: 'A1', partnerId: 'A2' }, player1: { id: 'A1', partnerId: 'A2' }, player2: { id: 'B1', partnerId: 'B2' } },
        { matchId: 'r1m2', winner: { id: 'C1', partnerId: 'C2' }, player1: { id: 'C1', partnerId: 'C2' }, player2: { id: 'D1', partnerId: 'D2' } }
      ]},
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A1', partnerId: 'A2' }, player1: { id: 'A1', partnerId: 'A2' }, player2: { id: 'C1', partnerId: 'C2' } }
      ]}
    ]
    const entries = buildPlacementEntries(brackets, placement, 'doubles')
    expect(entries.filter(e => e.rank === 'champion').map(e => e.memberId).sort()).toEqual(['A1', 'A2'])
    expect(entries.filter(e => e.rank === 'runnerUp').map(e => e.memberId).sort()).toEqual(['C1', 'C2'])
    expect(entries.filter(e => e.rank === 'semifinal').map(e => e.memberId).sort()).toEqual(['B1', 'B2', 'D1', 'D2'])
  })

  test('8 人 / 8 槽 / final=3 → 有 QF 桶', () => {
    // R1: 4 场 → 4 winners 进 R2；R2: 2 场 → 2 winners 进 R3；R3: final
    // 失败者：R1 → quarterfinal（finalRound-2 = 1）；R2 → semifinal；final loser → runnerUp；final winner → champion
    const brackets = [
      { round: 1, matches: [
        { matchId: 'r1m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } },
        { matchId: 'r1m2', winner: { id: 'C' }, player1: { id: 'C' }, player2: { id: 'D' } },
        { matchId: 'r1m3', winner: { id: 'E' }, player1: { id: 'E' }, player2: { id: 'F' } },
        { matchId: 'r1m4', winner: { id: 'G' }, player1: { id: 'G' }, player2: { id: 'H' } }
      ]},
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'C' } },
        { matchId: 'r2m2', winner: { id: 'E' }, player1: { id: 'E' }, player2: { id: 'G' } }
      ]},
      { round: 3, matches: [
        { matchId: 'r3m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'E' } }
      ]}
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const byId = Object.fromEntries(entries.map(e => [e.memberId, e]))
    expect(byId['A'].rank).toBe('champion')
    expect(byId['E'].rank).toBe('runnerUp')
    expect(byId['C'].rank).toBe('semifinal')
    expect(byId['G'].rank).toBe('semifinal')
    expect(byId['B'].rank).toBe('quarterfinal')
    expect(byId['D'].rank).toBe('quarterfinal')
    expect(byId['F'].rank).toBe('quarterfinal')
    expect(byId['H'].rank).toBe('quarterfinal')
  })

  test('16 人 / 16 槽 / final=4 → R1 败者 = participation', () => {
    // 构造一个 16 人 full bracket，断言 R1 败者拿 participation
    const r1 = []
    const players = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P']
    for (let i = 0; i < 8; i++) {
      r1.push({ matchId: `r1m${i+1}`, winner: { id: players[i*2] }, player1: { id: players[i*2] }, player2: { id: players[i*2+1] } })
    }
    const r2 = []
    for (let i = 0; i < 4; i++) {
      r2.push({ matchId: `r2m${i+1}`, winner: { id: players[i*4] }, player1: { id: players[i*4] }, player2: { id: players[i*4+2] } })
    }
    const r3 = []
    for (let i = 0; i < 2; i++) {
      r3.push({ matchId: `r3m${i+1}`, winner: { id: players[i*8] }, player1: { id: players[i*8] }, player2: { id: players[i*8+4] } })
    }
    const r4 = [{ matchId: 'r4m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'I' } }]
    const brackets = [
      { round: 1, matches: r1 },
      { round: 2, matches: r2 },
      { round: 3, matches: r3 },
      { round: 4, matches: r4 }
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const byRank = (rank) => entries.filter(e => e.rank === rank).map(e => e.memberId).sort()
    expect(byRank('champion')).toEqual(['A'])
    expect(byRank('runnerUp')).toEqual(['I'])
    expect(byRank('semifinal').length).toBe(2)
    expect(byRank('quarterfinal').length).toBe(4)
    expect(byRank('participation').length).toBe(8)
  })

  test('空 brackets → entries 空', () => {
    expect(buildPlacementEntries([], placement, 'singles')).toEqual([])
  })

  test('decisive winner 还没出 (final 没 winner) → entries 空', () => {
    const brackets = [
      { round: 1, matches: [{ matchId: 'r1m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } }] },
      { round: 2, matches: [{ matchId: 'r2m1', winner: null, player1: { id: 'A' }, player2: null }] }
    ]
    expect(buildPlacementEntries(brackets, placement, 'singles')).toEqual([])
  })

  test('SF 行未出结果（无 winner）→ 不写 semifinal 桶但 final 仍可算', () => {
    // 8 槽：R1 全部完成，R2 仅 1 场出 winner，另 1 场 winner=null；R3 final 已完成
    const brackets = [
      { round: 1, matches: [
        { matchId: 'r1m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } },
        { matchId: 'r1m2', winner: { id: 'C' }, player1: { id: 'C' }, player2: { id: 'D' } },
        { matchId: 'r1m3', winner: { id: 'E' }, player1: { id: 'E' }, player2: { id: 'F' } },
        { matchId: 'r1m4', winner: { id: 'G' }, player1: { id: 'G' }, player2: { id: 'H' } }
      ]},
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'C' } },
        { matchId: 'r2m2', winner: null, player1: { id: 'E' }, player2: { id: 'G' } } // 未完成
      ]},
      { round: 3, matches: [
        { matchId: 'r3m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'E' } }
      ]}
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const byId = Object.fromEntries(entries.map(e => [e.memberId, e]))
    expect(byId['A'].rank).toBe('champion')
    expect(byId['E'].rank).toBe('runnerUp')
    // r2m1 的 loser C 仍写 semifinal
    expect(byId['C'].rank).toBe('semifinal')
    // r2m2 未出 winner → 不写 semifinal
    expect(byId['G']?.rank).not.toBe('semifinal')
  })

  test('placement 桶去重（同一 id 在多轮出现）→ 仅保留首次桶', () => {
    // 构造数据使 buildPlacementEntries 在 SF 桶尝试写入已是 champion 的 id（去重路径）
    const brackets = [
      { round: 1, matches: [
        { matchId: 'r1m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } },
        { matchId: 'r1m2', winner: { id: 'C' }, player1: { id: 'C' }, player2: { id: 'A' } } // 不合理但触发去重
      ]},
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'C' } }
      ]}
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const aEntries = entries.filter(e => e.memberId === 'A')
    expect(aEntries.length).toBe(1)
    expect(aEntries[0].rank).toBe('champion')
  })

  test('r1.matches 缺失（异常 brackets）→ slots=0, 走 finalRound=maxRound 路径', () => {
    const brackets = [
      { round: 1 }, // matches 缺失
      { round: 2, matches: [{ matchId: 'r2m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } }] }
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const byId = Object.fromEntries(entries.map(e => [e.memberId, e]))
    expect(byId['A'].rank).toBe('champion')
    expect(byId['B'].rank).toBe('runnerUp')
  })

  test('R1 BYE 行不写 participation', () => {
    // 8 槽，R1 中 2 个 BYE
    const r1 = [
      { matchId: 'r1m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } },
      { matchId: 'r1m2', winner: { id: 'C' }, bye: true, player1: { id: 'C' }, player2: null }, // BYE
      { matchId: 'r1m3', winner: { id: 'E' }, player1: { id: 'E' }, player2: { id: 'F' } },
      { matchId: 'r1m4', winner: { id: 'G' }, bye: true, player1: { id: 'G' }, player2: null }  // BYE
    ]
    const brackets = [
      { round: 1, matches: r1 },
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'C' } },
        { matchId: 'r2m2', winner: { id: 'E' }, player1: { id: 'E' }, player2: { id: 'G' } }
      ]},
      { round: 3, matches: [{ matchId: 'r3m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'E' } }] }
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const byId = Object.fromEntries(entries.map(e => [e.memberId, e]))
    // R1 BYE 行（r1m2, r1m4）不应有 quarterfinal 桶为 BYE 一方
    // 实际：R1 败者 → quarterfinal 桶（8 槽 finalRound=3, finalRound-2=1）
    // BYE 行 player2 是 null，所以即使代码把 BYE 视为 R1 败者也没有 player2.id
    // 校验：BYE 行不参与 quarterfinal entries（B, F 是真败者；BYE 没有 loser 实体）
    expect(byId['B']?.rank).toBe('quarterfinal')
    expect(byId['F']?.rank).toBe('quarterfinal')
    // 不应有任何 entry 来源是 BYE 推进的 winner C 或 G 在 quarterfinal 桶
    expect(byId['C']?.rank).not.toBe('quarterfinal')
    expect(byId['G']?.rank).not.toBe('quarterfinal')
  })
})
