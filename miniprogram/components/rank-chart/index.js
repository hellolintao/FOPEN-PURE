const GRID_LINE_COUNT = 4
const EDGE_PADDING_RATIO = 0.08
const TOP_PADDING_RATIO = 0.18
const BOTTOM_PADDING_RATIO = 0.16

function toFiniteRank(item) {
  if (!item || item.rank === null || item.rank === undefined) return null
  const rank = Number(item.rank)
  return Number.isFinite(rank) ? rank : null
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value))
}

Component({
  properties: {
    data: { type: Array, value: [] },
    height: { type: Number, value: 100 },
    width: { type: Number, value: 320 },
    color: { type: String, value: '#0A0A0A' }
  },

  data: {
    points: '',
    endX: 0,
    endY: 0,
    endRank: null,
    endLabelStyle: '',
    hasEnoughData: false
  },

  lifetimes: {
    attached() {
      this.recompute()
    },

    ready() {
      this.initCanvas()
    }
  },

  observers: {
    'data, width, height, color': function () {
      this.recompute()
    }
  },

  methods: {
    initCanvas() {
      this.createSelectorQuery()
        .select('#rank-chart-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvasInfo = res && res[0]
          if (!canvasInfo || !canvasInfo.node) return

          const canvas = canvasInfo.node
          const dpr = wx.getSystemInfoSync().pixelRatio || 1
          const canvasWidth = canvasInfo.width || this.data.width || 320
          const canvasHeight = canvasInfo.height || this.data.height || 100

          canvas.width = canvasWidth * dpr
          canvas.height = canvasHeight * dpr

          const ctx = canvas.getContext('2d')
          ctx.scale(dpr, dpr)

          this._canvas = canvas
          this._ctx = ctx
          this._canvasWidth = canvasWidth
          this._canvasHeight = canvasHeight
          this.draw()
        })
    },

    recompute() {
      const rawData = Array.isArray(this.data.data) ? this.data.data : []
      const ranks = rawData.map(toFiniteRank).filter((rank) => rank !== null)
      const hasEnoughData = ranks.length >= 2

      if (!hasEnoughData) {
        this._points = []
        this.setData({
          points: '',
          endX: 0,
          endY: 0,
          endRank: null,
          endLabelStyle: '',
          hasEnoughData: false
        }, () => this.draw())
        return
      }

      const minRank = Math.min.apply(null, ranks)
      const maxRank = Math.max.apply(null, ranks)
      const rankRange = maxRank - minRank
      const left = EDGE_PADDING_RATIO
      const right = 1 - EDGE_PADDING_RATIO
      const top = TOP_PADDING_RATIO
      const bottom = 1 - BOTTOM_PADDING_RATIO
      const xSpan = right - left
      const ySpan = bottom - top
      const points = ranks.map((rank, index) => {
        const xRatio = ranks.length === 1 ? 0.5 : left + (index / (ranks.length - 1)) * xSpan
        const yRatio = rankRange === 0 ? top + ySpan / 2 : top + ((rank - minRank) / rankRange) * ySpan
        return { xRatio, yRatio, rank }
      })
      const endPoint = points[points.length - 1]
      const endX = clampPercent(endPoint.xRatio * 100)
      const endY = clampPercent(endPoint.yRatio * 100)
      const pointsText = points
        .map((point) => `${(point.xRatio * 100).toFixed(2)},${(point.yRatio * 100).toFixed(2)}`)
        .join(' ')

      this._points = points
      this.setData({
        points: pointsText,
        endX,
        endY,
        endRank: endPoint.rank,
        endLabelStyle: `left: ${endX.toFixed(2)}%; top: ${endY.toFixed(2)}%;`,
        hasEnoughData: true
      }, () => this.initCanvas())
    },

    draw() {
      const ctx = this._ctx
      if (!ctx) return

      const width = this._canvasWidth || this.data.width || 320
      const height = this._canvasHeight || this.data.height || 100
      ctx.clearRect(0, 0, width, height)

      const points = this._points || []
      if (!this.data.hasEnoughData || points.length < 2) return

      ctx.save()
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(11, 12, 9, 0.10)'
      for (let i = 0; i < GRID_LINE_COUNT; i++) {
        const y = height * (TOP_PADDING_RATIO + (i / (GRID_LINE_COUNT - 1)) * (1 - TOP_PADDING_RATIO - BOTTOM_PADDING_RATIO))
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      ctx.restore()

      const canvasPoints = points.map((point) => ({
        x: point.xRatio * width,
        y: point.yRatio * height
      }))

      ctx.save()
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = this.data.color || '#0A0A0A'
      ctx.beginPath()
      canvasPoints.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y)
        } else {
          ctx.lineTo(point.x, point.y)
        }
      })
      ctx.stroke()
      ctx.restore()

      const endPoint = canvasPoints[canvasPoints.length - 1]
      ctx.save()
      ctx.fillStyle = '#BEF500'
      ctx.strokeStyle = this.data.color || '#0A0A0A'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(endPoint.x, endPoint.y, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    }
  }
})
