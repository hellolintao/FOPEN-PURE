Page({
  data: {
    tournamentList: [],
    loading: true
  },

  onLoad() {
    this.loadMyTournaments()
  },

  async loadMyTournaments() {
    try {
      // 1. 获取当前登录用户信息
      const memberRes = await wx.cloud.callFunction({
        name: 'members',
        data: { action: 'get' }
      })

      if (!memberRes.result || !memberRes.result.data || memberRes.result.data.length === 0) {
        console.log('用户未登录')
        this.setData({ loading: false })
        return
      }

      const currentUser = memberRes.result.data[0]
      console.log('当前用户:', currentUser)

      // 2. 查询当前用户参与的赛事注册记录
      const db = wx.cloud.database()
      const _ = db.command

      const registrationRes = await db.collection('tournament_registrations')
        .where({
          playerId: currentUser._id,
          status: _.neq('cancelled')
        })
        .get()

      const registrations = registrationRes.data || []
      console.log('用户的赛事注册记录:', registrations)

      // 如果没有参赛记录，直接返回
      if (registrations.length === 0) {
        console.log('用户没有参与任何赛事')
        this.setData({
          tournamentList: [],
          loading: false
        })
        return
      }

      // 3. 获取所有参赛的赛事ID
      const tournamentIds = [...new Set(registrations.map(r => r.tournamentId))]
      console.log('参赛的赛事ID列表:', tournamentIds)

      // 4. 批量获取赛事详情
      const tournamentPromises = tournamentIds.map(id => {
        return db.collection('tournaments').doc(id).get()
      })

      const tournamentResults = await Promise.all(tournamentPromises)
      const tournaments = tournamentResults
        .filter(result => result.data)
        .map(result => result.data)

      console.log('用户参与的所有赛事:', tournaments)

      // 5. 将注册信息合并到赛事数据中
      const tournamentList = registrations.map(reg => {
        const tournament = tournaments.find(t => t._id === reg.tournamentId)
        return {
          tournament,
          registration: reg
        }
      })

      this.setData({
        tournamentList,
        loading: false
      })
    } catch (err) {
      console.error('加载我的比赛失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
      this.setData({ loading: false })
    }
  },

  onCardTap(e) {
    const { tournamentId } = e.currentTarget.dataset
    if (tournamentId) {
      wx.navigateTo({
        url: `/pages/tournament-view/index?id=${tournamentId}`
      })
    }
  }
})
