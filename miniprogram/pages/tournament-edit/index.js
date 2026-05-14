const app = getApp()
const { generateFirstRound } = require('../../utils/bracket-generator')
const { assignToCourts } = require('../../utils/scheduler-mirror')

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
    availableCourts: []
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
      slotMinutes: 30,
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

    if (this.data.matches.length === 0) {
      const matches = generateFirstRound({
        format: this.data.form.format,
        type: this.data.form.type,
        registrations: this.data.selectedPlayers
      })
      const queues = assignToCourts(
        matches.filter(m => !m.bye).map(m => ({ matchId: m.matchId, kind: 'match', sourceMatchId: m.matchId })),
        this.data.schedulePlanCourts
      )
      this.setData({ matches, queues })
    }
    this.setData({ step: 3 })
  },

  async commitStep3() {
    const tid = this.data.tournamentId
    const r1 = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'saveInitialMatches', tournamentId: tid, matches: this.data.matches }
    })
    if (!(r1.result && r1.result.success)) {
      const msg = (r1.result && r1.result.error && r1.result.error.message) || '保存对阵失败'
      return wx.showToast({ title: msg, icon: 'none' })
    }

    const r2 = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'saveSchedule', tournamentId: tid, queues: this.data.queues }
    })
    if (!(r2.result && r2.result.success)) {
      const msg = (r2.result && r2.result.error && r2.result.error.message) || '保存排程失败'
      return wx.showToast({ title: msg, icon: 'none' })
    }

    const r3 = await wx.cloud.callFunction({
      name: 'match-results',
      data: { action: 'bulkUpsertScheduledMatches', tournamentId: tid, matches: this.data.matches, queues: this.data.queues }
    })
    if (!(r3.result && r3.result.success)) {
      const msg = (r3.result && r3.result.error && r3.result.error.message) || '生成录分行失败'
      return wx.showToast({ title: msg, icon: 'none' })
    }

    if (this.data.freePlays.length > 0) {
      await wx.cloud.callFunction({
        name: 'free-plays',
        data: { action: 'bulkSet', tournamentId: tid, items: this.data.freePlays }
      })
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

  onAddPlayer() {
    const url = this.data.form.type === 'doubles'
      ? `/pages/tournament-add-players-doubles/index?tournamentId=${this.data.tournamentId || ''}&pickerMode=1`
      : `/pages/tournament-add-player/index?tournamentId=${this.data.tournamentId || ''}&pickerMode=1`
    wx.navigateTo({ url })
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
