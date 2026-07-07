const { callFunction } = require('./utils/cloud');

App({
  globalData: {
    env: 'cloud1-0gthnke69a09f52a',
    isAdmin: false,
    currentMember: null,
    currentTabPath: '/pages/home/index',
    lastSelectedPlayers: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }
    wx.cloud.init({ env: this.globalData.env, traceUser: true });
  },

  async refreshIdentity() {
    try {
      const res = await callFunction({ name: 'members', data: { action: 'get' } });
      const data = res && res.result && res.result.data;
      const member = Array.isArray(data) ? data[0] : null;
      this.globalData.currentMember = member || null;
      this.globalData.isAdmin = !!(member && member.admin);
      const pages = getCurrentPages();
      const last = pages[pages.length - 1];
      if (last && last.getTabBar) {
        const tabBar = last.getTabBar();
        if (tabBar) tabBar.refresh(this.globalData.currentTabPath);
      }
      return this.globalData.currentMember;
    } catch (err) {
      this.globalData.currentMember = null;
      this.globalData.isAdmin = false;
      return null;
    }
  }
});
