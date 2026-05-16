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
      ['A', { name: 'Alice', avatarUrl: 'alice.png' }],
      ['B', { name: 'Bob', avatarUrl: 'bob.png' }]
    ])

    expect(computeH2H(rows, 'P', members)).toEqual([
      { memberId: 'A', name: 'Alice', avatarUrl: 'alice.png', wins: 1, losses: 1, lastPlayedAt: '2026-05-12' },
      { memberId: 'B', name: 'Bob', avatarUrl: 'bob.png', wins: 1, losses: 0, lastPlayedAt: '2026-05-13' }
    ])
  })

  test('empty rows returns empty', () => {
    expect(computeH2H([], 'P', new Map())).toEqual([])
  })

  test('unknown member falls back to id name and empty avatarUrl', () => {
    const rows = [{
      tournamentType: 'singles',
      confirmedAt: '2026-05-10',
      pointsAwarded: { entries: [
        { memberId: 'P', role: 'winner' },
        { memberId: 'Z', role: 'loser' }
      ]}
    }]

    expect(computeH2H(rows, 'P', new Map())).toEqual([
      { memberId: 'Z', name: 'Z', avatarUrl: '', wins: 1, losses: 0, lastPlayedAt: '2026-05-10' }
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
      { memberId: 'A', name: 'A', avatarUrl: '', wins: 0, losses: 1, lastPlayedAt: '2026-05-08' }
    ])
  })
})
