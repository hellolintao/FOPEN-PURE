const { pendingReviewItems, pendingEntryGroups, canExposeScoreRows, __test__ } = require('../../handlers/query')

function makeQueryCtx({ rows = [], tournaments = {}, members = {}, isAdmin = true, tournament = null } = {}) {
  const queries = []
  return {
    isAdmin,
    queries,
    db: {
      queryMatchResults: async ({ resultStatus, tournamentId, limit }) => {
        queries.push({ resultStatus, tournamentId, limit })
        return rows.filter(r =>
          (!tournamentId || r.tournamentId === tournamentId) &&
          (!resultStatus || r.resultStatus === resultStatus)
        ).slice(0, limit)
      },
      countMatchResults: async ({ resultStatus, tournamentId }) =>
        rows.filter(r =>
          (!tournamentId || r.tournamentId === tournamentId) &&
          (!resultStatus || r.resultStatus === resultStatus)
        ).length,
      getTournament: async (id) => tournament || tournaments[id] || null,
      getTournamentsByIds: async (ids) => ids.map(id => tournaments[id]).filter(Boolean),
      getMembersByIds: async (ids) => ids.map(id => members[id]).filter(Boolean),
      listByTournament: async (tournamentId) => rows.filter(r => r.tournamentId === tournamentId),
      listByPlayerNotConfirmed: async (memberId) => rows.filter(r => (r.playerIds || []).includes(memberId)),
    },
  }
}

test('canExposeScoreRows: legacy tournament with missing scheduleStatus is exposed (backward compat)', () => {
  expect(canExposeScoreRows({ _id: 'legacy' })).toBe(true)
})

test('canExposeScoreRows: published is exposed', () => {
  expect(canExposeScoreRows({ scheduleStatus: 'published' })).toBe(true)
})

test.each([
  'group_published',
  'group_completed',
  'knockout_published',
  'completed',
])('canExposeScoreRows: group knockout phase %s is exposed when scheduleStatus is none', (groupKnockoutPhase) => {
  expect(canExposeScoreRows({
    format: 'group_knockout',
    groupKnockoutPhase,
    scheduleStatus: 'none'
  })).toBe(true)
})

test.each([
  ['none'],
  ['draft'],
  [null],
  [''],
  ['ready'],
  [false],
  [0],
])('canExposeScoreRows: explicit non-published scheduleStatus %p is hidden', (scheduleStatus) => {
  expect(canExposeScoreRows({ scheduleStatus })).toBe(false)
})

test.each([
  ['missing', undefined],
  ['group_draft', 'group_draft'],
  ['null', null],
  ['empty string', ''],
  ['false', false],
])('canExposeScoreRows: group knockout phase %s is hidden when scheduleStatus is none', (_label, groupKnockoutPhase) => {
  const tournament = {
    format: 'group_knockout',
    scheduleStatus: 'none',
  }
  if (typeof groupKnockoutPhase !== 'undefined') tournament.groupKnockoutPhase = groupKnockoutPhase
  expect(canExposeScoreRows(tournament)).toBe(false)
})

test('listByTournament returns empty rows when scheduleStatus is draft', async () => {
  const ctx = makeQueryCtx({
    isAdmin: false,
    tournament: { _id: 't1', scheduleStatus: 'draft' },
    rows: [{ _id: 'r1', tournamentId: 't1' }]
  })

  const res = await __test__.listByTournamentWithCtx(ctx, { tournamentId: 't1' })

  expect(res).toEqual({ results: [] })
})

test('listByTournament exposes group knockout rows after group bracket publish even when scheduleStatus is none', async () => {
  const ctx = makeQueryCtx({
    isAdmin: false,
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      groupKnockoutPhase: 'group_published',
      scheduleStatus: 'none',
    },
    rows: [{ _id: 'r1', tournamentId: 't1', resultStatus: 'pending' }]
  })

  const res = await __test__.listByTournamentWithCtx(ctx, { tournamentId: 't1' })

  expect(res.results.map(row => row._id)).toEqual(['r1'])
})

test('listByTournament hides group knockout draft rows when scheduleStatus is none', async () => {
  const ctx = makeQueryCtx({
    isAdmin: false,
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      groupKnockoutPhase: 'group_draft',
      scheduleStatus: 'none',
    },
    rows: [{ _id: 'r1', tournamentId: 't1', resultStatus: 'pending' }]
  })

  const res = await __test__.listByTournamentWithCtx(ctx, { tournamentId: 't1' })

  expect(res).toEqual({ results: [] })
})

test('listByTournament filters invalidated and history rows from active score rows', async () => {
  const ctx = makeQueryCtx({
    tournament: { _id: 't1', scheduleStatus: 'published' },
    rows: [
      { _id: 'result_t1_m1', tournamentId: 't1', resultStatus: 'pending' },
      { _id: 'result_t1_m2', tournamentId: 't1', resultStatus: 'invalidated' },
      { _id: 'history_result_t1_m2_1', tournamentId: 't1', resultStatus: 'invalidated', matchKind: 'history', archivedFrom: 'result_t1_m2' },
      { _id: 'audit_result_t1_m2_1', tournamentId: 't1', resultStatus: 'pending', matchKind: 'audit' },
    ]
  })

  const res = await __test__.listByTournamentWithCtx(ctx, { tournamentId: 't1' })

  expect(res.results.map(row => row._id)).toEqual(['result_t1_m1'])
})

test('listByPlayer filters non-admin rows by tournament schedule visibility', async () => {
  const ctx = makeQueryCtx({
    isAdmin: false,
    tournaments: {
      published: { _id: 'published', scheduleStatus: 'published' },
      draft: { _id: 'draft', scheduleStatus: 'draft' },
      legacy: { _id: 'legacy' },
    },
    rows: [
      { _id: 'publishedRow', tournamentId: 'published', playerIds: ['m1'], resultStatus: 'pending' },
      { _id: 'draftRow', tournamentId: 'draft', playerIds: ['m1'], resultStatus: 'pending' },
      { _id: 'legacyRow', tournamentId: 'legacy', playerIds: ['m1'], resultStatus: 'pending' },
    ]
  })

  const res = await __test__.listByPlayerWithCtx(ctx, { memberId: 'm1' })

  expect(res.matches.map(row => row._id)).toEqual(['publishedRow', 'legacyRow'])
})

test('listByPlayer keeps draft rows for admin', async () => {
  const ctx = makeQueryCtx({
    isAdmin: true,
    tournaments: {
      draft: { _id: 'draft', scheduleStatus: 'draft' },
    },
    rows: [
      { _id: 'draftRow', tournamentId: 'draft', playerIds: ['m1'], resultStatus: 'pending' },
    ]
  })

  const res = await __test__.listByPlayerWithCtx(ctx, { memberId: 'm1' })

  expect(res.matches.map(row => row._id)).toEqual(['draftRow'])
})

test('pendingReviewItems FORBIDDEN: non-admin', async () => {
  const ctx = makeQueryCtx({ isAdmin: false })
  await expect(pendingReviewItems(ctx, { tournamentId: null, limit: 50 }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('pendingReviewItems returns items with updateTime field', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeQueryCtx({
    rows: [
      {
        _id: 'mr_a', tournamentId: 't1', resultStatus: 'submitted',
        round: 'R1', position: 3, courtName: '1号场', scheduledStart: new Date(),
        player1: { name: '王明', partnerName: '李强' },
        player2: { name: '张明', partnerName: '赵亮' },
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        submittedBy: 'mA', submittedAt: new Date(), updateTime,
      },
    ],
    tournaments: { t1: { _id: 't1', name: 'XXX 杯', format: 'regular' } },
    members: { mA: { _id: 'mA', name: '王明' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: null, limit: 50 })
  expect(result.items).toHaveLength(1)
  expect(result.items[0]).toMatchObject({
    matchId: 'mr_a',
    tournamentId: 't1',
    tournamentName: 'XXX 杯',
    updateTime: updateTime,
  })
  expect(result.truncated).toBe(false)
})

test('pendingReviewItems filters by tournamentId', async () => {
  const ctx = makeQueryCtx({
    rows: [
      { _id: 'mr_a', tournamentId: 't1', resultStatus: 'submitted', round: 'R1', position: 1, score: {}, updateTime: new Date(), player1: {}, player2: {} },
      { _id: 'mr_b', tournamentId: 't2', resultStatus: 'submitted', round: 'R1', position: 1, score: {}, updateTime: new Date(), player1: {}, player2: {} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' }, t2: { _id: 't2', name: 'B' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: 't1', limit: 50 })
  expect(result.items).toHaveLength(1)
  expect(result.items[0].tournamentId).toBe('t1')
})

test('pendingReviewItems truncated when over limit', async () => {
  const rows = Array.from({ length: 80 }).map((_, i) => ({
    _id: `mr_${i}`, tournamentId: 't1', resultStatus: 'submitted',
    round: 'R1', position: i, score: {}, updateTime: new Date(),
    player1: {}, player2: {},
  }))
  const ctx = makeQueryCtx({
    rows,
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: null, limit: 50 })
  expect(result.items).toHaveLength(50)
  expect(result.truncated).toBe(true)
})

test('pendingEntryGroups FORBIDDEN: non-admin', async () => {
  const ctx = makeQueryCtx({ isAdmin: false })
  await expect(pendingEntryGroups(ctx, { limit: 50 }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('pendingEntryGroups returns only playable pending matches for existing active tournaments', async () => {
  const updateTime = new Date('2026-05-18T10:00:00.000Z')
  const ctx = makeQueryCtx({
    rows: [
      {
        _id: 'mr_pending',
        sourceMatchId: 'source_pending',
        tournamentId: 't_active',
        resultStatus: 'pending',
        round: 1,
        position: 1,
        player1: { id: 'p1', name: '杜导' },
        player2: { id: 'p2', name: '小野马' },
        updateTime,
      },
      {
        _id: 'mr_confirmed',
        tournamentId: 't_active',
        resultStatus: 'confirmed',
        round: 1,
        position: 2,
        player1: { id: 'p3', name: 'A' },
        player2: { id: 'p4', name: 'B' },
        updateTime,
      },
      {
        _id: 'mr_deleted_tournament',
        tournamentId: 't_deleted',
        resultStatus: 'pending',
        round: 1,
        position: 1,
        player1: { id: 'p5', name: 'C' },
        player2: { id: 'p6', name: 'D' },
        updateTime,
      },
      {
        _id: 'mr_completed_tournament',
        tournamentId: 't_completed',
        resultStatus: 'pending',
        round: 1,
        position: 1,
        player1: { id: 'p7', name: 'E' },
        player2: { id: 'p8', name: 'F' },
        updateTime,
      },
      {
        _id: 'mr_waiting_slot',
        tournamentId: 't_active',
        resultStatus: 'pending',
        round: 2,
        position: 1,
        player1: { id: 'p1', name: '杜导' },
        player2: null,
        updateTime,
      },
    ],
    tournaments: {
      t_active: { _id: 't_active', name: '5.17常规赛', status: 'ongoing', format: 'regular' },
      t_completed: { _id: 't_completed', name: '已结束赛事', status: 'completed', format: 'regular' },
    },
  })

  const result = await pendingEntryGroups(ctx, { limit: 50 })

  expect(result.groups).toHaveLength(1)
  expect(result.groups[0]).toMatchObject({
    _id: 't_active:1',
    tournamentId: 't_active',
    tournamentName: '5.17常规赛',
    round: 1,
    updateTime,
    matches: [{
      matchId: 'source_pending',
      resultId: 'mr_pending',
      player1: { id: 'p1', name: '杜导' },
      player2: { id: 'p2', name: '小野马' },
    }],
  })
  expect(result.truncated).toBe(false)
})
