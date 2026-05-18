const app = getApp()
const DEFAULT_AVATAR = '/images/icons/default-avatar.png'
const { syncTabBar } = require('../../utils/tab-bar')

Page({
	data: {
		userInfo: {
			avatarUrl: '',
			name: ''
		},
		isLogin: false,
		isAdmin: false,
		currentMemberId: '',
		totalPoints: 0
	},
	onLoad() {
		this.checkLogin()
	},
	onShow() {
		syncTabBar(this, '/pages/mine/index')
		this.checkLogin()
	},
	checkLogin() {
		// 尝试获取openid对应的会员信息
		wx.cloud.callFunction({
			name: 'members',
			data: { action: 'get' },
			success: res => {
				if (res.result && res.result.data && res.result.data.length > 0) {
					const user = res.result.data[0]
					this.setData({
						isLogin: true,
						isAdmin: user.admin || false,
						userInfo: {
							avatarUrl: user.avatarUrl || '',
							name: user.name || ''
						},
						currentMemberId: user._id
					})
					app.globalData.currentMember = user
					app.globalData.isAdmin = !!user.admin
					// 获取积分
					this.loadUserPoints(user._id)
				} else {
					this.setData({ isLogin: false, isAdmin: false, totalPoints: 0 })
					app.globalData.currentMember = null
					app.globalData.isAdmin = false
				}
			}
		})
	},
	// 获取用户积分
	async loadUserPoints(memberId) {
		if (!memberId) return

		try {
			const result = await wx.cloud.callFunction({
				name: 'match-results',
				data: {
					action: 'list',
					data: { playerId: memberId },
					page: 1,
					pageSize: 1000
				}
			})

			if (result.result && result.result.data) {
				// 计算总积分（统计用户所有参与的比赛，无论胜负和状态）
				let totalPoints = 0
				result.result.data.forEach(match => {
					// 将 winnerId 和 loserId 用 "," 分割成数组
					const winnerIds = (match.winnerId || '').split(',')
					const loserIds = (match.loserId || '').split(',')
					// 检查当前用户是否在获胜者中
					const isWinner = winnerIds.includes(memberId)
					// 检查当前用户是否在失败者中
					const isLoser = loserIds.includes(memberId)

					if (isWinner) {
						const winnerPoints = match.pointsAwarded && match.pointsAwarded.winner
						totalPoints += winnerPoints && winnerPoints.total != null ? winnerPoints.total : 0
					} else if (isLoser) {
						const loserPoints = match.pointsAwarded && match.pointsAwarded.loser
						totalPoints += loserPoints && loserPoints.total != null ? loserPoints.total : 0
					}
				})

				this.setData({ totalPoints })
			}
		} catch (err) {
			console.error('获取积分失败:', err)
		}
	},
	onLogin() {
		wx.showLoading({ title: '登录中...' })

		wx.cloud.callFunction({
			name: 'members',
			data: { action: 'get' },
			success: getRes => {
				wx.hideLoading()

				if (getRes.result && getRes.result.data && getRes.result.data.length > 0) {
					const user = getRes.result.data[0]
					this.setData({
						isLogin: true,
						isAdmin: user.admin || false,
						userInfo: {
							avatarUrl: user.avatarUrl || DEFAULT_AVATAR,
							name: user.name || '微信用户'
						},
						currentMemberId: user._id
					})
					app.globalData.currentMember = user
					app.globalData.isAdmin = !!user.admin
					this.loadUserPoints(user._id)
					wx.showToast({ title: '登录成功', icon: 'success' })
				} else {
					wx.navigateTo({ url: '/pages/edit-profile/index?mode=register' })
				}
			},
			fail: () => {
				wx.hideLoading()
				wx.showToast({ title: '登录失败', icon: 'error' })
			}
		})
	},
	onEditProfile() {
		wx.navigateTo({ url: '/pages/edit-profile/index' })
	},
	onManage() {
		wx.navigateTo({ url: '/pages/manage/index' })
	},
	onMyMatch() {
		wx.navigateTo({ url: '/pages/my-match/index' })
	},
	onSetting() {
		wx.navigateTo({ url: '/pages/setting/index' })
	},
})
