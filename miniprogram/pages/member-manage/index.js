Page({
  data: {
    memberList: [],
    searchKeyword: '',
    filterStatus: '',
    page: 1,
    pageSize: 20,
    loading: false,
    noMore: false
  },

  onLoad() {
    this.getMemberList()
  },

  // 页面显示时检查是否有更新
  onShow() {
    const app = getApp()
    const { memberUpdate, memberDelete, memberRefresh } = app.globalData || {}

    if (memberUpdate) {
      // 更新单个会员
      this.updateMemberItem(memberUpdate)
      app.globalData.memberUpdate = null
    } else if (memberDelete) {
      // 删除单个会员
      this.deleteMemberItem(memberDelete)
      app.globalData.memberDelete = null
    } else if (memberRefresh) {
      // 刷新整个列表（新增会员后）
      this.setData({
        page: 1,
        memberList: [],
        noMore: false
      })
      this.getMemberList()
      app.globalData.memberRefresh = null
    }
  },

  // 更新单个会员项目
  updateMemberItem(updateData) {
    const { _id, name, phone, status, admin } = updateData
    const { memberList } = this.data

    const updatedList = memberList.map(item => {
      if (item._id === _id) {
        return {
          ...item,
          name,
          phone,
          status,
          admin
        }
      }
      return item
    })

    // 如果当前有状态筛选，检查更新后的会员是否还符合筛选条件
    const { filterStatus } = this.data
    let finalList = updatedList

    if (filterStatus) {
      // 如果有状态筛选，需要过滤并可能移除不符合条件的
      finalList = updatedList.filter(item => item.status === filterStatus)
    }

    this.setData({
      memberList: finalList
    })
  },

  // 删除单个会员项目
  deleteMemberItem(deleteId) {
    const { memberList } = this.data
    const filteredList = memberList.filter(item => item._id !== deleteId)

    this.setData({
      memberList: filteredList
    })
  },

  // 搜索输入
  onSearchInput(e) {
    this.setData({
      searchKeyword: e.detail.value
    })
  },

  // 清除搜索
  onClearSearch() {
    this.setData({
      searchKeyword: '',
      page: 1,
      memberList: [],
      noMore: false
    })
    this.getMemberList()
  },

  // 搜索
  onSearch() {
    this.setData({
      page: 1,
      memberList: [],
      noMore: false
    })
    this.getMemberList()
  },

  // 状态筛选
  onFilterStatus(e) {
    const status = e.currentTarget.dataset.status
    this.setData({
      filterStatus: status,
      page: 1,
      memberList: [],
      noMore: false
    })
    this.getMemberList()
  },

  // 格式化时间
  formatTime(time) {
    if (!time) return '未知'
    const date = new Date(time)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  },

  // 获取会员列表
  getMemberList() {
    if (this.data.loading || this.data.noMore) return

    this.setData({ loading: true })

    const { page, pageSize, searchKeyword, filterStatus } = this.data

    wx.cloud.callFunction({
      name: 'members',
      data: {
        action: 'search',
        keyword: searchKeyword,
        page,
        pageSize
      },
      success: res => {
        const newMembers = res.result.data || []

        // 格式化时间
        const formattedMembers = newMembers.map(item => ({
          ...item,
          formattedTime: this.formatTime(item.createTime)
        }))

        if (filterStatus) {
          // 前端过滤状态
          const filtered = formattedMembers.filter(item => item.status === filterStatus)
          this.setData({
            memberList: page === 1 ? filtered : [...this.data.memberList, ...filtered],
            noMore: newMembers.length < pageSize
          })
        } else {
          this.setData({
            memberList: page === 1 ? formattedMembers : [...this.data.memberList, ...formattedMembers],
            noMore: newMembers.length < pageSize
          })
        }
      },
      fail: err => {
        wx.showToast({
          title: '加载失败',
          icon: 'error'
        })
      },
      complete: () => {
        this.setData({ loading: false })
      }
    })
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.setData({
      page: 1,
      memberList: [],
      noMore: false
    })
    this.getMemberList()
    setTimeout(() => {
      wx.stopPullDownRefresh()
    }, 1000)
  },

  // 触底加载更多
  onReachBottom() {
    if (!this.data.loading && !this.data.noMore) {
      this.setData({
        page: this.data.page + 1
      })
      this.getMemberList()
    }
  },

  // 查看头像大图
  onAvatarTap(e) {
    const url = e.currentTarget.dataset.url
    if (url) {
      wx.previewImage({
        urls: [url],
        current: url
      })
    }
  },

  // 编辑会员
  onEditMember(e) {
    const member = e.currentTarget.dataset.member
    wx.navigateTo({
      url: `/pages/member-edit/index?member=${encodeURIComponent(JSON.stringify(member))}`
    })
  }
})
