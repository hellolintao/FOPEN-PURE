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
      const result = await wx.cloud.callFunction({
        name: 'tournaments',
        data: { action: 'get', id: tournamentId }
      });

      const tournament = unpackTournamentRecord(result);
      if (tournament) {

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
      const result = await wx.cloud.callFunction({
        name: 'seasons',
        data: { action: 'get', id: seasonId }
      });
      const season = unpackSeasonRecord(result);

      if (season) {
        this.setData({
          seasonName: season.name
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

      let records = (result.result.data || [])
      .filter(record => record.tournamentId === this.data.params.tournamentId )
      .map(record => {
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

function unpackTournamentRecord(res) {
  const data = res && res.result && res.result.data;
  if (data && data.tournament) return data.tournament;
  if (data) return data;
  return null;
}

function unpackSeasonRecord(res) {
  if (!res) return null
  if (res.result && res.result.success === true) return res.result.data || null
  if (res.result && res.result.data) return res.result.data
  return res.data || null
}
