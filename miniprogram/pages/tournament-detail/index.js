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
  canRegister,
  isActiveRegistration
} = require('../../utils/tournament-phase')
const { getNextTournamentShareImage } = require('../../utils/share-images')

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
    isCreator: false,
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

  ensureOfficialPrivacyAuthorization(rejectTitle) {
    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      return Promise.resolve(true)
    }

    return new Promise(resolve => {
      wx.requirePrivacyAuthorize({
        success: () => resolve(true),
        fail: () => {
          wx.showToast({
            title: rejectTitle || '请先同意微信隐私授权',
            icon: 'none'
          })
          resolve(false)
        }
      })
    })
  },

  confirmRegistrationLogin() {
    return new Promise(resolve => {
      wx.showModal({
        title: '登录后报名',
        content: '报名需要先登录或注册会员资料。登录完成后将返回本赛事报名区。',
        confirmText: '去登录',
        cancelText: '暂不登录',
        success: ({ confirm }) => resolve(!!confirm),
        fail: () => resolve(false)
      })
    })
  },

  async ensureIdentity(options = {}) {
    try {
      if (app.globalData && app.globalData.currentMember) return true
      if (options.requirePrivacy) {
        const authorized = await this.ensureOfficialPrivacyAuthorization('请先同意微信隐私授权')
        if (!authorized) return false
      }
      if (app.globalData && !app.globalData.currentMember && typeof app.refreshIdentity === 'function') {
        if (!app.identityReady) app.identityReady = app.refreshIdentity()
        await app.identityReady
      }
      return true
    } catch (err) {
      console.warn('[tournament-detail] refresh identity failed', err)
      return false
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
      isCreator: this.data.isCreator,
      isParticipant: this.data.isParticipant,
      canOpenScore: this.data.canOpenScore,
      scoreActionLabel: this.data.scoreActionLabel,
      now: this.data.now,
      entry: this.data.entry
    }))
  },

  async enrichTournamentSeason(tournament) {
    if (!tournament || hasUsableText(tournament.seasonName)) return tournament
    let enriched = tournament
    if (tournament.seasonId) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'seasons',
          data: { action: 'get', id: tournament.seasonId }
        })
        const season = extractSeasonRecord(res)
        if (season && hasUsableText(season.name)) {
          return { ...tournament, seasonName: season.name }
        }
        console.warn('[tournament-detail] season name missing', { seasonId: tournament.seasonId })
      } catch (err) {
        console.warn('[tournament-detail] load season by id failed', err)
      }
    }
    if (tournament.startDate) {
      try {
        const currentRes = await wx.cloud.callFunction({
          name: 'seasons',
          data: { action: 'getCurrent', date: tournament.startDate }
        })
        const season = extractSeasonRecord(currentRes)
        if (season && hasUsableText(season.name)) {
          enriched = {
            ...tournament,
            seasonId: tournament.seasonId || season._id || season.seasonId,
            seasonName: season.name
          }
        }
      } catch (err) {
        console.warn('[tournament-detail] load current season failed', err)
      }
    }
    return enriched
  },

  async loadTournamentDetail() {
    this.setData({ loading: true })
    try {
      const result = await wx.cloud.callFunction({
        name: 'tournaments',
        data: { action: 'get', id: this.data.tournamentId }
      })
      const rawTournament = unpackTournamentRecord(result)
      if (!rawTournament) {
        wx.showToast({ title: '赛事不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }
      const tournament = await this.enrichTournamentSeason(rawTournament)
      const me = app.globalData && app.globalData.currentMember
      const isCreator = isTournamentCreator(tournament, me)
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
        isCreator,
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
      const result = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: {
          action: 'list',
          tournamentId: this.data.tournamentId
        }
      })
      const rawRegs = unpackRegistrationRows(result).filter(isActiveRegistration)

      const registrations = buildRosterPeople(rawRegs)
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
    const member = app.globalData && app.globalData.currentMember
    const view = buildScheduleView(this.data.tournament, this.data.brackets, this.data.freePlays, currentMemberId(member))
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

    const hadMemberBeforeLogin = !!(app.globalData && app.globalData.currentMember)
    if (!hadMemberBeforeLogin) {
      const shouldLogin = await this.confirmRegistrationLogin()
      if (!shouldLogin) return
    }

    const identityReady = await this.ensureIdentity({ requirePrivacy: true })
    if (!identityReady) return
    const member = app.globalData && app.globalData.currentMember
    if (needsRegistrationIdentity(member)) {
      this.openRegistrationIdentityEditor()
      return
    }
    if (!hadMemberBeforeLogin) {
      this.registrationEntryScrolled = false
      this.setData({ entry: 'register' })
      await this.refresh()
      return
    }
    if (isTournamentCreator(this.data.tournament, member)) {
      wx.showToast({ title: mapRegistrationError('CREATOR_CANNOT_REGISTER', '报名失败'), icon: 'none' })
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
          this.registrationEntryScrolled = false
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

  onArrangeGroupBracket() {
    wx.navigateTo({ url: `/pages/tournament-brackets/index?id=${this.data.tournamentId}&mode=arrange` })
  },

  onViewBracket() {
    wx.navigateTo({ url: `/pages/tournament-brackets/index?id=${this.data.tournamentId}` })
  },

  async onConfirmKnockoutSeeds() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: { action: 'confirmKnockoutSeeds', tournamentId: this.data.tournamentId }
      })
      if (!_isSuccess(res)) {
        wx.showToast({ title: _errMsg(res, '确认失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '已生成8强', icon: 'success' })
      await this.refresh()
    } catch (err) {
      console.error('[tournament-detail] confirm knockout seeds failed', err)
      wx.showToast({ title: '确认失败', icon: 'none' })
    }
  },

  async onResettleGroupKnockout() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'points-engine',
        data: { action: 'recompute', tournamentId: this.data.tournamentId }
      })
      if (!_isSuccess(res)) {
        wx.showToast({ title: _errMsg(res, '结算失败'), icon: 'none' })
        return
      }
      wx.showToast({ title: '已重新结算', icon: 'success' })
      await this.refresh()
    } catch (err) {
      console.error('[tournament-detail] resettle group knockout failed', err)
      wx.showToast({ title: '结算失败', icon: 'none' })
    }
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
      path: tournamentId ? `/pages/tournament-detail/index?id=${encodeURIComponent(tournamentId)}${entry}` : '/pages/match/index',
      imageUrl: getNextTournamentShareImage(tournament, { registrationEntry: this.data.showRegistrationModule })
    }
  },

  onShareTimeline() {
    const tournament = this.data.tournament || {}
    const tournamentWithSummary = withResultSummary(tournament, this.data.resultSummary)
    const tournamentId = this.data.tournamentId || tournament._id || ''
    const entry = this.data.showRegistrationModule ? '&entry=register' : ''
    return {
      title: getTournamentShareTitle(tournamentWithSummary),
      query: tournamentId ? `id=${encodeURIComponent(tournamentId)}${entry}` : '',
      imageUrl: getNextTournamentShareImage(tournament, { registrationEntry: this.data.showRegistrationModule })
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
  isCreator,
  isParticipant,
  canOpenScore,
  scoreActionLabel,
  now,
  entry
}) {
  const activeRegs = (registrations || []).filter(isActiveRegistration)
  const phase = derivePhase(tournament, { now, resultSummary })
  const withdraw = getWithdrawDeadline(tournament)

  if (tournament.format === 'group_knockout') {
    return buildGroupKnockoutDetailPhaseState({
      tournament,
      registrations,
      isAdmin,
      isParticipant,
      canOpenScore,
      scoreActionLabel,
      entry
    })
  }

  const selfRegistrationSupported = !(tournament.format === 'knockout' && tournament.type === 'doubles')
  const registrationAvailability = canRegister(tournament, {
    now,
    confirmedCount: activeRegs.length
  })
  const canSelfRegister = selfRegistrationSupported && registrationAvailability.ok
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
    isCreator,
    isParticipant,
    canMemberWithdraw,
    selfRegistrationSupported,
    canSelfRegister,
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

function buildGroupKnockoutDetailPhaseState({
  tournament,
  registrations,
  isAdmin,
  isParticipant,
  canOpenScore,
  scoreActionLabel,
  entry
}) {
  const activeRegs = (registrations || []).filter(isActiveRegistration)
  const phase = tournament.groupKnockoutPhase || 'group_draft'
  const withdraw = getWithdrawDeadline(tournament)
  const footerActions = [footerAction('share', '分享', 'cta-secondary share-cta', { openType: 'share' })]
  const needsResettle = !!(isAdmin && phase === 'knockout_published' && tournament.status === 'completed')

  if (isAdmin && phase === 'group_draft') {
    footerActions.push(footerAction('edit', '编辑', 'cta-secondary'))
    footerActions.push(footerAction('arrangeGroupBracket', '安排签表', 'cta-lime flex-1'))
  } else if (isAdmin && phase === 'group_completed') {
    footerActions.push(footerAction('confirmKnockoutSeeds', '确认8强', 'cta-lime flex-1'))
  } else if (phase === 'group_published' || phase === 'knockout_published') {
    footerActions.push(footerAction('viewBracket', '查看签表', 'cta-secondary'))
    footerActions.push(footerAction('enterScore', scoreActionLabel || '录入成绩', 'cta-lime flex-1'))
    if (needsResettle) {
      footerActions.push(footerAction('resettleGroupKnockout', '重新结算', 'cta-lime flex-1'))
    }
  } else {
    footerActions.push(footerAction('viewBracket', '查看签表', 'cta-lime flex-1'))
  }

  const primaryAction = footerActions.slice().reverse().find(action => action.key !== 'share')

  return {
    phase,
    entry: entry || '',
    phaseSteps: buildGroupKnockoutPhaseSteps(phase),
    activeRegistrationCount: activeRegs.length,
    withdrawDeadlineLabel: withdraw.label,
    showRegistrationModule: false,
    showRegistrationStatusCard: false,
    showWaitingScheduleButton: false,
    showScheduleSection: false,
    showResultsSection: phase === 'completed',
    footerActions,
    canOpenScore,
    primaryActionLabel: primaryAction ? primaryAction.label : '',
    selfRegistrationSupported: true
  }
}

function buildGroupKnockoutPhaseSteps(phase) {
  const steps = [
    { key: 'registration', label: '报名' },
    { key: 'group', label: phase === 'group_draft' ? '签表' : '小组赛' },
    { key: 'knockout', label: '淘汰赛' },
    { key: 'results', label: '赛果' }
  ]
  const activeIndex = (
    phase === 'group_draft' ||
    phase === 'group_published' ||
    phase === 'group_completed'
  )
    ? 1
    : (phase === 'knockout_published' ? 2 : 3)

  return steps.map((step, index) => ({
    ...step,
    active: index === activeIndex,
    done: index < activeIndex
  }))
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
  isCreator,
  isParticipant,
  canMemberWithdraw,
  selfRegistrationSupported,
  canSelfRegister,
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
    if (phase === PHASE.REGISTRATION_OPEN) {
      actions.push(footerAction('edit', '编辑', 'cta-secondary'))
      if (!isCreator) {
        if (isParticipant && canMemberWithdraw) {
          actions.push(footerAction('withdrawSelf', '退出报名', 'cta-lime flex-1'))
        } else if (!isParticipant && canSelfRegister) {
          actions.push(footerAction('registerSelf', '我要报名', 'cta-lime flex-1'))
        }
      }
      actions.push(footerAction('arrangeSchedule', '安排对局', 'cta-lime flex-1'))
      return actions
    }
    actions.push(footerAction('edit', '编辑', 'cta-secondary'))
    return actions
  }

  if (phase === PHASE.REGISTRATION_OPEN) {
    if (isParticipant && canMemberWithdraw) {
      actions.push(footerAction('withdrawSelf', '退出报名', 'cta-lime flex-1'))
    } else if (!isParticipant && canSelfRegister) {
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
  const safeTournament = tournament || {}
  const config = safeTournament.config || {}
  const pointsRules = safeTournament.pointsRules || {}
  const placement = pointsRules.placement || {}
  const winLoss = pointsRules.winLoss || {}
  const isKnockout = safeTournament.format === 'knockout'
  const isGroupKnockout = safeTournament.format === 'group_knockout'
  const groupKnockoutPoints = getGroupKnockoutPointRules(safeTournament)
  const displayPlacement = isGroupKnockout ? groupKnockoutPoints.placement : placement
  const groupKnockoutStatus = buildGroupKnockoutStatusText(safeTournament.groupKnockoutPhase || 'group_draft')
  const statusMeta = getTournamentStatusMeta(withResultSummary(safeTournament, resultSummary))

  const placementRows = [
    { label: '冠军', value: displayPlacement.champion },
    { label: '亚军', value: displayPlacement.runnerUp },
    { label: '四强', value: displayPlacement.semifinal },
    { label: '八强', value: displayPlacement.quarterfinal },
    { label: '参赛', value: displayPlacement.participation }
  ].filter(row => row.value !== undefined && row.value !== null)

  const withdraw = getWithdrawDeadline(safeTournament)
  const registrationDeadlineText = dateTimeLabel(safeTournament.registrationDeadlineAt || safeTournament.deadlineAt || safeTournament.deadline) || '—'
  const withdrawDeadlineText = dateTimeLabel(safeTournament.withdrawDeadlineAt) || withdraw.label || '—'

  return {
    seasonText: seasonDisplayText(safeTournament),
    matchTimeText: matchTimeText(safeTournament),
    locationText: cleanDisplayText(safeTournament.location) || '—',
    maxPlayers: safeTournament.maxPlayers || config.maxPlayers || '-',
    playersPerMatch: config.playersPerMatch || (safeTournament.type === 'mixed' ? '2 / 4' : (safeTournament.type === 'doubles' ? 4 : 2)),
    typeText: tournamentTypeText(safeTournament.type),
    showRoundInfo: isKnockout,
    currentRound: config.currentRound || 1,
    totalRounds: config.totalRounds || '-',
    formatText: isGroupKnockout ? '小组+淘汰' : (isKnockout ? '淘汰赛' : '常规赛'),
    statusKind: statusMeta.kind,
    statusLabel: statusMeta.label,
    statusHint: statusMeta.hint,
    scoreActionLabel: statusMeta.scoreActionLabel,
    shareEnabled: statusMeta.canShare,
    courtTimeText: courtTimeText(safeTournament),
    registrationDeadlineLabel: registrationDeadlineText,
    registrationDeadlineText,
    withdrawDeadlineLabel: withdraw.label,
    withdrawDeadlineText,
    hasSeedPlayers: Array.isArray(config.seedPlayers) && config.seedPlayers.length > 0,
    seedPlayersText: Array.isArray(config.seedPlayers) ? config.seedPlayers.join(', ') : '',
    pointsMode: isGroupKnockout ? 'groupKnockout' : (isKnockout ? 'placement' : 'winLoss'),
    win: typeof winLoss.win === 'number' ? winLoss.win : '-',
    loss: typeof winLoss.loss === 'number' ? winLoss.loss : '-',
    walkover: typeof winLoss.walkover === 'number' ? winLoss.walkover : undefined,
    groupWin: typeof groupKnockoutPoints.group.win === 'number' ? groupKnockoutPoints.group.win : '-',
    groupLoss: typeof groupKnockoutPoints.group.loss === 'number' ? groupKnockoutPoints.group.loss : '-',
    placementRows,
    groupKnockoutProgressText: groupKnockoutStatus.progressText,
    groupDrawStatusText: groupKnockoutStatus.groupDrawStatusText,
    groupStageStatusText: groupKnockoutStatus.groupStageStatusText,
    knockoutStatusText: groupKnockoutStatus.knockoutStatusText
  }
}

function getGroupKnockoutPointRules(tournament) {
  const size = String(Number(tournament.bracketSize) || Number(tournament.maxPlayers) || 16)
  const defaults = {
    12: { placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 }, group: { win: 20, loss: 10 } },
    16: { placement: { champion: 500, runnerUp: 350, semifinal: 250, quarterfinal: 180 }, group: { win: 50, loss: 25 } }
  }
  const groupKnockout = (tournament.pointsRules && tournament.pointsRules.groupKnockout) || {}
  const fallback = defaults[size] || defaults[16]
  const override = groupKnockout[size] || {}
  return {
    placement: { ...fallback.placement, ...(override.placement || {}) },
    group: { ...fallback.group, ...(override.group || {}) }
  }
}

function buildGroupKnockoutStatusText(phase) {
  const map = {
    group_draft: {
      progressText: '待安排签表',
      groupDrawStatusText: '待安排',
      groupStageStatusText: '待生成',
      knockoutStatusText: '待生成'
    },
    group_published: {
      progressText: '小组赛进行中',
      groupDrawStatusText: '已安排',
      groupStageStatusText: '进行中',
      knockoutStatusText: '待生成'
    },
    group_completed: {
      progressText: '待确认8强',
      groupDrawStatusText: '已安排',
      groupStageStatusText: '已完成',
      knockoutStatusText: '待确认'
    },
    knockout_published: {
      progressText: '淘汰赛进行中',
      groupDrawStatusText: '已安排',
      groupStageStatusText: '已完成',
      knockoutStatusText: '进行中'
    },
    completed: {
      progressText: '已完成',
      groupDrawStatusText: '已安排',
      groupStageStatusText: '已完成',
      knockoutStatusText: '已完成'
    }
  }
  return map[phase] || map.group_draft
}

function extractSeasonRecord(res) {
  const data = res && res.result && res.result.data
  if (!data) return null
  if (data.season) {
    return {
      ...data.season,
      seasonId: data.seasonId || data.season._id,
      name: data.season.name || data.name
    }
  }
  return data
}

function seasonDisplayText(tournament) {
  const name = cleanDisplayText(tournament.seasonName)
  if (name) return name
  const year = yearFromDate(tournament.startDate) || yearFromSeasonId(tournament.seasonId)
  if (year) return `${year} 赛季`
  return cleanDisplayText(tournament.seasonId) || '—'
}

function matchTimeText(tournament) {
  const start = dateDisplayText(tournament.startDate)
  const end = dateDisplayText(tournament.endDate)
  if (start && end && start !== end) return `${start} → ${end}`
  return start || end || '—'
}

function dateDisplayText(value) {
  if (!value) return ''
  const parts = extractDateTimeParts(value)
  if (parts) return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
  return cleanDisplayText(value)
}

function cleanDisplayText(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return hasUsableText(text) ? text : ''
}

function hasUsableText(value) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  return !!text && text !== '-' && text !== '—'
}

function yearFromDate(value) {
  const parts = extractDateTimeParts(value)
  return parts ? String(parts.year) : ''
}

function yearFromSeasonId(value) {
  const match = /(?:^|_)(20\d{2})(?:$|_)/.exec(String(value || ''))
  return match ? match[1] : ''
}

function buildRosterPeople(rawRegs, avatarMap) {
  const seen = new Set()
  const people = []
  const push = (id, name, reg, avatarUrl) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const status = (reg && (reg.registrationStatus || reg.status)) || 'registered'
    people.push({
      _id: id,
      playerId: id,
      playerName: name || '',
      seed: reg && reg.seed,
      displayStatus: status,
      avatarUrl: avatarUrl || (avatarMap && avatarMap[id]) || '',
      playerInitial: firstChar(name)
    })
  }
  ;(rawRegs || []).forEach(reg => {
    push(reg.playerId, reg.playerName, reg, reg.playerAvatarUrl || reg.avatarUrl)
    push(reg.partnerId, reg.partnerName, reg, reg.partnerAvatarUrl)
  })
  return people
}

function unpackRegistrationRows(res) {
  const data = res && res.result && res.result.data
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.registrations)) return data.registrations
  if (data && Array.isArray(data.items)) return data.items
  return []
}

function unpackTournamentRecord(res) {
  const data = res && res.result && res.result.data
  if (data && data.tournament) return data.tournament
  if (data) return data
  return null
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
    !isNoScoreResult(row) &&
    !row.bye &&
    row.player1 &&
    row.player2 &&
    row.player1.id &&
    row.player2.id &&
    !isByeSide(row.player1) &&
    !isByeSide(row.player2)
  )
}

function isNoScoreResult(row) {
  return !!row && (
    row.noScore === true
    || row.voided === true
    || row.resultStatus === 'voided'
    || row.status === 'cancelled'
    || row.status === 'voided'
    || (row.pointsAwarded && row.pointsAwarded.source === 'voided')
    || isCompatibilityNoScoreResult(row)
  )
}

function isCompatibilityNoScoreResult(row) {
  const entries = row && row.pointsAwarded && row.pointsAwarded.entries
  return !!(
    row &&
    row.player1 &&
    row.player2 &&
    row.player1.id &&
    row.player2.id &&
    row.resultStatus === 'confirmed' &&
    row.status === 'completed' &&
    row.pointsAwarded &&
    row.pointsAwarded.source === 'match' &&
    Array.isArray(entries) &&
    entries.length === 0 &&
    !row.score &&
    !(row.winner && row.winner.id) &&
    !row.winnerId
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

  const groups = tournament && tournament.format === 'group_knockout'
    ? buildGroupKnockoutResultGroups(sorted)
    : buildRoundResultGroups(sorted)

  return {
    visible: true,
    completedText: `已完成 ${playable.length} / ${playable.length} 场`,
    standings: buildResultStandings(sorted, tournament || {}, registrations || []),
    groups
  }
}

function buildRoundResultGroups(sorted) {
  const groupsMap = new Map()
  sorted.forEach(row => {
    const round = row.round || 1
    if (!groupsMap.has(round)) groupsMap.set(round, [])
    groupsMap.get(round).push(buildResultMatchRow(row))
  })

  return [...groupsMap.entries()].map(([round, matches]) => ({
    key: `round-${round}`,
    round,
    label: `ROUND ${round < 10 ? '0' : ''}${round}`,
    matches
  }))
}

function buildGroupKnockoutResultGroups(sorted) {
  const groupRows = new Map()
  const knockoutRows = new Map()
  const fallbackRows = []

  sorted.forEach(row => {
    if (isGroupStageResult(row)) {
      const groupCode = normalizeGroupCode(row.groupCode)
      if (!groupRows.has(groupCode)) groupRows.set(groupCode, [])
      groupRows.get(groupCode).push(row)
      return
    }

    if (isKnockoutStageResult(row)) {
      const round = Number(row.round || 1)
      if (!knockoutRows.has(round)) knockoutRows.set(round, [])
      knockoutRows.get(round).push(row)
      return
    }

    fallbackRows.push(row)
  })

  const groups = []
  ;['A', 'B', 'C', 'D'].forEach(groupCode => {
    if (!groupRows.has(groupCode)) return
    groups.push({
      key: `group-${groupCode}`,
      round: `group-${groupCode}`,
      label: `小组赛 ${groupCode}组`,
      matches: groupRows.get(groupCode).map(buildResultMatchRow)
    })
  })

  ;[...groupRows.keys()]
    .filter(groupCode => !['A', 'B', 'C', 'D'].includes(groupCode))
    .sort()
    .forEach(groupCode => {
      groups.push({
        key: `group-${groupCode}`,
        round: `group-${groupCode}`,
        label: `小组赛 ${groupCode}组`,
        matches: groupRows.get(groupCode).map(buildResultMatchRow)
      })
    })

  ;[...knockoutRows.keys()].sort((a, b) => a - b).forEach(round => {
    groups.push({
      key: `knockout-${round}`,
      round: `knockout-${round}`,
      label: `淘汰赛 ${groupKnockoutRoundLabel(round)}`,
      matches: knockoutRows.get(round).map(buildResultMatchRow)
    })
  })

  if (fallbackRows.length) {
    groups.push(...buildRoundResultGroups(fallbackRows))
  }

  return groups
}

function isGroupStageResult(row) {
  return !!(
    row &&
    (row.stage === 'group' || row.matchKind === 'group' || row.groupCode)
  )
}

function isKnockoutStageResult(row) {
  return !!(
    row &&
    (row.stage === 'knockout' || row.matchKind === 'bracket' || row.matchKind === 'knockout')
  )
}

function normalizeGroupCode(groupCode) {
  const value = String(groupCode || '').trim().toUpperCase()
  return value || '其他'
}

function groupKnockoutRoundLabel(round) {
  const normalized = Number(round || 1)
  if (normalized === 1) return '8强'
  if (normalized === 2) return '半决赛'
  if (normalized === 3) return '决赛'
  return `第${normalized}轮`
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

function buildScheduleView(tournament, brackets, freePlays, memberId) {
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
    const player1Mine = sideHasMember(m.player1, memberId)
    const player2Mine = sideHasMember(m.player2, memberId)
    cellByCourt[m.courtId][m.queueOrder] = {
      matchId: m.matchId || m.sourceMatchId || m._id || '',
      kind: 'match',
      __rowKind: m.matchKind || 'bracket',
      __isDoubles: isDoubles,
      __isMine: player1Mine || player2Mine,
      __player1Mine: player1Mine,
      __player2Mine: player2Mine,
      __player1Label: playerLabel(m.player1, m.bye),
      __player2Label: playerLabel(m.player2, m.bye),
      __doublesP1: m.player1 ? (m.player1.name || '?') : (m.bye ? 'BYE' : '?'),
      __doublesPartner1: (m.player1 && m.player1.partnerName) || '',
      __doublesP2: m.player2 ? (m.player2.name || '?') : (m.bye ? 'BYE' : '?'),
      __doublesPartner2: (m.player2 && m.player2.partnerName) || '',
      __doublesP1Mine: sidePrimaryHasMember(m.player1, memberId),
      __doublesPartner1Mine: sidePartnerHasMember(m.player1, memberId),
      __doublesP2Mine: sidePrimaryHasMember(m.player2, memberId),
      __doublesPartner2Mine: sidePartnerHasMember(m.player2, memberId)
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

function currentMemberId(member) {
  return keyPart(member && (member._id || member.id || member.memberId || member.playerId))
}

function sideHasMember(side, memberId) {
  const target = keyPart(memberId)
  return !!target && sideIds(side).map(keyPart).includes(target)
}

function sidePrimaryHasMember(side, memberId) {
  return !!keyPart(memberId) && keyPart(side && side.id) === keyPart(memberId)
}

function sidePartnerHasMember(side, memberId) {
  return !!keyPart(memberId) && keyPart(side && side.partnerId) === keyPart(memberId)
}

function firstChar(name) {
  const s = (name || '').trim()
  return s ? s.charAt(0) : '?'
}

function needsRegistrationIdentity(member) {
  if (!member) return true
  if (!member._id) return true
  return member.claimStatus === 'pending' || member.claimStatus === 'unclaimed'
}

function isTournamentCreator(tournament, member) {
  if (!tournament || !member) return false
  return !!(tournament.createdBy && tournament.createdBy === member._id)
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
    CREATOR_CANNOT_REGISTER: '发起人不能报名',
    PERMISSION_DENIED: '只能为自己操作'
  }
  return map[code] || fallback
}

function courtTimeText(tournament = {}) {
  const plan = tournament.schedulePlan || tournament.courtTimeGrid || {}
  const courts = asArray(plan.courts)
  if (courts.length > 0) {
    const slotsByCourt = collectPlanSlotsByCourt(plan)
    const slotMinutes = toPositiveNumber(plan.slotMinutes || plan.matchDuration || tournament.slotMinutes) || 20
    const lines = courts.map(court => {
      const slots = asArray(court && court.slots).length > 0
        ? asArray(court.slots)
        : asArray(slotsByCourt[court && court.courtId])
      const time = slotRangeText(slots, slotMinutes, tournament.startDate)
      if (!time) return ''
      const name = cleanDisplayText(court && (court.name || court.courtName || court.courtId)) || '场地'
      const location = cleanDisplayText(court && (court.location || court.address || court.venue))
      const courtText = location && location !== name ? `${name}（${location}）` : name
      return `${courtText}：${time}`
    }).filter(Boolean)
    if (lines.length > 0) return lines.join('；')
  }

  if (tournament.courtName && (tournament.startTime || tournament.endTime)) {
    return `${tournament.courtName}：${[tournament.startTime, tournament.endTime].filter(Boolean).join('-')}`
  }
  return '待定'
}

function formatSlotTime(value) {
  if (value && typeof value === 'object') return formatSlotTime(value.startTime || value.time || value.slot || value.datetime || value.dateTime)
  const text = String(value || '')
  const match = /T(\d{2}):(\d{2})/.exec(text) || /^(\d{2}):(\d{2})/.exec(text)
  return match ? `${match[1]}:${match[2]}` : text
}

function collectPlanSlotsByCourt(plan) {
  const slotsByCourt = {}
  asArray(plan && plan.slots).forEach(slot => {
    const ids = asArray(slot && (slot.availableCourtIds || slot.courtIds))
    const value = slot && typeof slot === 'object'
      ? (slot.startTime || slot.time || slot.slot || slot.datetime || slot.dateTime)
      : slot
    ids.forEach(id => {
      if (!id) return
      if (!slotsByCourt[id]) slotsByCourt[id] = []
      slotsByCourt[id].push(value)
    })
  })
  return slotsByCourt
}

function slotRangeText(slots, slotMinutes, fallbackDate) {
  const points = asArray(slots)
    .map(slot => slotMinutePoint(slot, fallbackDate))
    .filter(Boolean)
  const minutePoints = [...new Set(points
    .filter(point => Number.isFinite(point.minute))
    .map(point => point.minute))]
    .sort((a, b) => a - b)
  if (minutePoints.length === 0) {
    return [...new Set(points.map(point => point.label).filter(Boolean))].join('、')
  }

  const ranges = []
  let start = minutePoints[0]
  let end = start + slotMinutes
  for (let i = 1; i < minutePoints.length; i += 1) {
    const next = minutePoints[i]
    if (next <= end) {
      end = Math.max(end, next + slotMinutes)
      continue
    }
    ranges.push(`${minuteLabel(start)}-${minuteLabel(end, start)}`)
    start = next
    end = next + slotMinutes
  }
  ranges.push(`${minuteLabel(start)}-${minuteLabel(end, start)}`)
  return ranges.join('、')
}

function slotMinutePoint(value, fallbackDate) {
  const parts = extractDateTimeParts(value, fallbackDate)
  if (!parts) {
    const label = formatSlotTime(value)
    return label ? { label } : null
  }
  const day = Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / (24 * 60 * 60 * 1000))
  return {
    minute: day * 1440 + parts.hour * 60 + parts.minute,
    label: `${pad2(parts.hour)}:${pad2(parts.minute)}`
  }
}

function minuteLabel(totalMinutes, rangeStart) {
  const minutesInDay = 1440
  if (Number.isFinite(rangeStart) && totalMinutes > rangeStart && totalMinutes % minutesInDay === 0) {
    return '24:00'
  }
  const dayMinute = ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay
  return `${pad2(Math.floor(dayMinute / 60))}:${pad2(dayMinute % 60)}`
}

function extractDateTimeParts(value, fallbackDate) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return extractDateTimeParts(value.startTime || value.time || value.slot || value.datetime || value.dateTime, fallbackDate)
  }
  if (value instanceof Date) return dateObjectParts(value)
  if (typeof value === 'number' && Number.isFinite(value)) return dateObjectParts(new Date(value))

  const text = String(value || '').trim()
  if (!text) return null
  const dateTime = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text)
  if (dateTime) {
    return {
      year: Number(dateTime[1]),
      month: Number(dateTime[2]),
      day: Number(dateTime[3]),
      hour: Number(dateTime[4] || 0),
      minute: Number(dateTime[5] || 0),
      second: Number(dateTime[6] || 0)
    }
  }

  const timeOnly = /^T?(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (timeOnly) {
    const date = extractDateTimeParts(fallbackDate) || { year: 1970, month: 1, day: 1 }
    return {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: Number(timeOnly[1]),
      minute: Number(timeOnly[2]),
      second: Number(timeOnly[3] || 0)
    }
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : dateObjectParts(parsed)
}

function dateObjectParts(date) {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds()
  }
}

function slotEndTime(value, minutes) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  date.setMinutes(date.getMinutes() + Number(minutes || 0))
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function toPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
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
