Page({
    data: {
        tournamentList: [],
        // 仅保留列表数据
    },
    onShow() {
        this.getTournamentList()
    },
    getTournamentList() {
        wx.cloud.callFunction({
            name: 'tournaments',
            data: { action: 'list' },
            success: res => {
                this.setData({ tournamentList: res.result.data || [] })
            }
        })
    },
    onEditTournament(e) {
        const id = e.currentTarget.dataset.id
        const t = this.data.tournamentList.find(x => x._id === id)
        wx.navigateTo({
            url: '/pages/tournament-edit/index?tournament=' + encodeURIComponent(JSON.stringify(t))
        })
    },
    onAddTournament() {
        wx.navigateTo({
            url: '/pages/tournament-edit/index'
        })
    },
})
