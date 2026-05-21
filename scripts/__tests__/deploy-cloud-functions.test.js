const fs = require('fs')
const os = require('os')
const path = require('path')

jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({ status: 0, stdout: '', stderr: '' }))
}))

function writeWxServerSdkStub(functionDir) {
  const moduleDir = path.join(functionDir, 'node_modules', 'wx-server-sdk')
  fs.mkdirSync(moduleDir, { recursive: true })
  fs.writeFileSync(path.join(moduleDir, 'index.js'), `
    module.exports = {
      DYNAMIC_CURRENT_ENV: 'test-env',
      init() {},
      getWXContext() { return { OPENID: 'openid-test' } },
      database() {
        return {
          command: {
            inc(delta) { return { __op: 'inc', delta } },
            or(conditions) { return { $or: conditions } }
          },
          collection() {
            return {
              doc() { return { get: async () => ({ data: null }), update: async () => ({}) } },
              where() { return this },
              orderBy() { return this },
              skip() { return this },
              limit() { return this },
              get: async () => ({ data: [] }),
              count: async () => ({ total: 0 }),
              add: async () => ({ _id: 'created' })
            }
          },
          serverDate() { return 'SERVER_DATE' },
          runTransaction(handler) { return handler(this) }
        }
      },
      callFunction: async () => ({ result: {} })
    }
  `)
}

describe('deploy-cloud-functions packaging', () => {
  test.each(['tournament-registrations', 'scheduler-engine'])('packages _shared dependency for %s', (functionName) => {
    const { prepareFunction } = require('../deploy-cloud-functions')
    const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fopen-deploy-test-'))

    try {
      const outDir = prepareFunction(functionName, buildRoot)
      writeWxServerSdkStub(outDir)

      expect(fs.existsSync(path.join(outDir, '_shared_tournament-phase.js'))).toBe(true)
      expect(() => require(path.join(outDir, 'index.js'))).not.toThrow()
    } finally {
      fs.rmSync(buildRoot, { recursive: true, force: true })
    }
  })
})
