const upserts = []
const d = (key) => new Date(`${key}T00:00:00`)

jest.mock('wx-server-sdk', () => {
  const op = (__op, value) => ({
    __op,
    value,
    and(other) { return { __op: 'fieldAnd', clauses: [this, other] } }
  })
  const _ = {
    and: (cs) => ({ __op: 'and', clauses: cs }),
    or: (cs) => ({ __op: 'or', clauses: cs }),
    in: (v) => op('in', v),
    gt: (v) => op('gt', v),
    gte: (v) => op('gte', v),
    lte: (v) => op('lte', v),
    eq: (v) => op('eq', v)
  }
  const rows = { match_results: [], tournament_points: [], members: [], weekly_stars: [], rank_snapshots: [] }
  function rowMatches(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => rowMatches(row, c))
    if (f.__op === 'or') return f.clauses.some(c => rowMatches(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'fieldAnd') {
        for (const clause of v.clauses) {
          if (clause.__op === 'gte' && !(c >= clause.value)) return false
          if (clause.__op === 'lte' && !(c <= clause.value)) return false
        }
      } else if (v && v.__op === 'gt') {
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
          update: async ({ data }) => {
            upserts.push({ collection: name, _id: id, data })
            const i = rows[name].findIndex(r => r._id === id)
            if (i >= 0) rows[name][i] = { ...rows[name][i], ...data }
            else rows[name].push({ _id: id, ...data })
            return { stats: { updated: 1 } }
          },
          get: async () => {
            const r = rows[name].find(x => x._id === id)
            return { data: r || null }
          }
        }
      },
      add: async ({ data }) => {
        upserts.push({ collection: name, _id: data._id, data })
        rows[name].push(data)
        return { _id: data._id }
      }
    }
  }
  const api = {
    DYNAMIC_CURRENT_ENV: 'dyn',
    init: () => {},
    getWXContext: () => ({ OPENID: api.__openid || 'admin-openid' }),
    database: () => ({ command: _, collection: makeCollection, serverDate: () => new Date() }),
    __rows: rows,
    __openid: 'admin-openid',
    __upserts: upserts
  }
  return api
})

describe('weekly-star.compute double-write', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.tournament_points.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.weekly_stars.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__openid = 'admin-openid'
    upserts.length = 0
  })

  test('compute writes one rank_snapshots row per ranked entry with snapshotKind=weekly and previous week effectiveAt', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: '陈思远', avatarUrl: 'a' }, { _id: 'B', name: '李志刚', avatarUrl: 'b' })
    cloud.__rows.match_results.push(
      { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: d('2026-05-05'), createTime: d('2026-05-05'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] } },
      { _id: 'm2', seasonId: 's2026', tournamentType: 'doubles', resultStatus: 'confirmed',
        confirmedAt: d('2026-05-06'), createTime: d('2026-05-06'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 15, role: 'winner' }, { memberId: 'B', points: 5, role: 'loser' }] } }
    )

    const { main } = require('../index')
    const res = await main({ action: 'compute', seasonId: 's2026', now: '2026-05-12T00:30:00' })
    expect(res.success).toBe(true)

    const snapshotRows = cloud.__rows.rank_snapshots
    expect(snapshotRows.length).toBe(4)
    const singles = snapshotRows.filter(r => r.type === 'singles')
    expect(singles.every(r => r.snapshotKind === 'weekly')).toBe(true)
    expect(singles.every(r => r.weekStart === '2026-05-04')).toBe(true)
    expect(singles.find(r => r.memberId === 'A').rank).toBe(1)
    expect(singles.find(r => r.memberId === 'B').rank).toBe(2)
  })

  test('idempotent: same week re-run does not create duplicate docs', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    cloud.__rows.match_results.push({
      _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: d('2026-05-05'), createTime: d('2026-05-05'),
      pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }] }
    })
    const { main } = require('../index')
    await main({ action: 'compute', seasonId: 's2026', now: '2026-05-12T00:30:00' })
    await main({ action: 'compute', seasonId: 's2026', now: '2026-05-12T00:30:00' })
    expect(cloud.__rows.rank_snapshots.length).toBe(1)
  })
})

describe('weekly-star.recomputeRankSnapshots', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.tournament_points.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__rows.members.length = 0
    cloud.__openid = 'admin-openid'
  })

  test('baseline=true writes baseline rows with weekId baseline_<today>', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'ADMIN', openid: 'admin-openid', admin: true, name: 'Admin' })
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    cloud.__rows.match_results.push({
      _id: 'm', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: d('2026-04-01'), createTime: d('2026-04-01'),
      pointsAwarded: { entries: [{ memberId: 'A', points: 100, role: 'winner' }] }
    })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: true, now: '2026-05-16T10:00:00' })
    expect(res.success).toBe(true)
    expect(res.data.weekId).toBe('baseline_2026-05-16')
    const row = cloud.__rows.rank_snapshots.find(r => r.memberId === 'A' && r.type === 'singles')
    expect(row.snapshotKind).toBe('baseline')
    expect(row.rank).toBe(1)
  })

  test('baseline=false with weekStart writes weekly rows with proper weekId/weekEnd', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'ADMIN', openid: 'admin-openid', admin: true, name: 'Admin' })
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    cloud.__rows.match_results.push({
      _id: 'm', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: d('2026-04-15'), createTime: d('2026-04-15'),
      pointsAwarded: { entries: [{ memberId: 'A', points: 100, role: 'winner' }] }
    })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: false, weekStart: '2026-04-13' })
    expect(res.success).toBe(true)
    expect(res.data.weekId).toBe('ws_2026-04-13')
    const row = cloud.__rows.rank_snapshots.find(r => r.memberId === 'A' && r.type === 'singles')
    expect(row.snapshotKind).toBe('weekly')
    expect(row.weekStart).toBe('2026-04-13')
    expect(row.weekEnd).toBe('2026-04-19')
  })

  test('baseline=false without weekStart returns INVALID_PAYLOAD', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'ADMIN', openid: 'admin-openid', admin: true, name: 'Admin' })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: false })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('INVALID_PAYLOAD')
  })

  test('non-admin caller returns FORBIDDEN and writes no rows', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__openid = 'member-openid'
    cloud.__rows.members.push({ _id: 'M', openid: 'member-openid', admin: false, name: 'Member' })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: true, now: '2026-05-16T10:00:00' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('FORBIDDEN')
    expect(cloud.__rows.rank_snapshots.length).toBe(0)
  })
})
