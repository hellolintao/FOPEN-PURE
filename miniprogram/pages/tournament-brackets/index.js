Page({
  data: {
    tournamentId: '',
    tournament: null,
    schedulePlan: null,
    r1Matches: [],
    laterRounds: [],   // [{ round, matches }]
    freePlays: [],
    loading: false,
    scheduleGateBlocked: false,
    scheduleGateMessage: '',
    decoratedCourts: [],  // schedulePlan.courts each annotated with [r1 matches that map to it] + [freePlays that map to it]
    tabs: [{ key: 'group', label: '小组赛' }, { key: 'knockout', label: '淘汰赛' }],
    activeTab: 'group',
    groupKnockout: null,
    arrangeGroups: [],
    arrangeErrors: []
  },

  onLoad({ id, mode } = {}) {
    const patch = {}
    if (id) patch.tournamentId = id
    if (mode === 'arrange') patch.activeTab = 'group'
    if (Object.keys(patch).length) this.setData(patch)
    if (id) {
      this.refresh()
    }
  },

  onShow() {
    if (this.data.tournamentId) this.refresh()
  },

  async refresh() {
    this.setData({ loading: true, scheduleGateBlocked: false, scheduleGateMessage: '' })
    try {
      const tRes = await wx.cloud.callFunction({
        name: 'tournaments', data: { action: 'get', id: this.data.tournamentId }
      })
      const tournament = tRes.result && tRes.result.data
      if (isScheduleBlocked(tournament)) {
        this.setData({
          tournament,
          schedulePlan: (tournament && tournament.schedulePlan) || null,
          r1Matches: [],
          laterRounds: [],
          freePlays: [],
          decoratedCourts: [],
          scheduleGateBlocked: true,
          scheduleGateMessage: '赛程发布后才能查看对阵'
        })
        return
      }
      if (tournament && tournament.format === 'group_knockout') {
        await this.refreshGroupKnockout(tournament)
        return
      }

      const bRes = await wx.cloud.callFunction({
        name: 'tournament-brackets', data: { action: 'getByTournament', tournamentId: this.data.tournamentId }
      })
      const allBrackets = ((bRes.result && bRes.result.data) || []).map(bracket => ({
        ...bracket,
        matches: (bracket.matches || []).map(match => ({
          ...match,
          __player1Name: playerLabel(match.player1),
          __player2Name: playerLabel(match.player2)
        }))
      }))
      const r1Bracket = allBrackets.find(b => b.round === 1)
      const r1Matches = (r1Bracket && r1Bracket.matches) || []
      const laterRounds = allBrackets
        .filter(b => b.round > 1)
        .sort((a, b) => a.round - b.round)
        .map(b => ({ round: b.round, matches: b.matches || [] }))

      const fpRes = await wx.cloud.callFunction({
        name: 'free-plays', data: { action: 'list', tournamentId: this.data.tournamentId }
      })
      const freePlays = (fpRes.result && fpRes.result.success && fpRes.result.data && fpRes.result.data.items) || []

      const schedulePlan = (tournament && tournament.schedulePlan) || null
      const decoratedCourts = this._decorate(schedulePlan, r1Matches, freePlays)

      this.setData({
        tournament,
        schedulePlan,
        r1Matches,
        laterRounds,
        freePlays,
        decoratedCourts
      })
    } catch (e) {
      console.error('tournament-brackets refresh', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async refreshGroupKnockout(tournament) {
    const res = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'getGroupKnockoutBracket', tournamentId: this.data.tournamentId }
    })
    const payload = (res.result && res.result.success && res.result.data) || emptyGroupKnockoutPayload()
    this.setData({
      tournament,
      schedulePlan: null,
      groupKnockout: decorateGroupKnockout(payload),
      arrangeGroups: buildArrangeGroups(payload.groups, tournament.bracketSize),
      arrangeErrors: [],
      r1Matches: [],
      laterRounds: [],
      freePlays: [],
      decoratedCourts: [],
      scheduleGateBlocked: false,
      scheduleGateMessage: ''
    })
  },

  onTabTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key
    if (key) this.setData({ activeTab: key })
  },

  async onGenerateGroupMatches() {
    try {
      const save = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: { action: 'saveGroups', tournamentId: this.data.tournamentId, groups: this.data.arrangeGroups }
      })
      if (!(save.result && save.result.success)) {
        this.setData({ arrangeErrors: resultErrors(save.result, '保存分组失败') })
        return
      }

      const generated = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: { action: 'generateGroupMatches', tournamentId: this.data.tournamentId }
      })
      if (!(generated.result && generated.result.success)) {
        this.setData({ arrangeErrors: resultErrors(generated.result, '生成小组赛失败') })
        return
      }

      wx.showToast({ title: '已生成小组赛', icon: 'success' })
      await this.refresh()
    } catch (e) {
      console.error('group knockout generate matches', e)
      this.setData({ arrangeErrors: ['生成小组赛失败'] })
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

  onEditSchedule() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}&step=3&mode=edit-schedule` })
  }
})

function playerLabel(player) {
  if (!player) return '待定'
  if (player.name) return player.partnerName ? `${player.name} / ${player.partnerName}` : player.name
  if (player.playerName) return player.playerName
  return '待定'
}

function isScheduleBlocked(tournament) {
  return !!(
    tournament &&
    tournament.format !== 'group_knockout' &&
    Object.prototype.hasOwnProperty.call(tournament, 'scheduleStatus') &&
    tournament.scheduleStatus !== 'published'
  )
}

function emptyGroupKnockoutPayload() {
  return { groups: [], groupBrackets: [], knockoutBrackets: [], standings: {} }
}

function buildArrangeGroups(groups, bracketSize) {
  const slotCount = Number(bracketSize) === 12 ? 3 : 4
  const byCode = {}
  ;(groups || []).forEach(group => {
    if (group && group.groupCode) byCode[group.groupCode] = group
  })

  return ['A', 'B', 'C', 'D'].map(groupCode => {
    const sourceSlots = (byCode[groupCode] && byCode[groupCode].slots) || []
    const slots = []
    for (let i = 0; i < slotCount; i += 1) {
      const slotNo = i + 1
      const existing = sourceSlots.find(slot => Number(slot.slotNo) === slotNo)
      slots.push(existing || { slotNo, playerId: '', playerName: '' })
    }
    return { groupCode, slots }
  })
}

function decorateGroupKnockout(payload) {
  const safe = payload || emptyGroupKnockoutPayload()
  return {
    ...safe,
    groups: safe.groups || [],
    standings: safe.standings || {},
    groupBrackets: (safe.groupBrackets || []).map(bracket => ({
      ...bracket,
      matches: decorateMatches(bracket.matches)
    })),
    knockoutBrackets: (safe.knockoutBrackets || []).map(bracket => ({
      ...bracket,
      matches: decorateMatches(bracket.matches)
    }))
  }
}

function decorateMatches(matches) {
  return (matches || []).map(match => ({
    ...match,
    __player1Name: playerLabel(match.player1),
    __player2Name: playerLabel(match.player2)
  }))
}

function resultErrors(result, fallback) {
  const error = result && result.error
  if (error && Array.isArray(error.errors) && error.errors.length) return error.errors
  if (error && error.message) return [error.message]
  if (result && result.message) return [result.message]
  return [fallback]
}
