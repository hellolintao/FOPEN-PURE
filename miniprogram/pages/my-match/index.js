const app = getApp()

Page({
  data: {
    tournamentList: [],
    scorable: [],
    loading: true
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    this.setData({ loading: true })
    await Promise.all([this.loadMyTournaments(), this.loadScorable()])
    this.setData({ loading: false })
  },

  async loadMyTournaments() {
    try {
      const memberRes = await wx.cloud.callFunction({
        name: 'members',
        data: { action: 'get' }
      })

      if (!memberRes.result || !memberRes.result.data || memberRes.result.data.length === 0) {
        this.setData({ tournamentList: [] })
        return
      }

      const currentUser = memberRes.result.data[0]
      const db = wx.cloud.database()

      // Phase 7 起统一使用 registrationStatus（修订 #18）
      const registrationRes = await db.collection('tournament_registrations')
        .where({ registrationStatus: 'confirmed' })
        .get()

      const allRegistrations = registrationRes.data || []
      const registrations = allRegistrations.filter(reg => {
        return reg.playerId === currentUser._id || reg.partnerId === currentUser._id
      })

      if (registrations.length === 0) {
        this.setData({ tournamentList: [] })
        return
      }

      const tournamentIds = [...new Set(registrations.map(r => r.tournamentId))]
      const tournamentPromises = tournamentIds.map(id => db.collection('tournaments').doc(id).get().catch(() => null))
      const tournamentResults = await Promise.all(tournamentPromises)
      const tournaments = tournamentResults
        .filter(r => r && r.data)
        .map(r => r.data)

      const tournamentList = registrations.map(reg => {
        const tournament = tournaments.find(t => t._id === reg.tournamentId)
        return { tournament, registration: reg }
      }).filter(item => item.tournament)

      this.setData({ tournamentList })
    } catch (err) {
      console.error('[my-match] loadMyTournaments', err)
    }
  },

  async loadScorable() {
    try {
      const me = (app.globalData && app.globalData.currentMember) || null
      if (!me || !me._id) {
        this.setData({ scorable: [] })
        return
      }
      const r = await wx.cloud.callFunction({
        name: 'match-results',
        data: { action: 'listByPlayer', memberId: me._id }
      })
      const matches = (r.result && r.result.success && r.result.data && r.result.data.matches) || []
      if (matches.length === 0) {
        this.setData({ scorable: [] })
        return
      }
      // 过滤掉 BYE 行和 player 缺失的行
      const playable = matches.filter(m => !m.bye && m.player1 && m.player2 && m.player1.id && m.player2.id)
      if (playable.length === 0) {
        this.setData({ scorable: [] })
        return
      }
      const tIds = [...new Set(playable.map(m => m.tournamentId))]
      let tournaments = []
      try {
        const tRes = await wx.cloud.callFunction({
          name: 'tournaments',
          data: { action: 'list', ids: tIds, pageSize: tIds.length }
        })
        tournaments = (tRes.result && tRes.result.data && tRes.result.data.tournaments) || []
      } catch (e) {
        console.error('[my-match] load tournaments by ids', e)
      }
      const tMap = Object.fromEntries(tournaments.map(t => [t._id, t]))
      const scorable = playable.map(m => ({
        ...m,
        tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
        opponentLabel: opponentLabel(m, me._id),
        statusLabel: m.resultStatus === 'submitted' ? '待确认' : '待录入'
      }))
      this.setData({ scorable })
    } catch (err) {
      console.error('[my-match] loadScorable', err)
    }
  },

  onCardTap(e) {
    const { tournamentId } = e.currentTarget.dataset
    if (tournamentId) {
      wx.navigateTo({ url: `/pages/tournament-view/index?id=${tournamentId}` })
    }
  },

  onOpenScoreRow(e) {
    const { tid, mid } = e.currentTarget.dataset
    if (!tid) return
    const url = mid
      ? `/pages/tournament-score/index?tournamentId=${tid}&matchId=${mid}`
      : `/pages/tournament-score/index?tournamentId=${tid}`
    wx.navigateTo({ url })
  }
})

function opponentLabel(m, myId) {
  const p1 = m.player1 || {}
  const p2 = m.player2 || {}
  const onP1 = p1.id === myId || p1.partnerId === myId
  const otherSide = onP1 ? p2 : p1
  const a = otherSide.name || '?'
  const b = otherSide.partnerName || ''
  return b ? `${a} / ${b}` : a
}
