const app = getApp()
const { generateFirstRound } = require('../../utils/bracket-generator')
const { assignToCourts, buildRegularSchedule } = require('../../utils/scheduler-mirror')

Page({
  data: {
    step: 1,
    tournamentId: null,
    form: {
      name: '',
      location: '',
      startDate: '',
      type: 'singles',
      format: 'knockout',
      maxPlayers: 8,
      description: ''
    },
    schedulePlanCourts: [],
    selectedPlayers: [],
    matches: [],
    queues: [],
    freePlays: [],
    pointsRules: {
      winLoss: { win: 10, loss: 0 },
      placement: { champion: 100, runnerUp: 60, semifinal: 30, quarterfinal: 10, participation: 5 }
    },
    members: [],
    availableCourts: [],
    picker: {
      show: false,
      title: '选择球员',
      requiredCount: 1,
      maxCount: 0,
      excludeIds: [],
      members: []
    }
  },

  async onLoad(options) {
    await this.loadMembersAndCourts()
    if (options.id) await this.hydrateDraft(options.id)
  },

  onShow() {
    const picked = app.globalData && app.globalData.lastSelectedPlayers
    if (picked && Array.isArray(picked) && picked.length > 0) {
      this.setData({ selectedPlayers: picked })
      app.globalData.lastSelectedPlayers = null
    }
  },

  async loadMembersAndCourts() {
    const [mRes, cRes] = await Promise.all([
      wx.cloud.callFunction({ name: 'members', data: { action: 'list', pageSize: 200 } }),
      wx.cloud.callFunction({ name: 'courts', data: { action: 'list' } }).catch(() => null)
    ])
    const members = unpackList(mRes, ['members'])
    const availableCourts = unpackList(cRes, ['courts'])
    this.setData({ members, availableCourts })
  },

  async hydrateDraft(id) {
    const tRes = await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'get', id } })
    const t = (tRes.result && tRes.result.data) || null
    if (!t) return

    this.setData({
      tournamentId: id,
      form: {
        name: t.name || '',
        location: t.location || '',
        startDate: t.startDate || '',
        type: t.type || 'singles',
        format: t.format || 'knockout',
        maxPlayers: t.maxPlayers || 8,
        description: t.description || ''
      },
      schedulePlanCourts: (t.schedulePlan && t.schedulePlan.courts) || [],
      queues: (t.schedulePlan && t.schedulePlan.queues) || [],
      pointsRules: t.pointsRules || this.data.pointsRules
    })

    const regsRes = await wx.cloud.callFunction({
      name: 'tournament-registrations',
      data: { action: 'list', tournamentId: id, pageSize: 200 }
    })
    const regs = (regsRes.result && regsRes.result.data) || []
    this.setData({
      selectedPlayers: regs.map(r => ({
        playerId: r.playerId,
        playerName: r.playerName,
        partnerId: r.partnerId || null,
        partnerName: r.partnerName || null,
        teamName: r.teamName || null
      }))
    })

    const r1Res = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'getByRound', tournamentId: id, round: 1 }
    })
    const r1Data = r1Res.result && r1Res.result.data
    const r1Brackets = Array.isArray(r1Data) ? r1Data : []
    const r1Matches = r1Brackets.length > 0 ? (r1Brackets[0].matches || []) : []
    this.setData({ matches: r1Matches })

    const fpRes = await wx.cloud.callFunction({
      name: 'free-plays', data: { action: 'list', tournamentId: id }
    })
    const fp = (fpRes.result && fpRes.result.success && fpRes.result.data && fpRes.result.data.items) || []
    this.setData({ freePlays: fp })
  },

  async onNext() {
    if (this.data.step === 1) return this.commitStep1()
    if (this.data.step === 2) return this.commitStep2()
    if (this.data.step === 3) return this.commitStep3()
    if (this.data.step === 4) return this.commitStep4()
  },

  onBack() {
    if (this.data.step > 1) this.setData({ step: this.data.step - 1 })
    else wx.navigateBack()
  },

  async commitStep1() {
    const f = this.data.form
    if (!f.name || !f.location || !f.startDate) {
      wx.showToast({ title: '请补齐必填项', icon: 'none' })
      return
    }
    const seasonId = await this.resolveSeasonId(f.startDate)
    const payload = { ...f, seasonId, status: 'draft' }
    let r
    if (this.data.tournamentId) {
      r = await wx.cloud.callFunction({
        name: 'tournaments',
        data: { action: 'updateNew', id: this.data.tournamentId, data: payload }
      })
    } else {
      r = await wx.cloud.callFunction({
        name: 'tournaments',
        data: { action: 'create', data: payload }
      })
      if (r.result && r.result.success) {
        this.setData({ tournamentId: r.result.data.id })
      }
    }
    if (!(r.result && r.result.success)) {
      const msg = (r.result && r.result.error && r.result.error.message) || '创建失败'
      wx.showToast({ title: msg, icon: 'none' })
      return
    }
    this.setData({ step: 2 })
  },

  async commitStep2() {
    if (this.data.selectedPlayers.length < 2) {
      return wx.showToast({ title: '至少选 2 位球员', icon: 'none' })
    }
    if (this.data.schedulePlanCourts.length === 0) {
      return wx.showToast({ title: '至少选 1 个场地', icon: 'none' })
    }
    if (this.data.schedulePlanCourts.some(c => !c.slots || c.slots.length === 0)) {
      return wx.showToast({ title: '每个场地至少选 1 个 slot', icon: 'none' })
    }

    const playerChanged = await this.checkPlayerChange()
    if (playerChanged && this.data.matches.length > 0) {
      const ok = await new Promise(resolve => wx.showModal({
        title: '注意',
        content: '已生成的对阵将重置',
        success: ({ confirm }) => resolve(confirm)
      }))
      if (!ok) return
      await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: { action: 'regenerateDraft', tournamentId: this.data.tournamentId }
      })
      this.setData({ matches: [], queues: [], freePlays: [] })
    }

    const schedulePlan = {
      slotMinutes: 20,
      courts: this.data.schedulePlanCourts,
      queues: this.data.queues || []
    }
    await wx.cloud.callFunction({
      name: 'tournaments',
      data: { action: 'updateNew', id: this.data.tournamentId, data: { schedulePlan } }
    })

    const bsRes = await wx.cloud.callFunction({
      name: 'tournament-registrations',
      data: { action: 'bulkSet', tournamentId: this.data.tournamentId, registrations: this.data.selectedPlayers }
    })
    if (!(bsRes.result && bsRes.result.success)) {
      const msg = (bsRes.result && bsRes.result.error && bsRes.result.error.message) || '保存报名失败'
      wx.showToast({ title: msg, icon: 'none' })
      return
    }

    if (this.data.matches.length === 0 || this.regularScheduleNeedsBuild()) {
      this.applyDefaultSchedule()
    }
    this.setData({ step: 3 })
  },

  async commitStep3() {
    const tid = this.data.tournamentId
    const r1 = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'saveInitialMatches', tournamentId: tid, matches: this.data.matches }
    })
    if (!_isSuccess(r1)) {
      console.error('[commitStep3] saveInitialMatches failed', r1 && r1.result)
      return wx.showToast({ title: _errMsg(r1, '保存对阵失败'), icon: 'none' })
    }

    const r2 = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'saveSchedule', tournamentId: tid, queues: this.data.queues }
    })
    if (!_isSuccess(r2)) {
      console.error('[commitStep3] saveSchedule failed', r2 && r2.result)
      return wx.showToast({ title: _errMsg(r2, '保存排程失败'), icon: 'none' })
    }

    const r3 = await wx.cloud.callFunction({
      name: 'match-results',
      data: { action: 'bulkUpsertScheduledMatches', tournamentId: tid, matches: this.data.matches, queues: this.data.queues }
    })
    if (!_isSuccess(r3)) {
      console.error('[commitStep3] bulkUpsertScheduledMatches failed', r3 && r3.result)
      return wx.showToast({ title: _errMsg(r3, '生成录分行失败'), icon: 'none' })
    }

    const r4 = await wx.cloud.callFunction({
      name: 'free-plays',
      data: { action: 'bulkSet', tournamentId: tid, items: this.data.freePlays }
    })
    if (!_isSuccess(r4)) {
      console.error('[commitStep3] free-plays.bulkSet failed', r4 && r4.result)
      // 自由拉球失败不阻塞主流程，仅提示
      wx.showToast({ title: _errMsg(r4, '保存自由拉球失败'), icon: 'none' })
    }
    this.setData({ step: 4 })
  },

  async commitStep4() {
    const r = await wx.cloud.callFunction({
      name: 'tournaments',
      data: {
        action: 'updateNew',
        id: this.data.tournamentId,
        data: { pointsRules: this.data.pointsRules, status: 'upcoming' }
      }
    })
    if (!(r.result && r.result.success)) {
      const msg = (r.result && r.result.error && r.result.error.message) || '失败'
      return wx.showToast({ title: msg, icon: 'none' })
    }
    wx.showToast({ title: '已创建', icon: 'success' })
    setTimeout(() => {
      wx.redirectTo({ url: `/pages/tournament-detail/index?id=${this.data.tournamentId}` })
    }, 800)
  },

  onFieldChange(e) {
    const k = e.currentTarget.dataset.k
    const v = e.currentTarget.dataset.v
    const val = v !== undefined ? v : e.detail.value
    if (k && k.startsWith('pointsRules.')) {
      this.setData({ [k]: typeof val === 'string' ? (parseInt(val, 10) || 0) : val })
    } else {
      this.setData({ [`form.${k}`]: val })
    }
  },

  onChipTap(e) {
    const { k, v } = e.currentTarget.dataset
    this.setData({ [`form.${k}`]: v })
  },

  onCourtsChange(e) {
    this.setData({ schedulePlanCourts: e.detail.courts })
  },

  onScheduleChange(e) {
    this.setData({
      matches: e.detail.matches,
      queues: e.detail.queues,
      freePlays: e.detail.freePlays
    })
  },

  async onRegenerate() {
    this.applyDefaultSchedule()
  },

  onClearSchedule() {
    const queues = (this.data.schedulePlanCourts || []).map(c => ({ courtId: c.courtId, items: [] }))
    this.setData({ matches: [], queues, freePlays: [] })
  },

  applyDefaultSchedule() {
    if (this.data.form.format === 'regular') {
      const { matches, queues, freePlays } = buildRegularSchedule({
        registrations: this.data.selectedPlayers,
        courts: this.data.schedulePlanCourts,
        type: this.data.form.type
      })
      this.setData({ matches, queues, freePlays })
      return
    }

    const matches = generateFirstRound({
      format: this.data.form.format,
      type: this.data.form.type,
      registrations: this.data.selectedPlayers
    })
    const queues = assignToCourts(
      matches.filter(m => !m.bye).map(m => ({ matchId: m.matchId, kind: 'match', sourceMatchId: m.matchId })),
      this.data.schedulePlanCourts
    )
    this.setData({ matches, queues, freePlays: [] })
  },

  regularScheduleNeedsBuild() {
    if (this.data.form.format !== 'regular') return false
    const queues = this.data.queues || []
    return (this.data.schedulePlanCourts || []).some(court => {
      const q = queues.find(x => x.courtId === court.courtId)
      const slots = [...(court.slots || [])].sort()
      const items = [...((q && q.items) || [])].sort((a, b) => a.order - b.order)
      if (items.length !== slots.length) return true
      for (let i = 0; i < items.length; i++) {
        const expected = (i % 3 === 2) ? 'freePlay' : 'match'
        if (items[i].kind !== expected) return true
      }
      return false
    })
  },

  onAddPlayer() {
    const isDoubles = this.data.form.type === 'doubles'
    const remaining = this._remainingPlayerSlots()
    this.setData({
      picker: {
        show: true,
        title: isDoubles ? '选择 2 位组队队员' : '选择球员（可多选）',
        requiredCount: isDoubles ? 2 : 1,
        maxCount: isDoubles ? 0 : Math.max(1, remaining),
        excludeIds: this._collectExcludedMemberIds(),
        members: this.data.members
      }
    })
  },

  _remainingPlayerSlots() {
    if (this.data.form.format === 'knockout') {
      const cap = this.data.form.maxPlayers || 8
      return Math.max(1, cap - this.data.selectedPlayers.length)
    }
    // 常规赛无硬上限，给一个宽松的窗口
    return 32
  },

  _collectExcludedMemberIds() {
    const ids = []
    this.data.selectedPlayers.forEach(p => {
      if (p.playerId) ids.push(p.playerId)
      if (p.partnerId) ids.push(p.partnerId)
    })
    return ids
  },

  onPickerConfirm(e) {
    const memberIds = (e.detail && e.detail.memberIds) || []
    const isDoubles = this.data.form.type === 'doubles'
    const findMember = id => this.data.members.find(m => m._id === id)

    let toAdd = []
    if (isDoubles) {
      if (memberIds.length !== 2) return
      const m1 = findMember(memberIds[0])
      const m2 = findMember(memberIds[1])
      if (!m1 || !m2) {
        wx.showToast({ title: '会员信息缺失', icon: 'none' })
        return
      }
      toAdd = [{
        playerId: m1._id,
        playerName: m1.name,
        partnerId: m2._id,
        partnerName: m2.name,
        teamName: `${m1.name} / ${m2.name}`
      }]
    } else {
      if (memberIds.length < 1) return
      memberIds.forEach(id => {
        const m = findMember(id)
        if (m) toAdd.push({ playerId: m._id, playerName: m.name })
      })
      if (toAdd.length === 0) {
        wx.showToast({ title: '会员信息缺失', icon: 'none' })
        return
      }
    }

    this.setData({
      selectedPlayers: [...this.data.selectedPlayers, ...toAdd],
      'picker.show': false
    })
  },

  onPickerCancel() {
    this.setData({ 'picker.show': false })
  },

  async onAddCourt() {
    const result = await new Promise(resolve => {
      wx.showModal({
        title: '添加球场',
        editable: true,
        placeholderText: '球场名称（如：1 号场）',
        success: res => resolve(res),
        fail: () => resolve({ confirm: false, content: '' })
      })
    })
    if (!result.confirm) return
    const name = (result.content || '').trim()
    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' })
      return
    }
    wx.showLoading({ title: '添加中' })
    try {
      const r = await wx.cloud.callFunction({
        name: 'courts',
        data: { action: 'create', name }
      })
      wx.hideLoading()
      if (!(r.result && r.result.success)) {
        const msg = (r.result && r.result.error && r.result.error.message) || '添加失败'
        wx.showToast({ title: msg, icon: 'none' })
        return
      }
      const c = await wx.cloud.callFunction({ name: 'courts', data: { action: 'list' } })
      const courts = unpackList(c, ['courts'])
      this.setData({ availableCourts: courts })
      wx.showToast({ title: '已添加', icon: 'success' })
    } catch (e) {
      wx.hideLoading()
      console.error('onAddCourt', e)
      wx.showToast({ title: '添加失败', icon: 'none' })
    }
  },

  onLogin() {
    wx.switchTab({ url: '/pages/mine/index' })
  },

  onRemovePlayer(e) {
    const id = e.currentTarget.dataset.id
    this.setData({
      selectedPlayers: this.data.selectedPlayers.filter(p => p.playerId !== id)
    })
  },

  async onUseHistory() {
    const r = await wx.cloud.callFunction({
      name: 'tournaments',
      data: { action: 'lastPointsRules', format: this.data.form.format, type: this.data.form.type }
    }).catch(() => null)
    const pr = r && r.result && r.result.success && r.result.data && r.result.data.pointsRules
    if (pr) this.setData({ pointsRules: pr })
    else wx.showToast({ title: '暂无历史', icon: 'none' })
  },

  async checkPlayerChange() {
    if (!this.data.tournamentId) return false
    const r = await wx.cloud.callFunction({
      name: 'tournament-registrations',
      data: { action: 'list', tournamentId: this.data.tournamentId, pageSize: 200 }
    })
    const old = ((r.result && r.result.data) || []).map(x => x.playerId).sort().join(',')
    const cur = this.data.selectedPlayers.map(x => x.playerId).sort().join(',')
    return old && old !== cur
  },

  async resolveSeasonId(startDate) {
    const year = String(new Date(startDate).getFullYear())
    const r = await wx.cloud.callFunction({
      name: 'seasons', data: { action: 'getCurrent' }
    }).catch(() => null)
    return (r && r.result && r.result.data && r.result.data.seasonId)
      || (r && r.result && r.result.data && r.result.data._id)
      || `season_${year}`
  }
})

function _isSuccess(res) {
  return !!(res && res.result && res.result.success === true)
}

function _errMsg(res, fallback) {
  const r = res && res.result
  if (!r) return fallback
  if (r.error) {
    if (typeof r.error === 'string') return r.error
    if (r.error.message) return r.error.message
    if (r.error.errMsg) return r.error.errMsg
  }
  if (r.errMsg) return r.errMsg
  return fallback
}

function unpackList(res, dataFields) {
  if (!res || !res.result) return []
  const r = res.result
  if (r.success && r.data) {
    for (const f of dataFields) {
      if (Array.isArray(r.data[f])) return r.data[f]
    }
    if (Array.isArray(r.data)) return r.data
  }
  if (Array.isArray(r.data)) return r.data
  return []
}
