const pointsEngine = require('./points-engine')
const weeklyStar = require('./weekly-star')
const members = require('./members')

const handlers = {
  'points-engine': pointsEngine.main,
  'weekly-star': weeklyStar.main,
  members: members.main
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function applyScenario(scenario) {
  if (scenario === 'timeout') {
    await delay(300)
    throw new Error('Mock timeout')
  }
  if (scenario === 'error') {
    throw new Error('Mock error')
  }
}

function emptyResult(name, action) {
  if (name === 'points-engine' && (action === 'rankList' || action === 'rankAggregate')) {
    return { success: true, data: { rankList: [] } }
  }
  if (name === 'points-engine' && action === 'playerStats') {
    return {
      success: true,
      data: {
        stats: {
          singles: { winCount: 0, lossCount: 0, totalPoints: 0 },
          doubles: { winCount: 0, lossCount: 0, totalPoints: 0 }
        },
        recent: []
      }
    }
  }
  if (name === 'weekly-star' && action === 'latest') {
    return { success: true, data: null }
  }
  if (name === 'members' && action === 'get') {
    return { success: true, data: [] }
  }
  return { success: true, data: null }
}

/**
 * Mock wx.cloud.callFunction.
 *
 * @param {{ name: string, data?: object }} options
 * @returns {Promise<{ result: { success: boolean, data?: any, error?: { code: string, message: string } } }>}
 */
async function callMockFunction(options = {}) {
  const { name, data = {} } = options
  const scenario = data.__mockScenario || 'success'
  await applyScenario(scenario)

  const result = scenario === 'empty'
    ? emptyResult(name, data.action)
    : handlers[name]
      ? handlers[name](data)
      : { success: false, error: { code: 'UNKNOWN_FUNCTION', message: name || '' } }

  return { result }
}

module.exports = {
  callMockFunction
}
