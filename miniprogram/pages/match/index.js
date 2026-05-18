const db = wx.cloud.database()
const { syncTabBar } = require('../../utils/tab-bar')

Page({
	data: {
		tournaments: []
	},
	onLoad() {
		this.loadTournaments()
	},
	onShow() {
		syncTabBar(this, '/pages/match/index')
		this.loadTournaments()
	},
	async loadTournaments() {
		try {
			const result = await db.collection('tournaments').get()
			this.setData({ tournaments: result.data || [] })
		} catch (err) {
			console.error('获取赛事失败:', err)
		}
	},
	onItemTap(e) {
		const { id } = e.currentTarget.dataset
		wx.navigateTo({
			url: `/pages/tournament-view/index?id=${id}`
		})
	}
})
