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

      // 1. 获取赛事详情（通过云函数）
      const tournamentRes = await wx.cloud.callFunction({
        name: 'tournaments',
        data: {
          action: 'get',
          id: this.data.tournamentId
        }
      })

      if (!tournamentRes.result || !tournamentRes.result.data) {
        wx.showToast({
          title: '赛事不存在',
          icon: 'none'
        })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
        return
      }

      const tournament = tournamentRes.result.data

      // 2. 获取赛季名称（通过云函数）
      let seasonName = '未设置'
      if (tournament.seasonId) {
        const seasonRes = await wx.cloud.callFunction({
          name: 'seasons',
          data: {
            action: 'get',
            id: tournament.seasonId
          }
        })

        if (seasonRes.result && seasonRes.result.data) {
          seasonName = seasonRes.result.data.name
        }
      }

      // 3. 获取参赛人员（通过云函数）
      const registrationRes = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: {
          action: 'list',
          tournamentId: this.data.tournamentId,
          page: 1,
          pageSize: 1000
        }
      })

      const registrations = registrationRes.result?.data || []

      // 4. 获取对位信息（通过云函数）
      const bracketsRes = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByTournament',
          tournamentId: this.data.tournamentId
        }
      })

      const brackets = bracketsRes.result?.data || []

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
