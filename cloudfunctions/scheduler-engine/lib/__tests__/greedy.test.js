const { schedule } = require('../greedy');

const grid = {
  matchDuration: 20,
  courts: [
    { courtId: 'c1', name: '1号' },
    { courtId: 'c2', name: '2号' }
  ],
  slots: [
    { slotId: 's_0800', start: '2026-05-25T08:00:00+08:00', end: '2026-05-25T08:20:00+08:00', availableCourtIds: ['c1', 'c2'] },
    { slotId: 's_0820', start: '2026-05-25T08:20:00+08:00', end: '2026-05-25T08:40:00+08:00', availableCourtIds: ['c1', 'c2'] }
  ]
};

function singlesMatch(matchId, round, p1, p2) {
  return {
    matchId,
    round,
    type: 'singles',
    player1: { id: p1, name: p1 },
    player2: { id: p2, name: p2 }
  };
}

function doublesMatch(matchId, round, p1, partner1, p2, partner2) {
  return {
    matchId,
    round,
    type: 'doubles',
    player1: { id: p1, name: p1, partnerId: partner1, partnerName: partner1 },
    player2: { id: p2, name: p2, partnerId: partner2, partnerName: partner2 }
  };
}

describe('schedule', () => {
  test('2 场 / 4 格 → 全部安排', () => {
    const matches = [singlesMatch('m1', 1, 'p1', 'p2'), singlesMatch('m2', 1, 'p3', 'p4')];
    const r = schedule(matches, grid);
    expect(r.unscheduled).toEqual([]);
    expect(r.scheduled).toHaveLength(2);
    r.scheduled.forEach((m) => {
      expect(m.slotId).toBeDefined();
      expect(m.courtId).toBeDefined();
      expect(m.scheduledStart).toBeDefined();
      expect(m.scheduledSlotId).toBe(m.slotId);
      expect(m.player1.id).toBeDefined();
      expect(m.player2.id).toBeDefined();
    });
  });

  test('5 场 / 4 格 → 1 场未排程', () => {
    const matches = [
      singlesMatch('m1', 1, 'p1', 'p2'),
      singlesMatch('m2', 1, 'p3', 'p4'),
      singlesMatch('m3', 2, 'p5', 'p6'),
      singlesMatch('m4', 2, 'p7', 'p8'),
      singlesMatch('m5', 3, 'p9', 'p10')
    ];
    const r = schedule(matches, grid);
    expect(r.unscheduled).toHaveLength(1);
    expect(r.scheduled).toHaveLength(4);
  });

  test('同人冲突：p1 两场不会在同一 slot（3 slot 留休息）', () => {
    const gridWith3Slots = {
      ...grid,
      slots: [
        ...grid.slots,
        { slotId: 's_0840', start: '2026-05-25T08:40:00+08:00', end: '2026-05-25T09:00:00+08:00', availableCourtIds: ['c1', 'c2'] }
      ]
    };
    const matches = [
      singlesMatch('m1', 1, 'p1', 'p2'),
      singlesMatch('m2', 2, 'p1', 'p3')
    ];
    const r = schedule(matches, gridWith3Slots);
    expect(r.scheduled).toHaveLength(2);
    expect(r.scheduled[0].slotId).not.toBe(r.scheduled[1].slotId);
  });

  test('休息约束：只有 2 个紧挨 slot 时 p1 两场排不下', () => {
    const matches = [
      singlesMatch('m1', 1, 'p1', 'p2'),
      singlesMatch('m2', 2, 'p1', 'p3')
    ];
    const onlyTwoSlots = { ...grid, slots: grid.slots.slice(0, 2) };
    const r = schedule(matches, onlyTwoSlots);
    expect(r.unscheduled).toContainEqual(expect.objectContaining({ matchId: 'm2' }));
  });

  test('空 matches → 空结果', () => {
    expect(schedule([], grid)).toEqual({ scheduled: [], unscheduled: [] });
  });

  test('无 grid → 全部 unscheduled', () => {
    const matches = [singlesMatch('m1', 1, 'p1', 'p2')];
    const r = schedule(matches, null);
    expect(r.scheduled).toEqual([]);
    expect(r.unscheduled).toEqual(matches);
  });

  test('双打：partner 冲突也避免（共享 ap，且有休息间隔）', () => {
    const gridWith3Slots = {
      ...grid,
      slots: [
        ...grid.slots,
        { slotId: 's_0840', start: '2026-05-25T08:40:00+08:00', end: '2026-05-25T09:00:00+08:00', availableCourtIds: ['c1', 'c2'] }
      ]
    };
    const matches = [
      doublesMatch('m1', 1, 'p1', 'ap', 'p2', 'p3'),
      doublesMatch('m2', 1, 'ap', 'p4', 'p5', 'p6')
    ];
    const r = schedule(matches, gridWith3Slots);
    expect(r.scheduled).toHaveLength(2);
    expect(r.scheduled[0].slotId).not.toBe(r.scheduled[1].slotId);
  });

  test('占位 TBD/BYE 不会触发冲突', () => {
    const matches = [
      { matchId: 'm1', round: 1, type: 'singles', player1: { id: 'TBD', name: '待定' }, player2: { id: 'TBD', name: '待定' } },
      { matchId: 'm2', round: 1, type: 'singles', player1: { id: 'TBD', name: '待定' }, player2: { id: 'TBD', name: '待定' } }
    ];
    const r = schedule(matches, grid);
    expect(r.scheduled).toHaveLength(2);
    // 占位的两场可以同 slot 不同 court
  });

  test('每场记录 round/position/type 原样保留', () => {
    const m = singlesMatch('m1', 3, 'p1', 'p2');
    m.position = 7;
    const r = schedule([m], grid);
    expect(r.scheduled[0].round).toBe(3);
    expect(r.scheduled[0].position).toBe(7);
    expect(r.scheduled[0].type).toBe('singles');
  });

  test('同 slot 同 court 不重复占用', () => {
    const matches = [
      singlesMatch('m1', 1, 'p1', 'p2'),
      singlesMatch('m2', 1, 'p3', 'p4'),
      singlesMatch('m3', 1, 'p5', 'p6'),
      singlesMatch('m4', 1, 'p7', 'p8')
    ];
    const r = schedule(matches, grid);
    // 2 slots * 2 courts = 4 个格子，刚好放下
    expect(r.unscheduled).toEqual([]);
    const cells = r.scheduled.map((m) => `${m.slotId}|${m.courtId}`);
    expect(new Set(cells).size).toBe(4);
  });

  test('status 默认 pending', () => {
    const r = schedule([singlesMatch('m1', 1, 'p1', 'p2')], grid);
    expect(r.scheduled[0].status).toBe('pending');
  });
});
