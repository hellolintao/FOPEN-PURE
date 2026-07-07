const { analyticsPlayerId, pairKey, pairAnalyticsId } = require('../ids')

test('analyticsPlayerId is stable by season and member', () => {
  expect(analyticsPlayerId('season_2026', 'member_a')).toBe('pa_season_2026_member_a')
})

test('pairKey sorts ids and rejects non-pairs', () => {
  expect(pairKey(['b', 'a'])).toEqual({ pairId: 'a__b', memberIds: ['a', 'b'] })
  expect(() => pairKey(['a'])).toThrow('PAIR_REQUIRES_TWO_MEMBERS')
  expect(() => pairKey(['a', 'a'])).toThrow('PAIR_REQUIRES_TWO_DISTINCT_MEMBERS')
})

test('pairAnalyticsId uses normalized pair id', () => {
  expect(pairAnalyticsId('season_2026', ['b', 'a'])).toBe('pair_season_2026_a__b')
})
