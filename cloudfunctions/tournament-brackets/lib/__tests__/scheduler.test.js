const {
  assignToCourts,
  assignToCourtsWithOverflow,
  buildRegularSchedule,
  generateBalancedRegularMatches
} = require('../scheduler')

function court(id, slotCount) {
  return { courtId: id, name: id, location: '主馆', slots: Array.from({ length: slotCount }, (_, i) => `2026-05-25T19:${(i * 30).toString().padStart(2, '0')}`) }
}

function match(id) {
  return { matchId: id, kind: 'match', sourceMatchId: id }
}

function reg(ids) {
  return ids.map(id => ({ playerId: id, playerName: id, registrationId: `reg_${id}` }))
}

describe('assignToCourts · 顺序填满', () => {
  test('4 场 / 3 场地容量 2/2/2 → court[0]=2, court[1]=2, court[2]=0', () => {
    const matches = ['m1', 'm2', 'm3', 'm4'].map(match)
    const courts = [court('c1', 2), court('c2', 2), court('c3', 2)]
    const queues = assignToCourts(matches, courts)
    expect(queues).toHaveLength(3)
    expect(queues[0].items).toHaveLength(2)
    expect(queues[1].items).toHaveLength(2)
    expect(queues[2].items).toHaveLength(0)
  })

  test('4 场 / 3 场地容量 1/2/3 → court[0]=1, court[1]=2, court[2]=1', () => {
    const matches = ['m1', 'm2', 'm3', 'm4'].map(match)
    const courts = [court('c1', 1), court('c2', 2), court('c3', 3)]
    const queues = assignToCourts(matches, courts)
    expect(queues[0].items).toHaveLength(1)
    expect(queues[1].items).toHaveLength(2)
    expect(queues[2].items).toHaveLength(1)
  })

  test('5 场 / 3 场地容量 1/1/1 → 2 场溢出（返回 unscheduled）', () => {
    const matches = ['m1', 'm2', 'm3', 'm4', 'm5'].map(match)
    const courts = [court('c1', 1), court('c2', 1), court('c3', 1)]
    const { queues, unscheduled } = assignToCourtsWithOverflow(matches, courts)
    expect(unscheduled.map(m => m.matchId)).toEqual(['m4', 'm5'])
    expect(queues[0].items).toHaveLength(1)
    expect(queues[1].items).toHaveLength(1)
    expect(queues[2].items).toHaveLength(1)
  })

  test('0 场地 → 全部 unscheduled', () => {
    const matches = ['m1', 'm2'].map(match)
    const { queues, unscheduled } = assignToCourtsWithOverflow(matches, [])
    expect(unscheduled).toHaveLength(2)
    expect(queues).toEqual([])
  })

  test('0 场比赛 → 全部空 queue', () => {
    const courts = [court('c1', 2), court('c2', 2)]
    const queues = assignToCourts([], courts)
    expect(queues).toHaveLength(2)
    queues.forEach(q => expect(q.items).toEqual([]))
  })

  test('保留 order 字段 0-based 局内', () => {
    const matches = ['m1', 'm2', 'm3'].map(match)
    const courts = [court('c1', 2), court('c2', 2)]
    const queues = assignToCourts(matches, courts)
    expect(queues[0].items[0]).toEqual(expect.objectContaining({ kind: 'match', matchId: 'm1', order: 0 }))
    expect(queues[0].items[1]).toEqual(expect.objectContaining({ kind: 'match', matchId: 'm2', order: 1 }))
    expect(queues[1].items[0]).toEqual(expect.objectContaining({ matchId: 'm3', order: 0 }))
  })
})

describe('buildRegularSchedule · 常规赛填满日程', () => {
  test('1 球场 / 2 小时 → 每小时 2 场比赛 + 1 个自由拉球', () => {
    const courts = [{
      courtId: 'c1',
      name: '1 号场',
      slots: [
        '2026-05-25T08:00',
        '2026-05-25T08:20',
        '2026-05-25T08:40',
        '2026-05-25T09:00',
        '2026-05-25T09:20',
        '2026-05-25T09:40'
      ]
    }]
    const { matches, queues, freePlays } = buildRegularSchedule({
      registrations: reg(['p1', 'p2', 'p3', 'p4']),
      courts,
      type: 'singles',
      now: 123
    })

    expect(matches).toHaveLength(4)
    expect(freePlays).toHaveLength(2)
    expect(matches.every(m => m.matchKind === 'regularRound')).toBe(true)
    expect(queues[0].items.map(it => it.kind)).toEqual([
      'match',
      'match',
      'freePlay',
      'match',
      'match',
      'freePlay'
    ])
    expect(freePlays.map(fp => fp.queueOrder)).toEqual([2, 5])
  })

  test('混合常规赛：1 小时 → 单打 + 双打 + 自由拉球', () => {
    const courts = [{
      courtId: 'c1',
      name: '1 号场',
      slots: [
        '2026-05-25T08:00',
        '2026-05-25T08:20',
        '2026-05-25T08:40'
      ]
    }]
    const { matches, queues, freePlays } = buildRegularSchedule({
      registrations: reg(['p1', 'p2', 'p3', 'p4']),
      courts,
      type: 'mixed',
      now: 789
    })

    expect(matches).toHaveLength(2)
    expect(matches.map(m => m.type)).toEqual(['singles', 'doubles'])
    expect(matches[0].player1.partnerId).toBeUndefined()
    expect(matches[1].player1.partnerId).toBeDefined()
    expect(matches[1].player2.partnerId).toBeDefined()
    expect(freePlays).toHaveLength(1)
    expect(queues[0].items.map(it => it.kind)).toEqual(['match', 'match', 'freePlay'])
  })

  test('混合常规赛：2 小时 → 每小时重复单打 + 双打 + 自由拉球', () => {
    const courts = [{
      courtId: 'c1',
      name: '1 号场',
      slots: [
        '2026-05-25T08:00',
        '2026-05-25T08:20',
        '2026-05-25T08:40',
        '2026-05-25T09:00',
        '2026-05-25T09:20',
        '2026-05-25T09:40'
      ]
    }]
    const { matches, queues, freePlays } = buildRegularSchedule({
      registrations: reg(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']),
      courts,
      type: 'mixed',
      now: 790
    })

    expect(matches.map(m => m.type)).toEqual(['singles', 'doubles', 'singles', 'doubles'])
    expect(freePlays.map(fp => fp.queueOrder)).toEqual([2, 5])
    expect(queues[0].items.map(it => it.kind)).toEqual([
      'match',
      'match',
      'freePlay',
      'match',
      'match',
      'freePlay'
    ])
  })

  test('随机常规赛在有可行选择时避免重复对阵和同一时段选手冲突', () => {
    withMockedRandom(0, () => {
      const courts = [
        {
          courtId: 'c1',
          name: '1 号场',
          slots: ['2026-05-25T08:00', '2026-05-25T08:20']
        },
        {
          courtId: 'c2',
          name: '2 号场',
          slots: ['2026-05-25T08:00', '2026-05-25T08:20']
        }
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

  test('平衡配对让每位选手场次差不超过 1', () => {
    const matches = generateBalancedRegularMatches({
      registrations: reg(['p1', 'p2', 'p3', 'p4', 'p5']),
      matchCount: 13,
      type: 'singles',
      now: 456
    })
    const counts = {}
    matches.forEach(m => {
      counts[m.player1.id] = (counts[m.player1.id] || 0) + 1
      counts[m.player2.id] = (counts[m.player2.id] || 0) + 1
    })
    const values = Object.values(counts)
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
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
