const app = getApp()
const DEFAULT_AVATAR = '/images/icons/default-avatar.png'
const { syncTabBar } = require('../../utils/tab-bar')
const { getCache, setCache } = require('../../utils/page-cache')

const MINE_POINTS_CACHE_TTL_MS = 2 * 60 * 1000

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
	async checkLogin() {
		const currentMember = app.globalData && app.globalData.currentMember
		if (currentMember && currentMember._id) {
			this.applyMember(currentMember, { defaultAvatar: '' })
			this.loadUserPoints(currentMember._id)
			return currentMember
		}
		const restoredMember = await this.restoreIdentity()
		if (restoredMember && restoredMember._id) {
			this.applyMember(restoredMember, { defaultAvatar: '' })
			this.loadUserPoints(restoredMember._id)
			return restoredMember
		}
		this.clearLoginState()
		return null
	},
	async restoreIdentity() {
		if (!app || typeof app.refreshIdentity !== 'function') return null
		if (!this.identityRestorePromise) {
			const ready = app.identityReady && typeof app.identityReady.then === 'function'
				? app.identityReady
				: app.refreshIdentity()
			this.identityRestorePromise = ready
		}
		try {
			const member = await this.identityRestorePromise
			return member || (app.globalData && app.globalData.currentMember) || null
		} finally {
			this.identityRestorePromise = null
		}
	},
	clearLoginState() {
		this.setData({ isLogin: false, isAdmin: false, totalPoints: 0 })
		app.globalData.currentMember = null
		app.globalData.isAdmin = false
	},
	applyMember(user, options = {}) {
		this.setData({
			isLogin: true,
			isAdmin: user.admin || false,
			userInfo: {
				avatarUrl: user.avatarUrl || options.defaultAvatar || '',
				name: user.name || ''
			},
			currentMemberId: user._id
		})
		app.globalData.currentMember = user
		app.globalData.isAdmin = !!user.admin
	},
	// 获取用户积分
	async loadUserPoints(memberId) {
		if (!memberId) return
		const cached = getCache(this._pointsCacheKey(memberId))
		if (cached && typeof cached.totalPoints === 'number') {
			this.setData({ totalPoints: cached.totalPoints })
			return
		}

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
				setCache(this._pointsCacheKey(memberId), { totalPoints }, { ttlMs: MINE_POINTS_CACHE_TTL_MS })
			}
		} catch (err) {
			console.error('获取积分失败:', err)
		}
	},
	_pointsCacheKey(memberId) {
		return `mine:points:v1:${memberId}`
	},
	ensureOfficialPrivacyAuthorization(done) {
		if (typeof wx.requirePrivacyAuthorize !== 'function') {
			done(true)
			return
		}

		wx.requirePrivacyAuthorize({
			success: () => done(true),
			fail: () => {
				wx.showToast({ title: '请先同意微信隐私授权', icon: 'none' })
				done(false)
			}
		})
	},
	onLogin() {
		this.ensureOfficialPrivacyAuthorization(authorized => {
			if (!authorized) return

			wx.showLoading({ title: '登录中...' })

			wx.cloud.callFunction({
				name: 'members',
				data: { action: 'get' },
				success: getRes => {
					wx.hideLoading()

					if (getRes.result && getRes.result.data && getRes.result.data.length > 0) {
						const user = getRes.result.data[0]
						const member = user.name ? user : { ...user, name: '微信用户' }
						this.applyMember(member, { defaultAvatar: DEFAULT_AVATAR })
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
	onOpenPrivacyPolicy() {
		wx.navigateTo({ url: '/pages/privacy-policy/index' })
	},
	onOpenUserAgreement() {
		wx.navigateTo({ url: '/pages/user-agreement/index' })
	},
})
