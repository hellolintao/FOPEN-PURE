const { batchConfirm } = require('../../handlers/batch')

function makeCtx({ matches = [], requestLog = {}, isAdmin = true, openid = 'oA', memberId = 'mA' } = {}) {
  const matchesById = Object.fromEntries(matches.map(m => [m._id, { ...m }]))
  const requestLogById = { ...requestLog }
  return {
    callerOpenid: openid,
    callerMemberId: memberId,
    isAdmin,
    confirmedAtNow: new Date('2026-05-16T10:00:00.000Z'),
    db: {
      getMatch: async (id) => matchesById[id] || null,
      updateMatch: async (id, patch) => {
        matchesById[id] = { ...matchesById[id], ...patch }
      },
      getRequestLog: async (id) => requestLogById[id] || null,
      upsertRequestLog: async (id, doc) => { requestLogById[id] = doc },
    },
    _state: { matchesById, requestLogById },
    confirmOne: async function (match) {
      matchesById[match._id] = { ...matchesById[match._id], resultStatus: 'confirmed', updateTime: this.confirmedAtNow }
      return { ok: true }
    },
  }
}

test('batchConfirm happy: all matches confirmed', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'submitted', updateTime, score: { sets: [{ a: 4, b: 2 }] } },
      { _id: 'mr_b', resultStatus: 'submitted', updateTime, score: { sets: [{ a: 4, b: 1 }] } },
    ],
  })
  const result = await batchConfirm(ctx, {
    matches: [
      { matchId: 'mr_a', expectedUpdateTime: updateTime.toISOString() },
      { matchId: 'mr_b', expectedUpdateTime: updateTime.toISOString() },
    ],
    requestId: 'req_1',
  })

  expect(result).toEqual({
    requestId: 'req_1',
    successIds: ['mr_a', 'mr_b'],
    failures: [],
  })
  expect(ctx._state.matchesById.mr_a.resultStatus).toBe('confirmed')
  expect(ctx._state.matchesById.mr_b.resultStatus).toBe('confirmed')
})

test('batchConfirm STALE_VERSION: expectedUpdateTime mismatch returns failure', async () => {
  const currentTime = new Date('2026-05-16T09:30:00.000Z')
  const staleTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'submitted', updateTime: currentTime, score: { sets: [{ a: 4, b: 2 }] } },
    ],
  })
  const result = await batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a', expectedUpdateTime: staleTime.toISOString() }],
    requestId: 'req_2',
  })

  expect(result.successIds).toEqual([])
  expect(result.failures).toHaveLength(1)
  expect(result.failures[0]).toMatchObject({
    matchId: 'mr_a',
    code: 'STALE_VERSION',
    retryable: false,
    requestId: 'req_2',
  })
  expect(ctx._state.matchesById.mr_a.resultStatus).toBe('submitted')  // 未变更
})

test('batchConfirm retry merge: same requestId skips already-success match', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'submitted', updateTime },
      { _id: 'mr_b', resultStatus: 'submitted', updateTime },
    ],
    requestLog: {
      req_3: {
        _id: 'req_3', action: 'batchConfirm',
        callerOpenid: 'oA', callerMemberId: 'mA',
        firstSeenAt: new Date(), lastSeenAt: new Date(),
        results: { mr_a: { state: 'success', confirmedAt: new Date(), attemptCount: 1 } },
        closedAt: null,
      },
    },
  })
  // simulate state: mr_a already confirmed in DB
  ctx._state.matchesById.mr_a.resultStatus = 'confirmed'

  const result = await batchConfirm(ctx, {
    matches: [
      { matchId: 'mr_a', expectedUpdateTime: updateTime.toISOString() },  // already success in log
      { matchId: 'mr_b', expectedUpdateTime: updateTime.toISOString() },
    ],
    requestId: 'req_3',
  })

  expect(result.successIds).toEqual(['mr_a', 'mr_b'])  // mr_a skipped via log, mr_b newly confirmed
  expect(result.failures).toEqual([])
})

test('batchConfirm INVALID_PAYLOAD: missing matches', async () => {
  const ctx = makeCtx({ matches: [] })
  await expect(batchConfirm(ctx, { matches: [], requestId: 'req_x' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
})

test('batchConfirm INVALID_PAYLOAD: missing expectedUpdateTime in one entry', async () => {
  const ctx = makeCtx({ matches: [] })
  await expect(batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a' }],
    requestId: 'req_x',
  })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
})

test('batchConfirm FORBIDDEN: non-admin caller', async () => {
  const ctx = makeCtx({ matches: [], isAdmin: false })
  await expect(batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a', expectedUpdateTime: new Date().toISOString() }],
    requestId: 'req_x',
  })).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('batchConfirm writes _request_log with merged results', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'submitted', updateTime }],
  })
  await batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a', expectedUpdateTime: updateTime.toISOString() }],
    requestId: 'req_4',
  })
  const log = ctx._state.requestLogById.req_4
  expect(log).toBeTruthy()
  expect(log.action).toBe('batchConfirm')
  expect(log.results.mr_a.state).toBe('success')
  expect(log.results.mr_a.attemptCount).toBe(1)
})
