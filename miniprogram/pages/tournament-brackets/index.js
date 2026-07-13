const {
  canWriteGroupKnockoutScores,
  resolveGroupKnockoutPhase
} = require('../../utils/tournament-status')

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
    groupKnockout: emptyGroupKnockoutPayload(),
    arrangeGroups: [],
    arrangeErrors: [],
    registrationCandidates: [],
    arrangePicker: emptyArrangePicker(),
    showGroupScoreEntry: false,
    effectiveGroupKnockoutPhase: 'group_draft',
    groupKnockoutReadOnly: false,
    groupScoreActionLabel: '录入小组赛赛果'
  },

  onLoad({ id, mode } = {}) {
    const patch = {}
    if (id) patch.tournamentId = id
    if (mode === 'arrange') patch.activeTab = 'group'
    if (Object.keys(patch).length) this.setData(patch)
    if (id) {
      return this.refresh()
    }
    return undefined
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
          scheduleGateMessage: '赛程发布后才能查看对阵',
          showGroupScoreEntry: false
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
        decoratedCourts,
        showGroupScoreEntry: false
      })
    } catch (e) {
      console.error('tournament-brackets refresh', e)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async refreshGroupKnockout(tournament) {
    const [res, regRes, resultRes] = await Promise.all([
      wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: { action: 'getGroupKnockoutBracket', tournamentId: this.data.tournamentId }
      }),
      wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'list', tournamentId: this.data.tournamentId, pageSize: 200 }
      }).catch(() => ({ result: { success: false, data: [] } })),
      wx.cloud.callFunction({
        name: 'match-results',
        data: { action: 'listByTournament', tournamentId: this.data.tournamentId }
      }).catch(() => ({ result: { success: false, data: { results: [] } } }))
    ])
    const payload = (res.result && res.result.success && res.result.data) || emptyGroupKnockoutPayload()
    const registrationCandidates = buildRegistrationCandidates(regRes.result && regRes.result.data)
    const matchResults = extractMatchResults(resultRes)
    this.setData({
      tournament,
      schedulePlan: null,
      groupKnockout: decorateGroupKnockout(payload, matchResults),
      arrangeGroups: buildArrangeGroups(payload.groups, tournament.bracketSize),
      arrangeErrors: [],
      registrationCandidates,
      arrangePicker: emptyArrangePicker(),
      r1Matches: [],
      laterRounds: [],
      freePlays: [],
      decoratedCourts: [],
      scheduleGateBlocked: false,
      scheduleGateMessage: '',
      effectiveGroupKnockoutPhase: resolveGroupKnockoutPhase(tournament),
      groupKnockoutReadOnly: tournament.status === 'cancelled',
      showGroupScoreEntry: shouldShowGroupScoreEntry(tournament),
      groupScoreActionLabel: groupScoreActionLabel(tournament)
    })
  },

  onTabTap(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key
    if (key) this.setData({ activeTab: key })
  },

  onArrangeGroupTap(e) {
    if (this._blockGroupKnockoutWrite()) return
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const groupIndex = Number(dataset.groupIndex)
    const group = this.data.arrangeGroups[groupIndex]
    if (!group || !Array.isArray(group.slots)) return

    const selectedIds = group.slots.map(slot => slot.playerId).filter(Boolean)
    const members = buildArrangePickerMembers(
      this.data.registrationCandidates,
      this.data.arrangeGroups,
      selectedIds
    )
    const maxSelect = group.slots.length
    this.setData({
      arrangePicker: {
        show: true,
        title: `${group.groupCode}组 选择${maxSelect}位球员`,
        members,
        selectedId: '',
        selectedIds,
        maxSelect,
        ctx: { mode: 'group', groupIndex }
      }
    })
  },

  onArrangeSlotTap(e) {
    if (this._blockGroupKnockoutWrite()) return
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const groupIndex = Number(dataset.groupIndex)
    const slotIndex = Number(dataset.slotIndex)
    const group = this.data.arrangeGroups[groupIndex]
    const slot = group && group.slots && group.slots[slotIndex]
    if (!group || !slot) return

    const members = buildArrangePickerMembers(
      this.data.registrationCandidates,
      this.data.arrangeGroups,
      slot.playerId
    )
    this.setData({
      arrangePicker: {
        show: true,
        title: `${group.groupCode}${slot.slotNo} 选择球员`,
        members,
        selectedId: slot.playerId || '',
        ctx: { groupIndex, slotIndex }
      }
    })
  },

  onArrangePickerSelect(e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
    if (!id) return
    const picker = this.data.arrangePicker || emptyArrangePicker()
    if (picker.maxSelect) {
      const selectedIds = picker.selectedIds || []
      const isSelected = selectedIds.includes(id)
      let nextSelectedIds
      if (isSelected) {
        nextSelectedIds = selectedIds.filter(selectedId => selectedId !== id)
      } else {
        if (selectedIds.length >= picker.maxSelect) {
          wx.showToast({ title: `本组最多 ${picker.maxSelect} 位`, icon: 'none' })
          return
        }
        nextSelectedIds = selectedIds.concat(id)
      }
      this.setData({
        arrangePicker: {
          ...picker,
          selectedIds: nextSelectedIds,
          members: markMultiSelected(picker.members, nextSelectedIds)
        }
      })
      return
    }

    this.setData({
      arrangePicker: {
        ...picker,
        selectedId: id,
        members: markSelected(picker.members, id)
      }
    })
  },

  onArrangePickerConfirm() {
    if (this._blockGroupKnockoutWrite()) return
    const picker = this.data.arrangePicker || emptyArrangePicker()
    const ctx = picker.ctx
    if (ctx && ctx.mode === 'group') {
      const selectedIds = picker.selectedIds || []
      const maxSelect = picker.maxSelect || selectedIds.length
      if (selectedIds.length !== maxSelect) {
        wx.showToast({ title: `请选择 ${maxSelect} 位球员`, icon: 'none' })
        return
      }
      const picked = selectedIds.map(id => this.data.registrationCandidates.find(candidate => candidate._id === id))
      if (picked.some(candidate => !candidate)) {
        wx.showToast({ title: '球员信息缺失', icon: 'none' })
        return
      }

      const arrangeGroups = cloneArrangeGroups(this.data.arrangeGroups)
      const group = arrangeGroups[ctx.groupIndex]
      if (!group || !Array.isArray(group.slots)) return
      group.slots = group.slots.map((slot, index) => ({
        ...slot,
        playerId: picked[index]._id,
        playerName: picked[index].name,
        registrationId: picked[index].registrationId || ''
      }))
      this.setData({
        arrangeGroups,
        arrangeErrors: [],
        arrangePicker: emptyArrangePicker()
      })
      return
    }

    if (!ctx || !picker.selectedId) {
      wx.showToast({ title: '请选择球员', icon: 'none' })
      return
    }
    const picked = this.data.registrationCandidates.find(candidate => candidate._id === picker.selectedId)
    if (!picked) {
      wx.showToast({ title: '球员信息缺失', icon: 'none' })
      return
    }

    const arrangeGroups = cloneArrangeGroups(this.data.arrangeGroups)
    const group = arrangeGroups[ctx.groupIndex]
    const slot = group && group.slots && group.slots[ctx.slotIndex]
    if (!slot) return
    group.slots[ctx.slotIndex] = {
      ...slot,
      playerId: picked._id,
      playerName: picked.name,
      registrationId: picked.registrationId || ''
    }
    this.setData({
      arrangeGroups,
      arrangeErrors: [],
      arrangePicker: emptyArrangePicker()
    })
  },

  onArrangePickerCancel() {
    this.setData({ arrangePicker: emptyArrangePicker() })
  },

  onArrangePickerSheetTap() {
    // Prevent mask taps from closing the sheet when tapping inside it.
  },

  onClearArrangeSlot(e) {
    if (this._blockGroupKnockoutWrite()) return
    const dataset = (e && e.currentTarget && e.currentTarget.dataset) || {}
    const groupIndex = Number(dataset.groupIndex)
    const slotIndex = Number(dataset.slotIndex)
    const arrangeGroups = cloneArrangeGroups(this.data.arrangeGroups)
    const group = arrangeGroups[groupIndex]
    const slot = group && group.slots && group.slots[slotIndex]
    if (!slot) return
    group.slots[slotIndex] = { slotNo: slot.slotNo, playerId: '', playerName: '' }
    this.setData({ arrangeGroups, arrangeErrors: [] })
  },

  async onGenerateGroupMatches() {
    if (this._blockGroupKnockoutWrite()) return
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
  },

  onEnterScore() {
    if (this._blockGroupKnockoutWrite()) return
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}` })
  },

  onMatchScoreTap(e) {
    if (this._blockGroupKnockoutWrite()) return
    const matchId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.matchId
    if (!matchId) return
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}&matchId=${matchId}` })
  },

  _blockGroupKnockoutWrite() {
    if (!this.data.groupKnockoutReadOnly) return false
    wx.showToast({ title: '赛事已取消，仅可查看历史', icon: 'none' })
    return true
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

function shouldShowGroupScoreEntry(tournament) {
  return canWriteGroupKnockoutScores(tournament)
}

function groupScoreActionLabel(tournament) {
  const phase = resolveGroupKnockoutPhase(tournament)
  if (phase === 'completed') return '查看赛果'
  if (phase === 'knockout_published') return '录入赛果'
  return '录入小组赛赛果'
}

function emptyGroupKnockoutPayload() {
  return { groups: [], groupBrackets: [], knockoutBrackets: [], standings: {} }
}

function emptyArrangePicker() {
  return { show: false, title: '选择分组球员', members: [], selectedId: '', selectedIds: [], maxSelect: 0, ctx: null }
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

function decorateGroupKnockout(payload, matchResults) {
  const safe = payload || emptyGroupKnockoutPayload()
  const resultByMatchId = buildResultByMatchId(matchResults)
  return {
    ...safe,
    groups: safe.groups || [],
    standings: safe.standings || {},
    groupBrackets: (safe.groupBrackets || []).map(bracket => decorateGroupBracket(bracket, resultByMatchId)),
    knockoutBrackets: (safe.knockoutBrackets || []).map(bracket => decorateKnockoutBracket(bracket, resultByMatchId))
  }
}

function decorateGroupBracket(bracket, resultByMatchId) {
  const groupCode = String((bracket && bracket.groupCode) || '').trim().toUpperCase()
  const matches = decorateMatches(bracket && bracket.matches, resultByMatchId)
  return {
    ...bracket,
    matches,
    __title: groupCode ? `${groupCode}组` : '小组',
    __kicker: groupCode ? `GROUP ${groupCode}` : 'GROUP',
    __scoreProgressText: scoreProgressText(matches)
  }
}

function decorateKnockoutBracket(bracket, resultByMatchId) {
  const round = Number((bracket && bracket.round) || 1)
  const matches = decorateMatches(bracket && bracket.matches, resultByMatchId)
  return {
    ...bracket,
    matches,
    __roundLabel: knockoutRoundLabel(round),
    __roundKicker: `KNOCKOUT ${round < 10 ? '0' : ''}${round}`,
    __scoreProgressText: scoreProgressText(matches)
  }
}

function decorateMatches(matches, resultByMatchId) {
  return (matches || []).map(match => decorateMatch(match, resultByMatchId))
}

function scoreProgressText(matches) {
  const playable = (matches || []).filter(match => match && !match.bye && match.player1 && match.player2)
  const confirmed = playable.filter(match => match.resultStatus === 'confirmed').length
  return `${confirmed}/${playable.length} 已确认`
}

function knockoutRoundLabel(round) {
  const normalized = Number(round || 1)
  if (normalized === 1) return '8强'
  if (normalized === 2) return '半决赛'
  if (normalized === 3) return '决赛'
  return `第${normalized}轮`
}

function decorateMatch(match, resultByMatchId) {
  const result = (resultByMatchId && resultByMatchId.get(match && match.matchId)) || null
  const merged = result ? mergeResultIntoMatch(match, result) : { ...match }
  const winnerId = playerIdOf(merged.winner) || merged.winnerId || merged.winnerPlayerId || ''
  return {
    ...merged,
    __player1Name: playerLabel(merged.player1),
    __player2Name: playerLabel(merged.player2),
    __scoreLabel: formatScore(merged.score),
    __statusLabel: scoreStatusLabel(merged.resultStatus, merged.bye),
    __player1Winner: isWinnerSide(merged.player1, winnerId),
    __player2Winner: isWinnerSide(merged.player2, winnerId)
  }
}

function mergeResultIntoMatch(match, result) {
  return {
    ...match,
    player1: result.player1 || match.player1,
    player2: result.player2 || match.player2,
    score: result.score || null,
    winner: result.winner || match.winner || null,
    winnerId: result.winnerId || match.winnerId || '',
    resultStatus: result.resultStatus || match.resultStatus || 'pending',
    status: result.status || match.status || 'pending',
    __resultId: result._id || ''
  }
}

function extractMatchResults(res) {
  const data = res && res.result && res.result.data
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.results)) return data.results
  if (data && Array.isArray(data.items)) return data.items
  return []
}

function buildResultByMatchId(results) {
  const map = new Map()
  ;(results || []).forEach(result => {
    if (!isActiveResult(result)) return
    const key = result.sourceMatchId || result.matchId || ''
    if (!key) return
    map.set(key, result)
  })
  return map
}

function isActiveResult(result) {
  return !!(
    result &&
    result.resultStatus !== 'invalidated' &&
    result.matchKind !== 'history' &&
    result.matchKind !== 'audit' &&
    !result.archivedFrom
  )
}

function formatScore(score) {
  if (!score) return ''
  if (typeof score === 'string') return score
  const sets = Array.isArray(score.sets) ? score.sets : []
  const parts = sets
    .map(set => {
      const a = Number(set && set.a)
      const b = Number(set && set.b)
      if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
      return `${a}:${b}`
    })
    .filter(Boolean)
  if (score.tiebreak) parts.push(`(${formatTiebreak(score.tiebreak)})`)
  return parts.join(' ')
}

function formatTiebreak(tiebreak) {
  if (typeof tiebreak === 'string') return tiebreak
  if (!tiebreak || typeof tiebreak !== 'object') return ''
  const a = Number(tiebreak.a)
  const b = Number(tiebreak.b)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  return `${a}-${b}`
}

function scoreStatusLabel(status, bye) {
  if (bye) return '轮空'
  if (status === 'confirmed') return '已确认'
  if (status === 'submitted') return '待确认'
  if (status === 'voided') return '未赛'
  return '待录入'
}

function isWinnerSide(player, winnerId) {
  if (!winnerId) return false
  return sidePlayerIds(player).includes(String(winnerId))
}

function sidePlayerIds(player) {
  if (!player) return []
  return [
    player.id,
    player.playerId,
    player._id,
    player.partnerId,
    player.partnerPlayerId
  ].filter(Boolean).map(id => String(id))
}

function playerIdOf(player) {
  return player && (player.id || player.playerId || player._id || '')
}

function resultErrors(result, fallback) {
  const error = result && result.error
  if (error && Array.isArray(error.errors) && error.errors.length) return error.errors
  if (error && error.message) return [error.message]
  if (result && result.message) return [result.message]
  return [fallback]
}

function buildRegistrationCandidates(registrations) {
  const seen = new Set()
  const rows = []
  ;(registrations || []).forEach(reg => {
    if (!isActiveRegistration(reg) || !reg.playerId || seen.has(reg.playerId)) return
    seen.add(reg.playerId)
    rows.push({
      _id: reg.playerId,
      name: reg.playerName || reg.name || reg.playerId,
      initial: firstChar(reg.playerName || reg.name || reg.playerId),
      avatarUrl: reg.avatarUrl || '',
      registrationId: reg._id || reg.registrationId || ''
    })
  })
  return rows
}

function isActiveRegistration(registration) {
  const status = registration && (registration.registrationStatus || registration.status || 'confirmed')
  return status !== 'withdrew' && status !== 'cancelled'
}

function buildArrangePickerMembers(candidates, arrangeGroups, currentPlayerId) {
  const currentIds = new Set(Array.isArray(currentPlayerId) ? currentPlayerId.filter(Boolean) : [currentPlayerId].filter(Boolean))
  const assigned = new Set()
  ;(arrangeGroups || []).forEach(group => {
    ;(group.slots || []).forEach(slot => {
      if (slot.playerId && !currentIds.has(slot.playerId)) assigned.add(slot.playerId)
    })
  })
  return (candidates || [])
    .filter(candidate => !assigned.has(candidate._id))
    .map(candidate => ({ ...candidate, selected: currentIds.has(candidate._id) }))
}

function markSelected(members, selectedId) {
  return (members || []).map(member => ({ ...member, selected: member._id === selectedId }))
}

function markMultiSelected(members, selectedIds) {
  const selected = new Set(selectedIds || [])
  return (members || []).map(member => ({ ...member, selected: selected.has(member._id) }))
}

function cloneArrangeGroups(groups) {
  return (groups || []).map(group => ({
    ...group,
    slots: (group.slots || []).map(slot => ({ ...slot }))
  }))
}

function firstChar(value) {
  return String(value || '').trim().slice(0, 1) || '球'
}
