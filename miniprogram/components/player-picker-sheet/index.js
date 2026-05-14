Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择球员' },
    members: { type: Array, value: [] },
    excludeIds: { type: Array, value: [] },
    requiredCount: { type: Number, value: 1 }
  },
  data: { selected: [], keyword: '', memberRows: [] },
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
      this.setData({ memberRows: rows })
    },

    onSearch(e) {
      this.setData({ keyword: (e.detail.value || '').trim() })
      this.refreshRows()
    },

    onTap(e) {
      const id = e.currentTarget.dataset.id
      if ((this.properties.excludeIds || []).indexOf(id) >= 0) return
      const required = this.properties.requiredCount || 1
      if (required === 1) {
        // Single: replace
        this.setData({ selected: [id] })
        this.refreshRows()
        return
      }
      // Multi: toggle, cap at required
      const cur = [...this.data.selected]
      const idx = cur.indexOf(id)
      if (idx >= 0) cur.splice(idx, 1)
      else if (cur.length < required) cur.push(id)
      this.setData({ selected: cur })
      this.refreshRows()
    },

    onConfirm() {
      const required = this.properties.requiredCount || 1
      if (this.data.selected.length !== required) {
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
