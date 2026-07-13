const { scanSource } = require('../privacy-adversarial-scan')

function identityFindings(relative, source) {
  return scanSource(relative, source).filter(({ rule }) => (
    rule === 'launch-eager-member-identity' || rule === 'page-eager-member-identity'
  ))
}

describe('privacy adversarial identity restore allowlist', () => {
  test.each([
    [
      'app onLaunch',
      'miniprogram/app.js',
      `App({
  onLaunch() {
    this.identityReady = this.refreshIdentity()
  }
})`
    ],
    [
      'rank _ensureCurrentMember',
      'miniprogram/pages/rank/index.js',
      `Page({
  async _ensureCurrentMember() {
    app.identityReady = app.refreshIdentity()
  }
})`
    ],
    [
      'tournament detail ensureIdentity',
      'miniprogram/pages/tournament-detail/index.js',
      `Page({
  async ensureIdentity() {
    app.identityReady = app.refreshIdentity()
  }
})`
    ]
  ])('allows %s only inside its explicit method', (_name, relative, source) => {
    expect(identityFindings(relative, source)).toEqual([])
  })

  test.each([
    [
      'function property',
      `Page({
  async ensureIdentity() {
    app.refreshIdentity()
  },
  onShow: async function() {
    app.refreshIdentity()
  }
})`
    ],
    [
      'arrow property',
      `Page({
  async ensureIdentity() {
    app.refreshIdentity()
  },
  onShow: async () => {
    app.refreshIdentity()
  }
})`
    ],
    [
      'single-line shorthand method',
      `Page({
  async ensureIdentity() {
    app.refreshIdentity()
  },
  onShow() { app.refreshIdentity() }
})`
    ]
  ])('rejects restore in a later unauthorized %s', (_name, source) => {
    expect(identityFindings('miniprogram/pages/tournament-detail/index.js', source)).toEqual([
      expect.objectContaining({ rule: 'page-eager-member-identity' })
    ])
  })
})
