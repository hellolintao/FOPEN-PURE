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
        { pagePath: '/pages/home/index',   text: '首页', iconPath: '/images/icons/home.png',       selectedIconPath: '/images/icons/home-active.png' },
        { pagePath: '/pages/match/index',  text: '赛事', iconPath: '/images/icons/goods.png',      selectedIconPath: '/images/icons/goods-active.png' },
        { pagePath: '/pages/manage/index', text: '管理', iconPath: '/images/icons/goods.png',      selectedIconPath: '/images/icons/goods-active.png', adminOnly: true },
        { pagePath: '/pages/rank/index',   text: '排行', iconPath: '/images/icons/business.png',   selectedIconPath: '/images/icons/business-active.png' },
        { pagePath: '/pages/mine/index',   text: '我的', iconPath: '/images/icons/usercenter.png', selectedIconPath: '/images/icons/usercenter-active.png' }
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
