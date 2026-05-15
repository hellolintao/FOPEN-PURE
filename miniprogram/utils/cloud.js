const config = require('../config')
const { callMockFunction } = require('../mock/index')

function getMockScenario(data = {}) {
  return data.__mockScenario || config.MOCK_SCENARIO || 'success'
}

function getNativeCallFunction() {
  if (typeof wx !== 'undefined' && wx.cloud && wx.cloud.callFunction) {
    return wx.cloud.callFunction.bind(wx.cloud)
  }
  throw new Error('wx.cloud.callFunction is unavailable')
}

async function callFunction(options) {
  if (!config.USE_MOCK) {
    return getNativeCallFunction()(options)
  }

  return callMockFunction({
    ...options,
    data: {
      ...(options.data || {}),
      __mockScenario: getMockScenario(options.data || {})
    }
  })
}

function generateTraceId() {
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function classifyClientError(e) {
  const msg = (e && (e.errMsg || e.message) || '').toLowerCase()
  if (msg.includes('timeout')) return 'TIMEOUT'
  if (msg.includes('network')) return 'NETWORK'
  return 'UNKNOWN'
}

async function call(name, payload, options = {}) {
  const traceId = options.traceId || generateTraceId()
  const timeout = options.timeout || 8000
  const onLoading = options.onLoading

  if (onLoading) onLoading(true)
  try {
    const res = await callFunction({ name, data: payload, config: { timeout } })
    const env = res && res.result
    if (!env || typeof env.success !== 'boolean') {
      return { ok: false, error: { code: 'INVALID_ENVELOPE', message: 'cloud function 返回非 envelope', retryable: false }, traceId }
    }
    if (env.success === false) {
      return { ok: false, error: { ...(env.error || {}) }, traceId }
    }
    return { ok: true, data: env.data, traceId }
  } catch (e) {
    const code = classifyClientError(e)
    return {
      ok: false,
      error: { code, message: (e && (e.errMsg || e.message)) || '请求失败', retryable: ['NETWORK', 'TIMEOUT'].includes(code) },
      traceId,
    }
  } finally {
    if (onLoading) onLoading(false)
  }
}

module.exports = {
  callFunction,
  call,
}
