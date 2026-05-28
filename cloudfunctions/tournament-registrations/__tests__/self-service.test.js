const mockDb = {
  command: {
    or: jest.fn((conditions) => ({ $or: conditions })),
    in: jest.fn((values) => ({ $in: values })),
    inc: jest.fn((delta) => ({ __op: 'inc', delta })),
    remove: jest.fn(() => ({ __op: 'remove' }))
  },
  serverDate: jest.fn(() => 'SERVER_DATE'),
  runTransaction: jest.fn(async (handler) => handler({ collection: jest.fn() })),
  collection: jest.fn()
}

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test-env',
  getWXContext: jest.fn(() => ({ OPENID: 'openid-a' })),
  database: jest.fn(() => mockDb)
}), { virtual: true })

const {
  buildRegistrationId,
  selfRegister,
  withdrawRegistration,
  isAffectedMatch,
  hasSubmittedScore
} = require('../lib/service')

const TID = 'tournament_open-2026'
const NOW = '2026-05-21T10:00:00+08:00'
const SERVER_DATE = 'SERVER_DATE'

function tournament(overrides = {}) {
  return {
    _id: TID,
    seasonId: 'season-2026',
    type: 'singles',
    format: 'regular',
    status: 'upcoming',
    registrationPublishedAt: '2026-05-20T00:00:00+08:00',
    registrationDeadlineAt: '2026-05-22T23:59:59+08:00',
    startDate: '2026-05-24',
    confirmedCount: 0,
    scheduleStatus: 'none',
    ...overrides
  }
}

function member(overrides = {}) {
  return {
    _id: 'member-a',
    openid: 'openid-a',
    name: 'Alice',
    avatarUrl: 'cloud://avatar-a',
    claimStatus: 'claimed',
    status: 'active',
    ...overrides
  }
}

function registration(overrides = {}) {
  return {
    _id: 'reg_existing',
    tournamentId: TID,
    seasonId: 'season-2026',
    type: 'singles',
    playerId: 'member-a',
    playerName: 'Alice',
    registrationStatus: 'confirmed',
    source: 'wechat',
    ...overrides
  }
}

function makeCtx(options = {}) {
  const state = {
    tournament: options.tournament || tournament(),
    member: options.member === undefined ? member() : options.member,
    registrations: (options.registrations || []).map(row => ({ ...row })),
    matchResults: (options.matchResults || []).map(row => ({ ...row })),
    matchResultsError: options.matchResultsError || null,
    brackets: (options.brackets || []).map(row => ({
      ...row,
      matches: (row.matches || []).map(match => ({ ...match }))
    })),
    bracketsError: options.bracketsError || null
  }
  const calls = []
  let inTransaction = false
  let txId = 0

  const record = (op) => {
    calls.push({ op, inTransaction, txId: inTransaction ? txId : null })
  }

  const tx = {
    getTournament: jest.fn(async () => {
      record('getTournament')
      return state.tournament
    }),
    getMemberByOpenid: jest.fn(async () => {
      record('getMemberByOpenid')
      return state.member
    }),
    listRegistrations: jest.fn(async () => {
      record('listRegistrations')
      return state.registrations
    }),
    upsertRegistration: jest.fn(async (id, data) => {
      record('upsertRegistration')
      const idx = state.registrations.findIndex(row => row._id === id)
      if (idx >= 0) {
        const existing = state.registrations[idx]
        const existingMemberId = existing.playerId || existing.memberId
        const nextMemberId = data.playerId || data.memberId
        if (existing.tournamentId !== data.tournamentId || existingMemberId !== nextMemberId) {
          const err = new Error('registration id conflict')
          err.code = 'REGISTRATION_ID_CONFLICT'
          throw err
        }
        state.registrations[idx] = { ...state.registrations[idx], ...data, _id: id }
      } else {
        state.registrations.push({ ...data, _id: id })
      }
    }),
    updateRegistration: jest.fn(async (id, data) => {
      record('updateRegistration')
      const idx = state.registrations.findIndex(row => row._id === id)
      if (idx >= 0) state.registrations[idx] = { ...state.registrations[idx], ...data }
    }),
    updateTournament: jest.fn(async (id, data) => {
      record('updateTournament')
      if (id !== state.tournament._id) throw new Error(`unexpected tournament ${id}`)
      Object.keys(data).forEach(key => {
        const value = data[key]
        if (value && value.__op === 'inc') {
          state.tournament[key] = Number(state.tournament[key] || 0) + value.delta
        } else {
          state.tournament[key] = value
        }
      })
    }),
    listMatchResults: jest.fn(async () => {
      record('listMatchResults')
      if (state.matchResultsError) throw state.matchResultsError
      return state.matchResults
    }),
    listBrackets: jest.fn(async () => {
      record('listBrackets')
      if (state.bracketsError) throw state.bracketsError
      return state.brackets
    })
  }

  const ctx = {
    openid: options.openid || 'openid-a',
    now: () => options.now || NOW,
    serverDate: () => SERVER_DATE,
    inc: (delta) => ({ __op: 'inc', delta }),
    runTransaction: jest.fn(async (handler) => {
      calls.push({ op: 'runTransaction:start', inTransaction: false, txId: txId + 1 })
      txId += 1
      inTransaction = true
      try {
        return await handler(tx)
      } finally {
        inTransaction = false
        calls.push({ op: 'runTransaction:end', inTransaction: false, txId })
      }
    }),
    db: {
      updateBracketMatches: jest.fn(async (tournamentId, patches) => {
        record('updateBracketMatches')
        patches.forEach(patch => {
          const idx = state.brackets.findIndex(row => row._id === patch.bracketId)
          if (idx >= 0) state.brackets[idx] = { ...state.brackets[idx], matches: patch.matches }
        })
      })
    }
  }

  return { ctx, state, tx, calls }
}

test('buildRegistrationId is deterministic and safe for document ids', () => {
  expect(buildRegistrationId('tournament_2026_123456_001', 4)).toBe('reg_2026_123456_001_004')
})

test('selfRegister creates a confirmed personal registration', async () => {
  const { ctx, state } = makeCtx()

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({
    success: true,
    data: { registrationId: 'reg_open-2026_001', reused: false }
  })
  expect(state.registrations).toHaveLength(1)
  expect(state.registrations[0]).toMatchObject({
    _id: 'reg_open-2026_001',
    tournamentId: TID,
    seasonId: 'season-2026',
    type: 'singles',
    playerId: 'member-a',
    playerName: 'Alice',
    registrationStatus: 'confirmed',
    source: 'wechat',
    registerTime: SERVER_DATE,
    createTime: SERVER_DATE,
    updateTime: SERVER_DATE
  })
  expect(state.tournament.confirmedCount).toBe(1)
})

test('selfRegister uses next unused index-based registration id', async () => {
  const { ctx, state } = makeCtx({
    registrations: [
      registration({ _id: 'reg_open-2026_001', playerId: 'member-b', playerName: 'Bob' }),
      registration({ _id: 'reg_open-2026_003', playerId: 'member-c', playerName: 'Carol' })
    ]
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({
    success: true,
    data: { registrationId: 'reg_open-2026_002', reused: false }
  })
  expect(state.registrations.map(row => row._id).sort()).toEqual([
    'reg_open-2026_001',
    'reg_open-2026_002',
    'reg_open-2026_003'
  ])
  expect(state.registrations.find(row => row._id === 'reg_open-2026_002')).toMatchObject({
    playerId: 'member-a',
    registrationStatus: 'confirmed'
  })
})

test('selfRegister reuses a withdrew row and clears cancellation fields', async () => {
  const withdrew = registration({
    _id: 'reg_old',
    registrationStatus: 'withdrew',
    cancelledAt: '2026-05-20T10:00:00+08:00',
    cancelledBy: 'admin',
    cancelReason: 'busy'
  })
  const { ctx, state } = makeCtx({ registrations: [withdrew] })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({
    success: true,
    data: { registrationId: 'reg_old', reused: true }
  })
  expect(state.registrations[0]).toMatchObject({
    _id: 'reg_old',
    registrationStatus: 'confirmed',
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    reregisteredAt: SERVER_DATE,
    updateTime: SERVER_DATE
  })
  expect(state.tournament.confirmedCount).toBe(1)
})

test('selfRegister rejects duplicate active registration', async () => {
  const { ctx, state, tx } = makeCtx({ registrations: [registration()] })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'ALREADY_REGISTERED' } })
  expect(tx.upsertRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
  expect(state.registrations[0].registrationStatus).toBe('confirmed')
})

test('selfRegister allows bound legacy member without claimStatus', async () => {
  const { ctx, state } = makeCtx({
    member: {
      _id: 'member-a',
      openid: 'openid-a',
      name: 'Alice',
      status: 'active'
    }
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({
    success: true,
    data: { registrationId: 'reg_open-2026_001', reused: false }
  })
  expect(state.registrations[0]).toMatchObject({
    playerId: 'member-a',
    playerName: 'Alice',
    registrationStatus: 'confirmed'
  })
})

test('selfRegister rejects member without openid binding', async () => {
  const { ctx, tx } = makeCtx({
    member: {
      _id: 'member-a',
      name: 'Alice',
      status: 'active'
    }
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'MEMBER_REQUIRED' } })
  expect(tx.listRegistrations).not.toHaveBeenCalled()
  expect(tx.upsertRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
})

test('selfRegister allows non-creator admin member without claimStatus', async () => {
  const { ctx, state } = makeCtx({
    tournament: tournament({ createdBy: 'admin-other' }),
    member: {
      _id: 'member-a',
      openid: 'openid-a',
      name: 'Alice',
      admin: true,
      status: 'active'
    }
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({
    success: true,
    data: { registrationId: 'reg_open-2026_001', reused: false }
  })
  expect(state.registrations[0]).toMatchObject({
    playerId: 'member-a',
    playerName: 'Alice',
    registrationStatus: 'confirmed'
  })
})

test.each([
  ['createdBy member id', { createdBy: 'member-a' }],
  ['createdByOpenid', { createdBy: 'member-other', createdByOpenid: 'openid-a' }]
])('selfRegister rejects tournament creator by %s', async (_label, tournamentPatch) => {
  const { ctx, tx } = makeCtx({
    tournament: tournament(tournamentPatch)
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'CREATOR_CANNOT_REGISTER' } })
  expect(tx.listRegistrations).not.toHaveBeenCalled()
  expect(tx.upsertRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
})

test.each(['pending', 'unclaimed'])('selfRegister rejects member with claimStatus=%s', async (claimStatus) => {
  const { ctx, tx } = makeCtx({ member: member({ claimStatus }) })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'MEMBER_REQUIRED' } })
  expect(tx.listRegistrations).not.toHaveBeenCalled()
  expect(tx.upsertRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
})

test('selfRegister maps knockout singles tournament confirmedCount cap to CAPACITY_FULL', async () => {
  const fullTournament = tournament({
    format: 'knockout',
    type: 'singles',
    maxPlayers: 2,
    confirmedCount: 2
  })
  const { ctx, tx } = makeCtx({
    tournament: fullTournament,
    registrations: [
      registration({ _id: 'reg_b', playerId: 'member-b', playerName: 'Bob' })
    ]
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'CAPACITY_FULL' } })
  expect(tx.upsertRegistration).not.toHaveBeenCalled()
})

test('selfRegister blocks when active rows exceed stale confirmedCount cap', async () => {
  const fullTournament = tournament({
    format: 'knockout',
    type: 'singles',
    maxPlayers: 8,
    confirmedCount: 7
  })
  const activeRows = Array.from({ length: 8 }, (_, index) => registration({
    _id: buildRegistrationId(TID, index + 1),
    playerId: `member-${index + 1}`,
    playerName: `Player ${index + 1}`
  }))
  const { ctx, tx } = makeCtx({
    tournament: fullTournament,
    registrations: activeRows
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'CAPACITY_FULL' } })
  expect(tx.upsertRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
})

test('selfRegister maps group knockout active-row bracketSize cap to CAPACITY_FULL', async () => {
  const fullTournament = tournament({
    format: 'group_knockout',
    type: 'singles',
    bracketSize: 16,
    confirmedCount: 15
  })
  const activeRows = Array.from({ length: 16 }, (_, index) => registration({
    _id: buildRegistrationId(TID, index + 1),
    playerId: `member-${index + 1}`,
    playerName: `Player ${index + 1}`
  }))
  const { ctx, tx } = makeCtx({
    tournament: fullTournament,
    registrations: activeRows
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'CAPACITY_FULL' } })
  expect(tx.upsertRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
})

test('selfRegister repairs stale low confirmedCount on successful registration', async () => {
  const { ctx, state } = makeCtx({
    tournament: tournament({ confirmedCount: 1 }),
    registrations: [
      registration({ _id: buildRegistrationId(TID, 1), playerId: 'member-b', playerName: 'Bob' }),
      registration({ _id: buildRegistrationId(TID, 2), playerId: 'member-c', playerName: 'Carol' })
    ]
  })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: true })
  expect(state.tournament.confirmedCount).toBe(3)
})

test('selfRegister skips occupied index without overwriting existing registration', async () => {
  const colliding = registration({
    _id: buildRegistrationId(TID, 1),
    playerId: 'member-z',
    playerName: 'Zed',
    registrationStatus: 'withdrew',
    status: 'withdrew'
  })
  const { ctx, state, tx } = makeCtx({ registrations: [colliding] })

  const res = await selfRegister(ctx, { tournamentId: TID })

  expect(res).toMatchObject({
    success: true,
    data: { registrationId: buildRegistrationId(TID, 2) }
  })
  expect(state.registrations[0]).toMatchObject({
    _id: buildRegistrationId(TID, 1),
    playerId: 'member-z',
    playerName: 'Zed',
    registrationStatus: 'withdrew'
  })
  expect(state.registrations.find(row => row._id === buildRegistrationId(TID, 2))).toMatchObject({
    playerId: 'member-a',
    registrationStatus: 'confirmed'
  })
  expect(tx.updateTournament).toHaveBeenCalled()
})

test('withdrawRegistration blocks after withdraw deadline', async () => {
  const { ctx, state, tx } = makeCtx({
    registrations: [registration()],
    now: '2026-05-24T00:01:00+08:00'
  })

  const res = await withdrawRegistration(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'WITHDRAW_CLOSED' } })
  expect(tx.updateRegistration).not.toHaveBeenCalled()
  expect(state.registrations[0].registrationStatus).toBe('confirmed')
})

test('withdrawRegistration fails closed when caller has duplicate active registrations', async () => {
  const { ctx, state, tx } = makeCtx({
    tournament: tournament({ confirmedCount: 2 }),
    registrations: [
      registration({ _id: 'reg_dup_1' }),
      registration({ _id: 'reg_dup_2' })
    ]
  })

  const res = await withdrawRegistration(ctx, { tournamentId: TID })

  expect(res).toMatchObject({
    success: false,
    error: { code: 'DUPLICATE_ACTIVE_REGISTRATION' }
  })
  expect(tx.updateRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
  expect(state.registrations.map(row => row.registrationStatus)).toEqual(['confirmed', 'confirmed'])
  expect(state.tournament.confirmedCount).toBe(2)
})

test('withdrawRegistration rejects member with non-claimed claimStatus', async () => {
  const { ctx, state, tx } = makeCtx({
    member: member({ claimStatus: 'pending' }),
    registrations: [registration()]
  })

  const res = await withdrawRegistration(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'MEMBER_REQUIRED' } })
  expect(tx.listRegistrations).not.toHaveBeenCalled()
  expect(tx.updateRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
  expect(state.registrations[0].registrationStatus).toBe('confirmed')
})

test('withdrawRegistration fails closed when match_results cannot be read', async () => {
  const { ctx, state, tx } = makeCtx({
    tournament: tournament({ scheduleStatus: 'published', confirmedCount: 1 }),
    registrations: [registration()],
    matchResultsError: new Error('match read failed')
  })

  const res = await withdrawRegistration(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'MATCH_RESULTS_UNAVAILABLE' } })
  expect(tx.updateRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
  expect(state.registrations[0].registrationStatus).toBe('confirmed')
  expect(state.tournament.confirmedCount).toBe(1)
})

test('withdrawRegistration fails closed when tournament_brackets cannot be read', async () => {
  const { ctx, state, tx } = makeCtx({
    tournament: tournament({ scheduleStatus: 'published', confirmedCount: 1 }),
    registrations: [registration()],
    matchResults: [
      { _id: 'result_1', tournamentId: TID, resultStatus: 'pending', playerIds: ['member-b'] }
    ],
    bracketsError: new Error('bracket read failed')
  })

  const res = await withdrawRegistration(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'BRACKETS_UNAVAILABLE' } })
  expect(tx.updateRegistration).not.toHaveBeenCalled()
  expect(tx.updateTournament).not.toHaveBeenCalled()
  expect(state.registrations[0].registrationStatus).toBe('confirmed')
  expect(state.tournament.confirmedCount).toBe(1)
})

test('withdrawRegistration blocks when an affected match already has a submitted score', async () => {
  const { ctx, state, tx } = makeCtx({
    tournament: tournament({ scheduleStatus: 'published', confirmedCount: 1 }),
    registrations: [registration()],
    matchResults: [
      { _id: 'result_1', tournamentId: TID, resultStatus: 'submitted', playerIds: ['member-a'] }
    ]
  })

  const res = await withdrawRegistration(ctx, { tournamentId: TID })

  expect(res).toMatchObject({ success: false, error: { code: 'MATCH_HAS_RESULT' } })
  expect(tx.updateRegistration).not.toHaveBeenCalled()
  expect(state.registrations[0].registrationStatus).toBe('confirmed')
})

test('withdrawRegistration marks schedule revision and affected bracket matches when published schedule has no submitted score', async () => {
  const { ctx, state } = makeCtx({
    tournament: tournament({ scheduleStatus: 'published', confirmedCount: 1 }),
    registrations: [registration()],
    matchResults: [
      { _id: 'result_1', tournamentId: TID, resultStatus: 'pending', playerIds: ['member-a'], sourceMatchId: 'm1' }
    ],
    brackets: [
      {
        _id: 'bracket_1',
        tournamentId: TID,
        round: 1,
        matches: [
          { matchId: 'm1', player1: { id: 'member-a', registrationId: 'reg_existing' }, player2: { id: 'member-b' }, resultStatus: 'pending' },
          { matchId: 'm2', player1: { id: 'member-c' }, player2: { id: 'member-d' }, resultStatus: 'pending' }
        ]
      }
    ]
  })

  const res = await withdrawRegistration(ctx, { tournamentId: TID, cancelReason: 'injury' })

  expect(res).toMatchObject({ success: true, data: { scheduleNeedsRevision: true } })
  expect(state.registrations[0]).toMatchObject({
    registrationStatus: 'withdrew',
    cancelledAt: SERVER_DATE,
    cancelledBy: 'member-a',
    cancelReason: 'injury',
    updateTime: SERVER_DATE
  })
  expect(state.tournament.confirmedCount).toBe(0)
  expect(state.tournament.scheduleNeedsRevision).toBe(true)
  expect(ctx.db.updateBracketMatches).toHaveBeenCalledWith(TID, expect.any(Array), SERVER_DATE)
  expect(state.brackets[0].matches[0].needsRevision).toBe(true)
  expect(state.brackets[0].matches[1].needsRevision).toBeUndefined()
})

test('selfRegister keeps registration read/write operations inside one transaction', async () => {
  const { ctx, calls } = makeCtx()

  await selfRegister(ctx, { tournamentId: TID })

  const txCalls = calls.filter(call => !call.op.startsWith('runTransaction'))
  expect(calls.map(call => call.op)).toEqual([
    'runTransaction:start',
    'getTournament',
    'getMemberByOpenid',
    'listRegistrations',
    'upsertRegistration',
    'updateTournament',
    'runTransaction:end'
  ])
  expect(txCalls.every(call => call.inTransaction && call.txId === 1)).toBe(true)
})

test('buildServiceCtx delegates transactions to wx db.runTransaction', async () => {
  let transactionPromise
  jest.isolateModules(() => {
    const { __test__ } = require('../index')
    const ctx = __test__.buildServiceCtx({ OPENID: 'openid-a' })
    mockDb.runTransaction.mockClear()

    transactionPromise = ctx.runTransaction(async (tx) => {
      expect(tx).toHaveProperty('getTournament')
      return 'ok'
    })
  })
  await expect(transactionPromise).resolves.toBe('ok')
  expect(mockDb.runTransaction).toHaveBeenCalledTimes(1)
})

test('buildServiceCtx upsertRegistration refuses conflicting existing registration id', async () => {
  const update = jest.fn(async () => ({ stats: { updated: 1 } }))
  const add = jest.fn(async () => ({ _id: 'created' }))
  const get = jest.fn(async () => ({
    data: {
      _id: buildRegistrationId(TID, 1),
      tournamentId: TID,
      playerId: 'member-z'
    }
  }))
  const doc = jest.fn(() => ({ get, update }))
  const transaction = {
    collection: jest.fn(() => ({ doc, add }))
  }

  let transactionPromise
  jest.isolateModules(() => {
    const { __test__ } = require('../index')
    const ctx = __test__.buildServiceCtx({ OPENID: 'openid-a' })
    mockDb.runTransaction.mockImplementationOnce(async (handler) => handler(transaction))

    transactionPromise = ctx.runTransaction((tx) => tx.upsertRegistration(
      buildRegistrationId(TID, 1),
      { tournamentId: TID, playerId: 'member-a' }
    ))
  })

  await expect(transactionPromise).rejects.toMatchObject({ code: 'REGISTRATION_ID_CONFLICT' })
  expect(update).not.toHaveBeenCalled()
  expect(add).not.toHaveBeenCalled()
})

test('isAffectedMatch and hasSubmittedScore cover legacy and registrationStatus shapes', () => {
  expect(isAffectedMatch({
    player1: { id: 'member-a', registrationId: 'reg_existing' },
    player2: { id: 'member-b' }
  }, registration())).toBe(true)
  expect(isAffectedMatch({ playerIds: ['member-z'] }, registration())).toBe(false)
  expect(hasSubmittedScore({ resultStatus: 'settled' })).toBe(true)
  expect(hasSubmittedScore({ resultStatus: 'pending' })).toBe(false)
})

test('updateStatus(withdrew) synchronizes registrationStatus', async () => {
  const update = jest.fn(async () => ({ stats: { updated: 1 } }))
  const doc = jest.fn(() => ({ update }))
  mockDb.collection.mockImplementation(() => ({ doc }))

  let main
  jest.isolateModules(() => {
    ;({ main } = require('../index'))
  })

  const res = await main({ action: 'updateStatus', id: 'reg-1', status: 'withdrew' }, {})

  expect(res).toMatchObject({ success: true, _id: 'reg-1', status: 'withdrew' })
  expect(update).toHaveBeenCalledWith({
    data: expect.objectContaining({
      registrationStatus: 'withdrew',
      updateTime: expect.any(String)
    })
  })
  expect(update.mock.calls[0][0].data).not.toHaveProperty('status')
})

test('updateStatus rejects legacy registered status without writing', async () => {
  const update = jest.fn(async () => ({ stats: { updated: 1 } }))
  const doc = jest.fn(() => ({ update }))
  mockDb.collection.mockImplementation(() => ({ doc }))

  let main
  jest.isolateModules(() => {
    ;({ main } = require('../index'))
  })

  const res = await main({ action: 'updateStatus', id: 'reg-1', status: 'registered' }, {})

  expect(res).toMatchObject({
    success: false,
    error: { code: 'INVALID_STATUS' }
  })
  expect(update).not.toHaveBeenCalled()
})

test('bulkSet rejects non-admin caller before replacing registrations', async () => {
  const memberWhere = jest.fn(() => ({
    get: jest.fn(async () => ({ data: [{ _id: 'member-a', openid: 'openid-a', admin: false }] }))
  }))
  const tournamentGet = jest.fn(async () => ({ data: tournament() }))
  const add = jest.fn(async () => ({ _id: 'created' }))
  const registrationWhere = jest.fn(() => ({
    get: jest.fn(async () => ({ data: [] }))
  }))
  mockDb.collection.mockImplementation(name => {
    if (name === 'members') return { where: memberWhere }
    if (name === 'tournaments') return { doc: jest.fn(() => ({ get: tournamentGet })) }
    if (name === 'tournament_registrations') {
      return {
        where: registrationWhere,
        doc: jest.fn(() => ({ remove: jest.fn(async () => ({ removed: 1 })) })),
        add
      }
    }
    return { where: jest.fn(() => ({ get: jest.fn(async () => ({ data: [] })) })) }
  })

  let main
  jest.isolateModules(() => {
    ;({ main } = require('../index'))
  })

  const res = await main({
    action: 'bulkSet',
    tournamentId: TID,
    registrations: [{ playerId: 'member-a', playerName: 'Alice' }]
  }, {})

  expect(res).toEqual({
    success: false,
    error: { code: 'FORBIDDEN', message: '需要管理员权限' }
  })
  expect(tournamentGet).not.toHaveBeenCalled()
  expect(add).not.toHaveBeenCalled()
})

test('bulkSet allows admin caller to replace registrations', async () => {
  const memberWhere = jest.fn(() => ({
    get: jest.fn(async () => ({ data: [{ _id: 'admin-a', openid: 'openid-a', admin: true }] }))
  }))
  const tournamentGet = jest.fn(async () => ({ data: tournament() }))
  const add = jest.fn(async () => ({ _id: 'created' }))
  const registrationWhere = jest.fn(() => ({
    get: jest.fn(async () => ({ data: [] }))
  }))
  mockDb.collection.mockImplementation(name => {
    if (name === 'members') return { where: memberWhere }
    if (name === 'tournaments') return { doc: jest.fn(() => ({ get: tournamentGet })) }
    if (name === 'tournament_registrations') {
      return {
        where: registrationWhere,
        doc: jest.fn(() => ({ remove: jest.fn(async () => ({ removed: 1 })) })),
        add
      }
    }
    return { where: jest.fn(() => ({ get: jest.fn(async () => ({ data: [] })) })) }
  })

  let main
  jest.isolateModules(() => {
    ;({ main } = require('../index'))
  })

  const res = await main({
    action: 'bulkSet',
    tournamentId: TID,
    registrations: [{ playerId: 'member-b', playerName: 'Bob' }]
  }, {})

  expect(res).toEqual({ success: true, data: { count: 1 } })
  expect(tournamentGet).toHaveBeenCalled()
  expect(add).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      tournamentId: TID,
      playerId: 'member-b',
      playerName: 'Bob',
      registrationStatus: 'confirmed'
    })
  }))
})

test('list status filter uses registrationStatus before legacy status', async () => {
  const rows = [
    { _id: 'new-active', tournamentId: TID, registrationStatus: 'confirmed', status: 'withdrew', seed: 1 },
    { _id: 'legacy-active', tournamentId: TID, status: 'confirmed', seed: 2 },
    { _id: 'new-withdrew', tournamentId: TID, registrationStatus: 'withdrew', status: 'confirmed', seed: 3 },
    { _id: 'other', tournamentId: 'other', registrationStatus: 'confirmed', status: 'confirmed', seed: 4 }
  ]
  let currentQuery = {}
  const chain = {
    where: jest.fn((query) => {
      currentQuery = query || {}
      return chain
    }),
    orderBy: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    get: jest.fn(async () => ({
      data: rows.filter(row => (
        (!currentQuery.tournamentId || row.tournamentId === currentQuery.tournamentId) &&
        (!currentQuery.status || row.status === currentQuery.status) &&
        (!currentQuery.registrationStatus || row.registrationStatus === currentQuery.registrationStatus)
      ))
    })),
    count: jest.fn(async () => ({
      total: rows.filter(row => (
        (!currentQuery.tournamentId || row.tournamentId === currentQuery.tournamentId) &&
        (!currentQuery.status || row.status === currentQuery.status) &&
        (!currentQuery.registrationStatus || row.registrationStatus === currentQuery.registrationStatus)
      )).length
    }))
  }
  mockDb.collection.mockImplementation(() => chain)

  let main
  jest.isolateModules(() => {
    ;({ main } = require('../index'))
  })

  const res = await main({
    action: 'list',
    tournamentId: TID,
    status: 'confirmed',
    pageSize: 20,
    pageNum: 1
  }, {})

  expect(res.success).toBe(true)
  expect(res.data.map(row => row._id)).toEqual(['new-active', 'legacy-active'])
  expect(res.total).toBe(2)
  expect(chain.where).toHaveBeenCalledWith({ tournamentId: TID })
})
