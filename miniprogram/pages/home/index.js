const { callFunction } = require('../../utils/cloud');
const { syncTabBar } = require('../../utils/tab-bar');

function defaultHomeStats() {
  return {
    singles: { wins: 0, total: 0, winRateLabel: '—', totalPoints: 0 },
    doubles: { wins: 0, total: 0, winRateLabel: '—', totalPoints: 0 }
  };
}

Page({
  data: {
    currentMember: null,
    myStats: defaultHomeStats(),
    isAdmin: false,
    loadingStats: false,
    seasonYear: new Date().getFullYear()
  },

  async onShow() {
    syncTabBar(this, '/pages/home/index');
    await this.loadHome();
  },

  async loadHome() {
    const app = getApp();
    await this.ensureIdentity(app);
    const member = app.globalData.currentMember;
    const isAdmin = app.globalData.isAdmin || false;
    this.setData({ isAdmin, currentMember: member || null });
    if (!member) return;

    this.setData({ loadingStats: true });
    try {
      const stats = await callFunction({
        name: 'points-engine',
        data: { action: 'playerStats', playerId: member._id, currentSeasonId: this._getCurrentSeasonId() }
      });
      const statsData = stats && stats.result && stats.result.data;
      this.setData({
        myStats: this.formatHomeStats(statsData && statsData.stats)
      });
    } catch (err) {
      console.error('[home] loadHome stats error', err);
      wx.showToast({ title: '数据加载失败', icon: 'none', duration: 2000 });
    } finally {
      this.setData({ loadingStats: false });
    }
  },

  _getCurrentSeasonId() {
    return `season_${this.data.seasonYear}`;
  },

  async ensureIdentity(app) {
    if (!app || !app.globalData || app.globalData.currentMember) return;
    if (app.identityReady && typeof app.identityReady.then === 'function') {
      await app.identityReady;
      return;
    }
    if (typeof app.refreshIdentity === 'function') {
      app.identityReady = app.refreshIdentity();
      await app.identityReady;
    }
  },

  formatHomeStats(stats) {
    return {
      singles: this.formatStatsBucket(stats && stats.singles),
      doubles: this.formatStatsBucket(stats && stats.doubles)
    };
  },

  formatStatsBucket(bucket = {}) {
    const wins = bucket.winCount || 0;
    const losses = bucket.lossCount || 0;
    const total = wins + losses;
    const rawWinRate = bucket.winRate;
    const numericWinRate = Number(rawWinRate);
    const rate = Number.isFinite(numericWinRate) ? numericWinRate : (total > 0 ? wins / total : null);
    return {
      wins,
      total,
      winRateLabel: rate === null ? '—' : `${Math.round(rate * 100)}%`,
      totalPoints: bucket.totalPoints || 0
    };
  },

  onQuickAction(e) {
    const action = e.currentTarget.dataset.action;
    const routes = {
      match: '/pages/match/index',
      rank: '/pages/rank/index',
      'my-match': '/pages/my-match/index',
      create: '/pages/tournament-edit/index'
    };
    const url = routes[action];
    if (!url) return;
    if (action === 'match' || action === 'rank') {
      wx.switchTab({ url });
    } else {
      wx.navigateTo({ url });
    }
  }
});
