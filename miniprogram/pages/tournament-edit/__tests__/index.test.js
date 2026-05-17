function loadPage() {
  jest.resetModules()
  let pageDef
  const app = { globalData: {} }
  global.wx = {
    showToast: jest.fn(),
    showModal: jest.fn(),
    navigateBack: jest.fn(),
    cloud: { callFunction: jest.fn() }
  }
  global.getApp = () => app
  global.Page = def => { pageDef = def }
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  const ctx = {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) {
      Object.keys(patch).forEach(key => {
        if (!key.includes('.')) {
          this.data[key] = patch[key]
          return
        }
        const parts = key.split('.')
        let cur = this.data
        for (let i = 0; i < parts.length - 1; i += 1) cur = cur[parts[i]]
        cur[parts[parts.length - 1]] = patch[key]
      })
    }
  }
  Object.assign(ctx.data, data)
  return ctx
}

const players = [
  { playerId: 'p1', playerName: 'A' },
  { playerId: 'p2', playerName: 'B' },
  { playerId: 'p3', playerName: 'C' },
  { playerId: 'p4', playerName: 'D' },
]

describe('tournament-edit mixed regular flow', () => {
  test('regular tournament defaults to mixed', () => {
    const def = loadPage()

    expect(def.data.form.format).toBe('regular')
    expect(def.data.form.type).toBe('mixed')
  })

  test('switching format to knockout moves mixed type back to singles', () => {
    const def = loadPage()
    const ctx = makeCtx(def)

    ctx.onChipTap({ currentTarget: { dataset: { k: 'format', v: 'knockout' } } })

    expect(ctx.data.form.format).toBe('knockout')
    expect(ctx.data.form.type).toBe('singles')
  })

  test('mixed type is blocked for knockout tournaments', () => {
    const def = loadPage()
    const ctx = makeCtx(def, { form: { ...def.data.form, format: 'knockout', type: 'singles' } })

    ctx.onChipTap({ currentTarget: { dataset: { k: 'type', v: 'mixed' } } })

    expect(ctx.data.form.type).toBe('singles')
    expect(wx.showToast).toHaveBeenCalledWith({ title: '淘汰赛不支持混合', icon: 'none' })
  })

  test('mixed regular default schedule alternates singles, doubles, free play each hour', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      selectedPlayers: players,
      schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-17T08:00', '2026-05-17T08:20', '2026-05-17T08:40'] }]
    })

    ctx.applyDefaultSchedule()

    const queue = ctx.data.queues[0]
    expect(queue.items.map(item => item.kind)).toEqual(['match', 'match', 'freePlay'])
    expect(ctx.data.matches.map(match => match.type)).toEqual(['singles', 'doubles'])
    expect(ctx.data.freePlays).toHaveLength(1)
    expect(ctx.regularScheduleNeedsBuild()).toBe(false)
  })

  test('mixed regular schedule rebuilds when match type pattern is stale', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      matches: [
        { matchId: 'm1', type: 'singles' },
        { matchId: 'm2', type: 'singles' },
      ],
      queues: [{
        courtId: 'c1',
        items: [
          { kind: 'match', matchId: 'm1', order: 0 },
          { kind: 'match', matchId: 'm2', order: 1 },
          { kind: 'freePlay', matchId: 'fp1', order: 2 },
        ]
      }],
      schedulePlanCourts: [{ courtId: 'c1', slots: ['T08:00', 'T08:20', 'T08:40'] }]
    })

    expect(ctx.regularScheduleNeedsBuild()).toBe(true)
  })

  test('mixed tournaments require at least four players', () => {
    const def = loadPage()
    const ctx = makeCtx(def)

    expect(ctx._minPlayers()).toBe(4)
  })
})
