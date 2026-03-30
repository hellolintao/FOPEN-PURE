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
                        success: res => {
                            wx.showToast({
                                title: '状态已更新',
                                icon: 'success'
                            })
                            this.getTournamentList()
                        },
                        fail: err => {
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
    onDeleteTournament(e) {
        const id = e.currentTarget.dataset.id
        wx.showModal({
            title: '确认删除',
            content: '确定要删除该赛事吗？此操作不可恢复。',
            confirmColor: '#e54545',
            success: res => {
                if (res.confirm) {
                    wx.cloud.callFunction({
                        name: 'tournaments',
                        data: { action: 'delete', _id: id },
                        success: res => {
                            wx.showToast({
                                title: '删除成功',
                                icon: 'success'
                            })
                            this.getTournamentList()
                        },
                        fail: err => {
                            wx.showToast({
                                title: '删除失败',
                                icon: 'error'
                            })
                        }
                    })
                }
            }
        })
    },
    onAddTournament() {
        wx.navigateTo({
            url: '/pages/tournament-edit/index'
        })
    },
})
