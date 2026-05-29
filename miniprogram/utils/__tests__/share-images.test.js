const EXPECTED_REGISTRATION_SHARE_IMAGES = [
  '/images/share-registration/registration-share-01.jpg',
  '/images/share-registration/registration-share-02.jpg',
  '/images/share-registration/registration-share-03.jpg',
  '/images/share-registration/registration-share-04.jpg',
  '/images/share-registration/registration-share-05.jpg'
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
    expect(Array.from({ length: 6 }, () => getNextRegistrationShareImage())).toEqual([
      ...EXPECTED_REGISTRATION_SHARE_IMAGES,
      EXPECTED_REGISTRATION_SHARE_IMAGES[0]
    ])
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

    expect(getNextRegistrationShareImage()).toBe(EXPECTED_REGISTRATION_SHARE_IMAGES[0])
    expect(getNextRegistrationShareImage()).toBe(EXPECTED_REGISTRATION_SHARE_IMAGES[1])
  })
})
