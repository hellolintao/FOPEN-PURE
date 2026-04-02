Page({
  data: {
    isEdit: false,
    currentStep: 1,
    tournament: {
      name: '',
      seasonId: '',
      startDate: '',
      endDate: '',
      location: '',
      type: 'singles',
      format: 'regular',
      description: '',
      config: {
        maxPlayers: 16,
        totalRounds: 4,
        playersPerMatch: 2,
        eliminationType: 'single',
        currentRound: 1
      },
      pointsRules: {
        win: 100,
        loss: 20,
        walkover: 50,
        bonusByRound: {
          1: 0,
          2: 0,
          3: 0,
          4: 0,
          5: 0
        }
      }
    },
    // 赛季选项
    seasonOptions: [],
    seasonIndex: 0,
    // 类型选项
    typeOptions: [
      { label: '单打', value: 'singles' },
      { label: '双打', value: 'doubles' }
    ],
    typeIndex: 0,
    // 轮数选项
    roundsOptions: ['1', '2', '3', '4', '5', '6', '7', '8'],
    roundsIndex: 3,
    // 赛制选项
    formatOptions: [
      { label: '常规赛', value: 'regular' },
      { label: '淘汰赛', value: 'knockout' }
    ],
    formatIndex: 0,
    // 每场比赛人数选项
    playersPerMatchOptions: [
      { label: '2人（单打）', value: 2 },
      { label: '4人（双打）', value: 4 }
    ],
    playersPerMatchIndex: 0,
    // 淘汰类型选项
    eliminationOptions: [
      { label: '单败淘汰', value: 'single' },
      { label: '双败淘汰', value: 'double' }
    ],
    eliminationIndex: 0
  },

  onLoad(options) {
    // 加载赛季列表
    this.loadSeasons()

    // 如果是编辑模式，加载赛事数据
    if (options.id) {
      // 通过 id 从数据库加载
      this.loadTournamentById(options.id)
    } else if (options.tournament) {
      // 直接从参数加载
      this.loadTournamentData(options.tournament)
    }
  },

  // 通过 id 从数据库加载赛事数据
  async loadTournamentById(id) {
    wx.showLoading({ title: '加载中...' })

    try {
      const db = wx.cloud.database()
      const result = await db.collection('tournaments').doc(id).get()

      if (result.data) {
        wx.hideLoading()
        // 等待赛季列表加载完成后设置数据
        const tournament = result.data
        // 需要在赛季列表加载后才能正确设置 seasonIndex
        this.setData({ _pendingTournament: tournament })
        this.loadTournamentDataAfterSeasonsLoaded(tournament)
      } else {
        wx.hideLoading()
        wx.showToast({ title: '赛事不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
      }
    } catch (err) {
      wx.hideLoading()
      console.error('加载赛事数据失败', err)
      wx.showToast({ title: '加载失败', icon: 'error' })
    }
  },

  // 赛季列表加载后设置赛事数据
  loadTournamentDataAfterSeasonsLoaded(tournament) {
    const seasonOptions = this.data.seasonOptions

    // 查找对应的索引
    const seasonIndex = seasonOptions.findIndex(s => s.value === tournament.seasonId)
    const typeIndex = this.data.typeOptions.findIndex(t => t.value === tournament.type)
    const roundsIndex = this.data.roundsOptions.indexOf(tournament.config?.totalRounds?.toString() || '4')
    const formatIndex = this.data.formatOptions.findIndex(f => f.value === (tournament.format || 'regular'))
    const eliminationIndex = this.data.eliminationOptions.findIndex(
      e => e.value === (tournament.config?.eliminationType || 'single')
    )

    // 根据赛事类型自动设置每场比赛人数
    const playersPerMatch = tournament.type === 'doubles' ? 4 : 2

    this.setData({
      isEdit: true,
      tournament: {
        ...tournament,
        format: tournament.format || 'regular',
        config: {
          ...tournament.config,
          playersPerMatch
        }
      },
      seasonIndex: seasonIndex >= 0 ? seasonIndex : 0,
      typeIndex: typeIndex >= 0 ? typeIndex : 0,
      roundsIndex: roundsIndex >= 0 ? roundsIndex : 3,
      formatIndex: formatIndex >= 0 ? formatIndex : 0,
      playersPerMatchIndex: 0,
      eliminationIndex: eliminationIndex >= 0 ? eliminationIndex : 0
    })
  },

  // 修改 loadSeasons 方法，加载完成后检查是否有待加载的赛事数据
  loadSeasons() {
    wx.cloud.callFunction({
      name: 'seasons',
      data: { action: 'list', pageSize: 100 },
      success: res => {
        const seasonOptions = (res.result.data || []).map(s => ({
          label: s.name,
          value: s._id
        }))

        this.setData({
          seasonOptions,
          seasonIndex: 0
        })

        // 如果有待加载的赛事数据，现在加载它
        if (this.data._pendingTournament) {
          this.loadTournamentDataAfterSeasonsLoaded(this.data._pendingTournament)
        }

        // 如果没有赛季数据，提示用户
        if (seasonOptions.length === 0) {
          wx.showToast({
            title: '暂无赛季，请先创建赛季',
            icon: 'none',
            duration: 2000
          })
        } else {
          // 新增模式下，默认选中第一个赛季
          if (!this.data.isEdit && !this.data._pendingTournament) {
            this.setData({
              'tournament.seasonId': seasonOptions[0].value
            })
          }
        }
      },
      fail: err => {
        console.error('加载赛季列表失败', err)
        wx.showToast({
          title: '加载赛季列表失败',
          icon: 'error'
        })
      }
    })
  },

  // 加载赛季列表
  loadSeasons() {
    wx.cloud.callFunction({
      name: 'seasons',
      data: { action: 'list', pageSize: 100 },
      success: res => {
        const seasonOptions = (res.result.data || []).map(s => ({
          label: s.name,
          value: s._id
        }))

        this.setData({
          seasonOptions,
          seasonIndex: 0
        })

        // 如果没有赛季数据，提示用户
        if (seasonOptions.length === 0) {
          wx.showToast({
            title: '暂无赛季，请先创建赛季',
            icon: 'none',
            duration: 2000
          })
        } else {
          // 新增模式下，默认选中第一个赛季
          if (!this.data.isEdit) {
            this.setData({
              'tournament.seasonId': seasonOptions[0].value
            })
          }
        }
      },
      fail: err => {
        console.error('加载赛季列表失败', err)
        wx.showToast({
          title: '加载赛季列表失败',
          icon: 'error'
        })
      }
    })
  },

  // 加载赛事数据（编辑模式）
  loadTournamentData(tournamentStr) {
    try {
      const tournament = JSON.parse(decodeURIComponent(tournamentStr))
      const seasonOptions = this.data.seasonOptions

      // 查找对应的索引
      const seasonIndex = seasonOptions.findIndex(s => s.value === tournament.seasonId)
      const typeIndex = this.data.typeOptions.findIndex(t => t.value === tournament.type)
      const roundsIndex = this.data.roundsOptions.indexOf(tournament.config?.totalRounds?.toString() || '4')
      const formatIndex = this.data.formatOptions.findIndex(f => f.value === (tournament.format || 'regular'))
      const eliminationIndex = this.data.eliminationOptions.findIndex(
        e => e.value === (tournament.config?.eliminationType || 'single')
      )

      // 根据赛事类型自动设置每场比赛人数
      const playersPerMatch = tournament.type === 'doubles' ? 4 : 2

      this.setData({
        isEdit: true,
        tournament: {
          ...tournament,
          format: tournament.format || 'regular',
          config: {
            ...tournament.config,
            playersPerMatch
          }
        },
        seasonIndex: seasonIndex >= 0 ? seasonIndex : 0,
        typeIndex: typeIndex >= 0 ? typeIndex : 0,
        roundsIndex: roundsIndex >= 0 ? roundsIndex : 3,
        formatIndex: formatIndex >= 0 ? formatIndex : 0,
        playersPerMatchIndex: 0,
        eliminationIndex: eliminationIndex >= 0 ? eliminationIndex : 0
      })
    } catch (err) {
      console.error('加载赛事数据失败', err)
      wx.showToast({
        title: '加载赛事数据失败',
        icon: 'error'
      })
    }
  },

  // 输入事件
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const section = e.currentTarget.dataset.section

    if (section === 'config') {
      // 配置相关输入，保持数值类型
      const value = e.detail.value
      // 如果是数字类型字段，转换为整数
      const numValue = ['maxPlayers', 'currentRound', 'totalRounds', 'playersPerMatch'].includes(key)
        ? parseInt(value) || 0
        : value
      this.setData({ [`tournament.config.${key}`]: numValue })
    } else if (section === 'pointsRules') {
      // 积分规则相关输入，转换为整数
      const value = parseInt(e.detail.value) || 0
      this.setData({ [`tournament.pointsRules.${key}`]: value })
    } else if (section === 'bonus') {
      // 轮次奖励积分，转换为整数
      const value = parseInt(e.detail.value) || 0
      this.setData({ [`tournament.pointsRules.bonusByRound.${key}`]: value })
    } else {
      // 普通输入，保持原样
      this.setData({ [`tournament.${key}`]: e.detail.value })
    }
  },

  // 选择赛季
  onPickSeason(e) {
    const idx = e.detail.value
    this.setData({
      seasonIndex: idx,
      'tournament.seasonId': this.data.seasonOptions[idx].value
    })
  },

  // 选择类型
  onPickType(e) {
    const idx = e.detail.value
    const type = this.data.typeOptions[idx].value
    // 根据赛事类型自动设置每场比赛人数：双打为4，单打为2
    const playersPerMatch = type === 'doubles' ? 4 : 2

    this.setData({
      typeIndex: idx,
      'tournament.type': type,
      'tournament.config.playersPerMatch': playersPerMatch
    })
  },

  // 选择轮数
  onPickRounds(e) {
    const idx = e.detail.value
    const rounds = parseInt(this.data.roundsOptions[idx])
    this.setData({
      roundsIndex: idx,
      'tournament.config.totalRounds': rounds
    })
  },

  // 选择赛制
  onPickFormat(e) {
    const idx = e.detail.value
    const format = this.data.formatOptions[idx].value

    // 根据赛制自动设置轮次奖励积分
    let bonusByRound
    if (format === 'regular') {
      // 常规赛：所有轮次奖励积分设为0
      bonusByRound = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    } else {
      // 淘汰赛：第一轮-第六轮的奖励积分分别是0、50、100、200、300
      bonusByRound = { 1: 0, 2: 50, 3: 100, 4: 200, 5: 300 }
    }

    this.setData({
      formatIndex: idx,
      'tournament.format': format,
      'tournament.pointsRules.bonusByRound': bonusByRound
    })
  },

  // 选择每场比赛人数
  onPickPlayersPerMatch(e) {
    const idx = e.detail.value
    const playersPerMatch = this.data.playersPerMatchOptions[idx].value
    this.setData({
      playersPerMatchIndex: idx,
      'tournament.config.playersPerMatch': playersPerMatch
    })
  },

  // 选择淘汰类型
  onPickElimination(e) {
    const idx = e.detail.value
    this.setData({
      eliminationIndex: idx,
      'tournament.config.eliminationType': this.data.eliminationOptions[idx].value
    })
  },

  // 选择开始日期
  onPickStart(e) {
    this.setData({ 'tournament.startDate': e.detail.value })
  },

  // 选择结束日期
  onPickEnd(e) {
    this.setData({ 'tournament.endDate': e.detail.value })
  },

  // 下一步
  onNextStep() {
    if (!this.validateCurrentStep()) {
      return
    }

    const nextStep = this.data.currentStep + 1
    this.setData({ currentStep: nextStep })
  },

  // 上一步
  onPrevStep() {
    const prevStep = this.data.currentStep - 1
    this.setData({ currentStep: prevStep })
  },

  // 验证当前步骤
  validateCurrentStep() {
    const { tournament, currentStep } = this.data

    if (currentStep === 1) {
      // 第一步验证
      if (!tournament.name || tournament.name.trim() === '') {
        wx.showToast({ title: '请输入赛事名称', icon: 'none' })
        return false
      }
      if (!tournament.seasonId) {
        wx.showToast({ title: '请选择所属赛季', icon: 'none' })
        return false
      }
      if (!tournament.startDate) {
        wx.showToast({ title: '请选择开始日期', icon: 'none' })
        return false
      }
      if (!tournament.type) {
        wx.showToast({ title: '请选择赛事类型', icon: 'none' })
        return false
      }
    } else if (currentStep === 2) {
      // 第二步验证
      if (!tournament.config.maxPlayers || tournament.config.maxPlayers < 2 || tournament.config.maxPlayers > 64) {
        wx.showToast({ title: '参赛人数必须在2-64之间', icon: 'none' })
        return false
      }
      if (!tournament.config.totalRounds || tournament.config.totalRounds < 1 || tournament.config.totalRounds > 8) {
        wx.showToast({ title: '轮数必须在1-8之间', icon: 'none' })
        return false
      }
      if (!tournament.format || !['regular', 'knockout'].includes(tournament.format)) {
        wx.showToast({ title: '请选择赛制', icon: 'none' })
        return false
      }
      if (!tournament.config.playersPerMatch || ![2, 4].includes(tournament.config.playersPerMatch)) {
        wx.showToast({ title: '每场比赛人数必须是2或4', icon: 'none' })
        return false
      }
    } else if (currentStep === 3) {
      // 第三步验证
      if (tournament.pointsRules.win === undefined || tournament.pointsRules.win === '') {
        wx.showToast({ title: '请输入胜利积分', icon: 'none' })
        return false
      }
      if (tournament.pointsRules.loss === undefined || tournament.pointsRules.loss === '') {
        wx.showToast({ title: '请输入失败积分', icon: 'none' })
        return false
      }
      if (tournament.pointsRules.walkover === undefined || tournament.pointsRules.walkover === '') {
        wx.showToast({ title: '请输入弃权积分', icon: 'none' })
        return false
      }
    }

    return true
  },

  // 提交
  onSubmit() {
    // 确保所有步骤都已验证
    if (this.data.currentStep !== 3) {
      wx.showToast({ title: '请完成所有步骤', icon: 'none' })
      return
    }

    if (!this.validateCurrentStep()) {
      return
    }

    const tournament = this.data.tournament

    console.log('当前 tournament 数据:', JSON.stringify(tournament, null, 2))

    // 确保数值类型正确
    const submitData = {
      name: tournament.name,
      seasonId: tournament.seasonId,
      startDate: tournament.startDate,
      endDate: '',
      location: '',
      type: tournament.type,
      format: tournament.format || 'regular',
      description: tournament.description,
      status: this.data.isEdit ? tournament.status : 'upcoming',
      config: {
        maxPlayers: parseInt(tournament.config?.maxPlayers) || 16,
        currentRound: parseInt(tournament.config?.currentRound) || 1,
        totalRounds: parseInt(tournament.config?.totalRounds) || 4,
        playersPerMatch: parseInt(tournament.config?.playersPerMatch) || 2,
        eliminationType: tournament.config?.eliminationType || 'single',
        seedPlayers: tournament.config?.seedPlayers || []
      },
      pointsRules: {
        win: parseInt(tournament.pointsRules && tournament.pointsRules.win) || 100,
        loss: parseInt(tournament.pointsRules && tournament.pointsRules.loss) || 20,
        walkover: parseInt(tournament.pointsRules && tournament.pointsRules.walkover) || 50,
        bonusByRound: {
          1: parseInt(tournament.pointsRules && tournament.pointsRules.bonusByRound && tournament.pointsRules.bonusByRound[1]) || 0,
          2: parseInt(tournament.pointsRules && tournament.pointsRules.bonusByRound && tournament.pointsRules.bonusByRound[2]) || 0,
          3: parseInt(tournament.pointsRules && tournament.pointsRules.bonusByRound && tournament.pointsRules.bonusByRound[3]) || 0,
          4: parseInt(tournament.pointsRules && tournament.pointsRules.bonusByRound && tournament.pointsRules.bonusByRound[4]) || 0,
          5: parseInt(tournament.pointsRules && tournament.pointsRules.bonusByRound && tournament.pointsRules.bonusByRound[5]) || 0
        }
      }
    }

    console.log('准备提交的数据:', JSON.stringify(submitData, null, 2))

    wx.showLoading({ title: this.data.isEdit ? '保存中...' : '提交中...' })

    if (this.data.isEdit) {
      // 编辑模式
      const { _id } = tournament

      wx.cloud.callFunction({
        name: 'tournaments',
        data: {
          action: 'update',
          id: _id,
          data: submitData
        },
        success: res => {
          wx.hideLoading()
          console.log('更新结果:', res)
          if (res.result.errMsg === 'validation failed') {
            wx.showModal({
              title: '数据验证失败',
              content: res.result.errors.join('\n'),
              showCancel: false
            })
          } else {
            wx.showToast({ title: '保存成功', icon: 'success' })
            // 通知列表页刷新
            setTimeout(() => {
              wx.navigateBack()
            }, 500)
          }
        },
        fail: err => {
          wx.hideLoading()
          console.error('保存失败', err)
          wx.showToast({ title: '保存失败', icon: 'error' })
        }
      })
    } else {
      // 新增模式
      wx.cloud.callFunction({
        name: 'tournaments',
        data: {
          action: 'add',
          data: submitData
        },
        success: res => {
          wx.hideLoading()
          console.log('新增结果:', res)
          if (res.result.errMsg === 'validation failed') {
            wx.showModal({
              title: '数据验证失败',
              content: res.result.errors.join('\n'),
              showCancel: false
            })
          } else {
            wx.showToast({ title: '新增成功', icon: 'success' })
            setTimeout(() => {
              wx.navigateBack()
            }, 500)
          }
        },
        fail: err => {
          wx.hideLoading()
          console.error('新增失败', err)
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
