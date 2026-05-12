const {
  collectMatchPlayerIds,
  isPlayerFree,
  isMatchFreeOfConflicts,
  hasRestBetween,
  matchHasRestBetween
} = require('../constraints');

function singlesMatch(matchId, p1, p2) {
  return {
    matchId,
    type: 'singles',
    player1: { id: p1, name: p1 },
    player2: { id: p2, name: p2 }
  };
}

function doublesMatch(matchId, p1, partner1, p2, partner2) {
  return {
    matchId,
    type: 'doubles',
    player1: { id: p1, name: p1, partnerId: partner1, partnerName: partner1 },
    player2: { id: p2, name: p2, partnerId: partner2, partnerName: partner2 }
  };
}

describe('collectMatchPlayerIds', () => {
  test('singles → 2 ids', () => {
    expect(collectMatchPlayerIds(singlesMatch('m', 'a', 'b'))).toEqual(['a', 'b']);
  });

  test('doubles → 4 ids', () => {
    const ids = collectMatchPlayerIds(doublesMatch('m', 'a', 'ap', 'b', 'bp'));
    expect(ids.sort()).toEqual(['a', 'ap', 'b', 'bp']);
  });

  test('TBD / BYE 占位 → 过滤掉', () => {
    const m = singlesMatch('m', 'TBD', 'BYE');
    expect(collectMatchPlayerIds(m)).toEqual([]);
  });
});

describe('isPlayerFree', () => {
  test('当前 slot 无其他比赛 → free', () => {
    expect(isPlayerFree('a', 's_0800', [])).toBe(true);
  });

  test('当前 slot 已有该 player 的比赛 → not free', () => {
    const assigned = [{ ...singlesMatch('m1', 'a', 'b'), slotId: 's_0800' }];
    expect(isPlayerFree('a', 's_0800', assigned)).toBe(false);
  });

  test('另一个 slot 有比赛 → 当前 slot 仍 free', () => {
    const assigned = [{ ...singlesMatch('m1', 'a', 'b'), slotId: 's_0830' }];
    expect(isPlayerFree('a', 's_0800', assigned)).toBe(true);
  });

  test('双打：partner 在同 slot 已有比赛 → 该 partner not free', () => {
    const assigned = [{ ...doublesMatch('m1', 'a', 'ap', 'b', 'bp'), slotId: 's_0800' }];
    expect(isPlayerFree('ap', 's_0800', assigned)).toBe(false);
    expect(isPlayerFree('b', 's_0800', assigned)).toBe(false);
    expect(isPlayerFree('c', 's_0800', assigned)).toBe(true);
  });
});

describe('isMatchFreeOfConflicts', () => {
  test('双打整场冲突检查：4 人有一个被占用 → 整场不能放', () => {
    const assigned = [{ ...singlesMatch('m1', 'a', 'x'), slotId: 's_0800' }];
    const newMatch = doublesMatch('m2', 'b', 'a', 'c', 'd'); // a 是 m2 的 partner
    expect(isMatchFreeOfConflicts(newMatch, 's_0800', assigned)).toBe(false);
  });

  test('4 人全清 → ok', () => {
    const assigned = [{ ...singlesMatch('m1', 'x', 'y'), slotId: 's_0800' }];
    const newMatch = doublesMatch('m2', 'a', 'b', 'c', 'd');
    expect(isMatchFreeOfConflicts(newMatch, 's_0800', assigned)).toBe(true);
  });
});

describe('hasRestBetween / matchHasRestBetween', () => {
  const allSlots = [
    { slotId: 's_0800', start: '2026-05-25T08:00:00+08:00' },
    { slotId: 's_0820', start: '2026-05-25T08:20:00+08:00' },
    { slotId: 's_0840', start: '2026-05-25T08:40:00+08:00' },
    { slotId: 's_0900', start: '2026-05-25T09:00:00+08:00' }
  ];

  test('player 上一场 0800、下一场 0840（中间隔 1 档） → rest 满足', () => {
    const assigned = [{ ...singlesMatch('m1', 'a', 'b'), slotId: 's_0800' }];
    expect(hasRestBetween('a', 's_0840', assigned, allSlots)).toBe(true);
  });

  test('player 上一场 0800、下一场 0820（紧挨） → rest 不满足', () => {
    const assigned = [{ ...singlesMatch('m1', 'a', 'b'), slotId: 's_0800' }];
    expect(hasRestBetween('a', 's_0820', assigned, allSlots)).toBe(false);
  });

  test('没有上一场 → rest 满足', () => {
    expect(hasRestBetween('a', 's_0800', [], allSlots)).toBe(true);
  });

  test('双打：matchHasRestBetween 把 4 个 playerId 全部检查（partner 紧挨上一场→不满足）', () => {
    const assigned = [{ ...singlesMatch('m1', 'x', 'ap'), slotId: 's_0800' }];
    const newMatch = doublesMatch('m2', 'a', 'ap', 'b', 'bp');
    expect(matchHasRestBetween(newMatch, 's_0820', assigned, allSlots)).toBe(false);
  });

  test('双打：4 人均无紧邻冲突 → ok', () => {
    const assigned = [{ ...singlesMatch('m1', 'x', 'y'), slotId: 's_0800' }];
    const newMatch = doublesMatch('m2', 'a', 'ap', 'b', 'bp');
    expect(matchHasRestBetween(newMatch, 's_0820', assigned, allSlots)).toBe(true);
  });
});
