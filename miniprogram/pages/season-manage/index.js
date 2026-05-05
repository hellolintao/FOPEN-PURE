Page({
  data: {
    seasonList: [],
    showAddDialog: false,
    newSeason: { name: '', startDate: '', endDate: '' },
    showEditDialog: false,
    editSeason: { _id: '', name: '', startDate: '', endDate: '' }
  },
  onShow() {
    console.log('onShow')
    this.getSeasonList()
  },
  getSeasonList() {
    wx.cloud.callFunction({
      name: 'seasons',
      data: { action: 'list' },
      success: res => {
        this.setData({ seasonList: res.result.data || [] })
      }
    })
  },
  onDeleteSeason(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '警告',
      content: '删除后不可恢复，确定要删除吗？',
      success: res => {
        if (res.confirm) {
          wx.cloud.callFunction({
            name: 'seasons',
            data: { action: 'delete', id },
            success: () => {
              wx.showToast({ title: '删除成功', icon: 'none' })
              this.getSeasonList()
            }
          })
        }
      }
    })
  },
  onEditSeason(e) {
    const id = e.currentTarget.dataset.id
    const season = this.data.seasonList.find(s => s._id === id)
    this.setData({
      showEditDialog: true,
      editSeason: { ...season }
    })
  },
  onEditInputName(e) {
    this.setData({ 'editSeason.name': e.detail.value })
  },
  onEditPickStartDate(e) {
    this.setData({ 'editSeason.startDate': e.detail.value })
  },
  onEditPickEndDate(e) {
    this.setData({ 'editSeason.endDate': e.detail.value })
  },
  onCancelEdit() {
    this.setData({ showEditDialog: false })
  },
  onConfirmEdit() {
    const { _id, name, startDate, endDate } = this.data.editSeason
    wx.cloud.callFunction({
      name: 'seasons',
      data: {
        action: 'update',
        id: _id,
        data: { name, startDate, endDate }
      },
      success: () => {
        wx.showToast({ title: '保存成功', icon: 'none' })
        this.setData({ showEditDialog: false })
        this.getSeasonList()
      }
    })
  },
  onAddSeason() {
    this.setData({ showAddDialog: true, newSeason: { name: '', startDate: '', endDate: '' } })
  },
  onInputName(e) {
    this.setData({ 'newSeason.name': e.detail.value })
  },
  onPickStartDate(e) {
    this.setData({ 'newSeason.startDate': e.detail.value })
  },
  onPickEndDate(e) {
    this.setData({ 'newSeason.endDate': e.detail.value })
  },
  onCancelAdd() {
    this.setData({ showAddDialog: false })
  },
  onConfirmAdd() {
    const { name, startDate, endDate } = this.data.newSeason
    if (!name || !startDate || !endDate) {
      wx.showToast({ title: '请填写完整', icon: 'none' })
      return
    }
    wx.cloud.callFunction({
      name: 'seasons',
      data: {
        action: 'add',
        data: {
          _id: 'season_' + Date.now(),
          name,
          startDate,
          endDate
        }
      },
      success: () => {
        wx.showToast({ title: '新增成功', icon: 'none' })
        this.setData({ showAddDialog: false })
        this.getSeasonList()
      }
    })
  }
})
