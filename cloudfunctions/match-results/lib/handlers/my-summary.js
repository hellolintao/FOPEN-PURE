const { derivePhase, getWithdrawDeadline, canWithdraw, isActiveRegistration } = require('../../../_shared/tournament-phase')
const { isActiveScoreRow } = require('../active-row')
const { canExposeScoreRows, publicScoreRows } = require('./query')

async function mySummary(ctx, payload) {
  const memberId = ctx.callerMemberId
  if (!memberId) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const historyLimit = Math.min(Math.max(parseInt(payload && payload.historyLimit, 10) || 10, 1), 50)

  const [rawPendingRows, rawSubmittedRows, rawConfirmedRows, registrationRows] = await Promise.all([
    ctx.db.queryMyPending(memberId),
    ctx.db.queryMySubmitted(memberId),
    ctx.db.queryMyConfirmed(memberId, historyLimit),
    ctx.db.queryMyRegistrations ? ctx.db.queryMyRegistrations(memberId) : [],
  ])

  const activeRegistrations = (registrationRows || []).filter(row => (
    isActiveRegistration(row) &&
    (row.playerId === memberId || row.partnerId === memberId || row.memberId === memberId || includesMember(row.playerIds) || includesMember(row.memberIds))
  ))
  const tIds = [...new Set([...rawPendingRows, ...rawSubmittedRows, ...rawConfirmedRows, ...activeRegistrations].map(r => r.tournamentId))]
  const tournamentDocs = tIds.length ? await ctx.db.getTournamentsByIds(tIds) : []
  const tMap = Object.fromEntries(tournamentDocs.map(t => [t._id, t]))
  const visibleMatch = row => isActiveScoreRow(row) && canExposeScoreRows(tMap[row.tournamentId])
  const publicCtx = { ...ctx, isAdmin: !!ctx.isAdmin }
  const [pendingRows, submittedRows, confirmedRows] = await Promise.all([
    publicScoreRows(publicCtx, rawPendingRows.filter(visibleMatch)),
    publicScoreRows(publicCtx, rawSubmittedRows.filter(visibleMatch)),
    publicScoreRows(publicCtx, rawConfirmedRows.filter(visibleMatch)),
  ])
  const nowValue = ctx.now ? ctx.now() : new Date()

  function sideLabel(side) {
    if (!side) return ''
    if (side.partnerName) return `${side.name || '?'} / ${side.partnerName}`
    return side.name || ''
  }
  function sideIncludesMember(side) {
    return includesMember(side)
  }
  function subjectSide(m) {
    if (sideIncludesMember(m.player1)) return 'a'
    if (sideIncludesMember(m.player2)) return 'b'
    const role = subjectRole(m)
    const winnerSide = winningScoreSide(m.score)
    if (!role || !winnerSide) return null
    return role === 'winner' ? winnerSide : oppositeSide(winnerSide)
  }
  function opponentLabel(m) {
    const side = subjectSide(m)
    if (side === 'b') return sideLabel(m.player1)
    return sideLabel(m.player2)
  }
  function partnerLabel(m) {
    if (m.player1 && m.player1.partnerName) return `${m.player1.name || '?'} / ${m.player1.partnerName}`
    return ''
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
  function flipPairText(text) {
    if (typeof text !== 'string') return text
    return text.replace(/\b(\d+)\s*([-:])\s*(\d+)\b/g, (_, left, sep, right) => `${right}${sep}${left}`)
  }
  function scoreLabel(score, m) {
    if (!score) return ''
    const flip = subjectSide(m) === 'b'
    if (typeof score === 'string') return flip ? flipPairText(score) : score
    const sets = Array.isArray(score.sets) ? score.sets : []
    const parts = sets
      .map(set => {
        if (!set || set.a == null || set.b == null) return ''
        return flip ? `${set.b}:${set.a}` : `${set.a}:${set.b}`
      })
      .filter(Boolean)
    if (score.tiebreak) parts.push(`(${flip ? flipPairText(score.tiebreak) : score.tiebreak})`)
    return parts.join(' ')
  }
  function sumPoints(awarded) {
    if (!awarded || !Array.isArray(awarded.entries)) return 0
    return awarded.entries
      .filter(e => e.memberId === memberId)
      .reduce((s, e) => s + (e.points || 0), 0)
  }
  function includesMember(value) {
    if (!value) return false
    if (Array.isArray(value)) return value.includes(memberId)
    if (typeof value === 'string') return value.split(',').map(id => id.trim()).includes(memberId)
    if (typeof value === 'object') {
      return value.id === memberId ||
        value.partnerId === memberId ||
        includesMember(value.ids) ||
        includesMember(value.memberIds)
    }
    return false
  }
  function isWinner(m) {
    const role = subjectRole(m)
    if (role) return role === 'winner'
    return false
  }
  function subjectRole(m) {
    const entries = (m.pointsAwarded && Array.isArray(m.pointsAwarded.entries)) ? m.pointsAwarded.entries : []
    if (entries.some(e => e.memberId === memberId && e.role === 'winner')) return 'winner'
    if (entries.some(e => e.memberId === memberId && e.role === 'loser')) return 'loser'
    if (includesMember(m.winner) || includesMember(m.winnerId) || includesMember(m.winnerIds)) return 'winner'
    if (includesMember(m.loser) || includesMember(m.loserId) || includesMember(m.loserIds)) return 'loser'
    return null
  }

  return {
    pending: pendingRows.map(m => ({
      matchId: m._id,
      tournamentId: m.tournamentId,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      position: m.position,
      scheduledStart: m.scheduledStart || null,
      courtName: m.courtName || '',
      p1: m.player1 || {},
      p2: m.player2 || {},
      opponentLabel: opponentLabel(m),
      partnerLabel: partnerLabel(m),
      isDoubles: !!(m.player1 && m.player1.partnerName),
    })),
    submitted: submittedRows.map(m => ({
      matchId: m._id,
      tournamentId: m.tournamentId,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      score: m.score,
      scoreLabel: scoreLabel(m.score, m),
      submittedAt: m.submittedAt,
      opponentLabel: opponentLabel(m),
    })),
    confirmed: confirmedRows.map(m => ({
      matchId: m._id,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      score: m.score,
      scoreLabel: scoreLabel(m.score, m),
      isWinner: isWinner(m),
      pointsEarned: sumPoints(m.pointsAwarded),
      confirmedAt: m.confirmedAt,
    })),
    registrations: activeRegistrations.map(registration => {
      const tournament = tMap[registration.tournamentId] || { _id: registration.tournamentId }
      const withdrawDeadline = getWithdrawDeadline(tournament)
      const withdrawable = canWithdraw(tournament, { now: nowValue })
      return {
        tournamentId: registration.tournamentId,
        tournamentName: tournament.name || registration.tournamentId,
        phase: derivePhase(tournament, { now: nowValue }),
        statusLabel: withdrawable ? '可退出' : '已报名',
        withdrawDeadlineLabel: withdrawDeadline.label,
        canWithdraw: withdrawable,
      }
    }),
  }
}

module.exports = { mySummary }
