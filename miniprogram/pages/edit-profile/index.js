Page({
  data: {
    defaultAvatar: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCsl1PaL2XUIPcnYgicQ/132',
    formData: {
      name: '',
      phone: '',
      avatarUrl: ''
    }
  },

  onLoad() {
    this.loadUserInfo()
  },

  // 加载用户信息
  loadUserInfo() {
    wx.cloud.callFunction({
      name: 'members',
      data: { action: 'get' },
      success: res => {
        if (res.result && res.result.data && res.result.data.length > 0) {
          const user = res.result.data[0]
          this.setData({
            formData: {
              name: user.name || '',
              phone: user.phone || '',
              avatarUrl: user.avatarUrl || ''
            }
          })
        }
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

  // 取消编辑
  onCancel() {
    wx.navigateBack()
  },

  // 保存修改
  onSave() {
    const { name, phone } = this.data.formData

    // 验证
    if (!name || name.trim() === '') {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }

    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    // 更新用户信息
    wx.cloud.callFunction({
      name: 'members',
      data: {
        action: 'update',
        data: {
          name: name.trim(),
          phone: phone || '',
          avatarUrl: this.data.formData.avatarUrl
        }
      },
      success: () => {
        wx.hideLoading()
        wx.showToast({ title: '保存成功', icon: 'success' })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'error' })
      }
    })
  }
})
