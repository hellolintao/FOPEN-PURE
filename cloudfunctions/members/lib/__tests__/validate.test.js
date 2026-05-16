const { validateMemberData, VALID_PLAY_STYLES } = require('../validate');

describe('validateMemberData', () => {
  test('正常数据通过', () => {
    const result = validateMemberData({
      name: '张三',
      avatarUrl: 'https://x.com/a.jpg'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('all playStyle enum values pass', () => {
    for (const playStyle of VALID_PLAY_STYLES) {
      const result = validateMemberData({ playStyle });
      expect(result.valid).toBe(true);
    }
  });

  test('playStyle 取值必须在枚举内', () => {
    const result = validateMemberData({
      name: '张三',
      playStyle: 'invalid-style'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('playStyle 必须是 baseliner/serve-volleyer/all-court/counter-puncher/aggressive-baseliner 之一');
  });

  test('playStyle 空值合法', () => {
    const result = validateMemberData({ name: '张三' });
    expect(result.valid).toBe(true);
  });

  test('playStyleNote 50 字符通过', () => {
    const result = validateMemberData({
      name: '张三',
      playStyleNote: 'x'.repeat(50)
    });
    expect(result.valid).toBe(true);
  });

  test('playStyleNote 超过 50 字符不通过', () => {
    const result = validateMemberData({
      name: '张三',
      playStyleNote: 'x'.repeat(51)
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/50/);
  });

  test('playStyleNote null 合法', () => {
    const result = validateMemberData({ playStyleNote: null });
    expect(result.valid).toBe(true);
  });
});
