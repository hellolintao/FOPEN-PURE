const app = getApp()
const {
  getTournamentStatusMeta,
  getTournamentShareTitle,
  isCompletedStatus
} = require('../../utils/tournament-status')
const {
  PHASE,
  derivePhase,
  getWithdrawDeadline,
  canWithdraw,
  isActiveRegistration
} = require('../../utils/tournament-phase')

Page({
  data: {
    tournamentId: '',
    tournament: null,
    registrations: [],
    brackets: [],
    freePlays: [],
    matchResultRows: [],
    resultSummary: null,
    resultDisplay: { visible: false, completedText: '', standings: [], groups: [] },
    scheduleCourts: [],
    scheduleRows: [],
    tournamentDisplay: null,
    loading: true,
    isAdmin: false,
    isParticipant: false,
    canEnterScore: false,
    canOpenScore: false,
    scoreActionLabel: '录入成绩',
    shareEnabled: false,
    entry: '',
    phase: '',
    phaseSteps: [],
    activeRegistrationCount: 0,
    withdrawDeadlineLabel: '',
    showRegistrationModule: false,
    showRegistrationStatusCard: false,
    showWaitingScheduleButton: false,
    showScheduleSection: false,
    showResultsSection: false,
    footerActions: [],
    primaryActionLabel: '',
    selfRegistrationSupported: true
  },

  onLoad(options = {}) {
    this.enableShareMenu()
    const { id, entry } = options
    if (id) {
      this.setData({ tournamentId: id, entry: entry || '' })
      this.refresh()
    }
  },

  onShow() {
    if (this.data.tournamentId) this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    await this.ensureIdentity()
    await Promise.all([
      this.loadTournamentDetail(),
      this.loadRegistrations(),
      this.loadBrackets(),
      this.loadFreePlays(),
      this.loadResultSummary()
    ])
    this.syncTournamentDisplayState()
    this.syncResultDisplayState()
    this._rebuildScheduleView()
    this.syncDetailPhaseState()
    this.scrollToRegistrationSectionIfNeeded()
  },

  async ensureIdentity() {
    try {
      if (app.globalData && !app.globalData.currentMember && typeof app.refreshIdentity === 'function') {
        await app.refreshIdentity()
      }
    } catch (err) {
      console.warn('[tournament-detail] refresh identity failed', err)
    }
  },

  enableShareMenu(enabled = true) {
    if (typeof wx === 'undefined') return
    if (enabled && wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
      return
    }
    if (!enabled && wx.hideShareMenu) {
      wx.hideShareMenu({
        menus: ['shareAppMessage', 'shareTimeline']
      })
    }
  },

  buildAccessState({ tournament, isAdmin, isParticipant, resultSummary }) {
    const tournamentWithSummary = withResultSummary(tournament, resultSummary)
    const statusMeta = getTournamentStatusMeta(tournamentWithSummary)
    const canEnterScore = !!(isAdmin || isParticipant)
    return {
      canEnterScore,
      canOpenScore: canEnterScore || isCompletedStatus(tournamentWithSummary),
      scoreActionLabel: statusMeta.scoreActionLabel,
      shareEnabled: statusMeta.canShare
    }
  },

  syncTournamentDisplayState() {
    if (!this.data.tournament) return
    const accessState = this.buildAccessState({
      tournament: this.data.tournament,
      resultSummary: this.data.resultSummary,
      isAdmin: this.data.isAdmin,
      isParticipant: this.data.isParticipant
    })
    this.enableShareMenu(accessState.shareEnabled)
    this.setData({
      tournamentDisplay: buildTournamentDisplay(this.data.tournament, this.data.resultSummary),
      ...accessState
    })
  },

  syncResultDisplayState() {
    this.setData({
      resultDisplay: buildResultDisplay(this.data.matchResultRows, this.data.tournament, this.data.registrations)
    })
  },

  syncDetailPhaseState() {
    if (!this.data.tournament) return
    this.setData(buildDetailPhaseState({
      tournament: this.data.tournament,
      registrations: this.data.registrations,
      resultSummary: this.data.resultSummary,
      isAdmin: this.data.isAdmin,
      isParticipant: this.data.isParticipant,
      canOpenScore: this.data.canOpenScore,
      scoreActionLabel: this.data.scoreActionLabel,
      now: this.data.now,
      entry: this.data.entry
    }))
  },

  async enrichTournamentSeason(tournament) {
    if (!tournament || tournament.seasonName || !tournament.seasonId) return tournament
    try {
      const res = await wx.cloud.callFunction({
        name: 'seasons',
        data: { action: 'get', id: tournament.seasonId }
      })
      const season = res && res.result && res.result.data
      if (!season || !season.name) {
        console.warn('[tournament-detail] season name missing', { seasonId: tournament.seasonId })
        return tournament
      }
      return { ...tournament, seasonName: season.name }
    } catch (err) {
      console.warn('[tournament-detail] load season failed', err)
      return tournament
    }
  },

  async loadTournamentDetail() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const result = await db.collection('tournaments').doc(this.data.tournamentId).get()
      if (!result.data) {
        wx.showToast({ title: '赛事不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }
      const tournament = await this.enrichTournamentSeason(result.data)
      const me = app.globalData && app.globalData.currentMember
      const isCreator = !!(me && tournament.createdBy && tournament.createdBy === me._id)
      const isAdmin = !!((app.globalData && app.globalData.isAdmin) || isCreator)
      const accessState = this.buildAccessState({
        tournament,
        resultSummary: this.data.resultSummary,
        isAdmin,
        isParticipant: this.data.isParticipant
      })
      this.enableShareMenu(accessState.shareEnabled)
      this.setData({
        tournament,
        tournamentDisplay: buildTournamentDisplay(tournament, this.data.resultSummary),
        isAdmin,
        ...accessState,
        loading: false
      })
    } catch (err) {
      console.error('加载赛事详情失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  async loadRegistrations() {
    try {
      const db = wx.cloud.database()
      const result = await db.collection('tournament_registrations')
        .where({
          tournamentId: this.data.tournamentId
        })
        .orderBy('seed', 'asc')
        .get()
      const rawRegs = (result.data || []).filter(isActiveRegistration)

      // 收集所有 playerId / partnerId 一次性查头像
      const ids = new Set()
      rawRegs.forEach(r => {
        if (r.playerId) ids.add(r.playerId)
        if (r.partnerId) ids.add(r.partnerId)
      })

      const avatarMap = await fetchAvatarMap([...ids])

      const registrations = buildRosterPeople(rawRegs, avatarMap)
      const isParticipant = this.isCurrentMemberRegistered(rawRegs)
      const accessState = this.buildAccessState({
        tournament: this.data.tournament,
        resultSummary: this.data.resultSummary,
        isAdmin: this.data.isAdmin,
        isParticipant
      })
      this.setData({
        registrations,
        isParticipant,
        ...accessState
      })
    } catch (err) {
      console.error('加载参赛人员失败:', err)
      const accessState = this.buildAccessState({
        tournament: this.data.tournament,
        resultSummary: this.data.resultSummary,
        isAdmin: this.data.isAdmin,
        isParticipant: false
      })
      this.setData({
        isParticipant: false,
        ...accessState
      })
    }
  },

  isCurrentMemberRegistered(rawRegs) {
    const member = app.globalData && app.globalData.currentMember
    const memberId = member && member._id
    if (!memberId) return false
    return (rawRegs || []).some(reg => (
      reg &&
      isActiveRegistration(reg) &&
      (reg.playerId === memberId || reg.partnerId === memberId)
    ))
  },

  async loadBrackets() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByTournament',
          tournamentId: this.data.tournamentId
        }
      })
      const brackets = (result.result && result.result.data) || []
      this.setData({ brackets })
    } catch (err) {
      console.error('加载对位表失败:', err)
    }
  },

  async loadFreePlays() {
    try {
      const r = await wx.cloud.callFunction({
        name: 'free-plays',
        data: { action: 'list', tournamentId: this.data.tournamentId }
      })
      const items = (r.result && r.result.success && r.result.data && r.result.data.items) || []
      this.setData({ freePlays: items })
    } catch (err) {
      console.error('加载自由拉球失败:', err)
    }
  },

  _rebuildScheduleView() {
    const view = buildScheduleView(this.data.tournament, this.data.brackets, this.data.freePlays)
    this.setData(view)
  },

  onBack() {
    wx.navigateBack()
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}&step=1` })
  },

  onResumeDraft() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}` })
  },

  onEnterScore() {
    if (!this.data.canOpenScore && !this.data.canEnterScore) {
      wx.showToast({ title: '仅参赛者可录入', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}` })
  },

  async onRegisterSelf() {
    if (!this.data.selfRegistrationSupported) {
      wx.showToast({ title: mapRegistrationError('SELF_REGISTRATION_UNSUPPORTED', '报名失败'), icon: 'none' })
      return
    }

    await this.ensureIdentity()
    const member = app.globalData && app.globalData.currentMember
    if (needsRegistrationIdentity(member)) {
      this.openRegistrationIdentityEditor()
      return
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'selfRegister', tournamentId: this.data.tournamentId }
      })
      if (!_isSuccess(res)) {
        wx.showToast({ title: _errMsg(res, '报名失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '已报名', icon: 'success' })
      await this.refresh()
    } catch (err) {
      console.error('[tournament-detail] self register failed', err)
      wx.showToast({ title: '报名失败', icon: 'none' })
    }
  },

  openRegistrationIdentityEditor() {
    wx.navigateTo({
      url: `/pages/edit-profile/index?mode=register&from=tournament-register&tournamentId=${this.data.tournamentId}`,
      events: {
        registrationIdentityReady: () => {
          this.setData({ entry: 'register' })
          this.refresh()
        }
      }
    })
  },

  async onWithdrawSelf() {
    const ok = await new Promise(resolve => wx.showModal({
      title: '退出报名',
      content: `确定退出本次赛事？${this.data.withdrawDeadlineLabel ? '退赛截止为 ' + this.data.withdrawDeadlineLabel : ''}`,
      success: ({ confirm }) => resolve(confirm),
      fail: () => resolve(false)
    }))
    if (!ok) return

    try {
      const res = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'withdraw', tournamentId: this.data.tournamentId }
      })
      if (!_isSuccess(res)) {
        wx.showToast({ title: _errMsg(res, '退出失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '已退出', icon: 'success' })
      await this.refresh()
    } catch (err) {
      console.error('[tournament-detail] withdraw failed', err)
      wx.showToast({ title: '退出失败', icon: 'none' })
    }
  },

  onArrangeSchedule() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}&step=3` })
  },

  onEditSchedule() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}&step=3&mode=edit-schedule` })
  },

  onAdjustResults() {
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}&mode=adjust` })
  },

  async onConfirmScheduleRevision() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'tournaments',
        data: { action: 'confirmScheduleRevision', id: this.data.tournamentId }
      })
      if (!_isSuccess(res)) {
        wx.showToast({ title: _errMsg(res, '确认失败'), icon: 'none' })
        return
      }
      await this.refresh()
    } catch (err) {
      console.error('[tournament-detail] confirm schedule revision failed', err)
      wx.showToast({ title: '确认失败', icon: 'none' })
    }
  },

  scrollToRegistrationSectionIfNeeded() {
    if (this.registrationEntryScrolled) return
    if (this.data.entry !== 'register') return
    if (this.data.phase !== PHASE.REGISTRATION_OPEN) return
    if (!this.data.selfRegistrationSupported) return
    if (!wx.createSelectorQuery || !wx.pageScrollTo) return

    this.registrationEntryScrolled = true
    wx.createSelectorQuery()
      .select('#registration-section')
      .boundingClientRect(rect => {
        if (rect) {
          wx.pageScrollTo({ scrollTop: Math.max(0, rect.top - 80), duration: 200 })
        }
      })
      .exec()
  },

  async loadResultSummary() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'match-results',
        data: { action: 'listByTournament', tournamentId: this.data.tournamentId }
      })
      const rows = unpackMatchResultRows(res)
      this.setData({
        matchResultRows: rows,
        resultSummary: buildResultSummary(rows)
      })
    } catch (err) {
      console.warn('[tournament-detail] load result summary failed', err)
      this.setData({
        matchResultRows: [],
        resultSummary: null,
        resultDisplay: emptyResultDisplay()
      })
    }
  },

  onShareAppMessage() {
    const tournament = this.data.tournament || {}
    const tournamentWithSummary = withResultSummary(tournament, this.data.resultSummary)
    const tournamentId = this.data.tournamentId || tournament._id || ''
    const entry = this.data.showRegistrationModule ? '&entry=register' : ''
    return {
      title: getTournamentShareTitle(tournamentWithSummary),
      path: tournamentId ? `/pages/tournament-detail/index?id=${encodeURIComponent(tournamentId)}${entry}` : '/pages/match/index'
    }
  },

  onShareTimeline() {
    const tournament = this.data.tournament || {}
    const tournamentWithSummary = withResultSummary(tournament, this.data.resultSummary)
    const tournamentId = this.data.tournamentId || tournament._id || ''
    const entry = this.data.showRegistrationModule ? '&entry=register' : ''
    return {
      title: getTournamentShareTitle(tournamentWithSummary),
      query: tournamentId ? `id=${encodeURIComponent(tournamentId)}${entry}` : ''
    }
  },

  onDelete() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该赛事吗？此操作不可恢复。',
      confirmColor: '#f56c6c',
      confirmText: '删除',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        wx.cloud.callFunction({
          name: 'tournaments',
          data: { action: 'delete', _id: this.data.tournamentId },
          success: () => {
            wx.hideLoading()
            wx.showToast({ title: '删除成功', icon: 'success' })
            if (app && app.globalData) {
              app.globalData.tournamentListDirty = true
              app.globalData.deletedTournamentId = this.data.tournamentId
            }
            setTimeout(() => wx.navigateBack(), 500)
          },
          fail: err => {
            wx.hideLoading()
            console.error('删除失败', err)
            wx.showToast({ title: '删除失败', icon: 'error' })
          }
        })
      }
    })
  }
})

function buildDetailPhaseState({
  tournament,
  registrations,
  resultSummary,
  isAdmin,
  isParticipant,
  canOpenScore,
  scoreActionLabel,
  now,
  entry
}) {
  const activeRegs = (registrations || []).filter(isActiveRegistration)
  const phase = derivePhase(tournament, { now, resultSummary })
  const withdraw = getWithdrawDeadline(tournament)
  const selfRegistrationSupported = !(tournament.format === 'knockout' && tournament.type === 'doubles')
  const canMemberWithdraw = !!(
    isParticipant &&
    canWithdraw(tournament, { now }) &&
    (
      phase === PHASE.REGISTRATION_OPEN ||
      phase === PHASE.PENDING_SCHEDULE ||
      phase === PHASE.SCHEDULE_PUBLISHED
    )
  )
  const showRegistrationModule = phase === PHASE.REGISTRATION_OPEN || phase === PHASE.PENDING_SCHEDULE
  const showScheduleSection = phase === PHASE.LEGACY || phase === PHASE.SCHEDULE_PUBLISHED || phase === PHASE.RESULTS || (isAdmin && phase === PHASE.SCHEDULE_DRAFT)
  const showResultsSection = phase === PHASE.LEGACY || phase === PHASE.RESULTS
  const footerActions = buildFooterActions({
    phase,
    isAdmin,
    isParticipant,
    canMemberWithdraw,
    selfRegistrationSupported,
    canOpenScore,
    scoreActionLabel
  })
  const primaryAction = footerActions.slice().reverse().find(action => action.key !== 'share')

  return {
    phase,
    entry: entry || '',
    phaseSteps: buildPhaseSteps(phase),
    activeRegistrationCount: activeRegs.length,
    withdrawDeadlineLabel: withdraw.label,
    showRegistrationModule,
    showRegistrationStatusCard: false,
    showWaitingScheduleButton: false,
    showScheduleSection,
    showResultsSection,
    footerActions,
    primaryActionLabel: primaryAction ? primaryAction.label : '',
    selfRegistrationSupported
  }
}

function buildPhaseSteps(phase) {
  const order = [
    { key: PHASE.REGISTRATION_OPEN, label: '报名', phases: [PHASE.REGISTRATION_OPEN] },
    { key: PHASE.PENDING_SCHEDULE, label: '排程', phases: [PHASE.PENDING_SCHEDULE, PHASE.SCHEDULE_DRAFT] },
    { key: PHASE.SCHEDULE_PUBLISHED, label: '比赛', phases: [PHASE.SCHEDULE_PUBLISHED] },
    { key: PHASE.RESULTS, label: '赛果', phases: [PHASE.RESULTS] }
  ]
  const activeIndex = order.findIndex(item => item.phases.includes(phase))
  return order.map((item, index) => ({
    key: item.key,
    label: item.label,
    active: index === activeIndex,
    done: activeIndex > index
  }))
}

function buildFooterActions({
  phase,
  isAdmin,
  isParticipant,
  canMemberWithdraw,
  selfRegistrationSupported,
  canOpenScore,
  scoreActionLabel
}) {
  if (phase === PHASE.DRAFT && isAdmin) {
    return [footerAction('resumeDraft', '继续创建', 'cta-lime full')]
  }

  const actions = [footerAction('share', '分享', 'cta-secondary share-cta', { openType: 'share' })]

  if (isAdmin) {
    if (phase === PHASE.RESULTS) {
      actions.push(footerAction('adjustResults', '调整成绩', 'cta-lime flex-1'))
      return actions
    }
    if (phase === PHASE.SCHEDULE_PUBLISHED) {
      actions.push(footerAction('editSchedule', '编辑赛程', 'cta-secondary'))
      actions.push(footerAction('enterScore', scoreActionLabel || '录入成绩', 'cta-lime flex-1'))
      return actions
    }
    if (phase === PHASE.PENDING_SCHEDULE || phase === PHASE.SCHEDULE_DRAFT) {
      actions.push(footerAction('edit', '编辑', 'cta-secondary'))
      actions.push(footerAction('arrangeSchedule', '安排对局', 'cta-lime flex-1'))
      return actions
    }
    actions.push(footerAction('edit', '编辑', 'cta-secondary'))
    return actions
  }

  if (phase === PHASE.REGISTRATION_OPEN) {
    if (isParticipant && canMemberWithdraw) {
      actions.push(footerAction('withdrawSelf', '退出报名', 'cta-lime flex-1'))
    } else if (!isParticipant && selfRegistrationSupported) {
      actions.push(footerAction('registerSelf', '我要报名', 'cta-lime flex-1'))
    }
    return actions
  }

  if ((phase === PHASE.PENDING_SCHEDULE || phase === PHASE.SCHEDULE_PUBLISHED) && isParticipant && canMemberWithdraw) {
    actions.push(footerAction('withdrawSelf', '退出报名', 'cta-lime flex-1'))
  }
  if (phase === PHASE.SCHEDULE_PUBLISHED && canOpenScore) {
    actions.push(footerAction('enterScore', scoreActionLabel || '录入成绩', 'cta-lime flex-1'))
  }
  if (phase === PHASE.RESULTS && canOpenScore) {
    actions.push(footerAction('enterScore', scoreActionLabel || '查看成绩', 'cta-lime flex-1'))
  }
  return actions
}

function footerAction(key, label, className, extra = {}) {
  return {
    key,
    label,
    className,
    ...extra
  }
}

function buildTournamentDisplay(tournament, resultSummary) {
  const config = tournament.config || {}
  const pointsRules = tournament.pointsRules || {}
  const placement = pointsRules.placement || {}
  const winLoss = pointsRules.winLoss || {}
  const isKnockout = tournament.format === 'knockout'
  const statusMeta = getTournamentStatusMeta(withResultSummary(tournament, resultSummary))

  const placementRows = [
    { label: '冠军', value: placement.champion },
    { label: '亚军', value: placement.runnerUp },
    { label: '四强', value: placement.semifinal },
    { label: '八强', value: placement.quarterfinal },
    { label: '参赛', value: placement.participation }
  ].filter(row => row.value !== undefined && row.value !== null)

  return {
    maxPlayers: tournament.maxPlayers || config.maxPlayers || '-',
    playersPerMatch: config.playersPerMatch || (tournament.type === 'mixed' ? '2 / 4' : (tournament.type === 'doubles' ? 4 : 2)),
    typeText: tournamentTypeText(tournament.type),
    showRoundInfo: isKnockout,
    currentRound: config.currentRound || 1,
    totalRounds: config.totalRounds || '-',
    formatText: isKnockout ? '淘汰赛' : '常规赛',
    statusKind: statusMeta.kind,
    statusLabel: statusMeta.label,
    statusHint: statusMeta.hint,
    scoreActionLabel: statusMeta.scoreActionLabel,
    shareEnabled: statusMeta.canShare,
    courtTimeText: courtTimeText(tournament),
    registrationDeadlineLabel: dateTimeLabel(tournament.registrationDeadlineAt),
    withdrawDeadlineLabel: getWithdrawDeadline(tournament).label,
    hasSeedPlayers: Array.isArray(config.seedPlayers) && config.seedPlayers.length > 0,
    seedPlayersText: Array.isArray(config.seedPlayers) ? config.seedPlayers.join(', ') : '',
    pointsMode: isKnockout ? 'placement' : 'winLoss',
    win: typeof winLoss.win === 'number' ? winLoss.win : '-',
    loss: typeof winLoss.loss === 'number' ? winLoss.loss : '-',
    walkover: typeof winLoss.walkover === 'number' ? winLoss.walkover : undefined,
    placementRows
  }
}

function buildRosterPeople(rawRegs, avatarMap) {
  const seen = new Set()
  const people = []
  const push = (id, name, reg) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const status = (reg && (reg.registrationStatus || reg.status)) || 'registered'
    people.push({
      _id: id,
      playerId: id,
      playerName: name || '',
      seed: reg && reg.seed,
      displayStatus: status,
      avatarUrl: avatarMap[id] || '',
      playerInitial: firstChar(name)
    })
  }
  ;(rawRegs || []).forEach(reg => {
    push(reg.playerId, reg.playerName, reg)
    push(reg.partnerId, reg.partnerName, reg)
  })
  return people
}

function unpackMatchResultRows(res) {
  const data = res && res.result && res.result.data
  if (data && Array.isArray(data.results)) return data.results
  if (Array.isArray(data)) return data
  return []
}

function emptyResultDisplay() {
  return { visible: false, completedText: '', standings: [], groups: [] }
}

function isPlayableResult(row) {
  return !!(
    row &&
    !row.bye &&
    row.player1 &&
    row.player2 &&
    row.player1.id &&
    row.player2.id &&
    !isByeSide(row.player1) &&
    !isByeSide(row.player2)
  )
}

function isByeSide(side) {
  return !!(side && (side.id === 'BYE' || side.name === 'BYE'))
}

function buildResultDisplay(rows, tournament, registrations) {
  const playable = (rows || []).filter(isPlayableResult)
  if (playable.length === 0) return emptyResultDisplay()
  if (!playable.every(row => row.resultStatus === 'confirmed')) return emptyResultDisplay()

  const sorted = playable.slice().sort((a, b) => {
    if ((a.round || 0) !== (b.round || 0)) return (a.round || 0) - (b.round || 0)
    if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0)
    return (a.queueOrder || 0) - (b.queueOrder || 0)
  })
  const groupsMap = new Map()
  sorted.forEach(row => {
    const round = row.round || 1
    if (!groupsMap.has(round)) groupsMap.set(round, [])
    groupsMap.get(round).push(buildResultMatchRow(row))
  })

  return {
    visible: true,
    completedText: `已完成 ${playable.length} / ${playable.length} 场`,
    standings: buildResultStandings(sorted, tournament || {}, registrations || []),
    groups: [...groupsMap.entries()].map(([round, matches]) => ({
      round,
      label: `ROUND ${round < 10 ? '0' : ''}${round}`,
      matches
    }))
  }
}

function buildResultMatchRow(row) {
  return {
    matchId: resultMatchId(row),
    round: row.round || 1,
    position: row.position || 0,
    p1Label: sideLabel(row.player1),
    p2Label: sideLabel(row.player2),
    scoreText: scoreText(row.score),
    winnerLabel: sideLabel(row.winner),
    pointsText: pointsText(row)
  }
}

function resultMatchId(row) {
  const persisted = [
    row && row._id,
    row && row.sourceMatchId,
    row && row.matchId
  ].map(keyPart).find(Boolean)
  if (persisted) return persisted

  const round = keyPart(row && row.round) || '1'
  const position = keyPart(row && row.position) || '0'
  const queueOrder = keyPart(row && row.queueOrder) || 'none'
  const p1 = sideIdentity(row && row.player1) || sideLabel(row && row.player1) || 'p1'
  const p2 = sideIdentity(row && row.player2) || sideLabel(row && row.player2) || 'p2'
  return `round:${round}|position:${position}|queue:${queueOrder}|p1:${p1}|p2:${p2}`
}

function keyPart(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function sideLabel(side) {
  if (!side) return ''
  const name = side.name || ''
  const partner = side.partnerName || ''
  return partner ? `${name} / ${partner}` : name
}

function scoreText(score) {
  const set0 = score && score.sets && score.sets[0]
  if (!set0) return ''
  const base = `${set0.a}:${set0.b}`
  return score.tiebreak ? `${base} (${score.tiebreak})` : base
}

function pointsText(row) {
  const entries = row && row.pointsAwarded && row.pointsAwarded.entries
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const p1Ids = sideIds(row.player1)
  const p2Ids = sideIds(row.player2)
  const sumFor = ids => entries
    .filter(entry => ids.includes(entry.memberId))
    .reduce((sum, entry) => sum + (entry.points || 0), 0)
  const p1 = sumFor(p1Ids)
  const p2 = sumFor(p2Ids)
  if (!p1 && !p2) return ''
  return `+${p1} / +${p2}`
}

function sideIds(side) {
  if (!side) return []
  return [side.id, side.partnerId].filter(Boolean)
}

function buildResultStandings(rows, tournament, registrations) {
  const directory = buildParticipantDirectory(rows, registrations)
  const stats = new Map()

  const ensure = member => {
    if (!member || !member.memberId) return null
    const key = member.memberId
    if (!stats.has(key)) {
      const name = member.memberName || key
      stats.set(key, {
        standingKey: key,
        memberId: key,
        memberName: name,
        avatarUrl: member.avatarUrl || '',
        playerInitial: member.playerInitial || firstChar(name),
        singlesPoints: 0,
        doublesPoints: 0,
        totalPoints: 0,
        wins: 0,
        losses: 0
      })
    }
    return stats.get(key)
  }

  rows.forEach(row => {
    const p1Members = directory.membersFromSide(row.player1)
    const p2Members = directory.membersFromSide(row.player2)
    p1Members.forEach(ensure)
    p2Members.forEach(ensure)

    if (sameSide(row.winner, row.player1)) {
      p1Members.forEach(member => { ensure(member).wins += 1 })
      p2Members.forEach(member => { ensure(member).losses += 1 })
    } else if (sameSide(row.winner, row.player2)) {
      p2Members.forEach(member => { ensure(member).wins += 1 })
      p1Members.forEach(member => { ensure(member).losses += 1 })
    }

    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    const bucket = resultPointBucket(row, tournament)
    entries.forEach(entry => {
      if (!entry || !entry.memberId) return
      const stat = ensure(directory.memberForId(entry.memberId))
      if (!stat) return
      const points = Number(entry.points) || 0
      stat[bucket] += points
      stat.totalPoints += points
    })
  })

  return [...stats.values()]
    .sort((a, b) => (
      (b.totalPoints - a.totalPoints) ||
      (b.wins - a.wins) ||
      (a.losses - b.losses) ||
      compareLabels(a.memberId, b.memberId) ||
      compareLabels(a.memberName, b.memberName)
    ))
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      recordText: `${item.wins}胜${item.losses}负`,
      singlesPointsText: String(item.singlesPoints),
      doublesPointsText: String(item.doublesPoints)
    }))
}

function buildParticipantDirectory(rows, registrations) {
  const members = new Map()
  const add = (memberId, memberName, avatarUrl, playerInitial) => {
    if (!memberId) return null
    const key = String(memberId)
    const existing = members.get(key) || { memberId: key }
    const name = existing.memberName || memberName || key
    const next = {
      ...existing,
      memberName: name,
      avatarUrl: avatarUrl || existing.avatarUrl || '',
      playerInitial: playerInitial || existing.playerInitial || firstChar(name)
    }
    members.set(key, next)
    return next
  }
  const addSide = side => {
    if (!side) return
    add(side.id, side.name, side.avatarUrl, side.playerInitial)
    add(side.partnerId, side.partnerName, side.partnerAvatarUrl, side.partnerInitial)
  }

  ;(registrations || []).forEach(member => {
    add(member.playerId || member._id, member.playerName || member.name, member.avatarUrl, member.playerInitial)
  })
  ;(rows || []).forEach(row => {
    addSide(row.player1)
    addSide(row.player2)
    addSide(row.winner)
  })

  const memberForId = memberId => add(memberId, '', '', '')
  const membersFromSide = side => {
    const ids = sideIds(side)
    return ids.map(memberForId).filter(Boolean)
  }
  return { memberForId, membersFromSide }
}

function resultPointBucket(row, tournament) {
  const type = (row && (row.tournamentType || row.type || row.matchType)) || (tournament && tournament.type) || 'singles'
  if (type === 'doubles') return 'doublesPoints'
  if (type === 'mixed' && (sideIds(row && row.player1).length > 1 || sideIds(row && row.player2).length > 1)) return 'doublesPoints'
  return 'singlesPoints'
}

function sideIdentity(side) {
  const ids = sideIds(side).slice().sort()
  return ids.join('/')
}

function compareLabels(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function sameSide(a, b) {
  if (!a || !b) return false
  return a.id === b.id || a.id === b.partnerId || a.partnerId === b.id || (a.partnerId && a.partnerId === b.partnerId)
}

function buildResultSummary(rows) {
  const playable = (rows || []).filter(isPlayableResult)
  return {
    playableCount: playable.length,
    confirmedCount: playable.filter(row => row.resultStatus === 'confirmed').length
  }
}

function withResultSummary(tournament, resultSummary) {
  if (!tournament) return { resultSummary }
  return { ...tournament, resultSummary: resultSummary || tournament.resultSummary || null }
}

function tournamentTypeText(type) {
  if (type === 'mixed') return 'MIXED · 混合'
  if (type === 'doubles') return 'DOUBLES · 双打'
  return 'SINGLES · 单打'
}

function buildScheduleView(tournament, brackets, freePlays) {
  const schedulePlan = tournament && tournament.schedulePlan
  if (!schedulePlan || !Array.isArray(schedulePlan.courts) || schedulePlan.courts.length === 0) {
    return { scheduleCourts: [], scheduleRows: [] }
  }

  const courts = schedulePlan.courts.map(c => ({
    courtId: c.courtId,
    name: c.name,
    slots: [...(c.slots || [])].sort()
  }))

  const slotKeySet = new Set()
  courts.forEach(c => c.slots.forEach(s => slotKeySet.add(s)))
  const slotKeys = [...slotKeySet].sort()

  // 取 R1 bracket 的所有 matches（含 extras + regularRound + bracket）
  const r1 = (brackets || []).find(b => b.round === 1)
  const r1Matches = (r1 && r1.matches) || []

  // cellByCourt[courtId][slotIndex] -> cell data
  const cellByCourt = {}
  courts.forEach(c => { cellByCourt[c.courtId] = {} })

  r1Matches.forEach(m => {
    if (!m.courtId || m.queueOrder === null || m.queueOrder === undefined) return
    if (!cellByCourt[m.courtId]) return
    const isDoubles = !!(m.player1 && m.player1.partnerId)
    cellByCourt[m.courtId][m.queueOrder] = {
      kind: 'match',
      __rowKind: m.matchKind || 'bracket',
      __isDoubles: isDoubles,
      __player1Label: playerLabel(m.player1, m.bye),
      __player2Label: playerLabel(m.player2, m.bye),
      __doublesP1: m.player1 ? (m.player1.name || '?') : (m.bye ? 'BYE' : '?'),
      __doublesPartner1: (m.player1 && m.player1.partnerName) || '',
      __doublesP2: m.player2 ? (m.player2.name || '?') : (m.bye ? 'BYE' : '?'),
      __doublesPartner2: (m.player2 && m.player2.partnerName) || ''
    }
  })

  ;(freePlays || []).forEach(fp => {
    if (!fp.courtId || fp.queueOrder === null || fp.queueOrder === undefined) return
    if (!cellByCourt[fp.courtId]) return
    if (cellByCourt[fp.courtId][fp.queueOrder]) return  // 比赛优先
    cellByCourt[fp.courtId][fp.queueOrder] = {
      kind: 'freePlay',
      __rowKind: 'freePlay'
    }
  })

  const rows = slotKeys.map(slotKey => ({
    slotKey,
    slotLabel: formatSlotLabel(slotKey),
    cells: courts.map(c => {
      const slotIndex = c.slots.indexOf(slotKey)
      if (slotIndex < 0) {
        return { courtId: c.courtId, kind: null, __rowKind: 'unavailable' }
      }
      const cell = cellByCourt[c.courtId][slotIndex]
      if (!cell) return { courtId: c.courtId, kind: null, __rowKind: 'empty' }
      return { ...cell, courtId: c.courtId }
    })
  }))

  return { scheduleCourts: courts, scheduleRows: rows }
}

function formatSlotLabel(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[1]}:${m[2]}` : String(iso || '')
}

function playerLabel(p, bye) {
  if (!p) return bye ? 'BYE' : '?'
  if (p.id === 'BYE' || p.name === 'BYE') return 'BYE'
  return (p.name || '') + (p.partnerName ? '/' + p.partnerName : '')
}

function firstChar(name) {
  const s = (name || '').trim()
  return s ? s.charAt(0) : '?'
}

function needsRegistrationIdentity(member) {
  return !member || member.claimStatus !== 'claimed'
}

function _isSuccess(res) {
  return !!(res && res.result && res.result.success === true)
}

function _errMsg(res, fallback) {
  const r = res && res.result
  if (!r) return fallback
  if (r.error) {
    if (typeof r.error === 'string') return r.error
    const code = r.error.code || r.error.errCode
    const mapped = mapRegistrationError(code, '')
    if (mapped) return mapped
    if (r.error.message) return r.error.message
    if (r.error.errMsg) return r.error.errMsg
  }
  if (r.code || r.errCode) {
    const mapped = mapRegistrationError(r.code || r.errCode, '')
    if (mapped) return mapped
  }
  if (r.errMsg) return r.errMsg
  return fallback
}

function mapRegistrationError(code, fallback) {
  const map = {
    MEMBER_REQUIRED: '请先完善资料',
    CAPACITY_FULL: '名额已满',
    REGISTRATION_CLOSED: '报名已截止',
    WITHDRAW_CLOSED: '已过退赛截止时间',
    MATCH_HAS_RESULT: '该场次已有成绩，请联系管理员处理',
    SELF_REGISTRATION_UNSUPPORTED: '该赛制暂不支持自助报名',
    ALREADY_REGISTERED: '你已报名',
    PERMISSION_DENIED: '只能为自己操作'
  }
  return map[code] || fallback
}

function courtTimeText(tournament = {}) {
  const schedulePlan = tournament.schedulePlan || {}
  const courts = Array.isArray(schedulePlan.courts) ? schedulePlan.courts : []
  if (courts.length > 0) {
    return courts.map(court => {
      const slots = (court.slots || []).slice().sort()
      if (slots.length === 0) return court.name || ''
      const start = formatSlotTime(slots[0])
      const end = slotEndTime(slots[slots.length - 1], schedulePlan.slotMinutes || tournament.slotMinutes || 20)
      const time = end ? `${start}-${end}` : start
      return `${court.name || '场地'}：${time}`
    }).filter(Boolean).join('；')
  }

  const grid = tournament.courtTimeGrid || {}
  const gridCourts = Array.isArray(grid.courts) ? grid.courts : []
  const gridSlots = Array.isArray(grid.slots) ? grid.slots : []
  if (gridCourts.length > 0 && gridSlots.length > 0) {
    const start = formatSlotTime(gridSlots[0])
    const end = slotEndTime(gridSlots[gridSlots.length - 1], grid.matchDuration || 20)
    return gridCourts.map(court => `${court.name || '场地'}：${start}${end ? '-' + end : ''}`).join('；')
  }

  if (tournament.courtName && (tournament.startTime || tournament.endTime)) {
    return `${tournament.courtName}：${[tournament.startTime, tournament.endTime].filter(Boolean).join('-')}`
  }
  return '待定'
}

function formatSlotTime(value) {
  const text = String(value || '')
  const match = /T(\d{2}):(\d{2})/.exec(text) || /^(\d{2}):(\d{2})/.exec(text)
  return match ? `${match[1]}:${match[2]}` : text
}

function slotEndTime(value, minutes) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() + Number(minutes || 0))
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function dateTimeLabel(value) {
  if (!value) return ''
  const text = String(value)
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  const timeMatch = /T(\d{2}):(\d{2})/.exec(text)
  if (!dateMatch) return text
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  return timeMatch ? `${month}月${day}日 ${timeMatch[1]}:${timeMatch[2]}` : `${month}月${day}日`
}

async function fetchAvatarMap(ids) {
  if (!ids || ids.length === 0) return {}
  const db = wx.cloud.database()
  // 小程序云数据库一次 in 查询限制 ~20，按 20 个一批拉取
  const chunkSize = 20
  const map = {}
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    try {
      const r = await db.collection('members').where({ _id: db.command.in(chunk) }).field({ avatarUrl: true, name: true }).get()
      ;(r.data || []).forEach(m => { map[m._id] = m.avatarUrl || '' })
    } catch (e) {
      console.error('[tournament-detail] fetchAvatarMap chunk failed', e)
    }
  }
  return map
}
