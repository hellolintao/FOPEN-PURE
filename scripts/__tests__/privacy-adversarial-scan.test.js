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

  test.each([
    [
      'same-line second method',
      `Page({
  async ensureIdentity() { app.refreshIdentity() }, onShow() { app.refreshIdentity() }
})`
    ],
    [
      'block-comment fake signature',
      `Page({
  async ensureIdentity() { app.refreshIdentity() },
  /*
  async ensureIdentity() {
  */
  onShow: async function() {
    app.refreshIdentity()
  }
})`
    ],
    [
      'template-literal fake signature',
      `Page({
  async ensureIdentity() { app.refreshIdentity() },
  data: { fake: \`
  async ensureIdentity() {
  \` },
  onShow: async () => {
    app.refreshIdentity()
  }
})`
    ],
    [
      'computed onShow',
      `Page({
  async ensureIdentity() { app.refreshIdentity() },
  ['on' + 'Show']() {
    app.refreshIdentity()
  }
})`
    ]
  ])('rejects %s outside the real allowlisted AST owner', (_name, source) => {
    expect(identityFindings('miniprogram/pages/tournament-detail/index.js', source)).toEqual([
      expect.objectContaining({ rule: 'page-eager-member-identity' })
    ])
  })

  test('allows a restore when a regex literal contains a closing brace', () => {
    const source = `Page({
  async ensureIdentity() {
    const closingBrace = /}/
    app.refreshIdentity()
  }
})`

    expect(identityFindings('miniprogram/pages/tournament-detail/index.js', source)).toEqual([])
  })

  test('fails closed when JavaScript cannot be parsed', () => {
    expect(scanSource('miniprogram/pages/broken/index.js', 'Page({ onShow() {')).toEqual([
      expect.objectContaining({ rule: 'javascript-parse-failed' })
    ])
  })
})
