const PLAY_STYLE_OPTIONS = [
  { value: 'baseliner', label: '底线型' },
  { value: 'serve-volleyer', label: '发球上网' },
  { value: 'all-court', label: '全场型' },
  { value: 'counter-puncher', label: '反击型' },
  { value: 'aggressive-baseliner', label: '进攻底线型' }
]

const PLAY_STYLE_VALUES = PLAY_STYLE_OPTIONS.map((option) => option.value)

const PLAY_STYLE_LABEL = PLAY_STYLE_OPTIONS.reduce((labels, option) => {
  labels[option.value] = option.label
  return labels
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
