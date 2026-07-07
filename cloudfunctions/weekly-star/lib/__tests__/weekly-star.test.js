const { computeWeeklyStarsFromRows } = require('../weekly-star')

const week = {
  start: new Date('2026-05-11T00:00:00+08:00'),
  end: new Date('2026-05-17T23:59:59+08:00'),
  weekStart: '2026-05-11',
  weekEnd: '2026-05-17',
  weekId: 'ws_2026-05-11'
}

describe('computeWeeklyStarsFromRows', () => {
  test('按 pointsAwarded.entries 汇总单/双打每周之星', () => {
    const result = computeWeeklyStarsFromRows({
      week,
      members: [
        { _id: 'm1', name: 'A', avatarUrl: 'a.png', publicProfileConsent: true },
        { _id: 'm2', name: 'B', avatarUrl: 'b.png' },
        { _id: 'm3', name: 'C', avatarUrl: 'c.png', publicProfileConsent: true }
      ],
      matches: [
        {
          _id: 'r1',
          seasonId: 's2026',
          tournamentType: 'singles',
          resultStatus: 'confirmed',
          confirmedAt: new Date('2026-05-12T10:00:00+08:00'),
          pointsAwarded: {
            source: 'match',
            entries: [
              { memberId: 'm1', points: 20, role: 'winner' },
              { memberId: 'm2', points: 10, role: 'loser' }
            ]
          }
        },
        {
          _id: 'r2',
          seasonId: 's2026',
          tournamentType: 'doubles',
          resultStatus: 'confirmed',
          confirmedAt: new Date('2026-05-13T10:00:00+08:00'),
          pointsAwarded: {
            source: 'match',
            entries: [
              { memberId: 'm3', points: 30, role: 'winner' }
            ]
          }
        }
      ],
      placementRows: [
        {
          _id: 'p1',
          seasonId: 's2026',
          tournamentType: 'singles',
          memberId: 'm1',
          points: 100,
          createTime: new Date('2026-05-17T12:00:00+08:00')
        }
      ],
      seasonId: 's2026'
    })

    expect(result._id).toBe('s2026_ws_2026-05-11')
    expect(result.weekId).toBe('ws_2026-05-11')
    expect(result.singlesStar).toEqual({ memberId: 'm1', name: 'A', avatarUrl: '', publicProfileVisible: true, points: 120 })
    expect(result.doublesStar).toEqual({ memberId: 'm3', name: 'C', avatarUrl: '', publicProfileVisible: true, points: 30 })
  })

  test('忽略周外、赛季外、未 confirmed 数据', () => {
    const result = computeWeeklyStarsFromRows({
      week,
      members: [{ _id: 'm1', name: 'A' }],
      matches: [
        { seasonId: 's2025', tournamentType: 'singles', resultStatus: 'confirmed', confirmedAt: week.start, pointsAwarded: { entries: [{ memberId: 'm1', points: 999 }] } },
        { seasonId: 's2026', tournamentType: 'singles', resultStatus: 'submitted', confirmedAt: week.start, pointsAwarded: { entries: [{ memberId: 'm1', points: 999 }] } },
        { seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed', confirmedAt: new Date('2026-05-18T00:00:00+08:00'), pointsAwarded: { entries: [{ memberId: 'm1', points: 999 }] } }
      ],
      placementRows: [],
      seasonId: 's2026'
    })

    expect(result.singlesStar).toBe(null)
    expect(result.doublesStar).toBe(null)
  })

  test('文档 id 包含 seasonId，避免不同赛季同周互相覆盖', () => {
    const a = computeWeeklyStarsFromRows({ week, members: [], matches: [], placementRows: [], seasonId: 's2026' })
    const b = computeWeeklyStarsFromRows({ week, members: [], matches: [], placementRows: [], seasonId: 's2027' })
    expect(a._id).toBe('s2026_ws_2026-05-11')
    expect(b._id).toBe('s2027_ws_2026-05-11')
  })
})
