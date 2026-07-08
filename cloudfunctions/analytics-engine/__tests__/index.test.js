jest.mock('wx-server-sdk', () => {
  const rows = {
    members: [],
    match_results: [],
    rank_cache: [],
    player_analytics: [],
    pair_analytics: [],
    analytics_jobs: []
  }
  const _ = {
    in: (value) => ({ __op: 'in', value })
  }

  function rowMatches(row, filter) {
    for (const [key, value] of Object.entries(filter || {})) {
      const cell = row[key]
      if (value && value.__op === 'in') {
        if (Array.isArray(cell)) {
          if (!cell.some(item => value.value.includes(item))) return false
        } else if (!value.value.includes(cell)) {
          return false
        }
      } else if (cell !== value) {
        return false
      }
    }
    return true
  }

  function collection(name) {
    return {
      where(filter) {
        const filtered = (rows[name] || []).filter(row => rowMatches(row, filter))
        let offset = 0
        let count = filtered.length
        return {
          skip(n) {
            offset = Number(n) || 0
            return this
          },
          limit(n) {
            count = Number(n) || count
            return this
          },
          orderBy() {
            return this
          },
          async get() {
            return { data: filtered.slice(offset, offset + count) }
          }
        }
      },
      doc(id) {
        return {
          async get() {
            return { data: (rows[name] || []).find(row => row._id === id) || null }
          },
          async update({ data }) {
            const index = rows[name].findIndex(row => row._id === id)
            if (index >= 0) rows[name][index] = { ...rows[name][index], ...data }
            return { stats: { updated: index >= 0 ? 1 : 0 } }
          }
        }
      },
      async add({ data }) {
        rows[name].push({ ...data })
        return { _id: data && data._id }
      }
    }
  }

  return {
    DYNAMIC_CURRENT_ENV: 'test',
    init: jest.fn(),
    database: () => ({ command: _, collection }),
    __rows: rows
  }
})

beforeEach(() => {
  const cloud = require('wx-server-sdk')
  for (const key of Object.keys(cloud.__rows)) cloud.__rows[key].length = 0
  jest.resetModules()
})

test('refreshAfterSettlement writes affected player and pair analytics plus job success', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push(
    { _id: 'A', name: '乐乐' },
    { _id: 'B', name: '小野马' },
    { _id: 'C', name: '小天' },
    { _id: 'D', name: '标子' }
  )
  cloud.__rows.match_results.push({
    _id: 'm1',
    seasonId: 'season_2026',
    tournamentType: 'doubles',
    resultStatus: 'confirmed',
    confirmedAt: '2026-06-01',
    createTime: '2026-06-01',
    playerIds: ['A', 'B', 'C', 'D'],
    player1: { id: 'A', name: '乐乐', partnerId: 'B', partnerName: '小野马' },
    player2: { id: 'C', name: '小天', partnerId: 'D', partnerName: '标子' },
    pointsAwarded: {
      entries: [
        { memberId: 'A', points: 20, role: 'winner' },
        { memberId: 'B', points: 20, role: 'winner' },
        { memberId: 'C', points: 10, role: 'loser' },
        { memberId: 'D', points: 10, role: 'loser' }
      ]
    }
  })

  const { main } = require('../index')
  const res = await main({
    action: 'refreshAfterSettlement',
    seasonId: 'season_2026',
    affectedMemberIds: ['A', 'B', 'C', 'D'],
    matchIds: ['m1']
  })

  expect(res.success).toBe(true)
  expect(cloud.__rows.player_analytics.find(row => row._id === 'pa_season_2026_A')).toBeTruthy()
  expect(cloud.__rows.pair_analytics.find(row => row._id === 'pair_season_2026_A__B')).toBeTruthy()
  expect(cloud.__rows.analytics_jobs[0]).toMatchObject({ status: 'success', jobType: 'refreshAfterSettlement' })
})

test('getPlayerAnalytics resolves cached ids through current member privacy state', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '乐乐', publicProfileConsent: false })
  cloud.__rows.player_analytics.push({
    _id: 'pa_season_2026_A',
    seasonId: 'season_2026',
    memberId: 'A',
    doubles: { teamH2H: [] }
  })

  const { main } = require('../index')
  const res = await main({ action: 'getPlayerAnalytics', seasonId: 'season_2026', memberId: 'A' })

  expect(res.success).toBe(true)
  expect(res.data).toMatchObject({
    _id: 'pa_season_2026_A',
    seasonId: 'season_2026',
    memberId: 'A',
    displayName: '选手01',
    publicProfileVisible: false
  })
})

test('getPlayerAnalytics resolves member ids from analytics buckets outside recent matches', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push(
    { _id: 'A', name: '乐乐', publicProfileConsent: true, avatarUrl: 'cloud://avatar-a' },
    { _id: 'B', name: '小野马', publicProfileConsent: true, avatarUrl: 'cloud://avatar-b' },
    { _id: 'C', name: '小天', publicProfileConsent: true, avatarUrl: 'cloud://avatar-c' },
    { _id: 'D', name: '标子', publicProfileConsent: true, avatarUrl: 'cloud://avatar-d' }
  )
  cloud.__rows.player_analytics.push({
    _id: 'pa_season_2026_A',
    seasonId: 'season_2026',
    memberId: 'A',
    singles: {
      bestPartners: [{ memberId: 'B', wins: 2, losses: 1, matches: 3 }],
      strongAgainst: [{ memberId: 'C', wins: 3, losses: 0, matches: 3 }],
      strugglesAgainst: [{ memberId: 'D', wins: 1, losses: 2, matches: 3 }]
    },
    doubles: {
      bestPartners: [{ memberId: 'B', wins: 4, losses: 1, matches: 5 }],
      strongAgainst: [{ memberId: 'C', wins: 2, losses: 0, matches: 2 }],
      strugglesAgainst: [{ memberId: 'D', wins: 1, losses: 3, matches: 4 }],
      teamH2H: []
    },
    recentMatches: []
  })

  const { main } = require('../index')
  const res = await main({ action: 'getPlayerAnalytics', seasonId: 'season_2026', memberId: 'A' })

  expect(res.success).toBe(true)
  expect(res.data.singles.bestPartners[0]).toMatchObject({ memberId: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileVisible: true })
  expect(res.data.singles.strongAgainst[0]).toMatchObject({ memberId: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileVisible: true })
  expect(res.data.singles.strugglesAgainst[0]).toMatchObject({ memberId: 'D', name: '标子', avatarUrl: 'cloud://avatar-d', publicProfileVisible: true })
  expect(res.data.doubles.bestPartners[0]).toMatchObject({ memberId: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileVisible: true })
  expect(res.data.doubles.strongAgainst[0]).toMatchObject({ memberId: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileVisible: true })
  expect(res.data.doubles.strugglesAgainst[0]).toMatchObject({ memberId: 'D', name: '标子', avatarUrl: 'cloud://avatar-d', publicProfileVisible: true })
})

test('rebuildSeason writes analytics for all confirmed rows', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '乐乐' }, { _id: 'B', name: '小天' })
  cloud.__rows.match_results.push({
    _id: 'm1',
    seasonId: 'season_2026',
    tournamentType: 'singles',
    resultStatus: 'confirmed',
    confirmedAt: '2026-06-01',
    createTime: '2026-06-01',
    playerIds: ['A', 'B'],
    player1: { id: 'A', name: '乐乐' },
    player2: { id: 'B', name: '小天' },
    pointsAwarded: {
      entries: [
        { memberId: 'A', points: 20, role: 'winner' },
        { memberId: 'B', points: 10, role: 'loser' }
      ]
    }
  })

  const { main } = require('../index')
  const res = await main({ action: 'rebuildSeason', seasonId: 'season_2026' })

  expect(res.success).toBe(true)
  expect(res.data.playerCount).toBe(2)
  expect(cloud.__rows.player_analytics).toHaveLength(2)
})

test('refreshAfterSettlement keeps cached analytics identity fields id-only', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push(
    { _id: 'A', name: '乐乐', avatarUrl: 'cloud://avatar-a', publicProfileConsent: true },
    { _id: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileConsent: true },
    { _id: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileConsent: true },
    { _id: 'D', name: '标子', avatarUrl: 'cloud://avatar-d', publicProfileConsent: true }
  )
  cloud.__rows.match_results.push({
    _id: 'm1',
    seasonId: 'season_2026',
    tournamentType: 'doubles',
    resultStatus: 'confirmed',
    confirmedAt: '2026-06-01',
    createTime: '2026-06-01',
    playerIds: ['A', 'B', 'C', 'D'],
    player1: { id: 'A', name: '乐乐', partnerId: 'B', partnerName: '小野马' },
    player2: { id: 'C', name: '小天', partnerId: 'D', partnerName: '标子' },
    pointsAwarded: {
      entries: [
        { memberId: 'A', points: 20, role: 'winner' },
        { memberId: 'B', points: 20, role: 'winner' },
        { memberId: 'C', points: 10, role: 'loser' },
        { memberId: 'D', points: 10, role: 'loser' }
      ]
    }
  })

  const { main } = require('../index')
  const res = await main({
    action: 'refreshAfterSettlement',
    seasonId: 'season_2026',
    affectedMemberIds: ['A', 'B', 'C', 'D'],
    matchIds: ['m1']
  })

  expect(res.success).toBe(true)
  const playerDoc = cloud.__rows.player_analytics.find(row => row._id === 'pa_season_2026_A')
  expect(playerDoc.recentMatches[0].subjectTeam).toEqual([{ memberId: 'A' }, { memberId: 'B' }])
  expect(playerDoc.recentMatches[0].opponentTeam).toEqual([{ memberId: 'C' }, { memberId: 'D' }])
  expect(playerDoc.doubles.bestPartners[0]).toEqual(expect.objectContaining({ memberId: 'B' }))
  expect(playerDoc.doubles.bestPartners[0].name).toBeUndefined()
  expect(playerDoc.doubles.strongAgainst[0].name).toBeUndefined()
  expect(playerDoc.doubles.teamH2H[0].subjectTeam).toEqual([{ memberId: 'A' }, { memberId: 'B' }])
  expect(playerDoc.doubles.teamH2H[0].opponentTeam).toEqual([{ memberId: 'C' }, { memberId: 'D' }])
})

test('refreshAfterSettlement populates rankSnapshot from rank_cache without display identity fields', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push(
    { _id: 'A', name: '乐乐', avatarUrl: 'cloud://avatar-a', publicProfileConsent: true },
    { _id: 'B', name: '小天', avatarUrl: 'cloud://avatar-b', publicProfileConsent: true }
  )
  cloud.__rows.rank_cache.push(
    {
      _id: 'rank_cache_season_2026_singles',
      seasonId: 'season_2026',
      type: 'singles',
      rankList: [
        {
          _id: 'A',
          memberId: 'A',
          rank: 1,
          totalPoints: 120,
          winCount: 6,
          lossCount: 1,
          winRate: 0.857,
          trendDelta: 2,
          trendState: 'up',
          trendLabel: '▲2',
          name: '乐乐',
          avatarUrl: 'cloud://avatar-a',
          publicProfileVisible: true
        }
      ]
    },
    {
      _id: 'rank_cache_season_2026_doubles',
      seasonId: 'season_2026',
      type: 'doubles',
      rankList: [
        {
          _id: 'A',
          memberId: 'A',
          rank: 3,
          totalPoints: 88,
          winCount: 4,
          lossCount: 2,
          winRate: 0.667,
          trendDelta: -1,
          trendState: 'down',
          trendLabel: '▼1',
          name: '乐乐',
          avatarUrl: 'cloud://avatar-a'
        }
      ]
    }
  )
  cloud.__rows.match_results.push({
    _id: 'm1',
    seasonId: 'season_2026',
    tournamentType: 'singles',
    resultStatus: 'confirmed',
    confirmedAt: '2026-06-01',
    createTime: '2026-06-01',
    playerIds: ['A', 'B'],
    player1: { id: 'A', name: '乐乐' },
    player2: { id: 'B', name: '小天' },
    pointsAwarded: {
      entries: [
        { memberId: 'A', points: 20, role: 'winner' },
        { memberId: 'B', points: 10, role: 'loser' }
      ]
    }
  })

  const { main } = require('../index')
  const res = await main({
    action: 'refreshAfterSettlement',
    seasonId: 'season_2026',
    affectedMemberIds: ['A'],
    matchIds: ['m1']
  })

  expect(res.success).toBe(true)
  const playerDoc = cloud.__rows.player_analytics.find(row => row._id === 'pa_season_2026_A')
  expect(playerDoc.rankSnapshot).toEqual({
    singles: [
      {
        _id: 'A',
        memberId: 'A',
        rank: 1,
        totalPoints: 120,
        winCount: 6,
        lossCount: 1,
        winRate: 0.857,
        trendDelta: 2,
        trendState: 'up',
        trendLabel: '▲2'
      }
    ],
    doubles: [
      {
        _id: 'A',
        memberId: 'A',
        rank: 3,
        totalPoints: 88,
        winCount: 4,
        lossCount: 2,
        winRate: 0.667,
        trendDelta: -1,
        trendState: 'down',
        trendLabel: '▼1'
      }
    ]
  })
  expect(playerDoc.rankSnapshot.singles[0].name).toBeUndefined()
  expect(playerDoc.rankSnapshot.singles[0].avatarUrl).toBeUndefined()
  expect(playerDoc.rankSnapshot.singles[0].publicProfileVisible).toBeUndefined()
})

test('rebuildSeason pages beyond the first 500 confirmed rows', async () => {
  const cloud = require('wx-server-sdk')
  for (let i = 0; i < 510; i += 1) {
    const id = `P${i}`
    cloud.__rows.members.push({ _id: id, name: id })
    cloud.__rows.match_results.push({
      _id: `m${i}`,
      seasonId: 'season_2026',
      tournamentType: 'singles',
      resultStatus: 'confirmed',
      confirmedAt: '2026-06-01',
      createTime: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
      playerIds: [id],
      player1: { id, name: id },
      pointsAwarded: {
        entries: [{ memberId: id, points: 1, role: 'winner' }]
      }
    })
  }

  const { main } = require('../index')
  const res = await main({ action: 'rebuildSeason', seasonId: 'season_2026' })

  expect(res.success).toBe(true)
  expect(res.data.playerCount).toBe(510)
})

test('getPairAnalytics pages beyond the first 100 pair rows', async () => {
  const cloud = require('wx-server-sdk')
  for (let i = 0; i < 125; i += 1) {
    cloud.__rows.pair_analytics.push({
      _id: `pair_season_2026_A__P${i}`,
      seasonId: 'season_2026',
      memberIds: ['A', `P${i}`],
      pairId: `A__P${i}`
    })
  }

  const { main } = require('../index')
  const res = await main({ action: 'getPairAnalytics', seasonId: 'season_2026', memberId: 'A' })

  expect(res.success).toBe(true)
  expect(res.data).toHaveLength(125)
})

test('refreshAfterSettlement logs a failed analytics job when processing throws', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push(
    { _id: 'A', name: '乐乐' },
    { _id: 'B', name: '小野马' }
  )
  cloud.__rows.match_results.push({
    _id: 'm1',
    seasonId: 'season_2026',
    tournamentType: 'doubles',
    resultStatus: 'confirmed',
    confirmedAt: '2026-06-01',
    createTime: '2026-06-01',
    playerIds: ['A', 'B'],
    player1: { id: 'A', name: '乐乐', partnerId: 'A', partnerName: '乐乐' },
    player2: { id: 'B', name: '小野马' },
    pointsAwarded: {
      entries: [
        { memberId: 'A', points: 20, role: 'winner' },
        { memberId: 'B', points: 10, role: 'loser' }
      ]
    }
  })

  const { main } = require('../index')
  const res = await main({
    action: 'refreshAfterSettlement',
    seasonId: 'season_2026',
    affectedMemberIds: ['A', 'B'],
    matchIds: ['m1']
  })

  expect(res.success).toBe(false)
  expect(res.error.code).toBe('PAIR_REQUIRES_TWO_DISTINCT_MEMBERS')
  expect(cloud.__rows.analytics_jobs).toHaveLength(1)
  expect(cloud.__rows.analytics_jobs[0]).toMatchObject({
    jobType: 'refreshAfterSettlement',
    seasonId: 'season_2026',
    status: 'failed',
    affectedMemberIds: ['A', 'B'],
    matchIds: ['m1'],
    error: 'PAIR_REQUIRES_TWO_DISTINCT_MEMBERS'
  })
})
