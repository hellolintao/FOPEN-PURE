// query handlers: submittedQueue / listByTournament / listByPlayer / pendingReviewItems
async function submittedQueue(ctx, event) {
  if (!ctx.isAdmin) {
    const err = new Error('需要管理员权限')
    err.code = 'UNAUTHORIZED'
    throw err
  }
  const rows = await ctx.db.pagedFetchSubmitted()
  if (rows.length === 0) return { items: [] }
  const grouped = {}
  for (const r of rows) grouped[r.tournamentId] = (grouped[r.tournamentId] || 0) + 1
  const tournamentIds = Object.keys(grouped)
  const tournaments = await ctx.db.getTournamentsByIds(tournamentIds)
  const tMap = Object.fromEntries(tournaments.map(t => [t._id, t]))
  return {
    items: tournamentIds.map(tid => ({
      tournamentId: tid,
      tournamentName: tMap[tid] && tMap[tid].name ? tMap[tid].name : tid,
      submittedCount: grouped[tid]
    }))
  }
}

function canExposeScoreRows(tournament) {
  if (!tournament) return false
  if (tournament.scheduleStatus === 'published') return true
  if (!Object.prototype.hasOwnProperty.call(tournament, 'scheduleStatus')) return true
  return false
}

async function listByTournament(ctx, event) {
  if (!event.tournamentId) {
    const err = new Error('tournamentId 必填')
    err.code = 'INVALID_ARG'
    throw err
  }
  const tournament = await ctx.db.getTournament(event.tournamentId)
  if (!canExposeScoreRows(tournament)) return { results: [] }
  const results = await ctx.db.listByTournament(event.tournamentId)
  return { results }
}

async function listByPlayer(ctx, event) {
  if (!event.memberId) {
    const err = new Error('memberId 必填')
    err.code = 'INVALID_ARG'
    throw err
  }
  const matches = await ctx.db.listByPlayerNotConfirmed(event.memberId)
  return { matches }
}

async function pendingReviewItems(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const tournamentId = (payload && payload.tournamentId) || null
  const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 50, 1), 100)

  const total = await ctx.db.countMatchResults({ resultStatus: 'submitted', tournamentId })
  const rows = await ctx.db.queryMatchResults({ resultStatus: 'submitted', tournamentId, limit })

  const tournamentIds = [...new Set(rows.map(r => r.tournamentId))]
  const tournamentDocs = await ctx.db.getTournamentsByIds(tournamentIds)
  const tMap = Object.fromEntries(tournamentDocs.map(t => [t._id, t]))

  const submitterIds = [...new Set(rows.map(r => r.submittedBy).filter(Boolean))]
  const memberDocs = submitterIds.length ? await ctx.db.getMembersByIds(submitterIds) : []
  const mMap = Object.fromEntries(memberDocs.map(m => [m._id, m]))

  const items = rows.map(r => ({
    matchId: r._id,
    tournamentId: r.tournamentId,
    tournamentName: tMap[r.tournamentId] && tMap[r.tournamentId].name || r.tournamentId,
    round: r.round,
    position: r.position,
    scheduledStartLabel: r.scheduledStart ? formatTime(r.scheduledStart) : '',
    courtName: r.courtName || '',
    p1: r.player1 || {},
    p2: r.player2 || {},
    score: r.score || null,
    isDoubles: !!(r.player1 && r.player1.partnerName),
    submitter: r.submittedBy && mMap[r.submittedBy]
      ? { memberId: r.submittedBy, name: mMap[r.submittedBy].name }
      : null,
    submittedAt: r.submittedAt || null,
    updateTime: r.updateTime,
  }))

  return { items, truncated: total > limit }
}

async function pendingEntryGroups(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const tournamentId = (payload && payload.tournamentId) || null
  const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 50, 1), 200)

  const total = await ctx.db.countMatchResults({ resultStatus: 'pending', tournamentId })
  const rows = await ctx.db.queryMatchResults({ resultStatus: 'pending', tournamentId, limit })
  const playableRows = rows.filter(isPlayablePending)

  const tournamentIds = [...new Set(playableRows.map(r => r.tournamentId).filter(Boolean))]
  const tournamentDocs = await ctx.db.getTournamentsByIds(tournamentIds)
  const tMap = Object.fromEntries(tournamentDocs.map(t => [t._id, t]))

  const grouped = new Map()
  for (const row of playableRows) {
    const tournament = tMap[row.tournamentId]
    if (!tournament || isClosedTournament(tournament)) continue

    const round = row.round || 1
    const groupId = `${row.tournamentId}:${round}`
    if (!grouped.has(groupId)) {
      grouped.set(groupId, {
        _id: groupId,
        tournamentId: row.tournamentId,
        tournamentName: tournament.name || row.tournamentId,
        seasonName: tournament.seasonName || '',
        format: tournament.format || 'regular',
        round,
        updateTime: row.updateTime || row.createTime || null,
        matches: [],
      })
    }
    const group = grouped.get(groupId)
    group.matches.push({
      matchId: row.sourceMatchId || row.matchId || row._id,
      resultId: row._id,
      sourceMatchId: row.sourceMatchId || row.matchId || '',
      resultStatus: row.resultStatus,
      round: row.round,
      position: row.position,
      player1: row.player1 || {},
      player2: row.player2 || {},
      updateTime: row.updateTime || null,
    })
    const rowTime = row.updateTime || row.createTime
    if (isAfter(rowTime, group.updateTime)) group.updateTime = rowTime
  }

  const groups = [...grouped.values()]
    .map(group => ({
      ...group,
      matches: group.matches.sort((a, b) => (a.position || 0) - (b.position || 0)),
    }))
    .sort((a, b) => timeValue(b.updateTime) - timeValue(a.updateTime))

  return { groups, truncated: total > limit }
}

function isPlayablePending(row) {
  if (!row || row.bye || row.resultStatus !== 'pending') return false
  return !!(row.player1 && row.player2 && row.player1.id && row.player2.id)
}

function isClosedTournament(tournament) {
  return ['completed', 'cancelled', 'deleted'].includes(tournament && tournament.status)
}

function timeValue(value) {
  if (!value) return 0
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

function isAfter(candidate, current) {
  return timeValue(candidate) > timeValue(current)
}

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

module.exports = {
  submittedQueue,
  listByTournament,
  listByPlayer,
  pendingReviewItems,
  pendingEntryGroups,
  canExposeScoreRows,
  __test__: {
    canExposeScoreRows,
    listByTournamentWithCtx: listByTournament,
  },
}
