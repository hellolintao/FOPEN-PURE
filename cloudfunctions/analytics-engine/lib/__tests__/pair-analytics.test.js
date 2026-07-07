const { buildPairAnalytics } = require('../pair-analytics')

const membersById = new Map([
  ['A', { _id: 'A', name: '乐乐' }],
  ['B', { _id: 'B', name: '小野马' }],
  ['C', { _id: 'C', name: '小天' }],
  ['D', { _id: 'D', name: '标子' }]
])

test('buildPairAnalytics aggregates team-vs-team matchups', () => {
  const rows = [
    row('m1', ['A', 'B'], ['C', 'D'], ['A', 'B'], ['C', 'D'], '2026-06-01'),
    row('m2', ['A', 'B'], ['C', 'D'], ['C', 'D'], ['A', 'B'], '2026-06-02'),
    row('m3', ['A', 'B'], ['C', 'D'], ['A', 'B'], ['C', 'D'], '2026-06-03')
  ]

  const out = buildPairAnalytics({ seasonId: 'season_2026', pairMemberIds: ['B', 'A'], rows, membersById })

  expect(out._id).toBe('pair_season_2026_A__B')
  expect(out.memberIds).toEqual(['A', 'B'])
  expect(out).toMatchObject({ matches: 3, wins: 2, losses: 1, winRate: 2 / 3 })
  expect(out.matchups[0]).toMatchObject({
    opponentPairId: 'C__D',
    opponentMemberIds: ['C', 'D'],
    wins: 2,
    losses: 1
  })
})

function row(id, subjectIds, opponentIds, winnerIds, loserIds, confirmedAt) {
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
  return membersById.get(id).name
}
