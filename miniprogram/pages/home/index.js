Page({
  data: {
    currentMember: null,
    myStats: { matches: 0, wins: 0, winRate: 0 },
    isAdmin: false,
    loadingStats: false
  },

  async onShow() {
    await this.loadHome();
  },

  async loadHome() {
    const app = getApp();
    const member = app.globalData.currentMember;
    const isAdmin = app.globalData.isAdmin || false;
    this.setData({ isAdmin });
    if (!member) return;
    this.setData({ currentMember: member });

    this.setData({ loadingStats: true });
    try {
      const stats = await wx.cloud.callFunction({
        name: 'points-engine',
        data: { action: 'playerStats', playerId: member._id, currentSeasonId: this._getCurrentSeasonId() }
      });
      const s = stats.result?.data?.stats?.singles || {};
      const total = (s.winCount || 0) + (s.lossCount || 0);
      const winRate = total > 0 ? Math.round((s.winCount / total) * 100) : 0;
      this.setData({
        myStats: { matches: total, wins: s.winCount || 0, winRate }
      });
    } catch (err) {
      console.error('[home] loadHome stats error', err);
      wx.showToast({ title: '数据加载失败', icon: 'none', duration: 2000 });
    } finally {
      this.setData({ loadingStats: false });
    }
  },

  _getCurrentSeasonId() {
    return `s${new Date().getFullYear()}`;
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
