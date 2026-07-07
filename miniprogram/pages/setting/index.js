const { removeCachesByPrefix } = require('../../utils/page-cache')

const PRIVACY_PAGE_CACHE_PREFIXES = ['rank:', 'home:', 'mine:', 'match:', 'manage:']

function clearPrivacyPageCaches() {
  PRIVACY_PAGE_CACHE_PREFIXES.forEach(prefix => removeCachesByPrefix(prefix))
}

function getCurrentMember() {
  const app = getApp()
  return app && app.globalData ? app.globalData.currentMember : null
}

function confirmModal(options) {
  return new Promise(resolve => {
    wx.showModal({
      ...options,
      success(res) {
        resolve(!!(res && res.confirm))
      },
      fail() {
        resolve(false)
      }
    })
  })
}

Page({
  data: {
    currentMember: null
  },

  onShow() {
    this.setData({ currentMember: getCurrentMember() })
  },

  onOpenPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy-policy/index' })
  },

  onOpenUserAgreement() {
    wx.navigateTo({ url: '/pages/user-agreement/index' })
  },

  async onRevokePublicProfile() {
    const confirmed = await confirmModal({
      title: '撤回公开展示授权',
      content: '撤回后，排行榜、球员详情和赛事页面将匿名展示你的资料。',
      confirmText: '撤回',
      cancelText: '取消'
    })
    if (!confirmed) return

    wx.showLoading({ title: '处理中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'members',
        data: { action: 'revokePublicProfile' }
      })
      if (res && res.result && res.result.success === false) {
        throw new Error((res.result.error && res.result.error.message) || '撤回失败')
      }
      const app = getApp()
      const member = {
        ...(app.globalData.currentMember || this.data.currentMember || {}),
        publicProfileConsent: false
      }
      app.globalData.currentMember = member
      this.setData({ currentMember: member })
      clearPrivacyPageCaches()
      wx.showToast({ title: '已撤回授权', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '撤回失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async onDeleteAccount() {
    const confirmed = await confirmModal({
      title: '删除账号资料',
      content: '删除后将清空当前账号的会员资料，无法直接恢复。',
      confirmText: '删除',
      cancelText: '取消'
    })
    if (!confirmed) return

    wx.showLoading({ title: '处理中...' })
    try {
      const res = await wx.cloud.callFunction({
        name: 'members',
        data: { action: 'deleteSelf' }
      })
      if (res && res.result && res.result.success === false) {
        throw new Error((res.result.error && res.result.error.message) || '删除失败')
      }
      const app = getApp()
      app.globalData.currentMember = null
      app.globalData.isAdmin = false
      this.setData({ currentMember: null })
      clearPrivacyPageCaches()
      wx.showToast({ title: '已删除资料', icon: 'success' })
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
