// Mock global wx before requiring cloud.js
const callMock = jest.fn()
global.wx = { cloud: { callFunction: callMock } }

// Mock dependent modules required by cloud.js
jest.mock('../../config', () => ({ USE_MOCK: false, MOCK_SCENARIO: 'success' }))
jest.mock('../../mock/index', () => ({ callMockFunction: jest.fn() }))

const { call } = require('../cloud')

beforeEach(() => { callMock.mockReset() })

test('call returns ok=true with data on success envelope', async () => {
  callMock.mockResolvedValueOnce({ result: { success: true, data: { foo: 1 } } })
  const res = await call('match-results', { action: 'mySummary', payload: {} })
  expect(res.ok).toBe(true)
  expect(res.data).toEqual({ foo: 1 })
  expect(res.traceId).toBeDefined()
})

test('call returns ok=false when envelope success:false', async () => {
  callMock.mockResolvedValueOnce({ result: { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } } })
  const res = await call('tournaments', { action: 'adminConsoleSnapshot', payload: {} })
  expect(res.ok).toBe(false)
  expect(res.error.code).toBe('FORBIDDEN')
  expect(res.error.message).toBe('需要管理员权限')
})

test('call returns ok=false with INVALID_ENVELOPE when cloud returns non-envelope', async () => {
  callMock.mockResolvedValueOnce({ result: { foo: 'bar' } })
  const res = await call('x', {})
  expect(res.ok).toBe(false)
  expect(res.error.code).toBe('INVALID_ENVELOPE')
})

test('call never throws on wx.cloud.callFunction error', async () => {
  callMock.mockRejectedValueOnce({ errMsg: 'cloud.callFunction:fail timeout' })
  const res = await call('x', {})
  expect(res.ok).toBe(false)
  expect(res.error.code).toBe('TIMEOUT')
  expect(res.error.retryable).toBe(true)
})

test('call classifies network errors', async () => {
  callMock.mockRejectedValueOnce({ errMsg: 'cloud.callFunction:fail network error' })
  const res = await call('x', {})
  expect(res.error.code).toBe('NETWORK')
  expect(res.error.retryable).toBe(true)
})

test('call calls onLoading(true) before request and onLoading(false) after', async () => {
  callMock.mockResolvedValueOnce({ result: { success: true, data: {} } })
  const loading = jest.fn()
  await call('x', {}, { onLoading: loading })
  expect(loading).toHaveBeenNthCalledWith(1, true)
  expect(loading).toHaveBeenNthCalledWith(2, false)
})

test('call generates unique traceId per call', async () => {
  callMock.mockResolvedValue({ result: { success: true, data: {} } })
  const a = await call('x', {})
  const b = await call('x', {})
  expect(a.traceId).not.toBe(b.traceId)
})

test('call passes payload through to wx.cloud.callFunction', async () => {
  callMock.mockResolvedValueOnce({ result: { success: true, data: {} } })
  await call('match-results', { action: 'batchConfirm', payload: { matches: [], requestId: 'req_x' } })
  expect(callMock).toHaveBeenCalledWith(expect.objectContaining({
    name: 'match-results',
    data: { action: 'batchConfirm', payload: { matches: [], requestId: 'req_x' } },
  }))
})

test('cloud module does not load mock code when USE_MOCK is false', async () => {
  jest.resetModules()
  const nativeCall = jest.fn().mockResolvedValue({ result: { ok: true } })
  global.wx = { cloud: { callFunction: nativeCall } }
  jest.doMock('../../config', () => ({ USE_MOCK: false, MOCK_SCENARIO: 'success' }))
  jest.doMock('../../mock/index', () => {
    throw new Error('mock should not be loaded in production mode')
  })

  const cloud = require('../cloud')
  await cloud.callFunction({ name: 'members', data: { action: 'get' } })

  expect(nativeCall).toHaveBeenCalledWith({ name: 'members', data: { action: 'get' } })
})
