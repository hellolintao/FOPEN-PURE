const { deriveRoundLabel, enrichRecent } = require('../player-stats')

describe('deriveRoundLabel', () => {
  test('regular format -> null', () => {
    expect(deriveRoundLabel({ format: 'regular', totalRounds: 5 }, 3)).toBeNull()
  })

  test('knockout final (round === totalRounds) -> "F"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 4 }, 4)).toBe('F')
  })

  test('knockout semi (totalRounds - round === 1) -> "SF"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 4 }, 3)).toBe('SF')
  })

  test('knockout 1/4 (totalRounds - round === 2) -> "QF"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 4 }, 2)).toBe('QF')
  })

  test('knockout earlier rounds -> "R<n>"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 5 }, 1)).toBe('R1')
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 5 }, 2)).toBe('R2')
  })

  test('knockout legacy config.totalRounds shape -> round labels', () => {
    expect(deriveRoundLabel({ format: 'knockout', config: { totalRounds: 4 } }, 3)).toBe('SF')
  })

  test('knockout maxPlayers shape derives total rounds from bracket size', () => {
    const tournament = { format: 'knockout', maxPlayers: 16 }
    expect(deriveRoundLabel(tournament, 4)).toBe('F')
    expect(deriveRoundLabel(tournament, 3)).toBe('SF')
  })

  test('missing tournament -> null (defensive)', () => {
    expect(deriveRoundLabel(null, 3)).toBeNull()
  })
})

describe('enrichRecent', () => {
  const tournaments = new Map([
    ['t1', { _id: 't1', name: '春季锦标赛', format: 'knockout', totalRounds: 4 }],
    ['t2', { _id: 't2', name: '五月例赛', format: 'regular', totalRounds: 0 }]
  ])
  const members = new Map([
    ['P', { _id: 'P', name: 'p', avatarUrl: '' }],
    ['X', { _id: 'X', name: '张昊', avatarUrl: 'x.png' }],
    ['Y', { _id: 'Y', name: '陈思远', avatarUrl: 'y.png' }]
  ])

  test('knockout SF won -> roundLabel="SF", won=true, pointsAwarded from entries[P], opponent=X', () => {
    const row = {
      _id: 'm1', tournamentId: 't1', round: 3,
      score: '6-4, 6-2',
      playerIds: ['P', 'X'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'X', points: 10, role: 'loser' }
      ]},
      confirmedAt: '2026-05-14', createTime: '2026-05-14'
    }
    const out = enrichRecent([row], 'P', tournaments, members)
    expect(out[0]).toMatchObject({
      tournamentId: 't1', tournamentName: '春季锦标赛', tournamentFormat: 'knockout',
      round: 3, roundLabel: 'SF', score: '6-4, 6-2',
      opponentId: 'X', opponentName: '张昊',
      won: true, pointsAwarded: 20,
      confirmedAt: '2026-05-14'
    })
  })

  test('regular loss -> roundLabel=null, won=false, opponent inferred from entries', () => {
    const row = {
      _id: 'm2', tournamentId: 't2', round: 1,
      score: '3-6, 4-6',
      playerIds: ['P', 'Y'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 10, role: 'loser' },
        { memberId: 'Y', points: 20, role: 'winner' }
      ]},
      confirmedAt: '2026-05-10', createTime: '2026-05-10'
    }
    const out = enrichRecent([row], 'P', tournaments, members)
    expect(out[0]).toMatchObject({
      roundLabel: null, won: false, opponentId: 'Y', opponentName: '陈思远', pointsAwarded: 10
    })
  })

  test('doubles recent display picks opposite-role opponent, not same-role partner', () => {
    const row = {
      _id: 'm2d', tournamentId: 't2', tournamentType: 'doubles', round: 1,
      score: '6-4',
      playerIds: ['P', 'M', 'X', 'Y'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 15, role: 'winner' },
        { memberId: 'M', points: 15, role: 'winner' },
        { memberId: 'X', points: 5, role: 'loser' },
        { memberId: 'Y', points: 5, role: 'loser' }
      ]},
      confirmedAt: '2026-05-10', createTime: '2026-05-10'
    }
    const membersWithPartner = new Map([
      ...members,
      ['M', { _id: 'M', name: '搭档' }]
    ])
    const out = enrichRecent([row], 'P', tournaments, membersWithPartner)
    expect(out[0]).toMatchObject({ opponentId: 'X', opponentName: '张昊', won: true, pointsAwarded: 15 })
  })

  test('unknown opponent id -> opponentName falls back to id; missing tournament -> tournamentName=""', () => {
    const row = {
      _id: 'm3', tournamentId: 't_missing', round: 1, score: '6-0',
      playerIds: ['P', 'Z'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'Z', points: 0, role: 'loser' }
      ]},
      confirmedAt: null, createTime: '2026-05-09'
    }
    const out = enrichRecent([row], 'P', new Map(), members)
    expect(out[0].opponentName).toBe('Z')
    expect(out[0].tournamentName).toBe('')
    expect(out[0].tournamentFormat).toBeNull()
  })
})
