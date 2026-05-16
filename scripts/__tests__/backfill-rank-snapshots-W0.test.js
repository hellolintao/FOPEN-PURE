const { runBackfill } = require('../backfill-rank-snapshots-W0')

function makeFakeDb({ matches = [], placements = [], members = [] } = {}) {
  const _ = {
    and: cs => ({ __op: 'and', clauses: cs }),
    or: cs => ({ __op: 'or', clauses: cs }),
    in: v => ({ __op: 'in', value: v }),
    gt: v => ({ __op: 'gt', value: v }),
    gte: v => ({ __op: 'gte', value: v }),
    lte: v => ({ __op: 'lte', value: v }),
    eq: v => ({ __op: 'eq', value: v })
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
        if (!v.value.includes(c)) return false
      } else if (v && v.__op === 'eq') {
        if ((c == null) !== (v.value == null) || (c != null && c !== v.value)) return false
      } else if (v !== c) return false
    }
    return true
  }
  const rows = { match_results: matches, tournament_points: placements, members, rank_snapshots: [] }
  const upserts = []
  function makeColl(name) {
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
  return { db: { command: _, collection: makeColl, serverDate: () => new Date() }, rows, upserts }
}

function applyOrder(data, orders) {
  return [...data].sort((a, b) => {
    for (const { field, dir } of orders) {
      if (a[field] < b[field]) return dir === 'desc' ? 1 : -1
      if (a[field] > b[field]) return dir === 'desc' ? -1 : 1
    }
    return 0
  })
}

describe('runBackfill W0 baseline', () => {
  test('writes baseline rows with snapshotKind=baseline and weekId=baseline_<today>', async () => {
    const { db, rows } = makeFakeDb({
      members: [{ _id: 'A', name: 'a' }, { _id: 'B', name: 'b' }],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-04-01', createTime: '2026-04-01',
          pointsAwarded: { entries: [{ memberId: 'A', points: 30, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] } }
      ]
    })
    const now = new Date('2026-05-16T10:00:00')
    const result = await runBackfill({ db, seasonId: 's2026', now })
    expect(result.total).toBeGreaterThanOrEqual(2)
    const singles = rows.rank_snapshots.filter(r => r.type === 'singles')
    expect(singles[0].snapshotKind).toBe('baseline')
    expect(singles[0].weekId).toBe('baseline_2026-05-16')
    expect(singles[0].effectiveAt).toEqual(now)
    expect(singles.find(r => r.memberId === 'A').rank).toBe(1)
  })

  test('same-day re-run is idempotent', async () => {
    const { db, rows } = makeFakeDb({
      members: [{ _id: 'A', name: 'a' }],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-04-01', createTime: '2026-04-01',
          pointsAwarded: { entries: [{ memberId: 'A', points: 30, role: 'winner' }] } }
      ]
    })
    const now = new Date('2026-05-16T10:00:00')
    await runBackfill({ db, seasonId: 's2026', now })
    await runBackfill({ db, seasonId: 's2026', now })
    expect(rows.rank_snapshots.length).toBe(1)
  })

  test('different-day re-run produces rows with different ids', async () => {
    const { db, rows } = makeFakeDb({
      members: [{ _id: 'A', name: 'a' }],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-04-01', createTime: '2026-04-01',
          pointsAwarded: { entries: [{ memberId: 'A', points: 30, role: 'winner' }] } }
      ]
    })
    await runBackfill({ db, seasonId: 's2026', now: new Date('2026-05-16T10:00:00') })
    await runBackfill({ db, seasonId: 's2026', now: new Date('2026-05-17T10:00:00') })
    expect(rows.rank_snapshots.length).toBe(2)
    const ids = rows.rank_snapshots.map(r => r._id)
    expect(new Set(ids).size).toBe(2)
  })
})
