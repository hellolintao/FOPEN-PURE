Page({
	data: {
		userInfo: {
			avatarUrl: '',
			name: ''
		},
		isLogin: false
	},
	onLoad() {
		this.checkLogin()
	},
	onShow() {
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
						userInfo: {
							avatarUrl: user.avatarUrl || '',
							name: user.name || ''
						}
					})
				} else {
					this.setData({ isLogin: false })
				}
			}
		})
	},
	onLogin() {
		// 显示加载提示
		wx.showLoading({ title: '登录中...' })

		// 检查数据库是否有该openid会员
		wx.cloud.callFunction({
			name: 'members',
			data: { action: 'get' },
			success: getRes => {
				wx.hideLoading()

				if (getRes.result && getRes.result.data && getRes.result.data.length > 0) {
					// 已注册
					const user = getRes.result.data[0]
					this.setData({
						isLogin: true,
						userInfo: {
							avatarUrl: user.avatarUrl || 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCsl1PaL2XUIPcnYgicQ/132',
							name: user.name || '微信用户'
						}
					})
					wx.showToast({ title: '登录成功', icon: 'success' })
				} else {
					// 未注册，注册会员（使用默认信息）
					wx.cloud.callFunction({
						name: 'members',
						data: {
							action: 'add',
							data: {
								name: '微信用户',
								avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCsl1PaL2XUIPcnYgicQ/132'
							}
						},
						success: addRes => {
							this.setData({
								isLogin: true,
								userInfo: {
									avatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCsl1PaL2XUIPcnYgicQ/132',
									name: '微信用户'
								}
							})
							wx.showToast({ title: '注册成功', icon: 'success' })
							// 跳转到编辑资料页面
							setTimeout(() => {
								wx.navigateTo({ url: '/pages/edit-profile/index' })
							}, 1000)
						},
						fail: () => {
							wx.showToast({ title: '注册失败', icon: 'error' })
						}
					})
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
		wx.showToast({ title: '我的比赛', icon: 'none' })
	},
	onSetting() {
		wx.navigateTo({ url: '/pages/setting/index' })
	},
})