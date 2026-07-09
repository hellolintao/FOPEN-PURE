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

const SCHEDULE_SHARE_IMAGES = [
  '/images/share-schedule/schedule-share-01.jpg',
  '/images/share-schedule/schedule-share-02.jpg',
  '/images/share-schedule/schedule-share-03.jpg',
  '/images/share-schedule/schedule-share-04.jpg'
]

const GROUP_KNOCKOUT_SCHEDULE_PHASES = [
  'group_published',
  'group_completed',
  'knockout_published',
  'completed'
]

const REGISTRATION_SHARE_IMAGE_INDEX_KEY = 'fopen.registrationShareImageIndex'
const SCHEDULE_SHARE_IMAGE_INDEX_KEY = 'fopen.scheduleShareImageIndex'

let fallbackRegistrationShareImageIndex = 0
let fallbackScheduleShareImageIndex = 0

function getNextRegistrationShareImage(options = {}) {
  const images = getRegistrationShareImageSet(options)
  return getNextRotatingImage(images, {
    storageKey: REGISTRATION_SHARE_IMAGE_INDEX_KEY,
    getFallback: () => fallbackRegistrationShareImageIndex,
    setFallback: index => { fallbackRegistrationShareImageIndex = index }
  })
}

function getNextScheduleShareImage() {
  return getNextRotatingImage(SCHEDULE_SHARE_IMAGES, {
    storageKey: SCHEDULE_SHARE_IMAGE_INDEX_KEY,
    getFallback: () => fallbackScheduleShareImageIndex,
    setFallback: index => { fallbackScheduleShareImageIndex = index }
  })
}

function getNextTournamentShareImage(tournament = {}, options = {}) {
  if (options.registrationEntry) {
    return getNextRegistrationShareImage(options)
  }
  if (shouldUseScheduleShareImage(tournament)) {
    return getNextScheduleShareImage()
  }
  return getNextRegistrationShareImage(options)
}

function shouldUseScheduleShareImage(tournament = {}) {
  if (tournament.scheduleStatus === 'published' || !!tournament.schedulePublishedAt) return true
  return tournament.format === 'group_knockout' &&
    GROUP_KNOCKOUT_SCHEDULE_PHASES.includes(tournament.groupKnockoutPhase)
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

function getNextRotatingImage(images, options) {
  const count = images.length
  const index = readShareImageIndex(options.storageKey, options.getFallback())
  const normalizedIndex = normalizeIndex(index, count)
  const nextIndex = normalizeIndex(normalizedIndex + 1, count)
  writeShareImageIndex(options.storageKey, nextIndex, options.setFallback)
  return images[normalizedIndex]
}

function readShareImageIndex(storageKey, fallbackIndex) {
  if (typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') {
    return fallbackIndex
  }
  try {
    const value = Number(wx.getStorageSync(storageKey))
    return Number.isFinite(value) ? value : 0
  } catch (err) {
    return fallbackIndex
  }
}

function writeShareImageIndex(storageKey, index, setFallback) {
  setFallback(index)
  if (typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return
  try {
    wx.setStorageSync(storageKey, index)
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
  SCHEDULE_SHARE_IMAGES,
  getRegistrationShareImageSet,
  getNextRegistrationShareImage,
  getNextScheduleShareImage,
  getNextTournamentShareImage
}
