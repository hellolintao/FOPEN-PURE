Page({
  data: {
    isEdit: false,
    member: { name: '', phone: '', avatarUrl: '', status: '' },
    memberId: '',
    statusOptions: [
      { label: '活跃', value: 'active' },
      { label: '不活跃', value: 'inactive' }
    ],
    statusIndex: 0
  },

  onLoad(options) {
    if (options.member) {
      const member = JSON.parse(decodeURIComponent(options.member))
      const statusIndex = this.data.statusOptions.findIndex(s => s.value === member.status)
      this.setData({
        isEdit: true,
        member,
        memberId: member._id,
        statusIndex: statusIndex >= 0 ? statusIndex : 0
      })
    } else {
      // 默认设置为活跃状态
      this.setData({
        'member.status': 'active',
        statusIndex: 0
      })
    }
  },

  // 输入
  onInput(e) {
    const key = e.currentTarget.dataset.key
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

    wx.showLoading({ title: '保存中...' })

    if (this.data.isEdit) {
      // 编辑模式 - 更新会员信息
      wx.cloud.callFunction({
        name: 'members',
        data: {
          action: 'updateById',
          _id: this.data.memberId,
          data: {
            name: member.name,
            phone: member.phone,
            status: member.status
          }
        },
        success: res => {
          wx.hideLoading()
          wx.showToast({ title: '保存成功', icon: 'success' })

          // 更新全局存储，通知列表页更新单个项目
          getApp().globalData.memberUpdate = {
            _id: this.data.memberId,
            name: member.name,
            phone: member.phone,
            status: member.status
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
    } else {
      // 新增模式
      wx.cloud.callFunction({
        name: 'members',
        data: {
          action: 'add',
          data: member
        },
        success: res => {
          wx.hideLoading()
          if (res.result.errMsg === 'already registered') {
            wx.showToast({ title: '会员已存在', icon: 'none' })
          } else {
            wx.showToast({ title: '新增成功', icon: 'success' })
            // 新增成功后，通知列表页刷新
            getApp().globalData.memberRefresh = true
            setTimeout(() => {
              wx.navigateBack()
            }, 500)
          }
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '新增失败', icon: 'error' })
        }
      })
    }
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
