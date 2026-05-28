const {
  validateCourtTimeGrid,
  validateSchedulePlan,
  validatePointsRules,
  validateTournament
} = require('../validate');

// Keep old tests (migrated from courtTimeGrid)
describe('validateCourtTimeGrid (legacy, preserved)', () => {
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

// Additional coverage for validateCourtTimeGrid edge cases
describe('validateCourtTimeGrid (extra coverage)', () => {
  test('非数组 courts → 返回错误并提前返回', () => {
    const r = validateCourtTimeGrid({ matchDuration: 20, courts: null, slots: [] });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('courts 必须是数组');
  });

  test('非数组 slots → 返回错误并提前返回', () => {
    const r = validateCourtTimeGrid({ matchDuration: 20, courts: [], slots: null });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('slots 必须是数组');
  });

  test('slot.availableCourtIds 非数组', () => {
    const r = validateCourtTimeGrid({
      matchDuration: 20,
      courts: [{ courtId: 'c1', name: '1号' }],
      slots: [{ slotId: 's1', start: 'a', end: 'b', availableCourtIds: null }]
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('必须是数组'))).toBe(true);
  });
});

// New tests for validateSchedulePlan
describe('validateSchedulePlan', () => {
  test('合法：20min slotMinutes，1 场地 3 slot → returns []', () => {
    const errors = validateSchedulePlan({
      slotMinutes: 20,
      courts: [
        {
          courtId: 'c1',
          name: '1号场地',
          slots: [
            { slotId: 's1', start: '08:00', end: '08:20' },
            { slotId: 's2', start: '08:20', end: '08:40' },
            { slotId: 's3', start: '08:40', end: '09:00' }
          ]
        }
      ]
    });
    expect(errors).toEqual([]);
  });

  test('非法：slotMinutes ≠ 20 → returns array containing 必须固定为 20', () => {
    const errors = validateSchedulePlan({
      slotMinutes: 30,
      courts: [
        {
          courtId: 'c1',
          name: '1号场地',
          slots: [{ slotId: 's1', start: '08:00', end: '08:30' }]
        }
      ]
    });
    expect(errors).toContain('schedulePlan.slotMinutes 必须固定为 20');
  });

  test('非法：courts 为空 → returns array containing courts 不能为空', () => {
    const errors = validateSchedulePlan({
      slotMinutes: 20,
      courts: []
    });
    expect(errors).toContain('schedulePlan.courts 不能为空');
  });

  test('非法：某 court.slots 为空 → some error matches /slots 不能为空/', () => {
    const errors = validateSchedulePlan({
      slotMinutes: 20,
      courts: [
        { courtId: 'c1', name: '1号场地', slots: [] }
      ]
    });
    expect(errors.some(e => /slots 不能为空/.test(e))).toBe(true);
  });

  test('非法：courtId 重复 → returns array containing courtId 重复', () => {
    const errors = validateSchedulePlan({
      slotMinutes: 20,
      courts: [
        { courtId: 'c1', name: '1号场地', slots: [{ slotId: 's1', start: '08:00', end: '08:20' }] },
        { courtId: 'c1', name: '2号场地', slots: [{ slotId: 's2', start: '08:00', end: '08:20' }] }
      ]
    });
    expect(errors).toContain('schedulePlan.courts.courtId 重复');
  });

  test('非法：schedulePlan 为 null → returns array containing 必填', () => {
    const errors = validateSchedulePlan(null);
    expect(errors).toContain('schedulePlan 必填');
  });
});

// New tests for validatePointsRules
describe('validatePointsRules', () => {
  test('合法：winLoss + placement 双子树都在 → returns []', () => {
    const errors = validatePointsRules({
      winLoss: { win: 100, loss: 20, walkover: 50 },
      placement: {
        champion: 500,
        runnerUp: 300,
        semifinal: 150,
        quarterfinal: 75,
        participation: 10
      }
    });
    expect(errors).toEqual([]);
  });

  test('非法：缺 winLoss → returns array containing winLoss 必填', () => {
    const errors = validatePointsRules({
      placement: {
        champion: 500,
        runnerUp: 300,
        semifinal: 150,
        quarterfinal: 75,
        participation: 10
      }
    });
    expect(errors).toContain('pointsRules.winLoss 必填');
  });

  test('非法：placement 缺字段 → some error matches /placement.semifinal/', () => {
    const errors = validatePointsRules({
      winLoss: { win: 100, loss: 20, walkover: 50 },
      placement: {
        champion: 500,
        runnerUp: 300,
        // missing semifinal, quarterfinal, participation
      }
    });
    expect(errors.some(e => /placement\.semifinal/.test(e))).toBe(true);
  });

  test('非法：pointsRules 为 null → returns array containing 必填', () => {
    const errors = validatePointsRules(null);
    expect(errors).toContain('pointsRules 必填');
  });

  test('非法：winLoss 字段值为非数字 → returns errors for each field', () => {
    const errors = validatePointsRules({
      winLoss: { win: '100', loss: null, walkover: 50 },
      placement: {
        champion: 500,
        runnerUp: 300,
        semifinal: 150,
        quarterfinal: 75,
        participation: 10
      }
    });
    expect(errors.some(e => /winLoss\.win/.test(e))).toBe(true);
    expect(errors.some(e => /winLoss\.loss/.test(e))).toBe(true);
  });

  test('非法：缺 placement → returns array containing placement 必填', () => {
    const errors = validatePointsRules({
      winLoss: { win: 100, loss: 20, walkover: 50 }
    });
    expect(errors).toContain('pointsRules.placement 必填');
  });
});

describe('validateTournament', () => {
  test.each(['none', 'draft', 'published'])('allows scheduleStatus %s', (scheduleStatus) => {
    const errors = validateTournament(validTournament({ scheduleStatus }), { isDraft: false });
    expect(errors).toEqual([]);
  });

  test('rejects invalid scheduleStatus', () => {
    const errors = validateTournament(validTournament({ scheduleStatus: 'ready' }), { isDraft: false });
    expect(errors).toContain('scheduleStatus 必须是 none、draft 或 published');
  });

  test('allows boolean scheduleNeedsRevision', () => {
    const errors = validateTournament(validTournament({ scheduleNeedsRevision: false }), { isDraft: false });
    expect(errors).toEqual([]);
  });

  test('rejects non-boolean scheduleNeedsRevision', () => {
    const errors = validateTournament(validTournament({ scheduleNeedsRevision: 'no' }), { isDraft: false });
    expect(errors).toContain('scheduleNeedsRevision 必须是布尔值');
  });

  test('preserves schedulePlan validation for non-draft published state', () => {
    const errors = validateTournament(validTournament({
      scheduleStatus: 'published',
      schedulePlan: null
    }), { isDraft: false });
    expect(errors).toContain('schedulePlan 必填');
  });

  test('rejects knockout mixed tournament', () => {
    const errors = validateTournament(validTournament({
      type: 'mixed',
      format: 'knockout',
      maxPlayers: 8
    }), { isDraft: false });
    expect(errors).toContain('淘汰赛不支持 mixed 类型');
  });
});

describe('group_knockout validation', () => {
  test('allows singles group knockout with 16 sign bracket', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      maxPlayers: 16,
      schedulePlan: null
    }), { isDraft: false });
    expect(errors).toEqual([]);
  });

  test.each(['doubles', 'mixed'])('rejects group knockout %s', (type) => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type,
      bracketSize: 16,
      maxPlayers: 16
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛只支持 singles 类型');
  });

  test.each(['', null])('rejects explicit falsy group knockout type %p', (type) => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type,
      bracketSize: 16,
      maxPlayers: 16
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛只支持 singles 类型');
  });

  test('requires bracketSize 12 or 16', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 14,
      maxPlayers: 14
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛 bracketSize 必须是 12 或 16');
  });

  test('requires maxPlayers to equal bracketSize when supplied', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 12,
      maxPlayers: 16
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛 maxPlayers 必须等于 bracketSize');
  });

  test('rejects explicit null maxPlayers', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 12,
      maxPlayers: null
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛 maxPlayers 必须等于 bracketSize');
  });

  test('rejects published scheduleStatus', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      maxPlayers: 16,
      scheduleStatus: 'published',
      schedulePlan: null
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛 scheduleStatus 必须是 none');
  });

  test('rejects invalid groupDrawMode', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      maxPlayers: 16,
      groupDrawMode: 'random'
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛 groupDrawMode 必须是 preset 或 onsite');
  });

  test('rejects invalid groupKnockoutPhase', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      maxPlayers: 16,
      groupKnockoutPhase: 'knockout_ready'
    }), { isDraft: false });
    expect(errors).toContain('小组赛+淘汰赛 groupKnockoutPhase 无效');
  });
});

function validTournament(overrides = {}) {
  return {
    name: '5月周末赛',
    type: 'singles',
    format: 'regular',
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    schedulePlan: {
      slotMinutes: 20,
      courts: [
        {
          courtId: 'c1',
          name: '1号场地',
          slots: [{ slotId: 's1', start: '08:00', end: '08:20' }]
        }
      ]
    },
    pointsRules: {
      winLoss: { win: 100, loss: 20, walkover: 50 },
      placement: {
        champion: 500,
        runnerUp: 300,
        semifinal: 150,
        quarterfinal: 75,
        participation: 10
      }
    },
    ...overrides
  };
}
