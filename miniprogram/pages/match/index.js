const db = wx.cloud.database()

Page({
	data: {
		tournaments: []
	},
	onLoad() {
		this.loadTournaments()
	},
	async loadTournaments() {
		try {
			const result = await db.collection('tournaments').get()
			console.log('赛事列表:', result.data)
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