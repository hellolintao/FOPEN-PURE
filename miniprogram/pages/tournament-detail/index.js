const app = getApp()

Page({
  data: {
    tournamentId: '',
    tournament: null,
    registrations: [],
    brackets: [],
    totalMatches: 0,
    tournamentDisplay: null,
    loading: true,
    isAdmin: false
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.setData({ tournamentId: id });
      this.loadTournamentDetail();
      this.loadRegistrations();
      this.loadBrackets();
    }
  },

  onShow() {
    // 页面显示时刷新数据
    if (this.data.tournamentId) {
      this.loadTournamentDetail();
      this.loadRegistrations();
      this.loadBrackets();
    }
  },

  async loadTournamentDetail() {
    this.setData({ loading: true });

    try {
      const db = wx.cloud.database();
      const result = await db.collection('tournaments')
        .doc(this.data.tournamentId)
        .get();

      if (result.data) {
        const me = app.globalData && app.globalData.currentMember
        const isCreator = !!(me && result.data.createdBy && result.data.createdBy === me._id)
        const isAdmin = !!((app.globalData && app.globalData.isAdmin) || isCreator)
        this.setData({
          tournament: result.data,
          tournamentDisplay: buildTournamentDisplay(result.data),
          isAdmin,
          loading: false
        });
      } else {
        wx.showToast({
          title: '赛事不存在',
          icon: 'none'
        });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      }
    } catch (err) {
      console.error('加载赛事详情失败:', err);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ loading: false });
    }
  },

  async loadRegistrations() {
    try {
      const db = wx.cloud.database();
      const _ = db.command;
      const result = await db.collection('tournament_registrations')
        .where({
          tournamentId: this.data.tournamentId,
          status: _.neq('cancelled')
        })
        .orderBy('seed', 'asc')
        .get();

      const registrations = (result.data || []).map(reg => {
        const status = reg.registrationStatus || reg.status || 'registered'
        return {
          ...reg,
          displayStatus: status,
          displayStatusText: status === 'confirmed' ? '已确认' : status === 'withdrew' ? '已退赛' : '已报名'
        }
      })
      this.setData({ registrations });
    } catch (err) {
      console.error('加载参赛人员失败:', err);
    }
  },

  async loadBrackets() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByTournament',
          tournamentId: this.data.tournamentId
        }
      });

      const brackets = (result.result.data || []).map(bracket => ({
        ...bracket,
        matches: (bracket.matches || []).map(match => ({
          ...match,
          __player1Name: playerLabel(match.player1),
          __player2Name: playerLabel(match.player2)
        }))
      }));
      let totalMatches = 0;
      brackets.forEach(bracket => {
        totalMatches += bracket.matches?.length || 0;
      });

      this.setData({
        brackets,
        totalMatches
      });
    } catch (err) {
      console.error('加载对位表失败:', err);
    }
  },

  getStatusText(status) {
    const statusMap = {
      'upcoming': '待开始',
      'ongoing': '进行中',
      'completed': '已结束'
    };
    return statusMap[status] || status;
  },

  onBack() {
    wx.navigateBack();
  },

  onEdit() {
    wx.navigateTo({
      url: `/pages/tournament-edit/index?id=${this.data.tournamentId}`
    });
  },

  onAddPlayer() {
    const { tournament } = this.data
    if (!tournament) {
      wx.showToast({
        title: '赛事信息加载失败',
        icon: 'none'
      })
      return
    }

    const pagePath = tournament.type === 'singles'
      ? '/pages/tournament-add-player/index'
      : '/pages/tournament-add-players-doubles/index'

    wx.navigateTo({
      url: `${pagePath}?id=${this.data.tournamentId}`
    });
  },

  onEditMatchups() {
    wx.navigateTo({
      url: `/pages/tournament-brackets/index?id=${this.data.tournamentId}`
    });
  },

  onEnterScore() {
    wx.navigateTo({
      url: `/pages/tournament-score/index?id=${this.data.tournamentId}`
    });
  },

  onEnterRoundScore(e) {
    const { round, id, tournamentid } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/tournament-score/index?id=${id}&round=${round}&tournamentId=${tournamentid}`
    });
  },

  onDelete() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该赛事吗？此操作不可恢复。',
      confirmColor: '#f56c6c',
      confirmText: '删除',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' });

          wx.cloud.callFunction({
            name: 'tournaments',
            data: {
              action: 'delete',
              _id: this.data.tournamentId
            },
            success: () => {
              wx.hideLoading();
              wx.showToast({ title: '删除成功', icon: 'success' });
              setTimeout(() => {
                wx.navigateBack();
              }, 500);
            },
            fail: err => {
              wx.hideLoading();
              console.error('删除失败', err);
              wx.showToast({ title: '删除失败', icon: 'error' });
            }
          });
        }
      }
    });
  },

  onResumeDraft() {
    const id = this.data.tournament && this.data.tournament._id
    if (id) wx.navigateTo({ url: `/pages/tournament-edit/index?id=${id}` })
  },

  onEditTournament() {
    const id = this.data.tournament && this.data.tournament._id
    if (id) wx.navigateTo({ url: `/pages/tournament-edit/index?id=${id}` })
  },

  onPullDownRefresh() {
    this.loadTournamentDetail().then(() => {
      this.loadRegistrations().then(() => {
        wx.stopPullDownRefresh();
      });
    });
  }
});

function buildTournamentDisplay(tournament) {
  const config = tournament.config || {}
  const pointsRules = tournament.pointsRules || {}
  const placement = pointsRules.placement || {}
  const winLoss = pointsRules.winLoss || {}
  const legacyBonus = pointsRules.bonusByRound || {}
  const hasPlacement = Object.keys(placement).length > 0
  const hasWinLoss = Object.keys(winLoss).length > 0

  const bonusRows = [1, 2, 3, 4, 5]
    .filter(round => legacyBonus[round] !== undefined || legacyBonus[String(round)] !== undefined)
    .map(round => ({
      label: `第${round}轮`,
      value: legacyBonus[round] !== undefined ? legacyBonus[round] : legacyBonus[String(round)]
    }))

  const placementRows = [
    { label: '冠军', value: placement.champion },
    { label: '亚军', value: placement.runnerUp },
    { label: '四强', value: placement.semifinal },
    { label: '八强', value: placement.quarterfinal },
    { label: '参赛', value: placement.participation }
  ].filter(row => row.value !== undefined)

  return {
    maxPlayers: tournament.maxPlayers || config.maxPlayers || '-',
    playersPerMatch: config.playersPerMatch || (tournament.type === 'doubles' ? 4 : 2),
    currentRound: config.currentRound || 1,
    totalRounds: config.totalRounds || '-',
    formatText: tournament.format === 'knockout' ? '淘汰赛' : '常规赛',
    hasSeedPlayers: Array.isArray(config.seedPlayers) && config.seedPlayers.length > 0,
    seedPlayersText: Array.isArray(config.seedPlayers) ? config.seedPlayers.join(', ') : '',
    pointsMode: hasPlacement ? 'placement' : (hasWinLoss ? 'winLoss' : 'legacy'),
    win: hasWinLoss ? winLoss.win : pointsRules.win,
    loss: hasWinLoss ? winLoss.loss : pointsRules.loss,
    walkover: pointsRules.walkover,
    placementRows,
    bonusRows
  }
}

function playerLabel(player) {
  if (!player) return '待定'
  if (player.name) return player.partnerName ? `${player.name} / ${player.partnerName}` : player.name
  return '待定'
}
