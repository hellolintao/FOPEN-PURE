function installStorage(initial = {}) {
  const store = { ...initial }
  global.wx = {
    getStorageSync: jest.fn(key => store[key]),
    setStorageSync: jest.fn((key, value) => { store[key] = value }),
    removeStorageSync: jest.fn(key => { delete store[key] }),
    getStorageInfoSync: jest.fn(() => ({ keys: Object.keys(store) })),
    __store: store,
  }
}

beforeEach(() => {
  jest.resetModules()
  installStorage()
})

afterEach(() => {
  delete global.wx
})

test('nextDailyRefreshAt returns today 23:30 before the cutoff', () => {
  const { nextDailyRefreshAt } = require('../page-cache')
  const now = new Date(2026, 4, 20, 22, 10, 0)
  const refreshAt = new Date(nextDailyRefreshAt(now, 23, 30))

  expect(refreshAt.getFullYear()).toBe(2026)
  expect(refreshAt.getMonth()).toBe(4)
  expect(refreshAt.getDate()).toBe(20)
  expect(refreshAt.getHours()).toBe(23)
  expect(refreshAt.getMinutes()).toBe(30)
})

test('nextDailyRefreshAt returns tomorrow 23:30 after the cutoff', () => {
  const { nextDailyRefreshAt } = require('../page-cache')
  const now = new Date(2026, 4, 20, 23, 31, 0)
  const refreshAt = new Date(nextDailyRefreshAt(now, 23, 30))

  expect(refreshAt.getDate()).toBe(21)
  expect(refreshAt.getHours()).toBe(23)
  expect(refreshAt.getMinutes()).toBe(30)
})

test('getCache returns valid entries and hides expired entries', () => {
  const { getCache, setCache } = require('../page-cache')
  setCache('rank', { rows: [1] }, { now: 1000, expiresAt: 2000 })

  expect(getCache('rank', 1500)).toEqual({ rows: [1] })
  expect(getCache('rank', 2000)).toBeNull()
})

test('getCacheEntry exposes stale value for stale-first page rendering', () => {
  const { getCacheEntry, isFresh, setCache } = require('../page-cache')
  setCache('home', { stats: true }, { now: 1000, ttlMs: 500 })

  const entry = getCacheEntry('home')

  expect(entry.value).toEqual({ stats: true })
  expect(isFresh(entry, 1200)).toBe(true)
  expect(isFresh(entry, 1600)).toBe(false)
})

test('removeCachesByPrefix removes matching logical page cache keys only', () => {
  const { removeCachesByPrefix, setCache } = require('../page-cache')
  setCache('rank:list:v2:season_2026:singles', { rows: [] })
  setCache('rank:hero:v2:season_2026:singles', { star: true })
  setCache('home:summary:v1', { stats: true })

  const removed = removeCachesByPrefix('rank:')

  expect(removed).toBe(2)
  expect(wx.__store['fopen:page-cache:rank:list:v2:season_2026:singles']).toBeUndefined()
  expect(wx.__store['fopen:page-cache:rank:hero:v2:season_2026:singles']).toBeUndefined()
  expect(wx.__store['fopen:page-cache:home:summary:v1']).toBeTruthy()
})
