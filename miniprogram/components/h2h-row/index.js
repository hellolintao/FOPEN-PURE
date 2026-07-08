Component({
  properties: {
    playerId: String,
    name: String,
    avatarUrl: String,
    teamKey: String,
    subjectTeamLabel: String,
    opponentTeamLabel: String,
    recentMatches: { type: Array, value: [] },
    expanded: { type: Boolean, value: false },
    wins: { type: Number, value: 0 },
    losses: { type: Number, value: 0 }
  },

  data: {
    pillClass: 'neutral',
    record: '0-0'
  },

  observers: {
    'wins, losses': function(wins, losses) {
      this.updateRecord(wins, losses)
    }
  },

  lifetimes: {
    attached() {
      this.updateRecord(this.data.wins, this.data.losses)
    }
  },

  methods: {
    updateRecord(wins, losses) {
      const w = Number(wins) || 0
      const l = Number(losses) || 0
      let pillClass = 'neutral'

      if (w > l) pillClass = 'win'
      else if (l > w) pillClass = 'loss'

      this.setData({
        pillClass,
        record: `${w}-${l}`
      })
    },

    onTap() {
      if (this.data.subjectTeamLabel || this.data.opponentTeamLabel) {
        this.triggerEvent('toggle', {
          key: this.data.teamKey || `${this.data.subjectTeamLabel || ''}|${this.data.opponentTeamLabel || ''}`
        })
        return
      }
      if (!this.data.playerId) return
      this.triggerEvent('tap', { playerId: this.data.playerId })
    }
  }
})
