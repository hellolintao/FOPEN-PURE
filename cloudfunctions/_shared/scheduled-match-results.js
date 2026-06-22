const { stripUndefined } = require('./sanitize')

function createScheduledMatchResultService({ db, command }) {
  const _ = command || (db && db.command) || {}
  const collection = db.collection('match_results')

  async function upsertScheduledMatches({ tournamentId, matches, queues }) {
    try {
      if (!tournamentId) {
        return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
      }
      if (!Array.isArray(matches)) {
        return { success: false, error: { code: 'INVALID_ARG', message: 'matches 必须是数组' } }
      }

      const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
      const tournament = tournamentRes && tournamentRes.data
      if (!tournament) {
        return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }
      }

      const queueMap = new Map()
      for (const q of (queues || [])) {
        if (!Array.isArray(q.items)) continue
        for (const item of q.items) {
          if (item.kind === 'match') {
            queueMap.set(item.matchId, { courtId: q.courtId, queueOrder: item.order })
          }
        }
      }

      const seen = new Set()
      const now = db.serverDate()
      const prefix = tournamentId.replace('tournament_', '')

      for (const m of matches) {
        const docId = `result_${prefix}_${m.matchId}`
        seen.add(docId)
        const isBye = m.bye === true
        const q = queueMap.get(m.matchId)
        const matchType = resolveMatchType(m, tournament)
        const playerIds = collectPlayerIds(m, matchType)
        const doc = {
          _id: docId,
          tournamentId,
          seasonId: tournament.seasonId,
          tournamentType: matchType,
          matchKind: m.matchKind || 'bracket',
          sourceMatchId: m.matchId,
          round: m.round,
          position: m.position,
          player1: m.player1,
          player2: m.player2,
          playerIds,
          courtId: isBye ? null : (q ? q.courtId : null),
          queueOrder: isBye ? null : (q ? q.queueOrder : null),
          score: null,
          resultStatus: isBye ? 'confirmed' : 'pending',
          winner: isBye ? m.winner : null,
          winnerId: isBye && m.winner ? m.winner.id : null,
          loserId: null,
          confirmedBy: null,
          confirmedAt: null,
          pointsAwarded: isBye ? { source: 'match', entries: [] } : null,
          updateTime: now
        }
        await upsertDoc(docId, doc, now)
      }

      const skeletonRes = await db.collection('tournament_brackets')
        .where({ tournamentId, round: _.gt(1) })
        .get()
        .catch(() => ({ data: [] }))
      for (const bracket of (skeletonRes.data || [])) {
        for (const m of (bracket.matches || [])) {
          const docId = `result_${prefix}_${m.matchId}`
          if (seen.has(docId)) continue
          seen.add(docId)
          const matchType = resolveMatchType(m, tournament)
          const playerIds = collectPlayerIds(m, matchType)
          const doc = {
            _id: docId,
            tournamentId,
            seasonId: tournament.seasonId,
            tournamentType: matchType,
            matchKind: 'bracket',
            sourceMatchId: m.matchId,
            round: m.round,
            position: m.position,
            player1: m.player1 || null,
            player2: m.player2 || null,
            playerIds,
            courtId: null,
            queueOrder: null,
            score: null,
            resultStatus: 'pending',
            winner: m.winner || null,
            winnerId: m.winner ? m.winner.id : null,
            loserId: null,
            confirmedBy: null,
            confirmedAt: null,
            pointsAwarded: null,
            updateTime: now
          }
          await upsertDoc(docId, doc, now)
        }
      }

      const orphanRes = await collection.where({
        tournamentId,
        matchKind: _.in(['bracket', 'regularRound', 'extra'])
      }).get().catch(() => ({ data: [] }))
      for (const doc of (orphanRes.data || [])) {
        if (shouldRemoveOrphanMatchDoc(doc, seen)) {
          await collection.doc(doc._id).remove().catch(() => null)
        }
      }

      return { success: true, data: { count: seen.size } }
    } catch (e) {
      return { success: false, error: { code: e.code || 'INTERNAL', message: e.message } }
    }
  }

  async function upsertDoc(docId, doc, now) {
    const existingRes = await collection.doc(docId).get().catch(() => null)
    const existing = existingRes && existingRes.data
    if (existing) {
      const updateData = stripUndefined(mergeScheduledMatchDoc(existing, doc))
      delete updateData._id
      await collection.doc(docId).update({ data: updateData })
    } else {
      await collection.add({ data: stripUndefined({ ...doc, createTime: now }) })
    }
  }

  return { upsertScheduledMatches }
}

function resolveMatchType(match, tournamentOrType) {
  const fallback = typeof tournamentOrType === 'string'
    ? tournamentOrType
    : (tournamentOrType && tournamentOrType.type)
  return (match && (match.type || match.tournamentType)) || fallback || 'singles'
}

function collectPlayerIds(m, tournamentOrType) {
  const type = resolveMatchType(m, tournamentOrType)
  const ids = []
  const push = obj => {
    if (obj && obj.id && obj.id !== 'BYE') {
      ids.push(obj.id)
      if (type === 'doubles' && obj.partnerId) ids.push(obj.partnerId)
    }
  }
  push(m.player1)
  push(m.player2)
  return ids
}

function mergeScheduledMatchDoc(existing, scheduled) {
  const merged = { ...scheduled, createTime: existing && existing.createTime }
  if (!existing || !isActiveScoreRow(existing)) return merged
  if (!hasPreservableScoreState(existing)) return merged
  if (!hasSameResultIdentity(existing, scheduled)) {
    const err = new Error('赛程变更影响已确认成绩，请先清空比分并重新发布')
    err.code = 'SCHEDULE_IMPACT_REQUIRES_INVALIDATION'
    throw err
  }
  return {
    ...merged,
    score: existing.score,
    scoreDetail: existing.scoreDetail,
    resultStatus: existing.resultStatus,
    status: existing.status || merged.status,
    winner: existing.winner,
    winnerId: existing.winnerId,
    loserId: existing.loserId,
    confirmedBy: existing.confirmedBy,
    confirmedAt: existing.confirmedAt,
    pointsAwarded: existing.pointsAwarded
  }
}

function shouldRemoveOrphanMatchDoc(doc, seen) {
  if (!doc || !doc._id || seen.has(doc._id)) return false
  if (doc.matchKind === 'history' || doc.archivedFrom || doc.resultStatus === 'invalidated') return false
  return true
}

function hasPreservableScoreState(row) {
  return row && ['submitted', 'confirmed'].includes(row.resultStatus)
}

function hasSameResultIdentity(existing, scheduled) {
  return resultIdentityKey(existing) === resultIdentityKey(scheduled)
}

function resultIdentityKey(row) {
  if (!row) return ''
  return [
    row.sourceMatchId || row.matchId || row._id || '',
    playerIdentityKey(row.player1),
    playerIdentityKey(row.player2)
  ].join('|')
}

function playerIdentityKey(player) {
  if (!player) return ''
  return [
    player.id || '',
    player.partnerId || '',
    player.sourceMatchId || player.fromMatchId || '',
    player.name || '',
    player.partnerName || ''
  ].join(':')
}

function isActiveScoreRow(row) {
  if (!row) return false
  if (row.resultStatus === 'invalidated') return false
  if (row.matchKind === 'history' || row.matchKind === 'audit') return false
  if (row.archivedFrom) return false
  return true
}

module.exports = {
  createScheduledMatchResultService,
  resolveMatchType,
  collectPlayerIds,
  mergeScheduledMatchDoc
}
