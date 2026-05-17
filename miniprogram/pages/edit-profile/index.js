const { callFunction } = require('../../utils/cloud')
const { PLAY_STYLE_OPTIONS, PLAY_STYLE_VALUES } = require('../../utils/play-style')
const { DEFAULT_AVATAR_URL } = require('../../config')

Page({
  data: {
    isRegister: false,
    defaultAvatar: DEFAULT_AVATAR_URL,
    formData: {
      name: '',
      phone: '',
      avatarUrl: '',
      playStyle: null
    },
    playStyleOptions: PLAY_STYLE_OPTIONS
  },

  onLoad(query) {
    const isRegister = (query && query.mode) === 'register'
    this.setData({ isRegister })
    wx.setNavigationBarTitle({ title: isRegister ? '注册' : '编辑资料' })
    if (!isRegister) {
      this.loadUserInfo()
    }
  },

  async loadUserInfo() {
    const currentMember = getApp().globalData.currentMember
    if (currentMember) {
      this.setUserForm(currentMember)
      return
    }

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
      formData: {
        name: user.name || '',
        phone: user.phone || '',
        avatarUrl: user.avatarUrl || '',
        playStyle: PLAY_STYLE_VALUES.includes(user.playStyle) ? user.playStyle : null
      }
    })
  },

  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    this.uploadAvatar(tempPath)
  },

  uploadAvatar(filePath) {
    wx.showLoading({ title: '上传中...' })

    const cloudPath = `avatar/${Date.now()}.jpg`

    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: uploadRes => {
        this.setData({
          'formData.avatarUrl': uploadRes.fileID
        })
        wx.hideLoading()
        wx.showToast({ title: '上传成功', icon: 'success' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '上传失败', icon: 'error' })
      }
    })
  },

  onNameInput(e) {
    this.setData({
      'formData.name': e.detail.value
    })
  },

  onPhoneInput(e) {
    this.setData({
      'formData.phone': e.detail.value
    })
  },

  onPlayStyleChange(e) {
    const value = e.detail.value || null
    this.setData({
      'formData.playStyle': PLAY_STYLE_VALUES.includes(value) ? value : null
    })
  },

  onCancel() {
    wx.navigateBack()
  },

  async onSave() {
    const { isRegister } = this.data
    const { name, phone, avatarUrl, playStyle } = this.data.formData
    const cleanName = (name || '').trim()

    if (!cleanName) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }

    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }

    if (isRegister && !playStyle) {
      wx.showToast({ title: '请选择打法', icon: 'none' })
      return
    }

    wx.showLoading({ title: isRegister ? '注册中...' : '保存中...' })

    try {
      const payload = {
        name: cleanName,
        phone: phone || '',
        avatarUrl: avatarUrl || DEFAULT_AVATAR_URL,
        playStyle: playStyle || ''
      }
      const action = isRegister ? 'add' : 'update'
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
      const app = getApp()
      const currentMember = app && app.globalData ? app.globalData.currentMember : null
      const savedMember = result.errMsg === 'already registered' && result.data
        ? result.data
        : {
            ...(currentMember || {}),
            ...payload,
            _id: result._id || (currentMember && currentMember._id)
          }

      if (app && app.globalData) {
        app.globalData.currentMember = savedMember
        app.globalData.isAdmin = !!savedMember.admin
      }

      wx.hideLoading()
      wx.showToast({ title: isRegister ? '注册成功' : '保存成功', icon: 'success' })

      setTimeout(() => {
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
