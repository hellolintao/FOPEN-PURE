Page({
	data: {
		isLogin: false,
		userInfo: {
			avatarUrl: '',
			name: '',
			level: 0,
			winRate: 0,
			score: 0,
			status: '',
			intro: ''
		}
	},
	onLoad() {
		// 这里可以根据实际业务判断是否已登录，并拉取用户信息
		// 示例：this.getUserInfo()
	},
	onLogin() {
    console.log('onl;ognge')
		wx.getUserProfile({
			desc: '用于完善会员资料',
			success: res => {
				const wxUser = res.userInfo;
				// 用 openid 精确查找会员
				wx.cloud.callFunction({
					name: 'members',
					data: {
						action: 'search',
						byOpenid: true
					},
					success: searchRes => {
						if (searchRes.result && searchRes.result.data && searchRes.result.data.length > 0) {
							// 已注册，展示会员信息
							const member = searchRes.result.data[0];
							this.setData({
								isLogin: true,
								userInfo: {
									avatarUrl: member.avatarUrl || wxUser.avatarUrl,
									name: member.name,
									level: member.level || 0,
									winRate: member.winRate || 0,
									score: member.score || 0,
									status: member.status || '',
									intro: member.intro || ''
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
											name: wxUser.nickName,
											level: 0,
											winRate: 0,
											score: 0,
											status: '',
											intro: ''
										}
									})
								}
							})
						}
					}
				})
			}
		})
	}
})