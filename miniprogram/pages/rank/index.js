Page({
	data: {
		rankList: [],
		rankType: 'single' // 默认单打
	},
	onLoad() {
		this.loadCacheAndFetch()
	},
	loadCacheAndFetch() {
		// 先读本地缓存
		const cacheKey = 'rankList_' + this.data.rankType
		const cache = wx.getStorageSync(cacheKey)
		if (cache && Array.isArray(cache)) {
			this.setData({ rankList: cache })
		}
		// 再请求云端数据
		this.getRankList()
	},
	getRankList() {
		const cacheKey = 'rankList_' + this.data.rankType
		wx.cloud.callFunction({
			name: 'members',
			data: {
				action: 'getRank',
				type: this.data.rankType
			},
			success: res => {
				const list = res.result.data || []
				this.setData({ rankList: list })
				wx.setStorageSync(cacheKey, list)
			}
		})
	},
	onTabChange(e) {
		const type = e.currentTarget.dataset.type
		if (type !== this.data.rankType) {
			this.setData({ rankType: type }, () => {
				this.loadCacheAndFetch()
			})
		}
	}
})