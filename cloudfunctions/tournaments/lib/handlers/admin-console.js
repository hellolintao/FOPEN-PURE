const { PHASE, derivePhase, isActiveRegistration } = require('../../../_shared/tournament-phase')

const SLOT_GAMES_FACTOR = 2

async function adminConsoleSnapshot(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  try {
    const [pending, drafts, ongoing, workbenchTournaments] = await Promise.all([
      ctx.db.aggregateSubmitted(),
      ctx.db.listDrafts(ctx.callerMemberId),
      ctx.db.listOngoing(),
      ctx.db.listWorkbenchTournaments ? ctx.db.listWorkbenchTournaments() : [],
    ])
    const total = pending.reduce((s, p) => s + (p.count || 0), 0)
    const groups = await buildWorkbenchGroups(ctx, workbenchTournaments)
    return {
      pendingConfirm: { total, byTournament: pending },
      myDrafts: drafts,
      ongoing,
      ...groups,
    }
  } catch (e) {
    const err = new Error('SNAPSHOT_FAILED')
    err.code = 'SNAPSHOT_FAILED'
    err.cause = e.message
    throw err
  }
}

async function buildWorkbenchGroups(ctx, tournaments) {
  const groups = {
    registrationOpen: [],
    pendingSchedule: [],
    scheduleDrafts: [],
    scheduleRevisions: [],
  }
  const now = ctx.now ? ctx.now() : new Date()
  const entries = []

  for (const tournament of tournaments || []) {
    if (!tournament || !tournament._id) continue
    if (tournament.scheduleNeedsRevision) {
      entries.push({ tournament, needsRevision: true })
      continue
    }

    const phase = derivePhase(tournament, { now })
    entries.push({ tournament, phase })
  }

  const activeCountMap = await loadActiveCountMap(ctx, entries
    .filter(entry => entry && !entry.needsRevision && needsLiveActiveCount(entry.tournament, entry.phase))
    .map(entry => entry.tournament._id))

  for (const entry of entries) {
    if (entry.needsRevision) {
      groups.scheduleRevisions.push(await decorateScheduleRevision(ctx, entry.tournament))
    } else if (entry.phase === PHASE.REGISTRATION_OPEN) {
      groups.registrationOpen.push(await decorateRegistrationOpen(ctx, entry.tournament, activeCountMap))
    } else if (entry.phase === PHASE.PENDING_SCHEDULE) {
      groups.pendingSchedule.push(await decoratePendingSchedule(ctx, entry.tournament, activeCountMap))
    } else if (entry.phase === PHASE.SCHEDULE_DRAFT) {
      groups.scheduleDrafts.push(decorateScheduleDraft(entry.tournament))
    }
  }

  return groups
}

async function decorateRegistrationOpen(ctx, tournament, activeCountMap) {
  const confirmed = await resolveConfirmedCount(ctx, tournament, activeCountMap)
  return {
    ...baseTournament(tournament),
    phase: PHASE.REGISTRATION_OPEN,
    statusLabel: '报名中',
    confirmedCount: confirmed.display,
    playerCount: confirmed.display,
    deadlineText: formatDateTimeLabel(tournament.registrationDeadlineAt),
    capacityWarning: hasCapacityWarning(tournament, confirmed.display),
  }
}

async function decoratePendingSchedule(ctx, tournament, activeCountMap) {
  const confirmed = await resolveConfirmedCount(ctx, tournament, activeCountMap)
  return {
    ...baseTournament(tournament),
    phase: PHASE.PENDING_SCHEDULE,
    statusLabel: '待排程',
    playerCount: confirmed.display,
    capacityWarning: hasCapacityWarning(tournament, confirmed.display),
  }
}

function decorateScheduleDraft(tournament) {
  return {
    ...baseTournament(tournament),
    phase: PHASE.SCHEDULE_DRAFT,
    statusLabel: '赛程草稿',
    playerCount: numericOrZero(tournament.confirmedCount, tournament.playerCount),
    scheduledCount: countScheduledItems(tournament.schedulePlan || tournament.courtTimeGrid),
  }
}

async function decorateScheduleRevision(ctx, tournament) {
  return {
    ...baseTournament(tournament),
    phase: PHASE.SCHEDULE_PUBLISHED,
    statusLabel: '赛程需调整',
    affectedCount: await countScheduleRevisionAffected(ctx, tournament),
  }
}

function baseTournament(tournament) {
  return {
    tournamentId: tournament._id,
    tournamentName: tournament.name || tournament._id,
    name: tournament.name || tournament._id,
    format: tournament.format || 'regular',
    type: tournament.type || 'singles',
  }
}

async function resolveConfirmedCount(ctx, tournament, activeCountMap) {
  const stored = finiteNumber(tournament.confirmedCount)
  if (stored !== null) return { stored, display: stored }
  const mapped = activeCountMap ? finiteNumber(activeCountMap[tournament._id]) : null
  if (mapped !== null) return { stored: null, display: mapped }
  if (ctx.db.listRegistrations) {
    const registrations = await ctx.db.listRegistrations(tournament._id)
    if (Array.isArray(registrations) && registrations.length > 0) {
      return { stored: null, display: registrations.filter(isActiveRegistration).length }
    }
  }
  const live = ctx.db.countConfirmedRegistrations
    ? await ctx.db.countConfirmedRegistrations(tournament._id)
    : 0
  return { stored: null, display: numericOrZero(live) }
}

async function loadActiveCountMap(ctx, tournamentIds) {
  const ids = [...new Set((tournamentIds || []).filter(Boolean))]
  if (ids.length === 0 || !ctx.db.countActiveRegistrationsByTournamentIds) return {}
  const counts = await ctx.db.countActiveRegistrationsByTournamentIds(ids)
  return counts && typeof counts === 'object' ? counts : {}
}

function needsLiveActiveCount(tournament, phase) {
  return finiteNumber(tournament && tournament.confirmedCount) === null &&
    (phase === PHASE.REGISTRATION_OPEN || phase === PHASE.PENDING_SCHEDULE)
}

function hasCapacityWarning(tournament, confirmed) {
  const suggestedCapacity = countCourts(tournament.schedulePlan || tournament.courtTimeGrid) *
    countSlots(tournament.schedulePlan || tournament.courtTimeGrid) *
    SLOT_GAMES_FACTOR
  return tournament.format === 'regular' &&
    suggestedCapacity > 0 &&
    confirmed !== null &&
    confirmed > suggestedCapacity
}

function countCourts(plan) {
  if (!plan || typeof plan !== 'object') return 0
  if (Array.isArray(plan.courts)) return plan.courts.length
  if (Array.isArray(plan.courtIds)) return plan.courtIds.length
  return 0
}

function countSlots(plan) {
  if (!plan || typeof plan !== 'object') return 0
  const courts = Array.isArray(plan.courts) ? plan.courts : []
  const perCourt = courts.map(court => Array.isArray(court && court.slots) ? court.slots.length : 0)
  if (perCourt.length > 0) return Math.max(...perCourt)
  if (Array.isArray(plan.slots)) return plan.slots.length
  return 0
}

function countScheduledItems(plan) {
  if (!plan || typeof plan !== 'object') return 0
  const queues = Array.isArray(plan.queues) ? plan.queues : []
  if (queues.length > 0) {
    return queues.reduce((sum, queue) => {
      const items = Array.isArray(queue && queue.items) ? queue.items : []
      return sum + items.filter(item => item && item.kind !== 'freePlay').length
    }, 0)
  }
  if (Array.isArray(plan.matches)) return plan.matches.filter(match => match && !match.bye).length
  const courts = Array.isArray(plan.courts) ? plan.courts : []
  return courts.reduce((sum, court) => {
    const matches = Array.isArray(court && court.matches) ? court.matches : []
    return sum + matches.filter(match => match && !match.bye).length
  }, 0)
}

async function countScheduleRevisionAffected(ctx, tournament) {
  const embedded = finiteNumber(tournament.affectedCount, tournament.scheduleRevisionAffectedCount, tournament.revisionAffectedCount)
  if (embedded !== null) return embedded
  if (!ctx.db.countScheduleRevisionAffected) return 0
  return numericOrZero(await ctx.db.countScheduleRevisionAffected(tournament._id))
}

function formatDateTimeLabel(value) {
  if (!value) return ''
  const text = String(value)
  const parts = /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{1,2}):(\d{2})/.exec(text)
  if (parts) return `${Number(parts[2])}月${Number(parts[3])}日 ${parts[4].padStart(2, '0')}:${parts[5]}`
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function numericOrZero(...values) {
  const n = finiteNumber(...values)
  return n === null ? 0 : n
}

module.exports = { adminConsoleSnapshot }
