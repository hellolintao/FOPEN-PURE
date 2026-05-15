Page({
  data: {
    bracketsList: [],
    tournamentsMap: {},
    loading: true
  },

  onLoad() {
    this.loadBracketsList();
  },

  onShow() {
    this.loadBracketsList();
  },

  async loadBracketsList() {
    this.setData({ loading: true });

    try {
      // 获取所有对位表
      const bracketsResult = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'list',
          page: 1,
          pageSize: 50
        }
      });

      const brackets = bracketsResult.result?.data || [];

      // 获取所有赛事的名称
      const tournamentIds = [...new Set(brackets.map(b => b.tournamentId).filter(Boolean))];
      const tournamentsMap = {};

      for (const tournamentId of tournamentIds) {
        try {
          const tournamentResult = await wx.cloud.database().collection('tournaments').doc(tournamentId).get();
          if (tournamentResult.data) {
            tournamentsMap[tournamentId] = {
              name: tournamentResult.data.name,
              seasonName: tournamentResult.data.seasonName
            };
          }
        } catch (e) {
          console.error('获取赛事信息失败:', tournamentId, e);
        }
      }

      this.setData({
        bracketsList: brackets,
        tournamentsMap: tournamentsMap,
        loading: false
      });
    } catch (err) {
      console.error('加载对位表列表失败:', err);
      this.setData({ loading: false });
    }
  },

  onBracketTap(e) {
    const { tournamentid, round } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/tournament-score/index?tournamentId=${tournamentid}&round=${round}`
    });
  },

  onSeasonManage() {
    wx.navigateTo({ url: '/pages/season-manage/index' });
  },

  onTournamentManage() {
    wx.navigateTo({ url: '/pages/tournament-manage/index' });
  },

  onMemberManage() {
    wx.navigateTo({ url: '/pages/member-manage/index' });
  }
});
