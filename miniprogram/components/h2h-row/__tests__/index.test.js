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
