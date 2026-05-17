const { callFunction } = require('../../utils/cloud')
const { getPlayStyleLabel } = require('../../utils/play-style')

const DEFAULT_BUCKET = { winCount: 0, lossCount: 0, totalPoints: 0 }
const DEFAULT_RANK = { singles: null, doubles: null }
const DEFAULT_HISTORY = { singles: [], doubles: [] }
const DEFAULT_WEEKLY = { singles: null, doubles: null }
const DEFAULT_H2H = { singles: [], doubles: [] }
const H2H_DEFAULT_VISIBLE = 5

function defaultStats() {
  return {
    singles: { ...DEFAULT_BUCKET },
    doubles: { ...DEFAULT_BUCKET }
  }
}

function normalizePair(data, fallback) {
  return {
    singles: Array.isArray(data && data.singles) ? data.singles : fallback.singles,
    doubles: Array.isArray(data && data.doubles) ? data.doubles : fallback.doubles
  }
}

Page({
  data: {
    playerId: '',
    player: null,
    stats: null,
    currentRank: { ...DEFAULT_RANK },
    rankHistory: normalizePair(null, DEFAULT_HISTORY),
    weeklySnapshot: { ...DEFAULT_WEEKLY },
    recent: [],
    h2h: normalizePair(null, DEFAULT_H2H),
    h2hVisible: normalizePair(null, DEFAULT_H2H),
    h2hExpanded: { singles: false, doubles: false },
    h2hDefaultVisible: H2H_DEFAULT_VISIBLE,
    rankSubtitle: '',
    playStyleLabel: '',
    singlesPct: '—',
    doublesPct: '—',
    hasDoubles: false,
    seasonYear: new Date().getFullYear(),
    loading: false
  },

  async onLoad(query) {
    const playerId = query && query.id;
    if (!playerId) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      return;
    }
    this.setData({ playerId });
    await this.loadAll(playerId);
  },

  async loadAll(playerId) {
    this.setData({ loading: true });
    const seasonId = this._getCurrentSeasonId();
    try {
      const [playerRes, statsRes] = await Promise.all([
        callFunction({ name: 'members', data: { action: 'getById', _id: playerId } }),
        callFunction({ name: 'points-engine', data: { action: 'playerStats', playerId, currentSeasonId: seasonId } })
      ]);

      if (statsRes?.result?.success === false) {
        console.error('[player-detail] playerStats error', statsRes.result);
      }

      this.setStateFromResponses({
        player: playerRes?.result?.data || null,
        statsData: statsRes?.result?.success === false ? {} : (statsRes?.result?.data || {}),
        h2hData: DEFAULT_H2H
      });
      this._loadH2H(playerId, seasonId).then((h2hData) => {
        this._applyH2HData(h2hData);
      });
    } catch (err) {
      console.error('[player-detail] loadAll error', err);
      wx.showToast({ title: '加载失败', icon: 'none', duration: 2000 });
    } finally {
      this.setData({ loading: false });
    }
  },

  async _loadH2H(playerId, seasonId) {
    try {
      const res = await callFunction({
        name: 'points-engine',
        data: { action: 'playerH2H', playerId, currentSeasonId: seasonId }
      });

      if (res?.result?.success === false) {
        console.error('[player-detail] playerH2H error', res.result);
        return DEFAULT_H2H;
      }

      return res?.result?.data || DEFAULT_H2H;
    } catch (err) {
      console.error('[player-detail] playerH2H error', err);
      return DEFAULT_H2H;
    }
  },

  setStateFromResponses({ player, statsData, h2hData }) {
    const stats = this._normalizeStats(statsData && statsData.stats);
    const currentRank = { ...DEFAULT_RANK, ...(statsData && statsData.currentRank) };
    const rankHistory = normalizePair(statsData && statsData.rankHistory, DEFAULT_HISTORY);
    const weeklySnapshot = { ...DEFAULT_WEEKLY, ...(statsData && statsData.weeklySnapshot) };
    const h2h = normalizePair(h2hData, DEFAULT_H2H);
    const recent = Array.isArray(statsData && statsData.recent) ? statsData.recent : [];
    const rankSubtitle = this._formatRankSubtitle(currentRank);
    const playStyleLabel = this._formatPlayStyle(player);
    const hasDoubles = this._hasDoubles(stats.doubles, h2h.doubles, rankHistory.doubles);

    this.setData({
      player,
      stats,
      currentRank,
      rankHistory,
      weeklySnapshot,
      recent,
      h2h,
      h2hVisible: this._getH2HVisible(h2h, this.data.h2hExpanded),
      rankSubtitle,
      playStyleLabel,
      singlesPct: this._formatWinRate(stats.singles),
      doublesPct: this._formatWinRate(stats.doubles),
      hasDoubles
    });
  },

  _applyH2HData(h2hData) {
    const h2h = normalizePair(h2hData, DEFAULT_H2H);
    this.setData({
      h2h,
      h2hVisible: this._getH2HVisible(h2h, this.data.h2hExpanded),
      hasDoubles: this._hasDoubles(this.data.stats?.doubles || {}, h2h.doubles, this.data.rankHistory.doubles)
    });
  },

  onH2HTap(e) {
    const playerId = e.detail && e.detail.playerId;
    if (!playerId) return;
    wx.navigateTo({ url: `/pages/player-detail/index?id=${playerId}` });
  },

  toggleH2HExpanded(e) {
    const type = e.currentTarget.dataset.type;
    if (type !== 'singles' && type !== 'doubles') return;

    const h2hExpanded = {
      ...this.data.h2hExpanded,
      [type]: !this.data.h2hExpanded[type]
    };
    this.setData({
      h2hExpanded,
      h2hVisible: this._getH2HVisible(this.data.h2h, h2hExpanded)
    });
  },

  _getCurrentSeasonId() {
    return `season_${this.data.seasonYear}`;
  },

  _normalizeStats(stats) {
    const next = defaultStats();
    if (!stats) return next;
    return {
      singles: { ...next.singles, ...(stats.singles || {}) },
      doubles: { ...next.doubles, ...(stats.doubles || {}) }
    };
  },

  _formatRankSubtitle(currentRank) {
    const seasonYear = this.data.seasonYear;
    const singles = currentRank.singles != null ? `#${currentRank.singles}` : '未上榜';
    const doubles = currentRank.doubles != null ? `#${currentRank.doubles}` : '未上榜';
    return `S${seasonYear} · 单打 ${singles} · 双打 ${doubles}`;
  },

  _formatPlayStyle(player) {
    const label = getPlayStyleLabel(player && player.playStyle);
    return label || '打法未设置';
  },

  _formatWinRate(bucket) {
    const matches = (bucket.winCount || 0) + (bucket.lossCount || 0);
    if (matches === 0) return '—';

    const rawWinRate = bucket.winRate;
    const hasProvidedWinRate = rawWinRate !== null && rawWinRate !== undefined && rawWinRate !== '';
    const numericWinRate = Number(rawWinRate);
    const winRate = hasProvidedWinRate && Number.isFinite(numericWinRate) ? numericWinRate : (bucket.winCount || 0) / matches;
    return `${Math.round(winRate * 100)}%`;
  },

  _hasDoubles(doublesStats, doublesH2H, doublesRankHistory) {
    const doublesMatches = (doublesStats.winCount || 0) + (doublesStats.lossCount || 0);
    return doublesMatches > 0
      || (Array.isArray(doublesH2H) && doublesH2H.length > 0)
      || (Array.isArray(doublesRankHistory) && doublesRankHistory.length > 0);
  },

  _getH2HVisible(h2h, h2hExpanded) {
    const slice = (rows, expanded) => {
      const list = Array.isArray(rows) ? rows : [];
      return expanded ? list : list.slice(0, H2H_DEFAULT_VISIBLE);
    };

    return {
      singles: slice(h2h && h2h.singles, h2hExpanded.singles),
      doubles: slice(h2h && h2h.doubles, h2hExpanded.doubles)
    };
  }
});
