Component({
  properties: {
    value: String,
    options: { type: Array, value: [] }
  },
  methods: {
    onTap(e) {
      const value = e.currentTarget.dataset.value
      if (value === this.data.value) return
      wx.vibrateShort({ type: 'light' })
      this.triggerEvent('change', { value })
    }
  }
})
