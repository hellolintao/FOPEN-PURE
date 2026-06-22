const { PLAY_STYLE_OPTIONS, PLAY_STYLE_VALUES } = require('../../utils/play-style')

Page({
  data: {
    isEdit: true,
    member: { name: '', avatarUrl: '', status: '', admin: false, playStyle: '' },
    memberId: '',
    statusOptions: [
      { label: '活跃', value: 'active' },
      { label: '不活跃', value: 'inactive' }
    ],
    statusIndex: 0,
    playStyleOptions: PLAY_STYLE_OPTIONS,
    playStyleIndex: -1
  },

  onLoad(options) {
    if (!options || !options.member) {
      this.redirectInvalidEntry()
      return
    }

    try {
      const member = JSON.parse(decodeURIComponent(options.member))
      if (!member || !member._id) {
        this.redirectInvalidEntry()
        return
      }

      const statusIndex = this.data.statusOptions.findIndex(s => s.value === member.status)
      const playStyle = PLAY_STYLE_VALUES.includes(member.playStyle) ? member.playStyle : ''
      const playStyleIndex = PLAY_STYLE_VALUES.indexOf(playStyle)
      const safeMember = { ...member }
      delete safeMember.phone
      this.setData({
        isEdit: true,
        member: { ...this.data.member, ...safeMember, playStyle },
        memberId: member._id,
        statusIndex: statusIndex >= 0 ? statusIndex : 0,
        playStyleIndex
      })
    } catch (err) {
      console.error('[member-edit] invalid member query', err)
      this.redirectInvalidEntry()
    }
  },

  redirectInvalidEntry() {
    wx.showToast({ title: '请选择要编辑的会员', icon: 'none' })
    setTimeout(() => {
      wx.navigateBack()
    }, 500)
  },

  // 输入
  onInput(e) {
    const key = e.currentTarget.dataset.key
    if (key === 'phone') return
    this.setData({ [`member.${key}`]: e.detail.value })
  },

  // 选择状态
  onPickStatus(e) {
    const idx = e.detail.value
    this.setData({
      statusIndex: idx,
      'member.status': this.data.statusOptions[idx].value
    })
  },

  // 选择打法
  onPickPlayStyle(e) {
    const idx = Number(e.detail.value)
    const option = this.data.playStyleOptions[idx]
    if (!option) return

    this.setData({
      playStyleIndex: idx,
      'member.playStyle': option.value
    })
  },

  // 管理员开关变化
  onAdminChange(e) {
    this.setData({
      'member.admin': e.detail.value
    })
  },

  // 删除会员
  onDeleteMember() {
    wx.showModal({
      title: '删除会员',
      content: '确定要删除该会员吗？删除后数据将无法恢复！',
      confirmText: '确认删除',
      confirmColor: '#ef4444',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })

          wx.cloud.callFunction({
            name: 'members',
            data: {
              action: 'deleteById',
              _id: this.data.memberId
            },
            success: res => {
              wx.hideLoading()
              wx.showToast({ title: '删除成功', icon: 'success' })

              // 通知列表页删除该项目
              getApp().globalData.memberDelete = this.data.memberId

              setTimeout(() => {
                wx.navigateBack()
              }, 500)
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '删除失败', icon: 'error' })
            }
          })
        }
      }
    })
  },

  // 提交
  onSubmit() {
    const member = this.data.member

    if (!member.name || !member.status) {
      wx.showToast({ title: '请填写必填项', icon: 'none' })
      return
    }

    if (member.playStyle && !PLAY_STYLE_VALUES.includes(member.playStyle)) {
      wx.showToast({ title: '打法选项不合法', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    wx.cloud.callFunction({
      name: 'members',
      data: {
        action: 'updateById',
        _id: this.data.memberId,
        data: {
          name: member.name,
          status: member.status,
          admin: member.admin,
          playStyle: member.playStyle || ''
        }
      },
      success: res => {
        wx.hideLoading()
        if (res.result && res.result.success === false) {
          wx.showToast({
            title: (res.result.error && res.result.error.message) || '保存失败',
            icon: 'none'
          })
          return
        }

        wx.showToast({ title: '保存成功', icon: 'success' })

        // 更新全局存储，通知列表页更新单个项目
        getApp().globalData.memberUpdate = {
          _id: this.data.memberId,
          name: member.name,
          status: member.status,
          admin: member.admin,
          playStyle: member.playStyle || ''
        }

        setTimeout(() => {
          wx.navigateBack()
        }, 500)
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '保存失败', icon: 'error' })
      }
    })
  },

  // 取消
  onCancel() {
    wx.showModal({
      title: '确认取消',
      content: '确定要放弃当前编辑内容吗？',
      success: res => {
        if (res.confirm) {
          wx.navigateBack()
        }
      }
    })
  }
})
