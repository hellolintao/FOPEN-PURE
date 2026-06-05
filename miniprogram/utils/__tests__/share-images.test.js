const EXPECTED_REGISTRATION_SHARE_IMAGES = [
  '/images/share-registration/registration-share-01.jpg',
  '/images/share-registration/registration-share-02.jpg',
  '/images/share-registration/registration-share-03.jpg',
  '/images/share-registration/registration-share-04.jpg',
  '/images/share-registration/registration-share-05.jpg'
]

const EXPECTED_JUNE_2026_SHARE_IMAGES = [
  '/images/share-registration/june-2026-registration-share-01.jpg',
  '/images/share-registration/june-2026-registration-share-02.jpg',
  '/images/share-registration/june-2026-registration-share-03.jpg',
  '/images/share-registration/june-2026-registration-share-04.jpg'
]

describe('registration share images', () => {
  beforeEach(() => {
    jest.resetModules()
    const storage = {}
    global.wx = {
      getStorageSync: jest.fn(key => storage[key]),
      setStorageSync: jest.fn((key, value) => {
        storage[key] = value
      })
    }
  })

  test('cycles through packaged registration share images', () => {
    const {
      REGISTRATION_SHARE_IMAGES,
      getNextRegistrationShareImage
    } = require('../share-images')

    expect(REGISTRATION_SHARE_IMAGES).toEqual(EXPECTED_REGISTRATION_SHARE_IMAGES)
    expect(Array.from({ length: 6 }, () => getNextRegistrationShareImage({ now: new Date('2026-07-01T00:00:00+08:00') }))).toEqual([
      ...EXPECTED_REGISTRATION_SHARE_IMAGES,
      EXPECTED_REGISTRATION_SHARE_IMAGES[0]
    ])
  })

  test('uses the temporary June 2026 share image set only during June 2026', () => {
    const {
      JUNE_2026_REGISTRATION_SHARE_IMAGES,
      getRegistrationShareImageSet,
      getNextRegistrationShareImage
    } = require('../share-images')

    expect(JUNE_2026_REGISTRATION_SHARE_IMAGES).toEqual(EXPECTED_JUNE_2026_SHARE_IMAGES)
    expect(getRegistrationShareImageSet({ now: new Date('2026-06-01T00:00:00+08:00') })).toEqual(EXPECTED_JUNE_2026_SHARE_IMAGES)
    expect(getRegistrationShareImageSet({ now: new Date('2026-06-30T23:59:59+08:00') })).toEqual(EXPECTED_JUNE_2026_SHARE_IMAGES)
    expect(getRegistrationShareImageSet({ now: new Date('2026-07-01T00:00:00+08:00') })).toEqual(EXPECTED_REGISTRATION_SHARE_IMAGES)
    expect(getNextRegistrationShareImage({ now: new Date('2026-06-05T15:30:00+08:00') })).toBe(EXPECTED_JUNE_2026_SHARE_IMAGES[0])
  })

  test('falls back to in-memory rotation when storage is unavailable', () => {
    global.wx = {
      getStorageSync: jest.fn(() => {
        throw new Error('storage unavailable')
      }),
      setStorageSync: jest.fn(() => {
        throw new Error('storage unavailable')
      })
    }
    const { getNextRegistrationShareImage } = require('../share-images')

    expect(getNextRegistrationShareImage({ now: new Date('2026-07-01T00:00:00+08:00') })).toBe(EXPECTED_REGISTRATION_SHARE_IMAGES[0])
    expect(getNextRegistrationShareImage({ now: new Date('2026-07-01T00:00:00+08:00') })).toBe(EXPECTED_REGISTRATION_SHARE_IMAGES[1])
  })
})
