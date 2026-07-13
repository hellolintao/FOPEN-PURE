const mockState = {
  openid: 'openid-test',
  serverDate: { __serverDate: true },
  whereGetData: [],
  tempFileURLResult: { fileList: [] },
  addResult: { _id: 'created-member' },
  whereUpdateResult: { stats: { updated: 1 } },
  whereRemoveResult: { stats: { removed: 1 } },
  docUpdateResult: { stats: { updated: 1 } },
  docRemoveResult: { stats: { removed: 1 } },
  docGetResult: { data: null }
};

const mockQuery = {
  get: jest.fn(() => {
    const data = typeof mockState.whereGetData === 'function'
      ? mockState.whereGetData(mockQuery.filter, mockQuery.collectionName)
      : mockState.whereGetData;
    return Promise.resolve({ data });
  }),
  update: jest.fn(() => Promise.resolve(mockState.whereUpdateResult)),
  remove: jest.fn(() => Promise.resolve(mockState.whereRemoveResult)),
  orderBy: jest.fn(function orderBy() { return this; }),
  skip: jest.fn(function skip() { return this; }),
  limit: jest.fn(function limit() { return this; })
};

const mockDoc = {
  update: jest.fn(() => Promise.resolve(mockState.docUpdateResult)),
  remove: jest.fn(() => Promise.resolve(mockState.docRemoveResult)),
  get: jest.fn(() => Promise.resolve(mockState.docGetResult))
};

const mockCollection = {
  where: jest.fn((filter) => {
    mockQuery.filter = filter;
    mockQuery.collectionName = mockCollection.collectionName || 'members';
    return mockQuery;
  }),
  add: jest.fn(() => Promise.resolve(mockState.addResult)),
  doc: jest.fn(() => mockDoc),
  orderBy: jest.fn(function orderBy() { return this; }),
  skip: jest.fn(function skip() { return this; }),
  limit: jest.fn(function limit() { return this; }),
  get: jest.fn()
};

const mockDb = {
  command: {
    or: jest.fn((conditions) => ({ $or: conditions })),
    and: jest.fn((conditions) => ({ $and: conditions })),
    exists: jest.fn((value) => ({ $exists: value })),
    in: jest.fn((values) => ({ $in: values }))
  },
  RegExp: jest.fn((options) => ({ $regex: options })),
  serverDate: jest.fn(() => mockState.serverDate),
  collection: jest.fn((name = 'members') => {
    mockCollection.collectionName = name;
    return mockCollection;
  })
};

jest.mock('wx-server-sdk', () => ({
  DYNAMIC_CURRENT_ENV: 'dynamic-current-env',
  init: jest.fn(),
  getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
  database: jest.fn(() => mockDb),
  getTempFileURL: jest.fn(() => Promise.resolve(mockState.tempFileURLResult)),
  deleteFile: jest.fn(() => Promise.resolve({ fileList: [] }))
}));

const cloud = require('wx-server-sdk');

describe('members cloud function', () => {
  let main;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState.openid = 'openid-test';
    mockState.serverDate = { __serverDate: true };
    mockState.whereGetData = [];
    mockState.tempFileURLResult = { fileList: [] };
    mockState.addResult = { _id: 'created-member' };
    mockState.whereUpdateResult = { stats: { updated: 1 } };
    mockState.whereRemoveResult = { stats: { removed: 1 } };
    mockState.docUpdateResult = { stats: { updated: 1 } };
    mockState.docRemoveResult = { stats: { removed: 1 } };
    mockState.docGetResult = { data: null };
    mockCollection.collectionName = 'members';
    mockQuery.collectionName = 'members';
    jest.isolateModules(() => {
      ({ main } = require('../index'));
    });
  });

  test('action=add missing name returns validation failed and does not add', async () => {
    const result = await main({
      action: 'add',
      data: { playStyle: 'ice-cow' }
    }, {});

    expect(result).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' }
    });
    expect(mockCollection.add).not.toHaveBeenCalled();
  });

  test('action=add missing playStyle returns validation failed and does not add', async () => {
    const result = await main({
      action: 'add',
      data: { name: '张三' }
    }, {});

    expect(result).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' }
    });
    expect(mockCollection.add).not.toHaveBeenCalled();
  });

  test('action=add existing openid returns existing member without legacy phone and does not add', async () => {
    const existing = { _id: 'member-1', openid: mockState.openid, name: '张三', phone: '13800000000' };
    mockState.whereGetData = [existing];

    const result = await main({
      action: 'add',
      data: { name: '张三', playStyle: 'vers' }
    }, {});

    expect(result).toEqual({
      errMsg: 'already registered',
      data: { _id: 'member-1', openid: mockState.openid, name: '张三' }
    });
    expect(result.data).not.toHaveProperty('phone');
    expect(mockCollection.where).toHaveBeenCalledWith({ openid: mockState.openid });
    expect(mockCollection.add).not.toHaveBeenCalled();
  });

  test('action=add valid data trims name, writes defaults, and strips disallowed fields', async () => {
    await main({
      action: 'add',
      data: {
        name: '  李四  ',
        phone: '13800000000',
        avatarUrl: 'https://x.com/a.jpg',
        playStyle: 'grinder',
        status: 'inactive',
        admin: true,
        playStyleNote: 'drop this',
        arbitrary: 'drop me'
      }
    }, {});

    expect(mockCollection.add).toHaveBeenCalledWith({
      data: {
        openid: mockState.openid,
        name: '李四',
        avatarUrl: 'https://x.com/a.jpg',
        status: 'active',
        admin: false,
        playStyle: 'grinder',
        claimStatus: 'claimed',
        createTime: mockState.serverDate,
        updateTime: mockState.serverDate
      }
    });
  });

  test('action=add claims exactly one unclaimed member by exact name', async () => {
    const unclaimed = {
      _id: 'member-unclaimed-1',
      name: '标子',
      status: 'active',
      claimStatus: 'unclaimed',
      admin: false,
      createTime: '2026-01-01'
    };
    mockState.whereGetData = (filter) => {
      if (filter && filter.openid === mockState.openid) return [];
      if (filter && filter.name === '标子' && filter.claimStatus === 'unclaimed') return [unclaimed];
      return [];
    };

    const result = await main({
      action: 'add',
      data: {
        name: '标子',
        phone: '13800000000',
        avatarUrl: 'https://x.com/a.jpg',
        playStyle: 'grinder'
      }
    }, {});

    expect(mockCollection.where).toHaveBeenNthCalledWith(1, { openid: mockState.openid });
    expect(mockCollection.where).toHaveBeenNthCalledWith(2, { name: '标子', claimStatus: 'unclaimed' });
    expect(mockCollection.where).toHaveBeenNthCalledWith(3, {
      _id: 'member-unclaimed-1',
      claimStatus: 'unclaimed',
      openid: { $exists: false },
      openId: { $exists: false }
    });
    expect(mockQuery.update).toHaveBeenCalledWith({
      data: {
        openid: mockState.openid,
        name: '标子',
        avatarUrl: 'https://x.com/a.jpg',
        playStyle: 'grinder',
        claimStatus: 'claimed',
        status: 'active',
        admin: false,
        isAdmin: false,
        updateTime: mockState.serverDate
      }
    });
    expect(mockCollection.doc).not.toHaveBeenCalled();
    expect(mockCollection.add).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: {
        ...unclaimed,
        openid: mockState.openid,
        avatarUrl: 'https://x.com/a.jpg',
        playStyle: 'grinder',
        claimStatus: 'claimed',
        status: 'active',
        admin: false,
        isAdmin: false,
        updateTime: mockState.serverDate
      }
    });
  });

  test('action=add clears legacy isAdmin flag when claiming an unclaimed member', async () => {
    const unclaimed = {
      _id: 'member-unclaimed-admin',
      name: '旧管理员',
      status: 'active',
      claimStatus: 'unclaimed',
      admin: false,
      isAdmin: true
    };
    mockState.whereGetData = (filter) => {
      if (filter && filter.openid === mockState.openid) return [];
      if (filter && filter.name === '旧管理员' && filter.claimStatus === 'unclaimed') return [unclaimed];
      return [];
    };

    const result = await main({
      action: 'add',
      data: { name: '旧管理员', playStyle: 'vers' }
    }, {});

    expect(mockQuery.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        admin: false,
        isAdmin: false
      })
    });
    expect(result.data).toEqual(expect.objectContaining({
      admin: false,
      isAdmin: false
    }));
  });

  test('action=add returns CLAIM_CONFLICT and does not add when conditional claim updates no rows', async () => {
    const unclaimed = {
      _id: 'member-race-lost',
      name: '并发',
      status: 'active',
      claimStatus: 'unclaimed',
      admin: false
    };
    mockState.whereUpdateResult = { stats: { updated: 0 } };
    mockState.whereGetData = (filter) => {
      if (filter && filter.openid === mockState.openid) return [];
      if (filter && filter.name === '并发' && filter.claimStatus === 'unclaimed') return [unclaimed];
      return [];
    };

    const result = await main({
      action: 'add',
      data: { name: '并发', playStyle: 'vers' }
    }, {});

    expect(result).toEqual({
      success: false,
      error: {
        code: 'CLAIM_CONFLICT',
        message: expect.any(String)
      }
    });
    expect(mockCollection.add).not.toHaveBeenCalled();
    expect(mockDoc.update).not.toHaveBeenCalled();
  });

  test('action=add creates new claimed member when no unclaimed exact-name match exists', async () => {
    mockState.whereGetData = (filter) => {
      if (filter && filter.openid === mockState.openid) return [];
      if (filter && filter.name === '不存在' && filter.claimStatus === 'unclaimed') return [];
      return [];
    };

    await main({
      action: 'add',
      data: { name: '不存在', playStyle: 'vers' }
    }, {});

    expect(mockCollection.add).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '不存在',
        openid: mockState.openid,
        playStyle: 'vers',
        claimStatus: 'claimed',
        status: 'active',
        admin: false
      })
    });
  });

  test('action=add returns CLAIM_CONFLICT when multiple unclaimed exact-name matches exist', async () => {
    mockState.whereGetData = (filter) => {
      if (filter && filter.openid === mockState.openid) return [];
      if (filter && filter.name === '重名' && filter.claimStatus === 'unclaimed') {
        return [
          { _id: 'member-unclaimed-1', name: '重名', claimStatus: 'unclaimed', status: 'active' },
          { _id: 'member-unclaimed-2', name: '重名', claimStatus: 'unclaimed', status: 'active' }
        ];
      }
      return [];
    };

    const result = await main({
      action: 'add',
      data: { name: '重名', playStyle: 'vers' }
    }, {});

    expect(result).toEqual({
      success: false,
      error: { code: 'CLAIM_CONFLICT', message: '姓名匹配到多条待认领会员，请联系管理员处理' }
    });
    expect(mockDoc.update).not.toHaveBeenCalled();
    expect(mockCollection.add).not.toHaveBeenCalled();
  });

  test('action=get returns empty data when wx context has no openid', async () => {
    mockState.openid = undefined;

    const result = await main({ action: 'get' }, {});

    expect(result).toEqual({ data: [] });
    expect(mockCollection.where).not.toHaveBeenCalled();
  });

  test('action=get resolves a legacy openId member row', async () => {
    const legacyMember = { _id: 'legacy-member', openId: mockState.openid, name: '旧会员' };
    mockState.whereGetData = (filter) => {
      if (filter && Array.isArray(filter.$or)) return [legacyMember];
      return [];
    };

    const result = await main({ action: 'get' }, {});

    expect(mockDb.command.or).toHaveBeenCalledWith([
      { openid: mockState.openid },
      { openId: mockState.openid }
    ]);
    expect(mockCollection.where).toHaveBeenCalledWith({
      $or: [
        { openid: mockState.openid },
        { openId: mockState.openid }
      ]
    });
    expect(result).toEqual({ data: [legacyMember] });
  });

  test('action=add creates new claimed member when matching unclaimed name already has openid', async () => {
    const unavailable = {
      _id: 'member-already-linked',
      name: '已绑定',
      status: 'active',
      claimStatus: 'unclaimed',
      openid: 'other-openid'
    };
    mockState.whereGetData = (filter) => {
      if (filter && filter.openid === mockState.openid) return [];
      if (filter && filter.name === '已绑定' && filter.claimStatus === 'unclaimed') return [unavailable];
      return [];
    };

    await main({
      action: 'add',
      data: { name: '已绑定', playStyle: 'vers' }
    }, {});

    expect(mockQuery.update).not.toHaveBeenCalled();
    expect(mockCollection.add).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '已绑定',
        openid: mockState.openid,
        playStyle: 'vers',
        claimStatus: 'claimed',
        status: 'active',
        admin: false
      })
    });
  });

  test('action=add does not claim name with surrounding whitespace unless trim makes exact match', async () => {
    const unclaimed = {
      _id: 'member-unclaimed-trimmed',
      name: '标子',
      status: 'active',
      claimStatus: 'unclaimed'
    };
    mockState.whereGetData = (filter) => {
      if (filter && filter.openid === mockState.openid) return [];
      if (filter && filter.name === '标子' && filter.claimStatus === 'unclaimed') return [unclaimed];
      return [];
    };

    await main({
      action: 'add',
      data: { name: '  标子  ', playStyle: 'vers' }
    }, {});

    expect(mockCollection.where).toHaveBeenNthCalledWith(2, { name: '标子', claimStatus: 'unclaimed' });
    expect(mockCollection.where).toHaveBeenNthCalledWith(3, {
      _id: 'member-unclaimed-trimmed',
      claimStatus: 'unclaimed',
      openid: { $exists: false },
      openId: { $exists: false }
    });
    expect(mockQuery.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        openid: mockState.openid,
        name: '标子',
        playStyle: 'vers',
        claimStatus: 'claimed',
        isAdmin: false
      })
    });
    expect(mockCollection.doc).not.toHaveBeenCalled();
    expect(mockCollection.add).not.toHaveBeenCalled();
  });

  test('action=update strips playStyleNote and openid, preserves playStyle and updateTime', async () => {
    await main({
      action: 'update',
      data: {
        name: '  王五  ',
        openid: 'malicious-openid',
        status: 'inactive',
        admin: true,
        playStyle: 'slicer',
        playStyleNote: 'drop this',
        arbitrary: 'drop me'
      }
    }, {});

    expect(mockCollection.where).toHaveBeenCalledWith({ openid: mockState.openid });
    expect(mockQuery.update).toHaveBeenCalledWith({
      data: {
        name: '王五',
        playStyle: 'slicer',
        updateTime: mockState.serverDate
      }
    });
  });

  test('action=revokePublicProfile revokes consent only for the current openid', async () => {
    const result = await main({
      action: 'revokePublicProfile',
      data: { _id: 'other-member', openid: 'other-openid', publicProfileConsent: true }
    }, {});

    expect(result).toEqual(mockState.whereUpdateResult);
    expect(mockCollection.where).toHaveBeenCalledWith({ openid: mockState.openid });
    expect(mockQuery.update).toHaveBeenCalledWith({
      data: {
        publicProfileConsent: false,
        publicProfileConsentAt: null,
        updateTime: mockState.serverDate
      }
    });
    expect(mockCollection.doc).not.toHaveBeenCalled();
  });

  test('action=delete rejects arbitrary target IDs from normal self-service callers', async () => {
    const result = await main({
      action: 'delete',
      _id: 'other-member',
      data: { memberId: 'other-member', openid: 'other-openid' }
    }, {});

    expect(result).toMatchObject({
      success: false,
      error: { code: 'SELF_SCOPE_ONLY' }
    });
    expect(mockQuery.remove).not.toHaveBeenCalled();
    expect(mockCollection.doc).not.toHaveBeenCalled();
  });

  test('action=deleteSelf removes member row and deletes or anonymizes related user data', async () => {
    const member = {
      _id: 'member-self',
      openid: mockState.openid,
      name: '张三',
      avatarUrl: 'cloud://fopen-prod/avatar/member-self.png'
    };
    mockState.whereGetData = (filter, collectionName) => {
      if (collectionName === 'members') return [member];
      if (collectionName === 'tournament_registrations') {
        return [{ _id: 'reg-self', playerId: 'member-self', playerName: '张三' }];
      }
      if (collectionName === 'match_results') {
        return [{
          _id: 'result-self',
          player1: { id: 'member-self', name: '张三', avatarUrl: member.avatarUrl },
          player2: { id: 'member-other', name: '李四' },
          playerIds: ['member-self', 'member-other'],
          winnerId: 'member-self',
          winner: { id: 'member-self', name: '张三' },
          submittedBy: 'member-self',
          pointsAwarded: {
            entries: [
              { memberId: 'member-self', points: 10 },
              { memberId: 'member-other', points: 3 }
            ]
          }
        }];
      }
      if (collectionName === 'tournament_brackets') {
        return [{
          _id: 'bracket-self',
          matches: [{
            matchId: 'm1',
            player1: { id: 'member-self', name: '张三', avatarUrl: member.avatarUrl },
            player2: { id: 'member-other', name: '李四' },
            winner: { id: 'member-self', name: '张三' },
            playerIds: ['member-self', 'member-other']
          }]
        }];
      }
      if (collectionName === 'tournament_points') return [{ _id: 'points-self', memberId: 'member-self' }];
      if (collectionName === 'rank_snapshots') return [{ _id: 'rank-snapshot-self', memberId: 'member-self' }];
      if (collectionName === 'rank_cache') return [{ _id: 'rank-cache-singles' }];
      if (collectionName === 'weekly_stars') return [{ _id: 'weekly-star-current' }];
      return [];
    };

    const result = await main({
      action: 'deleteSelf',
      data: { memberId: 'other-member', openid: 'other-openid' }
    }, {});

    expect(result).toMatchObject({ success: true });
    expect(mockDb.collection.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining([
      'members',
      'tournament_registrations',
      'match_results',
      'tournament_brackets',
      'tournament_points',
      'rank_cache',
      'rank_snapshots',
      'weekly_stars'
    ]));
    expect(cloud.deleteFile).toHaveBeenCalledWith({ fileList: [member.avatarUrl] });
    expect(mockCollection.doc).toHaveBeenCalledWith('reg-self');
    expect(mockCollection.doc).toHaveBeenCalledWith('points-self');
    expect(mockCollection.doc).toHaveBeenCalledWith('rank-snapshot-self');
    expect(mockCollection.doc).toHaveBeenCalledWith('rank-cache-singles');
    expect(mockCollection.doc).toHaveBeenCalledWith('weekly-star-current');

    const updatePayloads = mockDoc.update.mock.calls.map(call => call[0] && call[0].data);
    const serializedUpdates = JSON.stringify(updatePayloads);
    expect(serializedUpdates).toContain('已删除用户');
    expect(serializedUpdates).not.toContain('member-self');
    expect(serializedUpdates).not.toContain('张三');
    expect(serializedUpdates).not.toContain(member.avatarUrl);
  });

  test('action=deleteSelf anonymizes raw openid references in related match rows', async () => {
    mockState.whereGetData = (filter, collectionName) => {
      if (collectionName === 'members') {
        return [{ _id: 'member-self', openid: mockState.openid, name: '张三' }];
      }
      if (collectionName === 'match_results') {
        return [{
          _id: 'result-openid',
          openid: mockState.openid,
          submittedByOpenid: mockState.openid,
          player1: { id: 'member-other', name: '李四' }
        }];
      }
      return [];
    };

    const result = await main({ action: 'deleteSelf' }, {});

    expect(result).toMatchObject({ success: true });
    const updatePayloads = mockDoc.update.mock.calls.map(call => call[0] && call[0].data);
    expect(JSON.stringify(updatePayloads)).not.toContain(mockState.openid);
  });

  test('action=claimSelf persists claimed status for openid-bound unclaimed member', async () => {
    const existing = {
      _id: 'member-openid-unclaimed',
      openid: mockState.openid,
      name: '旧名',
      claimStatus: 'unclaimed',
      status: 'active',
      admin: false
    };
    mockState.whereGetData = [existing];

    const result = await main({
      action: 'claimSelf',
      data: {
        name: '张三',
        phone: '13800000000',
        avatarUrl: 'cloud://avatar',
        playStyle: 'vers'
      }
    }, {});

    expect(mockCollection.where).toHaveBeenNthCalledWith(1, { openid: mockState.openid });
    expect(mockQuery.update).toHaveBeenCalledWith({
      data: {
        name: '张三',
        avatarUrl: 'cloud://avatar',
        playStyle: 'vers',
        claimStatus: 'claimed',
        status: 'active',
        updateTime: mockState.serverDate
      }
    });
    expect(result).toEqual({
      data: {
        ...existing,
        name: '张三',
        avatarUrl: 'cloud://avatar',
        playStyle: 'vers',
        claimStatus: 'claimed',
        status: 'active',
        updateTime: mockState.serverDate
      }
    });
  });

  test('action=claimSelf returns failure when no openid-bound row is updated', async () => {
    mockState.whereGetData = [{ _id: 'member-openid-unclaimed', openid: mockState.openid, name: '旧名', claimStatus: 'unclaimed' }];
    mockState.whereUpdateResult = { stats: { updated: 0 } };

    const result = await main({
      action: 'claimSelf',
      data: { name: '张三', playStyle: 'vers' }
    }, {});

    expect(result).toMatchObject({
      success: false,
      error: { code: 'CLAIM_FAILED' }
    });
  });

  test('action=updateById missing _id returns error and does not doc()', async () => {
    const result = await main({
      action: 'updateById',
      data: { name: '张三', playStyle: 'vers' }
    }, {});

    expect(result).toEqual({ errMsg: '_id is required' });
    expect(mockCollection.doc).not.toHaveBeenCalled();
  });

  test('action=updateById strips playStyleNote and preserves admin, status, and playStyle', async () => {
    mockState.whereGetData = [{ _id: 'admin-1', openid: mockState.openid, admin: true }];

    await main({
      action: 'updateById',
      _id: 'member-1',
      data: {
        name: '  赵六  ',
        status: 'inactive',
        admin: true,
        playStyle: 'moon-queen',
        playStyleNote: 'drop this',
        arbitrary: 'drop me'
      }
    }, {});

    expect(mockCollection.doc).toHaveBeenCalledWith('member-1');
    expect(mockDoc.update).toHaveBeenCalledWith({
      data: {
        name: '赵六',
        status: 'inactive',
        admin: true,
        playStyle: 'moon-queen',
        updateTime: mockState.serverDate
      }
    });
  });

  test('action=updateById rejects non-admin caller before updating member rows', async () => {
    mockState.whereGetData = [{ _id: 'member-self', openid: mockState.openid, admin: false }];

    const result = await main({
      action: 'updateById',
      _id: 'member-1',
      data: { name: '赵六', status: 'inactive', playStyle: 'moon-queen' }
    }, {});

    expect(result).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN', message: '需要管理员权限' }
    });
    expect(mockDoc.update).not.toHaveBeenCalled();
  });

  test('action=search resolves cloud avatar file IDs to temporary display URLs', async () => {
    const cloudAvatar = 'cloud://cloud1-0gthnke69a09f52a.avatars/private-avatar.png';
    mockState.whereGetData = (filter) => {
      if (filter && filter.$or) return [{ _id: 'admin-1', openid: mockState.openid, admin: true }];
      return [
        { _id: 'member-1', name: '林大', phone: '13800000000', avatarUrl: cloudAvatar },
        { _id: 'member-2', name: '乐乐', phone: '13900000000', avatarUrl: 'https://example.com/avatar.jpg' },
        { _id: 'member-3', name: '空头像', avatarUrl: '' }
      ];
    };
    mockState.tempFileURLResult = {
      fileList: [
        { fileID: cloudAvatar, tempFileURL: 'https://tmp.example.com/private-avatar.png' }
      ]
    };

    const result = await main({ action: 'search', page: 1, pageSize: 20 }, {});

    expect(cloud.getTempFileURL).toHaveBeenCalledWith({ fileList: [cloudAvatar] });
    expect(result.data).toEqual([
      { _id: 'member-1', name: '林大', avatarUrl: 'https://tmp.example.com/private-avatar.png' },
      { _id: 'member-2', name: '乐乐', avatarUrl: 'https://example.com/avatar.jpg' },
      { _id: 'member-3', name: '空头像', avatarUrl: '' }
    ]);
    expect(result.data[0]).not.toHaveProperty('phone');
    expect(result.data[1]).not.toHaveProperty('phone');
  });

  test('action=search only builds nickname keyword filters, not phone filters', async () => {
    mockState.whereGetData = (filter) => {
      if (filter && filter.$or) return [{ _id: 'admin-1', openid: mockState.openid, admin: true }];
      return [];
    };

    await main({ action: 'search', keyword: '138', page: 1, pageSize: 20 }, {});

    const searchFilter = mockCollection.where.mock.calls[mockCollection.where.mock.calls.length - 1][0];
    const serialized = JSON.stringify(searchFilter);
    expect(serialized).toContain('name');
    expect(serialized).not.toContain('phone');
  });

  test('action=list strips legacy phone fields from member rows', async () => {
    mockState.whereGetData = (filter) => {
      if (filter && filter.$or) return [{ _id: 'admin-1', openid: mockState.openid, admin: true }];
      return [
        { _id: 'member-1', name: '林大', phone: '13800000000', status: 'active' },
        { _id: 'member-2', name: '乐乐', status: 'inactive' }
      ];
    };

    const result = await main({ action: 'list', page: 1, pageSize: 20 }, {});

    expect(result.data).toEqual([
      { _id: 'member-1', name: '林大', status: 'active' },
      { _id: 'member-2', name: '乐乐', status: 'inactive' }
    ]);
  });

  test('action=getById returns public profile without phone, openid, or admin flags when no consent', async () => {
    mockState.docGetResult = {
      data: {
        _id: 'member-1',
        openid: 'openid-secret',
        openId: 'openId-secret',
        unionid: 'union-secret',
        name: '赵六',
        phone: '13800000000',
        avatarUrl: 'cloud://avatar',
        admin: true,
        isAdmin: true,
        status: 'active',
        playStyle: 'moon-queen',
        createTime: '2026-01-01',
        updateTime: '2026-01-02'
      }
    };

    const result = await main({ action: 'getById', _id: 'member-1' }, {});

    expect(result).toEqual({
        data: {
          _id: 'member-1',
          name: '赵六',
          avatarUrl: 'cloud://avatar',
          status: 'active',
          playStyle: '',
        publicProfileVisible: false,
        createTime: '2026-01-01',
        updateTime: '2026-01-02'
      }
    });
  });

  test('action=getById returns real public profile only when public consent exists', async () => {
    mockState.docGetResult = {
      data: {
        _id: 'member-1',
        openid: 'openid-secret',
        name: '赵六',
        avatarUrl: 'cloud://avatar',
        publicProfileConsent: true,
        publicProfileConsentAt: '2026-01-01',
        playStyle: 'moon-queen'
      }
    };

    const result = await main({ action: 'getById', _id: 'member-1' }, {});

    expect(result).toEqual({
      data: {
        _id: 'member-1',
        name: '赵六',
        avatarUrl: 'cloud://avatar',
        playStyle: 'moon-queen',
        publicProfileVisible: true
      }
    });
    expect(result.data).not.toHaveProperty('openid');
    expect(result.data).not.toHaveProperty('publicProfileConsent');
    expect(result.data).not.toHaveProperty('publicProfileConsentAt');
  });
});
