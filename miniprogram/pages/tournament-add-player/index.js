Page({
  data: {
    tournamentId: '',
    tournament: null,
    selectedMembers: [],
    originalRegistrationIds: [], // 存储初始的报名记录ID
    memberList: [],
    searchKeyword: '',
    loading: false
  },

  onLoad(options) {
    const { id } = options
    if (id) {
      this.setData({ tournamentId: id })
      this.loadTournament()
      this.loadMembers()
      this.loadRegisteredMembers()
    }
  },

  // 加载赛事信息
  async loadTournament() {
    try {
      const db = wx.cloud.database()
      const result = await db.collection('tournaments').doc(this.data.tournamentId).get()
      if (result.data) {
        this.setData({ tournament: result.data })
      }
    } catch (err) {
      console.error('加载赛事信息失败:', err)
    }
  },

  // 加载已报名人员
  async loadRegisteredMembers() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: {
          action: 'list',
          tournamentId: this.data.tournamentId
        }
      })

      if (result.result.data) {
        const registrations = result.result.data
        const selectedMembers = registrations.map(r => ({
          _id: r.playerId,
          name: r.playerName,
          avatarUrl: '', // 需要从member表获取头像
          registrationId: r._id
        }))
        const originalRegistrationIds = registrations.map(r => r._id)

        this.setData({
          selectedMembers,
          originalRegistrationIds
        })
      }
    } catch (err) {
      console.error('加载已报名人员失败:', err)
    }
  },

  // 加载会员列表
  async loadMembers() {
    this.setData({ loading: true })

    try {
      wx.cloud.callFunction({
        name: 'members',
        data: {
          action: 'list',
          pageSize: 100
        },
        success: res => {
          const list = res.result.data || []
          this.setData({
            memberList: list,
            loading: false
          })
        },
        fail: err => {
          console.error('加载会员列表失败', err)
          wx.showToast({
            title: '加载失败',
            icon: 'error'
          })
          this.setData({ loading: false })
        }
      })
    } catch (err) {
      console.error('加载会员列表失败:', err)
      this.setData({ loading: false })
    }
  },

  // 搜索输入
  onSearchInput(e) {
    const keyword = e.detail.value
    this.setData({ searchKeyword: keyword })
    this.onSearch()
  },

  // 搜索
  onSearch() {
    const { searchKeyword } = this.data
    if (!searchKeyword || searchKeyword.trim() === '') {
      this.loadMembers()
      return
    }

    wx.cloud.callFunction({
      name: 'members',
      data: {
        action: 'search',
        keyword: searchKeyword.trim()
      },
      success: res => {
        this.setData({ memberList: res.result.data || [] })
      },
      fail: err => {
        console.error('搜索失败', err)
        wx.showToast({ title: '搜索失败', icon: 'error' })
      }
    })
  },

  // 清空搜索
  onClearSearch() {
    this.setData({ searchKeyword: '' })
    this.loadMembers()
  },

  // 检查会员是否已选择
  isMemberSelected(memberId) {
    return this.data.selectedMembers.some(m => m._id === memberId)
  },

  // 选择会员
  onSelectMember(e) {
    const member = e.currentTarget.dataset.member
    if (this.isMemberSelected(member._id)) {
      wx.showToast({
        title: '该会员已添加',
        icon: 'none'
      })
      return
    }

    const selectedMembers = [...this.data.selectedMembers, member]
    this.setData({ selectedMembers })

    wx.vibrateShort()
  },

  // 移除会员
  onRemoveMember(e) {
    const member = e.currentTarget.dataset.member
    const selectedMembers = this.data.selectedMembers.filter(m => m._id !== member._id)
    this.setData({ selectedMembers })
  },

  // 提交
  async onSubmit() {
    const { selectedMembers, tournament, tournamentId, originalRegistrationIds } = this.data

    if (!tournament) {
      wx.showToast({
        title: '赛事信息加载失败',
        icon: 'none'
      })
      return
    }

    if (selectedMembers.length === 0) {
      wx.showToast({
        title: '请选择参赛人员',
        icon: 'none'
      })
      return
    }

    // 检查是否超出最大参赛人数
    if (tournament.config.maxPlayers && selectedMembers.length > tournament.config.maxPlayers) {
      wx.showToast({
        title: `最多只能添加${tournament.config.maxPlayers}人`,
        icon: 'none'
      })
      return
    }

    wx.showLoading({ title: '提交中...' })

    try {
      // 1. 找出需要删除的报名记录（原来有，现在没有的）
      const currentRegistrationIds = selectedMembers
        .filter(m => m.registrationId)
        .map(m => m.registrationId)

      const toDeleteIds = originalRegistrationIds.filter(id => !currentRegistrationIds.includes(id))

      // 2. 删除移除的人员
      if (toDeleteIds.length > 0) {
        const deletePromises = toDeleteIds.map(id =>
          wx.cloud.callFunction({
            name: 'tournament-registrations',
            data: {
              action: 'delete',
              id
            }
          })
        )
        await Promise.all(deletePromises)
      }

      // 3. 找出需要新增的人员（原来没有的）
      const toAddMembers = selectedMembers.filter(m => !m.registrationId)

      // 4. 添加新的人员
      if (toAddMembers.length > 0) {
        // 获取当前已有的报名数量，用于计算种子排名
        const countResult = await wx.cloud.callFunction({
          name: 'tournament-registrations',
          data: {
            action: 'list',
            tournamentId,
            pageSize: 100
          }
        })

        const existingCount = (countResult.result.data || []).filter(r => !toDeleteIds.includes(r._id)).length

        const addPromises = toAddMembers.map((member, index) => {
          return wx.cloud.callFunction({
            name: 'tournament-registrations',
            data: {
              action: 'add',
              data: {
                tournamentId,
                seasonId: tournament.seasonId,
                type: tournament.type,
                playerId: member._id,
                playerName: member.name,
                seed: existingCount + index + 1,
                status: 'confirmed'
              }
            }
          })
        })

        await Promise.all(addPromises)
      }

      wx.hideLoading()
      wx.showToast({
        title: '更新成功',
        icon: 'success'
      })
      setTimeout(() => {
        wx.navigateBack()
      }, 1500)

    } catch (err) {
      wx.hideLoading()
      console.error('提交失败:', err)
      wx.showToast({
        title: '提交失败',
        icon: 'error'
      })
    }
  },

  onShow() {
    // 页面显示时重新加载已报名人员
    if (this.data.tournamentId) {
      this.loadRegisteredMembers()
    }
  }
})
