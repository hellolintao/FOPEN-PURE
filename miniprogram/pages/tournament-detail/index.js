Page({
  data: {
    tournamentId: '',
    tournament: null,
    loading: true
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.setData({ tournamentId: id });
      this.loadTournamentDetail();
    }
  },

  onShow() {
    // 页面显示时刷新数据
    if (this.data.tournamentId) {
      this.loadTournamentDetail();
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
      console.error('加载赛事详情失败:', err);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ loading: false });
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
    wx.navigateTo({
      url: `/pages/tournament-add-player/index?id=${this.data.tournamentId}`
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

  onPullDownRefresh() {
    this.loadTournamentDetail().then(() => {
      wx.stopPullDownRefresh();
    });
  }
});
