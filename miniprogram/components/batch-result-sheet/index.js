Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    mode: { type: String, value: 'confirm' },
    items: { type: Array, value: [] },
    result: { type: null, value: null },
  },
  data: {
    stateName: 'closed',
    autoCloseTimer: null,
  },
  observers: {
    'visible'(visible) {
      if (!visible) {
        if (this.data.autoCloseTimer) {
          clearTimeout(this.data.autoCloseTimer)
          this.setData({ autoCloseTimer: null })
        }
        this.setData({ stateName: 'closed' })
        return
      }
      if (this.properties.items && this.properties.items.length > 0) {
        this.setData({ stateName: 'previewing' })
      } else {
        this.setData({ stateName: 'loading' })
      }
    },
    'items'(items) {
      if (!this.properties.visible) return
      if (this.data.stateName === 'loading' && items && items.length > 0) {
        this.setData({ stateName: 'previewing' })
      }
    },
    'result'(result) {
      if (!result) return
      this.setData({ stateName: 'result' })
      const allOk = (!result.failures || result.failures.length === 0)
      if (allOk) {
        if (this.data.autoCloseTimer) {
          clearTimeout(this.data.autoCloseTimer)
          this.setData({ autoCloseTimer: null })
        }
        const timer = setTimeout(() => {
          this.triggerEvent('close', { reason: 'all-ok' })
        }, 3000)
        this.setData({ autoCloseTimer: timer })
      }
    },
  },
  lifetimes: {
    detached() {
      if (this.data.autoCloseTimer) {
        clearTimeout(this.data.autoCloseTimer)
        this.setData({ autoCloseTimer: null })
      }
    },
  },
  methods: {
    onCommit() {
      if (this.data.stateName === 'submitting') return
      const items = this.properties.items || []
      const matchIds = items.map(it => it.matchId)
      this.setData({ stateName: 'submitting' })
      this.triggerEvent('commit', { matchIds })
    },
    onRetry() {
      if (this.data.stateName === 'submitting') return
      const result = this.properties.result || {}
      const failureIds = (result.failures || []).filter(f => f.retryable).map(f => f.matchId)
      if (failureIds.length === 0) return
      this.setData({ stateName: 'submitting' })
      this.triggerEvent('retry', { failureIds })
    },
    onEditRow(e) {
      const matchId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.matchid
      if (!matchId) return
      this.triggerEvent('editrow', { matchId })
    },
    onClose() {
      if (this.data.autoCloseTimer) {
        clearTimeout(this.data.autoCloseTimer)
        this.setData({ autoCloseTimer: null })
      }
      this.triggerEvent('close', { reason: 'manual' })
    },
  },
})
