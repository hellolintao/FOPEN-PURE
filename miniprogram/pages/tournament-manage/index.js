Page({
    data: {
        tournamentList: [],
        totalTournaments: 0,
        ongoingTournaments: 0,
    },
    onShow() {
        this.getTournamentList()
    },
    getTournamentList() {
        wx.cloud.callFunction({
            name: 'tournaments',
            data: { action: 'list' },
            success: res => {
                const list = res.result.data || []
                this.setData({
                    tournamentList: list,
                    totalTournaments: list.length,
                    ongoingTournaments: list.filter(t => t.status === 'ongoing').length
                })
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
    onSetStatus(e) {
        const { id, status } = e.currentTarget.dataset
        wx.showModal({
            title: '确认修改状态',
            content: `确定要将该赛事状态修改为"${status === 'upcoming' ? '待开始' : status === 'ongoing' ? '进行中' : '已结束'}"吗？`,
            success: res => {
                if (res.confirm) {
                    wx.cloud.callFunction({
                        name: 'tournaments',
                        data: { action: 'updateStatus', _id: id, status },
                        success: () => {
                            wx.showToast({
                                title: '状态已更新',
                                icon: 'success'
                            })
                            this.getTournamentList()
                        },
                        fail: () => {
                            wx.showToast({
                                title: '更新失败',
                                icon: 'error'
                            })
                        }
                    })
                }
            }
        })
    },
    onStopPropagation() {
        // 阻止事件冒泡
    },
    onAddTournament() {
        wx.navigateTo({
            url: '/pages/tournament-edit/index'
        })
    },
})
