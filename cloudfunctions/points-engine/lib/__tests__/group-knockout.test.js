const { buildGroupKnockoutPointEntries } = require('../group-knockout')

function groupRow(player1, player2, winnerId) {
  return {
    _id: `g_${player1}_${player2}`,
    stage: 'group',
    matchKind: 'group',
    resultStatus: 'confirmed',
    player1: { id: player1 },
    player2: { id: player2 },
    winner: { id: winnerId }
  }
}

function koRow(round, player1, player2, winnerId) {
  return {
    _id: `k_${round}_${player1}_${player2}`,
    stage: 'knockout',
    matchKind: 'bracket',
    round,
    resultStatus: 'confirmed',
    player1: { id: player1 },
    player2: { id: player2 },
    winner: { id: winnerId }
  }
}

function byMember(entries) {
  return Object.fromEntries(entries.map(entry => [entry.memberId, entry]))
}

describe('buildGroupKnockoutPointEntries', () => {
  test('16 sign awards placement to top 8 and group points to non-qualifiers only', () => {
    const rows = [
      groupRow('a1', 'a3', 'a1'),
      groupRow('a2', 'a4', 'a2'),
      groupRow('c2', 'c4', 'c2'),
      koRow(1, 'a1', 'c2', 'a1'),
      koRow(1, 'b1', 'd2', 'b1'),
      koRow(1, 'c1', 'a2', 'a2'),
      koRow(1, 'd1', 'b2', 'd1'),
      koRow(2, 'a1', 'b1', 'a1'),
      koRow(2, 'a2', 'd1', 'd1'),
      koRow(3, 'a1', 'd1', 'a1')
    ]

    const entries = byMember(buildGroupKnockoutPointEntries({ tournament: { bracketSize: 16 }, rows }))

    expect(entries.a1).toMatchObject({ rank: 'champion', points: 500 })
    expect(entries.d1).toMatchObject({ rank: 'runnerUp', points: 350 })
    expect(entries.b1).toMatchObject({ rank: 'semifinal', points: 250 })
    expect(entries.a2).toMatchObject({ rank: 'semifinal', points: 250 })
    expect(entries.c2).toMatchObject({ rank: 'quarterfinal', points: 180 })
    expect(entries.c2.points).toBe(180)
    expect(entries.a3).toMatchObject({ rank: 'group', points: 25 })
    expect(entries.a4).toMatchObject({ rank: 'group', points: 25 })
    expect(entries.c4).toMatchObject({ rank: 'group', points: 25 })
  })

  test('12 sign awards 250/150/100/65 placement and 20/10 group points', () => {
    const rows = [
      groupRow('a1', 'a2', 'a1'), groupRow('a1', 'a3', 'a1'), groupRow('a2', 'a3', 'a2'),
      groupRow('b1', 'b2', 'b1'), groupRow('b1', 'b3', 'b1'), groupRow('b2', 'b3', 'b2'),
      groupRow('c1', 'c2', 'c1'), groupRow('c1', 'c3', 'c1'), groupRow('c2', 'c3', 'c2'),
      groupRow('d1', 'd2', 'd1'), groupRow('d1', 'd3', 'd1'), groupRow('d2', 'd3', 'd2'),
      koRow(1, 'a1', 'c2', 'a1'),
      koRow(1, 'b1', 'd2', 'b1'),
      koRow(1, 'c1', 'a2', 'c1'),
      koRow(1, 'd1', 'b2', 'd1'),
      koRow(2, 'a1', 'b1', 'a1'),
      koRow(2, 'c1', 'd1', 'c1'),
      koRow(3, 'a1', 'c1', 'a1')
    ]

    const entries = byMember(buildGroupKnockoutPointEntries({ tournament: { bracketSize: 12 }, rows }))

    expect(entries.a1).toMatchObject({ rank: 'champion', points: 250 })
    expect(entries.c1).toMatchObject({ rank: 'runnerUp', points: 150 })
    expect(entries.b1).toMatchObject({ rank: 'semifinal', points: 100 })
    expect(entries.a2).toMatchObject({ rank: 'quarterfinal', points: 65 })
    expect(entries.a3).toMatchObject({ rank: 'group', points: 20 })
    expect(entries.b3).toMatchObject({ rank: 'group', points: 20 })
  })

  test('uses tournament pointsRules.groupKnockout override for bracket size', () => {
    const rows = [
      groupRow('a1', 'a3', 'a1'),
      koRow(1, 'a1', 'c2', 'a1'),
      koRow(2, 'a1', 'b1', 'a1'),
      koRow(3, 'a1', 'd1', 'a1')
    ]
    const tournament = {
      bracketSize: 16,
      pointsRules: {
        groupKnockout: {
          16: {
            placement: { champion: 900, runnerUp: 700, semifinal: 500, quarterfinal: 300 },
            group: { win: 90, loss: 45 }
          }
        }
      }
    }

    const entries = byMember(buildGroupKnockoutPointEntries({ tournament, rows }))

    expect(entries.a1).toMatchObject({ rank: 'champion', points: 900 })
    expect(entries.d1).toMatchObject({ rank: 'runnerUp', points: 700 })
    expect(entries.a3).toMatchObject({ rank: 'group', points: 45 })
  })
})
