Page({
  data: {
    activeTab: 'singles',
    rankList: [],
    currentMember: null
  },

  async onShow() {
    this.setData({ currentMember: getApp().globalData.currentMember });
    await this.loadRank();
  },

  async loadRank() {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'points-engine',
        data: {
          action: 'rankList',
          type: this.data.activeTab,
          currentSeasonId: `s${new Date().getFullYear()}`
        }
      });
      this.setData({ rankList: res.result?.data?.rankList || [] });
    } catch (err) {
      console.error('[rank] loadRank error', err);
      wx.showToast({ title: '加载失败', icon: 'none', duration: 2000 });
    } finally {
      wx.hideLoading();
    }
  },

  onTabChange(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    this.loadRank();
  },

  onPlayerTap(e) {
    const { playerId } = e.detail;
    wx.navigateTo({ url: `/pages/player-detail/index?id=${playerId}` });
  }
});
