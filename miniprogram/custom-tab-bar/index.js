Component({
  data: {
    selected: 0,
    list: [],
    isAdmin: false
  },

  attached() {
    this.refresh();
  },

  methods: {
    refresh() {
      const isAdmin = getApp().globalData.isAdmin;
      const baseList = [
        { pagePath: '/pages/home/index',   text: '首页', icon: '🏠' },
        { pagePath: '/pages/match/index',  text: '赛事', icon: '🏆' },
        { pagePath: '/pages/manage/index', text: '管理', icon: '⚙️', adminOnly: true },
        { pagePath: '/pages/rank/index',   text: '排行', icon: '📊' },
        { pagePath: '/pages/mine/index',   text: '我的', icon: '👤' }
      ];
      const list = baseList.filter(item => !item.adminOnly || isAdmin);
      this.setData({ list, isAdmin });
    },

    onTap(e) {
      const idx = e.currentTarget.dataset.index;
      const item = this.data.list[idx];
      wx.switchTab({ url: item.pagePath });
      this.setData({ selected: idx });
    }
  }
});
