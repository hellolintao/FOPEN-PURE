// court-grid · Phase 7 时间表视图
// 顶部：multi-select chips 选择参赛球场（避免横向溢出）
// X 轴: 已选中的 selectedCourts (每个一列)
// Y 轴: 1 小时一格，08:00-22:00 (14 行)
// 内部存储: 每个 1 小时勾选展开成 3 个 20 分钟 slot (h:00/h:20/h:40)

Component({
  properties: {
    value: { type: null, value: { slotMinutes: 20, courts: [] } },
    tournamentDate: { type: String, value: '' },
    availableCourts: { type: null, value: [] }
  },
  data: {
    hours: [],                // ['08:00', '09:00', ..., '21:00']
    pickedByCourt: {},        // { [courtId]: ['08:00', '10:00', ...] }
    selectedCourtIds: [],     // 用户从 chips 选中的 courtIds（决定时间表列）
    selectedCourts: [],       // 与 selectedCourtIds 对应的 court 对象数组
    courtChips: [],           // [{ ...court, selected }]
    rows: []                  // [{ hour, cells: [{ courtId, picked }] }]
  },
  observers: {
    'value, availableCourts, tournamentDate'(value, availableCourts) {
      const hours = buildHours()
      const pickedByCourt = {}
      const selectedFromValue = []
      ;(asArray(value && value.courts)).forEach(c => {
        const set = new Set()
        ;(asArray(c && c.slots)).forEach(s => {
          const hhmm = formatHHmm(s)
          if (hhmm && hhmm.endsWith(':00')) set.add(hhmm)
        })
        pickedByCourt[c.courtId] = [...set].sort()
        if (!selectedFromValue.includes(c.courtId)) selectedFromValue.push(c.courtId)
      })

      // 合并已有 selectedCourtIds 与 value 中的 courtIds，避免初始化空
      const merged = [...new Set([...this.data.selectedCourtIds, ...selectedFromValue])]
        .filter(id => asArray(availableCourts).some(c => c.courtId === id))

      this._recompute({ hours, pickedByCourt, selectedCourtIds: merged })
    }
  },
  methods: {
    onToggleCourt(e) {
      const courtId = e.currentTarget.dataset.courtId
      const set = new Set(this.data.selectedCourtIds)
      if (set.has(courtId)) {
        set.delete(courtId)
        // 取消选中时同时清掉该场地的 hour picks
        const map = { ...this.data.pickedByCourt }
        delete map[courtId]
        this._recompute({ selectedCourtIds: [...set], pickedByCourt: map })
        this.emit()
        return
      }
      set.add(courtId)
      this._recompute({ selectedCourtIds: [...set] })
      // 仅切换选中不需要 emit（还没有 picked slot）
    },

    onCellTap(e) {
      const { courtId, hour } = e.currentTarget.dataset
      const map = { ...this.data.pickedByCourt }
      const arr = [...(map[courtId] || [])]
      const idx = arr.indexOf(hour)
      if (idx >= 0) arr.splice(idx, 1)
      else arr.push(hour)
      arr.sort()
      map[courtId] = arr
      this._recompute({ pickedByCourt: map })
      this.emit()
    },

    _recompute(patch) {
      const next = {
        hours: asArray(patch.hours || this.data.hours),
        pickedByCourt: patch.pickedByCourt || this.data.pickedByCourt || {},
        selectedCourtIds: asArray(patch.selectedCourtIds || this.data.selectedCourtIds)
      }
      const available = asArray(this.properties.availableCourts)
      const selectedCourts = next.selectedCourtIds
        .map(id => available.find(c => c.courtId === id))
        .filter(Boolean)
      const courtChips = available.map(c => ({
        ...c,
        selected: next.selectedCourtIds.indexOf(c.courtId) >= 0
      }))
      const rows = buildRows(next.hours, selectedCourts, next.pickedByCourt)
      this.setData({
        hours: next.hours,
        pickedByCourt: next.pickedByCourt,
        selectedCourtIds: next.selectedCourtIds,
        selectedCourts,
        courtChips,
        rows
      })
    },

    emit() {
      const date = this.properties.tournamentDate || ''
      const courts = []
      this.data.selectedCourts.forEach(c => {
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

function buildRows(hours, selectedCourts, pickedByCourt) {
  return asArray(hours).map(hour => ({
    hour,
    cells: asArray(selectedCourts).map(c => ({
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

function asArray(value) {
  return Array.isArray(value) ? value : []
}
