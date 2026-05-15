Component({
  properties: {
    value: { type: null, observer: 'animateToValue' },
    suffix: { type: String, value: '' }
  },
  data: {
    displayValue: '0'
  },
  lifetimes: {
    attached() {
      this.animateToValue(this.data.value)
    },
    detached() {
      clearInterval(this._timer)
    }
  },
  methods: {
    animateToValue(value) {
      const target = Number(value)
      clearInterval(this._timer)

      if (!Number.isFinite(target)) {
        this.setData({ displayValue: value == null ? '0' : String(value) })
        return
      }

      const start = 0
      const steps = 12
      const duration = 240
      let tick = 0

      this._timer = setInterval(() => {
        tick += 1
        const progress = tick / steps
        const eased = 1 - Math.pow(1 - progress, 3)
        const current = Math.round(start + (target - start) * eased)
        this.setData({ displayValue: `${current}${this.data.suffix}` })
        if (tick >= steps) clearInterval(this._timer)
      }, duration / steps)
    }
  }
})
