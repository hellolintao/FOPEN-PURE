const app = getApp()
const DEFAULT_AVATAR = '/images/icons/default-avatar.png'
const { syncTabBar } = require('../../utils/tab-bar')
const { getCache, setCache, removeCachesByPrefix } = require('../../utils/page-cache')

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
	checkLogin() {
		const currentMember = app.globalData && app.globalData.currentMember
		if (currentMember && currentMember._id) {
			this.applyMember(currentMember, { defaultAvatar: '' })
			this.loadUserPoints(currentMember._id)
			return
		}
		// 尝试获取openid对应的会员信息
		wx.cloud.callFunction({
			name: 'members',
			data: { action: 'get' },
			success: res => {
				if (res.result && res.result.data && res.result.data.length > 0) {
					const user = res.result.data[0]
					this.applyMember(user, { defaultAvatar: '' })
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
		if (!options.skipProtocolPrompt) {
			this.promptProtocolUpdateIfNeeded(user)
		}
	},
	promptProtocolUpdateIfNeeded(member) {
		if (!member || !member._id || member.publicProfileConsent === true) return
		if (this.protocolPromptActive) return
		this.protocolPromptActive = true
		wx.showModal({
			title: '协议已更新',
			content: '隐私政策和用户协议已补充公开展示说明。同意后，你的昵称、头像、打法、报名状态、比赛成绩、积分和排行会在排行榜、球员详情、周星、H2H、近期比赛和赛事页向其他会员展示。',
			cancelText: '查看协议',
			confirmText: '同意',
			success: res => {
				this.protocolPromptActive = false
				if (res && res.confirm) {
					this.acceptUpdatedProtocol(member)
					return
				}
				wx.navigateTo({ url: '/pages/privacy-policy/index' })
			},
			fail: () => {
				this.protocolPromptActive = false
			}
		})
	},
	acceptUpdatedProtocol(member) {
		wx.showLoading({ title: '保存中...' })
		wx.cloud.callFunction({
			name: 'members',
			data: {
				action: 'update',
				data: { publicProfileConsent: true }
			},
			success: res => {
				wx.hideLoading()
				if (res.result && res.result.success === false) {
					wx.showToast({ title: '协议确认失败', icon: 'none' })
					return
				}
				const updatedMember = {
					...member,
					publicProfileConsent: true
				}
				this.applyMember(updatedMember, { skipProtocolPrompt: true })
				removeCachesByPrefix('rank:')
				wx.showToast({ title: '已同意协议', icon: 'success' })
			},
			fail: err => {
				console.error('[mine] accept protocol', err)
				wx.hideLoading()
				wx.showToast({ title: '协议确认失败', icon: 'none' })
			}
		})
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
	onLogin() {
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
