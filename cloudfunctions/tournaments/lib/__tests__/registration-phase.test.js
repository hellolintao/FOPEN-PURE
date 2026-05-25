const mockCloudCallFunction = jest.fn()
const mockBracketGet = jest.fn()
const mockDb = {
  command: {
    set: value => value,
    or: conditions => ({ $or: conditions })
  },
  serverDate: jest.fn(() => 'SERVER_DATE'),
  collection: jest.fn((name) => {
    if (name === 'tournament_brackets') {
      return {
        doc: jest.fn(() => ({ get: mockBracketGet }))
      }
    }
    return {
      doc: jest.fn(() => ({
        get: jest.fn(),
        update: jest.fn()
      })),
      where: jest.fn(() => ({
        count: jest.fn().mockResolvedValue({ total: 0 })
      }))
    }
  })
}

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test-env',
  database: jest.fn(() => mockDb),
  getWXContext: jest.fn(() => ({ OPENID: '' })),
  callFunction: mockCloudCallFunction
}))

const {
  publishRegistration,
  saveScheduleDraft,
  publishSchedule,
  confirmScheduleRevision
} = require('../handlers/registration-phase')
const { __test__ } = require('../../index')

function makeCtx(tournament = {}) {
  const updates = []
  return {
    now: () => '2026-05-21T12:00:00.000Z',
    isAdmin: true,
    db: {
      getTournament: jest.fn().mockResolvedValue({
        _id: 't1',
        startDate: '2026-05-25',
        ...tournament
      }),
      countConfirmedRegistrations: jest.fn().mockResolvedValue(3),
      updateTournament: jest.fn(async (id, data) => {
        updates.push({ id, data })
      }),
      bulkUpsertScheduledMatches: jest.fn().mockResolvedValue({ success: true, data: { count: 4 } })
    },
    updates
  }
}

test('publishRegistration writes deadline, published timestamp, none schedule status and confirmedCount', async () => {
  const ctx = makeCtx()

  const res = await publishRegistration(ctx, {
    id: 't1',
    registrationDeadlineAt: '2026-05-24T18:00:00+08:00'
  })

  expect(res).toEqual({ success: true, data: { id: 't1', confirmedCount: 3 } })
  expect(ctx.db.getTournament).toHaveBeenCalledWith('t1')
  expect(ctx.db.countConfirmedRegistrations).toHaveBeenCalledWith('t1')
  expect(ctx.updates[0]).toMatchObject({
    id: 't1',
    data: {
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      registrationPublishedAt: '2026-05-21T12:00:00.000Z',
      scheduleStatus: 'none',
      scheduleNeedsRevision: false,
      confirmedCount: 3
    }
  })
})

test('publishRegistration rejects past deadline before update', async () => {
  const ctx = makeCtx()

  const res = await publishRegistration(ctx, {
    id: 't1',
    registrationDeadlineAt: '2026-05-20T18:00:00+08:00'
  })

  expect(res.success).toBe(false)
  expect(res.error.code).toBe('INVALID_DEADLINE')
  expect(ctx.db.updateTournament).not.toHaveBeenCalled()
  expect(ctx.db.countConfirmedRegistrations).not.toHaveBeenCalled()
})

test('saveScheduleDraft writes draft status', async () => {
  const ctx = makeCtx()

  const res = await saveScheduleDraft(ctx, {
    id: 't1',
    schedulePlan: { courts: [] }
  })

  expect(res).toEqual({ success: true, data: { id: 't1' } })
  expect(ctx.updates[0].data).toMatchObject({
    scheduleStatus: 'draft',
    schedulePlan: { courts: [] }
  })
})

test('publishSchedule writes published status, clears revision signal, and generates score rows first', async () => {
  const schedulePlan = { courts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }] }
  const ctx = makeCtx({ scheduleNeedsRevision: true, schedulePlan })
  ctx.db.bulkUpsertScheduledMatches = jest.fn(async () => {
    expect(ctx.db.updateTournament).not.toHaveBeenCalled()
    return { success: true, data: { count: 4 } }
  })

  const res = await publishSchedule(ctx, { id: 't1' })

  expect(res.success).toBe(true)
  expect(ctx.db.bulkUpsertScheduledMatches).toHaveBeenCalledWith('t1', schedulePlan)
  expect(ctx.updates[0].data).toMatchObject({
    scheduleStatus: 'published',
    schedulePublishedAt: '2026-05-21T12:00:00.000Z',
    status: 'upcoming',
    scheduleNeedsRevision: false
  })
})

test('publishSchedule rejects missing or empty schedule before bulk upsert', async () => {
  const ctx = makeCtx({ schedulePlan: { courts: [] } })

  const res = await publishSchedule(ctx, { id: 't1' })

  expect(res.success).toBe(false)
  expect(res.error.code).toBe('EMPTY_SCHEDULE')
  expect(ctx.db.bulkUpsertScheduledMatches).not.toHaveBeenCalled()
  expect(ctx.db.updateTournament).not.toHaveBeenCalled()
})

test('publishSchedule returns bulk error and does not mark published', async () => {
  const schedulePlan = { courts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }] }
  const ctx = makeCtx({ schedulePlan })
  ctx.db.bulkUpsertScheduledMatches = jest.fn().mockResolvedValue({
    success: false,
    error: { message: 'bulk failed' }
  })

  const res = await publishSchedule(ctx, { id: 't1' })

  expect(res.success).toBe(false)
  expect(res.error.code).toBe('BULK_UPSERT_FAILED')
  expect(ctx.db.updateTournament).not.toHaveBeenCalled()
})

test('publishSchedule treats thrown bulk upsert as failed and does not mark published', async () => {
  const schedulePlan = { courts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }] }
  const ctx = makeCtx({ schedulePlan })
  ctx.db.bulkUpsertScheduledMatches = jest.fn().mockRejectedValue(new Error('network failed'))

  const res = await publishSchedule(ctx, { id: 't1' })

  expect(res.success).toBe(false)
  expect(res.error.code).toBe('BULK_UPSERT_FAILED')
  expect(ctx.db.updateTournament).not.toHaveBeenCalled()
})

test('confirmScheduleRevision clears flag', async () => {
  const ctx = makeCtx({ scheduleNeedsRevision: true })

  const res = await confirmScheduleRevision(ctx, { id: 't1' })

  expect(res).toEqual({ success: true, data: { id: 't1' } })
  expect(ctx.updates[0].data).toMatchObject({ scheduleNeedsRevision: false })
})

describe('buildRegistrationPhaseCtx bulk upsert bridge', () => {
  beforeEach(() => {
    mockCloudCallFunction.mockReset()
    mockBracketGet.mockReset()
  })

  test('passes schedulePlan.matches and queues to match-results without schedulePlan', async () => {
    const matches = [{ matchId: 'm1', round: 1, position: 1 }]
    const queues = [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 1 }] }]
    const ctx = __test__.buildRegistrationPhaseCtx({ _id: 'memberA', openid: 'openA', admin: true })
    mockCloudCallFunction.mockResolvedValue({ result: { success: true, data: { count: 1 } } })

    const res = await ctx.db.bulkUpsertScheduledMatches('tournament_1', { matches, queues })

    expect(res).toEqual({ success: true, data: { count: 1 } })
    expect(mockCloudCallFunction).toHaveBeenCalledWith({
      name: 'match-results',
      data: {
        action: 'bulkUpsertScheduledMatches',
        tournamentId: 'tournament_1',
        matches,
        queues
      }
    })
    expect(mockCloudCallFunction.mock.calls[0][0].data).not.toHaveProperty('schedulePlan')
  })

  test('loads round one bracket matches when current schedulePlan only stores queues', async () => {
    const matches = [{ matchId: 'm1', round: 1, position: 1 }]
    const queues = [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 1 }] }]
    const ctx = __test__.buildRegistrationPhaseCtx({ _id: 'memberA', openid: 'openA', admin: true })
    mockBracketGet.mockResolvedValue({ data: { matches } })
    mockCloudCallFunction.mockResolvedValue({ result: { success: true, data: { count: 1 } } })

    const res = await ctx.db.bulkUpsertScheduledMatches('tournament_1', { queues })

    expect(res).toEqual({ success: true, data: { count: 1 } })
    expect(mockCloudCallFunction.mock.calls[0][0].data).toMatchObject({
      action: 'bulkUpsertScheduledMatches',
      tournamentId: 'tournament_1',
      matches,
      queues
    })
    expect(mockCloudCallFunction.mock.calls[0][0].data).not.toHaveProperty('schedulePlan')
  })

  test('returns precise error before match-results when no matches can be found', async () => {
    const ctx = __test__.buildRegistrationPhaseCtx({ _id: 'memberA', openid: 'openA', admin: true })
    mockBracketGet.mockResolvedValue({ data: { matches: [] } })

    const res = await ctx.db.bulkUpsertScheduledMatches('tournament_1', { queues: [] })

    expect(res).toEqual({
      success: false,
      error: {
        code: 'MISSING_MATCHES',
        message: '排程缺少对阵，请先生成并保存对阵'
      }
    })
    expect(mockCloudCallFunction).not.toHaveBeenCalled()
  })
})
