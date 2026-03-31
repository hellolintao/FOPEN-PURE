Page({
  data: {
    params: {},
    matchRecords: [],
    tournament: null,
    round: 1,
    seasonName: ''
  },

  onLoad(options) {
    this.setData({
      params: options,
      round: parseInt(options.round) || 1
    });
    this.loadTournament(options.tournamentId);
    this.loadMatchRecords(options.tournamentId, options.round);
  },

  async loadTournament(tournamentId) {
    try {
      const db = wx.cloud.database();
      const result = await db.collection('tournaments')
        .doc(tournamentId)
        .get();

      if (result.data) {
        const tournament = result.data;

        // 通过 seasonID 加载赛季信息
        if (tournament.seasonId) {
          await this.loadSeason(tournament.seasonId);
        }

        this.setData({
          tournament: tournament
        });
      }
    } catch (err) {
      console.error('加载赛事失败:', err);
    }
  },

  async loadSeason(seasonId) {
    try {
      const db = wx.cloud.database();
      const result = await db.collection('seasons')
        .doc(seasonId)
        .get();

      if (result.data) {
        this.setData({
          seasonName: result.data.name
        });
      }
    } catch (err) {
      console.error('加载赛季失败:', err);
    }
  },

  async loadMatchRecords(tournamentId, round) {
    try {
      const result = await wx.cloud.callFunction({
        name: 'match-results',
        data: {
          action: 'list',
          tournamentId: tournamentId,
          round: parseInt(round)
        }
      });

      console.log('比赛记录数据:', result.result.data);

      // 格式化时间显示为年月日
      const records = (result.result.data || []).map(record => {
        let formattedTime = '';
        if (record.matchTime) {
          const date = new Date(record.matchTime);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          formattedTime = `${year}-${month}-${day}`;
        }
        return {
          ...record,
          matchTime: formattedTime
        };
      });

      this.setData({
        matchRecords: records
      });
    } catch (err) {
      console.error('加载比赛记录失败:', err);
    }
  }
});
