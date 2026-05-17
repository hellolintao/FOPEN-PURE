const app = getApp()

Page({
  data: {
    tournamentId: '',
    tournament: null,
    registrations: [],
    brackets: [],
    freePlays: [],
    scheduleCourts: [],
    scheduleRows: [],
    tournamentDisplay: null,
    loading: true,
    isAdmin: false
  },

  onLoad(options) {
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
    await Promise.all([
      this.loadTournamentDetail(),
      this.loadRegistrations(),
      this.loadBrackets(),
      this.loadFreePlays()
    ])
    this._rebuildScheduleView()
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
      const me = app.globalData && app.globalData.currentMember
      const isCreator = !!(me && result.data.createdBy && result.data.createdBy === me._id)
      const isAdmin = !!((app.globalData && app.globalData.isAdmin) || isCreator)
      this.setData({
        tournament: result.data,
        tournamentDisplay: buildTournamentDisplay(result.data),
        isAdmin,
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
      this.setData({ registrations })
    } catch (err) {
      console.error('加载参赛人员失败:', err)
    }
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
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}` })
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

function buildTournamentDisplay(tournament) {
  const config = tournament.config || {}
  const pointsRules = tournament.pointsRules || {}
  const placement = pointsRules.placement || {}
  const winLoss = pointsRules.winLoss || {}
  const isKnockout = tournament.format === 'knockout'

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
