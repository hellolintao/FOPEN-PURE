const { adminConsoleSnapshot } = require('../handlers/admin-console')

function makeCtx({
  isAdmin = true,
  openid = 'oA',
  memberId = 'mA',
  pending = [],
  drafts = [],
  ongoing = [],
  tournaments = [],
  registrationsByTournament = {},
  confirmedCounts = {},
  countActiveRegistrationsByTournamentIds,
  revisionAffectedCounts = {},
  throws = {}
} = {}) {
  const db = {
    aggregateSubmitted: async () => {
      if (throws.pending) throw new Error('PENDING_FAILED')
      return pending
    },
    listDrafts: async () => {
      if (throws.drafts) throw new Error('DRAFTS_FAILED')
      return drafts
    },
    listOngoing: async () => {
      if (throws.ongoing) throw new Error('ONGOING_FAILED')
      return ongoing
    },
    listWorkbenchTournaments: async () => {
      if (throws.tournaments) throw new Error('TOURNAMENTS_FAILED')
      return tournaments
    },
    listRegistrations: async (tournamentId) => {
      if (throws.registrations) throw new Error('REGISTRATIONS_FAILED')
      return registrationsByTournament[tournamentId] || []
    },
    countConfirmedRegistrations: async (tournamentId) => {
      if (throws.confirmedCounts) throw new Error('COUNTS_FAILED')
      return confirmedCounts[tournamentId] || 0
    },
    countScheduleRevisionAffected: async (tournamentId) => {
      if (throws.revisionAffectedCounts) throw new Error('REVISION_COUNTS_FAILED')
      return revisionAffectedCounts[tournamentId] || 0
    },
  }
  if (countActiveRegistrationsByTournamentIds) {
    db.countActiveRegistrationsByTournamentIds = countActiveRegistrationsByTournamentIds
  }
  return {
    isAdmin, callerOpenid: openid, callerMemberId: memberId,
    db,
  }
}

test('snapshot FORBIDDEN: non-admin', async () => {
  const ctx = makeCtx({ isAdmin: false })
  await expect(adminConsoleSnapshot(ctx, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('snapshot happy: returns 3 sections', async () => {
  const ctx = makeCtx({
    pending: [
      { tournamentId: 't1', tournamentName: 'A', format: 'regular', count: 2, mostRecentSubmitAt: new Date() },
    ],
    drafts: [{ _id: 't2', name: 'Draft', playerCount: 5, scheduleReady: false, updatedAt: new Date() }],
    ongoing: [{ _id: 't3', name: 'Live', format: 'knockout', round: 'R2/3', remainingMatches: 6 }],
  })
  const result = await adminConsoleSnapshot(ctx, {})
  expect(result.pendingConfirm.total).toBe(2)
  expect(result.pendingConfirm.byTournament).toHaveLength(1)
  expect(result.myDrafts).toHaveLength(1)
  expect(result.ongoing).toHaveLength(1)
})

test('snapshot groups tournaments by registration and schedule phase', async () => {
  const ctx = makeCtx({
    tournaments: [
      {
        _id: 'reg-open',
        name: '报名开放',
        format: 'regular',
        type: 'singles',
        confirmedCount: 9,
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
        scheduleStatus: 'none',
        schedulePlan: { courts: [{ courtId: 'c1', slots: ['18:00', '18:20'] }] }
      },
      {
        _id: 'pending',
        name: '等待排程',
        format: 'regular',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'none'
      },
      {
        _id: 'draft',
        name: '赛程草稿',
        format: 'regular',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'draft',
        schedulePlan: {
          queues: [
            { courtId: 'c1', items: [{ matchId: 'm1' }, { matchId: 'm2' }] },
            { courtId: 'c2', items: [{ matchId: 'm3' }, { matchId: 'm4' }] }
          ]
        }
      },
      {
        _id: 'needs-revision',
        name: '需调整赛程',
        format: 'regular',
        scheduleStatus: 'published',
        scheduleNeedsRevision: true
      }
    ],
    confirmedCounts: { pending: 12 },
    revisionAffectedCounts: { 'needs-revision': 2 }
  })

  const snapshot = await adminConsoleSnapshot(ctx, {})

  expect(snapshot.registrationOpen[0]).toMatchObject({ tournamentId: 'reg-open', confirmedCount: 9, deadlineText: '5月24日 18:00' })
  expect(snapshot.pendingSchedule[0]).toMatchObject({ tournamentId: 'pending', playerCount: 12 })
  expect(snapshot.scheduleDrafts[0]).toMatchObject({ tournamentId: 'draft', scheduledCount: 4 })
  expect(snapshot.scheduleRevisions[0]).toMatchObject({ tournamentId: 'needs-revision', affectedCount: 2 })
})

test('snapshot pending schedule playerCount includes legacy active registration rows', async () => {
  const ctx = makeCtx({
    tournaments: [{
      _id: 'legacy-pending',
      name: '旧报名',
      format: 'regular',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
      scheduleStatus: 'none'
    }],
    registrationsByTournament: {
      'legacy-pending': [
        { _id: 'legacy-confirmed', tournamentId: 'legacy-pending', playerId: 'm1', status: 'confirmed' },
        { _id: 'legacy-registered', tournamentId: 'legacy-pending', playerId: 'm2', status: 'registered' },
        { _id: 'legacy-cancelled', tournamentId: 'legacy-pending', playerId: 'm3', status: 'cancelled' },
        { _id: 'new-withdrew', tournamentId: 'legacy-pending', playerId: 'm4', registrationStatus: 'withdrew', status: 'confirmed' }
      ]
    }
  })

  const snapshot = await adminConsoleSnapshot(ctx, {})

  expect(snapshot.pendingSchedule[0]).toMatchObject({
    tournamentId: 'legacy-pending',
    playerCount: 2
  })
})

test('snapshot capacity warning uses legacy active registration display count', async () => {
  const ctx = makeCtx({
    tournaments: [{
      _id: 'legacy-open',
      name: '容量提醒',
      format: 'regular',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none',
      schedulePlan: { courts: [{ courtId: 'c1', slots: ['18:00'] }] }
    }],
    registrationsByTournament: {
      'legacy-open': [
        { _id: 'r1', tournamentId: 'legacy-open', playerId: 'm1', status: 'registered' },
        { _id: 'r2', tournamentId: 'legacy-open', playerId: 'm2', status: 'confirmed' },
        { _id: 'r3', tournamentId: 'legacy-open', playerId: 'm3', registrationStatus: 'confirmed' }
      ]
    }
  })

  const snapshot = await adminConsoleSnapshot(ctx, {})

  expect(snapshot.registrationOpen[0]).toMatchObject({
    tournamentId: 'legacy-open',
    confirmedCount: 3,
    capacityWarning: true
  })
})

test('snapshot batches active registration counts for phase candidates', async () => {
  const listRegistrations = jest.fn(async () => [])
  const countActiveRegistrationsByTournamentIds = jest.fn(async ids => Object.fromEntries(ids.map(id => [id, id === 'pending-b' ? 4 : 2])))
  const ctx = makeCtx({
    tournaments: [
      {
        _id: 'pending-a',
        name: '待排 A',
        format: 'regular',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'none'
      },
      {
        _id: 'pending-b',
        name: '待排 B',
        format: 'regular',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'none'
      },
      {
        _id: 'stored-count',
        name: '已有计数',
        format: 'regular',
        confirmedCount: 9,
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
        scheduleStatus: 'none'
      }
    ],
    registrationsByTournament: {},
    countActiveRegistrationsByTournamentIds
  })
  ctx.db.listRegistrations = listRegistrations

  const snapshot = await adminConsoleSnapshot(ctx, {})

  expect(countActiveRegistrationsByTournamentIds).toHaveBeenCalledTimes(1)
  expect(countActiveRegistrationsByTournamentIds).toHaveBeenCalledWith(['pending-a', 'pending-b'])
  expect(listRegistrations).not.toHaveBeenCalled()
  expect(snapshot.pendingSchedule).toEqual([
    expect.objectContaining({ tournamentId: 'pending-a', playerCount: 2 }),
    expect.objectContaining({ tournamentId: 'pending-b', playerCount: 4 }),
    expect.objectContaining({ tournamentId: 'stored-count', playerCount: 9 })
  ])
})

test('snapshot pending sub-query fails → integral SNAPSHOT_FAILED', async () => {
  const ctx = makeCtx({ throws: { pending: true } })
  await expect(adminConsoleSnapshot(ctx, {})).rejects.toMatchObject({ code: 'SNAPSHOT_FAILED' })
})

test('snapshot any of 3 sub-queries fails → integral error (no single-block degrade)', async () => {
  const ctx = makeCtx({ throws: { drafts: true } })
  await expect(adminConsoleSnapshot(ctx, {})).rejects.toMatchObject({ code: 'SNAPSHOT_FAILED' })
})

test('snapshot pendingConfirm.total aggregates byTournament counts', async () => {
  const ctx = makeCtx({
    pending: [
      { tournamentId: 't1', tournamentName: 'A', format: 'regular', count: 2, mostRecentSubmitAt: new Date() },
      { tournamentId: 't2', tournamentName: 'B', format: 'knockout', count: 3, mostRecentSubmitAt: new Date() },
    ],
  })
  const result = await adminConsoleSnapshot(ctx, {})
  expect(result.pendingConfirm.total).toBe(5)
  expect(result.pendingConfirm.byTournament).toHaveLength(2)
})

test('snapshot empty input returns all-zero structure', async () => {
  const ctx = makeCtx({})
  const result = await adminConsoleSnapshot(ctx, {})
  expect(result.pendingConfirm.total).toBe(0)
  expect(result.pendingConfirm.byTournament).toEqual([])
  expect(result.myDrafts).toEqual([])
  expect(result.ongoing).toEqual([])
  expect(result.registrationOpen).toEqual([])
  expect(result.pendingSchedule).toEqual([])
  expect(result.scheduleDrafts).toEqual([])
  expect(result.scheduleRevisions).toEqual([])
})
