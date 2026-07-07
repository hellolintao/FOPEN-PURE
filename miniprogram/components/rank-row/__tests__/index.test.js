const fs = require('fs')
const path = require('path')

function loadComponent() {
  jest.resetModules()
  let componentDef
  global.Component = (def) => { componentDef = def }
  require('../index')
  return componentDef
}

afterEach(() => {
  delete global.Component
})

test('rank-row exposes trendState and trendLabel properties', () => {
  const def = loadComponent()
  expect(def.properties.trendState).toBeTruthy()
  expect(def.properties.trendLabel).toBeTruthy()
})

test('rank-row template renders explicit trendLabel', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('{{trendLabel}}')
  expect(wxml).toContain('trendState')
})
