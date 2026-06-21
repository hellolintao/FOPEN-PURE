Component({
  properties: {
    tournament: Object,
    registrations: { type: null, value: [] },
    schedulePlan: { type: null, value: { courts: [] } },
    matches: { type: null, value: [] },
    freePlays: { type: null, value: [] },
    queues: { type: null, value: [] },
    members: { type: null, value: [] }
  },

  data: {
    pickerShow: false,
    pickerCtx: null,        // { kind: 'switchPlayer'|'addFreePlay'|'addExtra', courtId, matchId?, slot? }
    pickerRequiredCount: 1,
    pickerExclude: [],
    pickerMembers: [],
    pickerTitle: '',
    decoratedQueues: [],
    decoratedCourts: [],
    decoratedRows: []
  },

  observers: {
    'queues, matches, freePlays, schedulePlan, members'(queues, matches, freePlays, schedulePlan) {
      const decoratedQueues = this._decorate(queues, matches, freePlays)
      const courts = this._decorateCourts(schedulePlan)
      const rows = this._buildRows(schedulePlan, decoratedQueues)
      this.setData({
        decoratedQueues,
        decoratedCourts: courts,
        decoratedRows: rows
      })
    },

    'schedulePlan'(schedulePlan) {
      const courts = this._decorateCourts(schedulePlan)
      const rows = this._buildRows(schedulePlan, this.data.decoratedQueues || [])
      this.setData({ decoratedCourts: courts, decoratedRows: rows })
    },

    'decoratedQueues'(decoratedQueues) {
      const rows = this._buildRows(this.properties.schedulePlan, decoratedQueues || [])
      this.setData({ decoratedRows: rows })
    }
  },

  methods: {
    // —— decoration helper ——
    _decorate(queues, matches, freePlays) {
      // Pre-compute duplicate keys: 同样的双方球员（无序）出现多次 → 标红
      const keyCount = new Map()
      ;(asArray(matches)).forEach(m => {
        const key = matchPairKey(m)
        if (!key) return
        keyCount.set(key, (keyCount.get(key) || 0) + 1)
      })

      return asArray(queues).map(q => {
        const items = asArray(q.items).map(it => {
          if (it.kind === 'freePlay') {
            const fp = asArray(freePlays).find(x => x._id === it.matchId)
            const playerIds = asArray(fp && fp.playerIds)
            const playersLabel = playerIds
              .map(pid => {
                const m = asArray(this.properties.members).find(x => x._id === pid)
                return m ? m.name : pid
              })
              .join('/')
            return { ...it, __rowKind: 'freePlay', __player1Label: '', __player2Label: '', __playersLabel: playersLabel, __duplicate: false, __slotConflict: false, __playerIds: [] }
          }
          // kind === 'match'
          const match = asArray(matches).find(x => x.matchId === it.matchId)
          const rowKind = match && match.matchKind ? match.matchKind : 'bracket'
          const p1 = match && match.player1
          const p2 = match && match.player2
          const isDoubles = !!(p1 && p1.partnerId)
          const player1Label = p1 ? (p1.name || '?') : (match && match.bye ? 'BYE' : '?')
          const partner1Label = p1 && p1.partnerName ? p1.partnerName : ''
          const player2Label = p2 ? (p2.name || '?') : (match && match.bye ? 'BYE' : '?')
          const partner2Label = p2 && p2.partnerName ? p2.partnerName : ''
          // singles 显示「A VS B」；doubles 用两行「A/B 上 / C/D 下」
          const singlesP1 = p1 && !isDoubles ? (p1.name + (p1.partnerName ? '/' + p1.partnerName : '')) : player1Label
          const singlesP2 = p2 && !isDoubles ? (p2.name + (p2.partnerName ? '/' + p2.partnerName : '')) : player2Label
          const key = match ? matchPairKey(match) : ''
          const duplicate = !!key && (keyCount.get(key) || 0) > 1
          const playerIds = matchPlayerIds(match)
          return {
            ...it,
            __rowKind: rowKind,
            __isDoubles: isDoubles,
            __player1Label: singlesP1,
            __player2Label: singlesP2,
            __doublesP1: player1Label,
            __doublesPartner1: partner1Label,
            __doublesP2: player2Label,
            __doublesPartner2: partner2Label,
            __playersLabel: '',
            __duplicate: duplicate,
            __slotConflict: false,
            __playerIds: playerIds
          }
        })
        return { ...q, items }
      })
    },

    _decorateCourts(schedulePlan) {
      return asArray(schedulePlan && schedulePlan.courts).map(court => ({
        ...court,
        slots: asArray(court.slots).slice().sort(),
        slotsLabel: asArray(court.slots).length + ' 个时段'
      }))
    },

    _buildRows(schedulePlan, decoratedQueues) {
      const courts = this._decorateCourts(schedulePlan)
      const slotKeys = []
      const seen = new Set()
      courts.forEach(court => {
        ;(asArray(court.slots)).forEach(slot => {
          if (!seen.has(slot)) {
            seen.add(slot)
            slotKeys.push(slot)
          }
        })
      })
      slotKeys.sort()

      const maxOverflow = courts.reduce((max, court) => {
        const q = asArray(decoratedQueues).find(x => x.courtId === court.courtId)
        const extra = Math.max(0, asArray(q && q.items).length - asArray(court.slots).length)
        return Math.max(max, extra)
      }, 0)
      for (let i = 0; i < maxOverflow; i++) slotKeys.push(`__overflow_${i}`)

      return markSlotConflicts(slotKeys.map(slotKey => ({
        slotKey,
        slotLabel: slotKey.indexOf('__overflow_') === 0 ? `加场 ${parseInt(slotKey.replace('__overflow_', ''), 10) + 1}` : formatSlotLabel(slotKey),
        cells: courts.map(court => this._cellFor(court, slotKey, asArray(decoratedQueues)))
      })))
    },

    _cellFor(court, slotKey, decoratedQueues) {
      const q = asArray(decoratedQueues).find(x => x.courtId === court.courtId)
      const slots = asArray(court.slots)
      const isOverflow = slotKey.indexOf('__overflow_') === 0
      const slotIndex = isOverflow
        ? slots.length + parseInt(slotKey.replace('__overflow_', ''), 10)
        : slots.indexOf(slotKey)

      if (slotIndex < 0) {
        return { courtId: court.courtId, available: false, __rowKind: 'empty', slotIndex: -1 }
      }

      const item = q && q.items ? asArray(q.items).find(it => it.order === slotIndex) : null
      if (!item) {
        return { courtId: court.courtId, available: true, __rowKind: 'empty', slotIndex }
      }

      return {
        ...item,
        courtId: court.courtId,
        available: true,
        slotIndex
      }
    },

    onRegenerate() {
      wx.showModal({
        title: '重随排程？',
        content: '会丢弃当前所有手动调整',
        success: ({ confirm }) => { if (confirm) this.triggerEvent('regenerate') }
      })
    },

    onClear() {
      wx.showModal({
        title: '清空排程？',
        content: '所有对局和自由拉球都将被清空',
        success: ({ confirm }) => { if (confirm) this.triggerEvent('clear') }
      })
    },

    onTapItem(e) {
      // 长按 → actionsheet
      const { courtId, matchId, kind } = e.currentTarget.dataset
      if (!matchId) return
      const itemList = ['上移', '下移', '移到其他场地']
      if (kind !== 'bracket') itemList.push('删除')
      wx.showActionSheet({
        itemList,
        success: ({ tapIndex }) => {
          if (tapIndex === 0) this.move(courtId, matchId, -1)
          else if (tapIndex === 1) this.move(courtId, matchId, +1)
          else if (tapIndex === 2) this.moveCourt(courtId, matchId)
          else if (tapIndex === 3) this.removeItem(courtId, matchId, kind)
        }
      })
    },

    onTapDelete(e) {
      const { courtId, matchId, kind } = e.currentTarget.dataset
      if (kind === 'bracket') return  // bracket rows are protected
      this.removeItem(courtId, matchId, kind)
    },

    onTapPlayer(e) {
      const { matchId, slot } = e.currentTarget.dataset    // slot: 'player1' | 'player2'
      const m = (this.data.matches || []).find(x => x.matchId === matchId)
      if (!m) return
      // 不允许改 BYE 行
      if (m.bye) return
      const exclude = this.collectMatchPlayerIds(m, slot)
      const pool = this.allowedPoolForSwitch(m)  // 报名者
      this.setData({
        pickerShow: true,
        pickerCtx: { kind: 'switchPlayer', matchId, slot },
        pickerRequiredCount: 1,
        pickerExclude: exclude,
        pickerMembers: pool,
        pickerTitle: '选择换上的球员'
      })
    },

    onAddFreePlay(e) {
      // 自由拉球不需要选择球员，直接添加占位行
      const courtId = e.currentTarget.dataset.courtId
      this.applyAddFreePlay({ courtId }, [])
    },

    onAddExtra(e) {
      if (this.properties.tournament && this.properties.tournament.format !== 'regular') {
        wx.showToast({ title: '仅常规赛可加场次', icon: 'none' }); return
      }
      const courtId = e.currentTarget.dataset.courtId
      const matchTypes = this.allowedMatchTypes()
      const matchType = matchTypes[0] || 'singles'
      this.openAddMatchPicker({ kind: 'addExtra', courtId, matchType })
    },

    onPickerConfirm(e) {
      const { memberIds } = e.detail
      const ctx = this.data.pickerCtx
      if (!ctx) return
      if (ctx.kind === 'switchPlayer')  this.applySwitch(ctx, memberIds[0])
      if (ctx.kind === 'addFreePlay')   this.applyAddFreePlay(ctx, memberIds)
      if (ctx.kind === 'addExtra')      this.applyAddExtra(ctx, memberIds)
      if (ctx.kind === 'addMatchAt')    this.applyAddMatchAt(ctx, memberIds)
      this.setData({ pickerShow: false, pickerCtx: null })
    },

    onTapEmpty(e) {
      const courtId = e.currentTarget.dataset.courtId
      const slotIndex = parseInt(e.currentTarget.dataset.slotIndex, 10)
      if (isNaN(slotIndex) || slotIndex < 0) return
      const isRegular = this.properties.tournament && this.properties.tournament.format === 'regular'
      const actions = isRegular
        ? this.addMatchActions().concat([{ label: '自由拉球', kind: 'freePlay' }])
        : [{ label: '自由拉球', kind: 'freePlay' }]
      wx.showActionSheet({
        itemList: actions.map(action => action.label),
        success: ({ tapIndex }) => {
          const action = actions[tapIndex]
          if (!action) return
          if (action.kind === 'freePlay') {
            this.applyAddFreePlayAt(courtId, slotIndex)
            return
          }
          this.openAddMatchPicker({ kind: 'addMatchAt', courtId, slotIndex, matchType: action.matchType })
        }
      })
    },

    openAddMatchPicker({ kind, courtId, slotIndex, matchType }) {
      const isDoubles = matchType === 'doubles'
      this.setData({
        pickerShow: true,
        pickerCtx: { kind, courtId, slotIndex, matchType },
        pickerRequiredCount: isDoubles ? 4 : 2,
        pickerExclude: [],
        pickerMembers: this.allowedPoolForSchedule(),
        pickerTitle: isDoubles ? '选择双打球员' : '选择单打球员'
      })
    },

    applyAddFreePlayAt(courtId, slotIndex) {
      const queues = cloneArray(this.data.queues)
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      // 不能与已有 order 冲突
      q.items = asArray(q.items)
      if (q.items.some(it => it.order === slotIndex)) return
      const fpId = `fp_${courtId}_${Date.now()}`
      q.items.push({ kind: 'freePlay', matchId: fpId, freePlayId: fpId, order: slotIndex })
      const freePlays = [...asArray(this.data.freePlays), { _id: fpId, courtId, queueOrder: slotIndex, playerIds: [] }]
      this.emitChange({ queues, freePlays })
    },

    applyAddMatchAt({ courtId, slotIndex, matchType }, memberIds) {
      const queues = cloneArray(this.data.queues)
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      q.items = asArray(q.items)
      if (q.items.some(it => it.order === slotIndex)) return
      const newId = `match_extra_${Date.now()}`
      q.items.push({ kind: 'match', matchId: newId, sourceMatchId: newId, order: slotIndex })
      const match = this.assemblePlayerObjects(memberIds, newId, matchType)
      if (!match) return
      const matches = [...asArray(this.data.matches), match]
      this.emitChange({ queues, matches })
    },

    onPickerCancel() { this.setData({ pickerShow: false, pickerCtx: null }) },

    // —— 数据变更工具 ——
    move(courtId, matchId, delta) {
      const queues = cloneArray(this.data.queues)
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      q.items = asArray(q.items)
      const idx = q.items.findIndex(it => it.matchId === matchId); if (idx < 0) return
      const target = idx + delta
      if (target < 0 || target >= q.items.length) return
      ;[q.items[idx], q.items[target]] = [q.items[target], q.items[idx]]
      q.items.forEach((it, i) => { it.order = i })
      this.emitChange({ queues })
    },

    moveCourt(fromCourtId, matchId) {
      const courts = asArray(this.properties.schedulePlan && this.properties.schedulePlan.courts)
      if (courts.length === 0) return
      const otherCourts = courts
        .filter(c => c.courtId !== fromCourtId)
        .map(c => c.name)
      const ids = courts
        .filter(c => c.courtId !== fromCourtId)
        .map(c => c.courtId)
      wx.showActionSheet({
        itemList: otherCourts,
        success: ({ tapIndex }) => {
          const toCourtId = ids[tapIndex]
          const queues = cloneArray(this.data.queues)
          const from = queues.find(x => x.courtId === fromCourtId)
          const to = queues.find(x => x.courtId === toCourtId)
          if (!from || !to) return
          from.items = asArray(from.items)
          to.items = asArray(to.items)
          const idx = from.items.findIndex(it => it.matchId === matchId)
          if (idx < 0) return
          const [item] = from.items.splice(idx, 1)
          item.order = to.items.length
          to.items.push(item)
          from.items.forEach((it, i) => { it.order = i })
          this.emitChange({ queues })
        }
      })
    },

    removeItem(courtId, matchId, kind) {
      const queues = cloneArray(this.data.queues)
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      q.items = asArray(q.items).filter(it => it.matchId !== matchId)
      // 不再重新索引 order — 保留原 slot 位置，后面的对局不顶上来
      const patch = { queues }
      if (kind === 'freePlay') patch.freePlays = asArray(this.data.freePlays).filter(fp => fp._id !== matchId)
      if (kind === 'extra' || kind === 'regularRound') patch.matches = asArray(this.data.matches).filter(m => m.matchId !== matchId)
      this.emitChange(patch)
    },

    applySwitch({ matchId, slot }, newMemberId) {
      const member = asArray(this.properties.members).find(x => x._id === newMemberId)
        || (this.allowedPoolForSwitch(null)).find(x => x._id === newMemberId)
      if (!member) return
      const matches = cloneArray(this.data.matches)
      const m = matches.find(x => x.matchId === matchId); if (!m) return

      // 双打 4 槽：player1 / player1partner / player2 / player2partner
      if (slot === 'player1partner' || slot === 'player2partner') {
        const root = slot === 'player1partner' ? 'player1' : 'player2'
        m[root] = {
          ...(m[root] || {}),
          partnerId: member._id,
          partnerName: member.name
        }
        this.emitChange({ matches })
        return
      }

      // knockout 单打/双打：尝试与已有位置互换（保持 bracket 完整）
      if (this.properties.tournament && this.properties.tournament.format === 'knockout') {
        let swapped = false
        for (const other of matches) {
          if (other.matchId === matchId) continue
          for (const s of ['player1', 'player2']) {
            if (other[s] && other[s].id === newMemberId) {
              const tmp = m[slot]; m[slot] = other[s]; other[s] = tmp
              swapped = true
              break
            }
          }
          if (swapped) break
        }
        if (!swapped) {
          m[slot] = { ...(m[slot] || {}), id: member._id, name: member.name }
        }
      } else {
        // 常规赛（含双打随机搭档模式）：直接替换 id+name，保留 partnerId/partnerName
        m[slot] = { ...(m[slot] || {}), id: member._id, name: member.name }
      }
      this.emitChange({ matches })
    },

    applyAddFreePlay({ courtId }, memberIds) {
      const queues = cloneArray(this.data.queues)
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      q.items = asArray(q.items)
      const fpId = `fp_${courtId}_${Date.now()}`
      q.items.push({ kind: 'freePlay', matchId: fpId, freePlayId: fpId, order: q.items.length })
      const freePlays = [...asArray(this.data.freePlays), { _id: fpId, courtId, queueOrder: q.items.length - 1, playerIds: memberIds || [] }]
      this.emitChange({ queues, freePlays })
    },

    applyAddExtra({ courtId, matchType }, memberIds) {
      const queues = cloneArray(this.data.queues)
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      q.items = asArray(q.items)
      const newId = `match_extra_${Date.now()}`
      q.items.push({ kind: 'match', matchId: newId, sourceMatchId: newId, order: q.items.length })
      const match = this.assemblePlayerObjects(memberIds, newId, matchType)
      if (!match) return
      const matches = [...asArray(this.data.matches), match]
      this.emitChange({ queues, matches })
    },

    assemblePlayerObjects(memberIds, matchId, matchType) {
      const pool = this.allowedPoolForSchedule()
      const ms = asArray(memberIds).map(id => pool.find(x => x._id === id)).filter(Boolean)
      const isDoubles = matchType === 'doubles'
      if ((!isDoubles && ms.length < 2) || (isDoubles && ms.length < 4)) return null
      const player1 = isDoubles
        ? { id: ms[0]._id, name: ms[0].name, partnerId: ms[1]._id, partnerName: ms[1].name }
        : { id: ms[0]._id, name: ms[0].name }
      const player2 = isDoubles
        ? { id: ms[2]._id, name: ms[2].name, partnerId: ms[3]._id, partnerName: ms[3].name }
        : { id: ms[1]._id, name: ms[1].name }
      return { matchId, round: 1, position: 999, type: matchType, player1, player2, bye: false, status: 'pending', resultStatus: 'pending', winner: null, courtId: null, queueOrder: null, matchKind: 'extra' }
    },

    collectMatchPlayerIds(m, excludeSlot) {
      const ids = []
      const pushId = id => { if (id && id !== 'BYE') ids.push(id) }
      // player1 主位
      if (excludeSlot !== 'player1' && m.player1) pushId(m.player1.id)
      // player1 搭档位
      if (excludeSlot !== 'player1partner' && m.player1) pushId(m.player1.partnerId)
      // player2 主位
      if (excludeSlot !== 'player2' && m.player2) pushId(m.player2.id)
      // player2 搭档位
      if (excludeSlot !== 'player2partner' && m.player2) pushId(m.player2.partnerId)
      return ids
    },

    allowedPoolForSwitch(/* m */) {
      return this.allowedPoolForSchedule()
    },

    allowedPoolForSchedule() {
      const rows = []
      const seen = new Set()
      const push = (id, name, avatarUrl, registrationId) => {
        if (!id || seen.has(id)) return
        seen.add(id)
        rows.push({ _id: id, name: name || id, avatarUrl, registrationId })
      }
      asArray(this.properties.registrations).forEach(r => {
        push(r.playerId, r.playerName, r.avatarUrl, r.registrationId)
        push(r.partnerId, r.partnerName, r.partnerAvatarUrl, r.registrationId)
      })
      return rows
    },

    allowedMatchTypes() {
      const tournamentType = this.properties.tournament && this.properties.tournament.type
      if (tournamentType === 'mixed') return ['singles', 'doubles']
      if (tournamentType === 'doubles') return ['doubles']
      return ['singles']
    },

    addMatchActions() {
      return this.allowedMatchTypes().map(matchType => ({
        kind: 'match',
        matchType,
        label: matchType === 'doubles' ? '双打' : '单打'
      }))
    },

    emitChange(patch) {
      const detail = {
        matches:   patch.matches   !== undefined ? asArray(patch.matches)   : asArray(this.data.matches),
        queues:    patch.queues    !== undefined ? asArray(patch.queues)    : asArray(this.data.queues),
        freePlays: patch.freePlays !== undefined ? asArray(patch.freePlays) : asArray(this.data.freePlays)
      }
      this.setData(patch)
      this.triggerEvent('change', detail)
    }
  }
})

function matchPairKey(m) {
  const ids = matchPlayerIds(m)
  if (ids.length < 2) return ''
  return ids.slice().sort().join('|')
}

function matchPlayerIds(m) {
  if (!m) return []
  const ids = []
  const push = obj => {
    if (!obj || !obj.id || obj.id === 'BYE') return
    ids.push(String(obj.id))
    if (obj.partnerId) ids.push(String(obj.partnerId))
  }
  push(m.player1)
  push(m.player2)
  return ids
}

function markSlotConflicts(rows) {
  return asArray(rows).map(row => {
    if (!row || String(row.slotKey || '').indexOf('__overflow_') === 0) return row
    const counts = new Map()
    asArray(row.cells).forEach(cell => {
      if (!cell || cell.kind !== 'match') return
      asArray(cell.__playerIds).forEach(id => counts.set(id, (counts.get(id) || 0) + 1))
    })
    return {
      ...row,
      cells: asArray(row.cells).map(cell => {
        if (!cell || cell.kind !== 'match') return cell
        const slotConflict = asArray(cell.__playerIds).some(id => (counts.get(id) || 0) > 1)
        return { ...cell, __slotConflict: slotConflict }
      })
    }
  })
}

function formatSlotLabel(slot) {
  const m = /T(\d{2}):(\d{2})/.exec(slot || '')
  return m ? `${m[1]}:${m[2]}` : String(slot || '')
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function cloneArray(value) {
  return JSON.parse(JSON.stringify(asArray(value)))
}
