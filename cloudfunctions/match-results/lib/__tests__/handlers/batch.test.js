const { batchConfirm, batchAdminSave } = require('../../handlers/batch')

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

const { batchSubmit } = require('../../handlers/batch')

function makeSubmitCtx({ matches = [], openid = 'oA', memberId = 'mA' } = {}) {
  const matchesById = Object.fromEntries(matches.map(m => [m._id, { ...m }]))
  const requestLogById = {}
  return {
    callerOpenid: openid,
    callerMemberId: memberId,
    isAdmin: false,
    nowDate: new Date('2026-05-16T11:00:00.000Z'),
    db: {
      getMatch: async (id) => matchesById[id] || null,
      updateMatch: async (id, patch) => {
        matchesById[id] = { ...matchesById[id], ...patch }
      },
      getRequestLog: async (id) => requestLogById[id] || null,
      upsertRequestLog: async (id, doc) => { requestLogById[id] = doc },
    },
    _state: { matchesById, requestLogById },
    validateScore: () => ({ valid: true }),
  }
}

test('batchSubmit happy: member submits multiple scores', async () => {
  const ctx = makeSubmitCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'pending', playerIds: ['mA', 'mB'] },
      { _id: 'mr_b', resultStatus: 'pending', playerIds: ['mA', 'mC'] },
    ],
  })
  const result = await batchSubmit(ctx, {
    submissions: [
      { matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
      { matchId: 'mr_b', score: { sets: [{ a: 4, b: 1 }], tiebreak: null } },
    ],
    requestId: 'req_s1',
  })
  expect(result.successIds).toEqual(['mr_a', 'mr_b'])
  expect(result.failures).toEqual([])
  expect(ctx._state.matchesById.mr_a.resultStatus).toBe('submitted')
  expect(ctx._state.matchesById.mr_a.score).toEqual({ sets: [{ a: 4, b: 2 }], tiebreak: null })
})

test('batchSubmit FORBIDDEN: caller not in playerIds', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'pending', playerIds: ['mX', 'mY'] }],
  })
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_s2',
  })
  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({ matchId: 'mr_a', code: 'FORBIDDEN', retryable: false })
})

test('batchSubmit CANNOT_OVERWRITE_CONFIRMED: member cannot overwrite confirmed match', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'confirmed', playerIds: ['mA'] }],
  })
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_s3',
  })
  expect(result.failures[0].code).toBe('CANNOT_OVERWRITE_CONFIRMED')
})

test('batchSubmit INVALID_SCORE: bad score structure', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'pending', playerIds: ['mA'] }],
  })
  ctx.validateScore = () => ({ valid: false, error: 'INVALID_SCORE' })
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_a', score: { sets: [{ a: 9, b: 9 }], tiebreak: null } }],
    requestId: 'req_s4',
  })
  expect(result.failures[0].code).toBe('INVALID_SCORE')
})

test('batchSubmit accepts 3-3 tiebreak score using current string schema', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_tb', resultStatus: 'pending', playerIds: ['mA', 'mB'] }],
  })
  ctx.validateScore = (a, b, tiebreak) => {
    expect([a, b, tiebreak]).toEqual([3, 3, '5-7'])
    return { valid: true, winner: 'b' }
  }
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_tb', score: { sets: [{ a: 3, b: 3 }], tiebreak: '5-7' } }],
    requestId: 'req_tb',
  })
  expect(result.successIds).toEqual(['mr_tb'])
  expect(ctx._state.matchesById.mr_tb.score.tiebreak).toBe('5-7')
})

test('batchAdminSave confirms pending matches with supplied scores', async () => {
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'pending', playerIds: ['mA', 'mB'] },
      { _id: 'mr_b', resultStatus: 'submitted', playerIds: ['mA', 'mC'], score: { sets: [{ a: 4, b: 1 }], tiebreak: null } },
    ],
  })
  ctx.validateScore = () => ({ valid: true })
  ctx.confirmOne = async function (match, score) {
    this._state.matchesById[match._id] = {
      ...this._state.matchesById[match._id],
      score,
      resultStatus: 'confirmed',
      confirmedBy: this.callerMemberId,
    }
  }

  const result = await batchAdminSave(ctx, {
    matches: [
      { matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
      { matchId: 'mr_b', score: { sets: [{ a: 4, b: 1 }], tiebreak: null } },
    ],
    requestId: 'req_a1',
  })

  expect(result.successIds).toEqual(['mr_a', 'mr_b'])
  expect(result.failures).toEqual([])
  expect(ctx._state.matchesById.mr_a).toMatchObject({
    resultStatus: 'confirmed',
    score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
  })
})

test('batchAdminSave refuses non-admin caller before validating scores', async () => {
  const ctx = makeCtx({ matches: [{ _id: 'mr_a', resultStatus: 'pending' }], isAdmin: false })
  ctx.validateScore = jest.fn()
  await expect(batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_admin_forbidden',
  })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  expect(ctx.validateScore).not.toHaveBeenCalled()
})
