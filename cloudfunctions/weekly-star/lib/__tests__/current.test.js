const { resolveCurrentWeeklyStar } = require('../current')

function makeFakeDb({ matches = [], placements = [], stars = [], members = [] } = {}) {
  const _ = {
    and(cs) { return { __op: 'and', clauses: cs } },
    or(cs) { return { __op: 'or', clauses: cs } },
    in(v) { return { __op: 'in', value: v } },
    gte(v) { return { __op: 'gte', value: v } },
    lte(v) { return { __op: 'lte', value: v } },
    eq(v) { return { __op: 'eq', value: v } }
  }
  function rowMatches(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => rowMatches(row, c))
    if (f.__op === 'or') return f.clauses.some(c => rowMatches(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'gte') {
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
  const collections = {
    match_results: matches,
    tournament_points: placements,
    weekly_stars: stars,
    members
  }
  return {
    command: _,
    collection(name) {
      return {
        where(f) {
          const data = (collections[name] || []).filter(r => rowMatches(r, f))
          const orders = []
          const chain = {
            get: async () => ({ data: applyOrder(data, orders) }),
            orderBy(field, dir = 'asc') { orders.push({ field, dir }); return chain },
            limit(n) { return { get: async () => ({ data: applyOrder(data, orders).slice(0, n) }) } }
          }
          return chain
        }
      }
    }
  }
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

describe("weekly-star.current - previous natural week display", () => {
  test('returns top scorer for the supplied complete natural week', async () => {
    const week = { weekStart: '2026-05-11', weekEnd: '2026-05-17' }
    const db = makeFakeDb({
      members: [
        { _id: 'A', name: '陈思远', avatarUrl: 'a.png' },
        { _id: 'B', name: '李志刚', avatarUrl: 'b.png' }
      ],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-05-12', createTime: '2026-05-12',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 50, role: 'winner' },
            { memberId: 'B', points: 10, role: 'loser' }
          ] } }
      ]
    })
    const out = await resolveCurrentWeeklyStar({ db, seasonId: 's2026', type: 'singles', week })
    expect(out.mode).toBe('current')
    expect(out.star.memberId).toBe('A')
    expect(out.star.pointsDelta).toBe(50)
    expect(out.star.wins).toBe(1)
    expect(out.star.losses).toBe(0)
    expect(out.subtitle).toBe('上周积分 +50 · W-L 1-0')
  })
})

describe('weekly-star.current empty mode', () => {
  test("mode='empty' when the supplied complete natural week is empty, even if historical weekly_stars exist", async () => {
    const week = { weekStart: '2026-05-11', weekEnd: '2026-05-17' }
    const db = makeFakeDb({
      members: [{ _id: 'X', name: '王浩', avatarUrl: 'x.png' }],
      matches: [],
      stars: [
        { _id: 'ws_2026-05-04', seasonId: 's2026', weekStart: '2026-05-04', weekEnd: '2026-05-10',
          singlesStar: { memberId: 'X', points: 60, wins: 3, losses: 1 } }
      ]
    })
    const out = await resolveCurrentWeeklyStar({ db, seasonId: 's2026', type: 'singles', week })
    expect(out.mode).toBe('empty')
    expect(out.star).toBeNull()
    expect(out.subtitle).toBeNull()
  })

  test("mode='empty' when the supplied complete natural week and history are both empty", async () => {
    const week = { weekStart: '2026-05-11', weekEnd: '2026-05-17' }
    const db = makeFakeDb({ members: [], matches: [], stars: [] })
    const out = await resolveCurrentWeeklyStar({ db, seasonId: 's2026', type: 'singles', week })
    expect(out.mode).toBe('empty')
    expect(out.star).toBeNull()
    expect(out.subtitle).toBeNull()
  })
})
