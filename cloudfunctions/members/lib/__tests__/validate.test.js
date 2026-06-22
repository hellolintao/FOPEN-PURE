const {
  validateMemberData,
  validateMemberAdd,
  sanitizeMemberPayload,
  VALID_PLAY_STYLES
} = require('../validate');

describe('validateMemberData', () => {
  test('normal data passes', () => {
    const result = validateMemberData({
      name: '张三',
      avatarUrl: 'https://x.com/a.jpg',
      playStyle: 'ice-cow'
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('all current playStyle enum values pass', () => {
    expect(VALID_PLAY_STYLES).toEqual([
      'ice-cow',
      'vers',
      'iron-lady',
      'moon-queen',
      'grinder',
      'slicer'
    ]);

    for (const playStyle of VALID_PLAY_STYLES) {
      const result = validateMemberData({ playStyle });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    }
  });

  test('old baseliner slug is rejected', () => {
    const result = validateMemberData({ playStyle: 'baseliner' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('playStyle 必须是 ice-cow/vers/iron-lady/moon-queen/grinder/slicer 之一');
  });

  test('empty, null, and missing playStyle are valid for common validation', () => {
    expect(validateMemberData({ playStyle: '' }).valid).toBe(true);
    expect(validateMemberData({ playStyle: null }).valid).toBe(true);
    expect(validateMemberData({}).valid).toBe(true);
  });

  test('long playStyleNote no longer triggers an error', () => {
    const result = validateMemberData({
      playStyleNote: 'x'.repeat(200)
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('null and non-object payloads are valid for common validation', () => {
    expect(validateMemberData(null)).toEqual({ valid: true, errors: [] });
    expect(validateMemberData('invalid')).toEqual({ valid: true, errors: [] });
    expect(validateMemberData(123)).toEqual({ valid: true, errors: [] });
  });
});

describe('validateMemberAdd', () => {
  test('name and new playStyle pass', () => {
    const result = validateMemberAdd({
      name: '张三',
      playStyle: 'ice-cow'
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('missing name fails', () => {
    const result = validateMemberAdd({ playStyle: 'ice-cow' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name 不能为空');
  });

  test('missing playStyle fails', () => {
    const result = validateMemberAdd({ name: '张三' });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('playStyle 不能为空');
  });

  test('blank name fails', () => {
    const result = validateMemberAdd({
      name: '   ',
      playStyle: 'ice-cow'
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('name 不能为空');
  });

  test('old baseliner slug fails', () => {
    const result = validateMemberAdd({
      name: '张三',
      playStyle: 'baseliner'
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('playStyle 必须是 ice-cow/vers/iron-lady/moon-queen/grinder/slicer 之一');
  });

  test('null and non-object payloads fail with missing required field errors', () => {
    for (const payload of [null, 'invalid', 123]) {
      const result = validateMemberAdd(payload);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('name 不能为空');
      expect(result.errors).toContain('playStyle 不能为空');
    }
  });
});

describe('sanitizeMemberPayload', () => {
  test('retains only allowed member fields', () => {
    const result = sanitizeMemberPayload({
      name: '张三',
      phone: '13800000000',
      avatarUrl: 'https://x.com/a.jpg',
      status: 'active',
      admin: true,
      playStyle: 'ice-cow',
      playStyleNote: 'removed',
      createTime: 1,
      updateTime: 2,
      openid: 'openid',
      arbitrary: 'field'
    });

    expect(result).toEqual({
      name: '张三',
      avatarUrl: 'https://x.com/a.jpg',
      status: 'active',
      admin: true,
      playStyle: 'ice-cow'
    });
    expect(result).not.toHaveProperty('phone');
  });

  test('missing fields are omitted', () => {
    const result = sanitizeMemberPayload({
      name: '张三',
      playStyle: 'ice-cow',
      openid: 'openid'
    });

    expect(result).toEqual({
      name: '张三',
      playStyle: 'ice-cow'
    });
  });

  test('null and non-object payloads return an empty payload', () => {
    expect(sanitizeMemberPayload(null)).toEqual({});
    expect(sanitizeMemberPayload('invalid')).toEqual({});
    expect(sanitizeMemberPayload(123)).toEqual({});
  });
});
