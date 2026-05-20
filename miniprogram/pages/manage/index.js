const { syncTabBar } = require('../../utils/tab-bar');
const { getCacheEntry, isFresh, setCache } = require('../../utils/page-cache');

const MANAGE_CACHE_TTL_MS = 60 * 1000;
const MANAGE_CACHE_KEY = 'manage:brackets:v1';

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
    syncTabBar(this, '/pages/manage/index');
    this.loadBracketsList();
  },

  async loadBracketsList() {
    const cached = getCacheEntry(MANAGE_CACHE_KEY);
    const cachedValue = cached && cached.value;
    if (cachedValue && Array.isArray(cachedValue.bracketsList) && cachedValue.tournamentsMap) {
      this.setData({
        bracketsList: cachedValue.bracketsList,
        tournamentsMap: cachedValue.tournamentsMap,
        loading: false
      });
      if (isFresh(cached)) return;
    }

    this.setData({ loading: !(cachedValue && Array.isArray(cachedValue.bracketsList)) });

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

      const brackets = (bracketsResult && bracketsResult.result && bracketsResult.result.data) || [];

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
      setCache(MANAGE_CACHE_KEY, { bracketsList: brackets, tournamentsMap }, { ttlMs: MANAGE_CACHE_TTL_MS });
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
