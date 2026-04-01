const db = wx.cloud.database()

Page({
	data: {
		rankList: []
	},
	onLoad() {
		this.calculateRank()
	},
	async calculateRank() {
		try {
			console.log('开始计算排名')

			// 1. 获取所有比赛结果
			const matchResultsRes = await db.collection('match_results')
				.where({
					type: 'singles'
				})
				.get()

			console.log('比赛结果数量:', matchResultsRes.data.length)

			// 2. 获取所有赛事（用于获取积分规则）
			const tournamentsRes = await db.collection('tournaments').get()
			const tournaments = tournamentsRes.data || []

			// 3. 计算每个选手的积分
			const playerPoints = {}

			matchResultsRes.data.forEach(match => {
				// 找到对应的赛事积分规则
				const tournament = tournaments.find(t => t._id === match.tournamentId)
				if (!tournament || !tournament.pointsRules) return

				const { win, loss, walkover, bonusByRound } = tournament.pointsRules

				// 胜者积分
				if (match.winnerId) {
					if (!playerPoints[match.winnerId]) {
						playerPoints[match.winnerId] = 0
					}
					playerPoints[match.winnerId] += win || 0

					// 轮次奖励积分
					if (bonusByRound && bonusByRound[String(match.round)]) {
						playerPoints[match.winnerId] += bonusByRound[String(match.round)]
					}
				}

				// 败者积分
				if (match.loserId) {
					if (!playerPoints[match.loserId]) {
						playerPoints[match.loserId] = 0
					}
					playerPoints[match.loserId] += loss || 0
				}
			})

			console.log('积分统计:', playerPoints)

			// 4. 获取有积分的选手信息
			const memberIds = Object.keys(playerPoints)
			let members = []

			if (memberIds.length > 0) {
				// 使用 where 查询只获取有积分的选手
				const membersRes = await db.collection('members')
					.where({
						_id: db.command.in(memberIds)
					})
					.get()
				members = membersRes.data || []
			}

			// 5. 合并信息和积分
			const rankList = members.map(member => {
				return {
					...member,
					points: playerPoints[member._id] || 0
				}
			})

			// 6. 按积分降序排列
			rankList.sort((a, b) => b.points - a.points)

			console.log('排名结果:', rankList)

			this.setData({ rankList })

		} catch (err) {
			console.error('计算排名失败:', err)
		}
	}
})