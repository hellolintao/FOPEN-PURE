const { buildSettlementImpact } = require('../settlement-impact')

test('buildSettlementImpact compares previous cached ranks with refreshed ranks', () => {
  const out = buildSettlementImpact({
    type: 'singles',
    affectedMemberIds: ['A', 'B', 'NEW'],
    beforeRankRows: [
      { _id: 'A', name: '乐乐', totalPoints: 100, rank: 3 },
      { _id: 'B', name: '小野马', totalPoints: 90, rank: 2 }
    ],
    afterRankRows: [
      { _id: 'A', name: '乐乐', totalPoints: 120, rank: 1 },
      { _id: 'B', name: '小野马', totalPoints: 100, rank: 3 },
      { _id: 'NEW', name: '新选手', totalPoints: 10, rank: 9 }
    ]
  })

  expect(out).toEqual([
    { impactKey: 'singles:A', type: 'singles', typeLabel: '单打', memberId: 'A', name: '乐乐', pointsDelta: 20, rankDelta: 2, trendLabel: '▲2' },
    { impactKey: 'singles:B', type: 'singles', typeLabel: '单打', memberId: 'B', name: '小野马', pointsDelta: 10, rankDelta: -1, trendLabel: '▼1' },
    { impactKey: 'singles:NEW', type: 'singles', typeLabel: '单打', memberId: 'NEW', name: '新选手', pointsDelta: 10, rankDelta: null, trendLabel: '首次进入榜单' }
  ])
})
