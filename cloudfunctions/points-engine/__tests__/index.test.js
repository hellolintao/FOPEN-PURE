jest.mock('wx-server-sdk', () => {
  const op = (__op, value) => ({ __op, value })
  const _ = {
    and: (cs) => ({ __op: 'and', clauses: cs }),
    or: (cs) => ({ __op: 'or', clauses: cs }),
    in: (v) => op('in', v),
    gt: (v) => op('gt', v),
    gte: (v) => op('gte', v),
    lte: (v) => op('lte', v),
    eq: (v) => op('eq', v),
    remove: () => ({ __op: 'remove' })
  }
  const rows = { match_results: [], tournament_points: [], members: [], rank_snapshots: [], tournaments: [], baseline_standings: [], rank_cache: [], __missingCollections: new Set(), __missingDocs: new Set() }
  function missingCollectionError(name) {
    const err = new Error(`collection ${name} not exists`)
    err.errCode = -502005
    return err
  }
  function missingDocumentError(name, id) {
    const err = new Error(`document.get:fail document with _id ${id} does not exist`)
    err.errCode = -1
    return err
  }
  function rowMatches(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => rowMatches(row, c))
    if (f.__op === 'or') return f.clauses.some(c => rowMatches(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'gt') {
        if (!(c > v.value)) return false
      } else if (v && v.__op === 'gte') {
        if (!(c >= v.value)) return false
      } else if (v && v.__op === 'lte') {
        if (!(c <= v.value)) return false
      } else if (v && v.__op === 'in') {
        if (Array.isArray(c)) {
          if (!c.some(item => v.value.includes(item))) return false
        } else if (!v.value.includes(c)) return false
      } else if (v && v.__op === 'eq') {
        if ((c == null) !== (v.value == null) || (c != null && c !== v.value)) return false
      } else if (v !== c) return false
    }
    return true
  }
  function applyOrder(data, orders) {
    return [...data].sort((a, b) => {
      for (const { field, dir } of orders) {
        const av = a[field]
        const bv = b[field]
        if (av < bv) return dir === 'desc' ? 1 : -1
        if (av > bv) return dir === 'desc' ? -1 : 1
      }
      return 0
    })
  }
  function makeCollection(name) {
    return {
      where(f) {
        const data = (rows[name] || []).filter(r => rowMatches(r, f))
        const orders = []
        const chain = {
          get: async () => ({ data: applyOrder(data, orders) }),
          orderBy(field, dir = 'asc') { orders.push({ field, dir }); return chain },
          limit(n) { return { get: async () => ({ data: applyOrder(data, orders).slice(0, n) }) } },
          skip(s) {
            return {
              ...chain,
              get: async () => ({ data: applyOrder(data, orders).slice(s) }),
              limit(n) { return { get: async () => ({ data: applyOrder(data, orders).slice(s, s + n) }) } }
            }
          }
        }
        return chain
      },
      doc(id) {
        return {
          get: async () => {
            if (rows.__missingCollections.has(name)) throw missingCollectionError(name)
            if (rows.__missingDocs.has(`${name}/${id}`)) throw missingDocumentError(name, id)
            return { data: (rows[name] || []).find(r => r._id === id) || null }
          },
          update: async ({ data }) => {
            const i = rows[name].findIndex(r => r._id === id)
            if (i >= 0) rows[name][i] = { ...rows[name][i], ...data }
            return { stats: { updated: i >= 0 ? 1 : 0 } }
          }
        }
      },
      add: async ({ data }) => {
        rows[name].push({ ...data })
        return { _id: data && data._id }
      }
    }
  }
  const api = {
    DYNAMIC_CURRENT_ENV: 'dyn',
    init: () => {},
    database: () => ({ command: _, collection: makeCollection }),
    __rows: rows
  }
  return api
})

test('timer config refreshes rank cache every 2 hours', () => {
  const config = require('../config.json')

  expect(config.triggers).toContainEqual({
    name: 'rank-cache-every-2-hours',
    type: 'timer',
    config: '0 0 0/2 * * ? *'
  })
})

describe('rankList enhancements', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.tournament_points.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__rows.baseline_standings.length = 0
    cloud.__rows.rank_cache.length = 0
    cloud.__rows.__missingCollections.clear()
    cloud.__rows.__missingDocs.clear()
  })

  function seedMatchesForMember(memberId, wins, losses, points = 20) {
    const cloud = require('wx-server-sdk')
    for (let i = 0; i < wins; i++) {
      cloud.__rows.match_results.push({
        _id: `mw_${memberId}_${i}`,
        seasonId: 's2026',
        tournamentType: 'singles',
        resultStatus: 'confirmed',
        confirmedAt: '2026-04-01',
        createTime: `2026-04-01T00:00:${String(i).padStart(2, '0')}`,
        pointsAwarded: { entries: [{ memberId, points, role: 'winner' }] }
      })
    }
    for (let i = 0; i < losses; i++) {
      cloud.__rows.match_results.push({
        _id: `ml_${memberId}_${i}`,
        seasonId: 's2026',
        tournamentType: 'singles',
        resultStatus: 'confirmed',
        confirmedAt: '2026-04-02',
        createTime: `2026-04-02T00:00:${String(i).padStart(2, '0')}`,
        pointsAwarded: { entries: [{ memberId, points: 10, role: 'loser' }] }
      })
    }
  }

  test('winRate returned as 0..1 float for 8W/2L', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a', avatarUrl: '' })
    seedMatchesForMember('A', 8, 2)
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0]._id).toBe('A')
    expect(res.data.rankList[0].winRate).toBeCloseTo(0.8, 5)
  })

  test('rankList includes unclaimed baseline member rows', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({
      _id: 'unclaimed_标子',
      name: '标子',
      avatarUrl: '/images/icons/usercenter.png',
      status: 'active',
      claimStatus: 'unclaimed'
    })
    cloud.__rows.baseline_standings.push({
      _id: 'baseline_season_2026_singles_标子',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'unclaimed_标子',
      totalPoints: 1560,
      wins: 1,
      losses: 1,
      createTime: '2026-05-18'
    })
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })
    const row = res.data.rankList.find(r => r._id === 'unclaimed_标子')
    expect(row).toMatchObject({
      _id: 'unclaimed_标子',
      name: '标子',
      avatarUrl: '',
      publicProfileVisible: false,
      totalPoints: 1560,
      winCount: 1,
      lossCount: 1,
      winRate: 0.5
    })
    expect(row).not.toHaveProperty('claimStatus')
  })

  test('winRate is 0 when member has 0 matches', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    cloud.__rows.tournament_points.push({
      _id: 'tp1',
      seasonId: 's2026',
      tournamentType: 'singles',
      memberId: 'A',
      points: 5,
      awardedAt: '2026-04-01',
      createTime: '2026-04-01'
    })
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0].winRate).toBe(0)
  })

  test('trendDelta is null when no rank_snapshots row exists', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    seedMatchesForMember('A', 1, 0)
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0].trendDelta).toBeNull()
  })

  test('trendDelta picks latest snapshot by effectiveAt DESC, computedAt DESC', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' }, { _id: 'B', name: 'b' }, { _id: 'C', name: 'c' })
    seedMatchesForMember('A', 5, 1, 40)
    seedMatchesForMember('B', 3, 2, 20)
    seedMatchesForMember('C', 1, 4, 10)
    cloud.__rows.rank_snapshots.push(
      { _id: 's1', seasonId: 's2026', type: 'singles', memberId: 'A', rank: 5,
        effectiveAt: new Date('2026-05-16T10:00:00'), computedAt: new Date('2026-05-16T10:00:00'),
        snapshotKind: 'baseline' },
      { _id: 's2', seasonId: 's2026', type: 'singles', memberId: 'A', rank: 4,
        effectiveAt: new Date('2026-05-17T23:59:59'), computedAt: new Date('2026-05-18T00:30:00'),
        snapshotKind: 'weekly' }
    )
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    const rowA = res.data.rankList.find(r => r._id === 'A')
    expect(rowA.trendDelta).toBe(3)
  })

  test('trendDelta is 0 when snapshot rank equals current rank', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    seedMatchesForMember('A', 1, 0)
    cloud.__rows.rank_snapshots.push({
      _id: 's1',
      seasonId: 's2026',
      type: 'singles',
      memberId: 'A',
      rank: 1,
      effectiveAt: new Date('2026-05-16T10:00:00'),
      computedAt: new Date('2026-05-16T10:00:00'),
      snapshotKind: 'baseline'
    })
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0].trendDelta).toBe(0)
  })

  test('rankList returns stored scheduled cache without recomputing live rows', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'LIVE', name: 'live player' })
    seedMatchesForMember('LIVE', 9, 0, 99)
    cloud.__rows.rank_cache.push({
      _id: 'rank_cache_season_2026_singles',
      seasonId: 'season_2026',
      type: 'singles',
      cacheDate: '2026-05-20',
      computedAt: new Date('2026-05-20T15:30:00Z'),
      rankList: [
        { _id: 'CACHED', name: 'cached player', avatarUrl: '', totalPoints: 10, winCount: 1, lossCount: 0, winRate: 1, trendDelta: null }
      ]
    })

    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })

    expect(res.data.rankList).toEqual([
      { _id: 'CACHED', name: '选手01', avatarUrl: '', publicProfileVisible: false, totalPoints: 10, winCount: 1, lossCount: 0, winRate: 1, trendDelta: null }
    ])
    expect(res.data.cachedAt).toEqual(new Date('2026-05-20T15:30:00Z'))
  })

  test('rankList refreshes member profile fields on cached rows without recomputing points', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'CACHED', name: '新头像用户', avatarUrl: 'fresh.png', publicProfileConsent: true })
    cloud.__rows.members.push({ _id: 'LIVE', name: 'live player' })
    seedMatchesForMember('LIVE', 9, 0, 99)
    cloud.__rows.rank_cache.push({
      _id: 'rank_cache_season_2026_singles',
      seasonId: 'season_2026',
      type: 'singles',
      cacheDate: '2026-05-20',
      computedAt: new Date('2026-05-20T15:30:00Z'),
      rankList: [
        { _id: 'CACHED', name: '旧头像用户', avatarUrl: 'stale.png', totalPoints: 10, winCount: 1, lossCount: 0, winRate: 1, trendDelta: null }
      ]
    })

    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })

    expect(res.data.rankList).toEqual([
      { _id: 'CACHED', name: '新头像用户', avatarUrl: '', publicProfileVisible: true, totalPoints: 10, winCount: 1, lossCount: 0, winRate: 1, trendDelta: null }
    ])
    expect(res.data.cachedAt).toEqual(new Date('2026-05-20T15:30:00Z'))
  })

  test('rankList recomputes when stored cache is older than a confirmed match settlement', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push(
      { _id: 'lele', name: '乐乐', avatarUrl: 'lele.png' },
      { _id: 'opponent', name: '对手', avatarUrl: 'opponent.png' }
    )
    cloud.__rows.rank_cache.push({
      _id: 'rank_cache_season_2026_singles',
      seasonId: 'season_2026',
      type: 'singles',
      cacheDate: '2026-05-20',
      computedAt: new Date('2026-05-20T15:30:00Z'),
      rankList: [
        { _id: 'lele', name: '乐乐', avatarUrl: 'lele.png', totalPoints: 20, winCount: 1, lossCount: 0, winRate: 1, trendDelta: null }
      ]
    })
    cloud.__rows.match_results.push(
      {
        _id: 'm_old',
        seasonId: 'season_2026',
        tournamentType: 'singles',
        resultStatus: 'confirmed',
        confirmedAt: new Date('2026-05-20T15:00:00Z'),
        updateTime: new Date('2026-05-20T15:00:00Z'),
        createTime: new Date('2026-05-20T14:50:00Z'),
        pointsAwarded: { entries: [{ memberId: 'lele', points: 20, role: 'winner' }] }
      },
      {
        _id: 'm_new',
        seasonId: 'season_2026',
        tournamentType: 'singles',
        resultStatus: 'confirmed',
        confirmedAt: new Date('2026-05-20T16:05:00Z'),
        updateTime: new Date('2026-05-20T16:05:00Z'),
        createTime: new Date('2026-05-20T15:55:00Z'),
        pointsAwarded: {
          entries: [
            { memberId: 'opponent', points: 20, role: 'winner' },
            { memberId: 'lele', points: 10, role: 'loser' }
          ]
        }
      }
    )

    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })

    const lele = res.data.rankList.find(row => row._id === 'lele')
    const stats = await main({ action: 'playerStats', playerId: 'lele', currentSeasonId: 'season_2026' })

    expect(lele).toMatchObject({
      _id: 'lele',
      totalPoints: 30,
      winCount: 1,
      lossCount: 1,
      winRate: 0.5
    })
    expect(lele.winCount).toBe(stats.data.stats.singles.winCount)
    expect(lele.lossCount).toBe(stats.data.stats.singles.lossCount)
    expect(lele.winRate).toBe(stats.data.stats.singles.winRate)
    expect(res.data.cachedAt).toBeUndefined()
  })

  test('rankList recomputes live rows when stored scheduled cache is empty', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: '甲', avatarUrl: 'a.png', publicProfileConsent: true })
    cloud.__rows.baseline_standings.push({
      _id: 'bs1',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'A',
      totalPoints: 100,
      wins: 4,
      losses: 1,
      createTime: '2026-05-01'
    })
    cloud.__rows.rank_cache.push({
      _id: 'rank_cache_season_2026_singles',
      seasonId: 'season_2026',
      type: 'singles',
      cacheDate: '2026-05-20',
      computedAt: new Date('2026-05-20T15:30:00Z'),
      rankList: []
    })

    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })

    expect(res.data.rankList).toEqual([
      { _id: 'A', name: '甲', avatarUrl: '', publicProfileVisible: true, totalPoints: 100, winCount: 4, lossCount: 1, winRate: 0.8, trendDelta: null }
    ])
    expect(res.data.cachedAt).toBeUndefined()
  })

  test('rankList recomputes live rows when rank_cache collection is missing', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.__missingCollections.add('rank_cache')
    cloud.__rows.members.push({ _id: 'A', name: '甲', avatarUrl: 'a.png', publicProfileConsent: true })
    cloud.__rows.baseline_standings.push({
      _id: 'bs1',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'A',
      totalPoints: 100,
      wins: 4,
      losses: 1,
      createTime: '2026-05-01'
    })

    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })

    expect(res.success).toBe(true)
    expect(res.data.rankList).toEqual([
      { _id: 'A', name: '甲', avatarUrl: '', publicProfileVisible: true, totalPoints: 100, winCount: 4, lossCount: 1, winRate: 0.8, trendDelta: null }
    ])
  })

  test('rankList recomputes live rows when rank_cache document is missing', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.__missingDocs.add('rank_cache/rank_cache_season_2026_singles')
    cloud.__rows.members.push({ _id: 'A', name: '甲', avatarUrl: 'a.png', publicProfileConsent: true })
    cloud.__rows.baseline_standings.push({
      _id: 'bs1',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'A',
      totalPoints: 100,
      wins: 4,
      losses: 1,
      createTime: '2026-05-01'
    })

    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })

    expect(res.success).toBe(true)
    expect(res.data.rankList).toEqual([
      { _id: 'A', name: '甲', avatarUrl: '', publicProfileVisible: true, totalPoints: 100, winCount: 4, lossCount: 1, winRate: 0.8, trendDelta: null }
    ])
  })

  test('refreshRankCache writes singles and doubles scheduled cache rows', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push(
      { _id: 'A', name: '甲', avatarUrl: 'a.png', publicProfileConsent: true },
      { _id: 'B', name: '乙', avatarUrl: 'b.png', publicProfileConsent: true }
    )
    cloud.__rows.baseline_standings.push(
      { _id: 'bs1', seasonId: 'season_2026', type: 'singles', memberId: 'A', totalPoints: 100, wins: 4, losses: 1, createTime: '2026-05-01' },
      { _id: 'bd1', seasonId: 'season_2026', type: 'doubles', memberId: 'B', totalPoints: 80, wins: 2, losses: 2, createTime: '2026-05-01' }
    )

    const { main } = require('../index')
    const res = await main({ action: 'refreshRankCache', seasonId: 'season_2026', now: '2026-05-20T23:30:00+08:00' })

    expect(res.success).toBe(true)
    expect(res.data).toEqual({ seasonId: 'season_2026', cacheDate: '2026-05-20', refreshedTypes: ['singles', 'doubles'] })
    expect(cloud.__rows.rank_cache).toHaveLength(2)
    expect(cloud.__rows.rank_cache.find(row => row.type === 'singles')).toMatchObject({
      _id: 'rank_cache_season_2026_singles',
      seasonId: 'season_2026',
      cacheDate: '2026-05-20',
      rankList: [
        { _id: 'A', name: '甲', avatarUrl: '', publicProfileVisible: true, totalPoints: 100, winCount: 4, lossCount: 1, winRate: 0.8, trendDelta: null }
      ]
    })
    expect(cloud.__rows.rank_cache.find(row => row.type === 'doubles').rankList[0]).toMatchObject({
      _id: 'B',
      name: '乙',
      avatarUrl: '',
      publicProfileVisible: true,
      totalPoints: 80,
      winRate: 0.5
    })
  })
})

describe('playerStats — winRate', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__rows.baseline_standings.length = 0
  })

  test('singles 8W/2L → winRate 0.8 (≈0.8 within 5 decimals)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p', avatarUrl: '' })
    for (let i = 0; i < 8; i++) {
      cloud.__rows.match_results.push({
        _id: `w${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-01', createTime: '2026-04-01', playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] }
      })
    }
    for (let i = 0; i < 2; i++) {
      cloud.__rows.match_results.push({
        _id: `l${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-02', createTime: '2026-04-02', playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] }
      })
    }
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.stats.singles.winRate).toBeCloseTo(0.8, 5)
  })

  test('player with 0 matches → winRate = 0 (no divide-by-zero)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.stats.singles.winRate).toBe(0)
    expect(res.data.stats.doubles.winRate).toBe(0)
  })

  test('playerStats includes baseline singles and doubles buckets', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({
      _id: 'unclaimed_标子',
      name: '标子',
      avatarUrl: '/images/icons/usercenter.png',
      status: 'active',
      claimStatus: 'unclaimed'
    })
    cloud.__rows.baseline_standings.push(
      {
        _id: 'baseline_season_2026_singles_标子',
        seasonId: 'season_2026',
        type: 'singles',
        memberId: 'unclaimed_标子',
        totalPoints: 1560,
        wins: 1,
        losses: 1,
        createTime: '2026-05-18'
      },
      {
        _id: 'baseline_season_2026_doubles_标子',
        seasonId: 'season_2026',
        type: 'doubles',
        memberId: 'unclaimed_标子',
        totalPoints: 880,
        wins: 2,
        losses: 0,
        createTime: '2026-05-18'
      }
    )
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'unclaimed_标子', currentSeasonId: 'season_2026' })
    expect(res.data.stats.singles).toEqual({
      winCount: 1,
      lossCount: 1,
      totalPoints: 1560,
      winRate: 0.5
    })
    expect(res.data.stats.doubles).toEqual({
      winCount: 2,
      lossCount: 0,
      totalPoints: 880,
      winRate: 1
    })
    expect(res.data.currentRank).toEqual({ singles: 1, doubles: 1 })
    expect(res.data.recent).toEqual([])
  })
})

describe('playerStats — currentRank', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__rows.baseline_standings.length = 0
  })

  test('player ranked #2 in singles, unranked in doubles → { singles: 2, doubles: null }', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' }, { _id: 'B', name: 'b' })
    cloud.__rows.match_results.push(
      { _id: 'mA', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-01', createTime: '2026-04-01', playerIds: ['A'],
        pointsAwarded: { entries: [{ memberId: 'A', points: 50, role: 'winner' }] } },
      { _id: 'mB1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-01', createTime: '2026-04-01', playerIds: ['B'],
        pointsAwarded: { entries: [{ memberId: 'B', points: 100, role: 'winner' }] } }
    )
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'A', currentSeasonId: 's2026' })
    expect(res.data.currentRank.singles).toBe(2)
    expect(res.data.currentRank.doubles).toBeNull()
  })

  test('player not on any leaderboard → both ranks null', async () => {
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'GHOST', currentSeasonId: 's2026' })
    expect(res.data.currentRank).toEqual({ singles: null, doubles: null })
  })
})

describe('playerStats — rankHistory', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__rows.baseline_standings.length = 0
  })

  test('returns up to 12 weeks ordered weekStart ASC for both types', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    const seededRows = []
    for (let i = 0; i < 14; i++) {
      const day = `2026-0${Math.floor((i + 1) / 4) + 1}-${String((i + 1) * 2).padStart(2, '0')}`
      const row = {
        _id: `s_${i}`, seasonId: 's2026', type: 'singles', memberId: 'P',
        weekId: `ws_${day}`, weekStart: day, weekEnd: day,
        effectiveAt: new Date(day), computedAt: new Date(day),
        rank: 10 - i, totalPoints: 100 + i, wins: i, losses: 0, snapshotKind: 'weekly'
      }
      seededRows.push(row)
      cloud.__rows.rank_snapshots.push(row)
    }
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    const expected = [...seededRows]
      .sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0))
      .slice(0, 12)
      .map(r => ({ weekStart: r.weekStart, rank: r.rank }))
      .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0))

    expect(res.data.rankHistory.singles).toHaveLength(12)
    expect(res.data.rankHistory.singles).toEqual(expected)
    expect(res.data.rankHistory.singles.map(r => r.weekStart)).toEqual(
      [...res.data.rankHistory.singles.map(r => r.weekStart)].sort()
    )
    res.data.rankHistory.singles.forEach(row => {
      expect(Object.keys(row).sort()).toEqual(['rank', 'weekStart'])
    })
    expect(res.data.rankHistory.doubles).toEqual([])
  })

  test('fewer than 12 weeks available → returns all', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    cloud.__rows.rank_snapshots.push({
      _id: 'only', seasonId: 's2026', type: 'singles', memberId: 'P',
      weekId: 'ws_2026-05-04', weekStart: '2026-05-04', weekEnd: '2026-05-10',
      effectiveAt: new Date('2026-05-10'), computedAt: new Date('2026-05-11'),
      rank: 3, totalPoints: 100, wins: 5, losses: 1, snapshotKind: 'weekly'
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.rankHistory.singles).toEqual([{ weekStart: '2026-05-04', rank: 3 }])
  })
})

describe('playerStats — weeklySnapshot (this-week delta)', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__rows.baseline_standings.length = 0
  })

  test('player has 3W 1L worth 70 points this week (singles)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    const today = new Date()
    const day = today.toISOString().slice(0, 10)
    for (let i = 0; i < 3; i++) {
      cloud.__rows.match_results.push({
        _id: `w${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: day, createTime: day, playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] }
      })
    }
    cloud.__rows.match_results.push({
      _id: 'l1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: day, createTime: day, playerIds: ['P'],
      pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] }
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.weeklySnapshot.singles).toEqual({ pointsDelta: 70, wins: 3, losses: 1 })
    expect(res.data.weeklySnapshot.doubles).toEqual({ pointsDelta: 0, wins: 0, losses: 0 })
  })
})

describe('playerStats.recent enrichment', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.tournaments = cloud.__rows.tournaments || []
    cloud.__rows.tournaments.length = 0
    cloud.__rows.baseline_standings.length = 0
  })

  test('recent rows carry tournamentName/Format, roundLabel, opponent, pointsAwarded, confirmedAt', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' }, { _id: 'X', name: '张昊', publicProfileConsent: true })
    cloud.__rows.tournaments.push({ _id: 't1', name: '春季锦标赛', format: 'knockout', totalRounds: 4 })
    cloud.__rows.match_results.push({
      _id: 'm1', tournamentId: 't1', round: 3, score: '6-4, 6-2',
      seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      playerIds: ['P', 'X'],
      confirmedAt: '2026-05-14', createTime: '2026-05-14',
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'X', points: 10, role: 'loser' }
      ]}
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.recent[0]).toMatchObject({
      tournamentName: '春季锦标赛',
      tournamentFormat: 'knockout',
      roundLabel: 'SF',
      opponentId: 'X',
      opponentName: '张昊',
      won: true,
      pointsAwarded: 20,
      confirmedAt: '2026-05-14'
    })
  })
})

describe('playerH2H action', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.baseline_standings.length = 0
  })

  test('returns { singles: [...], doubles: [...] } shaped per spec', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: '甲', avatarUrl: 'a', publicProfileConsent: true }, { _id: 'P', name: 'p' })
    cloud.__rows.match_results.push({
      _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: '2026-05-10', createTime: '2026-05-10', playerIds: ['P', 'A'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'A', points: 10, role: 'loser' }
      ]}
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.success).toBe(true)
    expect(res.data.singles).toEqual([
      { memberId: 'A', name: '甲', avatarUrl: 'a', publicProfileVisible: true, wins: 1, losses: 0, lastPlayedAt: '2026-05-10' }
    ])
    expect(res.data.doubles).toEqual([])
  })

  test('aggregates beyond the first page of H2H matches', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: '甲', avatarUrl: 'a', publicProfileConsent: true }, { _id: 'P', name: 'p' })
    for (let i = 0; i < 1001; i++) {
      cloud.__rows.match_results.push({
        _id: `m${String(i).padStart(4, '0')}`,
        seasonId: 's2026',
        tournamentType: 'singles',
        resultStatus: 'confirmed',
        confirmedAt: '2026-05-10',
        createTime: '2026-05-10',
        playerIds: ['P', 'A'],
        pointsAwarded: { entries: [
          { memberId: 'P', points: 20, role: 'winner' },
          { memberId: 'A', points: 10, role: 'loser' }
        ]}
      })
    }
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.success).toBe(true)
    expect(res.data.singles).toEqual([
      { memberId: 'A', name: '甲', avatarUrl: 'a', publicProfileVisible: true, wins: 1001, losses: 0, lastPlayedAt: '2026-05-10' }
    ])
    expect(res.data.doubles).toEqual([])
  })

  test('missing playerId → INVALID_ARG', async () => {
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', currentSeasonId: 's2026' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('INVALID_ARG')
  })

  test('non-existent playerId → NOT_FOUND', async () => {
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', playerId: 'GHOST', currentSeasonId: 's2026' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })

  test('existing player with missing seasonId → empty arrays', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', playerId: 'P' })
    expect(res.success).toBe(true)
    expect(res.data).toEqual({ singles: [], doubles: [] })
  })
})
