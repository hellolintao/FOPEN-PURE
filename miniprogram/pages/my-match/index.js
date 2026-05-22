const { call } = require('../../utils/cloud')

Page({
  data: {
    loadState: 'idle',
    error: null,
    summary: null,
  },

  onShow() { this._load() },

  async _load() {
    this.setData({ loadState: 'loading', error: null })
    const res = await call('match-results', { action: 'mySummary', payload: { historyLimit: 10 } })
    if (!res.ok) {
      this.setData({ loadState: 'error', error: res.error })
      return
    }
    this.setData({ loadState: 'loaded', summary: normalizeSummary(res.data) })
  },

  onRetry() { this._load() },

  onRecordNow() {
    const first = (this.data.summary && this.data.summary.pending || [])[0]
    if (!first) return
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${first.tournamentId}&matchId=${first.matchId}` })
  },

  onPendingRow(e) {
    const { tournamentid, matchid } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${tournamentid}&matchId=${matchid}` })
  },

  onSubmittedRow(e) {
    const { tournamentid, matchid } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${tournamentid}&matchId=${matchid}` })
  },

  onRegistrationRow(e) {
    const { tournamentid } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/tournament-detail/index?id=${tournamentid}` })
  },

  onViewSchedule() {
    wx.switchTab({ url: '/pages/match/index' })
  },
})

function normalizeSummary(summary = {}) {
  return {
    ...summary,
    registrations: Array.isArray(summary.registrations) ? summary.registrations : [],
    pending: Array.isArray(summary.pending) ? summary.pending : [],
    submitted: Array.isArray(summary.submitted) ? summary.submitted : [],
    confirmed: Array.isArray(summary.confirmed) ? summary.confirmed : [],
  }
}
