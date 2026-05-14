Component({
  properties: {
    value: {
      type: Object,
      value: { slotMinutes: 30, courts: [] }
    },
    tournamentDate: { type: String, value: '' },
    availableCourts: { type: Array, value: [] }
  },

  data: {
    slotTimes: [],          // ['08:00', '08:30', ..., '21:30'] — 28 entries
    selectedCourtIds: [],   // courtIds currently "selected"
    pickedByCourt: {},      // { [courtId]: ['08:00', '09:30', ...] (sorted) }
    courtRows: []
  },

  observers: {
    'value, tournamentDate, availableCourts'(value) {
      const pickedByCourt = {}
      const selectedCourtIds = []
      ;(value && value.courts ? value.courts : []).forEach(c => {
        selectedCourtIds.push(c.courtId)
        pickedByCourt[c.courtId] = (c.slots || []).map(s => formatHHmm(s)).sort()
      })
      this.setData({
        slotTimes: buildSlotTimes(),
        selectedCourtIds,
        pickedByCourt
      })
      this.refreshRows()
    }
  },

  methods: {
    refreshRows() {
      const selected = new Set(this.data.selectedCourtIds)
      const rows = (this.properties.availableCourts || []).map(court => {
        const picked = new Set(this.data.pickedByCourt[court.courtId] || [])
        return {
          courtId: court.courtId,
          name: court.name,
          location: court.location,
          selected: selected.has(court.courtId),
          slots: this.data.slotTimes.map(time => ({
            time,
            picked: picked.has(time)
          }))
        }
      })
      this.setData({ courtRows: rows })
    },

    onToggleCourt(e) {
      const courtId = e.currentTarget.dataset.courtId
      const sel = new Set(this.data.selectedCourtIds)
      if (sel.has(courtId)) sel.delete(courtId)
      else sel.add(courtId)
      this.setData({ selectedCourtIds: [...sel] })
      this.refreshRows()
      this.emit()
    },

    onToggleSlot(e) {
      const { courtId, time } = e.currentTarget.dataset
      const map = { ...this.data.pickedByCourt }
      const set = new Set(map[courtId] || [])
      if (set.has(time)) set.delete(time)
      else set.add(time)
      map[courtId] = [...set].sort()
      this.setData({ pickedByCourt: map })
      this.refreshRows()
      this.emit()
    },

    emit() {
      const courts = this.data.selectedCourtIds.map(cid => {
        const meta = (this.properties.availableCourts || []).find(c => c.courtId === cid) || { name: cid, location: '' }
        const slots = (this.data.pickedByCourt[cid] || []).map(hhmm => `${this.properties.tournamentDate}T${hhmm}`)
        return { courtId: cid, name: meta.name, location: meta.location, slots }
      })
      this.triggerEvent('change', { courts })
    }
  }
})

function buildSlotTimes() {
  const out = []
  for (let h = 8; h < 22; h++) {
    out.push(`${pad(h)}:00`)
    out.push(`${pad(h)}:30`)
  }
  return out
}

function pad(n) { return n.toString().padStart(2, '0') }

function formatHHmm(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[1]}:${m[2]}` : ''
}
