const { callFunction } = require('../../utils/cloud')

const PLAY_STYLE_OPTIONS = [
  { value: 'baseliner', label: '底线型' },
  { value: 'serve-volleyer', label: '发球上网' },
  { value: 'all-court', label: '全场型' },
  { value: 'counter-puncher', label: '反击型' },
  { value: 'aggressive-baseliner', label: '进攻底线型' }
]
const NOTE_MAX = 50

Page({
  data: {
    defaultAvatar: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCsl1PaL2XUIPcnYgicQ/132',
    formData: {
      name: '',
      phone: '',
      avatarUrl: '',
      playStyle: null,
      playStyleNote: ''
    },
    playStyleOptions: PLAY_STYLE_OPTIONS,
    noteMax: NOTE_MAX
  },

  onLoad() {
    this.loadUserInfo()
  },

  // 加载用户信息
  async loadUserInfo() {
    const currentMember = getApp().globalData.currentMember
    if (currentMember) {
      this.setUserForm(currentMember)
      return
    }

    try {
      const res = await callFunction({ name: 'members', data: { action: 'get' } })
      const user = res.result && res.result.data && res.result.data[0]
      if (user) this.setUserForm(user)
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
        playStyle: user.playStyle || null,
        playStyleNote: user.playStyleNote || ''
      }
    })
  },

  // 选择头像
  onChooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const tempFilePath = res.tempFiles[0].tempFilePath
        this.uploadAvatar(tempFilePath)
      }
    })
  },

  // 上传头像
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

  // 姓名输入
  onNameInput(e) {
    this.setData({
      'formData.name': e.detail.value
    })
  },

  // 手机号输入
  onPhoneInput(e) {
    this.setData({
      'formData.phone': e.detail.value
    })
  },

  onPlayStyleChange(e) {
    this.setData({ 'formData.playStyle': e.detail.value || null })
  },

  onPlayStyleNoteInput(e) {
    const value = (e.detail.value || '').slice(0, NOTE_MAX)
    this.setData({ 'formData.playStyleNote': value })
  },

  // 取消编辑
  onCancel() {
    wx.navigateBack()
  },

  // 保存修改
  async onSave() {
    const { name, phone, avatarUrl, playStyle, playStyleNote } = this.data.formData
    const cleanName = name && name.trim()

    // 验证
    if (!cleanName) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }

    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    // 更新用户信息
    try {
      const payload = {
        name: cleanName,
        phone: phone || '',
        avatarUrl,
        playStyle: playStyle || null,
        playStyleNote: playStyleNote || null
      }
      const res = await callFunction({
        name: 'members',
        data: {
          action: 'update',
          data: payload
        }
      })
      if (res.result && res.result.success === false) {
        wx.hideLoading()
        wx.showToast({ title: res.result.error?.message || '保存失败', icon: 'none' })
        return
      }
      const app = getApp()
      if (app && app.globalData) {
        app.globalData.currentMember = {
          ...(app.globalData.currentMember || {}),
          ...payload
        }
      }
      wx.hideLoading()
      wx.showToast({ title: '保存成功', icon: 'success' })
      setTimeout(() => {
        wx.navigateBack()
      }, 600)
    } catch (err) {
      console.error('[edit-profile] onSave', err)
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'error' })
    }
  }
})
