Page({
  data: {
    tournamentId: '',
    tournament: null,
    seasonName: '',
    registrations: [],
    brackets: [],
    loading: true
  },

  onLoad(options) {
    const { id } = options
    if (id) {
      this.setData({ tournamentId: id })
      this.loadTournamentDetail()
    }
  },

  async loadTournamentDetail() {
    try {
      this.setData({ loading: true })

      // 获取赛事详情
      const db = wx.cloud.database()
      const tournamentRes = await db.collection('tournaments')
        .doc(this.data.tournamentId)
        .get()

      if (!tournamentRes.data) {
        wx.showToast({
          title: '赛事不存在',
          icon: 'none'
        })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
        return
      }

      const tournament = tournamentRes.data

      // 获取赛季名称
      let seasonName = '未设置'
      if (tournament.seasonId) {
        const seasonRes = await db.collection('seasons')
          .doc(tournament.seasonId)
          .get()

        if (seasonRes.data) {
          seasonName = seasonRes.data.name
        }
      }

      // 获取参赛人员
      const _ = db.command
      const registrationRes = await db.collection('tournament_registrations')
        .where({
          tournamentId: this.data.tournamentId,
          status: _.neq('cancelled')
        })
        .orderBy('seed', 'asc')
        .get()

      const registrations = registrationRes.data || []

      // 获取对位信息
      const bracketsRes = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByTournament',
          tournamentId: this.data.tournamentId
        }
      })

      const brackets = bracketsRes.result.data || []

      console.log('赛事详情:', tournament)
      console.log('赛季名称:', seasonName)
      console.log('参赛人员:', registrations)
      console.log('对位信息:', brackets)

      this.setData({
        tournament,
        seasonName,
        registrations,
        brackets,
        loading: false
      })
    } catch (err) {
      console.error('加载赛事详情失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
      this.setData({ loading: false })
    }
  },

  onViewRoundSettlement() {
    if (this.data.tournamentId) {
      wx.navigateTo({
        url: `/pages/round-settlement/index?tournamentId=${this.data.tournamentId}`
      })
    }
  }
})
