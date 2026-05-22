const app = getApp()
const { generateFirstRound } = require('../../utils/bracket-generator')
const { assignToCourts, buildRegularSchedule } = require('../../utils/scheduler-mirror')

Page({
  data: {
    step: 1,
    tournamentId: null,
    form: {
      name: '',
      location: '海峡奥体网球场',
      startDate: todayISODate(),
      type: 'mixed',
      format: 'regular',
      maxPlayers: 8,
      registrationDeadlineAt: '',
      description: ''
    },
    registrationDeadlineDate: '',
    registrationDeadlineDisplay: '',
    registrationPublished: false,
    sharePath: '',
    scheduleStarted: false,
    scheduleEditMode: false,
    matchResultRows: [],
    originalScheduleSnapshot: null,
    scheduleImpactChoice: '',
    schedulePlanCourts: [],
    selectedPlayers: [],
    matches: [],
    queues: [],
    freePlays: [],
    pointsRules: {
      winLoss: { win: 20, loss: 10, walkover: 0 },
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
    const patch = {}
    if (options && options.step) patch.step = parseInt(options.step, 10) || this.data.step
    if (options && options.mode === 'edit-schedule') patch.scheduleEditMode = true
    if (Object.keys(patch).length > 0) this.setData(patch)
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
        format: t.format || 'regular',
        maxPlayers: t.maxPlayers || 8,
        registrationDeadlineAt: t.registrationDeadlineAt || '',
        description: t.description || ''
      },
      registrationDeadlineDate: deadlineDateValue(t.registrationDeadlineAt),
      registrationDeadlineDisplay: deadlineDisplay(t.registrationDeadlineAt),
      registrationPublished: !!t.registrationPublishedAt,
      sharePath: t.registrationPublishedAt ? buildRegistrationSharePath(id) : '',
      scheduleStarted: t.scheduleStatus === 'draft' || t.scheduleStatus === 'published',
      schedulePlanCourts: asArray(t.schedulePlan && t.schedulePlan.courts),
      queues: asArray(t.schedulePlan && t.schedulePlan.queues),
      pointsRules: this._normalizePointsRules(t.pointsRules || this.data.pointsRules)
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
    this.setData({ freePlays: asArray(fp) })

    if (this.data.scheduleEditMode) {
      const mrRes = await wx.cloud.callFunction({
        name: 'match-results',
        data: { action: 'listByTournament', tournamentId: id }
      })
      const matchResultRows = (mrRes.result && mrRes.result.success && mrRes.result.data && mrRes.result.data.results) || []
      this.setData({
        matchResultRows,
        originalScheduleSnapshot: this.buildScheduleEditSnapshot(r1Matches, this.data.queues)
      })
    }
  },

  async onNext() {
    if (this.data.step === 1) return this.commitStep1()
    if (this.data.step === 2) return this.commitStep2()
    if (this.data.step === 3) return this.commitStep3()
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
    const pointsRules = this._normalizePointsRules(this.data.pointsRules)
    const payload = { ...f, seasonId, pointsRules, status: 'draft' }
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
    const persisted = await this.persistStep2Inputs()
    if (!persisted) return

    if (this.data.matches.length === 0 || this.regularScheduleNeedsBuild()) {
      this.applyDefaultSchedule()
    }
    this.setData({ step: 3 })
  },

  async persistStep2Inputs(options = {}) {
    const requirePlayers = options.requirePlayers !== false
    const saveRegistrations = options.saveRegistrations !== false
    const minPlayers = this._minPlayers()
    if (requirePlayers && this.data.selectedPlayers.length < minPlayers) {
      const isKD = this.data.form.type === 'doubles' && this.data.form.format === 'knockout'
      const unit = isKD ? '组队伍' : '位球员'
      wx.showToast({ title: `至少选 ${minPlayers} ${unit}`, icon: 'none' })
      return false
    }
    if (this.data.schedulePlanCourts.length === 0) {
      wx.showToast({ title: '至少选 1 个场地', icon: 'none' })
      return false
    }
    if (this.data.schedulePlanCourts.some(c => !c.slots || c.slots.length === 0)) {
      wx.showToast({ title: '每个场地至少选 1 个 slot', icon: 'none' })
      return false
    }

    const playerChanged = await this.checkPlayerChange()
    if (playerChanged && this.data.matches.length > 0) {
      const ok = await new Promise(resolve => wx.showModal({
        title: '注意',
        content: '已生成的对阵将重置',
        success: ({ confirm }) => resolve(confirm)
      }))
      if (!ok) return false
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
    const tournamentPatch = { schedulePlan }
    if (this.data.form.registrationDeadlineAt) {
      tournamentPatch.registrationDeadlineAt = this.data.form.registrationDeadlineAt
    }
    const savePlanRes = await wx.cloud.callFunction({
      name: 'tournaments',
      data: { action: 'updateNew', id: this.data.tournamentId, data: tournamentPatch }
    })
    if (!_isSuccess(savePlanRes)) {
      wx.showToast({ title: _errMsg(savePlanRes, '保存排程失败'), icon: 'none' })
      return false
    }

    if (saveRegistrations) {
      const bsRes = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'bulkSet', tournamentId: this.data.tournamentId, registrations: this.data.selectedPlayers }
      })
      if (!(bsRes.result && bsRes.result.success)) {
        const msg = (bsRes.result && bsRes.result.error && bsRes.result.error.message) || '保存报名失败'
        wx.showToast({ title: msg, icon: 'none' })
        return false
      }
    }
    return true
  },

  async onPublishRegistration() {
    if (this.data.scheduleStarted) {
      wx.showToast({ title: '请先清空排程草稿再重新开放报名', icon: 'none' })
      return
    }
    if (!this.data.form.registrationDeadlineAt) {
      wx.showToast({ title: '请选择报名截止', icon: 'none' })
      return
    }
    try {
      const persisted = await this.persistStep2Inputs({
        requirePlayers: false,
        saveRegistrations: this.data.selectedPlayers.length > 0
      })
      if (!persisted) return

      const res = await wx.cloud.callFunction({
        name: 'tournaments',
        data: {
          action: 'publishRegistration',
          id: this.data.tournamentId,
          registrationDeadlineAt: this.data.form.registrationDeadlineAt
        }
      })
      if (!_isSuccess(res)) {
        wx.showToast({ title: _errMsg(res, '发布失败'), icon: 'none' })
        return
      }

      const sharePath = buildRegistrationSharePath(this.data.tournamentId)
      this.setData({
        registrationPublished: true,
        sharePath
      })
      if (wx.redirectTo) {
        wx.redirectTo({ url: sharePath })
      } else {
        wx.showToast({ title: '已发布', icon: 'success' })
      }
    } catch (err) {
      console.error('[onPublishRegistration]', err)
      wx.showToast({ title: '发布失败', icon: 'none' })
    }
  },

  onShareAppMessage() {
    if (!this.data.registrationPublished || !this.data.sharePath) {
      return { title: '赛事报名', path: '/pages/tournament-detail/index' }
    }
    return {
      title: this.data.form.name || '赛事报名',
      path: this.data.sharePath
    }
  },

  onShareTimeline() {
    if (!this.data.registrationPublished || !this.data.tournamentId) {
      return { title: '赛事报名', query: '' }
    }
    return {
      title: this.data.form.name || '赛事报名',
      query: `id=${encodeURIComponent(this.data.tournamentId)}&entry=register`
    }
  },

  onRegistrationDeadlineDateChange(e) {
    const date = e.detail && e.detail.value
    const deadlineAt = deadlineAtFromDate(date)
    this.setData({
      'form.registrationDeadlineAt': deadlineAt,
      registrationDeadlineDate: deadlineDateValue(deadlineAt),
      registrationDeadlineDisplay: deadlineDisplay(deadlineAt)
    })
  },

  onManageRegistration() {
    this.setData({ step: 2 })
    if (wx.pageScrollTo) {
      wx.pageScrollTo({ selector: '.registration-card', duration: 240 })
    }
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

    // 最后一步：finalize 赛事状态 → upcoming（积分在 step1 已保存）
    const pointsRules = this._normalizePointsRules(this.data.pointsRules)
    const r5 = await wx.cloud.callFunction({
      name: 'tournaments',
      data: {
        action: 'updateNew',
        id: tid,
        data: { pointsRules, status: 'upcoming' }
      }
    })
    if (!_isSuccess(r5)) {
      console.error('[commitStep3] finalize failed', r5 && r5.result)
      const msg = _errMsg(r5, '创建失败')
      return wx.showToast({ title: msg, icon: 'none' })
    }
    wx.showToast({ title: '已创建', icon: 'success' })
    setTimeout(() => {
      wx.redirectTo({ url: `/pages/tournament-detail/index?id=${tid}` })
    }, 800)
  },

  async onSaveScheduleDraft() {
    try {
      const saved = await this.persistScheduleDraftOnly()
      if (!saved) return
      wx.showToast({ title: '已保存草稿', icon: 'success' })
    } catch (err) {
      console.error('[onSaveScheduleDraft]', err)
      wx.showToast({ title: '保存草稿失败', icon: 'none' })
    }
  },

  async onPublishSchedule() {
    try {
      const published = await this.persistPublishedSchedule()
      if (!published) return
      wx.redirectTo({ url: `/pages/tournament-detail/index?id=${this.data.tournamentId}` })
    } catch (err) {
      console.error('[onPublishSchedule]', err)
      wx.showToast({ title: '发布赛程失败', icon: 'none' })
    }
  },

  async persistScheduleDraftOnly() {
    const saved = await this.persistScheduleBase()
    if (!saved) return false
    const res = await wx.cloud.callFunction({
      name: 'tournaments',
      data: { action: 'saveScheduleDraft', id: this.data.tournamentId, schedulePlan: this.buildSchedulePlanSnapshot() }
    })
    if (!_isSuccess(res)) {
      wx.showToast({ title: _errMsg(res, '保存草稿失败'), icon: 'none' })
      return false
    }
    this.setData({ scheduleStarted: true })
    return true
  },

  async persistPublishedSchedule() {
    const saved = await this.persistScheduleBase({ applyImpactAfterSave: false })
    if (!saved) return false
    const impactChoice = this.data.scheduleImpactChoice
    if (this.data.scheduleEditMode && impactChoice && impactChoice !== 'none') {
      const impactApplied = await this.applyScheduleImpact(impactChoice, false)
      if (!impactApplied) return false
    }
    const res = await wx.cloud.callFunction({
      name: 'tournaments',
      data: { action: 'publishSchedule', id: this.data.tournamentId }
    })
    if (!_isSuccess(res)) {
      wx.showToast({ title: _errMsg(res, '发布赛程失败'), icon: 'none' })
      return false
    }
    this.setData({ scheduleStarted: true })
    return true
  },

  async persistScheduleBase(options = {}) {
    const tid = this.data.tournamentId
    const applyImpactAfterSave = options.applyImpactAfterSave !== false
    const impactChoice = await this.confirmScheduleEditImpact()
    if (impactChoice === 'cancel') return false
    if (impactChoice !== 'none') {
      const impactAllowed = await this.applyScheduleImpact(impactChoice, true)
      if (!impactAllowed) return false
    }
    const skipInitialMatchRewrite = this.data.scheduleEditMode && impactChoice === 'keep_time_only'
    if (!skipInitialMatchRewrite && (this.data.matches || []).length > 0) {
      const r1 = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: { action: 'saveInitialMatches', tournamentId: tid, matches: this.data.matches }
      })
      if (!_isSuccess(r1)) {
        console.error('[persistScheduleBase] saveInitialMatches failed', r1 && r1.result)
        wx.showToast({ title: _errMsg(r1, '保存对阵失败'), icon: 'none' })
        return false
      }
    }

    const r2 = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'saveSchedule', tournamentId: tid, queues: this.data.queues }
    })
    if (!_isSuccess(r2)) {
      console.error('[persistScheduleBase] saveSchedule failed', r2 && r2.result)
      wx.showToast({ title: _errMsg(r2, '保存排程失败'), icon: 'none' })
      return false
    }
    if (applyImpactAfterSave && impactChoice !== 'none') {
      const impactApplied = await this.applyScheduleImpact(impactChoice, false)
      if (!impactApplied) return false
    }
    return true
  },

  async applyScheduleImpact(mode, dryRun) {
    const res = await wx.cloud.callFunction({
      name: 'match-results',
      data: {
        action: 'applyScheduleImpact',
        tournamentId: this.data.tournamentId,
        mode,
        matches: this.data.matches,
        queues: this.data.queues,
        dryRun: !!dryRun
      }
    })
    if (!_isSuccess(res)) {
      wx.showToast({ title: _errMsg(res, '处理赛程影响失败'), icon: 'none' })
      return false
    }
    return true
  },

  buildSchedulePlanSnapshot() {
    return {
      slotMinutes: 20,
      courts: this.data.schedulePlanCourts || [],
      queues: this.data.queues || []
    }
  },

  async confirmScheduleEditImpact() {
    if (!this.data.scheduleEditMode) return 'none'
    const confirmedRows = asArray(this.data.matchResultRows).filter(row => row.resultStatus === 'confirmed')
    if (confirmedRows.length === 0) return 'none'
    if (!this.hasScheduleImpactOnConfirmedRows(confirmedRows)) return 'none'

    const choices = [
      { key: 'keep_time_only', label: '保留比分，仅改场地/时间' },
      { key: 'invalidate_scores', label: '清空比分并重新录入' },
      { key: 'cancel', label: '取消编辑' }
    ]
    const choice = await this.pickScheduleImpactChoice(choices)
    this.setData({ scheduleImpactChoice: choice })
    return choice
  },

  pickScheduleImpactChoice(choices) {
    if (wx.showActionSheet) {
      return new Promise(resolve => wx.showActionSheet({
        itemList: choices.map(choice => choice.label),
        success: ({ tapIndex }) => resolve((choices[tapIndex] && choices[tapIndex].key) || 'cancel'),
        fail: () => resolve('cancel')
      }))
    }
    return new Promise(resolve => wx.showModal({
      title: '赛程已影响成绩',
      content: choices.map(choice => choice.label).join('\n'),
      success: ({ confirm }) => resolve(confirm ? choices[0].key : 'cancel'),
      fail: () => resolve('cancel')
    }))
  },

  hasScheduleImpactOnConfirmedRows(confirmedRows) {
    const before = this.data.originalScheduleSnapshot || {}
    const after = this.buildScheduleEditSnapshot(this.data.matches, this.data.queues)
    return confirmedRows.some(row => {
      const matchId = row.sourceMatchId || row.matchId || row._id
      if (!matchId) return false
      return !sameScheduleSnapshot(before[matchId], after[matchId])
    })
  },

  buildScheduleEditSnapshot(matches = [], queues = []) {
    const snapshot = {}
    asArray(matches).forEach(match => {
      const matchId = match.matchId || match.sourceMatchId
      if (!matchId) return
      snapshot[matchId] = {
        sourceMatchId: matchId,
        player1Key: playerKey(match.player1),
        player2Key: playerKey(match.player2),
        courtId: match.courtId || '',
        queueOrder: hasOwn(match, 'queueOrder') ? match.queueOrder : null
      }
    })
    asArray(queues).forEach(queue => {
      asArray(queue.items).forEach(item => {
        const matchId = item.matchId || item.sourceMatchId
        if (!matchId || item.kind === 'freePlay') return
        const current = snapshot[matchId] || { sourceMatchId: matchId, player1Key: '', player2Key: '' }
        snapshot[matchId] = {
          ...current,
          courtId: queue.courtId || item.courtId || '',
          queueOrder: hasOwn(item, 'order') ? item.order : null
        }
      })
    })
    return snapshot
  },

  _normalizePointsRules(pr) {
    const wl = (pr && pr.winLoss) || {}
    const pl = (pr && pr.placement) || {}
    return {
      winLoss: {
        win: typeof wl.win === 'number' ? wl.win : 20,
        loss: typeof wl.loss === 'number' ? wl.loss : 10,
        walkover: typeof wl.walkover === 'number' ? wl.walkover : 0
      },
      placement: {
        champion: typeof pl.champion === 'number' ? pl.champion : 100,
        runnerUp: typeof pl.runnerUp === 'number' ? pl.runnerUp : 60,
        semifinal: typeof pl.semifinal === 'number' ? pl.semifinal : 30,
        quarterfinal: typeof pl.quarterfinal === 'number' ? pl.quarterfinal : 10,
        participation: typeof pl.participation === 'number' ? pl.participation : 5
      }
    }
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
    if (k === 'format') {
      const patch = { 'form.format': v }
      if (v === 'knockout' && this.data.form.type === 'mixed') patch['form.type'] = 'singles'
      this.setData(patch)
      return
    }
    if (k === 'type' && v === 'mixed' && this.data.form.format === 'knockout') {
      wx.showToast({ title: '淘汰赛不支持混合', icon: 'none' })
      return
    }
    this.setData({ [`form.${k}`]: v })
  },

  onCourtsChange(e) {
    this.setData({ schedulePlanCourts: asArray(e.detail && e.detail.courts) })
  },

  onScheduleChange(e) {
    this.setData({
      matches: asArray(e.detail && e.detail.matches),
      queues: asArray(e.detail && e.detail.queues),
      freePlays: asArray(e.detail && e.detail.freePlays)
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
        if (this.data.form.type === 'mixed' && expected === 'match') {
          const match = (this.data.matches || []).find(m => m.matchId === items[i].matchId)
          const expectedType = (i % 3 === 0) ? 'singles' : 'doubles'
          if (!match || match.type !== expectedType) return true
        }
      }
      return false
    })
  },

  onAddPlayer() {
    const isDoubles = this.data.form.type === 'doubles'
    const isKnockoutDoubles = isDoubles && this.data.form.format === 'knockout'
    const remaining = this._remainingPlayerSlots()
    this.setData({
      picker: {
        show: true,
        title: isKnockoutDoubles ? '选择 2 位组队队员' : '选择球员（可多选）',
        requiredCount: isKnockoutDoubles ? 2 : 1,
        maxCount: isKnockoutDoubles ? 0 : Math.max(1, remaining),
        excludeIds: this._collectExcludedMemberIds(),
        members: this.data.members
      }
    })
  },

  _minPlayers() {
    // 单打 / knockout 双打：至少 2（个人 or 队伍）；regular 双打：至少 4 人。
    if (this.data.form.type === 'mixed') return 4
    if (this.data.form.type === 'doubles' && this.data.form.format === 'regular') return 4
    return 2
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
    const isKnockoutDoubles = isDoubles && this.data.form.format === 'knockout'
    const findMember = id => this.data.members.find(m => m._id === id)

    let toAdd = []
    if (isKnockoutDoubles) {
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
    const old = asArray(r.result && r.result.data).map(x => x.playerId).sort().join(',')
    const cur = this.data.selectedPlayers.map(x => x.playerId).sort().join(',')
    return old && old !== cur
  },

  async resolveSeasonId(startDate) {
    const year = String(new Date(startDate).getFullYear())
    const r = await wx.cloud.callFunction({
      name: 'seasons',
      data: { action: 'getCurrent', date: startDate }
    }).catch(() => null)
    const data = r && r.result && r.result.data
    return (data && data.seasonId)
      || (data && data.season && data.season._id)
      || (data && data._id)
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

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function hasOwn(obj, key) {
  return !!(obj && Object.prototype.hasOwnProperty.call(obj, key))
}

function sameScheduleSnapshot(a, b) {
  return ((a && a.courtId) || '') === ((b && b.courtId) || '')
    && (hasOwn(a, 'queueOrder') ? a.queueOrder : null) === (hasOwn(b, 'queueOrder') ? b.queueOrder : null)
    && ((a && a.sourceMatchId) || '') === ((b && b.sourceMatchId) || '')
    && ((a && a.player1Key) || '') === ((b && b.player1Key) || '')
    && ((a && a.player2Key) || '') === ((b && b.player2Key) || '')
}

function playerKey(player) {
  if (!player) return ''
  return [
    player.id || '',
    player.partnerId || '',
    player.name || '',
    player.partnerName || ''
  ].join(':')
}

function todayISODate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function buildRegistrationSharePath(id) {
  return `/pages/tournament-detail/index?id=${id}&entry=register`
}

function deadlineAtFromDate(date) {
  if (!date) return ''
  return `${date}T23:59:59+08:00`
}

function deadlineDateValue(value) {
  if (!value) return ''
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

function deadlineDisplay(value) {
  if (!value) return ''
  const date = deadlineDateValue(value)
  const timeMatch = String(value).match(/T(\d{2}:\d{2})/)
  if (!date) return String(value)
  return `${date} ${timeMatch ? timeMatch[1] : '23:59'}`
}
