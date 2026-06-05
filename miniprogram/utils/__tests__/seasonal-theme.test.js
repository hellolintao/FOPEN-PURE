describe('seasonal theme', () => {
  test('enables the Pride skin only during June 2026', () => {
    const { isPrideMonthSkinActive } = require('../seasonal-theme')

    expect(isPrideMonthSkinActive(new Date(2026, 5, 1, 0, 0, 0))).toBe(true)
    expect(isPrideMonthSkinActive(new Date(2026, 5, 30, 23, 59, 59))).toBe(true)
    expect(isPrideMonthSkinActive(new Date(2026, 6, 1, 0, 0, 0))).toBe(false)
    expect(isPrideMonthSkinActive(new Date(2027, 5, 1, 0, 0, 0))).toBe(false)
    expect(isPrideMonthSkinActive('not-a-date')).toBe(false)
  })
})
