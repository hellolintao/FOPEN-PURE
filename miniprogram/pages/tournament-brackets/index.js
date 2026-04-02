Page({
  data: {
    tournamentId: '',
    tournament: null,
    registrations: [],
    matchups: [],
    loading: true,
    currentMatchIndex: -1,
    currentPosition: ''
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.setData({ tournamentId: id });
      this.loadData();
    }
  },

  onShow() {
    if (this.data.tournamentId) {
      this.loadData();
    }
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      await Promise.all([
        this.loadTournament(),
        this.loadRegistrations()
      ]);
      await this.loadBrackets();
    } catch (err) {
      console.error('加载数据失败:', err);
      wx.showToast({
        title: '加载数据失败',
        icon: 'none'
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadTournament() {
    try {
      const db = wx.cloud.database();
      const result = await db.collection('tournaments')
        .doc(this.data.tournamentId)
        .get();

      this.setData({ tournament: result.data });
    } catch (err) {
      console.error('加载赛事信息失败:', err);
      throw err;
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

      this.setData({ registrations: result.data || [] });
    } catch (err) {
      console.error('加载参赛人员失败:', err);
      throw err;
    }
  },

  async loadBrackets() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByRound',
          tournamentId: this.data.tournamentId,
          round: 1
        }
      });

      const existingBrackets = result.result.data;

      if (existingBrackets && existingBrackets.length > 0) {
        const matchups = existingBrackets[0].matches.map(match => ({
          player1: match.player1?.name || '',
          player2: match.player2?.name || ''
        }));
        this.setData({ matchups });
      } else {
        this.generateMatchups();
      }
    } catch (err) {
      console.error('加载对位表失败:', err);
      this.generateMatchups();
    }
  },

  generateMatchups() {
    const { registrations } = this.data;
    const matchups = [];

    for (let i = 0; i < registrations.length; i += 2) {
      const player1 = registrations[i];
      const player2 = registrations[i + 1];

      if (player1) {
        matchups.push({
          player1: '',
          player2: ''
        });
      }
    }

    this.setData({ matchups });
  },

  onSelectPlayer(e) {
    const { matchIndex, position } = e.currentTarget.dataset;
    this.setData({
      currentMatchIndex: parseInt(matchIndex),
      currentPosition: position
    });

    const playerNames = this.data.registrations.map(reg => {
      if (this.data.tournament.type === 'doubles') {
        return reg.teamName || `${reg.playerName}/${reg.partnerName}`;
      } else {
        return reg.playerName;
      }
    });

    wx.showActionSheet({
      itemList: ['清空选择', ...playerNames],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.updateMatchupPlayer(this.data.currentMatchIndex, this.data.currentPosition, '');
        } else {
          const selectedName = playerNames[res.tapIndex - 1];
          this.updateMatchupPlayer(this.data.currentMatchIndex, this.data.currentPosition, selectedName);
        }
      }
    });
  },

  updateMatchupPlayer(matchIndex, position, playerName) {
    const matchups = this.data.matchups;
    matchups[matchIndex][position] = playerName;
    this.setData({ matchups });
  },

  onRandomMatchups() {
    if (this.data.registrations.length < 2) {
      wx.showToast({
        title: '参赛人数不足',
        icon: 'none'
      });
      return;
    }

    const playerNames = this.data.registrations.map(reg => {
      if (this.data.tournament.type === 'doubles') {
        return reg.teamName || `${reg.playerName}/${reg.partnerName}`;
      } else {
        return reg.playerName;
      }
    });

    const shuffled = [...playerNames];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const matchups = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      matchups.push({
        player1: shuffled[i] || '',
        player2: shuffled[i + 1] || ''
      });
    }

    this.setData({ matchups });

    wx.showToast({
      title: '随机对位成功',
      icon: 'success'
    });
  },

  async onSaveMatchups() {
    const validMatchups = this.data.matchups.filter(m => m.player1 && m.player2);

    if (validMatchups.length === 0) {
      wx.showToast({
        title: '请先完成对位配置',
        icon: 'none'
      });
      return;
    }

    wx.showModal({
      title: '确认保存',
      content: '确定要保存当前对位配置吗？此操作将覆盖之前的对位数据。',
      confirmText: '确定',
      cancelText: '取消',
      confirmColor: '#667eea',
      success: (res) => {
        if (res.confirm) {
          this.doSaveMatchups(validMatchups);
        }
      }
    });
  },

  async doSaveMatchups(validMatchups) {
    console.log('准备保存对位数据', validMatchups);
    wx.showLoading({
      title: '保存中...'
    });

    try {
      const existingResult = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByRound',
          tournamentId: this.data.tournamentId,
          round: 1
        }
      });

      const existingData = existingResult.result.data;
      const now = Date.now();

      let matches;

      if (existingData && existingData.length > 0 && existingData[0].matches) {
        matches = validMatchups.map((matchup, index) => {
          const existingMatch = existingData[0].matches[index];
          const player1Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              ? (reg.teamName || `${reg.playerName}/${reg.partnerName}`)
              : reg.playerName;
            return name === matchup.player1;
          });
          const player2Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              ? (reg.teamName || `${reg.playerName}/${reg.partnerName}`)
              : reg.playerName;
            return name === matchup.player2;
          });

          return {
            position: index + 1,
            matchId: existingMatch?.matchId || `match_${now}_${index}`,
            player1: {
              id: this.data.tournament.type === 'doubles'
                ? `${player1Reg?.playerId || ''},${player1Reg?.partnerId || ''}`
                : (player1Reg?.playerId || existingMatch?.player1?.id || matchup.player1),
              name: this.data.tournament.type === 'doubles'
                ? `${player1Reg?.teamName || ''}（${player1Reg?.playerName || ''}，${player1Reg?.partnerName || ''}）`
                : matchup.player1,
              registrationId: player1Reg?._id
            },
            player2: {
              id: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.playerId || ''},${player2Reg?.partnerId || ''}`
                : (player2Reg?.playerId || existingMatch?.player2?.id || matchup.player2),
              name: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.teamName || ''}（${player2Reg?.playerName || ''}，${player2Reg?.partnerName || ''}）`
                : matchup.player2,
              registrationId: player2Reg?._id
            },
            status: existingMatch?.status || 'pending'
          };
        });
      } else {
        matches = validMatchups.map((matchup, index) => {
          const player1Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              ? (reg.teamName || `${reg.playerName}/${reg.partnerName}`)
              : reg.playerName;
            return name === matchup.player1;
          });
          const player2Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              ? (reg.teamName || `${reg.playerName}/${reg.partnerName}`)
              : reg.playerName;
            return name === matchup.player2;
          });

          return {
            position: index + 1,
            matchId: `match_${now}_${index}`,
            player1: {
              id: this.data.tournament.type === 'doubles'
                ? `${player1Reg?.playerId || ''},${player1Reg?.partnerId || ''}`
                : (player1Reg?.playerId || matchup.player1),
              name: this.data.tournament.type === 'doubles'
                ? `${player1Reg?.teamName || ''}（${player1Reg?.playerName || ''}，${player1Reg?.partnerName || ''}）`
                : matchup.player1,
              registrationId: player1Reg?._id
            },
            player2: {
              id: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.playerId || ''},${player2Reg?.partnerId || ''}`
                : (player2Reg?.playerId || matchup.player2),
              name: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.teamName || ''}（${player2Reg?.playerName || ''}，${player2Reg?.partnerName || ''}）`
                : matchup.player2,
              registrationId: player2Reg?._id
            },
            status: 'pending'
          };
        });
      }
      // console.log('保存数据', {
      //   tournamentId: this.data.tournamentId,
      //   round: 1,
      //   type: this.data.tournament.type,
      //   matches: matches
      // })
      // return 
      if (existingData && existingData.length > 0) {
        await wx.cloud.callFunction({
          name: 'tournament-brackets',
          data: {
            action: 'update',
            id: existingData[0]._id,
            data: {
              tournamentId: this.data.tournamentId,
              round: 1,
              type: this.data.tournament.type,
              matches: matches
            }
          }
        });
      } else {
        await wx.cloud.callFunction({
          name: 'tournament-brackets',
          data: {
            action: 'add',
            data: {
              tournamentId: this.data.tournamentId,
              round: 1,
              type: this.data.tournament.type,
              matches: matches
            }
          }
        });
      }

      wx.hideLoading();
      wx.showToast({
        title: '保存成功',
        icon: 'success'
      });
    } catch (err) {
      wx.hideLoading();
      console.error('保存失败:', err);
      wx.showToast({
        title: '保存失败',
        icon: 'none'
      });
    }
  },

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh();
    });
  },

  onManagePlayers() {
    const id = this.data.tournamentId;
    wx.navigateTo({
      url: '/pages/tournament-add-player/index?id=' + id
    });
  }
});
