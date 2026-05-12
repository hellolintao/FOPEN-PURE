function formatSlotLabel(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const idx = iso.indexOf('T');
  if (idx < 0) return iso;
  const datePart = iso.substring(0, idx);
  const timePart = iso.substring(idx + 1);
  const [, month, day] = datePart.split('-');
  const [hour, minute] = timePart.split(':');
  return `${month}-${day} ${hour}:${minute}`;
}

function getCourtName(courtId, courts) {
  if (!courtId) return '';
  const court = (courts || []).find(c => c.courtId === courtId);
  return (court && court.name) || courtId;
}

Page({
  data: {
    tournamentId: '',
    tournament: null,
    registrations: [],
    rounds: [], // 轮次数据 [{ round, matchups: [{ player1, player2, matchId, courtId, scheduledStart, scheduledSlotId, status }] }]
    unscheduledMatches: [], // 自动排程后未排上的 match 列表
    loading: true,
    scheduling: false,
    currentRound: 1,
    currentMatchIndex: -1,
    currentPosition: '',
    actionSheetShow: false,
    actionSheetItems: [],
    actionSheetContext: 'player' // 'player' | 'manualAssign'
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
      // 加载第一轮数据
      const result = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByRound',
          tournamentId: this.data.tournamentId,
          round: 1
        }
      });

      const existingBrackets = result.result.data;

      if (existingBrackets && existingBrackets.length > 0 && existingBrackets[0].matches) {
        // 有数据，加载所有轮次
        const rounds = []
        const unscheduled = []
        for (let i = 1; i <= 5; i++) {
          const roundResult = await wx.cloud.callFunction({
            name: 'tournament-brackets',
            data: {
              action: 'getByRound',
              tournamentId: this.data.tournamentId,
              round: i
            }
          })

          const roundData = roundResult.result.data
          if (roundData && roundData.length > 0 && roundData[0].matches) {
            const matchups = roundData[0].matches.map(match => {
              const courts = this.data.tournament?.courtTimeGrid?.courts || []
              const matchup = {
                player1: match.player1?.name || '',
                player2: match.player2?.name || '',
                matchId: match.matchId || '',
                courtId: match.courtId || '',
                scheduledStart: match.scheduledStart || '',
                scheduledSlotId: match.scheduledSlotId || '',
                status: match.status || 'pending',
                scheduleTimeLabel: formatSlotLabel(match.scheduledStart || match.scheduledTime || ''),
                courtName: getCourtName(match.courtId || '', courts)
              }
              if (!matchup.courtId && matchup.player1 && matchup.player2) {
                unscheduled.push({
                  round: i,
                  matchId: matchup.matchId,
                  player1: matchup.player1,
                  player2: matchup.player2
                })
              }
              return matchup
            })
            rounds.push({ round: i, matchups, saved: true, bracketId: roundData[0]._id })
          } else if (i === 1) {
            // 第一轮没有数据，生成空对位
            rounds.push({ round: i, matchups: this.generateEmptyMatchups(), saved: false })
          } else {
            break
          }
        }

        this.setData({ rounds, unscheduledMatches: unscheduled })
      } else {
        // 没有数据，初始化第一轮
        const rounds = [{ round: 1, matchups: this.generateEmptyMatchups(), saved: false }]
        this.setData({ rounds })
      }
    } catch (err) {
      console.error('加载对位表失败:', err);
      // 初始化第一轮
      const rounds = [{ round: 1, matchups: this.generateEmptyMatchups(), saved: false }]
      this.setData({ rounds })
    }
  },

  generateEmptyMatchups() {
    const { registrations } = this.data;
    const matchups = [];

    for (let i = 0; i < registrations.length; i += 2) {
      matchups.push({
        player1: '',
        player2: '',
        matchId: '',
        courtId: '',
        scheduledStart: '',
        scheduledSlotId: '',
        status: 'pending'
      });
    }

    return matchups;
  },

  async onAutoSchedule() {
    if (this.data.scheduling) return;
    const { tournament, tournamentId } = this.data;
    if (!tournament) return;
    const grid = tournament.courtTimeGrid;
    if (!grid || !grid.slots || grid.slots.length === 0) {
      wx.showToast({ title: '请先在赛事编辑里配置场地/时段', icon: 'none' });
      return;
    }
    if (!this.data.registrations || this.data.registrations.length < 2) {
      wx.showToast({ title: '参赛人数不足', icon: 'none' });
      return;
    }

    const confirm = await new Promise((resolve) => {
      wx.showModal({
        title: '自动排程',
        content: '将按 (场地 × 时段) 自动分配比赛，已有比赛结果（如胜方）保留，未排上的会在下方列出。继续？',
        confirmText: '开始排程',
        cancelText: '取消',
        success: (res) => resolve(!!res.confirm)
      });
    });
    if (!confirm) return;

    this.setData({ scheduling: true });
    wx.showLoading({ title: '排程中...' });
    try {
      const callRes = await wx.cloud.callFunction({
        name: 'scheduler-engine',
        data: { action: 'schedule', tournamentId }
      });
      const result = callRes && callRes.result;
      wx.hideLoading();
      if (!result || result.success === false) {
        const message = (result && result.error && result.error.message) || '排程失败';
        wx.showModal({ title: '排程失败', content: message, showCancel: false });
        return;
      }

      const { scheduledCount, unscheduledCount } = result.data || {};
      wx.showToast({
        title: `已排程 ${scheduledCount}，未排 ${unscheduledCount}`,
        icon: 'none',
        duration: 2200
      });
      await this.loadBrackets();
    } catch (err) {
      wx.hideLoading();
      console.error('自动排程异常', err);
      wx.showModal({ title: '排程异常', content: err.message || String(err), showCancel: false });
    } finally {
      this.setData({ scheduling: false });
    }
  },

  onSelectPlayer(e) {
    const { round, matchIndex, position } = e.currentTarget.dataset;
    this.setData({
      currentRound: parseInt(round),
      currentMatchIndex: parseInt(matchIndex),
      currentPosition: position
    });

    const playerNames = this.data.registrations.map(reg => {
      if (this.data.tournament.type === 'doubles') {
        return `${reg.teamName}-${reg.playerName}/${reg.partnerName}`;
      } else {
        return reg.playerName;
      }
    });

    // 设置选项列表，添加清空选择选项
    this.setData({
      actionSheetItems: ['清空选择', ...playerNames],
      actionSheetShow: true
    });
  },

  onActionSheetSelect(e) {
    const { index } = e.detail;
    if (this.data.actionSheetContext === 'manualAssign') {
      this._handleManualAssignSelection(index);
      return;
    }
    const playerNames = this.data.registrations.map(reg => {
      if (this.data.tournament.type === 'doubles') {
        return `${reg.teamName}-${reg.playerName}/${reg.partnerName}`;
      } else {
        return reg.playerName;
      }
    });

    if (index === 0) {
      this.updateMatchupPlayer(this.data.currentRound, this.data.currentMatchIndex, this.data.currentPosition, '');
    } else {
      const selectedName = playerNames[index - 1];
      this.updateMatchupPlayer(this.data.currentRound, this.data.currentMatchIndex, this.data.currentPosition, selectedName);
    }
  },

  onManualAssign(e) {
    const { matchId, round } = e.currentTarget.dataset;
    const tournament = this.data.tournament;
    const grid = tournament && tournament.courtTimeGrid;
    if (!grid || !grid.slots || grid.slots.length === 0) {
      wx.showToast({ title: '未配置场地/时段', icon: 'none' });
      return;
    }
    const options = [];
    grid.slots.forEach(slot => {
      const courts = slot.availableCourtIds || [];
      courts.forEach(courtId => {
        const courtName = (grid.courts || []).find(c => c.courtId === courtId)?.name || courtId;
        options.push({
          slotId: slot.slotId,
          courtId,
          scheduledStart: slot.start,
          label: `${formatSlotLabel(slot.start)} · ${courtName}`
        });
      });
    });
    if (options.length === 0) {
      wx.showToast({ title: '无可用格子', icon: 'none' });
      return;
    }
    this._manualAssignTarget = { matchId, round: parseInt(round, 10), options };
    this.setData({
      actionSheetContext: 'manualAssign',
      actionSheetItems: options.map(o => o.label),
      actionSheetShow: true
    });
  },

  async _handleManualAssignSelection(index) {
    const target = this._manualAssignTarget;
    this.setData({ actionSheetShow: false, actionSheetContext: 'player' });
    if (!target || index < 0 || index >= target.options.length) return;
    const choice = target.options[index];
    const rounds = this.data.rounds;
    const roundObj = rounds.find(r => r.round === target.round);
    if (!roundObj || !roundObj.bracketId) {
      wx.showToast({ title: '签表尚未保存', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '指派中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'updateMatchStatus',
          id: roundObj.bracketId,
          matchId: target.matchId,
          data: {
            status: 'pending',
            courtId: choice.courtId,
            scheduledStart: choice.scheduledStart,
            scheduledSlotId: choice.slotId
          }
        }
      });
      wx.hideLoading();
      if (res && res.result && res.result.errMsg && /failed|error/i.test(res.result.errMsg)) {
        wx.showModal({ title: '指派失败', content: res.result.errMsg, showCancel: false });
        return;
      }
      wx.showToast({ title: '已指派', icon: 'success' });
      await this.loadBrackets();
    } catch (err) {
      wx.hideLoading();
      console.error('手动指派失败', err);
      wx.showModal({ title: '指派异常', content: err.message || String(err), showCancel: false });
    }
  },

  onActionSheetClose() {
    this.setData({
      actionSheetShow: false,
      actionSheetContext: 'player'
    });
  },

  updateMatchupPlayer(round, matchIndex, position, playerName) {
    const rounds = this.data.rounds;
    const roundIndex = rounds.findIndex(r => r.round === round);
    if (roundIndex !== -1) {
      rounds[roundIndex].matchups[matchIndex][position] = playerName;
      rounds[roundIndex].modified = true;
      this.setData({ rounds });
    }
  },

  onDeleteMatchup(e) {
    const { round, index } = e.currentTarget.dataset;
    const rounds = this.data.rounds;
    const roundIndex = rounds.findIndex(r => r.round === parseInt(round));

    if (roundIndex !== -1) {
      rounds[roundIndex].matchups.splice(parseInt(index), 1);
      rounds[roundIndex].saved = false;
      rounds[roundIndex].modified = true;
      this.setData({ rounds });
    }
  },

  onAddMatchup(e) {
    const round = parseInt(e.currentTarget.dataset.round);
    const rounds = this.data.rounds;
    const roundIndex = rounds.findIndex(r => r.round === round);

    if (roundIndex !== -1) {
      rounds[roundIndex].matchups.push({ player1: '', player2: '' });
      rounds[roundIndex].modified = true;
      this.setData({ rounds });
    }
  },

  onRandomMatchups(e) {
    const round = parseInt(e.currentTarget.dataset.round);

    if (this.data.registrations.length < 2) {
      wx.showToast({
        title: '参赛人数不足',
        icon: 'none'
      });
      return;
    }

    const playerNames = this.data.registrations.map(reg => {
      if (this.data.tournament.type === 'doubles') {
        return `${reg.teamName || ''}-${reg.playerName || ''}/${reg.partnerName || ''}`;
        // return reg.teamName || `${reg.playerName}/${reg.partnerName}`;
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

    // 更新指定轮次的数据
    const rounds = this.data.rounds;
    const roundIndex = rounds.findIndex(r => r.round === round);
    if (roundIndex !== -1) {
      rounds[roundIndex].matchups = matchups;
      rounds[roundIndex].modified = true;
      this.setData({ rounds });
    }

    wx.showToast({
      title: '随机对位成功',
      icon: 'success'
    });
  },

  onAddRound() {
    const rounds = this.data.rounds;
    const nextRound = rounds.length + 1;

    if (nextRound > 5) {
      wx.showToast({
        title: '最多支持5轮',
        icon: 'none'
      });
      return;
    }

    // 计算下一轮的场次数（上一轮的一半）
    // const index = rounds.length - 1 < 0 ? 0 : rounds.length - 1;
    const lastRoundMatchups = rounds[rounds.length - 1]?.matchups || [];
    const nextMatchCount = Math.ceil(lastRoundMatchups.length / 2) || 1;

    const nextMatchups = [];
    for (let i = 0; i < nextMatchCount; i++) {
      nextMatchups.push({
        player1: '',
        player2: ''
      });
    }

    rounds.push({ round: nextRound, matchups: nextMatchups, saved: false });
    this.setData({ rounds });

  },

  async onDeleteLastRound() {
    const rounds = this.data.rounds;

    // if (rounds.length <= 1) {
    //   wx.showToast({
    //     title: '至少保留一轮',
    //     icon: 'none'
    //   });
    //   return;
    // }

    wx.showModal({
      title: '确认删除',
      content: '确定要删除最后一轮对位信息吗？',
      confirmText: '删除',
      cancelText: '取消',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (res.confirm) {
          await this.doDeleteLastRound();
        }
      }
    });
  },

  async doDeleteLastRound() {
    const rounds = this.data.rounds;
    const lastRound = rounds[rounds.length - 1];

    wx.showLoading({
      title: '删除中...'
    });

    try {
      // 如果该轮次已保存到数据库，先删除数据库记录
      if (lastRound.bracketId) {
        await wx.cloud.callFunction({
          name: 'tournament-brackets',
          data: {
            action: 'delete',
            id: lastRound.bracketId
          }
        });
      }

      // 从本地删除最后一轮
      rounds.pop();
      this.setData({ rounds });

      wx.hideLoading();
      wx.showToast({
        title: '删除成功',
        icon: 'success'
      });
    } catch (err) {
      wx.hideLoading();
      console.error('删除失败:', err);
      wx.showToast({
        title: '删除失败',
        icon: 'none'
      });
    }
  },

  async onSaveMatchups(e) {
    const round = parseInt(e.currentTarget.dataset.round);
    const rounds = this.data.rounds;
    const roundIndex = rounds.findIndex(r => r.round === round);
    const matchups = rounds[roundIndex]?.matchups || [];

    const validMatchups = matchups.filter(m => m.player1 && m.player2);

    if (validMatchups.length === 0) {
      wx.showToast({
        title: '请先完成对位配置',
        icon: 'none'
      });
      return;
    }
    // 把当前显示的所有 matchup（含排程字段）一起传给 doSaveMatchups
    // 用 matchId 索引，保存时合并保留 court / scheduledStart / scheduledSlotId
    this.doSaveMatchups(round, validMatchups);
  },

  /**
   * 把现有 bracket 的 match 按多 key 合并到新 match 上。
   * 优先 matchId 匹配，其次 position 兜底。
   * 合并字段：courtId / scheduledStart / scheduledSlotId / winner / score。
   */
  _mergeScheduleFields(newMatch, existingMatch) {
    if (!existingMatch) return newMatch;
    const merged = { ...newMatch };
    if (existingMatch.courtId) merged.courtId = existingMatch.courtId;
    if (existingMatch.scheduledStart) merged.scheduledStart = existingMatch.scheduledStart;
    if (existingMatch.scheduledSlotId) merged.scheduledSlotId = existingMatch.scheduledSlotId;
    if (existingMatch.winner !== undefined) merged.winner = existingMatch.winner;
    if (existingMatch.score !== undefined) merged.score = existingMatch.score;
    return merged;
  },

  _findExistingMatch(existingMatches, candidate, fallbackIndex) {
    if (!Array.isArray(existingMatches) || existingMatches.length === 0) return null;
    if (candidate.matchId) {
      const byId = existingMatches.find(m => m.matchId && m.matchId === candidate.matchId);
      if (byId) return byId;
    }
    return existingMatches[fallbackIndex] || null;
  },

  async doSaveMatchups(round, validMatchups) {
    console.log(`准备保存第${round}轮对位数据`, validMatchups);
    wx.showLoading({
      title: '保存中...'
    });

    try {
      const existingResult = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByRound',
          tournamentId: this.data.tournamentId,
          round: round
        }
      });

      const existingData = existingResult.result.data;
      const now = Date.now();

      let matches;
      if (existingData && existingData.length > 0 && existingData[0].matches) {
        const existingMatches = existingData[0].matches;
        matches = validMatchups.map((matchup, index) => {
          const existingMatch = this._findExistingMatch(existingMatches, matchup, index);

          const player1Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              ? `${reg.teamName}-${reg.playerName}/${reg.partnerName}`
              : reg.playerName;
            return name === matchup.player1;
          });

          const player2Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              ? `${reg.teamName}-${reg.playerName}/${reg.partnerName}`
              : reg.playerName;
            return name === matchup.player2;
          });

          const baseMatch = {
            position: index + 1,
            matchId: existingMatch?.matchId || matchup.matchId || `match_${now}_${index}`,
            player1: {
              id: this.data.tournament.type === 'doubles'
                ? `${player1Reg?.playerId || ''},${player1Reg?.partnerId || ''}`
                : (player1Reg?.playerId || existingMatch?.player1?.id || matchup.player1),
              name: this.data.tournament.type === 'doubles'
                ? `${player1Reg?.teamName || ''}-${player1Reg?.playerName || ''}/${player1Reg?.partnerName || ''}`
                : matchup.player1,
              registrationId: player1Reg?._id
            },
            player2: {
              id: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.playerId || ''},${player2Reg?.partnerId || ''}`
                : (player2Reg?.playerId || existingMatch?.player2?.id || matchup.player2),
              name: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.teamName || ''}-${player2Reg?.playerName || ''}/${player2Reg?.partnerName || ''}`
                : matchup.player2,
              registrationId: player2Reg?._id
            },
            status: existingMatch?.status || 'pending'
          };
          return this._mergeScheduleFields(baseMatch, existingMatch);
        });
      } else {
        matches = validMatchups.map((matchup, index) => {
          const player1Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              // ? (reg.teamName || `${reg.playerName}/${reg.partnerName}`)
              ? `${reg.teamName || ''}-${reg.playerName || ''}/${reg.partnerName || ''}`
              : reg.playerName;
            return name === matchup.player1;
          });
          const player2Reg = this.data.registrations.find(reg => {
            const name = this.data.tournament.type === 'doubles'
              // ? (reg.teamName || `${reg.playerName}/${reg.partnerName}`)
              ? `${reg.teamName || ''}-${reg.playerName || ''}/${reg.partnerName || ''}`
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
                ? `${player1Reg?.teamName || ''}-${player1Reg?.playerName || ''}/${player1Reg?.partnerName || ''}`
                : matchup.player1,
              registrationId: player1Reg?._id
            },
            player2: {
              id: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.playerId || ''},${player2Reg?.partnerId || ''}`
                : (player2Reg?.playerId || matchup.player2),
              name: this.data.tournament.type === 'doubles'
                ? `${player2Reg?.teamName || ''}-${player2Reg?.playerName || ''}/${player2Reg?.partnerName || ''}`
                : matchup.player2,
              registrationId: player2Reg?._id
            },
            status: 'pending'
          };
        });
      }

      let savedBracketId;
      if (existingData && existingData.length > 0) {
        wx.hideLoading();
        console.log('这里提交保存数据', '\n', {
          tournamentId: this.data.tournamentId,
          round: round,
          type: this.data.tournament.type,
          matches: matches
        })
        // return
        await wx.cloud.callFunction({
          name: 'tournament-brackets',
          data: {
            action: 'update',
            id: existingData[0]._id,
            data: {
              tournamentId: this.data.tournamentId,
              round: round,
              type: this.data.tournament.type,
              matches: matches
            }
          }
        });
        savedBracketId = existingData[0]._id;
      } else {
        const addResult = await wx.cloud.callFunction({
          name: 'tournament-brackets',
          data: {
            action: 'add',
            data: {
              tournamentId: this.data.tournamentId,
              round: round,
              type: this.data.tournament.type,
              matches: matches
            }
          }
        });
        savedBracketId = addResult.result?._id;
      }

      wx.hideLoading();

      // 更新该轮次的 saved 状态和 bracketId
      const rounds = this.data.rounds;
      const roundIndex = rounds.findIndex(r => r.round === round);
      if (roundIndex !== -1) {
        rounds[roundIndex].saved = true;
        rounds[roundIndex].modified = false;
        rounds[roundIndex].bracketId = savedBracketId;
        this.setData({ rounds });
      }

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
    const pagePath = this.data.tournament.type === 'singles'
      ? '/pages/tournament-add-player/index'
      : '/pages/tournament-add-players-doubles/index'
    const id = this.data.tournamentId
    wx.navigateTo({
      url: `${pagePath}?id=${id}`
    });
  },
  
});
