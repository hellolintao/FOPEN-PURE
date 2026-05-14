const { generateFirstRound, advanceWinner, finalRoundOf, INSUFFICIENT_PLAYERS } = require('../generator')

function reg(ids) {
  return ids.map((id, i) => ({ playerId: id, playerName: id, registrationId: `reg_${id}`, seed: i + 1 }))
}

describe('finalRoundOf', () => {
  test('4 槽 → finalRound=2', () => expect(finalRoundOf(4)).toBe(2))
  test('8 槽 → finalRound=3', () => expect(finalRoundOf(8)).toBe(3))
  test('16 槽 → finalRound=4', () => expect(finalRoundOf(16)).toBe(4))
})

describe('generateFirstRound · knockout', () => {
  test('4 人 → 2 场 / 无 BYE', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b','c','d']) })
    expect(ms).toHaveLength(2)
    expect(ms.every(m => m.bye === false)).toBe(true)
    expect(ms.every(m => m.round === 1)).toBe(true)
    expect(ms[0].position).toBe(1)
    expect(ms[1].position).toBe(2)
  })

  test('6 人 → 8 槽 → 4 场 / 2 BYE（player2.id === "BYE"）', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b','c','d','e','f']) })
    expect(ms).toHaveLength(4)
    const byeMatches = ms.filter(m => m.bye === true)
    expect(byeMatches).toHaveLength(2)
    byeMatches.forEach(m => {
      expect(m.player2).toEqual({ id: 'BYE', name: 'BYE' })
      expect(m.status).toBe('walkover')
      expect(m.resultStatus).toBe('confirmed')
      expect(m.winner).toEqual({ id: m.player1.id, name: m.player1.name })
    })
  })

  test('12 人 → 16 槽 → 8 场 / 4 BYE', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10','p11','p12']) })
    expect(ms).toHaveLength(8)
    const byeMatches = ms.filter(m => m.bye === true)
    expect(byeMatches).toHaveLength(4)
    expect(byeMatches.every(m => m.winner && m.winner.id)).toBe(true)
  })

  test('matchId 唯一', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b','c','d','e','f','g','h']) })
    expect(new Set(ms.map(m => m.matchId)).size).toBe(ms.length)
  })

  test('0 人 → 抛 INSUFFICIENT_PLAYERS', () => {
    expect(() => generateFirstRound({ format: 'knockout', type: 'singles', registrations: [] })).toThrow(INSUFFICIENT_PLAYERS)
  })

  test('1 人 → 抛 INSUFFICIENT_PLAYERS', () => {
    expect(() => generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a']) })).toThrow(INSUFFICIENT_PLAYERS)
  })

  test('2 人 → 1 场决赛 / 无 BYE / finalRound=1', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b']) })
    expect(ms).toHaveLength(1)
    expect(ms[0].bye).toBe(false)
  })
})

describe('generateFirstRound · regular', () => {
  test('4 人 → 2 场（每人一场）', () => {
    const ms = generateFirstRound({ format: 'regular', type: 'singles', registrations: reg(['a','b','c','d']) })
    expect(ms).toHaveLength(2)
    const players = ms.flatMap(m => [m.player1.id, m.player2.id])
    expect(new Set(players).size).toBe(4)
  })

  test('奇数 5 人 → 2 场（1 人轮空，不进 matches）', () => {
    const ms = generateFirstRound({ format: 'regular', type: 'singles', registrations: reg(['a','b','c','d','e']) })
    expect(ms).toHaveLength(2)
    expect(ms.every(m => m.bye === false)).toBe(true)
  })
})

describe('advanceWinner', () => {
  test('R1 position 1, winner=W → R2 position 1 player1=W', () => {
    const patch = advanceWinner({ round: 1, position: 1, winner: { id: 'W', name: 'W' } })
    expect(patch).toEqual({ nextRound: 2, nextPosition: 1, slot: 'player1', winner: { id: 'W', name: 'W' } })
  })
  test('R1 position 2 → R2 position 1 player2', () => {
    const patch = advanceWinner({ round: 1, position: 2, winner: { id: 'X', name: 'X' } })
    expect(patch.nextPosition).toBe(1)
    expect(patch.slot).toBe('player2')
  })
  test('R1 position 3 → R2 position 2 player1', () => {
    const patch = advanceWinner({ round: 1, position: 3, winner: { id: 'X', name: 'X' } })
    expect(patch.nextPosition).toBe(2)
    expect(patch.slot).toBe('player1')
  })
  test('R1 position 8 → R2 position 4 player2', () => {
    const patch = advanceWinner({ round: 1, position: 8, winner: { id: 'X', name: 'X' } })
    expect(patch.nextPosition).toBe(4)
    expect(patch.slot).toBe('player2')
  })
  test('isFinal=true → 返回 null（不推进）', () => {
    const patch = advanceWinner({ round: 3, position: 1, winner: { id: 'X', name: 'X' }, isFinal: true })
    expect(patch).toBeNull()
  })
})
