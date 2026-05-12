Page({
  data: {
    playerId: '',
    player: null,
    stats: null,
    recent: []
  },

  async onLoad(query) {
    const playerId = query.id;
    if (!playerId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      return;
    }
    this.setData({ playerId });
    await this.loadAll(playerId);
  },

  async loadAll(playerId) {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const [playerRes, statsRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'members', data: { action: 'getById', _id: playerId } }),
        wx.cloud.callFunction({ name: 'points-engine', data: { action: 'playerStats', playerId, currentSeasonId: `s${new Date().getFullYear()}` } })
      ]);
      this.setData({
        player: playerRes.result?.data || null,
        stats: statsRes.result?.data?.stats || null,
        recent: statsRes.result?.data?.recent || []
      });
    } catch (err) {
      console.error('[player-detail] loadAll error', err);
      wx.showToast({ title: '加载失败', icon: 'none', duration: 2000 });
    } finally {
      wx.hideLoading();
    }
  }
});
