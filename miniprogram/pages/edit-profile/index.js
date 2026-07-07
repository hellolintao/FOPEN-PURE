const { callFunction } = require('../../utils/cloud')
const { removeCachesByPrefix } = require('../../utils/page-cache')
const { PLAY_STYLE_OPTIONS, PLAY_STYLE_VALUES } = require('../../utils/play-style')
const { DEFAULT_AVATAR_URL } = require('../../config')

Page({
  data: {
    isRegister: false,
    from: '',
    tournamentId: '',
    defaultAvatar: DEFAULT_AVATAR_URL,
    avatarPreviewUrl: '',
    avatarUploading: false,
    agreementAccepted: false,
    publicProfileConsent: false,
    needsAgreement: false,
    formData: {
      name: '',
      avatarUrl: '',
      playStyle: null
    },
    playStyleOptions: PLAY_STYLE_OPTIONS
  },

  onLoad(query) {
    const isRegister = (query && query.mode) === 'register'
    const from = (query && query.from) || ''
    this.setData({
      isRegister,
      from,
      tournamentId: (query && query.tournamentId) || '',
      needsAgreement: isRegister || from === 'tournament-register'
    })
    wx.setNavigationBarTitle({ title: isRegister ? '注册' : '编辑资料' })
    if (!isRegister) {
      this.loadUserInfo()
    }
  },

  onOpenPrivacyContract() {
    if (!wx.openPrivacyContract) {
      wx.showToast({ title: '当前微信不支持查看隐私指引', icon: 'none' })
      return
    }

    wx.openPrivacyContract({
      fail: err => {
        console.error('[edit-profile] openPrivacyContract', err)
        wx.showToast({ title: '隐私指引打开失败', icon: 'none' })
      }
    })
  },

  ensureOfficialPrivacyAuthorization(rejectTitle) {
    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      return Promise.resolve(true)
    }

    return new Promise(resolve => {
      wx.requirePrivacyAuthorize({
        success: () => resolve(true),
        fail: () => {
          wx.showToast({
            title: rejectTitle || '请先同意微信隐私授权',
            icon: 'none'
          })
          resolve(false)
        }
      })
    })
  },

  async loadUserInfo() {
    const currentMember = getApp().globalData.currentMember
    if (currentMember) {
      this.setUserForm(currentMember)
      return
    }

    const authorized = await this.ensureOfficialPrivacyAuthorization('请先同意微信隐私授权')
    if (!authorized) return

    try {
      const res = await callFunction({ name: 'members', data: { action: 'get' } })
      const user = res.result && res.result.data && res.result.data[0]
      if (user) {
        const app = getApp()
        if (app && app.globalData) {
          app.globalData.currentMember = user
          app.globalData.isAdmin = !!user.admin
        }
        this.setUserForm(user)
      }
    } catch (err) {
      console.error('[edit-profile] loadUserInfo', err)
    }
  },

  setUserForm(user) {
    this.setData({
      avatarPreviewUrl: '',
      publicProfileConsent: user.publicProfileConsent === true,
      formData: {
        name: user.name || '',
        avatarUrl: user.avatarUrl || '',
        playStyle: PLAY_STYLE_VALUES.includes(user.playStyle) ? user.playStyle : null
      }
    })
  },

  async onAvatarActionTap() {
    if (this.data.avatarUploading) return

    const authorized = await this.ensureOfficialPrivacyAuthorization('需同意隐私授权后上传头像')
    if (!authorized) return

    if (typeof wx.chooseMedia === 'function') {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: res => {
          const file = res.tempFiles && res.tempFiles[0]
          this.handleAvatarPicked(file && (file.tempFilePath || file.path))
        },
        fail: err => this.handleAvatarPickFail(err)
      })
      return
    }

    if (typeof wx.chooseImage === 'function') {
      wx.chooseImage({
        count: 1,
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        success: res => {
          const tempPath = res.tempFilePaths && res.tempFilePaths[0]
          this.handleAvatarPicked(tempPath)
        },
        fail: err => this.handleAvatarPickFail(err)
      })
      return
    }

    wx.showToast({ title: '当前微信不支持选择图片', icon: 'none' })
  },

  handleAvatarPicked(tempPath) {
    if (!tempPath) {
      wx.showToast({ title: '未选择头像', icon: 'none' })
      return
    }
    this.setData({ avatarPreviewUrl: tempPath })
    this.uploadAvatar(tempPath)
  },

  handleAvatarPickFail(err) {
    const errMsg = err && err.errMsg ? err.errMsg : ''
    if (/cancel/i.test(errMsg)) return
    if (/privacy|隐私|api scope is not declared/i.test(errMsg)) {
      this.onAvatarButtonError({ detail: err })
      return
    }
    console.error('[edit-profile] choose avatar media', err)
    wx.showToast({ title: '头像选择失败', icon: 'none' })
  },

  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    this.handleAvatarPicked(tempPath)
  },

  onAvatarButtonError(e) {
    const detail = e && e.detail ? e.detail : {}
    const errMsg = detail.errMsg || ''
    console.error('[edit-profile] chooseAvatar', detail)

    if (/privacy|隐私|api scope is not declared/i.test(errMsg)) {
      wx.showModal({
        title: '头像上传未启用',
        content: '请先在小程序后台「服务内容声明 > 用户隐私保护指引」声明用户头像、用户昵称，并让用户同意隐私指引后再上传。',
        showCancel: false,
        confirmText: '知道了'
      })
      return
    }

    wx.showToast({ title: '头像选择失败', icon: 'none' })
  },

  uploadAvatar(filePath) {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== 'function') {
      this.setData({ avatarPreviewUrl: this.data.formData.avatarUrl || '' })
      wx.showToast({ title: '当前微信不支持上传', icon: 'none' })
      return
    }

    this.setData({ avatarUploading: true })
    wx.showLoading({ title: '上传中...' })

    const extMatch = typeof filePath === 'string' && filePath.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)
    const ext = extMatch ? extMatch[1].toLowerCase() : 'jpg'
    const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const app = getApp()
    const env = app && app.globalData && app.globalData.env
    const uploadOptions = {
      cloudPath,
      filePath,
      success: uploadRes => {
        if (!uploadRes || !uploadRes.fileID) {
          this.setData({
            avatarPreviewUrl: this.data.formData.avatarUrl || '',
            avatarUploading: false
          })
          wx.hideLoading()
          wx.showToast({ title: '头像上传失败', icon: 'none' })
          return
        }

        this.setData({
          'formData.avatarUrl': uploadRes.fileID,
          avatarPreviewUrl: uploadRes.fileID,
          avatarUploading: false
        })
        wx.hideLoading()
        wx.showToast({ title: '上传成功', icon: 'success' })
      },
      fail: err => {
        console.error('[edit-profile] uploadAvatar', err)
        this.setData({
          avatarPreviewUrl: this.data.formData.avatarUrl || '',
          avatarUploading: false
        })
        wx.hideLoading()
        wx.showToast({ title: '头像上传失败', icon: 'none' })
      }
    }
    if (env) uploadOptions.config = { env }
    wx.cloud.uploadFile(uploadOptions)
  },

  onNameInput(e) {
    this.setData({
      'formData.name': e.detail.value
    })
  },

  onPlayStyleChange(e) {
    const value = e.detail.value || null
    this.setData({
      'formData.playStyle': PLAY_STYLE_VALUES.includes(value) ? value : null
    })
  },

  onAgreementChange(e) {
    const values = e && e.detail && Array.isArray(e.detail.value)
      ? e.detail.value
      : []
    this.setData({ agreementAccepted: values.includes('accepted') })
  },

  onPublicProfileConsentChange(e) {
    const values = e && e.detail && Array.isArray(e.detail.value)
      ? e.detail.value
      : []
    this.setData({ publicProfileConsent: values.includes('publicProfile') })
  },

  onOpenUserAgreement() {
    wx.navigateTo({ url: '/pages/user-agreement/index' })
  },

  onOpenPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy-policy/index' })
  },

  onCancel() {
    wx.navigateBack()
  },

  async onSave() {
    const { isRegister } = this.data
    const { name, avatarUrl, playStyle } = this.data.formData
    const cleanName = (name || '').trim()
    const app = getApp()
    const currentMember = app && app.globalData ? app.globalData.currentMember : null
    const isTournamentRegister = this.data.from === 'tournament-register' && this.data.tournamentId
    const shouldClaimExistingMember = !!(
      isTournamentRegister &&
      currentMember &&
      currentMember._id &&
      currentMember.claimStatus !== 'claimed'
    )
    const shouldCreateMember = !shouldClaimExistingMember && (isRegister || (isTournamentRegister && !(currentMember && currentMember._id)))
    const requiresPlayStyle = shouldCreateMember || shouldClaimExistingMember

    if (!cleanName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

    if (requiresPlayStyle && !playStyle) {
      wx.showToast({ title: '请选择打法', icon: 'none' })
      return
    }

    if (this.data.avatarUploading) {
      wx.showToast({ title: '头像上传中', icon: 'none' })
      return
    }

    if ((shouldCreateMember || shouldClaimExistingMember) && !this.data.agreementAccepted) {
      wx.showToast({ title: '请先阅读并同意协议', icon: 'none' })
      return
    }

    const privacyAuthorized = await this.ensureOfficialPrivacyAuthorization('请先同意微信隐私授权')
    if (!privacyAuthorized) return

    wx.showLoading({ title: shouldCreateMember ? '注册中...' : '保存中...' })

    try {
      const payload = {
        name: cleanName,
        avatarUrl: avatarUrl || DEFAULT_AVATAR_URL,
        playStyle: playStyle || '',
        publicProfileConsent: this.data.publicProfileConsent === true
      }
      if (shouldCreateMember || isTournamentRegister) {
        payload.claimStatus = 'claimed'
      }
      const action = shouldClaimExistingMember ? 'claimSelf' : (shouldCreateMember ? 'add' : 'update')
      const res = await callFunction({
        name: 'members',
        data: {
          action,
          data: payload
        }
      })

      if (res.result && res.result.success === false) {
        wx.hideLoading()
        wx.showToast({
          title: (res.result.error && res.result.error.message) || '保存失败',
          icon: 'none'
        })
        return
      }

      const result = res.result || {}
      if (action === 'update' && isZeroUpdated(result)) {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'none' })
        return
      }
      if (action === 'claimSelf' && (isZeroUpdated(result) || !isClaimedMemberResult(result))) {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'none' })
        return
      }
      let savedMember
      if (result.errMsg === 'already registered' && result.data) {
        if (isTournamentRegister && result.data.claimStatus !== 'claimed') {
          const claimRes = await callFunction({
            name: 'members',
            data: {
              action: 'claimSelf',
              data: {
                ...payload,
                claimStatus: 'claimed'
              }
            }
          })
          if (claimRes.result && claimRes.result.success === false) {
            wx.hideLoading()
            wx.showToast({
              title: (claimRes.result.error && claimRes.result.error.message) || '保存失败',
              icon: 'none'
            })
            return
          }
          const claimResult = claimRes.result || {}
          if (isZeroUpdated(claimResult) || !isClaimedMemberResult(claimResult)) {
            wx.hideLoading()
            wx.showToast({ title: '保存失败', icon: 'none' })
            return
          }
          savedMember = claimResult.data
        } else {
          savedMember = result.data
        }
      } else if (result.data) {
        savedMember = result.data
      } else {
        savedMember = {
          ...(currentMember || {}),
          ...payload,
          _id: result._id || (currentMember && currentMember._id)
        }
      }
      if (isTournamentRegister) {
        if (!savedMember || savedMember.claimStatus !== 'claimed') {
          wx.hideLoading()
          wx.showToast({ title: '保存失败', icon: 'none' })
          return
        }
      }

      if (app && app.globalData) {
        app.globalData.currentMember = savedMember
        app.globalData.isAdmin = !!savedMember.admin
      }
      removeCachesByPrefix('rank:')

      wx.hideLoading()
      wx.showToast({ title: isRegister ? '注册成功' : '保存成功', icon: 'success' })

      setTimeout(() => {
        if (this.data.from === 'tournament-register' && this.data.tournamentId) {
          const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel()
          if (eventChannel && eventChannel.emit) {
            eventChannel.emit('registrationIdentityReady')
            wx.navigateBack({ delta: 1 })
            return
          }
          console.warn('[edit-profile] event channel unavailable, redirecting to tournament detail')
          wx.redirectTo({
            url: `/pages/tournament-detail/index?id=${encodeURIComponent(this.data.tournamentId)}&entry=register`
          })
          return
        }
        if (isRegister) {
          wx.reLaunch({ url: '/pages/mine/index' })
        } else {
          wx.navigateBack()
        }
      }, 600)
    } catch (err) {
      console.error('[edit-profile] onSave', err)
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'error' })
    }
  }
})

function isZeroUpdated(result = {}) {
  const stats = result.stats || result.data && result.data.stats
  if (!stats) return false
  const updated = stats.updated === undefined ? stats.updatedCount : stats.updated
  return Number(updated) === 0
}

function isClaimedMemberResult(result = {}) {
  return !!(result.data && result.data._id && result.data.claimStatus === 'claimed')
}
