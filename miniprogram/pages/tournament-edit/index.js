Page({
  data: {
    isEdit: false,
    tournament: { name: '', seasonId: '', startDate: '', endDate: '', location: '', type: '', description: '' },
    typeOptions: ['单打', '双打'],
    typeIndex: 0,
    seasonOptions: [],
    seasonIndex: 0
  },
  onLoad(options) {
    wx.cloud.callFunction({
      name: 'seasons',
      data: { action: 'list', pageSize: 100 },
      success: res => {
        // 赛季数据的唯一标识是 _id
        const seasonOptions = (res.result.data || []).map(s => ({ label: s.name, value: s._id }))
        let seasonIndex = 0
        let tournament = this.data.tournament
        console.log(res.result, seasonOptions)
        if (options.tournament) {
          const t = JSON.parse(decodeURIComponent(options.tournament))
          const idx = this.data.typeOptions.indexOf(t.type)
          // 这里也要用 _id 匹配
          const sidx = seasonOptions.findIndex(s => s.value === t.seasonId)
          seasonIndex = sidx >= 0 ? sidx : 0
          tournament = t
          this.setData({
            isEdit: true,
            typeIndex: idx >= 0 ? idx : 0
          })
        }
        // 如果是新增，默认选中第一个赛季
        if (!tournament.seasonId && seasonOptions.length > 0) {
          tournament.seasonId = seasonOptions[seasonIndex].value
        }
        this.setData({
          seasonOptions,
          seasonIndex,
          tournament
        })
      }
    })
  },
  onInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`tournament.${key}`]: e.detail.value })
  },
  onPickSeason(e) {
    const idx = e.detail.value
    console.log('pick season', e)
    this.setData({
      seasonIndex: idx,
      'tournament.seasonId': this.data.seasonOptions[idx].value
    })
  },
  onPickType(e) {
    const idx = e.detail.value
    this.setData({
      typeIndex: idx,
      'tournament.type': this.data.typeOptions[idx]
    })
  },
  onPickStart(e) {
    this.setData({ 'tournament.startDate': e.detail.value })
  },
  onPickEnd(e) {
    this.setData({ 'tournament.endDate': e.detail.value })
  },
  onSubmit() {
    const t = this.data.tournament
    if (!t.name || !t.seasonId || !t.startDate || !t.endDate || !t.location || !t.type) {
      wx.showToast({ title: '请填写完整', icon: 'none' })
      return
    }
    if (this.data.isEdit) {
      // 不能更新_id字段，需移除
      const { _id, ...updateData } = t
      wx.cloud.callFunction({
        name: 'tournaments',
        data: {
          action: 'update',
          id: _id,
          data: updateData
        },
        success: () => {
          wx.showToast({ title: '保存成功', icon: 'success' })
          wx.navigateBack()
        },
        fail: () => {
          wx.showToast({ title: '保存失败', icon: 'error' })
        }
      })
    } else {
      wx.cloud.callFunction({
        name: 'tournaments',
        data: {
          action: 'add',
          data: { ...t, _id: 'tournament_' + Date.now() }
        },
        success: () => {
          wx.showToast({ title: '新增成功', icon: 'success' })
          wx.navigateBack()
        },
        fail: () => {
          wx.showToast({ title: '新增失败', icon: 'error' })
        }
      })
    }
  },
  onCancel() {
    wx.showModal({
      title: '确认取消',
      content: '确定要放弃当前编辑内容吗？',
      success: res => {
        if (res.confirm) {
          wx.navigateBack()
        }
      }
    })
  }
})
