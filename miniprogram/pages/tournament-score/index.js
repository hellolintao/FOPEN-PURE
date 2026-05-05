Page({
  data: {
    tournamentId: '',
    tournament: null,
    brackets: [],
    currentRound: 1,
    currentMatchId: '',      // 比赛记录ID（用于编辑已有成绩）
    currentMatch: null,      // 当前编辑的比赛记录数据
    matchScores: {},         // 多场比赛分数 { index: { player1: 0, player2: 0 } }
    matchDurations: {},      // 多场比赛时间 { index: '' }
    loading: true,
    userId: ''
  },

  onLoad(options) {
    const { id, round, tournamentId } = options;
    
    if (!tournamentId || !round) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }

    this.setData({ 
      tournamentId: tournamentId,
      currentRound: parseInt(round),
      currentMatchId: id || ''
    });
    
    this.loadTournament();
    this.loadBrackets();
    this.loadUserInfo();
    
    // 如果有 id，说明是编辑已有成绩，需要加载该比赛记录
    if (id) {
      this.loadMatchRecord(id);
    }
  },

  async loadMatchRecord(matchId) {
    try {
      const result = await wx.cloud.callFunction({
        name: 'match-results',
        data: {
          action: 'getById',
          id: matchId
        }
      });

      if (result.result && result.result.data) {
        const match = result.result.data;
        // 找到对应比赛的索引
        const brackets = this.data.brackets;
        let matchIndex = -1;
        for (let i = 0; i < brackets.length; i++) {
          if (brackets[i].player1.id === match.player1.id && brackets[i].player2.id === match.player2.id) {
            matchIndex = i;
            break;
          }
        }

        if (matchIndex >= 0) {
          const matchScores = {};
          const matchDurations = {};
          matchScores[matchIndex] = {
            player1: match.scoreDetail?.sets?.[0]?.player1 || 0,
            player2: match.scoreDetail?.sets?.[0]?.player2 || 0
          };
          matchDurations[matchIndex] = match.scoreDetail?.duration || '';
          
          this.setData({
            currentMatch: match,
            matchScores,
            matchDurations
          });
        } else {
          this.setData({ currentMatch: match });
        }
      }
    } catch (err) {
      console.error('加载比赛记录失败:', err);
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
          action: 'getByRound',
          tournamentId: this.data.tournamentId,
          round: this.data.currentRound
        }
      });

      const bracketData = result.result.data || [];
      const currentRoundData = bracketData[0];
      const currentRoundMatches = currentRoundData && currentRoundData.matches || [];

      this.setData({
        brackets: currentRoundMatches,
        loading: false
      });
    } catch (err) {
      console.error('加载对位表失败:', err);
      this.setData({ loading: false });
    }
  },

  onDurationChange(e) {
    const { index } = e.currentTarget.dataset;
    const value = e.detail.value;
    const matchDurations = this.data.matchDurations;
    matchDurations[index] = value;
    this.setData({ matchDurations });
  },

  onScoreIncrease(e) {
    const { index, player } = e.currentTarget.dataset;
    const matchScores = this.data.matchScores;
    if (!matchScores[index]) {
      matchScores[index] = { player1: 0, player2: 0 };
    }
    matchScores[index][player] = (matchScores[index][player] || 0) + 1;
    this.setData({ matchScores });
  },

  onScoreDecrease(e) {
    const { index, player } = e.currentTarget.dataset;
    const matchScores = this.data.matchScores;
    if (!matchScores[index]) {
      matchScores[index] = { player1: 0, player2: 0 };
    }
    if (matchScores[index][player] > 0) {
      matchScores[index][player] = matchScores[index][player] - 1;
      this.setData({ matchScores });
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
          this.submitScore();
        }
      }
    });
  },

  async submitScore() {
    wx.showLoading({ title: '提交中...' });

    const { tournament, currentRound, brackets, matchScores, matchDurations } = this.data;

    try {
      // 遍历所有比赛，提交成绩
      for (let i = 0; i < brackets.length; i++) {
        const match = brackets[i];
        const score1 = (matchScores[i] && matchScores[i].player1) || 0;
        const score2 = (matchScores[i] && matchScores[i].player2) || 0;
        const duration = matchDurations[i] || '';

        // 判断获胜者
        const winnerId = score1 > score2 ? match.player1.id : (score2 > score1 ? match.player2.id : null);
        const loserId = score1 > score2 ? match.player2.id : (score2 > score1 ? match.player1.id : null);

        // 计算积分
        let pointsAwarded = null;
        if (winnerId && loserId) {
          const { pointsRules } = tournament;
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
          round: currentRound,
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
            round: currentRound
          }
        });

        const existList = existResult.result.data || [];
        const existMatch = existList.find(item =>
          item.players[0].id === match.player1.id &&
          item.players[1].id === match.player2.id
        );

        // 根据是否已存在决定是更新还是新增
        if (existMatch && existMatch._id) {
          await wx.cloud.callFunction({
            name: 'match-results',
            data: {
              action: 'update',
              id: existMatch._id,
              data: matchData
            }
          });
        } else {
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
        wx.redirectTo({
          url: `/pages/round-settlement/index?tournamentId=${this.data.tournamentId}&round=${currentRound}`
        });
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
