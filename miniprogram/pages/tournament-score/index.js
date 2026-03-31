Page({
  data: {
    tournamentId: '',
    tournament: null,
    brackets: [],
    currentRoundMatches: [],
    loading: true,
    userId: ''
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.setData({ tournamentId: id });
      this.loadTournament();
      this.loadBrackets();
      this.loadUserInfo();
    }
  },

  async loadUserInfo() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'members',
        data: {
          action: 'get'
        }
      });

      if (result.result && result.result.data && result.result.data[0]) {
        this.setData({
          userId: result.result.data[0]._id
        });
      }
    } catch (err) {
      console.error('加载用户信息失败:', err);
    }
  },

  async loadTournament() {
    this.setData({ loading: true });

    try {
      const db = wx.cloud.database();
      const result = await db.collection('tournaments')
        .doc(this.data.tournamentId)
        .get();

      if (result.data) {
        this.setData({
          tournament: result.data,
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
      console.error('加载赛事失败:', err);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ loading: false });
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

      const brackets = result.result.data || [];
      const currentRound = this.data.tournament && this.data.tournament.config && this.data.tournament.config.currentRound || 1;

      // 找到当前轮次的对位数据
      const currentRoundData = brackets.find(item => item.round === currentRound);
      const currentRoundMatches = currentRoundData && currentRoundData.matches || [];

      // 初始化比赛时间数据
      const matchDurations = {};
      const matchScores = {};
      currentRoundMatches.forEach((match, index) => {
        matchDurations[index] = match.duration || '';
        matchScores[index] = { player1: 0, player2: 0 };
      });

      this.setData({
        brackets,
        currentRoundMatches,
        matchDurations,
        matchScores
      });
    } catch (err) {
      console.error('加载对位表失败:', err);
    }
  },

  onDurationChange(e) {
    const { index } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({
      [`matchDurations[${index}]`]: value
    });
  },

  onScoreIncrease(e) {
    const { index, player } = e.currentTarget.dataset;
    const matchScores = this.data.matchScores || {};
    if (!matchScores[index]) {
      matchScores[index] = { player1: 0, player2: 0 };
    }
    matchScores[index][player] = (matchScores[index][player] || 0) + 1;
    this.setData({
      [`matchScores[${index}].${player}`]: matchScores[index][player]
    });
  },

  onScoreDecrease(e) {
    const { index, player } = e.currentTarget.dataset;
    const matchScores = this.data.matchScores || {};
    if (!matchScores[index]) {
      matchScores[index] = { player1: 0, player2: 0 };
    }
    const currentValue = matchScores[index][player] || 0;
    if (currentValue > 0) {
      matchScores[index][player] = currentValue - 1;
      this.setData({
        [`matchScores[${index}].${player}`]: matchScores[index][player]
      });
    }
  },

  onSubmit() {
    wx.showModal({
      title: '确认提交',
      content: '提交后不能更改，请确认成绩是否正确！',
      confirmColor: '#f56c6c',
      confirmText: '确认提交',
      success: res => {
        if (res.confirm) {
          this.submitScores();
        }
      }
    });
  },

  async submitScores() {
    wx.showLoading({ title: '提交中...' });

    const { tournament, currentRoundMatches, matchDurations, matchScores } = this.data;

    try {
      // 遍历所有比赛，保存成绩
      for (let i = 0; i < currentRoundMatches.length; i++) {
        const match = currentRoundMatches[i];
        const score1 = matchScores[i].player1 || 0;
        const score2 = matchScores[i].player2 || 0;
        const duration = matchDurations[i] || '';

        // 判断获胜者
        const winnerId = score1 > score2 ? match.player1.id : (score2 > score1 ? match.player2.id : null);
        const loserId = score1 > score2 ? match.player2.id : (score2 > score1 ? match.player1.id : null);

        // 计算积分
        let pointsAwarded = null;
        if (winnerId && loserId) {
          const { pointsRules } = tournament;
          const currentRound = tournament.config.currentRound || 1;
          const bonusPoints = (pointsRules.bonusByRound && pointsRules.bonusByRound[currentRound]) || 0;

          pointsAwarded = {
            winner: {
              basePoints: pointsRules.win,
              bonusPoints: bonusPoints,
              total: pointsRules.win + bonusPoints
            },
            loser: {
              basePoints: pointsRules.loss,
              bonusPoints: 0,
              total: pointsRules.loss
            }
          };
        }

        // 准备比赛数据
        const matchData = {
          tournamentId: this.data.tournamentId,
          round: tournament.config.currentRound || 1,
          type: tournament.type,
          players: [
            {
              id: match.player1.id,
              name: match.player1.name,
              seed: match.player1.seed,
              isWinner: winnerId === match.player1.id
            },
            {
              id: match.player2.id,
              name: match.player2.name,
              seed: match.player2.seed,
              isWinner: winnerId === match.player2.id
            }
          ],
          score: score1 > 0 || score2 > 0 ? `${score1}-${score2}` : '',
          scoreDetail: {
            sets: [
              { player1: score1, player2: score2 }
            ],
            winner: winnerId,
            duration: duration ? parseInt(duration) : null
          },
          winnerId: winnerId,
          loserId: loserId,
          pointsAwarded: pointsAwarded,
          status: (score1 > 0 || score2 > 0) ? 'completed' : 'pending',
          matchTime: new Date().toISOString(),
          courtId: this.data.userId || null
        };

        // 查询是否已存在该比赛的记录
        const existResult = await wx.cloud.callFunction({
          name: 'match-results',
          data: {
            action: 'list',
            tournamentId: this.data.tournamentId,
            round: tournament.config.currentRound || 1
          }
        });

        const existList = existResult.result.data || [];
        const existMatch = existList.find(item =>
          item.players[0].id === match.player1.id &&
          item.players[1].id === match.player2.id
        );

        // 根据是否已存在决定使用 update 还是 add
        if (existMatch && existMatch._id) {
          // 已存在，更新记录
          await wx.cloud.callFunction({
            name: 'match-results',
            data: {
              action: 'update',
              id: existMatch._id,
              data: matchData
            }
          });
        } else {
          // 不存在，新增记录
          await wx.cloud.callFunction({
            name: 'match-results',
            data: {
              action: 'add',
              data: matchData
            }
          });
        }
      }

      wx.hideLoading();
      wx.showToast({
        title: '提交成功',
        icon: 'success'
      });

      setTimeout(() => {
        wx.navigateBack();
      }, 1500);

    } catch (err) {
      wx.hideLoading();
      console.error('提交失败:', err);
      wx.showToast({
        title: '提交失败',
        icon: 'none'
      });
    }
  }
});
