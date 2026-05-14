Component({
  properties: {
    tournament: Object,
    registrations: { type: Array, value: [] },
    schedulePlan: Object,
    matches: { type: Array, value: [] },
    freePlays: { type: Array, value: [] },
    queues: { type: Array, value: [] },
    members: { type: Array, value: [] }
  },

  data: {
    pickerShow: false,
    pickerCtx: null,        // { kind: 'switchPlayer'|'addFreePlay'|'addExtra', courtId, matchId?, slot? }
    pickerRequiredCount: 1,
    pickerExclude: [],
    pickerMembers: [],
    pickerTitle: '',
    decoratedQueues: [],
    decoratedCourts: []
  },

  observers: {
    'queues, matches, freePlays'(queues, matches, freePlays) {
      this.setData({ decoratedQueues: this._decorate(queues, matches, freePlays) })
    },

    'schedulePlan'(schedulePlan) {
      const courts = (schedulePlan && schedulePlan.courts) || []
      const decoratedCourts = courts.map(court => {
        const slotsLabel = (court.slots || []).length + ' 个时段'
        return { ...court, slotsLabel }
      })
      // Compute __hasAnyRow per court from current decoratedQueues
      const queues = this.data.decoratedQueues || []
      const result = decoratedCourts.map(court => {
        const q = queues.find(x => x.courtId === court.courtId)
        return { ...court, __hasAnyRow: !!(q && q.items && q.items.length > 0) }
      })
      this.setData({ decoratedCourts: result })
    },

    'decoratedQueues'(decoratedQueues) {
      // Recompute __hasAnyRow when decoratedQueues changes
      const courts = this.data.decoratedCourts || []
      if (!courts.length) return
      const result = courts.map(court => {
        const q = decoratedQueues.find(x => x.courtId === court.courtId)
        return { ...court, __hasAnyRow: !!(q && q.items && q.items.length > 0) }
      })
      this.setData({ decoratedCourts: result })
    }
  },

  methods: {
    // —— decoration helper ——
    _decorate(queues, matches, freePlays) {
      return (queues || []).map(q => {
        const items = (q.items || []).map(it => {
          if (it.kind === 'freePlay') {
            const fp = (freePlays || []).find(x => x._id === it.matchId)
            const playerIds = (fp && fp.playerIds) || []
            const playersLabel = playerIds
              .map(pid => {
                const m = (this.properties.members || []).find(x => x._id === pid)
                return m ? m.name : pid
              })
              .join('/')
            return { ...it, __rowKind: 'freePlay', __player1Label: '', __player2Label: '', __playersLabel: playersLabel }
          }
          // kind === 'match'
          const match = (matches || []).find(x => x.matchId === it.matchId)
          const rowKind = match && match.matchKind === 'extra' ? 'extra' : 'bracket'
          const p1 = match && match.player1
          const p2 = match && match.player2
          const player1Label = p1
            ? (p1.name + (p1.partnerName ? '/' + p1.partnerName : ''))
            : (match && match.bye ? 'BYE' : '?')
          const player2Label = p2
            ? (p2.name + (p2.partnerName ? '/' + p2.partnerName : ''))
            : (match && match.bye ? 'BYE' : '?')
          return { ...it, __rowKind: rowKind, __player1Label: player1Label, __player2Label: player2Label, __playersLabel: '' }
        })
        return { ...q, items }
      })
    },

    onRegenerate() {
      wx.showModal({
        title: '重新随机安排？',
        content: '会丢弃当前所有手动调整',
        success: ({ confirm }) => { if (confirm) this.triggerEvent('regenerate') }
      })
    },

    onTapItem(e) {
      // 长按 → actionsheet
      const { courtId, matchId, kind } = e.currentTarget.dataset
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
      const isDoubles = this.properties.tournament && this.properties.tournament.type === 'doubles'
      this.setData({
        pickerShow: true,
        pickerCtx: { kind: 'addExtra', courtId },
        pickerRequiredCount: isDoubles ? 4 : 2,
        pickerExclude: [],
        pickerMembers: this.properties.members || [],
        pickerTitle: '选择比赛球员'
      })
    },

    onPickerConfirm(e) {
      const { memberIds } = e.detail
      const ctx = this.data.pickerCtx
      if (!ctx) return
      if (ctx.kind === 'switchPlayer') this.applySwitch(ctx, memberIds[0])
      if (ctx.kind === 'addFreePlay')  this.applyAddFreePlay(ctx, memberIds)
      if (ctx.kind === 'addExtra')     this.applyAddExtra(ctx, memberIds)
      this.setData({ pickerShow: false, pickerCtx: null })
    },

    onPickerCancel() { this.setData({ pickerShow: false, pickerCtx: null }) },

    // —— 数据变更工具 ——
    move(courtId, matchId, delta) {
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      const idx = q.items.findIndex(it => it.matchId === matchId); if (idx < 0) return
      const target = idx + delta
      if (target < 0 || target >= q.items.length) return
      ;[q.items[idx], q.items[target]] = [q.items[target], q.items[idx]]
      q.items.forEach((it, i) => { it.order = i })
      this.emitChange({ queues })
    },

    moveCourt(fromCourtId, matchId) {
      const schedulePlan = this.properties.schedulePlan
      if (!schedulePlan || !schedulePlan.courts) return
      const otherCourts = schedulePlan.courts
        .filter(c => c.courtId !== fromCourtId)
        .map(c => c.name)
      const ids = schedulePlan.courts
        .filter(c => c.courtId !== fromCourtId)
        .map(c => c.courtId)
      wx.showActionSheet({
        itemList: otherCourts,
        success: ({ tapIndex }) => {
          const toCourtId = ids[tapIndex]
          const queues = JSON.parse(JSON.stringify(this.data.queues))
          const from = queues.find(x => x.courtId === fromCourtId)
          const to = queues.find(x => x.courtId === toCourtId)
          if (!from || !to) return
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
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      q.items = q.items.filter(it => it.matchId !== matchId)
      q.items.forEach((it, i) => { it.order = i })
      const patch = { queues }
      if (kind === 'freePlay') patch.freePlays = this.data.freePlays.filter(fp => fp._id !== matchId)
      if (kind === 'extra')    patch.matches   = this.data.matches.filter(m => m.matchId !== matchId)
      this.emitChange(patch)
    },

    applySwitch({ matchId, slot }, newMemberId) {
      const member = (this.properties.members || []).find(x => x._id === newMemberId)
        || (this.allowedPoolForSwitch(null)).find(x => x._id === newMemberId)
      if (!member) return
      const matches = JSON.parse(JSON.stringify(this.data.matches))
      const m = matches.find(x => x.matchId === matchId); if (!m) return
      if (this.properties.tournament && this.properties.tournament.format === 'knockout') {
        // try to find another bracket position holding newMemberId; if found, swap; else fallthrough
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
          m[slot] = { id: member._id, name: member.name }
        }
      } else {
        m[slot] = { id: member._id, name: member.name }
      }
      this.emitChange({ matches })
    },

    applyAddFreePlay({ courtId }, memberIds) {
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      const fpId = `fp_${courtId}_${Date.now()}`
      q.items.push({ kind: 'freePlay', matchId: fpId, freePlayId: fpId, order: q.items.length })
      const freePlays = [...this.data.freePlays, { _id: fpId, courtId, queueOrder: q.items.length - 1, playerIds: memberIds || [] }]
      this.emitChange({ queues, freePlays })
    },

    applyAddExtra({ courtId }, memberIds) {
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      const newId = `match_extra_${Date.now()}`
      q.items.push({ kind: 'match', matchId: newId, sourceMatchId: newId, order: q.items.length })
      const matches = [...this.data.matches, this.assemblePlayerObjects(memberIds, newId)]
      this.emitChange({ queues, matches })
    },

    assemblePlayerObjects(memberIds, matchId) {
      const ms = memberIds.map(id => (this.properties.members || []).find(x => x._id === id)).filter(Boolean)
      const isDoubles = this.properties.tournament && this.properties.tournament.type === 'doubles'
      const player1 = isDoubles
        ? { id: ms[0]._id, name: ms[0].name, partnerId: ms[1]._id, partnerName: ms[1].name }
        : { id: ms[0]._id, name: ms[0].name }
      const player2 = isDoubles
        ? { id: ms[2]._id, name: ms[2].name, partnerId: ms[3]._id, partnerName: ms[3].name }
        : { id: ms[1]._id, name: ms[1].name }
      return { matchId, round: 1, position: 999, player1, player2, bye: false, status: 'pending', resultStatus: 'pending', winner: null, courtId: null, queueOrder: null, matchKind: 'extra' }
    },

    collectMatchPlayerIds(m, excludeSlot) {
      const ids = []
      const push = obj => {
        if (obj && obj.id && obj.id !== 'BYE') {
          ids.push(obj.id)
          if (obj.partnerId) ids.push(obj.partnerId)
        }
      }
      if (excludeSlot !== 'player1') push(m.player1)
      if (excludeSlot !== 'player2') push(m.player2)
      return ids
    },

    allowedPoolForSwitch(/* m */) {
      return (this.properties.registrations || []).map(r => ({
        _id: r.playerId,
        name: r.playerName,
        avatarUrl: r.avatarUrl
      }))
    },

    emitChange(patch) {
      const detail = {
        matches:   patch.matches   !== undefined ? patch.matches   : this.data.matches,
        queues:    patch.queues    !== undefined ? patch.queues    : this.data.queues,
        freePlays: patch.freePlays !== undefined ? patch.freePlays : this.data.freePlays
      }
      this.setData(patch)
      this.triggerEvent('change', detail)
    }
  }
})
