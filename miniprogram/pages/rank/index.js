const { callFunction } = require('../../utils/cloud')

Page({
  data: {
    activeTab: 'singles',
    rankList: [],
    currentMember: null,
    weeklyStar: null,
    weeklyStarWeekRange: '',
    loading: false,
    rankTabOptions: [
      { label: 'SINGLES', value: 'singles' },
      { label: 'DOUBLES', value: 'doubles' }
    ]
  },

  async onShow() {
    this.setData({ currentMember: getApp().globalData.currentMember })
    await Promise.all([this.loadRank(), this.loadWeeklyStar()])
  },

  async loadRank() {
    this.setData({ loading: true })
    try {
      const res = await callFunction({
        name: 'points-engine',
        data: {
          action: 'rankList',
          type: this.data.activeTab,
          currentSeasonId: `s${new Date().getFullYear()}`
        }
      })
      this.setData({ rankList: res.result?.data?.rankList || [] })
    } catch (err) {
      console.error('[rank] loadRank error', err)
      wx.showToast({ title: '加载失败', icon: 'none', duration: 2000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadWeeklyStar() {
    try {
      const res = await callFunction({
        name: 'weekly-star',
        data: { action: 'latest', seasonId: `s${new Date().getFullYear()}` }
      })
      const star = res.result?.data || null
      const selected = this.data.activeTab === 'singles' ? star?.singlesStar : star?.doublesStar
      this.setData({
        weeklyStar: selected || null,
        weeklyStarWeekRange: star ? `${star.weekStart} ~ ${star.weekEnd}` : ''
      })
    } catch (err) {
      console.error('[rank] loadWeeklyStar error', err)
    }
  },

  onTabChange(e) {
    const tab = e.detail?.value || e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.loadRank()
    this.loadWeeklyStar()
  },

  onPlayerTap(e) {
    const { playerId } = e.detail
    wx.navigateTo({ url: `/pages/player-detail/index?id=${playerId}` })
  }
})
