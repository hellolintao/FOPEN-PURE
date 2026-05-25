// SOURCE OF TRUTH: cloudfunctions/_shared/tournament-phase.js
// MIRROR:          miniprogram/utils/tournament-phase.js
// Any edit must be applied to both files in the same commit; CI parity check
// (`scripts/check-tournament-phase-parity.sh`) diffs them and fails on drift.

const PHASE = {
  DRAFT: 'draft',
  REGISTRATION_OPEN: 'registration_open',
  PENDING_SCHEDULE: 'pending_schedule',
  SCHEDULE_DRAFT: 'schedule_draft',
  SCHEDULE_PUBLISHED: 'schedule_published',
  RESULTS: 'results',
  LEGACY: 'legacy'
}

function derivePhase(tournament = {}, options = {}) {
  if (tournament.status === 'cancelled') return PHASE.LEGACY
  if (isPureDraft(tournament)) return PHASE.DRAFT
  if (tournament.scheduleStatus === 'published' && hasSettledResults(tournament, options)) return PHASE.RESULTS
  if (tournament.status === 'completed' || tournament.status === 'settled') return PHASE.RESULTS
  if (tournament.scheduleStatus === 'published') return PHASE.SCHEDULE_PUBLISHED
  if (tournament.scheduleStatus === 'draft') return PHASE.SCHEDULE_DRAFT
  if (tournament.registrationPublishedAt && tournament.registrationDeadlineAt) {
    return toTime(options.now || new Date()) < toTime(tournament.registrationDeadlineAt)
      ? PHASE.REGISTRATION_OPEN
      : PHASE.PENDING_SCHEDULE
  }
  if (tournament.status === 'draft') return PHASE.DRAFT
  return PHASE.LEGACY
}

function isPureDraft(tournament = {}) {
  return tournament.status === 'draft' &&
    !tournament.registrationPublishedAt &&
    !tournament.registrationDeadlineAt &&
    !tournament.scheduleStatus &&
    !tournament.schedulePublishedAt &&
    !tournament.schedulePlan &&
    !tournament.courtTimeGrid
}

function hasSettledResults(tournament = {}, options = {}) {
  const summary = options.resultSummary || tournament.resultSummary || {}
  const playable = Number(summary.playableCount || summary.totalPlayable || summary.total || 0)
  const confirmed = Number(summary.confirmedCount || summary.confirmed || 0)
  return playable > 0 && confirmed >= playable
}

function getWithdrawDeadline(tournament = {}) {
  const date = String(tournament.startDate || '').slice(0, 10)
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!parts) return { timestamp: NaN, label: '' }

  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const timestamp = Date.UTC(year, month - 1, day, -8, 0, 0, 0)
  const previous = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000)

  return {
    timestamp,
    label: `${previous.getUTCMonth() + 1}月${previous.getUTCDate()}日 24:00`
  }
}

function canWithdraw(tournament, options = {}) {
  const deadline = getWithdrawDeadline(tournament)
  if (!Number.isFinite(deadline.timestamp)) return false
  return toTime(options.now || new Date()) < deadline.timestamp
}

function canRegister(tournament = {}, options = {}) {
  if (derivePhase(tournament, options) !== PHASE.REGISTRATION_OPEN) {
    return { ok: false, code: 'REGISTRATION_CLOSED' }
  }
  if (tournament.format === 'knockout' && tournament.type === 'singles') {
    const max = Number(tournament.maxPlayers || 0)
    const confirmed = Number(options.confirmedCount === undefined ? tournament.confirmedCount : options.confirmedCount)
    if (max > 0 && confirmed >= max) return { ok: false, code: 'CAPACITY_FULL' }
  }
  if (tournament.format === 'knockout' && tournament.type === 'doubles') {
    return { ok: false, code: 'SELF_REGISTRATION_UNSUPPORTED' }
  }
  return { ok: true }
}

function isActiveRegistration(registration = {}) {
  const status = registration.registrationStatus || registration.status || 'confirmed'
  return status !== 'withdrew' && status !== 'cancelled'
}

function toTime(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return new Date(value).getTime()
}

module.exports = {
  PHASE,
  derivePhase,
  getWithdrawDeadline,
  canWithdraw,
  canRegister,
  isActiveRegistration
}
