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
