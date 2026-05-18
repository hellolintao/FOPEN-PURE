function syncTabBar(page, pagePath) {
  const app = typeof getApp === 'function' ? getApp() : null
  if (app && app.globalData && pagePath) {
    app.globalData.currentTabPath = pagePath
  }
  if (!page || typeof page.getTabBar !== 'function') return
  const tabBar = page.getTabBar()
  if (tabBar && typeof tabBar.refresh === 'function') {
    tabBar.refresh(pagePath)
  }
}

module.exports = {
  syncTabBar
}
