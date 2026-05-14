Page({
  data: {
    tournamentId: '',
    tournament: null,
    schedulePlan: null,
    r1Matches: [],
    laterRounds: [],   // [{ round, matches }]
    freePlays: [],
    loading: false,
    decoratedCourts: []  // schedulePlan.courts each annotated with [r1 matches that map to it] + [freePlays that map to it]
  },

  onLoad({ id }) {
    if (id) {
      this.setData({ tournamentId: id })
      this.refresh()
    }
  },

  onShow() {
    if (this.data.tournamentId) this.refresh()
  },

  async refresh() {
    this.setData({ loading: true })
    try {
      const tRes = await wx.cloud.callFunction({
        name: 'tournaments', data: { action: 'get', id: this.data.tournamentId }
      })
      const tournament = tRes.result && tRes.result.data

      const bRes = await wx.cloud.callFunction({
        name: 'tournament-brackets', data: { action: 'getByTournament', tournamentId: this.data.tournamentId }
      })
      const allBrackets = ((bRes.result && bRes.result.data) || []).map(bracket => ({
        ...bracket,
        matches: (bracket.matches || []).map(match => ({
          ...match,
          __player1Name: playerLabel(match.player1),
          __player2Name: playerLabel(match.player2)
        }))
      }))
      const r1Bracket = allBrackets.find(b => b.round === 1)
      const r1Matches = (r1Bracket && r1Bracket.matches) || []
      const laterRounds = allBrackets
        .filter(b => b.round > 1)
        .sort((a, b) => a.round - b.round)
        .map(b => ({ round: b.round, matches: b.matches || [] }))

      const fpRes = await wx.cloud.callFunction({
        name: 'free-plays', data: { action: 'list', tournamentId: this.data.tournamentId }
      })
      const freePlays = (fpRes.result && fpRes.result.success && fpRes.result.data && fpRes.result.data.items) || []

      const schedulePlan = (tournament && tournament.schedulePlan) || null
      const decoratedCourts = this._decorate(schedulePlan, r1Matches, freePlays)

      this.setData({
        tournament,
        schedulePlan,
        r1Matches,
        laterRounds,
        freePlays,
        decoratedCourts
      })
    } catch (e) {
      console.error('tournament-brackets refresh', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  _decorate(schedulePlan, r1Matches, freePlays) {
    if (!schedulePlan || !Array.isArray(schedulePlan.courts)) return []
    return schedulePlan.courts.map(c => ({
      ...c,
      matches: r1Matches.filter(m => m.courtId === c.courtId),
      freePlays: freePlays.filter(fp => fp.courtId === c.courtId),
      slotCount: (c.slots || []).length
    }))
  },

  onEditSchedule() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}` })
  }
})

function playerLabel(player) {
  if (!player) return '待定'
  if (player.name) return player.partnerName ? `${player.name} / ${player.partnerName}` : player.name
  return '待定'
}
