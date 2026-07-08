Component({
  properties: {
    rank: Number,
    name: String,
    avatarUrl: String,
    winRatePct: String,
    totalPoints: { type: Number, value: 0 },
    trendDelta: { type: null, value: null },
    trendState: { type: String, value: 'no_history' },
    trendLabel: { type: String, value: '-' },
    highlight: Boolean,
    prideHighlight: Boolean,
    playerId: String
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { playerId: this.data.playerId });
    }
  }
});
