const VALID_PLAY_STYLES = [
  'ice-cow',
  'vers',
  'iron-lady',
  'moon-queen',
  'grinder',
  'slicer'
];

const ALLOWED_MEMBER_FIELDS = [
  'name',
  'phone',
  'avatarUrl',
  'status',
  'admin',
  'playStyle'
];

function validateMemberData(data = {}) {
  const errors = [];

  if (data.playStyle != null && data.playStyle !== '' && !VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`);
  }

  return { valid: errors.length === 0, errors };
}

function validateMemberAdd(data = {}) {
  const errors = [];

  if (typeof data.name !== 'string' || data.name.trim() === '') {
    errors.push('name 不能为空');
  }

  if (data.playStyle == null || data.playStyle === '') {
    errors.push('playStyle 不能为空');
  } else if (!VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`);
  }

  return { valid: errors.length === 0, errors };
}

function sanitizeMemberPayload(data = {}) {
  const payload = {};

  for (const field of ALLOWED_MEMBER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      payload[field] = data[field];
    }
  }

  return payload;
}

module.exports = {
  validateMemberData,
  validateMemberAdd,
  sanitizeMemberPayload,
  VALID_PLAY_STYLES,
  ALLOWED_MEMBER_FIELDS
};
