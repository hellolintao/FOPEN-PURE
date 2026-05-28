const {
  PHASE,
  derivePhase,
  getWithdrawDeadline,
  canRegister,
  canWithdraw
} = require('../tournament-phase')

describe('derivePhase', () => {
  test('legacy tournament keeps old status path', () => {
    expect(derivePhase({ status: 'upcoming' }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.LEGACY)
  })

  test('cancelled tournament with registration fields stays on legacy status path', () => {
    expect(derivePhase({
      status: 'cancelled',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.LEGACY)
  })

  test('registration open when published and deadline is in the future', () => {
    expect(derivePhase({
      status: 'draft',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.REGISTRATION_OPEN)
  })

  test('pending schedule after registration deadline', () => {
    expect(derivePhase({
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.PENDING_SCHEDULE)
  })

  test('schedule draft outranks future registration deadline', () => {
    expect(derivePhase({
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'draft'
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.SCHEDULE_DRAFT)
  })

  test('published schedule with all results confirmed becomes results phase', () => {
    expect(derivePhase({
      scheduleStatus: 'published',
      resultSummary: { playableCount: 2, confirmedCount: 2 }
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.RESULTS)
  })
})

describe('withdraw deadline', () => {
  test('May 24 match is withdrawable before May 24 00:00 local time', () => {
    const tournament = { startDate: '2026-05-24' }

    expect(getWithdrawDeadline(tournament).label).toBe('5月23日 24:00')
    expect(getWithdrawDeadline(tournament).timestamp).toBe(Date.parse('2026-05-24T00:00:00+08:00'))
    expect(canWithdraw(tournament, { now: '2026-05-23T23:59:59+08:00' })).toBe(true)
    expect(canWithdraw(tournament, { now: '2026-05-24T00:00:00+08:00' })).toBe(false)
  })
})

describe('registration guards', () => {
  test('group knockout self registration respects bracketSize capacity', () => {
    const tournament = {
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      registrationPublishedAt: '2026-05-01T00:00:00.000Z',
      registrationDeadlineAt: '2026-06-01T00:00:00.000Z'
    }
    expect(canRegister(tournament, { now: new Date('2026-05-02T00:00:00.000Z'), confirmedCount: 16 })).toEqual({ ok: false, code: 'CAPACITY_FULL' })
    expect(canRegister(tournament, { now: new Date('2026-05-02T00:00:00.000Z'), confirmedCount: 15 })).toEqual({ ok: true })
  })

  test('cancelled tournament blocks registration even with registration fields', () => {
    expect(canRegister({
      status: 'cancelled',
      format: 'regular',
      type: 'singles',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toEqual({ ok: false, code: 'REGISTRATION_CLOSED' })
  })
})
