const STATUS_META = {
  draft: {
    kind: 'draft',
    label: '草稿',
    hint: '未发布',
    scoreActionLabel: '录入成绩',
    canShare: false
  },
  upcoming: {
    kind: 'upcoming',
    label: '待开始',
    hint: '赛程已发布',
    scoreActionLabel: '录入成绩',
    canShare: true
  },
  ongoing: {
    kind: 'ongoing',
    label: '进行中',
    hint: '赛事进行中',
    scoreActionLabel: '录入成绩',
    canShare: true
  },
  live: {
    kind: 'ongoing',
    label: '进行中',
    hint: '赛事进行中',
    scoreActionLabel: '录入成绩',
    canShare: true
  },
  ended: {
    kind: 'ended',
    label: '已结束',
    hint: '赛事时间已结束',
    scoreActionLabel: '录入成绩',
    canShare: true
  },
  completed: {
    kind: 'settled',
    label: '已结算',
    hint: '比分已确认并结算',
    scoreActionLabel: '查看成绩',
    canShare: true
  },
  settled: {
    kind: 'settled',
    label: '已结算',
    hint: '比分已确认并结算',
    scoreActionLabel: '查看成绩',
    canShare: true
  },
  cancelled: {
    kind: 'cancelled',
    label: '已取消',
    hint: '赛事已取消',
    scoreActionLabel: '查看成绩',
    canShare: false
  }
}

function getTournamentStatusMeta(input, options = {}) {
  const tournament = normalizeTournamentInput(input)
  const raw = tournament.status || 'upcoming'
  const fixedMeta = fixedLifecycleMeta(raw)
  const resultMeta = resultLifecycleMeta(tournament.resultSummary || options.resultSummary)
  const meta = fixedMeta || resultMeta || STATUS_META[deriveDateKind(tournament, options.now)] || STATUS_META[raw] || {
    kind: 'unknown',
    label: String(raw || '未知'),
    hint: '状态未识别',
    scoreActionLabel: '录入成绩',
    canShare: true
  }
  return {
    raw,
    kind: meta.kind,
    label: meta.label,
    hint: meta.hint,
    scoreActionLabel: meta.scoreActionLabel,
    canShare: meta.canShare
  }
}

function decorateTournamentStatus(tournament) {
  const meta = getTournamentStatusMeta(tournament)
  return {
    ...(tournament || {}),
    __statusRaw: meta.raw,
    __statusKind: meta.kind,
    __statusLabel: meta.label,
    __statusHint: meta.hint,
    __scoreActionLabel: meta.scoreActionLabel,
    __shareEnabled: meta.canShare
  }
}

function getTournamentShareTitle(tournament) {
  if (!tournament || !tournament.name) return 'FU OPEN 赛事'
  const meta = getTournamentStatusMeta(tournament)
  return `${tournament.name} · ${meta.label}`
}

function isCompletedStatus(input) {
  return getTournamentStatusMeta(input).kind === 'settled'
}

function normalizeTournamentInput(input) {
  if (input && typeof input === 'object' && !Array.isArray(input)) return input
  return { status: input }
}

function fixedLifecycleMeta(raw) {
  if (raw === 'draft' || raw === 'completed' || raw === 'settled' || raw === 'cancelled') {
    return STATUS_META[raw]
  }
  return null
}

function resultLifecycleMeta(summary) {
  if (!summary) return null
  const playableCount = Number(summary.playableCount || summary.totalPlayable || summary.total || 0)
  const confirmedCount = Number(summary.confirmedCount || summary.confirmed || 0)
  if (playableCount > 0 && confirmedCount >= playableCount) return STATUS_META.completed
  return null
}

function deriveDateKind(tournament, nowInput) {
  if (!tournament) return ''
  const window = extractScheduleWindow(tournament)
  if (window) {
    const now = toLocalTimestamp(nowInput || new Date())
    if (!Number.isFinite(now)) return ''
    if (now < window.start) return 'upcoming'
    if (now >= window.end) return 'ended'
    return 'ongoing'
  }
  if (!tournament.startDate) return ''
  const today = toLocalDayNumber(nowInput || new Date())
  const start = toLocalDayNumber(tournament.startDate)
  const end = toLocalDayNumber(tournament.endDate || tournament.startDate)
  if (!Number.isFinite(today) || !Number.isFinite(start) || !Number.isFinite(end)) return ''
  if (today < start) return 'upcoming'
  if (today > end) return 'ended'
  return 'ongoing'
}

function extractScheduleWindow(tournament) {
  const schedulePlanWindow = extractPlanWindow(tournament.schedulePlan, tournament.startDate)
  if (schedulePlanWindow) return schedulePlanWindow
  return extractPlanWindow(tournament.courtTimeGrid, tournament.startDate)
}

function extractPlanWindow(plan, fallbackDate) {
  if (!plan || typeof plan !== 'object') return null
  const starts = []
  collectPlanSlots(plan).forEach(slot => {
    const time = parseSlotTime(slot, fallbackDate)
    if (Number.isFinite(time)) starts.push(time)
  })
  if (starts.length === 0) return null
  const slotMinutes = toPositiveNumber(plan.slotMinutes) || 20
  const start = Math.min(...starts)
  const end = Math.max(...starts) + slotMinutes * 60 * 1000
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

function collectPlanSlots(plan) {
  const slots = []
  asArray(plan.slots).forEach(slot => slots.push(slot))
  asArray(plan.courts).forEach(court => {
    asArray(court && court.slots).forEach(slot => slots.push(slot))
  })
  return slots
}

function parseSlotTime(value, fallbackDate) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return parseSlotTime(value.startTime || value.time || value.slot || value.datetime || value.dateTime, fallbackDate)
  }
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN

  const text = String(value || '').trim()
  if (!text) return NaN
  const timeOnly = /^T?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (timeOnly) {
    const date = extractDateParts(fallbackDate)
    if (!date) return NaN
    return localTimestamp(date.year, date.month, date.day, Number(timeOnly[1]), Number(timeOnly[2]), Number(timeOnly[3] || 0))
  }
  return toLocalTimestamp(text)
}

function toLocalTimestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  const text = String(value || '').trim()
  if (!text) return NaN
  if (hasExplicitTimezone(text)) {
    const parsed = new Date(text).getTime()
    return Number.isNaN(parsed) ? NaN : parsed
  }
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text)
  if (dateTime) {
    return localTimestamp(
      Number(dateTime[1]),
      Number(dateTime[2]),
      Number(dateTime[3]),
      Number(dateTime[4] || 0),
      Number(dateTime[5] || 0),
      Number(dateTime[6] || 0)
    )
  }
  const parsed = new Date(text).getTime()
  return Number.isNaN(parsed) ? NaN : parsed
}

function extractDateParts(value) {
  if (value instanceof Date) {
    return {
      year: value.getFullYear(),
      month: value.getMonth() + 1,
      day: value.getDate()
    }
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!m) return null
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3])
  }
}

function localTimestamp(year, month, day, hour, minute, second) {
  return new Date(year, month - 1, day, hour, minute, second).getTime()
}

function hasExplicitTimezone(text) {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
}

function toPositiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function toLocalDayNumber(value) {
  if (value instanceof Date) {
    return value.getFullYear() * 10000 + (value.getMonth() + 1) * 100 + value.getDate()
  }
  const text = String(value || '')
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return NaN
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

module.exports = {
  getTournamentStatusMeta,
  decorateTournamentStatus,
  getTournamentShareTitle,
  isCompletedStatus
}
