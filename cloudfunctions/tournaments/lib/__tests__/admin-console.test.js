const { adminConsoleSnapshot } = require('../handlers/admin-console')

function makeCtx({ isAdmin = true, openid = 'oA', memberId = 'mA', pending = [], drafts = [], ongoing = [], throws = {} } = {}) {
  return {
    isAdmin, callerOpenid: openid, callerMemberId: memberId,
    db: {
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
    },
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
})
