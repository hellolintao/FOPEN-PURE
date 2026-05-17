jest.mock('wx-server-sdk', () => {
  const db = {
    command: {},
    collection: jest.fn(() => ({})),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
  }
})

const { __test__ } = require('../index')

test('validateBracket accepts mixed bracket document type', () => {
  const errors = __test__.validateBracket({
    tournamentId: 'T1',
    round: 1,
    type: 'mixed',
    matches: [{
      matchId: 'm1',
      position: 1,
      player1: { id: 'A' },
      player2: { id: 'B' },
      status: 'pending'
    }]
  })

  expect(errors).toEqual([])
})
