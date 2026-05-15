const assert = require('assert')

async function main() {
  const config = require('../miniprogram/config')
  const { callFunction } = require('../miniprogram/utils/cloud')
  const { callMockFunction } = require('../miniprogram/mock')

  const previousMockSetting = config.USE_MOCK
  const previousWx = global.wx
  try {
    global.wx = {
      cloud: {
        callFunction: async (options) => ({ result: { success: true, data: { native: true, options } } })
      }
    }

    config.USE_MOCK = false
    const native = await callFunction({ name: 'members', data: { action: 'get' } })
    assert.strictEqual(native.result.data.native, true)

    config.USE_MOCK = true
    const wrapped = await callFunction({ name: 'members', data: { action: 'get' } })
    assert.strictEqual(wrapped.result.success, true)
    assert.ok(Array.isArray(wrapped.result.data))

    const rank = await callMockFunction({
      name: 'points-engine',
      data: { action: 'rankList', type: 'singles' }
    })
    assert.strictEqual(rank.result.success, true)
    assert.ok(Array.isArray(rank.result.data.rankList))
    assert.ok(rank.result.data.rankList.length >= 10)
    assert.ok(rank.result.data.rankList[0].name)

    const star = await callMockFunction({
      name: 'weekly-star',
      data: { action: 'latest', seasonId: 's2026' }
    })
    assert.strictEqual(star.result.success, true)
    assert.ok(star.result.data.singlesStar)
    assert.ok(star.result.data.doublesStar)

    const empty = await callMockFunction({
      name: 'points-engine',
      data: { action: 'rankList', type: 'singles', __mockScenario: 'empty' }
    })
    assert.deepStrictEqual(empty.result.data.rankList, [])

    await assert.rejects(
      () => callMockFunction({
        name: 'weekly-star',
        data: { action: 'latest', __mockScenario: 'error' }
      }),
      /Mock error/
    )

    await assert.rejects(
      () => callMockFunction({
        name: 'weekly-star',
        data: { action: 'latest', __mockScenario: 'timeout' }
      }),
      /Mock timeout/
    )
  } finally {
    config.USE_MOCK = previousMockSetting
    global.wx = previousWx
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
