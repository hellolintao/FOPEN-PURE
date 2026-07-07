Component({
  properties: {
    rank: Number,
    name: String,
    winRatePct: String,
    totalPoints: { type: Number, value: 0 },
    trendDelta: { type: null, value: null },
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
