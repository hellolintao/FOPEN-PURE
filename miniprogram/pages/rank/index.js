Page({
  data: {
    pointsMap: {}, // 积分映射表
    rankList: [] // 排名列表
  },

  onLoad() {
    this.loadRankData()
  },

  // 加载排名数据
  async loadRankData() {
    wx.showLoading({ title: '加载中...' })

    try {
      // 步骤1: 调用云函数，获取所有比赛结果
      console.log('【步骤1】开始获取所有比赛记录...')
      const matchResultsRes = await wx.cloud.callFunction({
        name: 'match-results',
        data: {
          action: 'list',
          page: 1,
          pageSize: 1000
        }
      })

      const matchResults = matchResultsRes.result?.data || []
      console.log('【步骤1】比赛记录获取成功，共', matchResults.length, '条')
      console.log('【步骤1】比赛记录详情:', matchResults)

      // 步骤2: 计算每个用户的积分
      const pointsMap = this.calculatePointsMap(matchResults)
      console.log('【步骤2】用户积分映射表:', pointsMap)

      // 步骤3: 根据键名获取会员信息
      console.log('【步骤3】开始获取会员信息...')
      const memberIds = Object.keys(pointsMap)
      console.log('【步骤3】会员ID列表:', memberIds)

      // 调用云函数获取会员数据
      const membersRes = await wx.cloud.callFunction({
        name: 'members',
        data: {
          action: 'list'
        }
      })

      const allMembers = membersRes.result?.data || []
      console.log('【步骤3】所有会员数据:', allMembers)

      // 构建会员ID到信息的映射
      const memberMap = {}
      allMembers.forEach(member => {
        memberMap[member._id] = member
      })

      // 步骤4: 合并会员信息和积分数据
      console.log('【步骤4】开始合并数据...')
      const rankList = memberIds.map(id => {
        const memberInfo = memberMap[id] || {}
        const pointsInfo = pointsMap[id] || {}

        return {
          _id: id,
          avatarUrl: memberInfo.avatarUrl || '/images/icons/avatar.png',
          name: memberInfo.name || pointsInfo.name || '未知用户',
          totalPoints: pointsInfo.totalPoints || 0,
          winCount: pointsInfo.winCount || 0,
          lossCount: pointsInfo.lossCount || 0,
          totalGames: (pointsInfo.winCount || 0) + (pointsInfo.lossCount || 0)
        }
      })

      // 按积分降序排列
      rankList.sort((a, b) => b.totalPoints - a.totalPoints)

      console.log('【步骤4】排名列表:', rankList)

      this.setData({
        pointsMap,
        rankList
      })

    } catch (err) {
      console.error('加载排名数据失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
    } finally {
      wx.hideLoading()
    }
  },

  // 计算积分映射表
  calculatePointsMap(matchResults) {
    const pointsMap = {}

    matchResults.forEach(match => {
      // 将 winnerId 和 loserId 用 "," 分割成数组
      const winnerIds = (match.winnerId || '').split(',').filter(id => id)
      const loserIds = (match.loserId || '').split(',').filter(id => id)

      // 处理获胜者
      winnerIds.forEach(winnerId => {
        if (!pointsMap[winnerId]) {
          pointsMap[winnerId] = {
            name: match.winnerName || winnerId,
            totalPoints: 0,
            winCount: 0,
            lossCount: 0,
            matches: []
          }
        }
        pointsMap[winnerId].winCount += 1
        pointsMap[winnerId].totalPoints += match.pointsAwarded?.winner?.total || 0
        pointsMap[winnerId].matches.push({
          matchId: match._id,
          result: 'win',
          points: match.pointsAwarded?.winner?.total || 0,
          round: match.round,
          opponent: match.loserName || '未知'
        })
      })

      // 处理失败者
      loserIds.forEach(loserId => {
        if (!pointsMap[loserId]) {
          pointsMap[loserId] = {
            name: match.loserName || loserId,
            totalPoints: 0,
            winCount: 0,
            lossCount: 0,
            matches: []
          }
        }
        pointsMap[loserId].lossCount += 1
        pointsMap[loserId].totalPoints += match.pointsAwarded?.loser?.total || 0
        pointsMap[loserId].matches.push({
          matchId: match._id,
          result: 'loss',
          points: match.pointsAwarded?.loser?.total || 0,
          round: match.round,
          opponent: match.winnerName || '未知'
        })
      })
    })

    return pointsMap
  }
})
