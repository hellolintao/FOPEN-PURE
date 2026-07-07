const { resolveAnalyticsIdentities } = require('../identity')

test('resolveAnalyticsIdentities formats cached member ids from current member consent', () => {
  const membersById = new Map([
    ['A', { _id: 'A', name: '乐乐', avatarUrl: 'cloud://avatar-a', publicProfileConsent: false }],
    ['B', { _id: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileConsent: true }],
    ['C', { _id: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileConsent: true }],
    ['D', { _id: 'D', name: '标子', avatarUrl: 'cloud://avatar-d', publicProfileConsent: true }]
  ])
  const out = resolveAnalyticsIdentities(
    {
      memberId: 'A',
      doubles: {
        teamH2H: [
          {
            key: 'A__B__vs__C__D',
            subjectTeam: [{ memberId: 'A' }, { memberId: 'B' }],
            opponentTeam: [{ memberId: 'C' }, { memberId: 'D' }],
            wins: 1,
            losses: 0,
            recentMatches: []
          }
        ]
      }
    },
    membersById
  )

  expect(out.displayName).toBe('选手01')
  expect(out.doubles.teamH2H[0].subjectTeamLabel).toBe('选手01 / 小野马')
  expect(out.doubles.teamH2H[0].opponentTeamLabel).toBe('小天 / 标子')
})
