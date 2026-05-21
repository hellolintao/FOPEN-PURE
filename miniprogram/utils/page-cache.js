const PREFIX = 'fopen:page-cache:'

function storageKey(key) {
  return `${PREFIX}${key}`
}

function nowMs(now) {
  if (now instanceof Date) return now.getTime()
  if (typeof now === 'number') return now
  return Date.now()
}

function getCacheEntry(key) {
  if (!key || typeof wx === 'undefined' || !wx.getStorageSync) return null
  try {
    const entry = wx.getStorageSync(storageKey(key))
    if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'value')) return null
    return entry
  } catch (err) {
    return null
  }
}

function isFresh(entry, now) {
  if (!entry) return false
  const expiresAt = Number(entry.expiresAt)
  if (!Number.isFinite(expiresAt)) return true
  return expiresAt > nowMs(now)
}

function getCache(key, now) {
  const entry = getCacheEntry(key)
  return isFresh(entry, now) ? entry.value : null
}

function setCache(key, value, options = {}) {
  if (!key || typeof wx === 'undefined' || !wx.setStorageSync) return null
  const updatedAt = nowMs(options.now)
  const expiresAt = Number.isFinite(Number(options.expiresAt))
    ? Number(options.expiresAt)
    : (Number.isFinite(Number(options.ttlMs)) ? updatedAt + Number(options.ttlMs) : null)
  const entry = { value, updatedAt, expiresAt }
  try {
    wx.setStorageSync(storageKey(key), entry)
  } catch (err) {
    return null
  }
  return entry
}

function removeCache(key) {
  if (!key || typeof wx === 'undefined' || !wx.removeStorageSync) return
  try {
    wx.removeStorageSync(storageKey(key))
  } catch (err) {}
}

function removeCachesByPrefix(prefix) {
  if (!prefix || typeof wx === 'undefined' || !wx.getStorageInfoSync || !wx.removeStorageSync) return 0
  const fullPrefix = storageKey(prefix)
  try {
    const info = wx.getStorageInfoSync()
    const keys = (info && info.keys) || []
    let removed = 0
    keys.forEach(key => {
      if (typeof key !== 'string' || !key.startsWith(fullPrefix)) return
      try {
        wx.removeStorageSync(key)
        removed += 1
      } catch (err) {}
    })
    return removed
  } catch (err) {
    return 0
  }
}

function nextDailyRefreshAt(now = new Date(), hour = 23, minute = 30) {
  const base = now instanceof Date ? now : new Date(now)
  const refresh = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0)
  if (base.getTime() >= refresh.getTime()) {
    refresh.setDate(refresh.getDate() + 1)
  }
  return refresh.getTime()
}

module.exports = {
  getCache,
  getCacheEntry,
  isFresh,
  nextDailyRefreshAt,
  removeCache,
  removeCachesByPrefix,
  setCache,
}
