function validateScore(a, b, tiebreak) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return { valid: false, error: 'NEG' }
  if (a === 3 && b === 3) {
    if (!tiebreak || typeof tiebreak !== 'string') return { valid: false, error: 'TB_REQUIRED' }
    const m = /^(\d+)-(\d+)$/.exec(tiebreak)
    if (!m) return { valid: false, error: 'TB_FORMAT' }
    const x = Number(m[1]), y = Number(m[2])
    // 抢七规则：先到 7 分获胜（不需要领先 2 分），单边最高 7
    const max = Math.max(x, y)
    const min = Math.min(x, y)
    if (max !== 7) return { valid: false, error: 'TB_NEEDS_7' }
    if (min >= 7) return { valid: false, error: 'TB_BOTH_7' }
    return { valid: true, winner: x > y ? 'a' : 'b' }
  }
  const max = Math.max(a, b)
  if (max < 4) return { valid: false, error: 'UNDER_4' }
  if (max > 4) return { valid: false, error: 'OVER_4' }
  if ((a === 4 && b === 3) || (a === 3 && b === 4)) return { valid: false, error: 'NEED_TB' }
  if (a === 4 && b === 4) return { valid: false, error: '4_4' }
  if (a === 4) return { valid: true, winner: 'a' }
  return { valid: true, winner: 'b' }
}

function computeWinner(match, { a, b, tiebreak }) {
  const r = validateScore(a, b, tiebreak)
  if (!r.valid) return null
  return r.winner === 'a' ? match.player1 : match.player2
}

module.exports = { validateScore, computeWinner }
