const { getPreviousNaturalWeek, getWeekId } = require('../week-window')

describe('week-window', () => {
  test('周一 00:30 计算上一自然周', () => {
    const now = new Date('2026-05-18T00:30:00+08:00')
    const week = getPreviousNaturalWeek(now)
    expect(week.weekStart).toBe('2026-05-11')
    expect(week.weekEnd).toBe('2026-05-17')
    expect(week.start.getHours()).toBe(0)
    expect(week.end.getHours()).toBe(23)
    expect(week.end.getMinutes()).toBe(59)
  })

  test('weekId 使用周一日期，避免跨年周序争议', () => {
    expect(getWeekId(new Date('2026-05-11T00:00:00+08:00'))).toBe('ws_2026-05-11')
  })
})
