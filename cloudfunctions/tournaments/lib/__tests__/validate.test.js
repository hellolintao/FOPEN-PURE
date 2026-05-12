const { validateCourtTimeGrid } = require('../validate');

describe('validateCourtTimeGrid', () => {
  test('合法 grid', () => {
    const r = validateCourtTimeGrid({
      matchDuration: 20,
      courts: [{ courtId: 'c1', name: '1号' }],
      slots: [{
        slotId: 's1',
        start: '2026-05-25T08:00:00+08:00',
        end:   '2026-05-25T08:20:00+08:00',
        availableCourtIds: ['c1']
      }]
    });
    expect(r.valid).toBe(true);
  });

  test('matchDuration 必须是 20', () => {
    const r = validateCourtTimeGrid({ matchDuration: 30, courts: [], slots: [] });
    expect(r.errors).toContain('matchDuration 必须是 20 分钟');
  });

  test('slot 引用了不存在的 courtId', () => {
    const r = validateCourtTimeGrid({
      matchDuration: 20,
      courts: [{ courtId: 'c1', name: '1号' }],
      slots: [{
        slotId: 's1', start: 'a', end: 'b',
        availableCourtIds: ['c-ghost']
      }]
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('availableCourtIds 引用了未知 court'))).toBe(true);
  });

  test('空 grid 合法（创建时允许后填）', () => {
    const r = validateCourtTimeGrid(null);
    expect(r.valid).toBe(true);
  });
});
