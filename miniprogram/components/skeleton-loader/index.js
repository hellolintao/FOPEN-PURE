Component({
  properties: {
    rows: { type: Number, value: 3 }
  },
  data: {
    rowList: []
  },
  observers: {
    rows(rows) {
      this.setData({ rowList: buildRows(rows) })
    }
  },
  lifetimes: {
    attached() {
      this.setData({ rowList: buildRows(this.data.rows) })
    }
  }
})

function buildRows(rows) {
  return Array.from({ length: rows || 3 }, (_, index) => index)
}
