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

  test.each([
    [
      'nested object method',
      `Page({
  onShow() {
    const helper = {
      async ensureIdentity() {
        app.refreshIdentity()
      }
    }
    return helper
  }
})`
    ],
    [
      'Page.data function property',
      `Page({
  data: {
    ensureIdentity: async () => {
      app.refreshIdentity()
    }
  }
})`
    ],
    [
      'top-level helper method',
      `const helper = {
  async ensureIdentity() {
    app.refreshIdentity()
  }
}
Page({ helper })`
    ]
  ])('rejects an allowlisted name owned by a %s', (_name, source) => {
    expect(identityFindings('miniprogram/pages/tournament-detail/index.js', source)).toEqual([
      expect.objectContaining({ rule: 'page-eager-member-identity' })
    ])
  })

  test('rejects nested onLaunch inside App.onShow', () => {
    const source = `App({
  onShow() {
    const helper = {
      onLaunch() {
        this.refreshIdentity()
      }
    }
    return helper
  }
})`

    expect(identityFindings('miniprogram/app.js', source)).toEqual([
      expect.objectContaining({ rule: 'launch-eager-member-identity' })
    ])
  })

  test.each([
    [
      'shadowed global',
      `const Page = config => config
Page({
  async ensureIdentity() {
    app.refreshIdentity()
  }
})`
    ],
    [
      'nested fake registration',
      `function registerFake() {
  Page({
    async ensureIdentity() {
      app.refreshIdentity()
    }
  })
}
Page({})`
    ],
    [
      'duplicate top-level registration',
      `Page({})
Page({
  async ensureIdentity() {
    app.refreshIdentity()
  }
})`
    ]
  ])('rejects Page restore through a %s', (_name, source) => {
    expect(identityFindings('miniprogram/pages/tournament-detail/index.js', source)).toEqual([
      expect.objectContaining({ rule: 'page-eager-member-identity' })
    ])
  })

  test.each([
    [
      'shadowed global',
      `const App = config => config
App({
  onLaunch() {
    this.refreshIdentity()
  }
})`
    ],
    [
      'nested fake registration',
      `function registerFake() {
  App({
    onLaunch() {
      this.refreshIdentity()
    }
  })
}
App({})`
    ],
    [
      'duplicate top-level registration',
      `App({})
App({
  onLaunch() {
    this.refreshIdentity()
  }
})`
    ]
  ])('rejects App restore through a %s', (_name, source) => {
    expect(identityFindings('miniprogram/app.js', source)).toEqual([
      expect.objectContaining({ rule: 'launch-eager-member-identity' })
    ])
  })

  test.each([
    [
      'getter',
      `Page({
  get ensureIdentity() {
    app.refreshIdentity()
    return null
  }
})`
    ],
    [
      'setter',
      `Page({
  set ensureIdentity(value) {
    app.refreshIdentity()
  }
})`
    ]
  ])('rejects an allowlisted name implemented as a %s', (_name, source) => {
    expect(identityFindings('miniprogram/pages/tournament-detail/index.js', source)).toEqual([
      expect.objectContaining({ rule: 'page-eager-member-identity' })
    ])
  })

  test.each([
    [
      'comment',
      `Page({
  onShow() {
    /* options.requirePrivacy ensureOfficialPrivacyAuthorization */
    app.refreshIdentity()
  }
})`
    ],
    [
      'string',
      `Page({
  onShow() {
    const fakeGate = 'options.requirePrivacy ensureOfficialPrivacyAuthorization'
    app.refreshIdentity()
    return fakeGate
  }
})`
    ]
  ])('rejects unauthorized restore despite a nearby privacy %s', (_name, source) => {
    expect(identityFindings('miniprogram/pages/tournament-detail/index.js', source)).toEqual([
      expect.objectContaining({ rule: 'page-eager-member-identity' })
    ])
  })
})
