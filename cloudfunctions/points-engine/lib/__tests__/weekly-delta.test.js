const { aggregateWeeklyPlayerDelta } = require('../weekly-delta')

function makeFakeDb(rows) {
  const _ = {
    and(cs) { return { __op: 'and', clauses: cs } },
    or(cs) { return { __op: 'or', clauses: cs } },
    in(v) { return { __op: 'in', value: v } },
    gte(v) { return { __op: 'gte', value: v } },
    lte(v) { return { __op: 'lte', value: v } },
    eq(v) { return { __op: 'eq', value: v } }
  }
  function match(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => match(row, c))
    if (f.__op === 'or') return f.clauses.some(c => match(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'gte') {
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
  return {
    command: _,
    collection() {
      return {
        where(f) { return { get: async () => ({ data: rows.filter(r => match(r, f)) }) } }
      }
    }
  }
}

describe('aggregateWeeklyPlayerDelta', () => {
  const week = { weekStart: '2026-05-04', weekEnd: '2026-05-10' }
  const seasonId = 's2026'

  test('3 wins 1 loss this week returns wins=3 losses=1 and summed pointsDelta', async () => {
    const db = makeFakeDb([
      { _id: 'm1', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-05', createTime: '2026-05-05',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm2', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-06', createTime: '2026-05-06',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm3', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-07', createTime: '2026-05-07',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm4', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-08', createTime: '2026-05-08',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 70, wins: 3, losses: 1 })
  })

  test('no matches this week returns zeros', async () => {
    const db = makeFakeDb([])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 0, wins: 0, losses: 0 })
  })

  test('type filter excludes doubles from singles query', async () => {
    const db = makeFakeDb([
      { _id: 'm1', seasonId, tournamentType: 'doubles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-05', createTime: '2026-05-05',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 0, wins: 0, losses: 0 })
  })

  test('boundary includes weekStart and excludes weekEnd plus one day', async () => {
    const db = makeFakeDb([
      { _id: 'm_in', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-04', createTime: '2026-05-04',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm_out', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-11', createTime: '2026-05-11',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 20, wins: 1, losses: 0 })
  })

  test('production Date confirmedAt rows count with Date week bounds', async () => {
    const weekWithDates = {
      start: new Date('2026-05-04T00:00:00.000Z'),
      end: new Date('2026-05-10T23:59:59.999Z'),
      weekStart: '2026-05-04',
      weekEnd: '2026-05-10'
    }
    const db = makeFakeDb([
      { _id: 'm_date', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: new Date('2026-05-10T12:30:00.000Z'), createTime: new Date('2026-05-10T12:30:00.000Z'),
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm_late', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: new Date('2026-05-11T00:00:00.000Z'), createTime: new Date('2026-05-11T00:00:00.000Z'),
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week: weekWithDates })
    expect(out).toEqual({ pointsDelta: 20, wins: 1, losses: 0 })
  })

  test('string timestamp on weekEnd later in the day is included', async () => {
    const db = makeFakeDb([
      { _id: 'm_end_day', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-10T21:15:00.000Z', createTime: '2026-05-10T21:15:00.000Z',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] } },
      { _id: 'm_next_day', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-11T00:00:00.000Z', createTime: '2026-05-11T00:00:00.000Z',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 10, wins: 0, losses: 1 })
  })
})
