let def
global.Component = (d) => { def = d }
require('../index')

function makeCtx(initialData = {}) {
  const ctx = {
    properties: { visible: false, title: '', mode: 'confirm', items: [], result: null },
    data: { stateName: 'closed', autoCloseTimer: null, ...initialData },
    triggerEvent: jest.fn(),
    setData: jest.fn(function (d) { Object.assign(this.data, d) }),
  }
  return ctx
}

test('observer "visible:false → state closed"', () => {
  const ctx = makeCtx()
  def.observers['visible'].call(ctx, false)
  expect(ctx.data.stateName).toBe('closed')
})

test('observer "visible:true with items → state previewing"', () => {
  const ctx = makeCtx()
  ctx.properties.items = [{ matchId: 'm1' }]
  ctx.properties.result = null
  def.observers['visible'].call(ctx, true)
  expect(ctx.data.stateName).toBe('previewing')
})

test('observer "result has failures → state result"', () => {
  const ctx = makeCtx({ stateName: 'submitting' })
  ctx.properties.visible = true
  ctx.properties.result = { successIds: ['a'], failures: [{ matchId: 'b', code: 'CLOUD_TIMEOUT', retryable: true }] }
  def.observers['result'].call(ctx, ctx.properties.result)
  expect(ctx.data.stateName).toBe('result')
})

test('observer "result all-ok schedules auto-close timer"', () => {
  jest.useFakeTimers()
  const ctx = makeCtx({ stateName: 'submitting' })
  ctx.properties.visible = true
  ctx.properties.result = { successIds: ['a', 'b'], failures: [] }
  def.observers['result'].call(ctx, ctx.properties.result)
  expect(ctx.data.stateName).toBe('result')
  expect(ctx.data.autoCloseTimer).toBeTruthy()
  jest.advanceTimersByTime(3000)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('close', { reason: 'all-ok' })
  jest.useRealTimers()
})

test('onCommit emits commit with matchIds', () => {
  const ctx = makeCtx()
  ctx.properties.items = [{ matchId: 'a' }, { matchId: 'b' }]
  def.methods.onCommit.call(ctx)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('commit', { matchIds: ['a', 'b'] })
  expect(ctx.data.stateName).toBe('submitting')
})

test('onCommit blocked when stateName=submitting (avoid duplicate)', () => {
  const ctx = makeCtx({ stateName: 'submitting' })
  ctx.properties.items = [{ matchId: 'a' }]
  def.methods.onCommit.call(ctx)
  expect(ctx.triggerEvent).not.toHaveBeenCalled()
})

test('onRetry emits retry with retryable failureIds only', () => {
  const ctx = makeCtx({ stateName: 'result' })
  ctx.properties.result = { successIds: [], failures: [
    { matchId: 'a', retryable: true }, { matchId: 'b', retryable: false },
  ] }
  def.methods.onRetry.call(ctx)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('retry', { failureIds: ['a'] })
})

test('onClose clears auto-close timer', () => {
  jest.useFakeTimers()
  const ctx = makeCtx({ stateName: 'result', autoCloseTimer: setTimeout(() => {}, 5000) })
  def.methods.onClose.call(ctx)
  expect(ctx.data.autoCloseTimer).toBe(null)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('close', { reason: 'manual' })
  jest.useRealTimers()
})

test('detached lifecycle clears timer', () => {
  jest.useFakeTimers()
  const ctx = makeCtx({ stateName: 'result', autoCloseTimer: setTimeout(() => {}, 5000) })
  def.lifetimes.detached.call(ctx)
  expect(ctx.data.autoCloseTimer).toBe(null)
  jest.useRealTimers()
})

test('onEditRow emits editrow with matchId', () => {
  const ctx = makeCtx({ stateName: 'previewing' })
  def.methods.onEditRow.call(ctx, { currentTarget: { dataset: { matchid: 'm1' } } })
  expect(ctx.triggerEvent).toHaveBeenCalledWith('editrow', { matchId: 'm1' })
})

test('template renders analytics message and settlement impact', () => {
  const fs = require('fs')
  const path = require('path')
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('analyticsMessage')
  expect(wxml).toContain('settlementImpact')
  expect(wxml).toContain('wx:key="impactKey"')
  expect(wxml).toContain("{{item.typeLabel || item.type || ''}}")
})
