const fs = require('fs')
const path = require('path')

function loadComponent() {
  jest.resetModules()
  let componentDef
  global.Component = (def) => { componentDef = def }
  require('../index')
  return componentDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { playerId: '', wins: 0, losses: 0, ...def.data, ...data },
    setData(patch) {
      Object.assign(this.data, patch)
    },
    triggerEvent: jest.fn(),
  }
}

afterEach(() => {
  delete global.Component
})

test('onTap emits the player id so the whole H2H row remains navigable', () => {
  const def = loadComponent()
  const ctx = makeCtx(def, { playerId: 'B' })

  def.methods.onTap.call(ctx)

  expect(ctx.triggerEvent).toHaveBeenCalledWith('tap', { playerId: 'B' })
})

test('template keeps row tap binding without rendering a right arrow icon', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

  expect(wxml).toContain('bindtap="onTap"')
  expect(wxml).not.toMatch(/class=["']arrow["']|>→<\/text>|>➡️<\/text>/)
})

test('component supports team-vs-team labels and expanded recent matches', () => {
  const def = loadComponent()

  expect(def.properties.subjectTeamLabel).toBeTruthy()
  expect(def.properties.opponentTeamLabel).toBeTruthy()
  expect(def.properties.teamKey).toBeTruthy()
  expect(def.properties.recentMatches).toBeTruthy()
})

test('template renders subject and opponent team labels', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

  expect(wxml).toContain('{{subjectTeamLabel}}')
  expect(wxml).toContain('{{opponentTeamLabel}}')
  expect(wxml).toContain('recentMatches')
})

test('team rows emit toggle key instead of player navigation', () => {
  const def = loadComponent()
  const ctx = makeCtx(def, {
    playerId: 'B',
    subjectTeamLabel: '自己 / 队友',
    opponentTeamLabel: '对手1 / 对手2',
  })

  def.methods.onTap.call(ctx)

  expect(ctx.triggerEvent).toHaveBeenCalledWith('toggle', {
    key: '自己 / 队友|对手1 / 对手2',
  })
  expect(ctx.triggerEvent).not.toHaveBeenCalledWith('tap', { playerId: 'B' })
})

test('team rows emit provided stable team key when available', () => {
  const def = loadComponent()
  const ctx = makeCtx(def, {
    subjectTeamLabel: '自己 / 队友',
    opponentTeamLabel: '对手1 / 对手2',
    teamKey: 'team-key',
  })

  def.methods.onTap.call(ctx)

  expect(ctx.triggerEvent).toHaveBeenCalledWith('toggle', { key: 'team-key' })
})
