Component({
  properties: {
    show: { type: Boolean, value: false },
    title: { type: String, value: '选择球员' },
    members: { type: Array, value: [] },
    excludeIds: { type: Array, value: [] },
    requiredCount: { type: Number, value: 1 }
  },
  data: { selected: [], keyword: '' },
  observers: {
    'show'(show) {
      if (!show) this.setData({ selected: [], keyword: '' })
    }
  },
  methods: {
    onSearch(e) {
      this.setData({ keyword: (e.detail.value || '').trim() })
    },

    onTap(e) {
      const id = e.currentTarget.dataset.id
      if ((this.properties.excludeIds || []).indexOf(id) >= 0) return
      const required = this.properties.requiredCount || 1
      if (required === 1) {
        // Single: replace
        this.setData({ selected: [id] })
        return
      }
      // Multi: toggle, cap at required
      const cur = [...this.data.selected]
      const idx = cur.indexOf(id)
      if (idx >= 0) cur.splice(idx, 1)
      else if (cur.length < required) cur.push(id)
      this.setData({ selected: cur })
    },

    onConfirm() {
      const required = this.properties.requiredCount || 1
      if (this.data.selected.length !== required) {
        wx.showToast({ title: `请选 ${required} 人`, icon: 'none' })
        return
      }
      this.triggerEvent('confirm', { memberIds: this.data.selected })
      this.setData({ selected: [], keyword: '' })
    },

    onCancel() {
      this.triggerEvent('cancel')
      this.setData({ selected: [], keyword: '' })
    },

    onMaskTap() {
      this.onCancel()
    },

    onSheetTap() {
      // swallow tap so it doesn't bubble to mask
    }
  }
})
