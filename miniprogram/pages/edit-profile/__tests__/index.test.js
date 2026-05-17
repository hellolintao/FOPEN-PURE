function loadPage(overrides = {}) {
  jest.resetModules()
  let pageDef
  const app = { globalData: { env: 'test-env', currentMember: null, isAdmin: false, ...overrides } }
  global.wx = {
    navigateBack: jest.fn(),
    navigateTo: jest.fn(),
    reLaunch: jest.fn(),
    showToast: jest.fn(),
    showModal: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    setNavigationBarTitle: jest.fn(),
    openPrivacyContract: jest.fn(),
    onNeedPrivacyAuthorization: jest.fn(),
    chooseMedia: jest.fn(),
    chooseImage: jest.fn(),
    cloud: { uploadFile: jest.fn() }
  }
  global.getApp = () => app
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
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
})

describe('edit-profile validation and save', () => {
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

  test('register success stores new member with _id and reLaunches to mine', async () => {
    jest.useFakeTimers()
    const { pageDef, app } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { _id: 'm1' } })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'ice-cow' }

    await ctx.onSave()
    jest.runAllTimers()

    expect(app.globalData.currentMember).toMatchObject({
      _id: 'm1',
      name: '张三',
      playStyle: 'ice-cow'
    })
    expect(app.globalData.isAdmin).toBe(false)
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

    await ctx.onSave()
    jest.runAllTimers()

    expect(app.globalData.currentMember).toEqual(existing)
    expect(app.globalData.isAdmin).toBe(true)
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/mine/index' })
    jest.useRealTimers()
  })

  test('validation failure response shows server error and does not reLaunch', async () => {
    const { pageDef } = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({
      result: { success: false, error: { code: 'VALIDATION_FAILED', message: '打法为必填项' } }
    })
    const ctx = makeCtx(pageDef, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'ice-cow' }

    await ctx.onSave()

    expect(wx.showToast).toHaveBeenCalledWith({ title: '打法为必填项', icon: 'none' })
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })
})

describe('edit-profile avatar', () => {
  test('avatar tap uses wx.chooseMedia and uploads returned image path', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)
    ctx.uploadAvatar = jest.fn()
    wx.chooseMedia.mockImplementationOnce(({ success }) => {
      success({ tempFiles: [{ tempFilePath: 'http://tmp/avatar.jpg' }] })
    })

    ctx.onAvatarActionTap()

    expect(wx.chooseMedia).toHaveBeenCalledWith(expect.objectContaining({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed']
    }))
    expect(ctx.data.avatarPreviewUrl).toBe('http://tmp/avatar.jpg')
    expect(ctx.uploadAvatar).toHaveBeenCalledWith('http://tmp/avatar.jpg')
  })

  test('avatar tap falls back to wx.chooseImage when chooseMedia is unavailable', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)
    ctx.uploadAvatar = jest.fn()
    wx.chooseMedia = undefined
    wx.chooseImage.mockImplementationOnce(({ success }) => {
      success({ tempFilePaths: ['http://tmp/fallback.jpg'] })
    })

    ctx.onAvatarActionTap()

    expect(wx.chooseImage).toHaveBeenCalledWith(expect.objectContaining({
      count: 1,
      sourceType: ['album', 'camera'],
      sizeType: ['compressed']
    }))
    expect(ctx.data.avatarPreviewUrl).toBe('http://tmp/fallback.jpg')
    expect(ctx.uploadAvatar).toHaveBeenCalledWith('http://tmp/fallback.jpg')
  })

  test('privacy authorization prompt resolves pending chooseAvatar after user agrees', () => {
    const { pageDef } = loadPage()
    const ctx = makeCtx(pageDef)
    const resolve = jest.fn()

    ctx.onLoad({ mode: 'register' })
    const handler = wx.onNeedPrivacyAuthorization.mock.calls[0][0]
    handler(resolve, { referrer: 'chooseAvatar' })

    expect(ctx.data.showPrivacyDialog).toBe(true)

    ctx.onAgreePrivacyAuthorization({ target: { id: 'edit-profile-privacy-agree' } })

    expect(resolve).toHaveBeenCalledWith({
      event: 'agree',
      buttonId: 'edit-profile-privacy-agree'
    })
    expect(ctx.data.showPrivacyDialog).toBe(false)
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
