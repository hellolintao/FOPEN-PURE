const {
  PLAY_STYLE_OPTIONS,
  PLAY_STYLE_VALUES,
  getPlayStyleLabel
} = require('../play-style')

test('exports shared play style constants for miniprogram packaging', () => {
  expect(PLAY_STYLE_VALUES).toEqual([
    'ice-cow',
    'vers',
    'iron-lady',
    'moon-queen',
    'grinder',
    'slicer'
  ])
  expect(PLAY_STYLE_OPTIONS.map((option) => option.value)).toEqual(PLAY_STYLE_VALUES)
  expect(getPlayStyleLabel('moon-queen')).toBe('月亮女王')
  expect(getPlayStyleLabel('unknown')).toBe('')
})
