Component({
  properties: {
    initialGrid: {
      type: Object,
      value: null
    },
    matchDate: {
      type: String,
      value: ''
    }
  },

  data: {
    courts: [],
    timeRanges: [],
    slotTimes: [],
    grid: {},
    editingCourtIndex: -1
  },

  lifetimes: {
    attached() {
      this.hydrateFromInitial()
    }
  },

  methods: {
    hydrateFromInitial() {
      const initial = this.data.initialGrid
      if (!initial || !initial.slots || !initial.courts) {
        this.setData({ courts: [], timeRanges: [], slotTimes: [], grid: {} })
        return
      }

      const courts = initial.courts.map(c => ({ courtId: c.courtId, name: c.name }))

      const sortedTimes = initial.slots
        .map(s => s.start.slice(11, 16))
        .sort()
      const timeRanges = this._mergeTimes(sortedTimes)

      const grid = {}
      initial.slots.forEach(slot => {
        const t = slot.start.slice(11, 16)
        if (!grid[t]) grid[t] = {}
        slot.availableCourtIds.forEach(cid => { grid[t][cid] = true })
      })

      this.setData({ courts, timeRanges, grid })
      this._regenerateSlotTimes()
    },

    _mergeTimes(sortedTimes) {
      if (sortedTimes.length === 0) return []
      const ranges = []
      let rangeStart = sortedTimes[0]
      let prev = sortedTimes[0]
      for (let i = 1; i < sortedTimes.length; i++) {
        const cur = sortedTimes[i]
        if (this._toMinutes(cur) - this._toMinutes(prev) === 20) {
          prev = cur
        } else {
          ranges.push({ start: rangeStart, end: this._addMinutes(prev, 20) })
          rangeStart = cur
          prev = cur
        }
      }
      ranges.push({ start: rangeStart, end: this._addMinutes(prev, 20) })
      return ranges
    },

    getCourtTimeGrid() {
      return this._serialize()
    },

    onAddCourt() {
      const courts = [...this.data.courts]
      const nextNum = courts.length + 1
      courts.push({
        courtId: `c${Date.now()}_${nextNum}`,
        name: `${nextNum}号场`
      })
      this.setData({ courts })
      this._notifyChange()
    },

    onRemoveCourt(e) {
      const { courtId } = e.currentTarget.dataset
      const courts = this.data.courts.filter(c => c.courtId !== courtId)
      const grid = { ...this.data.grid }
      Object.keys(grid).forEach(t => {
        if (grid[t][courtId]) {
          grid[t] = { ...grid[t] }
          delete grid[t][courtId]
        }
      })
      this.setData({ courts, grid })
      this._notifyChange()
    },

    onEditCourtName(e) {
      const { index } = e.currentTarget.dataset
      const { value } = e.detail
      const courts = [...this.data.courts]
      courts[index] = { ...courts[index], name: value }
      this.setData({ courts })
      this._notifyChange()
    },

    onAddTimeRange() {
      const timeRanges = [...this.data.timeRanges]
      timeRanges.push({ start: '08:00', end: '12:00' })
      this.setData({ timeRanges })
      this._regenerateSlotTimes()
      this._notifyChange()
    },

    onRemoveTimeRange(e) {
      const { index } = e.currentTarget.dataset
      const timeRanges = this.data.timeRanges.filter((_, i) => i !== index)
      this.setData({ timeRanges })
      this._regenerateSlotTimes()
      this._notifyChange()
    },

    onToggleCell(e) {
      const { time, courtId } = e.currentTarget.dataset
      const grid = { ...this.data.grid }
      const row = grid[time] ? { ...grid[time] } : {}
      row[courtId] = !row[courtId]
      grid[time] = row
      this.setData({ grid })
      this._notifyChange()
      wx.vibrateShort && wx.vibrateShort({ type: 'light' })
    },

    onTimeRangeChange(e) {
      const { index, field } = e.currentTarget.dataset
      const { value } = e.detail
      const timeRanges = [...this.data.timeRanges]
      timeRanges[index] = { ...timeRanges[index], [field]: value }
      this.setData({ timeRanges })
      this._regenerateSlotTimes()
      this._notifyChange()
    },

    _regenerateSlotTimes() {
      const set = new Set()
      this.data.timeRanges.forEach(r => {
        let t = this._toMinutes(r.start)
        const end = this._toMinutes(r.end)
        while (t < end) {
          set.add(this._toTimeStr(t))
          t += 20
        }
      })
      const slotTimes = Array.from(set).sort()
      this.setData({ slotTimes })
    },

    _toMinutes(hhmm) {
      const [h, m] = hhmm.split(':').map(Number)
      return h * 60 + m
    },

    _toTimeStr(minutes) {
      const h = Math.floor(minutes / 60).toString().padStart(2, '0')
      const m = (minutes % 60).toString().padStart(2, '0')
      return `${h}:${m}`
    },

    _notifyChange() {
      this.triggerEvent('change', { grid: this._serialize() })
    },

    _serialize() {
      const { courts, slotTimes, grid } = this.data
      const dateStr = this.data.matchDate || '2026-01-01'

      const slots = slotTimes.map(t => {
        const availableCourtIds = courts
          .filter(c => grid[t] && grid[t][c.courtId])
          .map(c => c.courtId)
        return {
          slotId: `s_${dateStr.replace(/-/g, '')}_${t.replace(':', '')}`,
          start: this._composeISO(dateStr, t),
          end: this._composeISO(dateStr, this._addMinutes(t, 20)),
          availableCourtIds
        }
      }).filter(s => s.availableCourtIds.length > 0)

      return {
        matchDuration: 20,
        courts: courts.map(c => ({ courtId: c.courtId, name: c.name })),
        slots
      }
    },

    _composeISO(date, time) {
      return `${date}T${time}:00+08:00`
    },

    _addMinutes(hhmm, minutes) {
      const total = this._toMinutes(hhmm) + minutes
      return this._toTimeStr(total)
    }
  }
})
