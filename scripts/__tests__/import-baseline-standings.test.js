function makeFakeDb({ members = [] } = {}) {
  const rows = {
    baseline_standings: [],
    members: members.map((member) => ({ ...member })),
  };
  const writes = [];

  function rowMatches(row, filter) {
    return Object.entries(filter || {}).every(([field, expected]) => row[field] === expected);
  }

  function makeCollection(name) {
    return {
      where(filter) {
        const chain = {
          limit(n) {
            return {
              get: async () => ({
                data: rows[name].filter((row) => rowMatches(row, filter)).slice(0, n),
              }),
            };
          },
          get: async () => ({
            data: rows[name].filter((row) => rowMatches(row, filter)),
          }),
        };
        return chain;
      },
      doc(id) {
        return {
          get: async () => ({
            data: rows[name].filter((row) => row._id === id),
          }),
          set: async (data) => {
            if (data && Object.prototype.hasOwnProperty.call(data, 'data')) {
              throw new Error('node-sdk doc.set expects data directly, not { data }');
            }
            if (data && Object.prototype.hasOwnProperty.call(data, '_id')) {
              throw new Error('node-sdk doc.set rejects payload _id');
            }
            writes.push({ op: 'set', collection: name, _id: id, data });
            const existingIndex = rows[name].findIndex((row) => row._id === id);
            const nextRow = { _id: id, ...data };
            if (existingIndex >= 0) rows[name][existingIndex] = nextRow;
            else rows[name].push(nextRow);
            return { _id: id };
          },
          update: async (data) => {
            if (data && Object.prototype.hasOwnProperty.call(data, 'data')) {
              throw new Error('node-sdk doc.update expects data directly, not { data }');
            }
            if (data && Object.prototype.hasOwnProperty.call(data, '_id')) {
              throw new Error('node-sdk doc.update rejects payload _id');
            }
            writes.push({ op: 'update', collection: name, _id: id, data });
            const existingIndex = rows[name].findIndex((row) => row._id === id);
            if (existingIndex < 0) {
              throw new Error(`document ${name}/${id} does not exist`);
            }
            rows[name][existingIndex] = { ...rows[name][existingIndex], ...data };
            return { updated: 1 };
          },
        };
      },
    };
  }

  return {
    db: { collection: makeCollection },
    rows,
    writes,
  };
}

describe('importBaselineStandings', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('requiring the script does not load cloudbase node sdk', () => {
    jest.doMock('@cloudbase/node-sdk', () => {
      throw new Error('cloudbase sdk should only load in CLI mode');
    }, { virtual: true });

    expect(() => require('../import-baseline-standings')).not.toThrow();
  });

  test('writes all 66 baseline standings with stable ids', async () => {
    const { importBaselineStandings } = require('../import-baseline-standings');
    const { db, rows } = makeFakeDb();

    const summary = await importBaselineStandings(db, {
      now: new Date('2026-05-18T00:00:00.000Z'),
    });

    expect(summary.baselineStandingsUpserted).toBe(66);
    expect(rows.baseline_standings).toHaveLength(66);
    expect(rows.baseline_standings[0]).toEqual({
      _id: 'baseline_season_2026_singles_小飞',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'unclaimed_小飞',
      playerName: '小飞',
      rank: 1,
      totalPoints: 2940,
      wins: 15,
      losses: 0,
      source: 'baseline_import',
      baseline: true,
      createTime: new Date('2026-05-18T00:00:00.000Z'),
      updateTime: new Date('2026-05-18T00:00:00.000Z'),
      createdAt: new Date('2026-05-18T00:00:00.000Z'),
      updatedAt: new Date('2026-05-18T00:00:00.000Z'),
    });
    expect(rows.baseline_standings[0]).not.toHaveProperty('eventType');
    expect(rows.baseline_standings[33]._id).toBe('baseline_season_2026_doubles_标子');
    expect(rows.baseline_standings[33].rank).toBe(1);
  });

  test('second run updates the same baseline ids without duplicates or createTime reset', async () => {
    const { importBaselineStandings } = require('../import-baseline-standings');
    const { db, rows, writes } = makeFakeDb();

    await importBaselineStandings(db, { now: new Date('2026-05-18T00:00:00.000Z') });
    await importBaselineStandings(db, { now: new Date('2026-05-19T00:00:00.000Z') });

    const baselineWrites = writes.filter((write) => write.collection === 'baseline_standings');
    const baselineIds = rows.baseline_standings.map((row) => row._id);
    const uniquePlayerNames = new Set(rows.baseline_standings.map((row) => row.playerName));
    expect(baselineWrites).toHaveLength(132);
    expect(rows.baseline_standings).toHaveLength(66);
    expect(new Set(baselineIds).size).toBe(66);
    expect(rows.members).toHaveLength(uniquePlayerNames.size);
    expect(new Set(rows.members.map((row) => row._id)).size).toBe(uniquePlayerNames.size);
    expect(rows.baseline_standings[0].createTime).toEqual(new Date('2026-05-18T00:00:00.000Z'));
    expect(rows.baseline_standings[0].createdAt).toEqual(new Date('2026-05-18T00:00:00.000Z'));
    expect(rows.baseline_standings[0].updateTime).toEqual(new Date('2026-05-19T00:00:00.000Z'));
    expect(rows.baseline_standings[0].updatedAt).toEqual(new Date('2026-05-19T00:00:00.000Z'));
  });

  test('does not overwrite existing member and points baseline row to existing member _id', async () => {
    const existingMember = {
      _id: 'member_xiaofei',
      name: '小飞',
      status: 'active',
      admin: true,
      openid: 'openid-1',
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const { importBaselineStandings } = require('../import-baseline-standings');
    const { db, rows } = makeFakeDb({ members: [existingMember] });

    const summary = await importBaselineStandings(db, {
      rows: [
        {
          seasonId: 'season_2026',
          type: 'singles',
          playerName: '小飞',
          totalPoints: 2940,
          wins: 15,
          losses: 0,
        },
      ],
      now: new Date('2026-05-18T00:00:00.000Z'),
    });

    expect(summary.unclaimedMembersCreated).toBe(0);
    expect(summary.existingMembersSkipped).toBe(1);
    expect(rows.members).toEqual([existingMember]);
    expect(rows.baseline_standings).toHaveLength(1);
    expect(rows.baseline_standings[0].memberId).toBe('member_xiaofei');
  });

  test('creates unclaimed member placeholder without openid when member name does not exist', async () => {
    const { importBaselineStandings } = require('../import-baseline-standings');
    const { db, rows } = makeFakeDb();

    const summary = await importBaselineStandings(db, {
      rows: [
        {
          seasonId: 'season_2026',
          type: 'doubles',
          playerName: '新选手',
          totalPoints: 100,
          wins: 1,
          losses: 0,
        },
      ],
      now: new Date('2026-05-18T00:00:00.000Z'),
    });

    expect(summary.unclaimedMembersCreated).toBe(1);
    expect(summary.existingMembersSkipped).toBe(0);
    expect(rows.members).toEqual([
      {
        _id: 'unclaimed_新选手',
        name: '新选手',
        avatarUrl: '/images/icons/usercenter.png',
        status: 'active',
        claimStatus: 'unclaimed',
        admin: false,
        source: 'baseline_import',
        createdBy: 'baseline_import',
        createTime: new Date('2026-05-18T00:00:00.000Z'),
        updateTime: new Date('2026-05-18T00:00:00.000Z'),
      },
    ]);
    expect(rows.members[0]).not.toHaveProperty('openid');
    expect(rows.members[0]).not.toHaveProperty('openId');
    expect(rows.baseline_standings[0].memberId).toBe('unclaimed_新选手');
  });

  test('rejects duplicate member names before writing baseline or member data', async () => {
    const { importBaselineStandings } = require('../import-baseline-standings');
    const { db, rows } = makeFakeDb({
      members: [
        { _id: 'member_1', name: '小飞' },
        { _id: 'member_2', name: '小飞' },
      ],
    });

    await expect(importBaselineStandings(db, {
      rows: [
        {
          seasonId: 'season_2026',
          type: 'singles',
          playerName: '小飞',
          totalPoints: 2940,
          wins: 15,
          losses: 0,
        },
      ],
      now: new Date('2026-05-18T00:00:00.000Z'),
    })).rejects.toThrow('Multiple members found for playerName "小飞": member_1, member_2');

    expect(rows.baseline_standings).toHaveLength(0);
    expect(rows.members).toEqual([
      { _id: 'member_1', name: '小飞' },
      { _id: 'member_2', name: '小飞' },
    ]);
  });

  test('uses validateBaselineStandings and rejects invalid rows before writing', async () => {
    const validateBaselineStandings = jest.fn(() => ({
      valid: false,
      errors: ['row 0 playerName must be a non-empty string'],
    }));
    jest.doMock('../lib/baseline-standings-data', () => ({
      SEASON_ID: 'season_2026',
      flattenBaselineStandings: jest.fn(() => [
        {
          seasonId: 'season_2026',
          type: 'singles',
          playerName: ' ',
          totalPoints: 0,
          wins: 0,
          losses: 0,
        },
      ]),
      validateBaselineStandings,
    }));

    const { importBaselineStandings } = require('../import-baseline-standings');
    const { db, rows } = makeFakeDb();

    await expect(importBaselineStandings(db)).rejects.toThrow(
      'Invalid baseline standings: row 0 playerName must be a non-empty string'
    );
    expect(validateBaselineStandings).toHaveBeenCalledTimes(1);
    expect(rows.baseline_standings).toHaveLength(0);
    expect(rows.members).toHaveLength(0);
  });
});
