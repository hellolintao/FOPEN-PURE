const { calculatePoints, isPointValid } = require('../calculate');

const now = new Date('2026-05-25T10:00:00Z');

const tournament = {
  _id: 't1',
  seasonId: 's2026',
  type: 'singles',
  format: 'regular',
  pointsRules: { win: 100, loss: 20, walkover: 50, bonusByRound: { 1:0, 2:50, 3:100 } }
};

const match = {
  tournamentId: 't1',
  round: 1,
  winnerId: 'p1',
  loserId: 'p2',
  resultStatus: 'confirmed',
  createTime: new Date('2026-05-25T09:00:00Z')
};

describe('calculatePoints', () => {
  test('常规赛胜方 +win', () => {
    const r = calculatePoints(match, tournament);
    expect(r.winner.total).toBe(100);
    expect(r.loser.total).toBe(20);
  });

  test('淘汰赛胜 + bonusByRound', () => {
    const knockout = { ...tournament, format: 'knockout' };
    const round2Match = { ...match, round: 2 };
    const r = calculatePoints(round2Match, knockout);
    expect(r.winner.total).toBe(100 + 50);  // win + bonus[2]
  });

  test('walkover 用 walkover 分数', () => {
    const wo = { ...match, walkover: true };
    const r = calculatePoints(wo, tournament);
    expect(r.winner.total).toBe(50);
  });
});

describe('isPointValid', () => {
  test('当前赛季常规赛积分有效', () => {
    expect(isPointValid({ seasonId: 's2026', format: 'regular', createTime: now }, 's2026', now)).toBe(true);
  });

  test('上赛季常规赛积分失效', () => {
    expect(isPointValid({ seasonId: 's2025', format: 'regular', createTime: now }, 's2026', now)).toBe(false);
  });

  test('淘汰赛 365 天内有效', () => {
    const halfYearAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    expect(isPointValid({ seasonId: 'any', format: 'knockout', createTime: halfYearAgo }, 's2026', now)).toBe(true);
  });

  test('淘汰赛 365 天前失效', () => {
    const twoYearsAgo = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
    expect(isPointValid({ seasonId: 'any', format: 'knockout', createTime: twoYearsAgo }, 's2026', now)).toBe(false);
  });
});
