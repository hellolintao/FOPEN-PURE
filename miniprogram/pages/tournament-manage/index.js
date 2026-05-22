const { call } = require('../../utils/cloud')

const EMPTY_SNAPSHOT = {
  pendingConfirm: { total: 0, byTournament: [] },
  myDrafts: [],
  ongoing: [],
  registrationOpen: [],
  pendingSchedule: [],
  scheduleDrafts: [],
  scheduleRevisions: [],
}

Page({
  data: {
    loadState: 'idle',
    error: null,
    snapshot: EMPTY_SNAPSHOT,
    finishedExpanded: false,
    finishedState: 'idle',
    finishedError: null,
    finishedItems: [],
    sheet: {
      visible: false,
      title: '',
      mode: 'confirm',
      items: [],
      result: null,
      requestId: null,
      loading: false,
      tournamentIdScope: null,
    },
    _refreshTimer: null,
  },

  onShow() {
    this._refreshSnapshotDebounced()
  },

  _refreshSnapshotDebounced() {
    if (this.data._refreshTimer) clearTimeout(this.data._refreshTimer)
    const timer = setTimeout(() => this._loadSnapshot('refreshing'), 300)
    this.setData({ _refreshTimer: timer })
  },

  async _loadSnapshot(mode) {
    this.setData({ loadState: mode || 'loading', error: null })
    const res = await call('tournaments', { action: 'adminConsoleSnapshot', payload: {} })
    if (!res.ok) {
      this.setData({ loadState: 'error', error: res.error || { code: 'UNKNOWN', message: '加载失败' } })
      return
    }
    this.setData({ loadState: 'loaded', snapshot: normalizeSnapshot(res.data) })
  },

  onRetry() { this._loadSnapshot('loading') },

  onCreateTournament() {
    wx.navigateTo({ url: '/pages/tournament-edit/index' })
  },

  async _openSheetForTournament(tournamentId) {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    this.setData({
      sheet: {
        ...this.data.sheet, visible: true, title: '待确认比分', mode: 'confirm',
        items: [], result: null, requestId, loading: true, tournamentIdScope: tournamentId,
      },
    })
    const res = await call('match-results', { action: 'pendingReviewItems', payload: { tournamentId: tournamentId || null, limit: 50 } })
    if (!res.ok) {
      this.setData({ 'sheet.visible': false })
      wx.showModal({ title: '加载失败', content: (res.error && res.error.message) || '', showCancel: false })
      return
    }
    this.setData({ 'sheet.loading': false, 'sheet.items': res.data.items })
  },

  onHeroCta() { this._openSheetForTournament(null) },

  onPendingRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    this._openSheetForTournament(tid)
  },

  onDraftRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${tid}` })
  },

  onOngoingRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-detail/index?id=${tid}` })
  },

  onRegistrationOpenRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-detail/index?id=${tid}` })
  },

  onPendingScheduleRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${tid}&step=3` })
  },

  onScheduleDraftRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${tid}&step=3` })
  },

  onScheduleRevisionRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-detail/index?id=${tid}` })
  },

  async onSheetCommit(e) {
    const { matchIds } = e.detail
    const items = this.data.sheet.items.filter(it => matchIds.includes(it.matchId))
    const matches = items.map(it => ({
      matchId: it.matchId,
      expectedUpdateTime: it.updateTime instanceof Date ? it.updateTime.toISOString() : it.updateTime,
    }))
    const res = await call('match-results', {
      action: 'batchConfirm',
      payload: { matches, requestId: this.data.sheet.requestId },
    })
    this._applyResult(res, items)
  },

  _applyResult(res, items) {
    if (!res.ok) {
      this.setData({
        'sheet.result': {
          requestId: this.data.sheet.requestId,
          successIds: [],
          failures: items.map(it => ({
            matchId: it.matchId, code: res.error.code, message: res.error.message,
            retryable: !!res.error.retryable, requestId: this.data.sheet.requestId,
          })),
        },
      })
      return
    }
    this.setData({ 'sheet.result': res.data })
  },

  async onSheetRetry(e) {
    const { failureIds } = e.detail
    const lastFailures = (this.data.sheet.result && this.data.sheet.result.failures) || []
    const isBatchLevel = lastFailures.every(f => ['BATCH_TIMEOUT', 'NETWORK', 'TIMEOUT'].includes(f.code))

    if (isBatchLevel) {
      // §4.13 path 2: do NOT re-fetch, replay original matches via same requestId
      const items = this.data.sheet.items
      const matches = items.map(it => ({
        matchId: it.matchId,
        expectedUpdateTime: it.updateTime instanceof Date ? it.updateTime.toISOString() : it.updateTime,
      }))
      const res = await call('match-results', {
        action: 'batchConfirm',
        payload: { matches, requestId: this.data.sheet.requestId },
      })
      this._applyResult(res, items)
      return
    }

    // §4.13 path 1: per-row retryable, re-fetch and submit failure subset
    const refetch = await call('match-results', { action: 'pendingReviewItems', payload: { tournamentId: this.data.sheet.tournamentIdScope, limit: 50 } })
    if (!refetch.ok) {
      wx.showModal({ title: '重拉失败', content: (refetch.error && refetch.error.message) || '', showCancel: false })
      return
    }
    const fresh = refetch.data.items
    const refreshedItems = this.data.sheet.items.map(it => {
      const f = fresh.find(x => x.matchId === it.matchId)
      return f || it
    })
    this.setData({ 'sheet.items': refreshedItems })
    const matches = refreshedItems.filter(it => failureIds.includes(it.matchId)).map(it => ({
      matchId: it.matchId,
      expectedUpdateTime: it.updateTime instanceof Date ? it.updateTime.toISOString() : it.updateTime,
    }))
    const res = await call('match-results', {
      action: 'batchConfirm',
      payload: { matches, requestId: this.data.sheet.requestId },
    })
    if (!res.ok) {
      this.setData({
        'sheet.result': {
          ...this.data.sheet.result,
          failures: matches.map(m => ({
            matchId: m.matchId, code: res.error.code, message: res.error.message,
            retryable: !!res.error.retryable, requestId: this.data.sheet.requestId,
          })),
        },
      })
      return
    }
    const prior = this.data.sheet.result || { successIds: [], failures: [] }
    const mergedSuccessIds = [...new Set([...(prior.successIds || []), ...res.data.successIds])]
    this.setData({ 'sheet.result': { ...res.data, successIds: mergedSuccessIds } })
  },

  onSheetEditRow(e) {
    const { matchId } = e.detail
    const item = this.data.sheet.items.find(it => it.matchId === matchId)
    if (!item) return
    this.setData({ 'sheet.visible': false })
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${item.tournamentId}&matchId=${matchId}` })
  },

  onSheetClose() {
    this.setData({ 'sheet.visible': false })
    this._refreshSnapshotDebounced()
  },

  async onToggleFinished() {
    const next = !this.data.finishedExpanded
    this.setData({ finishedExpanded: next })
    if (next && this.data.finishedState !== 'loaded') {
      this._loadFinished()
    }
  },

  async _loadFinished() {
    this.setData({ finishedState: 'loading', finishedError: null })
    const res = await call('tournaments', { action: 'finishedRecent', payload: { limit: 5 } })
    if (!res.ok) {
      this.setData({ finishedState: 'error', finishedError: res.error })
      return
    }
    this.setData({ finishedState: 'loaded', finishedItems: res.data.items })
  },

  onRetryFinished() { this._loadFinished() },
})

function normalizeSnapshot(snapshot = {}) {
  const pendingConfirm = snapshot.pendingConfirm || {}
  return {
    ...EMPTY_SNAPSHOT,
    ...snapshot,
    pendingConfirm: {
      total: Number(pendingConfirm.total || 0),
      byTournament: Array.isArray(pendingConfirm.byTournament) ? pendingConfirm.byTournament : [],
    },
    myDrafts: Array.isArray(snapshot.myDrafts) ? snapshot.myDrafts : [],
    ongoing: Array.isArray(snapshot.ongoing) ? snapshot.ongoing : [],
    registrationOpen: Array.isArray(snapshot.registrationOpen) ? snapshot.registrationOpen : [],
    pendingSchedule: Array.isArray(snapshot.pendingSchedule) ? snapshot.pendingSchedule : [],
    scheduleDrafts: Array.isArray(snapshot.scheduleDrafts) ? snapshot.scheduleDrafts : [],
    scheduleRevisions: Array.isArray(snapshot.scheduleRevisions) ? snapshot.scheduleRevisions : [],
  }
}
