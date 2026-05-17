jest.mock('wx-server-sdk', () => {
  const db = {
    collection: jest.fn(() => ({})),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
  }
}, { virtual: true })

const { __test__ } = require('../index')

test('validateRegistration accepts mixed personal registration', () => {
  const errors = __test__.validateRegistration({
    tournamentId: 'T1',
    seasonId: 'S1',
    type: 'mixed',
    playerId: 'A',
    playerName: 'Alice'
  })

  expect(errors).toEqual([])
})
