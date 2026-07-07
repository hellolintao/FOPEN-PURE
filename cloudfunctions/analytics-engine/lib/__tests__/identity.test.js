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
      singles: {
        strongAgainst: [{ memberId: 'C', name: '旧名字C', avatarUrl: 'stale://c', wins: 2, losses: 0, matches: 2 }],
        strugglesAgainst: [{ memberId: 'A', name: '旧名字A', avatarUrl: 'stale://a', wins: 0, losses: 2, matches: 2 }]
      },
      doubles: {
        bestPartners: [{ memberId: 'B', name: '旧名字B', avatarUrl: 'stale://b', wins: 3, losses: 1, matches: 4 }],
        strongAgainst: [{ memberId: 'D', name: '旧名字D', avatarUrl: 'stale://d', wins: 2, losses: 1, matches: 3 }],
        strugglesAgainst: [{ memberId: 'A', name: '旧名字A2', avatarUrl: 'stale://a2', wins: 1, losses: 2, matches: 3 }],
        teamH2H: [
          {
            key: 'A__B__vs__C__D',
            subjectTeam: [{ memberId: 'A', name: '旧名字A3' }, { memberId: 'B', name: '旧名字B2' }],
            opponentTeam: [{ memberId: 'C', name: '旧名字C2' }, { memberId: 'D', name: '旧名字D2' }],
            wins: 1,
            losses: 0,
            recentMatches: [
              {
                matchId: 'm1',
                tournamentType: 'doubles',
                subjectTeam: [{ memberId: 'A', name: '旧名字A4' }, { memberId: 'B', name: '旧名字B3' }],
                opponentTeam: [{ memberId: 'C', name: '旧名字C3' }, { memberId: 'D', name: '旧名字D3' }]
              }
            ]
          }
        ]
      },
      recentMatches: [
        {
          matchId: 'm2',
          tournamentType: 'doubles',
          subjectTeam: [{ memberId: 'A', name: '旧名字A5' }, { memberId: 'B', name: '旧名字B4' }],
          opponentTeam: [{ memberId: 'C', name: '旧名字C4' }, { memberId: 'D', name: '旧名字D4' }]
        }
      ]
    },
    membersById
  )

  expect(out.displayName).toBe('选手01')
  expect(out.singles.strongAgainst[0]).toMatchObject({ memberId: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileVisible: true })
  expect(out.singles.strugglesAgainst[0]).toMatchObject({ memberId: 'A', name: '选手01', publicProfileVisible: false })
  expect(out.singles.strugglesAgainst[0].avatarUrl).toBe('/images/icons/default-avatar.png')
  expect(out.doubles.bestPartners[0]).toMatchObject({ memberId: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileVisible: true })
  expect(out.doubles.strongAgainst[0]).toMatchObject({ memberId: 'D', name: '标子', avatarUrl: 'cloud://avatar-d', publicProfileVisible: true })
  expect(out.doubles.strugglesAgainst[0]).toMatchObject({ memberId: 'A', name: '选手01', publicProfileVisible: false })
  expect(out.doubles.teamH2H[0].subjectTeamLabel).toBe('选手01 / 小野马')
  expect(out.doubles.teamH2H[0].opponentTeamLabel).toBe('小天 / 标子')
  expect(out.doubles.teamH2H[0].recentMatches[0].subjectTeamLabel).toBe('选手01 / 小野马')
  expect(out.doubles.teamH2H[0].recentMatches[0].opponentTeamLabel).toBe('小天 / 标子')
  expect(out.doubles.teamH2H[0].recentMatches[0].subjectTeam[0]).toMatchObject({
    memberId: 'A',
    name: '选手01',
    avatarUrl: '/images/icons/default-avatar.png',
    publicProfileVisible: false
  })
  expect(out.recentMatches[0].subjectTeamLabel).toBe('选手01 / 小野马')
  expect(out.recentMatches[0].opponentTeamLabel).toBe('小天 / 标子')
})

test('resolveAnalyticsIdentities resolves doubles rows even when teamH2H is missing', () => {
  const membersById = new Map([
    ['A', { _id: 'A', name: '乐乐', avatarUrl: 'cloud://avatar-a', publicProfileConsent: false }],
    ['B', { _id: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileConsent: true }],
    ['C', { _id: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileConsent: true }]
  ])

  const out = resolveAnalyticsIdentities(
    {
      memberId: 'A',
      doubles: {
        bestPartners: [{ memberId: 'B', name: '旧搭档', avatarUrl: 'stale://b', wins: 2, losses: 0, matches: 2 }],
        strongAgainst: [{ memberId: 'C', name: '旧对手', avatarUrl: 'stale://c', wins: 2, losses: 1, matches: 3 }],
        strugglesAgainst: [{ memberId: 'A', name: '旧自己', avatarUrl: 'stale://a', wins: 1, losses: 2, matches: 3 }]
      }
    },
    membersById
  )

  expect(out.doubles.bestPartners[0]).toMatchObject({ memberId: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileVisible: true })
  expect(out.doubles.strongAgainst[0]).toMatchObject({ memberId: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileVisible: true })
  expect(out.doubles.strugglesAgainst[0]).toMatchObject({ memberId: 'A', name: '选手01', avatarUrl: '/images/icons/default-avatar.png', publicProfileVisible: false })
})
