const ROLE_WINNER = 'winner'
const ROLE_LOSER  = 'loser'

function buildAwardEntries(match, rule, type) {
  if (match.bye || match.status === 'walkover') return []
  if (!match.winner || !match.winner.id) return []

  const winnerIds = collectIds(match.winner, type)
  const loserSide = matchSideOpposite(match)
  const loserIds  = collectIds(loserSide, type)

  const entries = []
  for (const id of winnerIds) entries.push({ memberId: id, points: rule.win,  role: ROLE_WINNER })
  for (const id of loserIds)  entries.push({ memberId: id, points: rule.loss, role: ROLE_LOSER })
  return entries
}

function collectIds(obj, type) {
  if (!obj || !obj.id) return []
  const out = [obj.id]
  if (type === 'doubles' && obj.partnerId) out.push(obj.partnerId)
  return out
}

function matchSideOpposite(m) {
  if (!m.winner) return null
  const p1Id = m.player1 && m.player1.id
  const p2Id = m.player2 && m.player2.id
  if (p1Id && p1Id === m.winner.id) return m.player2
  if (p2Id && p2Id === m.winner.id) return m.player1
  if (m.player1 && m.player1.partnerId === m.winner.id) return m.player2
  if (m.player2 && m.player2.partnerId === m.winner.id) return m.player1
  return null
}

function finalRoundOf(slots) {
  if (slots < 2) return 1
  return Math.log2(slots) | 0
}

function buildPlacementEntries(brackets, placement, type) {
  if (!brackets || brackets.length === 0) return []
  const sorted = [...brackets].sort((a, b) => a.round - b.round)
  const r1 = sorted[0]
  const slots = (r1.matches || []).length * 2
  const computedFinalRound = finalRoundOf(slots)
  const maxRound = sorted[sorted.length - 1].round
  const finalRound = Math.max(computedFinalRound, maxRound)
  const final = sorted.find(b => b.round === finalRound)
  if (!final || !final.matches[0] || !final.matches[0].winner) return []

  const buckets = new Map()
  const setBucket = (id, rank) => {
    if (!id) return
    if (buckets.has(id)) return
    buckets.set(id, { memberId: id, rank, points: placement[rank] })
  }

  const championSide = final.matches[0].winner
  collectIds(championSide, type).forEach(id => setBucket(id, 'champion'))

  const finalLoser = matchSideOpposite(final.matches[0])
  collectIds(finalLoser, type).forEach(id => setBucket(id, 'runnerUp'))

  const sfRound = finalRound - 1
  if (sfRound >= 1) {
    const sf = sorted.find(b => b.round === sfRound)
    for (const m of (sf && sf.matches) || []) {
      if (m.bye) continue
      const loser = matchSideOpposite(m)
      collectIds(loser, type).forEach(id => setBucket(id, 'semifinal'))
    }
  }

  const qfRound = finalRound - 2
  if (qfRound >= 1 && slots >= 8) {
    const qf = sorted.find(b => b.round === qfRound)
    for (const m of (qf && qf.matches) || []) {
      if (m.bye) continue
      const loser = matchSideOpposite(m)
      collectIds(loser, type).forEach(id => setBucket(id, 'quarterfinal'))
    }
  }

  for (let r = 1; r < finalRound - 2; r++) {
    if (slots < 16) continue
    const round = sorted.find(b => b.round === r)
    for (const m of (round && round.matches) || []) {
      if (m.bye) continue
      const loser = matchSideOpposite(m)
      collectIds(loser, type).forEach(id => setBucket(id, 'participation'))
    }
  }

  return [...buckets.values()]
}

module.exports = { buildAwardEntries, buildPlacementEntries, finalRoundOf, ROLE_WINNER, ROLE_LOSER }
