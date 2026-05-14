Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择球员' },
    members: { type: Array, value: [] },
    excludeIds: { type: Array, value: [] },
    // 精确模式：requiredCount > 0 且 maxCount = 0 → 必须选恰好 requiredCount 人
    requiredCount: { type: Number, value: 1 },
    // 多选模式：maxCount > 0 → 允许 1..maxCount 人，maxCount 优先生效
    maxCount: { type: Number, value: 0 }
  },
  data: { selected: [], keyword: '', memberRows: [], confirmLabel: '' },
  observers: {
    'show'(show) {
      if (!show) this.setData({ selected: [], keyword: '' })
      this.refreshRows()
    },

    'members, excludeIds'(members, excludeIds) {
      this.refreshRows()
    }
  },
  methods: {
    refreshRows() {
      const selected = new Set(this.data.selected)
      const excluded = new Set(this.properties.excludeIds || [])
      const keyword = this.data.keyword
      const rows = (this.properties.members || [])
        .filter(m => !keyword || String(m.name || '').indexOf(keyword) >= 0)
        .map(m => ({
          ...m,
          selected: selected.has(m._id),
          disabled: excluded.has(m._id)
        }))
      const max = this.properties.maxCount || 0
      const req = this.properties.requiredCount || 0
      let label
      if (max > 0) {
        label = `确认 (${this.data.selected.length}/${max})`
      } else {
        label = `确认 (${this.data.selected.length}/${req || 1})`
      }
      this.setData({ memberRows: rows, confirmLabel: label })
    },

    onSearch(e) {
      this.setData({ keyword: (e.detail.value || '').trim() })
      this.refreshRows()
    },

    onTap(e) {
      const id = e.currentTarget.dataset.id
      if ((this.properties.excludeIds || []).indexOf(id) >= 0) return
      const max = this.properties.maxCount || 0
      const required = this.properties.requiredCount || 1

      if (max > 0) {
        // Multi-select up to maxCount
        const cur = [...this.data.selected]
        const idx = cur.indexOf(id)
        if (idx >= 0) cur.splice(idx, 1)
        else if (cur.length < max) cur.push(id)
        else {
          wx.showToast({ title: `最多选 ${max} 人`, icon: 'none' })
          return
        }
        this.setData({ selected: cur })
        this.refreshRows()
        return
      }

      if (required === 1) {
        this.setData({ selected: [id] })
        this.refreshRows()
        return
      }

      // Exact-count multi (e.g., doubles requires exactly 2)
      const cur = [...this.data.selected]
      const idx = cur.indexOf(id)
      if (idx >= 0) cur.splice(idx, 1)
      else if (cur.length < required) cur.push(id)
      this.setData({ selected: cur })
      this.refreshRows()
    },

    onConfirm() {
      const max = this.properties.maxCount || 0
      const required = this.properties.requiredCount || 1
      const n = this.data.selected.length

      if (max > 0) {
        if (n < 1 || n > max) {
          wx.showToast({ title: `请选 1-${max} 人`, icon: 'none' })
          return
        }
      } else if (n !== required) {
        wx.showToast({ title: `请选 ${required} 人`, icon: 'none' })
        return
      }
      this.triggerEvent('confirm', { memberIds: this.data.selected })
      this.setData({ selected: [], keyword: '' })
      this.refreshRows()
    },

    onCancel() {
      this.triggerEvent('cancel')
      this.setData({ selected: [], keyword: '' })
      this.refreshRows()
    },

    onMaskTap() {
      this.onCancel()
    },

    onSheetTap() {
      // swallow tap so it doesn't bubble to mask
    }
  }
})
