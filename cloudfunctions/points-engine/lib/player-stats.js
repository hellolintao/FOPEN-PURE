const { toPublicIdentity } = require('../../_shared/public-profile')

function deriveRoundLabel(tournament, round) {
  if (!tournament) return null
  if (tournament.format !== 'knockout') return null

  const total = tournament.totalRounds ||
    (tournament.config && tournament.config.totalRounds) ||
    (tournament.maxPlayers >= 2 ? Math.ceil(Math.log2(tournament.maxPlayers)) : 0)
  if (!round || total <= 0) return null

  const gap = total - round
  if (gap === 0) return 'F'
  if (gap === 1) return 'SF'
  if (gap === 2) return 'QF'
  return `R${round}`
}

function includesPlayer(value, playerId) {
  if (!value || !playerId) return false
  if (Array.isArray(value)) return value.includes(playerId)
  if (typeof value === 'string') return value.split(',').map(id => id.trim()).includes(playerId)
  if (typeof value !== 'object') return false
  if (value.id === playerId || value.partnerId === playerId || value.memberId === playerId) return true
  if (Array.isArray(value.ids) && value.ids.includes(playerId)) return true
  if (Array.isArray(value.memberIds) && value.memberIds.includes(playerId)) return true
  return false
}

function oppositeSide(side) {
  return side === 'a' ? 'b' : (side === 'b' ? 'a' : null)
}

function winningScoreSide(score) {
  const pairs = scorePairs(score)
  const decisive = pairs.find(pair => pair.left !== pair.right) || pairs[pairs.length - 1]
  if (!decisive || decisive.left === decisive.right) return null
  return decisive.left > decisive.right ? 'a' : 'b'
}

function scorePairs(score) {
  if (!score) return []
  if (typeof score === 'string') {
    const pairs = []
    const re = /\b(\d+)\s*[-:]\s*(\d+)\b/g
    let m
    while ((m = re.exec(score))) pairs.push({ left: Number(m[1]), right: Number(m[2]) })
    return pairs
  }
  const pairs = (Array.isArray(score.sets) ? score.sets : [])
    .filter(set => set && set.a != null && set.b != null)
    .map(set => ({ left: Number(set.a), right: Number(set.b) }))
  if (score.tiebreak && typeof score.tiebreak === 'string') {
    const m = /^(\d+)-(\d+)$/.exec(score.tiebreak)
    if (m) pairs.push({ left: Number(m[1]), right: Number(m[2]) })
  }
  return pairs
}

function playerRole(row, playerId, mine) {
  if (mine && mine.role === 'winner') return 'winner'
  if (mine && mine.role === 'loser') return 'loser'
  if (includesPlayer(row && row.winner, playerId) || includesPlayer(row && row.winnerId, playerId) || includesPlayer(row && row.winnerIds, playerId)) return 'winner'
  if (includesPlayer(row && row.loser, playerId) || includesPlayer(row && row.loserId, playerId) || includesPlayer(row && row.loserIds, playerId)) return 'loser'
  return null
}

function subjectSide(row, playerId, mine) {
  if (includesPlayer(row && row.player1, playerId)) return 'a'
  if (includesPlayer(row && row.player2, playerId)) return 'b'
  const role = playerRole(row, playerId, mine)
  const winnerSide = winningScoreSide(row && row.score)
  if (!role || !winnerSide) return null
  return role === 'winner' ? winnerSide : oppositeSide(winnerSide)
}

function flipPairText(text) {
  if (typeof text !== 'string') return text
  return text.replace(/\b(\d+)\s*([-:])\s*(\d+)\b/g, (_, left, sep, right) => `${right}${sep}${left}`)
}

function formatScore(score, options = {}) {
  if (!score) return ''
  const flip = !!options.flip
  if (typeof score === 'string') return flip ? flipPairText(score) : score

  const sets = Array.isArray(score.sets) ? score.sets : []
  if (sets.length === 0) return ''

  const parts = sets
    .map(set => {
      if (!set || set.a == null || set.b == null) return ''
      return flip ? `${set.b}-${set.a}` : `${set.a}-${set.b}`
    })
    .filter(Boolean)

  if (score.tiebreak) {
    parts.push(`(${flip ? flipPairText(score.tiebreak) : score.tiebreak})`)
  }

  return parts.join(' ')
}

function enrichRecent(rows, playerId, tournamentsMap, membersMap) {
  return (rows || []).map((row, index) => {
    const tournament = tournamentsMap.get(row.tournamentId) || null
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    const mine = entries.find(e => e.memberId === playerId)
    const scoreSide = subjectSide(row, playerId, mine)
    const role = playerRole(row, playerId, mine)
    const opponentEntry = row.tournamentType === 'doubles' && mine && mine.role
      ? entries.find(e => e.memberId !== playerId && e.role && e.role !== mine.role)
      : entries.find(e => e.memberId !== playerId)
    const opponentId = opponentEntry ? opponentEntry.memberId : null
    const opponentMember = opponentId ? membersMap.get(opponentId) : null
    const opponentIdentity = toPublicIdentity(opponentMember, { index })
    const sourceMatchId = row.sourceMatchId || row.matchId || row._id

    return {
      _id: row._id,
      matchId: sourceMatchId,
      sourceMatchId,
      tournamentId: row.tournamentId,
      tournamentName: tournament ? (tournament.name || '') : '',
      tournamentFormat: tournament ? (tournament.format || null) : null,
      tournamentType: row.tournamentType || row.type || (tournament && tournament.type) || 'singles',
      round: row.round,
      roundLabel: deriveRoundLabel(tournament, row.round),
      score: formatScore(row.score, { flip: scoreSide === 'b' }),
      opponentId,
      opponentName: opponentId ? opponentIdentity.name : '',
      opponentProfileVisible: opponentId ? opponentIdentity.publicProfileVisible : false,
      won: role === 'winner',
      pointsAwarded: mine ? (mine.points || 0) : 0,
      createTime: row.createTime,
      confirmedAt: row.confirmedAt || null
    }
  })
}

module.exports = { deriveRoundLabel, enrichRecent, formatScore }
