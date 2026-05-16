Component({
  properties: {
    rank: Number,
    name: String,
    avatarUrl: String,
    winRatePct: String,
    totalPoints: { type: Number, value: 0 },
    trendDelta: { type: null, value: null },
    highlight: Boolean,
    playerId: String
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { playerId: this.data.playerId });
    }
  }
});
