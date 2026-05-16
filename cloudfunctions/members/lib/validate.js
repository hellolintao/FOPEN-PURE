const VALID_PLAY_STYLES = [
  'baseliner',
  'serve-volleyer',
  'all-court',
  'counter-puncher',
  'aggressive-baseliner'
];
const MAX_NOTE_LENGTH = 50;

function validateMemberData(data) {
  const errors = [];

  if (data.playStyle != null && data.playStyle !== '' && !VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`);
  }

  if (data.playStyleNote != null && typeof data.playStyleNote === 'string' && data.playStyleNote.length > MAX_NOTE_LENGTH) {
    errors.push(`备注最多 ${MAX_NOTE_LENGTH} 字`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateMemberData, VALID_PLAY_STYLES, MAX_NOTE_LENGTH };
