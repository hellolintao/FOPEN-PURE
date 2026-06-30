function loadPage(overrides = {}) {
  jest.resetModules()
  let pageDef
  const app = { globalData: { env: 'test-env', currentMember: null, isAdmin: false, ...overrides } }
  global.wx = {
    navigateBack: jest.fn(),
    navigateTo: jest.fn(),
    redirectTo: jest.fn(),
    reLaunch: jest.fn(),
    showToast: jest.fn(),
    showModal: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    setNavigationBarTitle: jest.fn(),
    openPrivacyContract: jest.fn(),
    onNeedPrivacyAuthorization: jest.fn(),
    requirePrivacyAuthorize: jest.fn(({ success }) => {
      if (success) success({ errMsg: 'requirePrivacyAuthorize:ok' })
    }),
    chooseMedia: jest.fn(),
    chooseImage: jest.fn(),
    cloud: { uploadFile: jest.fn() }
  }
  global.getApp = () => app
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  jest.mock('../../../utils/page-cache', () => ({ removeCachesByPrefix: jest.fn() }))
  require('../index')
  return { pageDef, app }
}

function makeCtx(def, data = {}) {
  const ctx = {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) {
      for (const key of Object.keys(patch)) {
        if (key.includes('.')) {
          const [head, ...rest] = key.split('.')
          let cur = this.data[head]
          for (let i = 0; i < rest.length - 1; i += 1) cur = cur[rest[i]]
          cur[rest[rest.length - 1]] = patch[key]
        } else {
          this.data[key] = patch[key]
        }
      }
    }
  }
  Object.assign(ctx.data, data)
  return ctx
}

function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve())
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function acceptAgreement(ctx) {
  ctx.data.agreementAccepted = true
}

describe('edit-profile privacy-facing copy', () => {
  test('profile form uses nickname text input and does not collect phone', () => {
    const fs = require('fs')
    const path = require('path')
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('昵称')
    expect(wxml).toContain('placeholder="请输入昵称"')
    expect(wxml).toContain('type="text"')
    expect(wxml).not.toContain('type="nickname"')
    expect(wxml).not.toContain('手机号')
  })

  test('legal copy does not declare phone collection', () => {
    const fs = require('fs')
    const path = require('path')
    const privacy = fs.readFileSync(path.join(__dirname, '../../privacy-policy/index.wxml'), 'utf8')
    const agreement = fs.readFileSync(path.join(__dirname, '../../user-agreement/index.wxml'), 'utf8')

    expect(privacy).not.toContain('手机号')
    expect(agreement).not.toContain('手机号')
  })

  test('legal copy declares public nickname and avatar display after agreement consent', () => {
    const fs = require('fs')
    const path = require('path')
    const privacy = fs.readFileSync(path.join(__dirname, '../../privacy-policy/index.wxml'), 'utf8')
    const agreement = fs.readFileSync(path.join(__dirname, '../../user-agreement/index.wxml'), 'utf8')
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')

    expect(wxml).toContain('展示我的昵称、头像')
    expect(privacy).toContain('协议更新提示中点击同意')
    expect(privacy).toContain('展示你的昵称、头像')
    expect(agreement).toContain('允许平台在排行榜')
    expect(agreement).toContain('展示你的昵称、头像')
  })
})

describe('edit-profile mode handling', () => {
  test('mode=register sets register title and does not load member', () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    const ctx = makeCtx(pageDef)

    ctx.onLoad({ mode: 'register' })

    expect(ctx.data.isRegister).toBe(true)
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({ title: '注册' })
    expect(callFunction).not.toHaveBeenCalled()
  })

  test('register page does not install a custom privacy authorization handler', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)

    ctx.onLoad({ mode: 'register' })

    expect(wx.onNeedPrivacyAuthorization).not.toHaveBeenCalled()
  })

  test('default mode edits and loads current member without members.get', () => {
    const { pageDef } = loadPage({
      currentMember: { name: '李四', phone: '13800000000', avatarUrl: 'cloud://avatar', playStyle: 'vers' }
    })
    const { callFunction } = require('../../../utils/cloud')
    const ctx = makeCtx(pageDef)

    ctx.onLoad({})

    expect(ctx.data.isRegister).toBe(false)
    expect(ctx.data.formData.name).toBe('李四')
    expect(ctx.data.formData.playStyle).toBe('vers')
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({ title: '编辑资料' })
    expect(callFunction).not.toHaveBeenCalled()
  })

  test('tournament-register query stores return context for save', () => {
    const { pageDef } = loadPage({
      currentMember: { name: '李四', phone: '13800000000', avatarUrl: 'cloud://avatar', playStyle: 'vers' }
    })
    const ctx = makeCtx(pageDef)

    ctx.onLoad({ from: 'tournament-register', tournamentId: 't1' })

    expect(ctx.data.from).toBe('tournament-register')
    expect(ctx.data.tournamentId).toBe('t1')
    expect(ctx.data.isRegister).toBe(false)
  })

  test('tournament-register mode stores return context and uses register validation', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)

    ctx.onLoad({ mode: 'register', from: 'tournament-register', tournamentId: 't1' })

    expect(ctx.data.isRegister).toBe(true)
    expect(ctx.data.needsAgreement).toBe(true)
    expect(ctx.data.from).toBe('tournament-register')
    expect(ctx.data.tournamentId).toBe('t1')
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({ title: '注册' })
  })

  test('agreement checkbox and legal links update registration consent state', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)

    ctx.onAgreementChange({ detail: { value: ['accepted'] } })
    expect(ctx.data.agreementAccepted).toBe(true)

    ctx.onAgreementChange({ detail: { value: [] } })
    expect(ctx.data.agreementAccepted).toBe(false)

    ctx.onOpenUserAgreement()
    ctx.onOpenPrivacyPolicy()

    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/user-agreement/index' })
    expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/privacy-policy/index' })
  })
})

describe('edit-profile validation and save', () => {
  test('register mode requires agreement consent before saving personal info', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    const ctx = makeCtx(pageDef, { isRegister: true, agreementAccepted: false })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'vers' }

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '请先阅读并同意协议', icon: 'none' })
    expect(callFunction).not.toHaveBeenCalled()
  })

  test('register mode syncs official WeChat privacy authorization before saving personal info', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { _id: 'm1' } })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'vers' }
    acceptAgreement(ctx)

    await ctx.onSave()

    expect(wx.requirePrivacyAuthorize).toHaveBeenCalled()
    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({
        action: 'add'
      })
    }))
  })

  test('register mode stops saving when official WeChat privacy authorization is rejected', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    wx.requirePrivacyAuthorize.mockImplementationOnce(({ fail }) => {
      fail({ errMsg: 'requirePrivacyAuthorize:fail privacy permission is not authorized' })
    })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'vers' }
    acceptAgreement(ctx)

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '请先同意微信隐私授权', icon: 'none' })
    expect(callFunction).not.toHaveBeenCalled()
  })

  test('register mode requires playStyle', async () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: null }

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择打法', icon: 'none' })
  })

  test('saving is blocked while avatar is uploading', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    const ctx = makeCtx(pageDef, { isRegister: false, avatarUploading: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: null }

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '头像上传中', icon: 'none' })
    expect(callFunction).not.toHaveBeenCalled()
  })

  test('edit mode does not require playStyle and calls update', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { stats: { updated: 1 } } })
    const ctx = makeCtx(pageDef, { isRegister: false })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: null }

    await ctx.onSave()

    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(callFunction.mock.calls[0][0].data.action).toBe('update')
  })

  test('saving profile does not send phone in members payload', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { stats: { updated: 1 } } })
    const ctx = makeCtx(pageDef, { isRegister: false })
    ctx.data.formData = {
      name: '小张',
      phone: '13800000000',
      avatarUrl: '',
      playStyle: null
    }

    await ctx.onSave()

    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({
        action: 'update',
        data: expect.not.objectContaining({ phone: expect.anything() })
      })
    }))
  })

  test('edit mode treats zero updated rows as save failure', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { stats: { updated: 0 } } })
    const ctx = makeCtx(pageDef, { isRegister: false })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: null }

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '保存失败', icon: 'none' })
    expect(wx.navigateBack).not.toHaveBeenCalled()
  })

  test('tournament register save emits event channel and navigates back without duplicating detail page', async () => {
    jest.useFakeTimers()
    const emit = jest.fn()
    const { pageDef, app } = loadPage({
      currentMember: { _id: 'm1', name: '旧名', admin: false, claimStatus: 'claimed' }
    })
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { data: { _id: 'm1', name: '张三', admin: false, claimStatus: 'claimed', playStyle: 'vers' } } })
    const ctx = makeCtx(pageDef, { from: 'tournament-register', tournamentId: 't1' })
    ctx.getOpenerEventChannel = jest.fn(() => ({ emit }))
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'vers' }

    await ctx.onSave()
    jest.runAllTimers()

    expect(app.globalData.currentMember).toMatchObject({ _id: 'm1', name: '张三' })
    expect(emit).toHaveBeenCalledWith('registrationIdentityReady')
    expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 })
    expect(wx.redirectTo).not.toHaveBeenCalled()
    expect(wx.reLaunch).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test('tournament register missing member creates claimed member before emitting event', async () => {
    const emit = jest.fn()
    const { pageDef, app } = loadPage({ currentMember: null })
    const { callFunction } = require('../../../utils/cloud')
    callFunction
      .mockResolvedValueOnce({ result: { data: [] } })
      .mockResolvedValueOnce({
        result: {
          data: {
            _id: 'm-new',
            name: '张三',
            admin: false,
            claimStatus: 'claimed',
            playStyle: 'vers'
          }
        }
      })
    const ctx = makeCtx(pageDef)
    ctx.getOpenerEventChannel = jest.fn(() => ({ emit }))

    ctx.onLoad({ from: 'tournament-register', tournamentId: 't1' })
    await flushPromises()
    jest.useFakeTimers()
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'vers' }
    acceptAgreement(ctx)

    await ctx.onSave()
    jest.runAllTimers()

    expect(callFunction).toHaveBeenLastCalledWith(expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({
        action: 'add',
        data: expect.objectContaining({
          name: '张三',
          claimStatus: 'claimed'
        })
      })
    }))
    expect(app.globalData.currentMember).toMatchObject({
      _id: 'm-new',
      claimStatus: 'claimed'
    })
    expect(emit).toHaveBeenCalledWith('registrationIdentityReady')
    expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 })
    jest.useRealTimers()
  })

  test('tournament register already registered unclaimed member claims through backend before emitting event', async () => {
    jest.useFakeTimers()
    const emit = jest.fn()
    const claim = deferred()
    const { pageDef, app } = loadPage({ currentMember: null })
    const { callFunction } = require('../../../utils/cloud')
    callFunction
      .mockResolvedValueOnce({
        result: {
          errMsg: 'already registered',
          data: {
            _id: 'm-existing',
            name: '旧名',
            admin: false,
            claimStatus: 'unclaimed',
            playStyle: 'vers'
          }
        }
      })
      .mockReturnValueOnce(claim.promise)
    const ctx = makeCtx(pageDef, { isRegister: true, from: 'tournament-register', tournamentId: 't1' })
    ctx.getOpenerEventChannel = jest.fn(() => ({ emit }))
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'vers' }
    acceptAgreement(ctx)

    const savePromise = ctx.onSave()
    await flushPromises()

    expect(callFunction).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({ action: 'add' })
    }))
    expect(callFunction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({
        action: 'claimSelf',
        data: expect.objectContaining({ name: '张三', claimStatus: 'claimed' })
      })
    }))
    expect(app.globalData.currentMember).toBeNull()
    expect(emit).not.toHaveBeenCalled()

    claim.resolve({
      result: {
        data: {
          _id: 'm-existing',
          name: '张三',
          admin: false,
          claimStatus: 'claimed',
          playStyle: 'vers'
        }
      }
    })
    await savePromise
    jest.runAllTimers()

    expect(app.globalData.currentMember).toMatchObject({
      _id: 'm-existing',
      name: '张三',
      claimStatus: 'claimed'
    })
    expect(emit).toHaveBeenCalledWith('registrationIdentityReady')
    expect(wx.navigateBack).toHaveBeenCalledWith({ delta: 1 })
    jest.useRealTimers()
  })

  test('tournament register already registered unclaimed member does not emit when backend claim fails', async () => {
    jest.useFakeTimers()
    const emit = jest.fn()
    const existing = {
      _id: 'm-existing',
      name: '旧名',
      admin: false,
      claimStatus: 'unclaimed',
      playStyle: 'vers'
    }
    const { pageDef, app } = loadPage({ currentMember: null })
    const { callFunction } = require('../../../utils/cloud')
    callFunction
      .mockResolvedValueOnce({ result: { errMsg: 'already registered', data: existing } })
      .mockResolvedValueOnce({
        result: {
          success: false,
          error: { code: 'CLAIM_FAILED', message: '认领失败' }
        }
      })
    const ctx = makeCtx(pageDef, { isRegister: true, from: 'tournament-register', tournamentId: 't1' })
    ctx.getOpenerEventChannel = jest.fn(() => ({ emit }))
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'vers' }
    acceptAgreement(ctx)

    await ctx.onSave()
    jest.runAllTimers()

    expect(callFunction).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({ action: 'claimSelf' })
    }))
    expect(wx.showToast).toHaveBeenCalledWith({ title: '认领失败', icon: 'none' })
    expect(app.globalData.currentMember).toBeNull()
    expect(emit).not.toHaveBeenCalled()
    expect(wx.navigateBack).not.toHaveBeenCalled()
    jest.useRealTimers()
  })

  test('register success stores new member with _id and reLaunches to mine', async () => {
    jest.useFakeTimers()
    const { pageDef, app } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    const { removeCachesByPrefix } = require('../../../utils/page-cache')
    callFunction.mockResolvedValueOnce({ result: { _id: 'm1' } })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'ice-cow' }
    acceptAgreement(ctx)

    await ctx.onSave()
    jest.runAllTimers()

    expect(app.globalData.currentMember).toMatchObject({
      _id: 'm1',
      name: '张三',
      playStyle: 'ice-cow',
      publicProfileConsent: true
    })
    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: 'members',
      data: expect.objectContaining({
        action: 'add',
        data: expect.objectContaining({ publicProfileConsent: true })
      })
    }))
    expect(app.globalData.isAdmin).toBe(false)
    expect(removeCachesByPrefix).toHaveBeenCalledWith('rank:')
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/mine/index' })
    jest.useRealTimers()
  })

  test('already registered response stores existing member and reLaunches', async () => {
    jest.useFakeTimers()
    const existing = { _id: 'existing', name: '老用户', admin: true, playStyle: 'vers' }
    const { pageDef, app } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { errMsg: 'already registered', data: existing } })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'ice-cow' }
    acceptAgreement(ctx)

    await ctx.onSave()
    jest.runAllTimers()

    expect(app.globalData.currentMember).toEqual(existing)
    expect(app.globalData.isAdmin).toBe(true)
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/mine/index' })
    jest.useRealTimers()
  })

  test('register claimed member response stores backend member data', async () => {
    jest.useFakeTimers()
    const claimedMember = {
      _id: 'unclaimed_标子',
      name: '标子',
      claimStatus: 'claimed',
      playStyle: 'vers',
      admin: false
    }
    const { pageDef, app } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { data: claimedMember } })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '标子', phone: '', avatarUrl: '', playStyle: 'ice-cow' }
    acceptAgreement(ctx)

    await ctx.onSave()
    jest.runAllTimers()

    expect(app.globalData.currentMember).toMatchObject({
      _id: 'unclaimed_标子',
      name: '标子',
      claimStatus: 'claimed',
      playStyle: 'vers'
    })
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/mine/index' })
    jest.useRealTimers()
  })

  test('register claim conflict shows contact admin message and does not reLaunch', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({
      result: {
        success: false,
        error: {
          code: 'CLAIM_CONFLICT',
          message: '姓名匹配到多条待认领会员，请联系管理员处理'
        }
      }
    })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '标子', phone: '', avatarUrl: '', playStyle: 'vers' }
    acceptAgreement(ctx)

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({
      title: '姓名匹配到多条待认领会员，请联系管理员处理',
      icon: 'none'
    })
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })

  test('validation failure response shows server error and does not reLaunch', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({
      result: { success: false, error: { code: 'VALIDATION_FAILED', message: '打法为必填项' } }
    })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'ice-cow' }
    acceptAgreement(ctx)

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '打法为必填项', icon: 'none' })
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })
})

describe('edit-profile avatar', () => {
  test('avatar tap requests official WeChat privacy authorization before choosing media', async () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)
    ctx.uploadAvatar = jest.fn()
    wx.chooseMedia.mockImplementationOnce(({ success }) => {
      success({ tempFiles: [{ tempFilePath: 'http://tmp/avatar.jpg' }] })
    })

    await ctx.onAvatarActionTap()

    expect(wx.requirePrivacyAuthorize).toHaveBeenCalled()
    expect(wx.chooseMedia).toHaveBeenCalledWith(expect.objectContaining({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed']
    }))
    expect(ctx.data.avatarPreviewUrl).toBe('http://tmp/avatar.jpg')
    expect(ctx.uploadAvatar).toHaveBeenCalledWith('http://tmp/avatar.jpg')
  })

  test('avatar tap stops when official WeChat privacy authorization is rejected', async () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)
    ctx.uploadAvatar = jest.fn()
    wx.requirePrivacyAuthorize.mockImplementationOnce(({ fail }) => {
      fail({ errMsg: 'requirePrivacyAuthorize:fail privacy permission is not authorized' })
    })

    await ctx.onAvatarActionTap()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '需同意隐私授权后上传头像', icon: 'none' })
    expect(wx.chooseMedia).not.toHaveBeenCalled()
    expect(ctx.uploadAvatar).not.toHaveBeenCalled()
  })

  test('avatar tap falls back to wx.chooseImage when chooseMedia is unavailable', async () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)
    ctx.uploadAvatar = jest.fn()
    wx.chooseMedia = undefined
    wx.chooseImage.mockImplementationOnce(({ success }) => {
      success({ tempFilePaths: ['http://tmp/fallback.jpg'] })
    })

    await ctx.onAvatarActionTap()

    expect(wx.chooseImage).toHaveBeenCalledWith(expect.objectContaining({
      count: 1,
      sourceType: ['album', 'camera'],
      sizeType: ['compressed']
    }))
    expect(ctx.data.avatarPreviewUrl).toBe('http://tmp/fallback.jpg')
    expect(ctx.uploadAvatar).toHaveBeenCalledWith('http://tmp/fallback.jpg')
  })

  test('chooseAvatar privacy declaration errors are surfaced with an actionable modal', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)

    ctx.onAvatarButtonError({
      detail: {
        errMsg: '[Component] <button>: chooseAvatar:fail api scope is not declared in the privacy agreement'
      }
    })

    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: '头像上传未启用',
      showCancel: false
    }))
    expect(wx.showModal.mock.calls[0][0].content).toContain('用户隐私保护指引')
    consoleSpy.mockRestore()
  })

  test('onChooseAvatar previews temp avatar and calls uploadAvatar', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)
    ctx.uploadAvatar = jest.fn()

    ctx.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temp-path' } })

    expect(ctx.data.avatarPreviewUrl).toBe('wxfile://temp-path')
    expect(ctx.uploadAvatar).toHaveBeenCalledWith('wxfile://temp-path')
  })

  test('uploadAvatar uploads to current cloud env and stores fileID', () => {
    const { pageDef } = loadPage({ env: 'cloud-test-env' })
    wx.cloud.uploadFile.mockImplementationOnce(({ success }) => {
      success({ fileID: 'cloud://avatar-file-id' })
    })
    const ctx = makeCtx(pageDef)

    ctx.uploadAvatar('wxfile://temp-avatar.png')

    expect(wx.cloud.uploadFile).toHaveBeenCalledWith(expect.objectContaining({
      cloudPath: expect.stringMatching(/^avatars\/\d+-[a-z0-9]+\.png$/),
      filePath: 'wxfile://temp-avatar.png',
      config: { env: 'cloud-test-env' }
    }))
    expect(ctx.data.formData.avatarUrl).toBe('cloud://avatar-file-id')
    expect(ctx.data.avatarPreviewUrl).toBe('cloud://avatar-file-id')
    expect(ctx.data.avatarUploading).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '上传成功', icon: 'success' })
  })

  test('uploadAvatar failure restores previous avatar and shows readable error', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const { pageDef } = loadPage()
    wx.cloud.uploadFile.mockImplementationOnce(({ fail }) => {
      fail(new Error('denied'))
    })
    const ctx = makeCtx(pageDef)
    ctx.data.formData.avatarUrl = 'cloud://old-avatar'
    ctx.data.avatarPreviewUrl = 'wxfile://temp-avatar'

    ctx.uploadAvatar('wxfile://temp-avatar')

    expect(ctx.data.formData.avatarUrl).toBe('cloud://old-avatar')
    expect(ctx.data.avatarPreviewUrl).toBe('cloud://old-avatar')
    expect(ctx.data.avatarUploading).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: '头像上传失败', icon: 'none' })
    consoleSpy.mockRestore()
  })
})
