const { resolveOpponentIds, computeH2H } = require('../player-h2h')

describe('resolveOpponentIds', () => {
  test('singles returns all non-self entry memberIds', () => {
    const row = {
      tournamentType: 'singles',
      pointsAwarded: { entries: [
        { memberId: 'P', role: 'winner' },
        { memberId: 'A', role: 'loser' }
      ]}
    }

    expect(resolveOpponentIds(row, 'P')).toEqual(['A'])
  })

  test('singles returns empty when player is not present in entries', () => {
    const row = {
      tournamentType: 'singles',
      pointsAwarded: { entries: [
        { memberId: 'A', role: 'winner' },
        { memberId: 'B', role: 'loser' }
      ]}
    }

    expect(resolveOpponentIds(row, 'P')).toEqual([])
  })

  test('doubles with team metadata returns entries from different team', () => {
    const row = {
      tournamentType: 'doubles',
      pointsAwarded: { entries: [
        { memberId: 'P', role: 'winner', team: 1 },
        { memberId: 'M', role: 'winner', team: 1 },
        { memberId: 'A', role: 'loser', team: 2 },
        { memberId: 'B', role: 'loser', team: 2 }
      ]}
    }

    expect(resolveOpponentIds(row, 'P')).toEqual(['A', 'B'])
  })

  test('doubles without team uses opposite winner/loser role', () => {
    const row = {
      tournamentType: 'doubles',
      pointsAwarded: { entries: [
        { memberId: 'P', role: 'winner' },
        { memberId: 'M', role: 'winner' },
        { memberId: 'A', role: 'loser' },
        { memberId: 'B', role: 'loser' }
      ]}
    }

    expect(resolveOpponentIds(row, 'P')).toEqual(['A', 'B'])
  })

  test('doubles without team and without roles returns empty', () => {
    const row = {
      tournamentType: 'doubles',
      pointsAwarded: { entries: [
        { memberId: 'P' },
        { memberId: 'M' },
        { memberId: 'A' },
        { memberId: 'B' }
      ]}
    }

    expect(resolveOpponentIds(row, 'P')).toEqual([])
  })
})

describe('computeH2H', () => {
  test('aggregates wins and losses per opponent and sorts by total meetings desc', () => {
    const rows = [
      {
        tournamentType: 'singles',
        confirmedAt: '2026-05-10',
        createTime: '2026-05-09',
        pointsAwarded: { entries: [
          { memberId: 'P', role: 'winner' },
          { memberId: 'A', role: 'loser' }
        ]}
      },
      {
        tournamentType: 'singles',
        confirmedAt: '2026-05-12',
        createTime: '2026-05-11',
        pointsAwarded: { entries: [
          { memberId: 'P', role: 'loser' },
          { memberId: 'A', role: 'winner' }
        ]}
      },
      {
        tournamentType: 'doubles',
        confirmedAt: '2026-05-13',
        createTime: '2026-05-12',
        pointsAwarded: { entries: [
          { memberId: 'P', role: 'winner', team: 'red' },
          { memberId: 'M', role: 'winner', team: 'red' },
          { memberId: 'B', role: 'loser', team: 'blue' }
        ]}
      }
    ]
    const members = new Map([
      ['A', { name: 'Alice', avatarUrl: 'alice.png', publicProfileConsent: true }],
      ['B', { name: 'Bob', avatarUrl: 'bob.png', publicProfileConsent: true }]
    ])

    expect(computeH2H(rows, 'P', members)).toEqual([
      { memberId: 'A', name: 'Alice', avatarUrl: 'alice.png', publicProfileVisible: true, wins: 1, losses: 1, lastPlayedAt: '2026-05-12' },
      { memberId: 'B', name: 'Bob', avatarUrl: 'bob.png', publicProfileVisible: true, wins: 1, losses: 0, lastPlayedAt: '2026-05-13' }
    ])
  })

  test('empty rows returns empty', () => {
    expect(computeH2H([], 'P', new Map())).toEqual([])
  })

  test('doubles row aggregates one win for each opponent', () => {
    const rows = [{
      tournamentType: 'doubles',
      confirmedAt: '2026-05-14',
      pointsAwarded: { entries: [
        { memberId: 'P', role: 'winner', team: 'red' },
        { memberId: 'M', role: 'winner', team: 'red' },
        { memberId: 'X', role: 'loser', team: 'blue' },
        { memberId: 'Y', role: 'loser', team: 'blue' }
      ]}
    }]

    expect(computeH2H(rows, 'P', new Map())).toEqual([
      { memberId: 'X', name: '选手01', avatarUrl: '/images/icons/default-avatar.png', publicProfileVisible: false, wins: 1, losses: 0, lastPlayedAt: '2026-05-14' },
      { memberId: 'Y', name: '选手02', avatarUrl: '/images/icons/default-avatar.png', publicProfileVisible: false, wins: 1, losses: 0, lastPlayedAt: '2026-05-14' }
    ])
  })

  test('sorts tied total meetings by memberId ascending', () => {
    const rows = [
      {
        tournamentType: 'singles',
        confirmedAt: '2026-05-10',
        pointsAwarded: { entries: [
          { memberId: 'P', role: 'winner' },
          { memberId: 'Y', role: 'loser' }
        ]}
      },
      {
        tournamentType: 'singles',
        confirmedAt: '2026-05-11',
        pointsAwarded: { entries: [
          { memberId: 'P', role: 'winner' },
          { memberId: 'X', role: 'loser' }
        ]}
      }
    ]

    expect(computeH2H(rows, 'P', new Map()).map(row => row.memberId)).toEqual(['X', 'Y'])
  })

  test('unknown member is anonymized for public H2H display', () => {
    const rows = [{
      tournamentType: 'singles',
      confirmedAt: '2026-05-10',
      pointsAwarded: { entries: [
        { memberId: 'P', role: 'winner' },
        { memberId: 'Z', role: 'loser' }
      ]}
    }]

    expect(computeH2H(rows, 'P', new Map())).toEqual([
      { memberId: 'Z', name: '选手01', avatarUrl: '/images/icons/default-avatar.png', publicProfileVisible: false, wins: 1, losses: 0, lastPlayedAt: '2026-05-10' }
    ])
  })

  test('lastPlayedAt falls back to createTime', () => {
    const rows = [{
      tournamentType: 'singles',
      confirmedAt: null,
      createTime: '2026-05-08',
      pointsAwarded: { entries: [
        { memberId: 'P', role: 'loser' },
        { memberId: 'A', role: 'winner' }
      ]}
    }]

    expect(computeH2H(rows, 'P', new Map())).toEqual([
      { memberId: 'A', name: '选手01', avatarUrl: '/images/icons/default-avatar.png', publicProfileVisible: false, wins: 0, losses: 1, lastPlayedAt: '2026-05-08' }
    ])
  })

  test('lastPlayedAt compares mixed string and Date timestamps while preserving the selected value', () => {
    const newerDate = new Date('2026-05-12T00:00:00.000Z')
    const rows = [
      {
        tournamentType: 'singles',
        confirmedAt: '2026-05-10T00:00:00.000Z',
        pointsAwarded: { entries: [
          { memberId: 'P', role: 'loser' },
          { memberId: 'A', role: 'winner' }
        ]}
      },
      {
        tournamentType: 'singles',
        confirmedAt: newerDate,
        pointsAwarded: { entries: [
          { memberId: 'P', role: 'winner' },
          { memberId: 'A', role: 'loser' }
        ]}
      }
    ]

    expect(computeH2H(rows, 'P', new Map())[0].lastPlayedAt).toBe(newerDate)
  })
})
