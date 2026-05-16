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
  const rows = { match_results: [], tournament_points: [], members: [], rank_snapshots: [], tournaments: [] }
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
          get: async () => ({ data: (rows[name] || []).find(r => r._id === id) || null }),
          update: async ({ data }) => {
            const i = rows[name].findIndex(r => r._id === id)
            if (i >= 0) rows[name][i] = { ...rows[name][i], ...data }
            return { stats: { updated: i >= 0 ? 1 : 0 } }
          }
        }
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

describe('rankList enhancements', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.tournament_points.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
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
})
