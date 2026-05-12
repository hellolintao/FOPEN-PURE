const TOTAL_STEPS = 5
const STEP_TITLES = ['基本信息', '场地时段', '积分规则', '选手', '确认提交']

const DEFAULT_CONFIG = {
  maxPlayers: 16,
  currentRound: 1,
  totalRounds: 4,
  playersPerMatch: 2,
  eliminationType: 'single',
  seedPlayers: []
}

const DEFAULT_POINTS = {
  win: 100,
  loss: 20,
  walkover: 50,
  bonusByRound: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
}

const KNOCKOUT_BONUS = { 1: 0, 2: 50, 3: 100, 4: 200, 5: 300 }

Page({
  data: {
    isEdit: false,
    currentStep: 1,
    totalSteps: TOTAL_STEPS,
    stepTitles: STEP_TITLES,

    tournament: {
      name: '',
      seasonId: '',
      startDate: '',
      endDate: '',
      location: '',
      type: 'singles',
      format: 'regular',
      description: '',
      config: { ...DEFAULT_CONFIG },
      pointsRules: {
        ...DEFAULT_POINTS,
        bonusByRound: { ...DEFAULT_POINTS.bonusByRound }
      },
      courtTimeGrid: null
    },

    seasonOptions: [],
    seasonIndex: 0,
    typeOptions: [
      { label: '单打', value: 'singles' },
      { label: '双打', value: 'doubles' }
    ],
    typeIndex: 0,
    formatOptions: [
      { label: '常规赛', value: 'regular' },
      { label: '淘汰赛', value: 'knockout' }
    ],
    formatIndex: 0,

    allMembers: [],
    selectedPlayerIds: [],
    selectedPlayerMap: {},
    existingRegistrations: [],
    selectedPairPreviews: []
  },

  onLoad(options) {
    this.loadSeasons()
    this.loadMembers()

    if (options.id) {
      this.loadTournamentById(options.id)
    } else if (options.tournament) {
      this.loadTournamentFromParam(options.tournament)
    }
  },

  loadSeasons() {
    wx.cloud.callFunction({
      name: 'seasons',
      data: { action: 'list', pageSize: 100 },
      success: res => {
        const seasonOptions = (res.result.data || []).map(s => ({
          label: s.name,
          value: s._id
        }))
        this.setData({ seasonOptions, seasonIndex: 0 })

        if (this.data._pendingTournament) {
          this.applyTournament(this.data._pendingTournament)
          this.setData({ _pendingTournament: null })
          return
        }

        if (seasonOptions.length === 0) {
          wx.showToast({ title: '暂无赛季，请先创建赛季', icon: 'none', duration: 2000 })
        } else if (!this.data.isEdit) {
          this.setData({ 'tournament.seasonId': seasonOptions[0].value })
        }
      },
      fail: err => {
        console.error('加载赛季列表失败', err)
        wx.showToast({ title: '加载赛季列表失败', icon: 'error' })
      }
    })
  },

  async loadMembers() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'members',
        data: { action: 'list', pageSize: 200 }
      })
      const allMembers = res.result.data || []
      this.setData({
        allMembers,
        selectedPairPreviews: this._buildSelectedPairPreviews(this.data.selectedPlayerIds, allMembers)
      })
    } catch (err) {
      console.error('加载会员失败', err)
      wx.showToast({ title: '加载会员失败', icon: 'none' })
    }
  },

  async loadTournamentById(id) {
    wx.showLoading({ title: '加载中...' })
    try {
      const db = wx.cloud.database()
      const result = await db.collection('tournaments').doc(id).get()
      wx.hideLoading()

      if (!result.data) {
        wx.showToast({ title: '赛事不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }

      if (this.data.seasonOptions.length === 0) {
        this.setData({ _pendingTournament: result.data, isEdit: true })
      } else {
        this.applyTournament(result.data)
      }

      this.loadExistingRegistrations(id)
    } catch (err) {
      wx.hideLoading()
      console.error('加载赛事数据失败', err)
      wx.showToast({ title: '加载失败', icon: 'error' })
    }
  },

  loadTournamentFromParam(tournamentStr) {
    try {
      const tournament = JSON.parse(decodeURIComponent(tournamentStr))
      if (this.data.seasonOptions.length === 0) {
        this.setData({ _pendingTournament: tournament, isEdit: true })
      } else {
        this.applyTournament(tournament)
      }
    } catch (err) {
      console.error('加载赛事数据失败', err)
      wx.showToast({ title: '加载赛事数据失败', icon: 'error' })
    }
  },

  applyTournament(tournament) {
    const seasonIndex = Math.max(
      this.data.seasonOptions.findIndex(s => s.value === tournament.seasonId),
      0
    )
    const typeIndex = Math.max(
      this.data.typeOptions.findIndex(t => t.value === tournament.type),
      0
    )
    const formatIndex = Math.max(
      this.data.formatOptions.findIndex(f => f.value === (tournament.format || 'regular')),
      0
    )

    this.setData({
      isEdit: true,
      tournament: {
        ...tournament,
        format: tournament.format || 'regular',
        config: { ...DEFAULT_CONFIG, ...(tournament.config || {}) },
        pointsRules: {
          ...DEFAULT_POINTS,
          ...(tournament.pointsRules || {}),
          bonusByRound: {
            ...DEFAULT_POINTS.bonusByRound,
            ...((tournament.pointsRules && tournament.pointsRules.bonusByRound) || {})
          }
        },
        courtTimeGrid: tournament.courtTimeGrid || null
      },
      seasonIndex,
      typeIndex,
      formatIndex
    })
  },

  async loadExistingRegistrations(tournamentId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'list', tournamentId, pageSize: 200, pageNum: 1 }
      })
      const registrations = res.result.data || []
      const selectedPlayerIds = []
      registrations.forEach(r => {
        if (r.playerId) selectedPlayerIds.push(r.playerId)
        if (r.type === 'doubles' && r.partnerId) selectedPlayerIds.push(r.partnerId)
      })
      this.setData({ existingRegistrations: registrations })
      this._setSelectedPlayers(selectedPlayerIds)
    } catch (err) {
      console.warn('加载报名列表失败（忽略）', err)
    }
  },

  _setSelectedPlayers(ids) {
    const uniqueIds = []
    ids.forEach(id => {
      if (id && uniqueIds.indexOf(id) === -1) uniqueIds.push(id)
    })
    const selectedPlayerMap = uniqueIds.reduce((m, id) => { m[id] = true; return m }, {})
    this.setData({
      selectedPlayerIds: uniqueIds,
      selectedPlayerMap,
      selectedPairPreviews: this._buildSelectedPairPreviews(uniqueIds)
    })
  },

  _buildSelectedPairPreviews(ids, members = this.data.allMembers) {
    const nameOf = id => {
      const member = members.find(m => m._id === id)
      return member ? member.name : '未加载'
    }
    const pairs = []
    for (let i = 0; i < ids.length; i += 2) {
      pairs.push({
        index: Math.floor(i / 2) + 1,
        player1: nameOf(ids[i]),
        player2: ids[i + 1] ? nameOf(ids[i + 1]) : '待选择'
      })
    }
    return pairs
  },

  onInputName(e) {
    this.setData({ 'tournament.name': e.detail.value })
  },

  onInputDescription(e) {
    this.setData({ 'tournament.description': e.detail.value })
  },

  onInputLocation(e) {
    this.setData({ 'tournament.location': e.detail.value })
  },

  onPickSeason(e) {
    const idx = parseInt(e.detail.value, 10)
    this.setData({
      seasonIndex: idx,
      'tournament.seasonId': this.data.seasonOptions[idx].value
    })
  },

  onPickType(e) {
    const idx = parseInt(e.detail.value, 10)
    const type = this.data.typeOptions[idx].value
    const playersPerMatch = type === 'doubles' ? 4 : 2
    this.setData({
      typeIndex: idx,
      'tournament.type': type,
      'tournament.config.playersPerMatch': playersPerMatch,
      selectedPlayerIds: [],
      selectedPlayerMap: {},
      selectedPairPreviews: []
    })
  },

  onPickFormat(e) {
    const idx = parseInt(e.detail.value, 10)
    const format = this.data.formatOptions[idx].value
    const bonusByRound = format === 'knockout'
      ? { ...KNOCKOUT_BONUS }
      : { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    this.setData({
      formatIndex: idx,
      'tournament.format': format,
      'tournament.pointsRules.bonusByRound': bonusByRound
    })
  },

  onPickStart(e) {
    this.setData({ 'tournament.startDate': e.detail.value })
  },

  onPickEnd(e) {
    this.setData({ 'tournament.endDate': e.detail.value })
  },

  onGridChange(e) {
    this.setData({ 'tournament.courtTimeGrid': e.detail.grid })
  },

  onPointsInput(e) {
    const field = e.currentTarget.dataset.field
    const value = parseInt(e.detail.value, 10) || 0
    this.setData({ [`tournament.pointsRules.${field}`]: value })
  },

  onBonusInput(e) {
    const round = e.currentTarget.dataset.round
    const value = parseInt(e.detail.value, 10) || 0
    this.setData({ [`tournament.pointsRules.bonusByRound.${round}`]: value })
  },

  onTogglePlayer(e) {
    const { id } = e.currentTarget.dataset
    const selected = [...this.data.selectedPlayerIds]
    const i = selected.indexOf(id)
    if (i >= 0) {
      selected.splice(i, 1)
    } else {
      selected.push(id)
    }
    this._setSelectedPlayers(selected)
  },

  onNextStep() {
    if (!this._validateCurrentStep()) return
    if (this.data.currentStep < this.data.totalSteps) {
      this.setData({ currentStep: this.data.currentStep + 1 })
    } else {
      this.onFinalSubmit()
    }
  },

  onPrevStep() {
    if (this.data.currentStep > 1) {
      this.setData({ currentStep: this.data.currentStep - 1 })
    } else {
      wx.navigateBack()
    }
  },

  _validateCurrentStep() {
    const { tournament, currentStep, selectedPlayerIds } = this.data

    if (currentStep === 1) {
      if (!tournament.name || !tournament.name.trim()) {
        wx.showToast({ title: '请填写赛事名称', icon: 'none' })
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
      return true
    }

    if (currentStep === 2) {
      const grid = tournament.courtTimeGrid
      if (!grid || !grid.slots || grid.slots.length === 0) {
        wx.showToast({ title: '请至少添加一个场地+时段', icon: 'none' })
        return false
      }
      return true
    }

    if (currentStep === 3) {
      const pr = tournament.pointsRules || {}
      if (typeof pr.win !== 'number' || typeof pr.loss !== 'number' || typeof pr.walkover !== 'number') {
        wx.showToast({ title: '请完善积分规则', icon: 'none' })
        return false
      }
      return true
    }

    if (currentStep === 4) {
      if (selectedPlayerIds.length < 2) {
        wx.showToast({ title: '至少选 2 人', icon: 'none' })
        return false
      }
      if (tournament.config && tournament.config.maxPlayers && selectedPlayerIds.length > tournament.config.maxPlayers) {
        wx.showToast({ title: `最多选 ${tournament.config.maxPlayers} 人`, icon: 'none' })
        return false
      }
      if (tournament.type === 'doubles' && selectedPlayerIds.length % 2 !== 0) {
        wx.showToast({ title: '双打需要偶数人', icon: 'none' })
        return false
      }
      if (!this._buildRegistrationPayloads('__preview__')) return false
      return true
    }

    return true
  },

  async onFinalSubmit() {
    wx.showLoading({ title: this.data.isEdit ? '保存中' : '提交中' })
    try {
      const submitData = this._buildSubmitData()
      const previewRegistrations = this._buildRegistrationPayloads('__preview__')
      if (!previewRegistrations) {
        wx.hideLoading()
        return
      }

      let tournamentId = this.data.tournament._id
      if (this.data.isEdit && tournamentId) {
        const res = await wx.cloud.callFunction({
          name: 'tournaments',
          data: { action: 'update', id: tournamentId, data: submitData }
        })
        if (res.result && res.result.errMsg === 'validation failed') {
          throw new Error((res.result.errors || []).join('；') || '校验失败')
        }
      } else {
        const res = await wx.cloud.callFunction({
          name: 'tournaments',
          data: { action: 'add', data: submitData }
        })
        if (res.result && res.result.errMsg === 'validation failed') {
          throw new Error((res.result.errors || []).join('；') || '校验失败')
        }
        tournamentId = res.result._id || (res.result.data && res.result.data._id)
      }

      if (tournamentId) {
        await this._syncRegistrations(tournamentId)
      }

      wx.hideLoading()
      wx.showToast({ title: this.data.isEdit ? '保存成功' : '创建成功', icon: 'success' })
      setTimeout(() => {
        if (tournamentId) {
          wx.redirectTo({ url: `/pages/tournament-detail/index?id=${tournamentId}` })
        } else {
          wx.navigateBack()
        }
      }, 800)
    } catch (err) {
      wx.hideLoading()
      console.error('提交失败', err)
      wx.showToast({ title: err.message || '提交失败', icon: 'none' })
    }
  },

  _findMemberById(id) {
    return this.data.allMembers.find(m => m._id === id)
  },

  _buildRegistrationPayloads(tournamentId) {
    const { selectedPlayerIds, tournament } = this.data
    const base = {
      tournamentId,
      seasonId: tournament.seasonId,
      type: tournament.type,
      status: 'confirmed'
    }

    if (tournament.type === 'doubles') {
      if (selectedPlayerIds.length % 2 !== 0) {
        wx.showToast({ title: '双打需要偶数人', icon: 'none' })
        return null
      }

      const teams = []
      for (let i = 0; i < selectedPlayerIds.length; i += 2) {
        const p1 = this._findMemberById(selectedPlayerIds[i])
        const p2 = this._findMemberById(selectedPlayerIds[i + 1])
        if (!p1 || !p2) {
          wx.showToast({ title: '选手信息未加载完整', icon: 'none' })
          return null
        }
        teams.push({
          ...base,
          playerId: p1._id,
          playerName: p1.name,
          partnerId: p2._id,
          partnerName: p2.name,
          teamName: `${p1.name} / ${p2.name}`,
          seed: teams.length + 1
        })
      }
      return teams
    }

    const players = []
    for (let i = 0; i < selectedPlayerIds.length; i++) {
      const member = this._findMemberById(selectedPlayerIds[i])
      if (!member) {
        wx.showToast({ title: '选手信息未加载完整', icon: 'none' })
        return null
      }
      players.push({
        ...base,
        playerId: member._id,
        playerName: member.name,
        seed: i + 1
      })
    }
    return players
  },

  async _syncRegistrations(tournamentId) {
    const currentRes = await wx.cloud.callFunction({
      name: 'tournament-registrations',
      data: { action: 'list', tournamentId, pageSize: 200, pageNum: 1 }
    })
    const currentRegistrations = currentRes.result.data || []
    for (const registration of currentRegistrations) {
      const res = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'delete', id: registration._id }
      })
      this._assertRegistrationResult(res, '删除旧报名失败')
    }

    const registrations = this._buildRegistrationPayloads(tournamentId)
    if (!registrations) throw new Error('报名数据不完整')
    for (const registration of registrations) {
      const res = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'add', data: registration }
      })
      this._assertRegistrationResult(res, '新增报名失败')
    }

    this.setData({ existingRegistrations: registrations })
  },

  _assertRegistrationResult(res, fallbackMessage) {
    if (res && res.result && res.result.errMsg) {
      const detail = res.result.errors && res.result.errors.length
        ? res.result.errors.join('；')
        : res.result.errMsg
      throw new Error(`${fallbackMessage}：${detail}`)
    }
  },

  _buildSubmitData() {
    const t = this.data.tournament
    return {
      name: t.name,
      seasonId: t.seasonId,
      startDate: t.startDate,
      endDate: t.endDate || '',
      location: t.location || '',
      type: t.type,
      format: t.format || 'regular',
      description: t.description || '',
      status: this.data.isEdit ? (t.status || 'upcoming') : 'upcoming',
      config: { ...DEFAULT_CONFIG, ...(t.config || {}) },
      pointsRules: {
        win: parseInt(t.pointsRules && t.pointsRules.win, 10) || 0,
        loss: parseInt(t.pointsRules && t.pointsRules.loss, 10) || 0,
        walkover: parseInt(t.pointsRules && t.pointsRules.walkover, 10) || 0,
        bonusByRound: {
          1: parseInt(t.pointsRules && t.pointsRules.bonusByRound && t.pointsRules.bonusByRound[1], 10) || 0,
          2: parseInt(t.pointsRules && t.pointsRules.bonusByRound && t.pointsRules.bonusByRound[2], 10) || 0,
          3: parseInt(t.pointsRules && t.pointsRules.bonusByRound && t.pointsRules.bonusByRound[3], 10) || 0,
          4: parseInt(t.pointsRules && t.pointsRules.bonusByRound && t.pointsRules.bonusByRound[4], 10) || 0,
          5: parseInt(t.pointsRules && t.pointsRules.bonusByRound && t.pointsRules.bonusByRound[5], 10) || 0
        }
      },
      courtTimeGrid: t.courtTimeGrid || null
    }
  }
})
