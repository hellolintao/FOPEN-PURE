const PLAY_STYLE_OPTIONS = [
  { value: 'ice-cow', label: '冰上母牛' },
  { value: 'vers', label: 'Vers' },
  { value: 'iron-lady', label: '女金刚' },
  { value: 'moon-queen', label: '月亮女王' },
  { value: 'grinder', label: '磨女' },
  { value: 'slicer', label: '削削乐' }
]

const PLAY_STYLE_VALUES = PLAY_STYLE_OPTIONS.map((o) => o.value)

const PLAY_STYLE_LABEL = PLAY_STYLE_OPTIONS.reduce((map, item) => {
  map[item.value] = item.label
  return map
}, {})

function getPlayStyleLabel(value) {
  if (!value) return ''
  return PLAY_STYLE_LABEL[value] || ''
}

module.exports = {
  PLAY_STYLE_OPTIONS,
  PLAY_STYLE_VALUES,
  PLAY_STYLE_LABEL,
  getPlayStyleLabel
}
