const { buildRegularSchedule } = require('../scheduler-mirror')

function reg(ids) {
  return ids.map(id => ({ playerId: id, playerName: id, registrationId: `reg_${id}` }))
}

test('frontend regular schedule mirror avoids duplicate pairs and same-slot player conflicts when possible', () => {
  withMockedRandom(0, () => {
    const courts = [
      { courtId: 'c1', slots: ['2026-05-25T08:00', '2026-05-25T08:20'] },
      { courtId: 'c2', slots: ['2026-05-25T08:00', '2026-05-25T08:20'] }
    ]
    const { matches, queues } = buildRegularSchedule({
      registrations: reg(['p1', 'p2', 'p3', 'p4']),
      courts,
      type: 'singles',
      now: 791
    })

    expect(matches).toHaveLength(4)
    expect(new Set(matches.map(matchPairKey)).size).toBe(matches.length)

    const matchesById = new Map(matches.map(match => [match.matchId, match]))
    for (const slot of ['2026-05-25T08:00', '2026-05-25T08:20']) {
      const ids = []
      courts.forEach(court => {
        const order = court.slots.indexOf(slot)
        const queue = queues.find(q => q.courtId === court.courtId)
        const item = queue.items.find(it => it.order === order)
        ids.push(...matchPlayerIds(matchesById.get(item.matchId)))
      })
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

function withMockedRandom(value, fn) {
  const spy = jest.spyOn(Math, 'random').mockReturnValue(value)
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
}

function matchPairKey(match) {
  return matchPlayerIds(match).sort().join('|')
}

function matchPlayerIds(match) {
  const ids = []
  const push = player => {
    if (!player || !player.id || player.id === 'BYE') return
    ids.push(player.id)
    if (player.partnerId) ids.push(player.partnerId)
  }
  push(match && match.player1)
  push(match && match.player2)
  return ids
}
