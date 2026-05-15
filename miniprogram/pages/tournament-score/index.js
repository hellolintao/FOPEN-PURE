const app = getApp()
const { call } = require('../../utils/cloud')

Page({
  data: {
    tournamentId: '',
    tournament: null,
    rowsByRound: [],
    confirmedCount: 0,
    submittedCount: 0,
    pendingCount: 0,
    totalCount: 0,
    isAdmin: false,
    draftMap: {},
    bottomLabel: '确认全部',
    bottomCount: 0,
    bottomDisabled: true,
    anchorMatchId: '',
    loading: false,
    empty: false,
    sheet: { visible: false, title: '', mode: 'confirm', items: [], result: null, requestId: null }
  },

  onLoad(options) {
    const tid = options.tournamentId || options.id
    if (!tid) {
      wx.showToast({ title: '缺少 tournamentId', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
    this.setData({
      tournamentId: tid,
      anchorMatchId: options.matchId || '',
      isAdmin: !!(app.globalData && app.globalData.isAdmin)
    })
  },

  async onShow() {
    if (!this.data.tournamentId) return
    await this.syncIdentity()
    this.refresh()
  },

  async syncIdentity() {
    try {
      if (app.globalData && !app.globalData.currentMember && typeof app.refreshIdentity === 'function') {
        await app.refreshIdentity()
      }
    } catch (e) {
      console.warn('[tournament-score] syncIdentity', e)
    }
    this.setData({ isAdmin: !!(app.globalData && app.globalData.isAdmin) })
  },

  async refresh() {
    this.setData({ loading: true, draftMap: {}, bottomDisabled: true, bottomCount: 0 })
    try {
      const [tRes, rRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'tournaments', data: { action: 'get', id: this.data.tournamentId } }),
        wx.cloud.callFunction({ name: 'match-results', data: { action: 'listByTournament', tournamentId: this.data.tournamentId } })
      ])
      // tournaments.get returns either { data: { tournament: {...} } } or legacy { data: {...} }
      const tournament = (tRes.result && tRes.result.data && (tRes.result.data.tournament || tRes.result.data)) || null
      const results = (rRes.result && rRes.result.success && rRes.result.data && rRes.result.data.results) || []
      const sorted = results.slice().sort((a, b) => {
        if ((a.round || 0) !== (b.round || 0)) return (a.round || 0) - (b.round || 0)
        if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0)
        return (a.queueOrder || 0) - (b.queueOrder || 0)
      })
      const byRound = new Map()
      for (const r of sorted) {
        const k = r.round || 1
        if (!byRound.has(k)) byRound.set(k, [])
        byRound.get(k).push(r)
      }
      const rowsByRound = [...byRound.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, matches]) => ({ round, matches }))

      const confirmedCount = sorted.filter(r => r.resultStatus === 'confirmed').length
      const submittedCount = sorted.filter(r => r.resultStatus === 'submitted').length
      const pendingCount = sorted.filter(r => r.resultStatus !== 'confirmed' && r.resultStatus !== 'submitted').length
      this.setData({
        tournament,
        rowsByRound,
        confirmedCount,
        submittedCount,
        pendingCount,
        totalCount: sorted.length,
        empty: sorted.length === 0
      })
      this.recomputeBottomState()

      if (this.data.anchorMatchId) {
        const sel = `#row-${this.data.anchorMatchId}`
        wx.createSelectorQuery().select(sel).boundingClientRect(rect => {
          if (rect) wx.pageScrollTo({ scrollTop: Math.max(0, rect.top - 100), duration: 200 })
        }).exec()
      }
    } catch (e) {
      console.error('[tournament-score] refresh', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  onDraftChange(e) {
    const d = e.detail || {}
    if (!d.matchId) return
    this._pendingDraftMap = this._pendingDraftMap || { ...(this.data.draftMap || {}) }
    this._pendingDraftMap[d.matchId] = d
    if (this._draftFlushTimer) return
    this._draftFlushTimer = setTimeout(() => {
      this._draftFlushTimer = null
      const draftMap = this._pendingDraftMap || {}
      this._pendingDraftMap = null
      const bottomState = this.computeBottomState(draftMap)
      this.setData({ draftMap, ...bottomState })
    }, 0)
  },

  getAllMatches() {
    const out = []
    for (const g of (this.data.rowsByRound || [])) {
      for (const m of (g.matches || [])) out.push(m)
    }
    return out
  },

  isPlayableMatch(m) {
    return !!(m && !m.bye && m.player1 && m.player2 && m.player1.id && m.player2.id)
  },

  collectActionableDrafts(draftMapOverride) {
    const drafts = Object.values(draftMapOverride || this.data.draftMap || {})
      .filter(d => d && d.canEdit && d.filled)

    if (!this.data.isAdmin) {
      // 选手端：确认全部 = 批量提交已填写比分给管理员；不确认、不记分。
      return drafts.filter(d => !d.isConfirmed)
    }

    // 管理员端：保存比赛结果 = 把未确认的已填写比分确认为官方结果；
    // 已确认行仅在比分被改动后可再次保存。
    return drafts.filter(d => !d.isConfirmed || d.dirty)
  },

  computeBottomState(draftMapOverride) {
    const tournament = this.data.tournament || {}
    const matches = this.getAllMatches().filter(m => this.isPlayableMatch(m))
    const draftMap = draftMapOverride || this.data.draftMap || {}
    const actionable = this.collectActionableDrafts(draftMap)
    const isRegularAdmin = this.data.isAdmin && tournament.format !== 'knockout'

    let bottomDisabled = actionable.length < 1
    if (isRegularAdmin) {
      const allFilled = matches.length > 0 && matches.every(m => {
        const d = draftMap[m.sourceMatchId]
        return d && d.filled
      })
      bottomDisabled = !allFilled || actionable.length < 1
    }

    return {
      bottomLabel: this.data.isAdmin ? '保存比赛结果' : '确认全部',
      bottomCount: actionable.length,
      bottomDisabled
    }
  },

  recomputeBottomState() {
    const bottomState = this.computeBottomState()
    if (
      bottomState.bottomLabel === this.data.bottomLabel &&
      bottomState.bottomCount === this.data.bottomCount &&
      bottomState.bottomDisabled === this.data.bottomDisabled
    ) return
    this.setData(bottomState)
  },

  async onSubmit(e) {
    const { matchId, score } = e.detail
    try {
      const res = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'submit', matchId, score } })
      const r = res.result
      if (!r || !r.success) {
        wx.showToast({ title: (r && r.error && r.error.message) || '提交失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已提交', icon: 'success' })
      await this.refresh()
    } catch (err) {
      console.error('[tournament-score] submit', err)
      wx.showToast({ title: '提交失败', icon: 'none' })
    }
  },

  async onReconfirm(e) {
    const { matchId, newScore } = e.detail
    try {
      const res = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'reconfirmMatch', matchId, newScore } })
      const r = res.result
      if (!r || !r.success) {
        wx.showToast({ title: (r && r.error && r.error.message) || '更新失败', icon: 'none' })
        return
      }
      wx.showToast({ title: '已更新', icon: 'success' })
      await this.refresh()
    } catch (err) {
      console.error('[tournament-score] reconfirm', err)
      wx.showToast({ title: '更新失败', icon: 'none' })
    }
  },

  onConfirmAll() {
    this.onAdminBatchSheet()
  },

  async onAdminBatchSheet() {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    this.setData({
      sheet: { visible: true, title: '待确认比分', mode: 'confirm', items: [], result: null, requestId }
    })
    const res = await call('match-results', { action: 'pendingReviewItems', payload: { tournamentId: this.data.tournamentId, limit: 50 } })
    if (!res.ok) {
      this.setData({ 'sheet.visible': false })
      wx.showModal({ title: '加载失败', content: (res.error && res.error.message) || '', showCancel: false })
      return
    }
    this.setData({ 'sheet.items': res.data.items })
  },

  async onSheetCommit(e) {
    const { matchIds } = e.detail
    const items = this.data.sheet.items.filter(it => matchIds.includes(it.matchId))
    if (this.data.sheet.mode === 'confirm') {
      const matches = items.map(it => ({
        matchId: it.matchId,
        expectedUpdateTime: it.updateTime instanceof Date ? it.updateTime.toISOString() : it.updateTime
      }))
      const res = await call('match-results', { action: 'batchConfirm', payload: { matches, requestId: this.data.sheet.requestId } })
      this._applySheetResult(res, items)
    }
  },

  _applySheetResult(res, items) {
    if (!res.ok) {
      this.setData({
        'sheet.result': {
          requestId: this.data.sheet.requestId,
          successIds: [],
          failures: items.map(it => ({
            matchId: it.matchId,
            code: res.error.code,
            message: res.error.message,
            retryable: !!res.error.retryable,
            requestId: this.data.sheet.requestId
          }))
        }
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
      const items = this.data.sheet.items
      const matches = items.map(it => ({
        matchId: it.matchId,
        expectedUpdateTime: it.updateTime instanceof Date ? it.updateTime.toISOString() : it.updateTime
      }))
      const res = await call('match-results', { action: 'batchConfirm', payload: { matches, requestId: this.data.sheet.requestId } })
      this._applySheetResult(res, items)
      return
    }
    // per-row retry: re-fetch then submit subset
    const refetch = await call('match-results', { action: 'pendingReviewItems', payload: { tournamentId: this.data.tournamentId, limit: 50 } })
    if (!refetch.ok) {
      wx.showModal({ title: '重拉失败', content: (refetch.error && refetch.error.message) || '', showCancel: false })
      return
    }
    const fresh = refetch.data.items
    const refreshedItems = this.data.sheet.items.map(it => fresh.find(x => x.matchId === it.matchId) || it)
    this.setData({ 'sheet.items': refreshedItems })
    const matches = refreshedItems.filter(it => failureIds.includes(it.matchId)).map(it => ({
      matchId: it.matchId,
      expectedUpdateTime: it.updateTime instanceof Date ? it.updateTime.toISOString() : it.updateTime
    }))
    const res = await call('match-results', { action: 'batchConfirm', payload: { matches, requestId: this.data.sheet.requestId } })
    if (!res.ok) {
      this.setData({
        'sheet.result': {
          ...this.data.sheet.result,
          failures: matches.map(m => ({
            matchId: m.matchId,
            code: res.error.code,
            message: res.error.message,
            retryable: !!res.error.retryable,
            requestId: this.data.sheet.requestId
          }))
        }
      })
      return
    }
    const prior = this.data.sheet.result || { successIds: [], failures: [] }
    const mergedSuccessIds = [...new Set([...(prior.successIds || []), ...res.data.successIds])]
    this.setData({ 'sheet.result': { ...res.data, successIds: mergedSuccessIds } })
  },

  onSheetEditRow() {
    this.setData({ 'sheet.visible': false })
    // user can edit inline via score-row UI on the page
  },

  onSheetClose() {
    this.setData({ 'sheet.visible': false })
    this.refresh()
  }
})
