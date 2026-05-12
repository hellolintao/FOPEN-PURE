Component({
  properties: {
    rank: Number,
    name: String,
    avatarUrl: String,
    utr: String,
    trend: { type: Number, value: 0 },
    highlight: Boolean,
    playerId: String
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { playerId: this.data.playerId });
    }
  }
});
