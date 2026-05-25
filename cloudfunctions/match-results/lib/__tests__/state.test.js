const { createMatchStateService } = require('../state')
const award = require('../award')
const scoreRule = require('../score-rule')

function makeDb(seed) {
  const collections = JSON.parse(JSON.stringify(seed))
  const createdCollections = []
  // a very simple in-memory db emulator
  // Supports: doc(id).get/update/set/remove, where({...}).get/remove, where({...}).orderBy/limit ignored
  return {
    serverDate: () => new Date(),
    async createCollection(name) {
      createdCollections.push(name)
      collections[name] = collections[name] || []
    },
    collection(name) {
      const rows = collections[name] = collections[name] || []
      return _coll(rows)
    },
    __all: () => collections,
    __created: () => createdCollections
  }
  function _coll(rows) {
    return {
      doc(id) {
        return {
          async get() {
            const r = rows.find(x => x._id === id)
            if (!r) return { data: null }
            return { data: r }
          },
          async update({ data }) {
            const r = rows.find(x => x._id === id)
            if (!r) throw new Error('not found: ' + id)
            Object.assign(r, data)
          },
          async set({ data }) {
            if (Object.prototype.hasOwnProperty.call(data, '_id')) throw new Error('cannot update _id')
            const idx = rows.findIndex(x => x._id === id)
            if (idx < 0) rows.push({ ...data, _id: id })
            else rows[idx] = { ...data, _id: id }
          },
          async remove() {
            const idx = rows.findIndex(x => x._id === id)
            if (idx >= 0) rows.splice(idx, 1)
          }
        }
      },
      where(filter) {
        const matchFn = row => Object.entries(filter).every(([k, v]) => {
          if (v && typeof v === 'object' && v.$in) return v.$in.includes(row[k])
          return row[k] === v
        })
        return {
          orderBy() { return this },
          limit() { return this },
          async get() { return { data: rows.filter(matchFn) } },
          async remove() {
            const before = rows.length
            for (let i = rows.length - 1; i >= 0; i--) if (matchFn(rows[i])) rows.splice(i, 1)
            return { deleted: before - rows.length }
          }
        }
      }
    }
  }
}

function seed4Knockout() {
  return {
    tournaments: [{
      _id: 'T1', seasonId: 'S1', type: 'singles', format: 'knockout',
      pointsRules: { winLoss: { win: 20, loss: 10, walkover: 0 }, placement: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 } },
      status: 'ongoing'
    }],
    tournament_brackets: [
      { _id: 'bracket_T1_round_1', tournamentId: 'T1', round: 1, type: 'singles', matches: [
        { matchId: 'r1m1', round: 1, position: 1, player1: { id: 'A' }, player2: { id: 'B' }, bye: false, status: 'pending', resultStatus: 'pending', winner: null },
        { matchId: 'r1m2', round: 1, position: 2, player1: { id: 'C' }, player2: { id: 'D' }, bye: false, status: 'pending', resultStatus: 'pending', winner: null }
      ]},
      { _id: 'bracket_T1_round_2', tournamentId: 'T1', round: 2, type: 'singles', matches: [
        { matchId: 'r2m1', round: 2, position: 1, player1: null, player2: null, bye: false, status: 'pending', resultStatus: 'pending', winner: null }
      ]}
    ],
    match_results: [
      { _id: 'result_T1_r1m1', tournamentId: 'T1', sourceMatchId: 'r1m1', matchKind: 'bracket', round: 1, position: 1,
        player1: { id: 'A' }, player2: { id: 'B' }, playerIds: ['A','B'],
        resultStatus: 'pending', winner: null, pointsAwarded: null,
        tournamentType: 'singles', seasonId: 'S1', confirmedBy: null, confirmedAt: null },
      { _id: 'result_T1_r1m2', tournamentId: 'T1', sourceMatchId: 'r1m2', matchKind: 'bracket', round: 1, position: 2,
        player1: { id: 'C' }, player2: { id: 'D' }, playerIds: ['C','D'],
        resultStatus: 'pending', winner: null, pointsAwarded: null,
        tournamentType: 'singles', seasonId: 'S1', confirmedBy: null, confirmedAt: null },
      { _id: 'result_T1_r2m1', tournamentId: 'T1', sourceMatchId: 'r2m1', matchKind: 'bracket', round: 2, position: 1,
        player1: null, player2: null, playerIds: [],
        resultStatus: 'pending', winner: null, pointsAwarded: null,
        tournamentType: 'singles', seasonId: 'S1', confirmedBy: null, confirmedAt: null }
    ],
    tournament_registrations: [
      { _id: 'reg_T1_001', tournamentId: 'T1', playerId: 'A', registrationStatus: 'confirmed' },
      { _id: 'reg_T1_002', tournamentId: 'T1', playerId: 'B', registrationStatus: 'confirmed' },
      { _id: 'reg_T1_003', tournamentId: 'T1', playerId: 'C', registrationStatus: 'confirmed' },
      { _id: 'reg_T1_004', tournamentId: 'T1', playerId: 'D', registrationStatus: 'confirmed' }
    ],
    tournament_points: []
  }
}

describe('submitResult', () => {
  test('pending → admin submit → confirmed + award', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const rows = db.__all().match_results
    const r = rows.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('confirmed')
    expect(r.pointsAwarded.entries.length).toBe(2)
    expect(r.pointsAwarded.entries.find(e => e.memberId === 'A').role).toBe('winner')
  })

  test('admin submit by exact result id does not collide with reused sourceMatchId', async () => {
    const seed = seed4Knockout()
    seed.tournaments.push({
      _id: 'T2',
      seasonId: 'S1',
      type: 'singles',
      format: 'regular',
      pointsRules: { winLoss: { win: 20, loss: 10, walkover: 0 }, placement: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 } },
      status: 'ongoing'
    })
    seed.match_results.unshift({
      _id: 'result_T0_shared',
      tournamentId: 'T0',
      sourceMatchId: 'shared_m1',
      matchKind: 'regularRound',
      round: 1,
      position: 1,
      player1: { id: 'OLD_A' },
      player2: { id: 'OLD_B' },
      playerIds: ['OLD_A', 'OLD_B'],
      resultStatus: 'pending',
      winner: null,
      pointsAwarded: null,
      tournamentType: 'singles',
      seasonId: 'S1',
      confirmedBy: null,
      confirmedAt: null
    })
    seed.match_results.push({
      _id: 'result_T2_shared',
      tournamentId: 'T2',
      sourceMatchId: 'shared_m1',
      matchKind: 'regularRound',
      round: 1,
      position: 1,
      player1: { id: 'NEW_A' },
      player2: { id: 'NEW_B' },
      playerIds: ['NEW_A', 'NEW_B'],
      resultStatus: 'pending',
      winner: null,
      pointsAwarded: null,
      tournamentType: 'singles',
      seasonId: 'S1',
      confirmedBy: null,
      confirmedAt: null
    })
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 'result_T2_shared', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })

    const oldRow = db.__all().match_results.find(x => x._id === 'result_T0_shared')
    const newRow = db.__all().match_results.find(x => x._id === 'result_T2_shared')
    expect(oldRow.resultStatus).toBe('pending')
    expect(newRow.resultStatus).toBe('confirmed')
    expect(newRow.winnerId).toBe('NEW_A')
  })

  test('regular doubles confirmation awards both winners and both losers', async () => {
    const seed = seed4Knockout()
    seed.tournaments[0] = { ...seed.tournaments[0], _id: 'TD', type: 'doubles', format: 'regular' }
    seed.match_results = [{
      _id: 'result_TD_d1',
      tournamentId: 'TD',
      sourceMatchId: 'd1',
      matchKind: 'regularRound',
      round: 1,
      position: 1,
      player1: { id: 'A', partnerId: 'B' },
      player2: { id: 'C', partnerId: 'D' },
      playerIds: ['A', 'B', 'C', 'D'],
      resultStatus: 'pending',
      tournamentType: 'doubles',
      seasonId: 'S1',
      pointsAwarded: null,
    }]
    seed.tournament_registrations = ['A', 'B', 'C', 'D'].map(id => ({ _id: `reg_${id}`, tournamentId: 'TD', playerId: id, registrationStatus: 'confirmed' }))
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'd1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const row = db.__all().match_results[0]
    expect(row.pointsAwarded.entries.filter(e => e.role === 'winner').map(e => e.memberId)).toEqual(['A', 'B'])
    expect(row.pointsAwarded.entries.filter(e => e.role === 'loser').map(e => e.memberId)).toEqual(['C', 'D'])
  })

  test('mixed regular singles confirmation awards 2 entries as singles', async () => {
    const seed = seed4Knockout()
    seed.tournaments[0] = { ...seed.tournaments[0], _id: 'TM', type: 'mixed', format: 'regular' }
    seed.match_results = [{
      _id: 'result_TM_s1',
      tournamentId: 'TM',
      sourceMatchId: 's1',
      matchKind: 'regularRound',
      round: 1,
      position: 1,
      player1: { id: 'A' },
      player2: { id: 'B' },
      playerIds: ['A', 'B'],
      resultStatus: 'pending',
      tournamentType: 'singles',
      seasonId: 'S1',
      pointsAwarded: null,
    }]
    seed.tournament_registrations = ['A', 'B', 'C', 'D'].map(id => ({ _id: `reg_${id}`, tournamentId: 'TM', playerId: id, registrationStatus: 'confirmed' }))
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 's1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })

    const row = db.__all().match_results[0]
    expect(row.pointsAwarded.entries).toEqual([
      { memberId: 'A', points: 20, role: 'winner' },
      { memberId: 'B', points: 10, role: 'loser' }
    ])
  })

  test('mixed regular doubles confirmation awards 4 entries as doubles', async () => {
    const seed = seed4Knockout()
    seed.tournaments[0] = { ...seed.tournaments[0], _id: 'TM', type: 'mixed', format: 'regular' }
    seed.match_results = [{
      _id: 'result_TM_d1',
      tournamentId: 'TM',
      sourceMatchId: 'd1',
      matchKind: 'regularRound',
      round: 1,
      position: 1,
      player1: { id: 'A', partnerId: 'B' },
      player2: { id: 'C', partnerId: 'D' },
      playerIds: ['A', 'B', 'C', 'D'],
      resultStatus: 'pending',
      tournamentType: 'doubles',
      seasonId: 'S1',
      pointsAwarded: null,
    }]
    seed.tournament_registrations = ['A', 'B', 'C', 'D'].map(id => ({ _id: `reg_${id}`, tournamentId: 'TM', playerId: id, registrationStatus: 'confirmed' }))
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 'd1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })

    const row = db.__all().match_results[0]
    expect(row.pointsAwarded.entries.filter(e => e.role === 'winner').map(e => e.memberId)).toEqual(['A', 'B'])
    expect(row.pointsAwarded.entries.filter(e => e.role === 'loser').map(e => e.memberId)).toEqual(['C', 'D'])
  })

  test('regular tournament becomes ongoing after first score and completed after all playable matches are confirmed', async () => {
    const seed = seed4Knockout()
    seed.tournaments[0] = {
      ...seed.tournaments[0],
      _id: 'TR',
      type: 'singles',
      format: 'regular',
      status: 'upcoming'
    }
    seed.tournament_brackets = []
    seed.match_results = [
      {
        _id: 'result_TR_m1',
        tournamentId: 'TR',
        sourceMatchId: 'm1',
        matchKind: 'regularRound',
        round: 1,
        position: 1,
        player1: { id: 'A' },
        player2: { id: 'B' },
        playerIds: ['A', 'B'],
        resultStatus: 'pending',
        tournamentType: 'singles',
        seasonId: 'S1',
        pointsAwarded: null
      },
      {
        _id: 'result_TR_m2',
        tournamentId: 'TR',
        sourceMatchId: 'm2',
        matchKind: 'regularRound',
        round: 1,
        position: 2,
        player1: { id: 'C' },
        player2: { id: 'D' },
        playerIds: ['C', 'D'],
        resultStatus: 'pending',
        tournamentType: 'singles',
        seasonId: 'S1',
        pointsAwarded: null
      }
    ]
    seed.tournament_registrations = ['A', 'B', 'C', 'D'].map(id => ({ _id: `reg_${id}`, tournamentId: 'TR', playerId: id, registrationStatus: 'confirmed' }))
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 'm1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    expect(db.__all().tournaments[0].status).toBe('ongoing')
    expect(db.__all().tournaments[0].completedAt).toBeFalsy()

    await svc.submitResult({ matchId: 'm2', score: { sets: [{ a: 4, b: 1 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    expect(db.__all().tournaments[0].status).toBe('completed')
    expect(db.__all().tournaments[0].completedAt).toBeDefined()
  })

  test('tournament settlement ignores audit rows when checking completion', async () => {
    const seed = seed4Knockout()
    seed.tournaments[0] = {
      ...seed.tournaments[0],
      _id: 'TR',
      type: 'singles',
      format: 'regular',
      status: 'upcoming'
    }
    seed.tournament_brackets = []
    seed.match_results = [
      {
        _id: 'result_TR_m1',
        tournamentId: 'TR',
        sourceMatchId: 'm1',
        matchKind: 'regularRound',
        round: 1,
        position: 1,
        player1: { id: 'A' },
        player2: { id: 'B' },
        playerIds: ['A', 'B'],
        resultStatus: 'pending',
        tournamentType: 'singles',
        seasonId: 'S1',
        pointsAwarded: null
      },
      {
        _id: 'audit_TR_m1',
        tournamentId: 'TR',
        sourceMatchId: 'm_audit',
        matchKind: 'audit',
        round: 1,
        position: 99,
        player1: { id: 'C' },
        player2: { id: 'D' },
        playerIds: ['C', 'D'],
        resultStatus: 'pending',
        tournamentType: 'singles',
        seasonId: 'S1',
        pointsAwarded: null
      }
    ]
    seed.tournament_registrations = ['A', 'B'].map(id => ({ _id: `reg_${id}`, tournamentId: 'TR', playerId: id, registrationStatus: 'confirmed' }))
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 'm1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })

    expect(db.__all().tournaments[0].status).toBe('completed')
    expect(db.__all().match_results.find(x => x._id === 'audit_TR_m1').resultStatus).toBe('pending')
  })

  test('regular singles tiebreak 5-7 awards player2 as winner', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 3, b: 3 }], tiebreak: '5-7' }, submitter: { _id: 'admin1', isAdmin: true } })
    const row = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(row.winner).toEqual({ id: 'B' })
  })

  test('pending → player submit (是参赛者) → submitted（无 award）', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'A', isAdmin: false } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('submitted')
    expect(r.pointsAwarded).toBeNull()
  })

  test('submitted → 参赛者覆盖 → submitted（旧丢）', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'A', isAdmin: false } })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'B', isAdmin: false } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('submitted')
    expect(r.score.sets[0]).toEqual({ a: 4, b: 0 })
  })

  test('invalid score（4:3 直接录） → 抛 INVALID_SCORE', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 3 }], tiebreak: null }, submitter: { _id: 'a', isAdmin: true } }))
      .rejects.toThrow('INVALID_SCORE')
  })

  test('confirmed 普通会员覆盖 → 抛 UNAUTHORIZED (修订 #1)', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await expect(svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'A', isAdmin: false } }))
      .rejects.toThrow('UNAUTHORIZED')
  })

  test('未登录提交 → 抛 UNAUTHORIZED', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: null }))
      .rejects.toThrow('UNAUTHORIZED')
  })

  test('赛事参赛选手可提交本赛事任意比赛', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'C', isAdmin: false } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('submitted')
  })

  test('非本赛事参赛会员提交 → 抛 UNAUTHORIZED', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'STRANGER', isAdmin: false } }))
      .rejects.toThrow('UNAUTHORIZED')
  })

  test('提交未找到匹配 → NOT_FOUND', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.submitResult({ matchId: 'nope', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } }))
      .rejects.toThrow('NOT_FOUND')
  })

  test('admin 确认 R1 后下一轮 result 行 player slot 被推进', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const r2 = db.__all().match_results.find(x => x._id === 'result_T1_r2m1')
    expect(r2.player1).toEqual({ id: 'A' })
    expect(r2.resultStatus).toBe('pending')
    // bracket 也推进
    const r2b = db.__all().tournament_brackets.find(b => b.round === 2)
    expect(r2b.matches[0].player1).toEqual({ id: 'A' })
  })

  test('tournament_ 前缀赛事使用生成器 bracket docId 推进', async () => {
    const seed = seed4Knockout()
    seed.tournaments[0]._id = 'tournament_T1'
    seed.tournament_brackets.forEach(b => { b.tournamentId = 'tournament_T1' })
    seed.match_results.forEach(r => { r.tournamentId = 'tournament_T1' })
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })

    const r2b = db.__all().tournament_brackets.find(b => b._id === 'bracket_T1_round_2')
    const r2r = db.__all().match_results.find(x => x._id === 'result_T1_r2m1')
    expect(r2b.matches[0].player1).toEqual({ id: 'A' })
    expect(r2r.player1).toEqual({ id: 'A' })
  })
})

describe('confirmAll', () => {
  test('admin confirmAll → 所有 submitted 变 confirmed + award', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'A', isAdmin: false } })
    await svc.submitResult({ matchId: 'r1m2', score: { sets: [{ a: 4, b: 1 }], tiebreak: null }, submitter: { _id: 'C', isAdmin: false } })
    const r = await svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'admin1', isAdmin: true } })
    expect(r.confirmedCount).toBe(2)
    const rows = db.__all().match_results.filter(x => x.tournamentId === 'T1' && x.matchKind === 'bracket' && x.round === 1)
    expect(rows.every(x => x.resultStatus === 'confirmed')).toBe(true)
  })

  test('幂等：再次 confirmAll → confirmedCount=0', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'A', isAdmin: false } })
    await svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'admin1', isAdmin: true } })
    const r = await svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'admin1', isAdmin: true } })
    expect(r.confirmedCount).toBe(0)
  })

  test('confirmAll ignores submitted rows that are not active score rows', async () => {
    const seed = seed4Knockout()
    seed.match_results = [
      {
        _id: 'audit_T1_s1',
        tournamentId: 'T1',
        sourceMatchId: 'audit_s1',
        matchKind: 'audit',
        player1: { id: 'A' },
        player2: { id: 'B' },
        playerIds: ['A', 'B'],
        resultStatus: 'submitted',
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        tournamentType: 'singles',
        pointsAwarded: null,
      },
      {
        _id: 'history_T1_s2',
        tournamentId: 'T1',
        sourceMatchId: 'history_s2',
        matchKind: 'history',
        archivedFrom: 'result_T1_s2',
        player1: { id: 'A' },
        player2: { id: 'B' },
        playerIds: ['A', 'B'],
        resultStatus: 'submitted',
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        tournamentType: 'singles',
        pointsAwarded: null,
      },
      {
        _id: 'invalidated_T1_s3',
        tournamentId: 'T1',
        sourceMatchId: 'invalidated_s3',
        matchKind: 'bracket',
        player1: { id: 'A' },
        player2: { id: 'B' },
        playerIds: ['A', 'B'],
        resultStatus: 'invalidated',
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        tournamentType: 'singles',
        pointsAwarded: null,
      },
      {
        _id: 'archived_T1_s4',
        tournamentId: 'T1',
        sourceMatchId: 'archived_s4',
        matchKind: 'bracket',
        archivedFrom: 'result_T1_s4',
        player1: { id: 'A' },
        player2: { id: 'B' },
        playerIds: ['A', 'B'],
        resultStatus: 'submitted',
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        tournamentType: 'singles',
        pointsAwarded: null,
      },
    ]
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    const r = await svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'admin1', isAdmin: true } })

    expect(r.confirmedCount).toBe(0)
    expect(db.__all().match_results.map(row => row.resultStatus)).toEqual([
      'submitted',
      'submitted',
      'invalidated',
      'submitted',
    ])
  })

  test('非 admin 调 confirmAll → UNAUTHORIZED', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'A', isAdmin: false } }))
      .rejects.toThrow('UNAUTHORIZED')
  })
})

describe('voidMatch', () => {
  test('admin marks unfinished regular match as voided and tournament settles after remaining scoreable matches are confirmed', async () => {
    const seed = seed4Knockout()
    seed.tournaments[0] = {
      ...seed.tournaments[0],
      _id: 'TR',
      type: 'singles',
      format: 'regular',
      status: 'ongoing'
    }
    seed.tournament_brackets = []
    seed.match_results = [
      {
        _id: 'result_TR_m1',
        tournamentId: 'TR',
        sourceMatchId: 'm1',
        matchKind: 'regularRound',
        round: 1,
        position: 1,
        player1: { id: 'A' },
        player2: { id: 'B' },
        playerIds: ['A', 'B'],
        resultStatus: 'pending',
        tournamentType: 'singles',
        seasonId: 'S1',
        pointsAwarded: null
      },
      {
        _id: 'result_TR_m2',
        tournamentId: 'TR',
        sourceMatchId: 'm2',
        matchKind: 'regularRound',
        round: 1,
        position: 2,
        player1: { id: 'C' },
        player2: { id: 'D' },
        playerIds: ['C', 'D'],
        resultStatus: 'pending',
        tournamentType: 'singles',
        seasonId: 'S1',
        pointsAwarded: null
      }
    ]
    seed.tournament_registrations = ['A', 'B', 'C', 'D'].map(id => ({ _id: `reg_${id}`, tournamentId: 'TR', playerId: id, registrationStatus: 'confirmed' }))
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 'm1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await svc.voidMatch({ matchId: 'm2', reason: '未完赛', admin: { _id: 'admin1', isAdmin: true } })

    const voided = db.__all().match_results.find(x => x._id === 'result_TR_m2')
    expect(voided).toMatchObject({
      resultStatus: 'voided',
      status: 'cancelled',
      voidReason: '未完赛',
      voidedBy: 'admin1'
    })
    expect(voided.score).toBeNull()
    expect(voided.pointsAwarded).toEqual({ source: 'voided', entries: [] })
    expect(db.__all().tournaments[0].status).toBe('completed')
    expect(db.__all().tournaments[0].completedAt).toBeDefined()
  })

  test('non-admin cannot mark a match voided', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await expect(svc.voidMatch({ matchId: 'r1m1', reason: '未完赛', admin: { _id: 'A', isAdmin: false } }))
      .rejects.toThrow('UNAUTHORIZED')
  })
})

describe('reconfirmMatch · winner 翻盘清后续', () => {
  test('winner 翻盘 → 清后续 bracket + match_results + tournament_points + status=ongoing', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    // 全部 R1 admin 确认 → 推进
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await svc.submitResult({ matchId: 'r1m2', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    // R2 admin 确认 → tournament_points 写入
    await svc.submitResult({ matchId: 'r2m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    expect(db.__all().tournament_points.length).toBeGreaterThan(0)
    expect(db.__all().tournaments[0].status).toBe('completed')

    // 改 r1m1 → B 赢 (4:0 → 0:4)
    await svc.reconfirmMatch({ matchId: 'r1m1', newScore: { sets: [{ a: 0, b: 4 }], tiebreak: null }, admin: { _id: 'admin1', isAdmin: true } })

    const r2b = db.__all().tournament_brackets.find(b => b.round === 2)
    const r2r = db.__all().match_results.find(x => x._id === 'result_T1_r2m1')
    expect(r2r.resultStatus).toBe('pending')
    expect(r2r.winner).toBeNull()
    // After reconfirm: clearDownstream sets player1=null, then confirmOne(r1m1, winner=B) advances player1=B
    expect(r2b.matches[0].player1).toEqual({ id: 'B' })
    expect(r2r.player1).toEqual({ id: 'B' })
    expect(db.__all().tournament_points.length).toBe(0)
    expect(db.__all().tournaments[0].status).toBe('ongoing')

    const r1r1 = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r1r1.winner).toEqual({ id: 'B' })
  })

  test('决赛 placement 写入前自动创建 tournament_points 集合', async () => {
    const seed = seed4Knockout()
    delete seed.tournament_points
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })

    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await svc.submitResult({ matchId: 'r1m2', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await svc.submitResult({ matchId: 'r2m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })

    expect(db.__created()).toContain('tournament_points')
    expect(db.__all().tournament_points.length).toBeGreaterThan(0)
  })

  test('reconfirm winner 不变 → 仅覆盖 entries，不清后续', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const before = JSON.parse(JSON.stringify(db.__all().tournament_brackets.find(b => b.round === 2)))
    await svc.reconfirmMatch({ matchId: 'r1m1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null }, admin: { _id: 'admin1', isAdmin: true } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.score.sets[0]).toEqual({ a: 4, b: 2 })
    expect(r.pointsAwarded.entries.length).toBe(2)
    const after = db.__all().tournament_brackets.find(b => b.round === 2)
    expect(after.matches[0].player1).toEqual(before.matches[0].player1) // R2 未变
  })

  test('重复 confirm 同一场 → 不产生重复 entries（update 覆盖）', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.pointsAwarded.entries.length).toBe(2)
    expect(r.score.sets[0]).toEqual({ a: 4, b: 0 })
  })

  test('reconfirmMatch 非 admin → UNAUTHORIZED', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await expect(svc.reconfirmMatch({ matchId: 'r1m1', newScore: { sets: [{ a: 4, b: 2 }] }, admin: { _id: 'A', isAdmin: false } }))
      .rejects.toThrow('UNAUTHORIZED')
  })

  test('reconfirmMatch 未找到 → NOT_FOUND', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.reconfirmMatch({ matchId: 'nope', newScore: { sets: [{ a: 4, b: 0 }] }, admin: { _id: 'admin1', isAdmin: true } }))
      .rejects.toThrow('NOT_FOUND')
  })

  test('reconfirmMatch invalid score → INVALID_SCORE', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await expect(svc.reconfirmMatch({ matchId: 'r1m1', newScore: { sets: [{ a: 4, b: 4 }] }, admin: { _id: 'admin1', isAdmin: true } }))
      .rejects.toThrow('INVALID_SCORE')
  })
})

describe('regularRound', () => {
  test('常规赛 confirmOne 不推进 bracket（只写 entries）', async () => {
    const seed = seed4Knockout()
    // 改为常规赛
    seed.tournaments[0].format = 'regular'
    seed.match_results[0].matchKind = 'regularRound'
    const db = makeDb(seed)
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('confirmed')
    expect(r.pointsAwarded.entries.length).toBe(2)
    // R2 bracket 不应被影响
    const r2 = db.__all().tournament_brackets.find(b => b.round === 2)
    expect(r2.matches[0].player1).toBeNull()
  })
})
