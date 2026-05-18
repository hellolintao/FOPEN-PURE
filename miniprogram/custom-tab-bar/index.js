Component({
  data: {
    selected: '',
    list: [],
    isAdmin: false
  },

  attached() {
    const app = getApp();
    this.refresh(app.globalData && app.globalData.currentTabPath);
  },

  methods: {
    refresh(selectedPath) {
      const app = getApp();
      const isAdmin = app.globalData.isAdmin;
      const baseList = [
        { pagePath: '/pages/home/index',   text: '首页', iconPath: '/images/icons/ri/home-line.png',           selectedIconPath: '/images/icons/ri/home-fill.png' },
        { pagePath: '/pages/match/index',  text: '赛事', iconPath: '/images/icons/ri/calendar-event-line.png', selectedIconPath: '/images/icons/ri/calendar-event-fill.png' },
        { pagePath: '/pages/rank/index',   text: '排行', iconPath: '/images/icons/ri/trophy-line.png',         selectedIconPath: '/images/icons/ri/trophy-fill.png' },
        { pagePath: '/pages/manage/index', text: '管理', iconPath: '/images/icons/ri/settings-3-line.png',     selectedIconPath: '/images/icons/ri/settings-3-fill.png', adminOnly: true },
        { pagePath: '/pages/mine/index',   text: '我的', iconPath: '/images/icons/ri/user-line.png',           selectedIconPath: '/images/icons/ri/user-fill.png' }
      ];
      const list = baseList.filter(item => !item.adminOnly || isAdmin);
      const pages = getCurrentPages();
      const lastPage = pages[pages.length - 1];
      const current = lastPage && lastPage.route ? '/' + lastPage.route : '';
      const selected = selectedPath || (app.globalData && app.globalData.currentTabPath) || current;
      if (app.globalData) app.globalData.currentTabPath = selected;
      this.setData({ list, isAdmin, selected });
    },

    onTap(e) {
      const idx = e.currentTarget.dataset.index;
      const item = this.data.list[idx];
      const app = getApp();
      if (app.globalData) app.globalData.currentTabPath = item.pagePath;
      this.setData({ selected: item.pagePath });
      wx.switchTab({ url: item.pagePath });
    }
  }
});
