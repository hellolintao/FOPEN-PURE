Page({
  data: {
    tournamentId: '',
    tournament: null,
    registrations: [],
    loading: true
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

  onPullDownRefresh() {
    this.loadData().then(() => {
      wx.stopPullDownRefresh();
    });
  }
});
