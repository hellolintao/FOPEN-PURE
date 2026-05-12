App({
  globalData: {
    env: 'cloud1-0gthnke69a09f52a',
    isAdmin: false,
    currentMember: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-0gthnke69a09f52a',
        traceUser: true
      });
    }
    this.refreshIdentity();
  },

  async refreshIdentity() {
    try {
      const res = await wx.cloud.callFunction({ name: 'members', data: { action: 'get' } });
      const member = res.result?.data?.[0];
      this.globalData.currentMember = member || null;
      this.globalData.isAdmin = !!(member && member.admin);
      const pages = getCurrentPages();
      const last = pages[pages.length - 1];
      if (last && last.getTabBar) {
        const tabBar = last.getTabBar();
        if (tabBar) tabBar.refresh();
      }
    } catch (err) {
      this.globalData.isAdmin = false;
    }
  }
});
