Page({
  onSeasonManage() {
    console.log('跳转赛季管理')
    wx.navigateTo({ url: '/pages/season-manage/index' })
  },
  onTournamentManage() {
    wx.navigateTo({ url: '/pages/tournament-manage/index' })
  },
  onMemberManage() {
    wx.navigateTo({ url: '/pages/member-manage/index' })
  }
})
