Component({
  data: {
    selected: '',
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
        { pagePath: '/pages/home/index',   text: '首页', iconPath: '/images/icons/ri/home-line.png',           selectedIconPath: '/images/icons/ri/home-fill.png' },
        { pagePath: '/pages/match/index',  text: '赛事', iconPath: '/images/icons/ri/calendar-event-line.png', selectedIconPath: '/images/icons/ri/calendar-event-fill.png' },
        { pagePath: '/pages/rank/index',   text: '排行', iconPath: '/images/icons/ri/trophy-line.png',         selectedIconPath: '/images/icons/ri/trophy-fill.png' },
        { pagePath: '/pages/manage/index', text: '管理', iconPath: '/images/icons/ri/settings-3-line.png',     selectedIconPath: '/images/icons/ri/settings-3-fill.png', adminOnly: true },
        { pagePath: '/pages/mine/index',   text: '我的', iconPath: '/images/icons/ri/user-line.png',           selectedIconPath: '/images/icons/ri/user-fill.png' }
      ];
      const list = baseList.filter(item => !item.adminOnly || isAdmin);
      const pages = getCurrentPages();
      const current = pages[pages.length - 1]?.route ? '/' + pages[pages.length - 1].route : '';
      this.setData({ list, isAdmin, selected: current });
    },

    onTap(e) {
      const idx = e.currentTarget.dataset.index;
      const item = this.data.list[idx];
      wx.switchTab({ url: item.pagePath });
      this.setData({ selected: item.pagePath });
    }
  }
});
