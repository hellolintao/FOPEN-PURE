const { mySummary } = require('../../handlers/my-summary')

function makeCtx({ memberId = 'mA', allMatches = [], registrations = [], tournaments = {}, now = '2026-05-22T12:00:00+08:00' } = {}) {
  return {
    callerMemberId: memberId,
    now: () => now,
    db: {
      queryMyPending: async (mid) => allMatches.filter(m =>
        m.resultStatus === 'pending' &&
        (m.playerIds || []).includes(mid)
      ),
      queryMySubmitted: async (mid) => allMatches.filter(m =>
        m.resultStatus === 'submitted' &&
        (m.playerIds || []).includes(mid)
      ),
      queryMyConfirmed: async (mid, limit) => allMatches.filter(m =>
        m.resultStatus === 'confirmed' &&
        (m.playerIds || []).includes(mid)
      ).slice(0, limit),
      queryMyRegistrations: async (mid) => registrations.filter(r =>
        r.playerId === mid ||
        r.partnerId === mid ||
        r.memberId === mid ||
        (Array.isArray(r.playerIds) && r.playerIds.includes(mid)) ||
        (Array.isArray(r.memberIds) && r.memberIds.includes(mid))
      ),
      getTournamentsByIds: async (ids) => ids.map(id => tournaments[id]).filter(Boolean),
    },
  }
}

test('mySummary returns three buckets', async () => {
  const ctx = makeCtx({
    allMatches: [
      { _id: 'mr_p', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mA', 'mB'], round: 'R1', position: 1, player1: { name: '我' }, player2: { name: '对手' } },
      { _id: 'mr_s', tournamentId: 't1', resultStatus: 'submitted', playerIds: ['mA', 'mB'], round: 'R1', position: 2, score: { sets: [{ a: 4, b: 2 }] }, submittedAt: new Date() },
      { _id: 'mr_c', tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'], round: 'R2', position: 1, score: { sets: [{ a: 4, b: 0 }] },
        pointsAwarded: { entries: [{ memberId: 'mA', points: 15, role: 'winner' }] }, confirmedAt: new Date() },
    ],
    tournaments: { t1: { _id: 't1', name: 'XXX 杯' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending).toHaveLength(1)
  expect(result.submitted).toHaveLength(1)
  expect(result.confirmed).toHaveLength(1)
  expect(result.confirmed[0].pointsEarned).toBe(15)
})

test('mySummary pending matches partnerId', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      { _id: 'mr_p', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mX', 'mY', 'mA'], round: 'R1', position: 1, player1: {}, player2: {} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending).toHaveLength(1)
})

test('mySummary confirmed pointsEarned aggregates only my entries', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      { _id: 'mr_c', tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'], round: 'F', position: 1, score: {},
        pointsAwarded: { entries: [
          { memberId: 'mA', points: 15, role: 'winner' },
          { memberId: 'mA', points: 5, role: 'placement' },
          { memberId: 'mB', points: 8, role: 'loser' },
        ]} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.confirmed[0].pointsEarned).toBe(20)  // 15 + 5
})

test('mySummary marks confirmed winner from current match result fields', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      {
        _id: 'mr_c',
        tournamentId: 't1',
        resultStatus: 'confirmed',
        playerIds: ['mA', 'mB'],
        round: 'R1',
        position: 1,
        score: { sets: [{ a: 0, b: 4 }] },
        winner: { id: 'mA', name: 'Me' },
        winnerId: 'mA',
        pointsAwarded: { entries: [
          { memberId: 'mA', points: 20, role: 'winner' },
          { memberId: 'mB', points: 10, role: 'loser' },
        ] },
        confirmedAt: new Date(),
      },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })

  const result = await mySummary(ctx, { historyLimit: 10 })

  expect(result.confirmed[0].isWinner).toBe(true)
})

test('mySummary exposes scoreLabel from caller perspective when caller is player2', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      {
        _id: 'mr_c',
        tournamentId: 't1',
        resultStatus: 'confirmed',
        playerIds: ['mB', 'mA'],
        round: 1,
        position: 1,
        player1: { id: 'mB', name: 'Opponent' },
        player2: { id: 'mA', name: 'Me' },
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        pointsAwarded: { entries: [
          { memberId: 'mB', points: 20, role: 'winner' },
          { memberId: 'mA', points: 10, role: 'loser' },
        ] },
        confirmedAt: new Date(),
      },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })

  const result = await mySummary(ctx, { historyLimit: 10 })

  expect(result.confirmed[0]).toMatchObject({
    scoreLabel: '2:4',
    isWinner: false,
  })
})

test('mySummary flips legacy string score when caller is loserId', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      {
        _id: 'mr_legacy',
        tournamentId: 't1',
        resultStatus: 'confirmed',
        playerIds: ['mA', 'mB'],
        round: 1,
        position: 1,
        score: '4:2',
        winnerId: 'mB',
        loserId: 'mA',
        confirmedAt: new Date(),
      },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })

  const result = await mySummary(ctx, { historyLimit: 10 })

  expect(result.confirmed[0]).toMatchObject({
    scoreLabel: '2:4',
    isWinner: false,
  })
})

test('mySummary treats admin caller as player and does not include non-participant pending admin work', async () => {
  const ctx = makeCtx({
    memberId: 'admin1',
    allMatches: [
      { _id: 'mine_pending', tournamentId: 't1', resultStatus: 'pending', playerIds: ['admin1', 'mA'], round: 1, position: 1, player1: { name: 'Admin' }, player2: { name: 'A' } },
      { _id: 'other_submitted', tournamentId: 't1', resultStatus: 'submitted', playerIds: ['mB', 'mC'], round: 1, position: 2, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
    ],
    tournaments: { t1: { _id: 't1', name: 'E2E' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending.map(x => x.matchId)).toEqual(['mine_pending'])
  expect(result.submitted).toEqual([])
})

test('mySummary hides non-active score rows and explicit draft tournament rows', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      { _id: 'active_legacy', tournamentId: 't_legacy', resultStatus: 'pending', playerIds: ['mA', 'mB'], round: 1, position: 1, player1: { id: 'mA' }, player2: { id: 'mB' } },
      { _id: 'active_published', tournamentId: 't_published', resultStatus: 'pending', playerIds: ['mA', 'mC'], round: 1, position: 2, player1: { id: 'mA' }, player2: { id: 'mC' } },
      { _id: 'draft_row', tournamentId: 't_draft', resultStatus: 'pending', playerIds: ['mA', 'mD'], round: 1, position: 3, player1: { id: 'mA' }, player2: { id: 'mD' } },
      { _id: 'audit_row', tournamentId: 't_published', matchKind: 'audit', resultStatus: 'pending', playerIds: ['mA', 'mE'], round: 1, position: 4, player1: { id: 'mA' }, player2: { id: 'mE' } },
      { _id: 'history_row', tournamentId: 't_published', matchKind: 'history', archivedFrom: 'active_published', resultStatus: 'pending', playerIds: ['mA', 'mF'], round: 1, position: 5, player1: { id: 'mA' }, player2: { id: 'mF' } },
      { _id: 'invalidated_row', tournamentId: 't_published', resultStatus: 'invalidated', playerIds: ['mA', 'mG'], round: 1, position: 6, player1: { id: 'mA' }, player2: { id: 'mG' } },
      { _id: 'archived_row', tournamentId: 't_published', archivedFrom: 'active_published', resultStatus: 'pending', playerIds: ['mA', 'mH'], round: 1, position: 7, player1: { id: 'mA' }, player2: { id: 'mH' } },
    ],
    tournaments: {
      t_legacy: { _id: 't_legacy', name: 'Legacy' },
      t_published: { _id: 't_published', name: 'Published', scheduleStatus: 'published' },
      t_draft: { _id: 't_draft', name: 'Draft', scheduleStatus: 'draft' },
    },
  })

  const result = await mySummary(ctx, { historyLimit: 10 })

  expect(result.pending.map(row => row.matchId)).toEqual(['active_legacy', 'active_published'])
})

test('mySummary respects historyLimit', async () => {
  const matches = Array.from({ length: 15 }).map((_, i) => ({
    _id: `mr_${i}`, tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'],
    round: 'R1', position: i, score: {}, pointsAwarded: { entries: [] }, confirmedAt: new Date(),
  }))
  const ctx = makeCtx({ allMatches: matches, tournaments: { t1: { _id: 't1', name: 'A' } } })
  const result = await mySummary(ctx, { historyLimit: 5 })
  expect(result.confirmed).toHaveLength(5)
})

test('mySummary returns active registrations with withdraw status', async () => {
  const ctx = makeCtx({
    registrations: [
      { _id: 'reg1', tournamentId: 't1', playerId: 'mA', registrationStatus: 'confirmed' },
      { _id: 'reg2', tournamentId: 't2', playerId: 'mA', registrationStatus: 'withdrew' }
    ],
    tournaments: {
      t1: {
        _id: 't1',
        name: '5月周末赛',
        startDate: '2026-05-24',
        registrationPublishedAt: '2026-05-20T12:00:00+08:00',
        registrationDeadlineAt: '2026-05-23T18:00:00+08:00',
        scheduleStatus: 'none'
      },
      t2: { _id: 't2', name: '已退出赛事', startDate: '2026-05-24' }
    }
  })

  const summary = await mySummary(ctx, { historyLimit: 10 })

  expect(summary.registrations).toEqual([
    expect.objectContaining({
      tournamentId: 't1',
      tournamentName: '5月周末赛',
      statusLabel: '可退出',
      withdrawDeadlineLabel: '5月23日 24:00',
      canWithdraw: true
    })
  ])
})

test('mySummary returns registrations fetched by legacy member array fields', async () => {
  const ctx = makeCtx({
    registrations: [
      { _id: 'member-id', tournamentId: 't1', memberId: 'mA', registrationStatus: 'confirmed' },
      { _id: 'player-ids', tournamentId: 't2', playerIds: ['mA'], registrationStatus: 'confirmed' },
      { _id: 'member-ids', tournamentId: 't3', memberIds: ['mA'], registrationStatus: 'confirmed' },
      { _id: 'other', tournamentId: 't4', memberIds: ['mB'], registrationStatus: 'confirmed' }
    ],
    tournaments: {
      t1: { _id: 't1', name: 'memberId 赛事', startDate: '2026-05-24' },
      t2: { _id: 't2', name: 'playerIds 赛事', startDate: '2026-05-24' },
      t3: { _id: 't3', name: 'memberIds 赛事', startDate: '2026-05-24' },
      t4: { _id: 't4', name: '其他赛事', startDate: '2026-05-24' }
    }
  })

  const summary = await mySummary(ctx, { historyLimit: 10 })

  expect(summary.registrations.map(row => row.tournamentId)).toEqual(['t1', 't2', 't3'])
})
