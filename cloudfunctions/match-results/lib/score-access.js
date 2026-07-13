const GROUP_KNOCKOUT_PHASES = new Set([
  'group_draft',
  'group_published',
  'group_completed',
  'knockout_published',
  'completed'
])

const GROUP_KNOCKOUT_SCORE_VISIBLE_PHASES = new Set([
  'group_published',
  'group_completed',
  'knockout_published',
  'completed'
])

const SETTLED_LIFECYCLE_STATUSES = new Set(['completed', 'settled'])

function normalizeGroupKnockoutPhase(value) {
  if (typeof value !== 'string') return ''
  const phase = value.trim()
  return GROUP_KNOCKOUT_PHASES.has(phase) ? phase : ''
}

function resolveGroupKnockoutPhase(tournament) {
  const safeTournament = tournament || {}
  if (safeTournament.status === 'draft') return 'group_draft'
  const storedPhase = normalizeGroupKnockoutPhase(safeTournament.groupKnockoutPhase)
  if (storedPhase) return storedPhase
  if (SETTLED_LIFECYCLE_STATUSES.has(safeTournament.status)) return 'completed'
  return 'group_draft'
}

function canExposeScoreRows(tournament) {
  if (!tournament) return false
  if (tournament.format === 'group_knockout') {
    return GROUP_KNOCKOUT_SCORE_VISIBLE_PHASES.has(resolveGroupKnockoutPhase(tournament))
  }
  if (tournament.scheduleStatus === 'published') return true
  return !Object.prototype.hasOwnProperty.call(tournament, 'scheduleStatus')
}

function canWriteScoreRows(tournament) {
  if (!tournament) return false
  if (tournament.format === 'group_knockout') {
    if (tournament.status === 'draft' || isGroupKnockoutReadOnly(tournament)) return false
    const storedPhase = normalizeGroupKnockoutPhase(tournament.groupKnockoutPhase)
    return GROUP_KNOCKOUT_SCORE_VISIBLE_PHASES.has(storedPhase)
  }
  return canExposeScoreRows(tournament)
}

function isGroupKnockoutReadOnly(tournament) {
  return !!(tournament && tournament.format === 'group_knockout' && tournament.status === 'cancelled')
}

module.exports = {
  normalizeGroupKnockoutPhase,
  resolveGroupKnockoutPhase,
  canExposeScoreRows,
  canWriteScoreRows,
  isGroupKnockoutReadOnly
}
