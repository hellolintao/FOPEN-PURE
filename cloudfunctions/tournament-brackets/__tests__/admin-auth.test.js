let mockState

function mockChain(data = []) {
  return {
    get: jest.fn(async () => ({ data })),
    limit: jest.fn(function () { return this }),
    orderBy: jest.fn(function () { return this }),
  }
}

jest.mock('wx-server-sdk', () => {
  const db = {
    command: {
      or: jest.fn(conditions => ({ $or: conditions })),
      in: jest.fn(values => ({ $in: values })),
      set: jest.fn(value => value),
    },
    serverDate: jest.fn(() => 'SERVER_DATE'),
    collection: jest.fn(name => {
      if (name === 'members') {
        return { where: jest.fn(() => mockChain(mockState.member ? [mockState.member] : [])) }
      }
      return {
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({ data: null })),
          update: jest.fn(async () => ({ updated: 1 })),
          remove: jest.fn(async () => ({ removed: 1 })),
        })),
        where: jest.fn(() => mockChain([])),
        add: jest.fn(async ({ data }) => ({ _id: data && data._id })),
      }
    }),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
    database: jest.fn(() => db),
  }
})

const { main } = require('../index')

beforeEach(() => {
  mockState = {
    openid: 'member-openid',
    member: { _id: 'member1', openid: 'member-openid', admin: false },
  }
})

test.each([
  ['add', {
    data: {
      tournamentId: 't1',
      round: 1,
      type: 'singles',
      matches: [{ matchId: 'm1', position: 1, player1: null, player2: null }]
    }
  }],
  ['update', {
    id: 'bracket-1',
    data: {
      tournamentId: 't1',
      round: 1,
      type: 'singles',
      matches: [{ matchId: 'm1', position: 1, player1: null, player2: null }]
    }
  }],
  ['delete', { id: 'bracket-1' }],
  ['updateMatch', { id: 'bracket-1', matchId: 'm1', data: { match: { status: 'ongoing' } } }],
  ['updateMatchScore', { id: 'bracket-1', matchId: 'm1', data: { winner: { id: 'p1', name: 'P1' }, score: '6-4', status: 'completed' } }],
  ['updateMatchStatus', { id: 'bracket-1', matchId: 'm1', data: { status: 'ongoing', courtId: 'court-1' } }],
  ['saveInitialMatches', { tournamentId: 't1', matches: [{ matchId: 'm1', round: 1, position: 1 }] }],
  ['saveSchedule', { tournamentId: 't1', queues: [] }],
  ['regenerateDraft', { tournamentId: 't1' }],
])('%s requires admin', async (action, payload) => {
  const res = await main({ action, ...payload })

  expect(res).toEqual({
    success: false,
    error: { code: 'FORBIDDEN', message: '需要管理员权限' },
  })
})

test.each([
  ['add', {
    data: {
      tournamentId: 't1',
      round: 1,
      type: 'singles',
      matches: [{ matchId: 'm1', position: 1, player1: null, player2: null }]
    }
  }],
  ['update', {
    id: 'bracket-1',
    data: {
      tournamentId: 't1',
      round: 1,
      type: 'singles',
      matches: [{ matchId: 'm1', position: 1, player1: null, player2: null }]
    }
  }],
  ['delete', { id: 'bracket-1' }],
  ['updateMatch', { id: 'bracket-1', matchId: 'm1', data: { match: { status: 'ongoing' } } }],
  ['updateMatchScore', { id: 'bracket-1', matchId: 'm1', data: { winner: { id: 'p1', name: 'P1' }, score: '6-4', status: 'completed' } }],
  ['updateMatchStatus', { id: 'bracket-1', matchId: 'm1', data: { status: 'ongoing', courtId: 'court-1' } }],
  ['saveInitialMatches', { tournamentId: 't1', matches: [{ matchId: 'm1', round: 1, position: 1 }] }],
  ['saveSchedule', { tournamentId: 't1', queues: [] }],
  ['regenerateDraft', { tournamentId: 't1' }],
])('%s allows admin past auth gate', async (action, payload) => {
  mockState.member = { ...mockState.member, admin: true }

  const res = await main({ action, ...payload })

  expect(res).not.toEqual({
    success: false,
    error: { code: 'FORBIDDEN', message: '需要管理员权限' },
  })
})
