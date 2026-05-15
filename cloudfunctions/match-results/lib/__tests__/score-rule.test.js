const { validateScore, computeWinner } = require('../score-rule')

describe('validateScore', () => {
  test('4:0 → valid，winner=a', () => {
    expect(validateScore(4, 0, null)).toEqual({ valid: true, winner: 'a' })
  })
  test('4:1 → valid，winner=a', () => {
    expect(validateScore(4, 1, null)).toEqual({ valid: true, winner: 'a' })
  })
  test('4:2 → valid，winner=a', () => {
    expect(validateScore(4, 2, null)).toEqual({ valid: true, winner: 'a' })
  })
  test('2:4 → valid，winner=b', () => {
    expect(validateScore(2, 4, null)).toEqual({ valid: true, winner: 'b' })
  })
  test('0:4 → valid，winner=b', () => {
    expect(validateScore(0, 4, null)).toEqual({ valid: true, winner: 'b' })
  })
  test('3:3 没抢七 → invalid', () => {
    const r = validateScore(3, 3, null)
    expect(r.valid).toBe(false)
    expect(r.error).toBeDefined()
  })
  test('3:3 + tb 7-5 → valid，winner=a', () => {
    expect(validateScore(3, 3, '7-5')).toEqual({ valid: true, winner: 'a' })
  })
  test('3:3 + tb 5-7 → valid，winner=b', () => {
    expect(validateScore(3, 3, '5-7')).toEqual({ valid: true, winner: 'b' })
  })
  test('3:3 + tb 8-6 → valid，winner=a', () => {
    expect(validateScore(3, 3, '8-6')).toEqual({ valid: true, winner: 'a' })
  })
  test('3:3 + tb 10-12 → valid，winner=b', () => {
    expect(validateScore(3, 3, '10-12')).toEqual({ valid: true, winner: 'b' })
  })
  test('3:3 + tb 6-4 → invalid（max<7）', () => {
    expect(validateScore(3, 3, '6-4').valid).toBe(false)
  })
  test('3:3 + tb 8-7 → invalid（差<2）', () => {
    expect(validateScore(3, 3, '8-7').valid).toBe(false)
  })
  test('3:3 + tb 7-7 → invalid（差<2）', () => {
    expect(validateScore(3, 3, '7-7').valid).toBe(false)
  })
  test('3:3 + tb 格式错 → invalid', () => {
    expect(validateScore(3, 3, '七比五').valid).toBe(false)
    expect(validateScore(3, 3, '7,5').valid).toBe(false)
    expect(validateScore(3, 3, '').valid).toBe(false)
    expect(validateScore(3, 3, '7').valid).toBe(false)
  })
  test('3:3 + tb 负数 → invalid', () => {
    expect(validateScore(3, 3, '-1-5').valid).toBe(false)
  })
  test('4:3 直接录 → invalid（4 局制下不允许，需 3:3 才能抢七）', () => {
    expect(validateScore(4, 3, null).valid).toBe(false)
  })
  test('3:4 直接录 → invalid', () => {
    expect(validateScore(3, 4, null).valid).toBe(false)
  })
  test('4:4 → invalid', () => {
    expect(validateScore(4, 4, null).valid).toBe(false)
  })
  test('3:2 → invalid（max<4）', () => {
    expect(validateScore(3, 2, null).valid).toBe(false)
  })
  test('0:0 → invalid（max<4）', () => {
    expect(validateScore(0, 0, null).valid).toBe(false)
  })
  test('-1:4 → invalid（负数）', () => {
    expect(validateScore(-1, 4, null).valid).toBe(false)
  })
  test('4:-1 → invalid（负数）', () => {
    expect(validateScore(4, -1, null).valid).toBe(false)
  })
  test('5:0 → invalid（max>4）', () => {
    expect(validateScore(5, 0, null).valid).toBe(false)
  })
  test('非整数 → invalid', () => {
    expect(validateScore(3.5, 4, null).valid).toBe(false)
    expect(validateScore('4', 0, null).valid).toBe(false)
    expect(validateScore(null, 4, null).valid).toBe(false)
  })
})

describe('computeWinner', () => {
  test('valid + winner=a → 返回 player1 引用', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    const w = computeWinner(m, { a: 4, b: 2, tiebreak: null })
    expect(w).toEqual({ id: 'p1' })
  })
  test('valid + winner=b → 返回 player2 引用', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    const w = computeWinner(m, { a: 1, b: 4, tiebreak: null })
    expect(w).toEqual({ id: 'p2' })
  })
  test('invalid → null', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    expect(computeWinner(m, { a: 4, b: 3, tiebreak: null })).toBeNull()
  })
  test('3:3 + tb 7-5 → winner=player1', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    expect(computeWinner(m, { a: 3, b: 3, tiebreak: '7-5' })).toEqual({ id: 'p1' })
  })
  test('3:3 + tb 5-7 → winner=player2', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    expect(computeWinner(m, { a: 3, b: 3, tiebreak: '5-7' })).toEqual({ id: 'p2' })
  })
})
