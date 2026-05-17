const {
  PLAY_STYLE_OPTIONS,
  PLAY_STYLE_VALUES,
  getPlayStyleLabel
} = require('../play-style')

test('exports shared play style constants for miniprogram packaging', () => {
  expect(PLAY_STYLE_VALUES).toEqual([
    'baseliner',
    'serve-volleyer',
    'all-court',
    'counter-puncher',
    'aggressive-baseliner'
  ])
  expect(PLAY_STYLE_OPTIONS.map((option) => option.value)).toEqual(PLAY_STYLE_VALUES)
  expect(getPlayStyleLabel('all-court')).toBe('全场型')
  expect(getPlayStyleLabel('unknown')).toBe('')
})
