const {
  SEASON_ID,
  BASELINE_STANDINGS,
  flattenBaselineStandings,
  validateBaselineStandings,
} = require('../lib/baseline-standings-data');

const EXPECTED_BASELINE_STANDINGS = {
  singles: [
    { playerName: '小飞', totalPoints: 2940, wins: 15, losses: 0 },
    { playerName: '抖抖', totalPoints: 2250, wins: 16, losses: 9 },
    { playerName: '栗子', totalPoints: 1810, wins: 10, losses: 8 },
    { playerName: '小野马', totalPoints: 1630, wins: 4, losses: 7 },
    { playerName: '标子', totalPoints: 1560, wins: 7, losses: 1 },
    { playerName: '乐乐', totalPoints: 1450, wins: 6, losses: 10 },
    { playerName: '老板', totalPoints: 1360, wins: 8, losses: 1 },
    { playerName: 'David Wu', totalPoints: 1170, wins: 6, losses: 17 },
    { playerName: '剑锋', totalPoints: 1150, wins: 12, losses: 10 },
    { playerName: '哲身', totalPoints: 1090, wins: 2, losses: 3 },
    { playerName: '王宜帆', totalPoints: 1030, wins: 5, losses: 2 },
    { playerName: '林大', totalPoints: 1010, wins: 7, losses: 15 },
    { playerName: '海伦', totalPoints: 970, wins: 3, losses: 5 },
    { playerName: '许尧', totalPoints: 820, wins: 3, losses: 1 },
    { playerName: 'Ella', totalPoints: 790, wins: 0, losses: 14 },
    { playerName: '小雯', totalPoints: 750, wins: 0, losses: 0 },
    { playerName: '大壮', totalPoints: 710, wins: 5, losses: 3 },
    { playerName: '小叶', totalPoints: 660, wins: 13, losses: 7 },
    { playerName: '威治', totalPoints: 650, wins: 0, losses: 1 },
    { playerName: '奶爸', totalPoints: 500, wins: 0, losses: 0 },
    { playerName: '杜导', totalPoints: 450, wins: 2, losses: 1 },
    { playerName: '钱钱', totalPoints: 450, wins: 2, losses: 1 },
    { playerName: '小童', totalPoints: 440, wins: 6, losses: 5 },
    { playerName: '烈总', totalPoints: 300, wins: 0, losses: 0 },
    { playerName: '小天准备逆袭', totalPoints: 300, wins: 0, losses: 1 },
    { playerName: '大炮', totalPoints: 180, wins: 1, losses: 2 },
    { playerName: '姜黄', totalPoints: 160, wins: 0, losses: 0 },
    { playerName: '沈雅婷', totalPoints: 80, wins: 3, losses: 2 },
    { playerName: '彭于晏', totalPoints: 60, wins: 0, losses: 0 },
    { playerName: '吴老师', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '蛊惑', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '飞鸟', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '小勇', totalPoints: 0, wins: 0, losses: 0 },
  ],
  doubles: [
    { playerName: '标子', totalPoints: 2250, wins: 9, losses: 5 },
    { playerName: '抖抖', totalPoints: 1890, wins: 24, losses: 23 },
    { playerName: 'Ella', totalPoints: 1860, wins: 12, losses: 16 },
    { playerName: '小飞', totalPoints: 1780, wins: 18, losses: 2 },
    { playerName: '剑锋', totalPoints: 1630, wins: 20, losses: 22 },
    { playerName: '栗子', totalPoints: 1580, wins: 24, losses: 19 },
    { playerName: '姜黄', totalPoints: 1500, wins: 4, losses: 0 },
    { playerName: '林大', totalPoints: 1460, wins: 23, losses: 20 },
    { playerName: 'David Wu', totalPoints: 1330, wins: 14, losses: 30 },
    { playerName: '小叶', totalPoints: 1190, wins: 20, losses: 18 },
    { playerName: '乐乐', totalPoints: 1170, wins: 14, losses: 14 },
    { playerName: '蛊惑', totalPoints: 1110, wins: 6, losses: 6 },
    { playerName: '哲身', totalPoints: 1040, wins: 1, losses: 3 },
    { playerName: '小野马', totalPoints: 1030, wins: 7, losses: 10 },
    { playerName: '威治', totalPoints: 1000, wins: 1, losses: 2 },
    { playerName: '海伦', totalPoints: 890, wins: 6, losses: 7 },
    { playerName: '许尧', totalPoints: 870, wins: 5, losses: 3 },
    { playerName: '老板', totalPoints: 840, wins: 1, losses: 2 },
    { playerName: '小童', totalPoints: 770, wins: 16, losses: 16 },
    { playerName: '王宜帆', totalPoints: 480, wins: 8, losses: 3 },
    { playerName: '大壮', totalPoints: 450, wins: 1, losses: 1 },
    { playerName: '小雯', totalPoints: 370, wins: 0, losses: 0 },
    { playerName: '钱钱', totalPoints: 300, wins: 0, losses: 1 },
    { playerName: '沈雅婷', totalPoints: 230, wins: 6, losses: 6 },
    { playerName: '奶爸', totalPoints: 120, wins: 0, losses: 0 },
    { playerName: '烈总', totalPoints: 120, wins: 0, losses: 0 },
    { playerName: '大炮', totalPoints: 50, wins: 2, losses: 1 },
    { playerName: '小勇', totalPoints: 30, wins: 0, losses: 3 },
    { playerName: '飞鸟', totalPoints: 20, wins: 0, losses: 2 },
    { playerName: '吴老师', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '小天准备逆袭', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '杜导', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '彭于晏', totalPoints: 0, wins: 0, losses: 0 },
  ],
};

describe('baseline standings data', () => {
  test('uses the 2026 season id', () => {
    expect(SEASON_ID).toBe('season_2026');
  });

  test('contains the exact full baseline standings table', () => {
    expect(BASELINE_STANDINGS).toEqual(EXPECTED_BASELINE_STANDINGS);
  });

  test('contains 33 singles and 33 doubles rows from the newest screenshots', () => {
    expect(BASELINE_STANDINGS.singles).toHaveLength(33);
    expect(BASELINE_STANDINGS.doubles).toHaveLength(33);
  });

  test('contains key singles rows exactly', () => {
    expect(BASELINE_STANDINGS.singles[0]).toEqual({
      playerName: '小飞',
      totalPoints: 2940,
      wins: 15,
      losses: 0,
    });
    expect(BASELINE_STANDINGS.singles.find((row) => row.playerName === '标子')).toEqual({
      playerName: '标子',
      totalPoints: 1560,
      wins: 7,
      losses: 1,
    });
    expect(BASELINE_STANDINGS.singles.find((row) => row.playerName === '蛊惑')).toEqual({
      playerName: '蛊惑',
      totalPoints: 0,
      wins: 0,
      losses: 0,
    });
  });

  test('contains key doubles rows exactly', () => {
    expect(BASELINE_STANDINGS.doubles[0]).toEqual({
      playerName: '标子',
      totalPoints: 2250,
      wins: 9,
      losses: 5,
    });
    expect(BASELINE_STANDINGS.doubles.find((row) => row.playerName === '王宜帆')).toEqual({
      playerName: '王宜帆',
      totalPoints: 480,
      wins: 8,
      losses: 3,
    });
    expect(BASELINE_STANDINGS.doubles.find((row) => row.playerName === '彭于晏')).toEqual({
      playerName: '彭于晏',
      totalPoints: 0,
      wins: 0,
      losses: 0,
    });
  });

  test('flattens standings rows with season and type annotations', () => {
    const rows = flattenBaselineStandings();

    expect(rows).toHaveLength(66);
    expect(rows[0]).toEqual({
      seasonId: 'season_2026',
      type: 'singles',
      playerName: '小飞',
      totalPoints: 2940,
      wins: 15,
      losses: 0,
    });
    expect(rows[33]).toEqual({
      seasonId: 'season_2026',
      type: 'doubles',
      playerName: '标子',
      totalPoints: 2250,
      wins: 9,
      losses: 5,
    });
  });

  test('validates the flattened baseline standings', () => {
    expect(validateBaselineStandings(flattenBaselineStandings())).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('rejects blank and whitespace-only player names', () => {
    expect(
      validateBaselineStandings([
        {
          seasonId: 'season_2026',
          type: 'singles',
          playerName: '   ',
          totalPoints: 0,
          wins: 0,
          losses: 0,
        },
      ])
    ).toEqual({
      valid: false,
      errors: ['row 0 playerName must be a non-empty string'],
    });
  });

  test('rejects duplicate rows for the same season, type, and player', () => {
    const [firstRow] = flattenBaselineStandings();
    const result = validateBaselineStandings([firstRow, { ...firstRow }]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      'duplicate row for season_2026:singles:小飞'
    );
  });

  test('freezes exported seed data to prevent accidental mutation', () => {
    expect(Object.isFrozen(BASELINE_STANDINGS)).toBe(true);
    expect(Object.isFrozen(BASELINE_STANDINGS.singles)).toBe(true);
    expect(Object.isFrozen(BASELINE_STANDINGS.singles[0])).toBe(true);

    expect(() =>
      BASELINE_STANDINGS.singles.push({
        playerName: '新增',
        totalPoints: 1,
        wins: 1,
        losses: 0,
      })
    ).toThrow();
    expect(flattenBaselineStandings()).toHaveLength(66);
    expect(BASELINE_STANDINGS).toEqual(EXPECTED_BASELINE_STANDINGS);
  });
});
