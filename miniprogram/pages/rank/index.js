const { callFunction } = require('../../utils/cloud')
const { syncTabBar } = require('../../utils/tab-bar')
const { getCacheEntry, isFresh, nextDailyRefreshAt, setCache } = require('../../utils/page-cache')

const RANK_CACHE_VERSION = 'v2'

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
    syncTabBar(this, '/pages/rank/index')
    this.setData({ currentMember: getApp().globalData.currentMember })
    await Promise.all([this.loadRank(), this.loadHero()])
  },

  async loadRank() {
    const cacheKey = this._cacheKey('list')
    const cached = getCacheEntry(cacheKey)
    const cachedList = cached && cached.value && Array.isArray(cached.value.rankList)
      ? cached.value.rankList
      : null
    if (cachedList) {
      this.setData({ rankList: cachedList })
      if (isFresh(cached)) return
    }

    this.setData({ loading: !cachedList })
    try {
      const res = await callFunction({
        name: 'points-engine',
        data: {
          action: 'rankList',
          type: this.data.activeTab,
          currentSeasonId: this._getCurrentSeasonId()
        }
      })
      const rankData = res && res.result && res.result.data
      const list = (rankData && rankData.rankList) || []
      const enriched = list.map(row => ({
        ...row,
        winRatePct: this._formatWinRatePct(row)
      }))
      this.setData({ rankList: enriched })
      setCache(cacheKey, { rankList: enriched }, { expiresAt: nextDailyRefreshAt() })
    } catch (err) {
      console.error('[rank] loadRank error', err)
      wx.showToast({ title: '加载失败', icon: 'none', duration: 2000 })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadHero() {
    const cacheKey = this._cacheKey('hero')
    const cached = getCacheEntry(cacheKey)
    const hasHero = cached && cached.value && Object.prototype.hasOwnProperty.call(cached.value, 'starHero')
    if (hasHero) {
      this.setData({ starHero: cached.value.starHero })
      if (isFresh(cached)) return
    }

    try {
      const res = await callFunction({
        name: 'weekly-star',
        data: {
          action: 'current',
          seasonId: this._getCurrentSeasonId(),
          type: this.data.activeTab
        }
      })
      const data = res && res.result && res.result.data
      const starHero = data || { mode: 'empty', star: null, subtitle: null }
      this.setData({ starHero })
      setCache(cacheKey, { starHero }, { expiresAt: nextDailyRefreshAt() })
    } catch (err) {
      console.error('[rank] loadHero error', err)
      this.setData({ starHero: { mode: 'empty', star: null, subtitle: null } })
    }
  },

  onTabChange(e) {
    const tab = (e.detail && e.detail.value) || e.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.loadRank()
    this.loadHero()
  },

  _getCurrentSeasonId() {
    return `season_${this.data.seasonYear}`
  },

  _cacheKey(kind) {
    return `rank:${kind}:${RANK_CACHE_VERSION}:${this._getCurrentSeasonId()}:${this.data.activeTab}`
  },

  _formatWinRatePct(row) {
    const winCount = (row && row.winCount) || 0
    const lossCount = (row && row.lossCount) || 0
    const matches = winCount + lossCount
    if (matches <= 0) return '—'

    const rawRate = Number(row && row.winRate)
    const winRate = Number.isFinite(rawRate) ? rawRate : winCount / matches
    return `${Math.round(winRate * 100)}%`
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
