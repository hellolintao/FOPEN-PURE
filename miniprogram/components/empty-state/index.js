Component({
  properties: {
    icon: { type: String, value: '' },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    action: { type: String, value: '' },
  },
  lifetimes: {
    attached() {
      if (!this.properties.action) {
        console.error('[empty-state] missing required prop "action". v2.1 rule: empty state must offer a next step.')
      }
    },
  },
  methods: {
    onActionTap() {
      this.triggerEvent('action')
    },
  },
})
