const { buildPlayerAnalytics } = require('../player-analytics')

const membersById = new Map([
  ['P', { _id: 'P', name: '乐乐' }],
  ['A', { _id: 'A', name: '小天' }],
  ['B', { _id: 'B', name: '标子' }],
  ['M', { _id: 'M', name: '小野马' }]
])

test('buildPlayerAnalytics includes lastFive, strongAgainst and strugglesAgainst', () => {
  const rows = [
    row('m1', 'singles', ['P', 'A'], 'P', 'A', '2026-06-01'),
    row('m2', 'singles', ['P', 'A'], 'A', 'P', '2026-06-02'),
    row('m3', 'singles', ['P', 'B'], 'P', 'B', '2026-06-03'),
    row('m4', 'singles', ['P', 'B'], 'P', 'B', '2026-06-04'),
    row('m5', 'singles', ['P', 'B'], 'P', 'B', '2026-06-05'),
    doublesRow('d1', ['P', 'M'], ['A', 'B'], ['P', 'M'], ['A', 'B'], '2026-06-06')
  ]

  const out = buildPlayerAnalytics({
    seasonId: 'season_2026',
    memberId: 'P',
    rows,
    membersById,
    rankRowsByType: { singles: [], doubles: [] }
  })

  expect(out._id).toBe('pa_season_2026_P')
  expect(out.singles.lastFive.summary).toBe('4W-1L')
  expect(out.singles.strongAgainst[0]).toMatchObject({ memberId: 'B', name: '标子', wins: 3, losses: 0 })
  expect(out.singles.strugglesAgainst[0]).toMatchObject({ memberId: 'A', name: '小天', wins: 1, losses: 1 })
  expect(out.doubles.bestPartners[0]).toMatchObject({ memberId: 'M', name: '小野马', wins: 1, losses: 0, matches: 1 })
  expect(out.doubles.teamH2H[0]).toMatchObject({
    subjectTeam: [{ memberId: 'P' }, { memberId: 'M' }],
    opponentTeam: [{ memberId: 'A' }, { memberId: 'B' }],
    wins: 1,
    losses: 0
  })
  expect(out.recentMatches[0]).toMatchObject({
    matchId: 'd1',
    tournamentType: 'doubles',
    subjectTeam: [{ memberId: 'P' }, { memberId: 'M' }],
    opponentTeam: [{ memberId: 'A' }, { memberId: 'B' }]
  })
})

function row(id, type, playerIds, winnerId, loserId, confirmedAt) {
  return {
    _id: id,
    tournamentType: type,
    seasonId: 'season_2026',
    resultStatus: 'confirmed',
    confirmedAt,
    createTime: confirmedAt,
    playerIds,
    player1: { id: playerIds[0], name: nameOf(playerIds[0]) },
    player2: { id: playerIds[1], name: nameOf(playerIds[1]) },
    pointsAwarded: {
      entries: [
        { memberId: winnerId, points: 20, role: 'winner' },
        { memberId: loserId, points: 10, role: 'loser' }
      ]
    }
  }
}

function doublesRow(id, subjectIds, opponentIds, winnerIds, loserIds, confirmedAt) {
  return {
    _id: id,
    tournamentType: 'doubles',
    seasonId: 'season_2026',
    resultStatus: 'confirmed',
    confirmedAt,
    createTime: confirmedAt,
    playerIds: [...subjectIds, ...opponentIds],
    player1: { id: subjectIds[0], name: nameOf(subjectIds[0]), partnerId: subjectIds[1], partnerName: nameOf(subjectIds[1]) },
    player2: { id: opponentIds[0], name: nameOf(opponentIds[0]), partnerId: opponentIds[1], partnerName: nameOf(opponentIds[1]) },
    pointsAwarded: {
      entries: [
        ...winnerIds.map(memberId => ({ memberId, points: 20, role: 'winner' })),
        ...loserIds.map(memberId => ({ memberId, points: 10, role: 'loser' }))
      ]
    }
  }
}

function nameOf(id) {
  return (membersById.get(id) && membersById.get(id).name) || id
}
