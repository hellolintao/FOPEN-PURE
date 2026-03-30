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
		wx.getUserProfile({
			desc: '用于完善会员资料',
			success: res => {
				const wxUser = res.userInfo
				// 检查数据库是否有该openid会员
				wx.cloud.callFunction({
					name: 'members',
					data: { action: 'get' },
					success: getRes => {
						if (getRes.result && getRes.result.data && getRes.result.data.length > 0) {
							// 已注册
							const user = getRes.result.data[0]
							this.setData({
								isLogin: true,
								userInfo: {
									avatarUrl: user.avatarUrl || wxUser.avatarUrl,
									name: user.name || wxUser.nickName
								}
							})
						} else {
							// 未注册，注册会员
							wx.cloud.callFunction({
								name: 'members',
								data: {
									action: 'add',
									data: {
										name: wxUser.nickName,
										avatarUrl: wxUser.avatarUrl
									}
								},
								success: addRes => {
									this.setData({
										isLogin: true,
										userInfo: {
											avatarUrl: wxUser.avatarUrl,
											name: wxUser.nickName
										}
									})
								}
							})
						}
					}
				})
			}
		})
	},
	onEditProfile() {
		wx.showToast({ title: '编辑资料', icon: 'none' })
	},
	onMyMatch() {
		wx.showToast({ title: '我的比赛', icon: 'none' })
	},
	onSetting() {
		wx.showToast({ title: '设置', icon: 'none' })
	}
})