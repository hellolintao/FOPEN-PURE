const { sideMembers, sideHasMember, opponentSide, teamLabel, resultRoleForMember } = require('../teams')

const doublesRow = {
  player1: { id: 'A', name: '乐乐', partnerId: 'B', partnerName: '小野马' },
  player2: { id: 'C', name: '小天', partnerId: 'D', partnerName: '标子' },
  pointsAwarded: {
    entries: [
      { memberId: 'A', role: 'winner' },
      { memberId: 'B', role: 'winner' },
      { memberId: 'C', role: 'loser' },
      { memberId: 'D', role: 'loser' }
    ]
  }
}

test('sideMembers extracts primary and partner members', () => {
  expect(sideMembers(doublesRow.player1)).toEqual([
    { memberId: 'A', name: '乐乐' },
    { memberId: 'B', name: '小野马' }
  ])
})

test('opponentSide returns the other doubles side', () => {
  expect(teamLabel(sideMembers(opponentSide(doublesRow, 'A')))).toBe('小天 / 标子')
})

test('resultRoleForMember reads pointsAwarded role', () => {
  expect(resultRoleForMember(doublesRow, 'A')).toBe('winner')
  expect(resultRoleForMember(doublesRow, 'D')).toBe('loser')
  expect(resultRoleForMember(doublesRow, 'X')).toBe(null)
})

test('sideHasMember detects primary and partner ids', () => {
  expect(sideHasMember(doublesRow.player1, 'A')).toBe(true)
  expect(sideHasMember(doublesRow.player1, 'B')).toBe(true)
  expect(sideHasMember(doublesRow.player1, 'C')).toBe(false)
})
