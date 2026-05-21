let mockState

function mockChainableQuery(data = []) {
  const query = {
    get: jest.fn(async () => ({ data })),
    count: jest.fn(async () => ({ total: data.length })),
    orderBy: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
  }
  return query
}

jest.mock('wx-server-sdk', () => {
  const command = {
    or: conditions => ({ $or: conditions }),
    and: conditions => ({ $and: conditions }),
    in: values => ({ $in: values }),
    neq: value => ({ $neq: value }),
    gt: value => ({ $gt: value }),
  }

  function collection(name) {
    if (name === 'match_results') {
      return {
        doc: id => ({
          get: jest.fn(async () => ({ data: mockState.rows[id] || null })),
        }),
        where: jest.fn(() => mockChainableQuery([])),
      }
    }

    if (name === 'tournaments') {
      return {
        doc: id => ({
          get: jest.fn(async () => ({ data: mockState.tournaments[id] || null })),
        }),
        where: jest.fn(() => mockChainableQuery([])),
      }
    }

    if (name === 'members') {
      return {
        where: jest.fn(() => mockChainableQuery(mockState.member ? [mockState.member] : [])),
      }
    }

    return {
      doc: () => ({ get: jest.fn(async () => ({ data: null })) }),
      where: jest.fn(() => mockChainableQuery([])),
    }
  }

  const db = {
    command,
    collection: jest.fn(collection),
    serverDate: jest.fn(() => 'server-date'),
    RegExp: jest.fn(options => options),
  }

  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
    getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
  }
})

const { main } = require('../index')

function setState({ scheduleStatus, isAdmin = false }) {
  const tournament = { _id: 't1' }
  if (scheduleStatus !== 'missing') tournament.scheduleStatus = scheduleStatus
  mockState = {
    openid: isAdmin ? 'admin-openid' : 'member-openid',
    member: { _id: isAdmin ? 'admin1' : 'member1', openid: isAdmin ? 'admin-openid' : 'member-openid', isAdmin },
    rows: {
      r1: { _id: 'r1', tournamentId: 't1', resultStatus: 'pending' },
    },
    tournaments: { t1: tournament },
  }
}

describe('direct get schedule visibility gate', () => {
  test.each([
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 'draft' },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: 'draft' },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 'none' },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: 'none' },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: null },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: '' },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 'ready' },
    { action: 'getById', payload: { id: 'r1' }, scheduleStatus: false },
    { action: 'get', payload: { id: 'r1' }, scheduleStatus: 0 },
  ])('blocks non-admin $action when scheduleStatus is $scheduleStatus', async ({ action, payload, scheduleStatus }) => {
    setState({ scheduleStatus })

    const res = await main({ action, ...payload })

    expect(res).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: '赛程发布后才能录入成绩' },
    })
  })

  test.each([
    ['missing'],
    ['published'],
  ])('allows non-admin direct get when scheduleStatus is %s', async (scheduleStatus) => {
    setState({ scheduleStatus })

    const res = await main({ action: 'get', id: 'r1' })

    expect(res).toEqual({ data: mockState.rows.r1 })
  })

  test('allows admin direct get when scheduleStatus is draft', async () => {
    setState({ scheduleStatus: 'draft', isAdmin: true })

    const res = await main({ action: 'getById', id: 'r1' })

    expect(res).toEqual({ data: mockState.rows.r1 })
  })
})
