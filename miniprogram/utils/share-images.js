const REGISTRATION_SHARE_IMAGES = [
  '/images/share-registration/registration-share-01.jpg',
  '/images/share-registration/registration-share-02.jpg',
  '/images/share-registration/registration-share-03.jpg',
  '/images/share-registration/registration-share-04.jpg',
  '/images/share-registration/registration-share-05.jpg'
]

const JUNE_2026_REGISTRATION_SHARE_IMAGES = [
  '/images/share-registration/june-2026-registration-share-01.jpg',
  '/images/share-registration/june-2026-registration-share-02.jpg',
  '/images/share-registration/june-2026-registration-share-03.jpg',
  '/images/share-registration/june-2026-registration-share-04.jpg'
]

const REGISTRATION_SHARE_IMAGE_INDEX_KEY = 'fopen.registrationShareImageIndex'

let fallbackRegistrationShareImageIndex = 0

function getNextRegistrationShareImage(options = {}) {
  const images = getRegistrationShareImageSet(options)
  const count = images.length
  const index = readRegistrationShareImageIndex()
  const normalizedIndex = normalizeIndex(index, count)
  const nextIndex = normalizeIndex(normalizedIndex + 1, count)
  writeRegistrationShareImageIndex(nextIndex)
  return images[normalizedIndex]
}

function getRegistrationShareImageSet(options = {}) {
  const now = options.now || new Date()
  if (isJune2026(now)) return JUNE_2026_REGISTRATION_SHARE_IMAGES
  return REGISTRATION_SHARE_IMAGES
}

function isJune2026(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date.getFullYear() === 2026 && date.getMonth() === 5
}

function readRegistrationShareImageIndex() {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') {
    return fallbackRegistrationShareImageIndex
  }
  try {
    const value = Number(wx.getStorageSync(REGISTRATION_SHARE_IMAGE_INDEX_KEY))
    return Number.isFinite(value) ? value : 0
  } catch (err) {
    return fallbackRegistrationShareImageIndex
  }
}

function writeRegistrationShareImageIndex(index) {
  fallbackRegistrationShareImageIndex = index
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  try {
    wx.setStorageSync(REGISTRATION_SHARE_IMAGE_INDEX_KEY, index)
  } catch (err) {
    // Storage can be unavailable in tests or restricted runtimes; in-memory rotation is enough there.
  }
}

function normalizeIndex(index, count) {
  const value = Math.floor(Number(index))
  if (!Number.isFinite(value) || count <= 0) return 0
  return ((value % count) + count) % count
}

module.exports = {
  REGISTRATION_SHARE_IMAGES,
  JUNE_2026_REGISTRATION_SHARE_IMAGES,
  getRegistrationShareImageSet,
  getNextRegistrationShareImage
}
