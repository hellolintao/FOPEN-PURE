const { aggregateRanks } = require('../aggregate')

/**
 * In-memory db emulator that supports:
 *   - collection(name).where(filter).orderBy(field, dir).orderBy(field, dir).limit(N).get()
 * filter can be:
 *   - plain object (AND of equality)
 *   - { __op: 'and', clauses: [...] }
 *   - { __op: 'or', clauses: [...] }
 *   - { __op: 'gt', value: x } as field value (paired with field key)
 *   - { __op: 'in', value: [...] } as field value
 * We don't fully emulate TCB SDK, but enough to validate compound-cursor pagination.
 *
 * For simplicity, the implementation under test will build queries using db.command
 * helpers. We provide a fake db.command that produces sentinel objects, which the
 * fake where() interprets.
 */
function makeFakeDb({ matchResults, tournamentPoints }) {
  const _ = {
    and(clauses) { return { __op: 'and', clauses } },
    or(clauses) { return { __op: 'or', clauses } },
    gt(value) { return { __op: 'gt', value } },
    lt(value) { return { __op: 'lt', value } },
    lte(value) { return { __op: 'lte', value } },
    eq(value) { return { __op: 'eq', value } },
    in(value) { return { __op: 'in', value } },
    neq(value) { return { __op: 'neq', value } }
  }
  function matchRow(row, filter) {
    if (filter && filter.__op === 'and') return filter.clauses.every(c => matchRow(row, c))
    if (filter && filter.__op === 'or')  return filter.clauses.some(c => matchRow(row, c))
    for (const [k, v] of Object.entries(filter || {})) {
      const cell = row[k]
      if (v && typeof v === 'object' && v.__op) {
        if (v.__op === 'gt') { if (!(cell > v.value)) return false }
        else if (v.__op === 'lt') { if (!(cell < v.value)) return false }
        else if (v.__op === 'lte') { if (!(cell <= v.value)) return false }
        else if (v.__op === 'eq') {
          if ((cell == null) !== (v.value == null) || (cell != null && cell !== v.value)) return false
        }
        else if (v.__op === 'in') { if (!v.value.includes(cell)) return false }
        else if (v.__op === 'neq') { if (cell === v.value) return false }
        else return false
      } else if (cell !== v) return false
    }
    return true
  }
  function buildCollection(rows) {
    function cursor(filter, orders, lim) {
      const filtered = rows.filter(r => matchRow(r, filter))
      const sorted = filtered.sort((a, b) => {
        for (const [field, dir] of orders) {
          if (a[field] < b[field]) return dir === 'asc' ? -1 : 1
          if (a[field] > b[field]) return dir === 'asc' ? 1 : -1
        }
        return 0
      })
      return sorted.slice(0, lim || sorted.length)
    }
    function api(filter = {}, orders = [], lim = null) {
      return {
        where(f) { return api(f, orders, lim) },
        orderBy(field, dir) { return api(filter, [...orders, [field, dir]], lim) },
        limit(n) { return api(filter, orders, n) },
        async get() { return { data: cursor(filter, orders, lim) } }
      }
    }
    return api()
  }
  return {
    command: _,
    collection(name) {
      if (name === 'tournament_points' && tournamentPoints === undefined) {
        return {
          where() {
            return {
              orderBy() { return this },
              limit() { return this },
              async get() {
                const e = new Error('database collection not exists')
                e.errCode = -502005
                throw e
              }
            }
          }
        }
      }
      const rows = name === 'match_results' ? matchResults : (name === 'tournament_points' ? tournamentPoints : [])
      return buildCollection(rows)
    }
  }
}

function generateConfirmedMatches(seasonId, type, n, opts = {}) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      _id: `r_${seasonId}_${type}_${i}`,
      tournamentId: `T_${seasonId}`,
      seasonId,
      tournamentType: type,
      matchKind: 'bracket',
      resultStatus: 'confirmed',
      createTime: new Date(2026, 0, 1, 0, 0, i),
      pointsAwarded: { source: 'match', entries: [
        { memberId: `M_${i % 5}`, points: 20, role: 'winner' },
        { memberId: `M_${(i % 5) + 5}`, points: 10, role: 'loser' }
      ] }
    })
  }
  return out
}

describe('aggregateRanks', () => {
  test('单页：50 条 → 累加正确', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 50)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].totalPoints).toBeGreaterThanOrEqual(list[list.length - 1].totalPoints)
    // 5 winners (M_0..M_4) + 5 losers (M_5..M_9) = 10 distinct memberIds
    expect(list.length).toBe(10)
    // 50 matches: 50 winners * 20 + 50 losers * 10 = 1000 + 500 = 1500
    const total = list.reduce((s, x) => s + x.totalPoints, 0)
    expect(total).toBe(1500)
  })

  test('多页：250 条 / pageSize=100 → 全部累加', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 250)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const total = list.reduce((s, x) => s + x.totalPoints, 0)
    expect(total).toBe(250 * 20 + 250 * 10) // 7500
  })

  test('大数据：2500 条 / pageSize=100 → 25 页', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 2500)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const total = list.reduce((s, x) => s + x.totalPoints, 0)
    expect(total).toBe(2500 * 30)
  })

  test('按 seasonId / type 过滤', async () => {
    const matches = [
      ...generateConfirmedMatches('S1', 'singles', 10),
      ...generateConfirmedMatches('S2', 'singles', 10),
      ...generateConfirmedMatches('S1', 'doubles', 10)
    ]
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const total = list.reduce((s, x) => s + x.totalPoints, 0)
    expect(total).toBe(10 * 30) // 仅 S1+singles
  })

  test('结合 tournament_points placement', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 10)
    const placement = [
      { _id: 'p1', tournamentId: 'T1', memberId: 'M_0', seasonId: 'S1', tournamentType: 'singles', points: 100, rank: 'champion', createTime: new Date(2026, 1, 1) }
    ]
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: placement })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const M0 = list.find(x => x.memberId === 'M_0')
    // M_0 is winner 10 times (in this set: i%5===0 → M_0 → 2 matches, but iteration i 0..9 with 5 mod → M_0 wins on i=0,5; M_5 wins on 0; etc.)
    // Actually: M_0 = winner when i%5==0 → i=0,5 → 2 wins * 20 = 40; M_0 never loser. Plus 100 placement → 140.
    expect(M0.totalPoints).toBe(40 + 100)
    expect(M0.wins).toBe(2)
  })

  test('E2E fixture ranking combines match winLoss and placement points', async () => {
    const seasonId = 'season_2026'
    const db = makeFakeDb({
      matchResults: [
        { _id: 'm1', seasonId, tournamentType: 'singles', resultStatus: 'confirmed', createTime: new Date('2026-05-17T10:00:00Z'),
          pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] } },
        { _id: 'm2', seasonId, tournamentType: 'singles', resultStatus: 'confirmed', createTime: new Date('2026-05-17T11:00:00Z'),
          pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'C', points: 10, role: 'loser' }] } },
      ],
      tournamentPoints: [
        { _id: 'tp_A', seasonId, tournamentType: 'singles', memberId: 'A', points: 100, rank: 'champion', createTime: new Date('2026-05-17T12:00:00Z') },
        { _id: 'tp_C', seasonId, tournamentType: 'singles', memberId: 'C', points: 60, rank: 'runnerUp', createTime: new Date('2026-05-17T12:00:00Z') },
      ],
    })
    const list = await aggregateRanks({ db, seasonId, type: 'singles', pageSize: 100 })
    expect(list[0]).toMatchObject({ memberId: 'A', totalPoints: 140, wins: 2 })
    expect(list.find(r => r.memberId === 'C')).toMatchObject({ totalPoints: 70, losses: 1 })
  })

  test('sort by totalPoints desc', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 10)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].totalPoints).toBeGreaterThanOrEqual(list[i].totalPoints)
    }
  })

  test('空数据 → 空数组', async () => {
    const db = makeFakeDb({ matchResults: [], tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    expect(list).toEqual([])
  })

  test('tournament_points 集合不存在 → 仅按 match_results 聚合', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 3)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: undefined })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const total = list.reduce((s, x) => s + x.totalPoints, 0)
    expect(total).toBe(3 * 30)
  })

  test('忽略 non-confirmed match', async () => {
    const matches = [
      ...generateConfirmedMatches('S1', 'singles', 5),
      { _id: 'pending_1', tournamentId: 'T1', seasonId: 'S1', tournamentType: 'singles', resultStatus: 'pending', createTime: new Date(), pointsAwarded: null }
    ]
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const total = list.reduce((s, x) => s + x.totalPoints, 0)
    expect(total).toBe(5 * 30) // 只算 5 confirmed
  })
})

describe('aggregateRanks asOf parameter', () => {
  const seasonId = 's2026'
  const type = 'singles'
  const d = (key) => new Date(`${key}T00:00:00`)

  test('without asOf -> equivalent to historical behavior (aggregates all)', async () => {
    const db = makeFakeDb({
      matchResults: [
        { _id: 'm1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-01-10'), createTime: d('2026-01-10'),
          pointsAwarded: { entries: [
            { memberId: 'A', points: 20, role: 'winner' },
            { memberId: 'B', points: 10, role: 'loser' }
          ] } },
        { _id: 'm2', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-03-10'), createTime: d('2026-03-10'),
          pointsAwarded: { entries: [
            { memberId: 'A', points: 20, role: 'winner' },
            { memberId: 'C', points: 10, role: 'loser' }
          ] } }
      ],
      tournamentPoints: []
    })
    const out = await aggregateRanks({ db, seasonId, type })
    expect(out.find(r => r.memberId === 'A').totalPoints).toBe(40)
  })

  test('asOf cuts off future match_results by confirmedAt', async () => {
    const db = makeFakeDb({
      matchResults: [
        { _id: 'm1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-01-10'), createTime: d('2026-01-09'),
          pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }] } },
        { _id: 'm2', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-03-10'), createTime: d('2026-03-09'),
          pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }] } }
      ],
      tournamentPoints: []
    })
    const out = await aggregateRanks({ db, seasonId, type, asOf: d('2026-02-01') })
    expect(out.find(r => r.memberId === 'A').totalPoints).toBe(20)
  })

  test('asOf cuts off tournament_points by awardedAt (fallback createTime)', async () => {
    const db = makeFakeDb({
      matchResults: [],
      tournamentPoints: [
        { _id: 'p1', seasonId, tournamentType: type, memberId: 'A', points: 50,
          awardedAt: d('2026-01-15'), createTime: d('2026-01-15') },
        { _id: 'p2', seasonId, tournamentType: type, memberId: 'A', points: 30,
          awardedAt: d('2026-04-15'), createTime: d('2026-04-15') }
      ]
    })
    const out = await aggregateRanks({ db, seasonId, type, asOf: d('2026-02-01') })
    expect(out.find(r => r.memberId === 'A').totalPoints).toBe(50)
  })
})

describe('aggregateRanks stable tiebreaker', () => {
  test('ties broken by wins DESC, then losses ASC, then memberId ASC', async () => {
    const seasonId = 's2026'
    const type = 'singles'
    const db = makeFakeDb({
      matchResults: [
        // B is intentionally seeded first. Old totalPoints-only sort preserves insertion order,
        // so the RED test fails until wins/losses/memberId tiebreakers are added.
        // B: 100 pts, 4W, 0L
        { _id: 'b1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-01', createTime: '2026-01-01',
          pointsAwarded: { entries: [
            { memberId: 'B', points: 100, role: 'winner' },
            { memberId: 'Y', points: 0, role: 'loser' }
          ] } },
        ...[1, 2, 3].map((i) => ({
          _id: `b${i + 1}`, seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-02', createTime: '2026-01-02',
          pointsAwarded: { entries: [
            { memberId: 'B', points: 0, role: 'winner' },
            { memberId: 'Y', points: 0, role: 'loser' }
          ] }
        })),
        // A: 100 pts, 5W, 1L
        { _id: 'a1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-03', createTime: '2026-01-03',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 100, role: 'winner' },
            { memberId: 'X', points: 0, role: 'loser' }
          ] } },
        // Aux to push A win=5 loss=1
        ...[1, 2, 3, 4].map((i) => ({
          _id: `a${i + 1}`, seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-04', createTime: '2026-01-04',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 0, role: 'winner' },
            { memberId: 'X', points: 0, role: 'loser' }
          ] }
        })),
        { _id: 'a6', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-05', createTime: '2026-01-05',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 0, role: 'loser' },
            { memberId: 'X', points: 0, role: 'winner' }
          ] } }
      ],
      tournamentPoints: []
    })
    const out = await aggregateRanks({ db, seasonId, type })
    // A=100/5/1, B=100/4/0 -> B has more "losses=0" but fewer wins. wins DESC ranks A first.
    expect(out[0].memberId).toBe('A')
    expect(out[1].memberId).toBe('B')
  })
})
