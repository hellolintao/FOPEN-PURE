const REGISTRATION_SHARE_IMAGES = [
  '/images/share-registration/registration-share-01.jpg',
  '/images/share-registration/registration-share-02.jpg',
  '/images/share-registration/registration-share-03.jpg',
  '/images/share-registration/registration-share-04.jpg',
  '/images/share-registration/registration-share-05.jpg'
]

const REGISTRATION_SHARE_IMAGE_INDEX_KEY = 'fopen.registrationShareImageIndex'

let fallbackRegistrationShareImageIndex = 0

function getNextRegistrationShareImage() {
  const count = REGISTRATION_SHARE_IMAGES.length
  const index = readRegistrationShareImageIndex()
  const normalizedIndex = normalizeIndex(index, count)
  const nextIndex = normalizeIndex(normalizedIndex + 1, count)
  writeRegistrationShareImageIndex(nextIndex)
  return REGISTRATION_SHARE_IMAGES[normalizedIndex]
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
  getNextRegistrationShareImage
}
