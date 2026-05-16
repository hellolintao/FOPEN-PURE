const { callFunction } = require('../../utils/cloud')

Page({
  data: {
    playerId: '',
    player: null,
    stats: null,
    recent: [],
    loading: false
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
    this.setData({ loading: true });
    try {
      const [playerRes, statsRes] = await Promise.all([
        callFunction({ name: 'members', data: { action: 'getById', _id: playerId } }),
        callFunction({ name: 'points-engine', data: { action: 'playerStats', playerId, currentSeasonId: `season_${new Date().getFullYear()}` } })
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
      this.setData({ loading: false });
    }
  }
});
