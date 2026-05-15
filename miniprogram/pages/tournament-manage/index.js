const app = getApp()

Page({
    data: {
        drafts: [],
        submittedQueue: [],
        tournamentList: [],
        page: 1,
        pageSize: 10,
        loading: false,
        hasMore: true,
        isAdmin: false
    },

    onLoad() {
        this.refresh()
    },

    onShow() {
        this.setData({ isAdmin: !!(app.globalData && app.globalData.isAdmin) })
        this.refresh()
    },

    async refresh() {
        this.setData({ page: 1, tournamentList: [], drafts: [], submittedQueue: [], hasMore: true })
        await Promise.all([this.loadDrafts(), this.loadSubmittedQueue(), this.loadPublic()])
    },

    async loadSubmittedQueue() {
        if (!this.data.isAdmin) {
            this.setData({ submittedQueue: [] })
            return
        }
        try {
            const r = await wx.cloud.callFunction({
                name: 'match-results',
                data: { action: 'submittedQueue' }
            })
            const items = (r.result && r.result.success && r.result.data && r.result.data.items) || []
            this.setData({ submittedQueue: items })
        } catch (e) {
            console.error('loadSubmittedQueue', e)
        }
    },

    onOpenScore(e) {
        const tid = e.currentTarget.dataset.id
        wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${tid}` })
    },

    async loadDrafts() {
        const me = app.globalData && app.globalData.currentMember
        if (!me || !me._id) {
            this.setData({ drafts: [] })
            return
        }
        try {
            const r = await wx.cloud.callFunction({
                name: 'tournaments',
                data: { action: 'list', status: 'draft', createdBy: me._id, pageSize: 50 }
            })
            const drafts = (r.result && r.result.success && r.result.data && r.result.data.tournaments) || []
            this.setData({ drafts })
        } catch (e) {
            console.error('loadDrafts', e)
        }
    },

    async loadPublic() {
        if (this.data.loading || !this.data.hasMore) return
        this.setData({ loading: true })
        try {
            const r = await wx.cloud.callFunction({
                name: 'tournaments',
                data: {
                    action: 'list',
                    statusNot: 'draft',
                    page: this.data.page,
                    pageSize: this.data.pageSize
                }
            })
            const list = (r.result && r.result.data && r.result.data.tournaments) || []
            const total = (r.result && r.result.data && r.result.data.total) || 0
            const tournamentList = this.data.page === 1 ? list : [...this.data.tournamentList, ...list]
            this.setData({
                tournamentList,
                hasMore: tournamentList.length < total,
                loading: false
            })
        } catch (e) {
            console.error('loadPublic', e)
            this.setData({ loading: false })
            wx.showToast({ title: '加载失败', icon: 'none' })
        }
    },

    onReachBottom() {
        if (!this.data.loading && this.data.hasMore) {
            this.setData({ page: this.data.page + 1 })
            this.loadPublic()
        }
    },

    onResumeDraft(e) {
        const id = e.currentTarget.dataset.id
        wx.navigateTo({ url: `/pages/tournament-edit/index?id=${id}` })
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
                            this.loadPublic()
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

    onLogin() {
        wx.switchTab({ url: '/pages/mine/index' })
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
