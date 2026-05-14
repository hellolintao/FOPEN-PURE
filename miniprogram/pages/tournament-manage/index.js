Page({
    data: {
        tournamentList: [],
        page: 1,
        pageSize: 10,
        loading: false,
        hasMore: true
    },
    onLoad() {
        this.getTournamentList()
    },
    onShow() {
        this.setData({
            page: 1,
            tournamentList: [],
            hasMore: true
        })
        this.getTournamentList()
    },
    getTournamentList() {
        if (this.data.loading || !this.data.hasMore) {
            return
        }

        this.setData({ loading: true })

        wx.cloud.callFunction({
            name: 'tournaments',
            data: {
                action: 'list',
                page: this.data.page,
                pageSize: this.data.pageSize
            },
            success: res => {
                // Phase 7: list now returns { success, data: { tournaments: [...] } }
                const list = (res.result.data && res.result.data.tournaments) || []
                const total = res.result.total || 0

                this.setData({
                    tournamentList: this.data.page === 1 ? list : [...this.data.tournamentList, ...list],
                    hasMore: this.data.tournamentList.length + list.length < total,
                    loading: false
                })
            },
            fail: () => {
                this.setData({ loading: false })
                wx.showToast({
                    title: '加载失败',
                    icon: 'none'
                })
            }
        })
    },
    onReachBottom() {
        if (!this.data.loading && this.data.hasMore) {
            this.setData({
                page: this.data.page + 1
            })
            this.getTournamentList()
        }
    },
    onEditTournament(e) {
        const id = e.currentTarget.dataset.id
        wx.navigateTo({
            url: '/pages/tournament-detail/index?id=' + id
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
                            this.setData({
                                page: 1,
                                tournamentList: [],
                                hasMore: true
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
    onAddPlayer(e) {

        const id = e.currentTarget.dataset.id
        const type = e.currentTarget.dataset.type
        if (type == 'singles') {
          wx.navigateTo({
              url: '/pages/tournament-add-player/index?id=' + id
          })
        } else {
          wx.navigateTo({
            url: '/pages/tournament-add-players-doubles/index?id=' + id
        })
        }
        
    },
    onViewBrackets(e) {
        const id = e.currentTarget.dataset.id
        wx.navigateTo({
            url: '/pages/tournament-brackets/index?id=' + id
        })
    },
})
