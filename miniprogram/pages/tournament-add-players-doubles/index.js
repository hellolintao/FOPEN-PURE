Page({
  data: {
    tournamentId: '',
    pickerMode: '',
    tournament: null,
    teams: [],
    memberList: [],
    searchKeyword: '',
    loading: false,
    editingTeam: null,
    player1Index: -1,
    player2Index: -1,
    showPlayerSelector: false,
    filteredMemberList: [],
    selectingPlayerType: null // 'player1' or 'player2'
  },

  onLoad(options) {
    const { id, tournamentId, pickerMode } = options
    const tid = id || tournamentId || ''
    this.setData({ tournamentId: tid, pickerMode: pickerMode === '1' ? '1' : '' })
    this.loadMembers()
    if (tid) {
      this.loadTournament()
      if (pickerMode !== '1') {
        this.loadRegisteredTeams()
      }
    }
  },

  // 加载赛事信息
  async loadTournament() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'tournaments',
        data: { action: 'get', id: this.data.tournamentId }
      })
      const tournament = unpackTournamentRecord(result)
      if (tournament) {
        this.setData({ tournament })
      }
    } catch (err) {
      console.error('加载赛事信息失败:', err)
    }
  },

  // 加载已报名队伍
  async loadRegisteredTeams() {
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
        const teams = registrations.map(r => ({
          _id: r._id,
          teamName: r.teamName || '',
          player1: {
            _id: r.playerId,
            name: r.playerName
          },
          player2: {
            _id: r.partnerId,
            name: r.partnerName
          },
          seed: r.seed
        }))

        this.setData({ teams })
      }
    } catch (err) {
      console.error('加载已报名队伍失败:', err)
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
    const { searchKeyword, memberList } = this.data
    if (!searchKeyword || searchKeyword.trim() === '') {
      this.setData({ filteredMemberList: memberList })
      return
    }

    const keyword = searchKeyword.trim().toLowerCase()
    const filtered = memberList.filter(m => {
      return m.name && m.name.toLowerCase().includes(keyword)
    })

    this.setData({ filteredMemberList: filtered })
  },

  // 清空搜索
  onClearSearch() {
    this.setData({ searchKeyword: '', filteredMemberList: this.data.memberList })
  },

  // 检查会员是否已选择
  isMemberSelected(memberId) {
    return this.data.teams.some(t => t.player1._id === memberId || t.player2._id === memberId)
  },

  // 添加队伍
  onAddTeam() {
    const { tournament, teams } = this.data
    if (!tournament) {
      wx.showToast({
        title: '赛事信息加载失败',
        icon: 'none'
      })
      return
    }

    if (tournament.config.maxPlayers && teams.length >= tournament.config.maxPlayers) {
      wx.showToast({
        title: `最多只能添加${tournament.config.maxPlayers}支队伍`,
        icon: 'none'
      })
      return
    }

    const editingTeam = {
      _id: null,
      teamName: '',
      player1: null,
      player2: null,
      isNew: true
    }

    this.setData({
      editingTeam,
      player1Index: -1,
      player2Index: -1
    })
  },

  // 编辑队伍
  onEditTeam(e) {
    const team = e.currentTarget.dataset.team
    const { memberList } = this.data

    const player1Index = team.player1 ? memberList.findIndex(m => m._id === team.player1._id) : -1
    const player2Index = team.player2 ? memberList.findIndex(m => m._id === team.player2._id) : -1

    this.setData({
      editingTeam: { ...team },
      player1Index,
      player2Index
    })
  },

  // 关闭编辑弹窗
  onCloseEdit() {
    this.setData({
      editingTeam: null,
      player1Index: -1,
      player2Index: -1
    })
  },

  // 显示队员选择器
  onShowPlayerSelector() {
    this.setData({
      showPlayerSelector: true,
      filteredMemberList: this.data.memberList,
      searchKeyword: ''
    })
  },

  // 关闭队员选择器
  onClosePlayerSelector() {
    this.setData({
      showPlayerSelector: false,
      selectingPlayerType: null,
      searchKeyword: ''
    })
  },

  // 检查会员是否被选中（根据当前选择类型）
  isMemberSelectedForType(memberId) {
    const { editingTeam, selectingPlayerType } = this.data
    if (selectingPlayerType === 'player1') {
      return editingTeam.player1 && editingTeam.player1._id === memberId
    } else if (selectingPlayerType === 'player2') {
      return editingTeam.player2 && editingTeam.player2._id === memberId
    }
    return false
  },

  // 点击队员1选择器
  onSelectPlayer1Selector() {
    this.setData({ selectingPlayerType: 'player1' })
    this.onShowPlayerSelector()
  },

  // 点击队员2选择器
  onSelectPlayer2Selector() {
    this.setData({ selectingPlayerType: 'player2' })
    this.onShowPlayerSelector()
  },

  // 选中会员
  onSelectMember(e) {
    const member = e.currentTarget.dataset.member
    const type = e.currentTarget.dataset.type
    const editingTeam = { ...this.data.editingTeam }

    if (type === 'player1') {
      if (editingTeam.player2 && editingTeam.player2._id === member._id) {
        wx.showToast({
          title: '不能选择相同的队员',
          icon: 'none'
        })
        return
      }
      editingTeam.player1 = {
        _id: member._id,
        name: member.name
      }
    } else if (type === 'player2') {
      if (editingTeam.player1 && editingTeam.player1._id === member._id) {
        wx.showToast({
          title: '不能选择相同的队员',
          icon: 'none'
        })
        return
      }
      editingTeam.player2 = {
        _id: member._id,
        name: member.name
      }
    }

    this.setData({
      editingTeam,
      showPlayerSelector: false,
      selectingPlayerType: null,
      searchKeyword: ''
    })
  },

  // 输入队伍名称
  onTeamNameInput(e) {
    const editingTeam = { ...this.data.editingTeam }
    editingTeam.teamName = e.detail.value
    this.setData({ editingTeam })
  },

  // 保存队伍
  onSaveTeam() {
    const { editingTeam, tournament, tournamentId, pickerMode, teams } = this.data

    if (!editingTeam.player1 || !editingTeam.player2) {
      wx.showToast({
        title: '请选择两名队员',
        icon: 'none'
      })
      return
    }

    if (!editingTeam.teamName || editingTeam.teamName.trim() === '') {
      wx.showToast({
        title: '请输入队伍名称',
        icon: 'none'
      })
      return
    }

    // pickerMode=1: add to local teams list, do not write to DB
    if (pickerMode === '1') {
      const newTeam = {
        _id: null,
        teamName: editingTeam.teamName.trim(),
        player1: editingTeam.player1,
        player2: editingTeam.player2,
        seed: teams.length + 1
      }
      this.setData({ teams: [...teams, newTeam], editingTeam: null })
      return
    }

    const data = {
      tournamentId,
      seasonId: tournament && tournament.seasonId,
      type: 'doubles',
      playerId: editingTeam.player1._id,
      playerName: editingTeam.player1.name,
      partnerId: editingTeam.player2._id,
      partnerName: editingTeam.player2.name,
      teamName: editingTeam.teamName.trim(),
      seed: editingTeam.seed,
      status: 'confirmed'
    }

    wx.showLoading({ title: '保存中...' })

    const promise = editingTeam._id
      ? wx.cloud.callFunction({
          name: 'tournament-registrations',
          data: {
            action: 'update',
            id: editingTeam._id,
            data
          }
        })
      : wx.cloud.callFunction({
          name: 'tournament-registrations',
          data: {
            action: 'add',
            data
          }
        })

    promise
      .then(() => {
        wx.hideLoading()
        wx.showToast({
          title: '保存成功',
          icon: 'success'
        })
        this.setData({ editingTeam: null })
        this.loadRegisteredTeams()
      })
      .catch(err => {
        wx.hideLoading()
        console.error('保存失败:', err)
        wx.showToast({
          title: '保存失败',
          icon: 'error'
        })
      })
  },

  // pickerMode=1: confirm and return all teams to wizard
  onConfirmPickerMode() {
    const { teams, pickerMode } = this.data
    if (pickerMode !== '1') return
    if (teams.length === 0) {
      wx.showToast({ title: '请至少添加一支队伍', icon: 'none' })
      return
    }
    const app = getApp()
    app.globalData.lastSelectedPlayers = teams.map(t => ({
      playerId: t.player1._id,
      playerName: t.player1.name,
      partnerId: t.player2._id,
      partnerName: t.player2.name,
      teamName: t.teamName
    }))
    wx.navigateBack()
  },

  // 删除队伍
  onDeleteTeam(e) {
    const team = e.currentTarget.dataset.team

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这支队伍吗？',
      confirmColor: '#f56c6c',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })

          wx.cloud.callFunction({
            name: 'tournament-registrations',
            data: {
              action: 'delete',
              id: team._id
            },
            success: () => {
              wx.hideLoading()
              wx.showToast({
                title: '删除成功',
                icon: 'success'
              })
              this.loadRegisteredTeams()
            },
            fail: err => {
              wx.hideLoading()
              console.error('删除失败:', err)
              wx.showToast({
                title: '删除失败',
                icon: 'error'
              })
            }
          })
        }
      }
    })
  }
})

function unpackTournamentRecord(res) {
  const data = res && res.result && res.result.data
  if (data && data.tournament) return data.tournament
  if (data) return data
  return null
}
