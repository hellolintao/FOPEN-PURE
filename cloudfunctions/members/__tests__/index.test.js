const mockState = {
  openid: 'openid-test',
  serverDate: { __serverDate: true },
  whereGetData: [],
  addResult: { _id: 'created-member' },
  whereUpdateResult: { stats: { updated: 1 } },
  docUpdateResult: { stats: { updated: 1 } }
};

const mockQuery = {
  get: jest.fn(() => Promise.resolve({ data: mockState.whereGetData })),
  update: jest.fn(() => Promise.resolve(mockState.whereUpdateResult)),
  remove: jest.fn()
};

const mockDoc = {
  update: jest.fn(() => Promise.resolve(mockState.docUpdateResult)),
  remove: jest.fn(),
  get: jest.fn()
};

const mockCollection = {
  where: jest.fn(() => mockQuery),
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
    and: jest.fn((conditions) => ({ $and: conditions }))
  },
  RegExp: jest.fn((options) => ({ $regex: options })),
  serverDate: jest.fn(() => mockState.serverDate),
  collection: jest.fn(() => mockCollection)
};

jest.mock('wx-server-sdk', () => ({
  DYNAMIC_CURRENT_ENV: 'dynamic-current-env',
  init: jest.fn(),
  getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
  database: jest.fn(() => mockDb)
}));

describe('members cloud function', () => {
  let main;

  beforeEach(() => {
    jest.clearAllMocks();
    mockState.openid = 'openid-test';
    mockState.serverDate = { __serverDate: true };
    mockState.whereGetData = [];
    mockState.addResult = { _id: 'created-member' };
    mockState.whereUpdateResult = { stats: { updated: 1 } };
    mockState.docUpdateResult = { stats: { updated: 1 } };
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

  test('action=add existing openid returns existing member and does not add', async () => {
    const existing = { _id: 'member-1', openid: mockState.openid, name: '张三' };
    mockState.whereGetData = [existing];

    const result = await main({
      action: 'add',
      data: { name: '张三', playStyle: 'vers' }
    }, {});

    expect(result).toEqual({ errMsg: 'already registered', data: existing });
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
        playStyleNote: 'drop this',
        arbitrary: 'drop me'
      }
    }, {});

    expect(mockCollection.add).toHaveBeenCalledWith({
      data: {
        openid: mockState.openid,
        name: '李四',
        phone: '13800000000',
        avatarUrl: 'https://x.com/a.jpg',
        status: 'active',
        admin: false,
        playStyle: 'grinder',
        createTime: mockState.serverDate,
        updateTime: mockState.serverDate
      }
    });
  });

  test('action=update strips playStyleNote and openid, preserves playStyle and updateTime', async () => {
    await main({
      action: 'update',
      data: {
        name: '  王五  ',
        openid: 'malicious-openid',
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

  test('action=updateById missing _id returns error and does not doc()', async () => {
    const result = await main({
      action: 'updateById',
      data: { name: '张三', playStyle: 'vers' }
    }, {});

    expect(result).toEqual({ errMsg: '_id is required' });
    expect(mockCollection.doc).not.toHaveBeenCalled();
  });

  test('action=updateById strips playStyleNote and preserves playStyle', async () => {
    await main({
      action: 'updateById',
      _id: 'member-1',
      data: {
        name: '  赵六  ',
        playStyle: 'moon-queen',
        playStyleNote: 'drop this',
        arbitrary: 'drop me'
      }
    }, {});

    expect(mockCollection.doc).toHaveBeenCalledWith('member-1');
    expect(mockDoc.update).toHaveBeenCalledWith({
      data: {
        name: '赵六',
        playStyle: 'moon-queen',
        updateTime: mockState.serverDate
      }
    });
  });
});
