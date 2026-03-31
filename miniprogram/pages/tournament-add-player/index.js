Page({
  data: {
    tournamentId: ''
  },

  onLoad(options) {
    const { id } = options;
    if (id) {
      this.setData({ tournamentId: id });
    }
  }
});
