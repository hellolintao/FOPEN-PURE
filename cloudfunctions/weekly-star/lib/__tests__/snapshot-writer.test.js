const { buildSnapshotRows } = require('../snapshot-writer')

describe('buildSnapshotRows', () => {
  test('produces one row per ranked entry with proper _id, effectiveAt, snapshotKind', () => {
    const ranked = [
      { memberId: 'A', totalPoints: 340, wins: 17, losses: 4 },
      { memberId: 'B', totalPoints: 285, wins: 12, losses: 5 }
    ]
    const week = {
      weekId: 'ws_2026-05-04',
      weekStart: '2026-05-04',
      weekEnd: '2026-05-10',
      end: new Date('2026-05-10T23:59:59')
    }
    const rows = buildSnapshotRows({
      ranked,
      week,
      seasonId: 's2026',
      type: 'singles',
      snapshotKind: 'weekly',
      computedAt: new Date('2026-05-11T00:30:00')
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      _id: 'rs_s2026_ws_2026-05-04_singles_A',
      seasonId: 's2026',
      weekId: 'ws_2026-05-04',
      weekStart: '2026-05-04',
      weekEnd: '2026-05-10',
      type: 'singles',
      memberId: 'A',
      rank: 1,
      totalPoints: 340,
      wins: 17,
      losses: 4,
      snapshotKind: 'weekly'
    })
    expect(rows[0].effectiveAt).toEqual(new Date('2026-05-10T23:59:59'))
    expect(rows[1].rank).toBe(2)
  })

  test('baseline kind uses caller-supplied effectiveAt now', () => {
    const ranked = [{ memberId: 'A', totalPoints: 100, wins: 5, losses: 1 }]
    const now = new Date('2026-05-16T10:00:00')
    const rows = buildSnapshotRows({
      ranked,
      week: { weekId: 'baseline_2026-05-16', weekStart: '2026-05-16', weekEnd: '2026-05-16', end: now },
      seasonId: 's2026',
      type: 'doubles',
      snapshotKind: 'baseline',
      computedAt: now
    })
    expect(rows[0].effectiveAt).toEqual(now)
    expect(rows[0].snapshotKind).toBe('baseline')
    expect(rows[0]._id).toBe('rs_s2026_baseline_2026-05-16_doubles_A')
  })
})
