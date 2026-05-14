Page({
  data: {
    tournamentId: '',
    tournament: null,
    seasonName: '',
    registrations: [],
    brackets: [],
    tournamentDisplay: null,
    decoratedCourts: [],
    loading: true
  },

  onLoad(options) {
    const { id } = options
    if (id) {
      this.setData({ tournamentId: id })
      this.loadTournamentDetail()
    }
  },

  async loadTournamentDetail() {
    try {
      this.setData({ loading: true })

      // 1. 获取赛事详情（通过云函数）
      const tournamentRes = await wx.cloud.callFunction({
        name: 'tournaments',
        data: {
          action: 'get',
          id: this.data.tournamentId
        }
      })

      if (!tournamentRes.result || !tournamentRes.result.data) {
        wx.showToast({
          title: '赛事不存在',
          icon: 'none'
        })
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
        return
      }

      const tournament = tournamentRes.result.data

      // 2. 获取赛季名称（通过云函数）
      let seasonName = '未设置'
      if (tournament.seasonId) {
        const seasonRes = await wx.cloud.callFunction({
          name: 'seasons',
          data: {
            action: 'get',
            id: tournament.seasonId
          }
        })

        if (seasonRes.result && seasonRes.result.data) {
          seasonName = seasonRes.result.data.name
        }
      }

      // 3. 获取参赛人员（通过云函数）
      const registrationRes = await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: {
          action: 'list',
          tournamentId: this.data.tournamentId,
          page: 1,
          pageSize: 1000
        }
      })

      const registrations = (registrationRes.result && registrationRes.result.data) || []

      // 4. 获取对位信息（通过云函数）
      const bracketsRes = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByTournament',
          tournamentId: this.data.tournamentId
        }
      })

      const brackets = ((bracketsRes.result && bracketsRes.result.data) || []).map(bracket => ({
        ...bracket,
        matches: (bracket.matches || []).map(match => ({
          ...match,
          __player1Name: playerLabel(match.player1),
          __player2Name: playerLabel(match.player2)
        }))
      }))

      // 5. 获取自由拉球记录（通过云函数）
      let freePlays = []
      try {
        const fpRes = await wx.cloud.callFunction({
          name: 'free-plays',
          data: { action: 'list', tournamentId: this.data.tournamentId }
        })
        freePlays = (fpRes.result && fpRes.result.success && fpRes.result.data && fpRes.result.data.items) || []
      } catch (fpErr) {
        console.warn('加载自由拉球失败:', fpErr)
      }

      // 6. 按 schedulePlan.courts 分组首轮比赛
      const r1Bracket = brackets.find(b => b.round === 1)
      const r1Matches = (r1Bracket && r1Bracket.matches) || []
      const decoratedCourts = this._decorate(tournament.schedulePlan, r1Matches, freePlays)

      this.setData({
        tournament,
        tournamentDisplay: buildTournamentDisplay(tournament, brackets),
        seasonName,
        registrations,
        brackets,
        decoratedCourts,
        loading: false
      })
    } catch (err) {
      console.error('加载赛事详情失败:', err)
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      })
      this.setData({ loading: false })
    }
  },

  _decorate(schedulePlan, r1Matches, freePlays) {
    if (!schedulePlan || !Array.isArray(schedulePlan.courts)) return []
    return schedulePlan.courts.map(c => ({
      ...c,
      matches: r1Matches.filter(m => m.courtId === c.courtId),
      freePlays: freePlays.filter(fp => fp.courtId === c.courtId),
      slotCount: (c.slots || []).length
    }))
  },

  onViewRoundSettlement() {
    if (this.data.tournamentId) {
      wx.navigateTo({
        url: `/pages/round-settlement/index?tournamentId=${this.data.tournamentId}`
      })
    }
  }
})

function buildTournamentDisplay(tournament, brackets) {
  const config = tournament.config || {}
  const pointsRules = tournament.pointsRules || {}
  const placement = pointsRules.placement || {}
  const winLoss = pointsRules.winLoss || {}
  const legacyBonus = pointsRules.bonusByRound || {}
  const placementRows = [
    { label: '冠军', value: placement.champion },
    { label: '亚军', value: placement.runnerUp },
    { label: '四强', value: placement.semifinal },
    { label: '八强', value: placement.quarterfinal },
    { label: '参赛', value: placement.participation }
  ].filter(row => row.value !== undefined)
  const bonusRows = [1, 2, 3, 4, 5]
    .filter(round => legacyBonus[round] !== undefined || legacyBonus[String(round)] !== undefined)
    .map(round => ({
      label: `第${round}轮`,
      value: legacyBonus[round] !== undefined ? legacyBonus[round] : legacyBonus[String(round)]
    }))

  return {
    maxPlayers: tournament.maxPlayers || config.maxPlayers || '-',
    playersPerMatch: config.playersPerMatch || (tournament.type === 'doubles' ? 4 : 2),
    totalRounds: config.totalRounds || (brackets || []).length || '-',
    currentRound: config.currentRound || 1,
    formatText: tournament.format === 'knockout' ? '淘汰赛' : '常规赛',
    pointsMode: placementRows.length > 0 ? 'placement' : (winLoss.win !== undefined || winLoss.loss !== undefined ? 'winLoss' : 'legacy'),
    win: winLoss.win !== undefined ? winLoss.win : pointsRules.win,
    loss: winLoss.loss !== undefined ? winLoss.loss : pointsRules.loss,
    walkover: pointsRules.walkover,
    placementRows,
    bonusRows
  }
}

function playerLabel(player) {
  if (!player) return '待定'
  if (player.name) return player.partnerName ? `${player.name} / ${player.partnerName}` : player.name
  return '待定'
}
