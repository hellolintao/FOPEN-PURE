// court-grid · Phase 7 时间表视图
// X 轴: availableCourts (每个一列)
// Y 轴: 1 小时一格，08:00-22:00 (14 行)
// 内部存储: 每个 1 小时勾选展开成 3 个 20 分钟 slot (h:00/h:20/h:40)

Component({
  properties: {
    value: { type: Object, value: { slotMinutes: 20, courts: [] } },
    tournamentDate: { type: String, value: '' },
    availableCourts: { type: Array, value: [] }
  },
  data: {
    hours: [],          // ['08:00', '09:00', ..., '21:00']
    pickedByCourt: {},  // { [courtId]: ['08:00', '10:00', ...] }
    rows: []            // [{ hour, cells: [{ courtId, picked }] }]
  },
  observers: {
    'value, availableCourts, tournamentDate'(value, availableCourts) {
      const hours = buildHours()
      const pickedByCourt = {}
      ;(value && value.courts ? value.courts : []).forEach(c => {
        const set = new Set()
        ;(c.slots || []).forEach(s => {
          const hhmm = formatHHmm(s)
          if (hhmm && hhmm.endsWith(':00')) set.add(hhmm)
        })
        pickedByCourt[c.courtId] = [...set].sort()
      })
      const rows = buildRows(hours, availableCourts || [], pickedByCourt)
      this.setData({ hours, pickedByCourt, rows })
    }
  },
  methods: {
    onCellTap(e) {
      const { courtId, hour } = e.currentTarget.dataset
      const map = { ...this.data.pickedByCourt }
      const arr = [...(map[courtId] || [])]
      const idx = arr.indexOf(hour)
      if (idx >= 0) arr.splice(idx, 1)
      else arr.push(hour)
      arr.sort()
      map[courtId] = arr
      const rows = buildRows(this.data.hours, this.properties.availableCourts || [], map)
      this.setData({ pickedByCourt: map, rows })
      this.emit()
    },

    emit() {
      const date = this.properties.tournamentDate || ''
      const courts = []
      ;(this.properties.availableCourts || []).forEach(c => {
        const hours = this.data.pickedByCourt[c.courtId] || []
        if (hours.length === 0) return
        const slots = []
        hours.forEach(hhmm => {
          const h = parseInt(hhmm.split(':')[0], 10)
          slots.push(`${date}T${pad(h)}:00`)
          slots.push(`${date}T${pad(h)}:20`)
          slots.push(`${date}T${pad(h)}:40`)
        })
        courts.push({
          courtId: c.courtId,
          name: c.name,
          location: c.location || '',
          slots
        })
      })
      this.triggerEvent('change', { courts })
    }
  }
})

function buildHours() {
  const out = []
  for (let h = 8; h < 22; h++) out.push(`${pad(h)}:00`)
  return out
}

function buildRows(hours, availableCourts, pickedByCourt) {
  return hours.map(hour => ({
    hour,
    cells: availableCourts.map(c => ({
      courtId: c.courtId,
      picked: (pickedByCourt[c.courtId] || []).indexOf(hour) >= 0
    }))
  }))
}

function pad(n) {
  return n.toString().padStart(2, '0')
}

function formatHHmm(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[1]}:${m[2]}` : ''
}
