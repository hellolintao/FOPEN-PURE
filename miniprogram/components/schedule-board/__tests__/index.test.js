const fs = require('fs')
const path = require('path')

function loadComponent() {
  jest.resetModules()
  let def
  global.Component = d => { def = d }
  global.wx = {
    showActionSheet: jest.fn(),
    showToast: jest.fn()
  }
  require('../index')
  return def
}

function makeCtx(def, overrides = {}) {
  return {
    ...def.methods,
    properties: {
      tournament: { format: 'regular', type: 'mixed' },
      registrations: [],
      schedulePlan: { courts: [] },
      matches: [],
      freePlays: [],
      queues: [],
      members: [],
      ...(overrides.properties || {})
    },
    data: {
      pickerShow: false,
      pickerCtx: null,
      pickerRequiredCount: 1,
      pickerExclude: [],
      pickerMembers: [],
      pickerTitle: '',
      matches: [],
      queues: [{ courtId: 'c1', items: [] }],
      freePlays: [],
      ...(overrides.data || {})
    },
    setData(patch) {
      Object.assign(this.data, patch)
    },
    triggerEvent: jest.fn()
  }
}

describe('schedule-board add menu', () => {
  test('mixed regular empty slot offers singles, doubles, and free play', () => {
    const def = loadComponent()
    const ctx = makeCtx(def)
    ctx.openAddMatchPicker = jest.fn()
    wx.showActionSheet.mockImplementation(({ itemList, success }) => {
      expect(itemList).toEqual(['单打', '双打', '自由拉球'])
      success({ tapIndex: 1 })
    })

    ctx.onTapEmpty({ currentTarget: { dataset: { courtId: 'c1', slotIndex: '0' } } })

    expect(ctx.openAddMatchPicker).toHaveBeenCalledWith({
      kind: 'addMatchAt',
      courtId: 'c1',
      slotIndex: 0,
      matchType: 'doubles'
    })
  })

  test('singles regular empty slot only offers singles match and free play', () => {
    const def = loadComponent()
    const ctx = makeCtx(def, { properties: { tournament: { format: 'regular', type: 'singles' } } })
    ctx.openAddMatchPicker = jest.fn()
    wx.showActionSheet.mockImplementation(({ itemList, success }) => {
      expect(itemList).toEqual(['单打', '自由拉球'])
      success({ tapIndex: 0 })
    })

    ctx.onTapEmpty({ currentTarget: { dataset: { courtId: 'c1', slotIndex: '0' } } })

    expect(ctx.openAddMatchPicker).toHaveBeenCalledWith({
      kind: 'addMatchAt',
      courtId: 'c1',
      slotIndex: 0,
      matchType: 'singles'
    })
  })

  test('doubles regular empty slot only offers doubles match and free play', () => {
    const def = loadComponent()
    const ctx = makeCtx(def, { properties: { tournament: { format: 'regular', type: 'doubles' } } })
    ctx.openAddMatchPicker = jest.fn()
    wx.showActionSheet.mockImplementation(({ itemList, success }) => {
      expect(itemList).toEqual(['双打', '自由拉球'])
      success({ tapIndex: 0 })
    })

    ctx.onTapEmpty({ currentTarget: { dataset: { courtId: 'c1', slotIndex: '0' } } })

    expect(ctx.openAddMatchPicker).toHaveBeenCalledWith({
      kind: 'addMatchAt',
      courtId: 'c1',
      slotIndex: 0,
      matchType: 'doubles'
    })
  })

  test('regular empty slot can add free play without picker', () => {
    const def = loadComponent()
    const ctx = makeCtx(def)
    ctx.applyAddFreePlayAt = jest.fn()
    wx.showActionSheet.mockImplementation(({ success }) => success({ tapIndex: 2 }))

    ctx.onTapEmpty({ currentTarget: { dataset: { courtId: 'c1', slotIndex: '2' } } })

    expect(ctx.applyAddFreePlayAt).toHaveBeenCalledWith('c1', 2)
  })

  test('non-regular empty slot only offers free play', () => {
    const def = loadComponent()
    const ctx = makeCtx(def, { properties: { tournament: { format: 'knockout', type: 'singles' } } })
    ctx.applyAddFreePlayAt = jest.fn()
    wx.showActionSheet.mockImplementation(({ itemList, success }) => {
      expect(itemList).toEqual(['自由拉球'])
      success({ tapIndex: 0 })
    })

    ctx.onTapEmpty({ currentTarget: { dataset: { courtId: 'c1', slotIndex: '0' } } })

    expect(ctx.applyAddFreePlayAt).toHaveBeenCalledWith('c1', 0)
  })

  test('add picker title and count follow match type', () => {
    const def = loadComponent()
    const members = [{ _id: 'p1', name: 'A' }, { _id: 'p2', name: 'B' }, { _id: 'p3', name: 'C' }]
    const registrations = [
      { playerId: 'p1', playerName: 'A' },
      { playerId: 'p3', playerName: 'C' }
    ]
    const ctx = makeCtx(def, { properties: { members, registrations } })

    ctx.openAddMatchPicker({ kind: 'addMatchAt', courtId: 'c1', slotIndex: 0, matchType: 'doubles' })

    expect(ctx.data.pickerShow).toBe(true)
    expect(ctx.data.pickerRequiredCount).toBe(4)
    expect(ctx.data.pickerTitle).toBe('选择双打球员')
    expect(ctx.data.pickerMembers).toEqual([
      { _id: 'p1', name: 'A', avatarUrl: undefined, registrationId: undefined },
      { _id: 'p3', name: 'C', avatarUrl: undefined, registrationId: undefined }
    ])
  })

  test('assembled doubles match stores per-match type and partners', () => {
    const def = loadComponent()
    const registrations = [
      { playerId: 'p1', playerName: 'A' },
      { playerId: 'p2', playerName: 'B' },
      { playerId: 'p3', playerName: 'C' },
      { playerId: 'p4', playerName: 'D' },
    ]
    const ctx = makeCtx(def, { properties: { registrations } })

    const match = ctx.assemblePlayerObjects(['p1', 'p2', 'p3', 'p4'], 'm1', 'doubles')

    expect(match).toMatchObject({
      matchId: 'm1',
      type: 'doubles',
      player1: { id: 'p1', partnerId: 'p2' },
      player2: { id: 'p3', partnerId: 'p4' }
    })
  })
})

describe('schedule-board schedule warnings', () => {
  test('marks matches orange when one player appears twice in the same slot', () => {
    const def = loadComponent()
    const schedulePlan = {
      courts: [
        { courtId: 'c1', slots: ['2026-05-25T08:00'] },
        { courtId: 'c2', slots: ['2026-05-25T08:00'] }
      ]
    }
    const queues = [
      { courtId: 'c1', items: [{ kind: 'match', matchId: 'm1', order: 0 }] },
      { courtId: 'c2', items: [{ kind: 'match', matchId: 'm2', order: 0 }] }
    ]
    const matches = [
      { matchId: 'm1', player1: { id: 'p1', name: 'A' }, player2: { id: 'p2', name: 'B' } },
      { matchId: 'm2', player1: { id: 'p1', name: 'A' }, player2: { id: 'p3', name: 'C' } }
    ]
    const ctx = makeCtx(def, { properties: { schedulePlan, queues, matches }, data: { queues, matches } })

    const decoratedQueues = ctx._decorate(queues, matches, [])
    const rows = ctx._buildRows(schedulePlan, decoratedQueues)

    expect(rows[0].cells.map(cell => cell.__slotConflict)).toEqual([true, true])
    expect(rows[0].cells.map(cell => cell.__duplicate)).toEqual([false, false])
  })

  test('keeps duplicate red styling higher priority than same-slot conflict orange styling', () => {
    const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
    const wxss = fs.readFileSync(path.join(__dirname, '../index.wxss'), 'utf8')

    expect(wxml.indexOf("cell.__slotConflict ? 'cell-slot-conflict' : ''")).toBeLessThan(
      wxml.indexOf("cell.__duplicate ? 'cell-duplicate' : ''")
    )
    expect(wxss.indexOf('.schedule-cell.cell-slot-conflict')).toBeLessThan(
      wxss.indexOf('.schedule-cell.cell-duplicate')
    )
  })
})
