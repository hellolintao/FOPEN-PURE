const { batchConfirm, batchSubmit, batchAdminSave, applyScheduleImpact } = require('../../handlers/batch')
const { submit, reconfirmMatch } = require('../../handlers/submit')

function makeCtx({ matches = [], requestLog = {}, tournaments = {}, isAdmin = true, openid = 'oA', memberId = 'mA' } = {}) {
  const matchesById = Object.fromEntries(matches.map(m => [m._id, { ...m }]))
  const historyById = {}
  const requestLogById = { ...requestLog }
  const tournamentsById = { ...tournaments }
  const removedPointsFor = []
  const downstreamClears = []
  const tournamentUpdates = []
  return {
    callerOpenid: openid,
    callerMemberId: memberId,
    isAdmin,
    confirmedAtNow: new Date('2026-05-16T10:00:00.000Z'),
    nowDate: new Date('2026-05-16T10:00:00.000Z'),
    db: {
      getMatch: async (id) => matchesById[id] || null,
      getTournament: async (id) => tournamentsById[id] || null,
      listMatchesByTournament: async (tournamentId) => Object.values(matchesById).filter(m => m.tournamentId === tournamentId),
      updateMatch: async (id, patch) => {
        matchesById[id] = { ...matchesById[id], ...patch }
      },
      archiveMatchResult: async (doc) => {
        historyById[doc._id] = { ...doc }
      },
      clearDownstream: async (tournamentId, row) => {
        downstreamClears.push({ tournamentId, rowId: row && row._id })
      },
      removeTournamentPoints: async (tournamentId) => { removedPointsFor.push(tournamentId) },
      markTournamentOngoing: async (tournamentId, patch) => {
        tournamentUpdates.push({ tournamentId, patch })
        tournamentsById[tournamentId] = { ...(tournamentsById[tournamentId] || { _id: tournamentId }), ...patch }
      },
      getRequestLog: async (id) => requestLogById[id] || null,
      upsertRequestLog: async (id, doc) => { requestLogById[id] = doc },
    },
    _state: { matchesById, historyById, requestLogById, tournamentsById, removedPointsFor, downstreamClears, tournamentUpdates },
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
    analyticsStatus: 'skipped',
    analyticsMessage: '',
    settlementImpact: [],
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

test.each(['draft', 'none'])('batchConfirm rejects submitted rows when scheduleStatus is %s', async (scheduleStatus) => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    tournaments: { t1: { _id: 't1', scheduleStatus } },
    matches: [{ _id: 'mr_confirm_blocked', tournamentId: 't1', resultStatus: 'submitted', updateTime }],
  })

  const result = await batchConfirm(ctx, {
    matches: [{ matchId: 'mr_confirm_blocked', expectedUpdateTime: updateTime.toISOString() }],
    requestId: `req_confirm_${scheduleStatus}`,
  })

  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({
    matchId: 'mr_confirm_blocked',
    code: 'SCHEDULE_NOT_PUBLISHED',
    message: '赛程发布后才能录入成绩',
    retryable: false,
  })
  expect(ctx._state.matchesById.mr_confirm_blocked.resultStatus).toBe('submitted')
})

test.each([
  ['published tournament', { _id: 't1', scheduleStatus: 'published' }],
  ['legacy tournament', { _id: 't1' }],
])('batchConfirm allows submitted rows for %s', async (_label, tournament) => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    tournaments: { t1: tournament },
    matches: [{ _id: 'mr_confirm_allowed', tournamentId: 't1', resultStatus: 'submitted', updateTime }],
  })

  const result = await batchConfirm(ctx, {
    matches: [{ matchId: 'mr_confirm_allowed', expectedUpdateTime: updateTime.toISOString() }],
    requestId: `req_confirm_${_label}`,
  })

  expect(result.successIds).toEqual(['mr_confirm_allowed'])
  expect(result.failures).toEqual([])
  expect(ctx._state.matchesById.mr_confirm_allowed.resultStatus).toBe('confirmed')
})

function makeSubmitCtx({ matches = [], tournaments = {}, openid = 'oA', memberId = 'mA', emulateCloudNestedScoreUpdate = false } = {}) {
  const matchesById = Object.fromEntries(matches.map(m => [m._id, { ...m }]))
  const tournamentsById = { ...tournaments }
  const requestLogById = {}
  const clearedFields = []
  return {
    callerOpenid: openid,
    callerMemberId: memberId,
    isAdmin: false,
    nowDate: new Date('2026-05-16T11:00:00.000Z'),
    db: {
      getMatch: async (id) => matchesById[id] || null,
      getTournament: async (id) => tournamentsById[id] || null,
      updateMatch: async (id, patch) => {
        if (emulateCloudNestedScoreUpdate && Object.prototype.hasOwnProperty.call(patch, 'score') && matchesById[id] && matchesById[id].score === null) {
          throw new Error("Cannot create field 'sets' in element {score: null}")
        }
        matchesById[id] = { ...matchesById[id], ...patch }
      },
      clearMatchFields: async (id, fields) => {
        clearedFields.push({ id, fields })
        for (const field of fields || []) delete matchesById[id][field]
      },
      getRequestLog: async (id) => requestLogById[id] || null,
      upsertRequestLog: async (id, doc) => { requestLogById[id] = doc },
    },
    _state: { matchesById, requestLogById, tournamentsById, clearedFields },
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

test('batchSubmit replaces nullable score before writing score object', async () => {
  const ctx = makeSubmitCtx({
    emulateCloudNestedScoreUpdate: true,
    matches: [
      { _id: 'mr_null_score', resultStatus: 'pending', playerIds: ['mA', 'mB'], score: null },
    ],
  })
  const result = await batchSubmit(ctx, {
    submissions: [
      { matchId: 'mr_null_score', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
    ],
    requestId: 'req_null_score',
  })
  expect(result.successIds).toEqual(['mr_null_score'])
  expect(result.failures).toEqual([])
  expect(ctx._state.clearedFields).toEqual([{ id: 'mr_null_score', fields: ['score'] }])
  expect(ctx._state.matchesById.mr_null_score.score).toEqual({ sets: [{ a: 4, b: 2 }], tiebreak: null })
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

test.each([
  ['invalidated active row', { resultStatus: 'invalidated' }],
  ['history row', { resultStatus: 'confirmed', matchKind: 'history', archivedFrom: 'mr_a' }],
  ['audit row', { resultStatus: 'pending', matchKind: 'audit' }],
])('batchSubmit rejects %s', async (_label, rowPatch) => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'pending', playerIds: ['mA', 'mB'], ...rowPatch }],
  })

  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: `req_inactive_${_label}`,
  })

  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({ matchId: 'mr_a', code: 'INVALID_STATE', retryable: false })
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

test.each(['draft', 'none'])('batchSubmit rejects score submission when scheduleStatus is %s', async (scheduleStatus) => {
  const ctx = makeSubmitCtx({
    tournaments: { t1: { _id: 't1', scheduleStatus } },
    matches: [{ _id: 'mr_blocked', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mA', 'mB'] }],
  })

  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_blocked', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: `req_submit_${scheduleStatus}`,
  })

  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({
    matchId: 'mr_blocked',
    code: 'SCHEDULE_NOT_PUBLISHED',
    message: '赛程发布后才能录入成绩',
    retryable: false,
  })
  expect(ctx._state.matchesById.mr_blocked.resultStatus).toBe('pending')
  expect(ctx._state.matchesById.mr_blocked.score).toBeUndefined()
})

test('batchSubmit accepts legacy tournament without scheduleStatus', async () => {
  const ctx = makeSubmitCtx({
    tournaments: { t_legacy: { _id: 't_legacy' } },
    matches: [{ _id: 'mr_legacy', tournamentId: 't_legacy', resultStatus: 'pending', playerIds: ['mA', 'mB'] }],
  })

  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_legacy', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_submit_legacy',
  })

  expect(result.successIds).toEqual(['mr_legacy'])
  expect(result.failures).toEqual([])
  expect(ctx._state.matchesById.mr_legacy.resultStatus).toBe('submitted')
})

test('batchSubmit accepts group knockout group-published tournament when scheduleStatus is none', async () => {
  const ctx = makeSubmitCtx({
    tournaments: {
      t1: {
        _id: 't1',
        format: 'group_knockout',
        groupKnockoutPhase: 'group_published',
        scheduleStatus: 'none',
      }
    },
    matches: [{ _id: 'mr_group', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mA', 'mB'] }],
  })

  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_group', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_submit_group_published_none',
  })

  expect(result.successIds).toEqual(['mr_group'])
  expect(result.failures).toEqual([])
  expect(ctx._state.matchesById.mr_group.resultStatus).toBe('submitted')
})

test('batchSubmit rejects group knockout draft tournament when scheduleStatus is none', async () => {
  const ctx = makeSubmitCtx({
    tournaments: {
      t1: {
        _id: 't1',
        format: 'group_knockout',
        groupKnockoutPhase: 'group_draft',
        scheduleStatus: 'none',
      }
    },
    matches: [{ _id: 'mr_group_draft', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mA', 'mB'] }],
  })

  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_group_draft', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_submit_group_draft_none',
  })

  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({
    matchId: 'mr_group_draft',
    code: 'SCHEDULE_NOT_PUBLISHED',
  })
  expect(ctx._state.matchesById.mr_group_draft.resultStatus).toBe('pending')
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

test.each(['draft', 'none'])('batchAdminSave rejects score changes when scheduleStatus is %s', async (scheduleStatus) => {
  const ctx = makeCtx({
    tournaments: { t1: { _id: 't1', scheduleStatus } },
    matches: [{ _id: 'mr_admin_blocked', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mA', 'mB'] }],
  })
  ctx.validateScore = jest.fn(() => ({ valid: true }))

  const result = await batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_admin_blocked', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: `req_admin_${scheduleStatus}`,
  })

  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({
    matchId: 'mr_admin_blocked',
    code: 'SCHEDULE_NOT_PUBLISHED',
    message: '赛程发布后才能录入成绩',
    retryable: false,
  })
  expect(ctx.validateScore).not.toHaveBeenCalled()
  expect(ctx._state.matchesById.mr_admin_blocked.resultStatus).toBe('pending')
})

test('batchAdminSave can adjust confirmed rows after schedule is published', async () => {
  const ctx = makeCtx({
    tournaments: { t1: { _id: 't1', scheduleStatus: 'published' } },
    matches: [{
      _id: 'mr_confirmed',
      tournamentId: 't1',
      resultStatus: 'confirmed',
      score: { sets: [{ a: 4, b: 1 }], tiebreak: null },
      playerIds: ['mA', 'mB'],
    }],
  })
  ctx.validateScore = jest.fn(() => ({ valid: true }))
  ctx.recomputeTriggered = false
  ctx.confirmOne = async function (match, score) {
    if (match.resultStatus === 'confirmed') this.recomputeTriggered = true
    this._state.matchesById[match._id] = {
      ...this._state.matchesById[match._id],
      score,
      resultStatus: 'confirmed',
      confirmedBy: this.callerMemberId,
    }
    return { ok: true }
  }

  const result = await batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_confirmed', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_admin_adjust',
  })

  expect(result.successIds).toEqual(['mr_confirmed'])
  expect(result.failures).toEqual([])
  expect(ctx._state.matchesById.mr_confirmed.score).toEqual({ sets: [{ a: 4, b: 2 }], tiebreak: null })
  expect(ctx.recomputeTriggered).toBe(true)
})

test('batchAdminSave rejects audit rows before confirming scores', async () => {
  const ctx = makeCtx({
    tournaments: { t1: { _id: 't1', scheduleStatus: 'published' } },
    matches: [{
      _id: 'audit_t1_m1',
      tournamentId: 't1',
      matchKind: 'audit',
      resultStatus: 'pending',
      playerIds: ['mA', 'mB'],
    }],
  })
  ctx.validateScore = jest.fn(() => ({ valid: true }))
  ctx.confirmOne = jest.fn()

  const result = await batchAdminSave(ctx, {
    matches: [{ matchId: 'audit_t1_m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_admin_audit',
  })

  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({ matchId: 'audit_t1_m1', code: 'INVALID_STATE', retryable: false })
  expect(ctx.validateScore).not.toHaveBeenCalled()
  expect(ctx.confirmOne).not.toHaveBeenCalled()
})

test('batchAdminSave returns analytics metadata when ctx.afterSettlement succeeds', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    isAdmin: true,
    matches: [{ _id: 'mr_a', resultStatus: 'submitted', playerIds: ['A', 'B'], tournamentId: 't1', updateTime, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
  })
  ctx.validateScore = jest.fn(() => ({ valid: true }))
  ctx.afterSettlement = jest.fn(async ({ successIds }) => ({
    analyticsStatus: 'success',
    analyticsMessage: '排行榜已更新',
    settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }],
    refreshedMatchIds: successIds,
  }))

  const result = await batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_analytics',
  })

  expect(ctx.afterSettlement).toHaveBeenCalledWith({ successIds: ['mr_a'], requestId: 'req_analytics' })
  expect(result.analyticsStatus).toBe('success')
  expect(result.settlementImpact).toEqual([{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }])
})

test('batchAdminSave does not fail confirmation when ctx.afterSettlement fails', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    isAdmin: true,
    matches: [{ _id: 'mr_a', resultStatus: 'submitted', playerIds: ['A', 'B'], tournamentId: 't1', updateTime, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
  })
  ctx.validateScore = jest.fn(() => ({ valid: true }))
  ctx.afterSettlement = jest.fn(async () => { throw new Error('analytics down') })

  const result = await batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_analytics_fail',
  })

  expect(result.successIds).toEqual(['mr_a'])
  expect(result.analyticsStatus).toBe('failed')
  expect(result.analyticsMessage).toBe('比分已确认，数据分析稍后重算')
})

test('batchConfirm returns skipped analytics envelope when ctx.afterSettlement is missing', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'submitted', updateTime, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
    ],
  })

  const result = await batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a', expectedUpdateTime: updateTime.toISOString() }],
    requestId: 'req_skipped_batch_confirm',
  })

  expect(result).toMatchObject({
    requestId: 'req_skipped_batch_confirm',
    successIds: ['mr_a'],
    failures: [],
    analyticsStatus: 'skipped',
    analyticsMessage: '',
    settlementImpact: [],
  })
})

test('submit handler rejects unpublished schedule before member score changes', async () => {
  const err = new Error('赛程发布后才能录入成绩')
  err.code = 'SCHEDULE_NOT_PUBLISHED'
  const ctx = {
    submitter: { _id: 'mA' },
    stateSvc: {
      assertSchedulePublishedForMatch: jest.fn(async () => { throw err }),
      submitResult: jest.fn(),
    },
  }

  await expect(submit(ctx, { matchId: 'm1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }))
    .rejects.toMatchObject({ code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' })
  expect(ctx.stateSvc.assertSchedulePublishedForMatch).toHaveBeenCalledWith('m1')
  expect(ctx.stateSvc.submitResult).not.toHaveBeenCalled()
})

test('reconfirmMatch handler rejects unpublished schedule before admin adjustment', async () => {
  const err = new Error('赛程发布后才能录入成绩')
  err.code = 'SCHEDULE_NOT_PUBLISHED'
  const ctx = {
    submitter: { _id: 'admin1', isAdmin: true },
    stateSvc: {
      assertSchedulePublishedForMatch: jest.fn(async () => { throw err }),
      reconfirmMatch: jest.fn(),
    },
  }

  await expect(reconfirmMatch(ctx, { matchId: 'm1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null } }))
    .rejects.toMatchObject({ code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' })
  expect(ctx.stateSvc.assertSchedulePublishedForMatch).toHaveBeenCalledWith('m1')
  expect(ctx.stateSvc.reconfirmMatch).not.toHaveBeenCalled()
})

test('applyScheduleImpact archives affected confirmed rows, resets canonical row, and drops recomputed state', async () => {
  const ctx = makeCtx({
    tournaments: { t1: { _id: 't1', status: 'completed', completedAt: 'done' } },
    matches: [{
      _id: 'result_t1_m1',
      tournamentId: 't1',
      sourceMatchId: 'm1',
      resultStatus: 'confirmed',
      player1: { id: 'a' },
      player2: { id: 'b' },
      courtId: 'c1',
      queueOrder: 0,
      score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
      winner: { id: 'a' },
      winnerId: 'a',
      confirmedBy: 'admin0',
      confirmedAt: new Date('2026-05-15T10:00:00.000Z'),
      pointsAwarded: { entries: [{ memberId: 'a', points: 20 }] },
    }],
  })

  const result = await applyScheduleImpact(ctx, {
    tournamentId: 't1',
    mode: 'invalidate_scores',
    matches: [{ matchId: 'm1', player1: { id: 'c' }, player2: { id: 'b' } }],
    queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] }],
  })

  expect(result).toMatchObject({ affectedCount: 1, invalidatedIds: ['result_t1_m1'] })
  const historyRows = Object.values(ctx._state.historyById)
  expect(historyRows).toHaveLength(1)
  expect(historyRows[0]).toMatchObject({
    archivedFrom: 'result_t1_m1',
    matchKind: 'history',
    resultStatus: 'invalidated',
    invalidatedBy: 'mA',
    score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
    winnerId: 'a',
    pointsAwarded: { entries: [{ memberId: 'a', points: 20 }] },
  })
  expect(historyRows[0].invalidatedAt).toEqual(ctx.nowDate)
  expect(ctx._state.matchesById.result_t1_m1).toMatchObject({
    resultStatus: 'pending',
    score: null,
    winner: null,
    winnerId: null,
    pointsAwarded: null,
    confirmedBy: null,
    confirmedAt: null,
  })
  expect(ctx._state.matchesById.result_t1_m1.invalidatedAt).toBeUndefined()
  expect(ctx._state.removedPointsFor).toEqual(['t1'])
  expect(ctx._state.downstreamClears).toEqual([{ tournamentId: 't1', rowId: 'result_t1_m1' }])
  expect(ctx._state.tournamentUpdates).toEqual([{
    tournamentId: 't1',
    patch: expect.objectContaining({ status: 'ongoing', completedAt: null }),
  }])
})

test('applyScheduleImpact invalidates result-affecting rows while preserving slot-only confirmed scores', async () => {
  const ctx = makeCtx({
    matches: [
      {
        _id: 'result_t1_m1',
        tournamentId: 't1',
        sourceMatchId: 'm1',
        resultStatus: 'confirmed',
        player1: { id: 'a' },
        player2: { id: 'b' },
        courtId: 'c1',
        queueOrder: 0,
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        winner: { id: 'a' },
        winnerId: 'a',
        confirmedBy: 'admin0',
        pointsAwarded: { entries: [{ memberId: 'a', points: 20 }] },
      },
      {
        _id: 'result_t1_m2',
        tournamentId: 't1',
        sourceMatchId: 'm2',
        resultStatus: 'confirmed',
        player1: { id: 'c' },
        player2: { id: 'd' },
        courtId: 'c1',
        queueOrder: 1,
        score: { sets: [{ a: 2, b: 4 }], tiebreak: null },
        winner: { id: 'd' },
        winnerId: 'd',
        confirmedBy: 'admin0',
        pointsAwarded: { entries: [{ memberId: 'd', points: 20 }] },
      },
    ],
  })

  const result = await applyScheduleImpact(ctx, {
    tournamentId: 't1',
    mode: 'invalidate_scores',
    matches: [
      { matchId: 'm1', player1: { id: 'x' }, player2: { id: 'b' } },
      { matchId: 'm2', player1: { id: 'c' }, player2: { id: 'd' } },
    ],
    queues: [
      { courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] },
      { courtId: 'c3', items: [{ kind: 'match', matchId: 'm2', order: 4 }] },
    ],
  })

  expect(result).toMatchObject({ affectedCount: 2, invalidatedIds: ['result_t1_m1'] })
  expect(ctx._state.matchesById.result_t1_m1).toMatchObject({
    resultStatus: 'pending',
    score: null,
    winner: null,
    pointsAwarded: null,
  })
  expect(ctx._state.matchesById.result_t1_m2).toMatchObject({
    resultStatus: 'confirmed',
    score: { sets: [{ a: 2, b: 4 }], tiebreak: null },
    winnerId: 'd',
    pointsAwarded: { entries: [{ memberId: 'd', points: 20 }] },
    courtId: 'c3',
    queueOrder: 4,
  })
  expect(Object.values(ctx._state.historyById).map(row => row.archivedFrom)).toEqual(['result_t1_m1'])
})

test('applyScheduleImpact requires invalidation when players change at the same slot', async () => {
  const ctx = makeCtx({
    matches: [{
      _id: 'result_t1_m1',
      tournamentId: 't1',
      sourceMatchId: 'm1',
      resultStatus: 'confirmed',
      player1: { id: 'a' },
      player2: { id: 'b' },
      courtId: 'c1',
      queueOrder: 0,
    }],
  })

  await expect(applyScheduleImpact(ctx, {
    tournamentId: 't1',
    mode: 'keep_time_only',
    matches: [{ matchId: 'm1', player1: { id: 'c' }, player2: { id: 'b' } }],
    queues: [{ courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] }],
  })).rejects.toMatchObject({
    code: 'SCHEDULE_IMPACT_REQUIRES_INVALIDATION',
    message: '赛程变更影响已确认成绩，请选择清空比分并重新录入',
  })
  expect(ctx._state.matchesById.result_t1_m1.resultStatus).toBe('confirmed')
  expect(ctx._state.removedPointsFor).toEqual([])
})
