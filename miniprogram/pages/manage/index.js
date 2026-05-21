const { syncTabBar } = require('../../utils/tab-bar');
const { getCacheEntry, setCache } = require('../../utils/page-cache');
const { call } = require('../../utils/cloud');

const MANAGE_CACHE_TTL_MS = 60 * 1000;
const MANAGE_CACHE_KEY = 'manage:pending-entry:v2';

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
    }

    this.setData({ loading: !(cachedValue && Array.isArray(cachedValue.bracketsList)) });

    try {
      const res = await call('match-results', {
        action: 'pendingEntryGroups',
        payload: { limit: 50 }
      });
      if (!res.ok) throw new Error((res.error && res.error.message) || '加载失败');
      const { bracketsList, tournamentsMap } = normalizePendingGroups(res.data && res.data.groups);

      this.setData({
        bracketsList,
        tournamentsMap,
        loading: false
      });
      setCache(MANAGE_CACHE_KEY, { bracketsList, tournamentsMap }, { ttlMs: MANAGE_CACHE_TTL_MS });
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

function normalizePendingGroups(groups) {
  const bracketsList = (Array.isArray(groups) ? groups : []).map(group => ({
    _id: group._id || `${group.tournamentId || ''}:${group.round || 1}`,
    tournamentId: group.tournamentId || '',
    tournamentName: group.tournamentName || '',
    seasonName: group.seasonName || '',
    round: group.round || 1,
    updateTime: group.updateTime || group.createTime || '',
    matches: Array.isArray(group.matches) ? group.matches : []
  }));
  const tournamentsMap = {};
  for (const group of bracketsList) {
    if (!group.tournamentId) continue;
    tournamentsMap[group.tournamentId] = {
      name: group.tournamentName,
      seasonName: group.seasonName
    };
  }
  return { bracketsList, tournamentsMap };
}
