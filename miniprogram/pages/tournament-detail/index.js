const app = getApp()
const {
  getTournamentStatusMeta,
  getTournamentShareTitle,
  isCompletedStatus
} = require('../../utils/tournament-status')

Page({
  data: {
    tournamentId: '',
    tournament: null,
    registrations: [],
    brackets: [],
    freePlays: [],
    matchResultRows: [],
    resultSummary: null,
    resultDisplay: { visible: false, completedText: '', standings: [], groups: [] },
    scheduleCourts: [],
    scheduleRows: [],
    tournamentDisplay: null,
    loading: true,
    isAdmin: false,
    isParticipant: false,
    canEnterScore: false,
    canOpenScore: false,
    scoreActionLabel: '录入成绩',
    shareEnabled: false
  },

  onLoad(options = {}) {
    this.enableShareMenu()
    const { id } = options
    if (id) {
      this.setData({ tournamentId: id })
      this.refresh()
    }
  },

  onShow() {
    if (this.data.tournamentId) this.refresh()
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh())
  },

  async refresh() {
    await this.ensureIdentity()
    await Promise.all([
      this.loadTournamentDetail(),
      this.loadRegistrations(),
      this.loadBrackets(),
      this.loadFreePlays(),
      this.loadResultSummary()
    ])
    this.syncTournamentDisplayState()
    this.syncResultDisplayState()
    this._rebuildScheduleView()
  },

  async ensureIdentity() {
    try {
      if (app.globalData && !app.globalData.currentMember && typeof app.refreshIdentity === 'function') {
        await app.refreshIdentity()
      }
    } catch (err) {
      console.warn('[tournament-detail] refresh identity failed', err)
    }
  },

  enableShareMenu(enabled = true) {
    if (typeof wx === 'undefined') return
    if (enabled && wx.showShareMenu) {
      wx.showShareMenu({
        withShareTicket: true,
        menus: ['shareAppMessage', 'shareTimeline']
      })
      return
    }
    if (!enabled && wx.hideShareMenu) {
      wx.hideShareMenu({
        menus: ['shareAppMessage', 'shareTimeline']
      })
    }
  },

  buildAccessState({ tournament, isAdmin, isParticipant, resultSummary }) {
    const tournamentWithSummary = withResultSummary(tournament, resultSummary)
    const statusMeta = getTournamentStatusMeta(tournamentWithSummary)
    const canEnterScore = !!(isAdmin || isParticipant)
    return {
      canEnterScore,
      canOpenScore: canEnterScore || isCompletedStatus(tournamentWithSummary),
      scoreActionLabel: statusMeta.scoreActionLabel,
      shareEnabled: statusMeta.canShare
    }
  },

  syncTournamentDisplayState() {
    if (!this.data.tournament) return
    const accessState = this.buildAccessState({
      tournament: this.data.tournament,
      resultSummary: this.data.resultSummary,
      isAdmin: this.data.isAdmin,
      isParticipant: this.data.isParticipant
    })
    this.enableShareMenu(accessState.shareEnabled)
    this.setData({
      tournamentDisplay: buildTournamentDisplay(this.data.tournament, this.data.resultSummary),
      ...accessState
    })
  },

  syncResultDisplayState() {
    this.setData({
      resultDisplay: buildResultDisplay(this.data.matchResultRows, this.data.tournament, this.data.registrations)
    })
  },

  async enrichTournamentSeason(tournament) {
    if (!tournament || tournament.seasonName || !tournament.seasonId) return tournament
    try {
      const res = await wx.cloud.callFunction({
        name: 'seasons',
        data: { action: 'get', id: tournament.seasonId }
      })
      const season = res && res.result && res.result.data
      if (!season || !season.name) {
        console.warn('[tournament-detail] season name missing', { seasonId: tournament.seasonId })
        return tournament
      }
      return { ...tournament, seasonName: season.name }
    } catch (err) {
      console.warn('[tournament-detail] load season failed', err)
      return tournament
    }
  },

  async loadTournamentDetail() {
    this.setData({ loading: true })
    try {
      const db = wx.cloud.database()
      const result = await db.collection('tournaments').doc(this.data.tournamentId).get()
      if (!result.data) {
        wx.showToast({ title: '赛事不存在', icon: 'none' })
        setTimeout(() => wx.navigateBack(), 1500)
        return
      }
      const tournament = await this.enrichTournamentSeason(result.data)
      const me = app.globalData && app.globalData.currentMember
      const isCreator = !!(me && tournament.createdBy && tournament.createdBy === me._id)
      const isAdmin = !!((app.globalData && app.globalData.isAdmin) || isCreator)
      const accessState = this.buildAccessState({
        tournament,
        resultSummary: this.data.resultSummary,
        isAdmin,
        isParticipant: this.data.isParticipant
      })
      this.enableShareMenu(accessState.shareEnabled)
      this.setData({
        tournament,
        tournamentDisplay: buildTournamentDisplay(tournament, this.data.resultSummary),
        isAdmin,
        ...accessState,
        loading: false
      })
    } catch (err) {
      console.error('加载赛事详情失败:', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
      this.setData({ loading: false })
    }
  },

  async loadRegistrations() {
    try {
      const db = wx.cloud.database()
      const _ = db.command
      const result = await db.collection('tournament_registrations')
        .where({
          tournamentId: this.data.tournamentId,
          status: _.neq('cancelled')
        })
        .orderBy('seed', 'asc')
        .get()
      const rawRegs = result.data || []

      // 收集所有 playerId / partnerId 一次性查头像
      const ids = new Set()
      rawRegs.forEach(r => {
        if (r.playerId) ids.add(r.playerId)
        if (r.partnerId) ids.add(r.partnerId)
      })

      const avatarMap = await fetchAvatarMap([...ids])

      const registrations = buildRosterPeople(rawRegs, avatarMap)
      const isParticipant = this.isCurrentMemberRegistered(rawRegs)
      const accessState = this.buildAccessState({
        tournament: this.data.tournament,
        resultSummary: this.data.resultSummary,
        isAdmin: this.data.isAdmin,
        isParticipant
      })
      this.setData({
        registrations,
        isParticipant,
        ...accessState
      })
    } catch (err) {
      console.error('加载参赛人员失败:', err)
      const accessState = this.buildAccessState({
        tournament: this.data.tournament,
        resultSummary: this.data.resultSummary,
        isAdmin: this.data.isAdmin,
        isParticipant: false
      })
      this.setData({
        isParticipant: false,
        ...accessState
      })
    }
  },

  isCurrentMemberRegistered(rawRegs) {
    const member = app.globalData && app.globalData.currentMember
    const memberId = member && member._id
    if (!memberId) return false
    return (rawRegs || []).some(reg => (
      reg &&
      reg.status !== 'cancelled' &&
      reg.registrationStatus !== 'cancelled' &&
      (reg.playerId === memberId || reg.partnerId === memberId)
    ))
  },

  async loadBrackets() {
    try {
      const result = await wx.cloud.callFunction({
        name: 'tournament-brackets',
        data: {
          action: 'getByTournament',
          tournamentId: this.data.tournamentId
        }
      })
      const brackets = (result.result && result.result.data) || []
      this.setData({ brackets })
    } catch (err) {
      console.error('加载对位表失败:', err)
    }
  },

  async loadFreePlays() {
    try {
      const r = await wx.cloud.callFunction({
        name: 'free-plays',
        data: { action: 'list', tournamentId: this.data.tournamentId }
      })
      const items = (r.result && r.result.success && r.result.data && r.result.data.items) || []
      this.setData({ freePlays: items })
    } catch (err) {
      console.error('加载自由拉球失败:', err)
    }
  },

  _rebuildScheduleView() {
    const view = buildScheduleView(this.data.tournament, this.data.brackets, this.data.freePlays)
    this.setData(view)
  },

  onBack() {
    wx.navigateBack()
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}` })
  },

  onResumeDraft() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}` })
  },

  onEnterScore() {
    if (!this.data.canOpenScore && !this.data.canEnterScore) {
      wx.showToast({ title: '仅参赛者可录入', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}` })
  },

  async loadResultSummary() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'match-results',
        data: { action: 'listByTournament', tournamentId: this.data.tournamentId }
      })
      const rows = unpackMatchResultRows(res)
      this.setData({
        matchResultRows: rows,
        resultSummary: buildResultSummary(rows)
      })
    } catch (err) {
      console.warn('[tournament-detail] load result summary failed', err)
      this.setData({
        matchResultRows: [],
        resultSummary: null,
        resultDisplay: emptyResultDisplay()
      })
    }
  },

  onShareAppMessage() {
    const tournament = this.data.tournament || {}
    const tournamentWithSummary = withResultSummary(tournament, this.data.resultSummary)
    const tournamentId = this.data.tournamentId || tournament._id || ''
    return {
      title: getTournamentShareTitle(tournamentWithSummary),
      path: tournamentId ? `/pages/tournament-detail/index?id=${tournamentId}` : '/pages/match/index'
    }
  },

  onShareTimeline() {
    const tournament = this.data.tournament || {}
    const tournamentWithSummary = withResultSummary(tournament, this.data.resultSummary)
    const tournamentId = this.data.tournamentId || tournament._id || ''
    return {
      title: getTournamentShareTitle(tournamentWithSummary),
      query: tournamentId ? `id=${tournamentId}` : ''
    }
  },

  onDelete() {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该赛事吗？此操作不可恢复。',
      confirmColor: '#f56c6c',
      confirmText: '删除',
      success: res => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...' })
        wx.cloud.callFunction({
          name: 'tournaments',
          data: { action: 'delete', _id: this.data.tournamentId },
          success: () => {
            wx.hideLoading()
            wx.showToast({ title: '删除成功', icon: 'success' })
            setTimeout(() => wx.navigateBack(), 500)
          },
          fail: err => {
            wx.hideLoading()
            console.error('删除失败', err)
            wx.showToast({ title: '删除失败', icon: 'error' })
          }
        })
      }
    })
  }
})

function buildTournamentDisplay(tournament, resultSummary) {
  const config = tournament.config || {}
  const pointsRules = tournament.pointsRules || {}
  const placement = pointsRules.placement || {}
  const winLoss = pointsRules.winLoss || {}
  const isKnockout = tournament.format === 'knockout'
  const statusMeta = getTournamentStatusMeta(withResultSummary(tournament, resultSummary))

  const placementRows = [
    { label: '冠军', value: placement.champion },
    { label: '亚军', value: placement.runnerUp },
    { label: '四强', value: placement.semifinal },
    { label: '八强', value: placement.quarterfinal },
    { label: '参赛', value: placement.participation }
  ].filter(row => row.value !== undefined && row.value !== null)

  return {
    maxPlayers: tournament.maxPlayers || config.maxPlayers || '-',
    playersPerMatch: config.playersPerMatch || (tournament.type === 'mixed' ? '2 / 4' : (tournament.type === 'doubles' ? 4 : 2)),
    typeText: tournamentTypeText(tournament.type),
    showRoundInfo: isKnockout,
    currentRound: config.currentRound || 1,
    totalRounds: config.totalRounds || '-',
    formatText: isKnockout ? '淘汰赛' : '常规赛',
    statusKind: statusMeta.kind,
    statusLabel: statusMeta.label,
    statusHint: statusMeta.hint,
    scoreActionLabel: statusMeta.scoreActionLabel,
    shareEnabled: statusMeta.canShare,
    hasSeedPlayers: Array.isArray(config.seedPlayers) && config.seedPlayers.length > 0,
    seedPlayersText: Array.isArray(config.seedPlayers) ? config.seedPlayers.join(', ') : '',
    pointsMode: isKnockout ? 'placement' : 'winLoss',
    win: typeof winLoss.win === 'number' ? winLoss.win : '-',
    loss: typeof winLoss.loss === 'number' ? winLoss.loss : '-',
    walkover: typeof winLoss.walkover === 'number' ? winLoss.walkover : undefined,
    placementRows
  }
}

function buildRosterPeople(rawRegs, avatarMap) {
  const seen = new Set()
  const people = []
  const push = (id, name, reg) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const status = (reg && (reg.registrationStatus || reg.status)) || 'registered'
    people.push({
      _id: id,
      playerId: id,
      playerName: name || '',
      seed: reg && reg.seed,
      displayStatus: status,
      avatarUrl: avatarMap[id] || '',
      playerInitial: firstChar(name)
    })
  }
  ;(rawRegs || []).forEach(reg => {
    push(reg.playerId, reg.playerName, reg)
    push(reg.partnerId, reg.partnerName, reg)
  })
  return people
}

function unpackMatchResultRows(res) {
  const data = res && res.result && res.result.data
  if (data && Array.isArray(data.results)) return data.results
  if (Array.isArray(data)) return data
  return []
}

function emptyResultDisplay() {
  return { visible: false, completedText: '', standings: [], groups: [] }
}

function isPlayableResult(row) {
  return !!(
    row &&
    !row.bye &&
    row.player1 &&
    row.player2 &&
    row.player1.id &&
    row.player2.id &&
    !isByeSide(row.player1) &&
    !isByeSide(row.player2)
  )
}

function isByeSide(side) {
  return !!(side && (side.id === 'BYE' || side.name === 'BYE'))
}

function buildResultDisplay(rows, tournament, registrations) {
  const playable = (rows || []).filter(isPlayableResult)
  if (playable.length === 0) return emptyResultDisplay()
  if (!playable.every(row => row.resultStatus === 'confirmed')) return emptyResultDisplay()

  const sorted = playable.slice().sort((a, b) => {
    if ((a.round || 0) !== (b.round || 0)) return (a.round || 0) - (b.round || 0)
    if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0)
    return (a.queueOrder || 0) - (b.queueOrder || 0)
  })
  const groupsMap = new Map()
  sorted.forEach(row => {
    const round = row.round || 1
    if (!groupsMap.has(round)) groupsMap.set(round, [])
    groupsMap.get(round).push(buildResultMatchRow(row))
  })

  return {
    visible: true,
    completedText: `已完成 ${playable.length} / ${playable.length} 场`,
    standings: buildResultStandings(sorted, tournament || {}, registrations || []),
    groups: [...groupsMap.entries()].map(([round, matches]) => ({
      round,
      label: `ROUND ${round < 10 ? '0' : ''}${round}`,
      matches
    }))
  }
}

function buildResultMatchRow(row) {
  return {
    matchId: resultMatchId(row),
    round: row.round || 1,
    position: row.position || 0,
    p1Label: sideLabel(row.player1),
    p2Label: sideLabel(row.player2),
    scoreText: scoreText(row.score),
    winnerLabel: sideLabel(row.winner),
    pointsText: pointsText(row)
  }
}

function resultMatchId(row) {
  const persisted = [
    row && row._id,
    row && row.sourceMatchId,
    row && row.matchId
  ].map(keyPart).find(Boolean)
  if (persisted) return persisted

  const round = keyPart(row && row.round) || '1'
  const position = keyPart(row && row.position) || '0'
  const queueOrder = keyPart(row && row.queueOrder) || 'none'
  const p1 = sideIdentity(row && row.player1) || sideLabel(row && row.player1) || 'p1'
  const p2 = sideIdentity(row && row.player2) || sideLabel(row && row.player2) || 'p2'
  return `round:${round}|position:${position}|queue:${queueOrder}|p1:${p1}|p2:${p2}`
}

function keyPart(value) {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

function sideLabel(side) {
  if (!side) return ''
  const name = side.name || ''
  const partner = side.partnerName || ''
  return partner ? `${name} / ${partner}` : name
}

function scoreText(score) {
  const set0 = score && score.sets && score.sets[0]
  if (!set0) return ''
  const base = `${set0.a}:${set0.b}`
  return score.tiebreak ? `${base} (${score.tiebreak})` : base
}

function pointsText(row) {
  const entries = row && row.pointsAwarded && row.pointsAwarded.entries
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const p1Ids = sideIds(row.player1)
  const p2Ids = sideIds(row.player2)
  const sumFor = ids => entries
    .filter(entry => ids.includes(entry.memberId))
    .reduce((sum, entry) => sum + (entry.points || 0), 0)
  const p1 = sumFor(p1Ids)
  const p2 = sumFor(p2Ids)
  if (!p1 && !p2) return ''
  return `+${p1} / +${p2}`
}

function sideIds(side) {
  if (!side) return []
  return [side.id, side.partnerId].filter(Boolean)
}

function buildResultStandings(rows, tournament, registrations) {
  const directory = buildParticipantDirectory(rows, registrations)
  const stats = new Map()

  const ensure = member => {
    if (!member || !member.memberId) return null
    const key = member.memberId
    if (!stats.has(key)) {
      const name = member.memberName || key
      stats.set(key, {
        standingKey: key,
        memberId: key,
        memberName: name,
        avatarUrl: member.avatarUrl || '',
        playerInitial: member.playerInitial || firstChar(name),
        singlesPoints: 0,
        doublesPoints: 0,
        totalPoints: 0,
        wins: 0,
        losses: 0
      })
    }
    return stats.get(key)
  }

  rows.forEach(row => {
    const p1Members = directory.membersFromSide(row.player1)
    const p2Members = directory.membersFromSide(row.player2)
    p1Members.forEach(ensure)
    p2Members.forEach(ensure)

    if (sameSide(row.winner, row.player1)) {
      p1Members.forEach(member => { ensure(member).wins += 1 })
      p2Members.forEach(member => { ensure(member).losses += 1 })
    } else if (sameSide(row.winner, row.player2)) {
      p2Members.forEach(member => { ensure(member).wins += 1 })
      p1Members.forEach(member => { ensure(member).losses += 1 })
    }

    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    const bucket = resultPointBucket(row, tournament)
    entries.forEach(entry => {
      if (!entry || !entry.memberId) return
      const stat = ensure(directory.memberForId(entry.memberId))
      if (!stat) return
      const points = Number(entry.points) || 0
      stat[bucket] += points
      stat.totalPoints += points
    })
  })

  return [...stats.values()]
    .sort((a, b) => (
      (b.totalPoints - a.totalPoints) ||
      (b.wins - a.wins) ||
      (a.losses - b.losses) ||
      compareLabels(a.memberId, b.memberId) ||
      compareLabels(a.memberName, b.memberName)
    ))
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      recordText: `${item.wins}胜${item.losses}负`,
      singlesPointsText: String(item.singlesPoints),
      doublesPointsText: String(item.doublesPoints)
    }))
}

function buildParticipantDirectory(rows, registrations) {
  const members = new Map()
  const add = (memberId, memberName, avatarUrl, playerInitial) => {
    if (!memberId) return null
    const key = String(memberId)
    const existing = members.get(key) || { memberId: key }
    const name = existing.memberName || memberName || key
    const next = {
      ...existing,
      memberName: name,
      avatarUrl: avatarUrl || existing.avatarUrl || '',
      playerInitial: playerInitial || existing.playerInitial || firstChar(name)
    }
    members.set(key, next)
    return next
  }
  const addSide = side => {
    if (!side) return
    add(side.id, side.name, side.avatarUrl, side.playerInitial)
    add(side.partnerId, side.partnerName, side.partnerAvatarUrl, side.partnerInitial)
  }

  ;(registrations || []).forEach(member => {
    add(member.playerId || member._id, member.playerName || member.name, member.avatarUrl, member.playerInitial)
  })
  ;(rows || []).forEach(row => {
    addSide(row.player1)
    addSide(row.player2)
    addSide(row.winner)
  })

  const memberForId = memberId => add(memberId, '', '', '')
  const membersFromSide = side => {
    const ids = sideIds(side)
    return ids.map(memberForId).filter(Boolean)
  }
  return { memberForId, membersFromSide }
}

function resultPointBucket(row, tournament) {
  const type = (row && (row.tournamentType || row.type || row.matchType)) || (tournament && tournament.type) || 'singles'
  if (type === 'doubles') return 'doublesPoints'
  if (type === 'mixed' && (sideIds(row && row.player1).length > 1 || sideIds(row && row.player2).length > 1)) return 'doublesPoints'
  return 'singlesPoints'
}

function sideIdentity(side) {
  const ids = sideIds(side).slice().sort()
  return ids.join('/')
}

function compareLabels(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function sameSide(a, b) {
  if (!a || !b) return false
  return a.id === b.id || a.id === b.partnerId || a.partnerId === b.id || (a.partnerId && a.partnerId === b.partnerId)
}

function buildResultSummary(rows) {
  const playable = (rows || []).filter(isPlayableResult)
  return {
    playableCount: playable.length,
    confirmedCount: playable.filter(row => row.resultStatus === 'confirmed').length
  }
}

function withResultSummary(tournament, resultSummary) {
  if (!tournament) return { resultSummary }
  return { ...tournament, resultSummary: resultSummary || tournament.resultSummary || null }
}

function tournamentTypeText(type) {
  if (type === 'mixed') return 'MIXED · 混合'
  if (type === 'doubles') return 'DOUBLES · 双打'
  return 'SINGLES · 单打'
}

function buildScheduleView(tournament, brackets, freePlays) {
  const schedulePlan = tournament && tournament.schedulePlan
  if (!schedulePlan || !Array.isArray(schedulePlan.courts) || schedulePlan.courts.length === 0) {
    return { scheduleCourts: [], scheduleRows: [] }
  }

  const courts = schedulePlan.courts.map(c => ({
    courtId: c.courtId,
    name: c.name,
    slots: [...(c.slots || [])].sort()
  }))

  const slotKeySet = new Set()
  courts.forEach(c => c.slots.forEach(s => slotKeySet.add(s)))
  const slotKeys = [...slotKeySet].sort()

  // 取 R1 bracket 的所有 matches（含 extras + regularRound + bracket）
  const r1 = (brackets || []).find(b => b.round === 1)
  const r1Matches = (r1 && r1.matches) || []

  // cellByCourt[courtId][slotIndex] -> cell data
  const cellByCourt = {}
  courts.forEach(c => { cellByCourt[c.courtId] = {} })

  r1Matches.forEach(m => {
    if (!m.courtId || m.queueOrder === null || m.queueOrder === undefined) return
    if (!cellByCourt[m.courtId]) return
    const isDoubles = !!(m.player1 && m.player1.partnerId)
    cellByCourt[m.courtId][m.queueOrder] = {
      kind: 'match',
      __rowKind: m.matchKind || 'bracket',
      __isDoubles: isDoubles,
      __player1Label: playerLabel(m.player1, m.bye),
      __player2Label: playerLabel(m.player2, m.bye),
      __doublesP1: m.player1 ? (m.player1.name || '?') : (m.bye ? 'BYE' : '?'),
      __doublesPartner1: (m.player1 && m.player1.partnerName) || '',
      __doublesP2: m.player2 ? (m.player2.name || '?') : (m.bye ? 'BYE' : '?'),
      __doublesPartner2: (m.player2 && m.player2.partnerName) || ''
    }
  })

  ;(freePlays || []).forEach(fp => {
    if (!fp.courtId || fp.queueOrder === null || fp.queueOrder === undefined) return
    if (!cellByCourt[fp.courtId]) return
    if (cellByCourt[fp.courtId][fp.queueOrder]) return  // 比赛优先
    cellByCourt[fp.courtId][fp.queueOrder] = {
      kind: 'freePlay',
      __rowKind: 'freePlay'
    }
  })

  const rows = slotKeys.map(slotKey => ({
    slotKey,
    slotLabel: formatSlotLabel(slotKey),
    cells: courts.map(c => {
      const slotIndex = c.slots.indexOf(slotKey)
      if (slotIndex < 0) {
        return { courtId: c.courtId, kind: null, __rowKind: 'unavailable' }
      }
      const cell = cellByCourt[c.courtId][slotIndex]
      if (!cell) return { courtId: c.courtId, kind: null, __rowKind: 'empty' }
      return { ...cell, courtId: c.courtId }
    })
  }))

  return { scheduleCourts: courts, scheduleRows: rows }
}

function formatSlotLabel(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[1]}:${m[2]}` : String(iso || '')
}

function playerLabel(p, bye) {
  if (!p) return bye ? 'BYE' : '?'
  if (p.id === 'BYE' || p.name === 'BYE') return 'BYE'
  return (p.name || '') + (p.partnerName ? '/' + p.partnerName : '')
}

function firstChar(name) {
  const s = (name || '').trim()
  return s ? s.charAt(0) : '?'
}

async function fetchAvatarMap(ids) {
  if (!ids || ids.length === 0) return {}
  const db = wx.cloud.database()
  // 小程序云数据库一次 in 查询限制 ~20，按 20 个一批拉取
  const chunkSize = 20
  const map = {}
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    try {
      const r = await db.collection('members').where({ _id: db.command.in(chunk) }).field({ avatarUrl: true, name: true }).get()
      ;(r.data || []).forEach(m => { map[m._id] = m.avatarUrl || '' })
    } catch (e) {
      console.error('[tournament-detail] fetchAvatarMap chunk failed', e)
    }
  }
  return map
}
