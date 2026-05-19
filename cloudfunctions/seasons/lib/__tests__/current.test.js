const { selectCurrentSeason } = require('../current')

describe('selectCurrentSeason', () => {
  test('returns null for empty input', () => {
    expect(selectCurrentSeason([], '2026-05-19')).toBeNull()
    expect(selectCurrentSeason(null, '2026-05-19')).toBeNull()
  })

  test('prefers a season that contains the target date over active fallback', () => {
    const result = selectCurrentSeason([
      { _id: 'season_future', name: 'Future', status: 'active', startDate: '2027-01-01', endDate: '2027-12-31' },
      { _id: 'season_match', name: 'Match', status: 'ended', startDate: '2026-01-01', endDate: '2026-12-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_match')
  })

  test('prefers active status when multiple seasons contain the target date', () => {
    const result = selectCurrentSeason([
      { _id: 'season_ended', name: 'Ended', status: 'ended', startDate: '2026-03-01', endDate: '2026-12-31' },
      { _id: 'season_active', name: 'Active', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_active')
  })

  test('uses latest start date when multiple covering seasons have same status', () => {
    const result = selectCurrentSeason([
      { _id: 'season_old', name: 'Old', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31' },
      { _id: 'season_new', name: 'New', status: 'active', startDate: '2026-04-01', endDate: '2026-12-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_new')
  })

  test('falls back to latest active season when no date range matches', () => {
    const result = selectCurrentSeason([
      { _id: 'season_old', name: 'Old', status: 'active', startDate: '2024-01-01', endDate: '2024-12-31' },
      { _id: 'season_new', name: 'New', status: 'active', startDate: '2025-01-01', endDate: '2025-12-31' },
      { _id: 'season_inactive', name: 'Inactive', status: 'ended', startDate: '2026-01-01', endDate: '2026-01-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_new')
  })

  test('falls back to latest start date when no active season exists', () => {
    const result = selectCurrentSeason([
      { _id: 'season_old', name: 'Old', status: 'ended', startDate: '2024-01-01', endDate: '2024-12-31' },
      { _id: 'season_new', name: 'New', status: 'ended', startDate: '2025-01-01', endDate: '2025-12-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_new')
  })
})
