Page({
  onSeasonManage() {
    console.log('跳转赛季管理')
    wx.navigateTo({ url: '/pages/season-manage/index' })
  },
  onTournamentManage() {
    wx.navigateTo({ url: '/pages/tournament-manage/index' })
  },
  onMatchManage() {
    wx.showToast({ title: '比赛管理', icon: 'none' })
  },
  onMemberManage() {
    wx.showToast({ title: '会员管理', icon: 'none' })
  }
})
