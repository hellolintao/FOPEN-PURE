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

module.exports = {
  callFunction
}
