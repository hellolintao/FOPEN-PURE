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

test('rank-row defaults no-history trend copy to dash', () => {
  const def = loadComponent()
  expect(def.properties.trendState.value).toBe('no_history')
  expect(def.properties.trendLabel.value).toBe('-')
})

test('rank-row exposes an optional avatarUrl property', () => {
  const def = loadComponent()
  expect(def.properties.avatarUrl).toBeTruthy()
})

test('rank-row template renders explicit trendLabel', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('{{trendLabel}}')
  expect(wxml).toContain('trendState')
})

test('rank-row template renders avatar image only when avatarUrl exists', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('wx:if="{{avatarUrl}}"')
  expect(wxml).toContain('src="{{avatarUrl}}"')
  expect(wxml).not.toContain('default-avatar.png')
})

test('rank-row styles use enlarged avatar and roomier row spacing', () => {
  const wxss = fs.readFileSync(path.join(__dirname, '../index.wxss'), 'utf8')
  expect(wxss).toMatch(/\.player-avatar\s*{[\s\S]*width:\s*66rpx;[\s\S]*height:\s*66rpx;[\s\S]*margin-right:\s*18rpx;/)
  expect(wxss).toContain('padding: 24rpx 24rpx;')
  expect(wxss).toMatch(/\.rank-row\.highlight-pride\s*{[\s\S]*margin:\s*10rpx 0;[\s\S]*padding-top:\s*26rpx;[\s\S]*padding-bottom:\s*26rpx;/)
})
