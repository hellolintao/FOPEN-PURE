const { validateResultSubmission } = require('../validate');

describe('validateResultSubmission', () => {
  test('合法提交', () => {
    const r = validateResultSubmission({
      submittedBy: 'm1',
      role: 'player',
      winnerIds: 'm1',
      score: '6-3, 6-4'
    });
    expect(r.valid).toBe(true);
  });

  test('role 必须是 admin/player', () => {
    const r = validateResultSubmission({ submittedBy: 'm1', role: 'visitor', winnerIds: 'm1' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('role 必须是 admin 或 player');
  });

  test('score 超过 50 字符不通过', () => {
    const r = validateResultSubmission({
      submittedBy: 'm1', role: 'player', winnerIds: 'm1',
      score: 'x'.repeat(51)
    });
    expect(r.errors).toContain('score 不能超过 50 字符');
  });

  test('winnerIds 缺失不通过', () => {
    const r = validateResultSubmission({ submittedBy: 'm1', role: 'player' });
    expect(r.errors).toContain('winnerIds 不能为空');
  });
});
