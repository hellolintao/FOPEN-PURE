const { callFunction } = require('../../utils/cloud')

Page({
  data: {
    activeTab: 'singles',
    rankList: [],
    currentMember: null,
    starHero: null,
    loading: false,
    seasonYear: new Date().getFullYear(),
    rankTabOptions: [
      { label: 'SINGLES', value: 'singles' },
      { label: 'DOUBLES', value: 'doubles' }
    ]
  },

  async onShow() {
    this.setData({ currentMember: getApp().globalData.currentMember })
    await Promise.all([this.loadRank(), this.loadHero()])
  },

  async loadRank() {
    this.setData({ loading: true })
    try {
      const res = await callFunction({
        name: 'points-engine',
        data: {
          action: 'rankList',
          type: this.data.activeTab,
          currentSeasonId: this._getCurrentSeasonId()
        }
      })
      const list = res.result?.data?.rankList || []
      const enriched = list.map(row => ({
        ...row,
        winRatePct: row.winRate > 0 ? `${Math.round(row.winRate * 100)}%` : '—'
      }))
      this.setData({ rankList: enriched })
    } catch (err) {
      console.error('[rank] loadRank error', err)
      wx.showToast({ title: '加载失败', icon: 'none', duration: 2000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadHero() {
    try {
      const res = await callFunction({
        name: 'weekly-star',
        data: {
          action: 'current',
          seasonId: this._getCurrentSeasonId(),
          type: this.data.activeTab
        }
      })
      const data = res.result?.data
      this.setData({ starHero: data || { mode: 'empty', star: null, subtitle: null } })
    } catch (err) {
      console.error('[rank] loadHero error', err)
      this.setData({ starHero: { mode: 'empty', star: null, subtitle: null } })
    }
  },

  onTabChange(e) {
    const tab = e.detail?.value || e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.loadRank()
    this.loadHero()
  },

  _getCurrentSeasonId() {
    return `season_${this.data.seasonYear}`
  },

  onPlayerTap(e) {
    const { playerId } = e.detail
    if (!playerId) return
    wx.navigateTo({ url: `/pages/player-detail/index?id=${playerId}` })
  },

  onStarTap() {
    const hero = this.data.starHero
    if (!hero || !hero.star || !hero.star.memberId) return
    wx.navigateTo({ url: `/pages/player-detail/index?id=${hero.star.memberId}` })
  }
})
