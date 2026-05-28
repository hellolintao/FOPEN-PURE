let mockState

function mockClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value))
}

function mockValueMatches(actual, expected) {
  if (expected && typeof expected === 'object') {
    if (Array.isArray(expected.$in)) return expected.$in.includes(actual)
    if (Object.prototype.hasOwnProperty.call(expected, '$gt')) return actual > expected.$gt
  }
  return actual === expected
}

function mockMatchesQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true
  if (Array.isArray(query.$or)) return query.$or.some(condition => mockMatchesQuery(doc, condition))
  return Object.entries(query).every(([key, expected]) => mockValueMatches(doc[key], expected))
}

function mockCollection(name) {
  function getMap() {
    const map = mockState.collections[name]
    if (!map) throw new Error(`Unknown collection ${name}`)
    return map
  }

  function makeQuery(initialQuery) {
    let query = initialQuery || {}
    let order = null
    let limited = null
    let skipped = 0

    const chain = {
      where(nextQuery) {
        query = nextQuery || {}
        return chain
      },
      orderBy(field, direction) {
        order = { field, direction }
        return chain
      },
      skip(value) {
        skipped = value || 0
        return chain
      },
      limit(value) {
        limited = value
        return chain
      },
      async get() {
        const map = getMap()
        let data = Array.from(map.values()).filter(doc => mockMatchesQuery(doc, query))
        if (order) {
          data = data.slice().sort((a, b) => {
            if (a[order.field] === b[order.field]) return 0
            const diff = a[order.field] > b[order.field] ? 1 : -1
            return order.direction === 'desc' ? -diff : diff
          })
        }
        if (skipped) data = data.slice(skipped)
        if (limited != null) data = data.slice(0, limited)
        return { data: mockClone(data) }
      },
      async count() {
        const map = getMap()
        return { total: Array.from(map.values()).filter(doc => mockMatchesQuery(doc, query)).length }
      },
    }

    return chain
  }

  return {
    doc(id) {
      return {
        async get() {
          const map = getMap()
          return { data: mockClone(map.get(id)) || null }
        },
        async update({ data }) {
          const map = getMap()
          const current = map.get(id) || { _id: id }
          map.set(id, { ...current, ...mockClone(data) })
          return { updated: 1 }
        },
        async remove() {
          const map = getMap()
          const existed = map.delete(id)
          return { removed: existed ? 1 : 0 }
        },
      }
    },
    async add({ data }) {
      const map = getMap()
      const doc = mockClone(data)
      const id = doc._id || `${name}_${map.size + 1}`
      if (map.has(id)) {
        const err = new Error(`Duplicate _id ${id}`)
        err.code = 'DUPLICATE_KEY'
        throw err
      }
      map.set(id, { ...doc, _id: id })
      return { _id: id }
    },
    where(query) {
      return makeQuery(query)
    },
    orderBy(field, direction) {
      return makeQuery({}).orderBy(field, direction)
    },
    async get() {
      return makeQuery({}).get()
    },
  }
}

const mockDb = {
  command: {
    or: jest.fn(conditions => ({ $or: conditions })),
    in: jest.fn(values => ({ $in: values })),
    gt: jest.fn(value => ({ $gt: value })),
    set: jest.fn(value => value),
  },
  serverDate: jest.fn(() => 'SERVER_DATE'),
  collection: jest.fn(name => mockCollection(name)),
}

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'test-env',
  getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
  database: jest.fn(() => mockDb),
}))

const { GROUP_CODES, groupBracketDocId } = require('../lib/group-knockout')
const { main } = require('../index')

function createCollections() {
  return {
    members: new Map(),
    tournaments: new Map(),
    tournament_groups: new Map(),
    tournament_brackets: new Map(),
    match_results: new Map(),
  }
}

function seedAdminMember() {
  mockState.openid = 'admin-openid'
  mockState.collections.members.set('admin-member', {
    _id: 'admin-member',
    openid: 'admin-openid',
    admin: true,
  })
}

function seedTournament(overrides = {}) {
  const tournament = {
    _id: 'tournament_gk_1',
    name: 'Group knockout',
    format: 'group_knockout',
    type: 'singles',
    bracketSize: 12,
    groupKnockoutPhase: 'group_draft',
    scheduleStatus: 'none',
    updateTime: 'OLD_TIME',
    ...overrides,
  }
  mockState.collections.tournaments.set(tournament._id, tournament)
  return tournament
}

function buildGroups() {
  return GROUP_CODES.map((groupCode, groupIndex) => ({
    groupCode,
    slots: [1, 2, 3].map(slotNo => {
      const playerNumber = groupIndex * 3 + slotNo
      return {
        slotNo,
        playerId: `p${playerNumber}`,
        playerName: `Player ${playerNumber}`,
        registrationId: `reg_${playerNumber}`,
      }
    }),
  }))
}

async function saveGroupsForTournament(tournamentId, groups = buildGroups()) {
  return main({ action: 'saveGroups', tournamentId, groups })
}

function seedSavedGroups(tournamentId, groups = buildGroups()) {
  for (const group of groups) {
    mockState.collections.tournament_groups.set(`group_${tournamentId}_${group.groupCode}`, {
      _id: `group_${tournamentId}_${group.groupCode}`,
      tournamentId,
      groupCode: group.groupCode,
      slots: group.slots,
      createTime: 'OLD_TIME',
      updateTime: 'OLD_TIME',
    })
  }
}

function seedGroupBracket(tournamentId, groupCode = 'A') {
  const id = groupBracketDocId(tournamentId, groupCode)
  mockState.collections.tournament_brackets.set(id, {
    _id: id,
    tournamentId,
    format: 'group_knockout',
    stage: 'group',
    groupCode,
    round: 1,
    type: 'singles',
    matches: [{ matchId: `old-${groupCode}`, groupCode }],
    createTime: 'OLD_TIME',
    updateTime: 'OLD_TIME',
  })
  return id
}

beforeEach(() => {
  mockState = {
    openid: 'admin-openid',
    collections: createCollections(),
  }
  seedAdminMember()
  jest.clearAllMocks()
})

test('saveGroups validates and persists four groups for a draft group knockout tournament without advancing phase', async () => {
  const tournament = seedTournament()
  mockState.collections.tournament_groups.set(`group_${tournament._id}_A`, {
    _id: `group_${tournament._id}_A`,
    tournamentId: tournament._id,
    groupCode: 'A',
    slots: [],
  })

  const result = await saveGroupsForTournament(tournament._id)

  expect(result).toEqual({ success: true, data: { count: 4 } })
  expect(Array.from(mockState.collections.tournament_groups.keys()).sort()).toEqual([
    'group_tournament_gk_1_A',
    'group_tournament_gk_1_B',
    'group_tournament_gk_1_C',
    'group_tournament_gk_1_D',
  ])
  expect(mockState.collections.tournament_groups.get('group_tournament_gk_1_A')).toMatchObject({
    _id: 'group_tournament_gk_1_A',
    tournamentId: tournament._id,
    groupCode: 'A',
    slots: buildGroups()[0].slots,
    createTime: 'SERVER_DATE',
    updateTime: 'SERVER_DATE',
  })
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_draft',
    scheduleStatus: 'none',
    updateTime: 'SERVER_DATE',
  })
})

test('saveGroups treats a missing phase as group_draft', async () => {
  const tournament = seedTournament()
  delete tournament.groupKnockoutPhase

  const result = await saveGroupsForTournament(tournament._id)

  expect(result).toEqual({ success: true, data: { count: 4 } })
  expect(mockState.collections.tournament_groups.size).toBe(4)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    scheduleStatus: 'none',
    updateTime: 'SERVER_DATE',
  })
  expect(mockState.collections.tournaments.get(tournament._id).groupKnockoutPhase).toBeUndefined()
})

test.each([
  ['null', null],
  ['empty string', ''],
  ['false', false],
])('saveGroups rejects explicit %s phase as locked', async (_label, phase) => {
  const tournament = seedTournament({ groupKnockoutPhase: phase })

  const result = await saveGroupsForTournament(tournament._id)

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({ code: 'PHASE_LOCKED', currentPhase: phase })
  expect(mockState.collections.tournament_groups.size).toBe(0)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: phase,
    scheduleStatus: 'none',
    updateTime: 'OLD_TIME',
  })
})

test.each([
  'group_published',
  'group_completed',
  'knockout_published',
  'completed',
])('saveGroups rejects locked phase %s', async phase => {
  const tournament = seedTournament({ groupKnockoutPhase: phase })

  const result = await saveGroupsForTournament(tournament._id)

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({ code: 'PHASE_LOCKED', currentPhase: phase })
  expect(mockState.collections.tournament_groups.size).toBe(0)
})

test('generateGroupMatches reads saved groups, writes group bracket docs, and publishes the group phase', async () => {
  const tournament = seedTournament()
  await saveGroupsForTournament(tournament._id)
  const oldGroupBracketId = seedGroupBracket(tournament._id, 'A')
  mockState.collections.tournament_brackets.set('knockout-bracket', {
    _id: 'knockout-bracket',
    tournamentId: tournament._id,
    stage: 'knockout',
    matches: [],
  })

  const result = await main({ action: 'generateGroupMatches', tournamentId: tournament._id })

  expect(result).toEqual({ success: true, data: { count: 12 } })
  expect(mockState.collections.tournament_brackets.has('knockout-bracket')).toBe(true)

  const groupBrackets = GROUP_CODES.map(groupCode => mockState.collections.tournament_brackets.get(groupBracketDocId(tournament._id, groupCode)))
  expect(groupBrackets).toHaveLength(4)
  expect(groupBrackets.every(Boolean)).toBe(true)
  expect(groupBrackets.map(doc => doc.matches.length)).toEqual([3, 3, 3, 3])
  expect(groupBrackets.flatMap(doc => doc.matches)).toHaveLength(12)
  expect(groupBrackets[0]).toMatchObject({
    _id: 'bracket_gk_1_group_A',
    tournamentId: tournament._id,
    format: 'group_knockout',
    stage: 'group',
    groupCode: 'A',
    round: 1,
    type: 'singles',
    createTime: 'SERVER_DATE',
    updateTime: 'SERVER_DATE',
  })
  expect(groupBrackets[0].matches[0]).toMatchObject({
    tournamentId: tournament._id,
    bracketId: 'bracket_gk_1_group_A',
    matchKind: 'group',
    stage: 'group',
    groupCode: 'A',
    type: 'singles',
    status: 'pending',
    resultStatus: 'pending',
  })
  expect(mockState.collections.tournament_brackets.get(oldGroupBracketId)).toMatchObject({
    _id: oldGroupBracketId,
    groupCode: 'A',
    createTime: 'SERVER_DATE',
    updateTime: 'SERVER_DATE',
  })
  expect(mockState.collections.tournament_brackets.get(oldGroupBracketId).matches).not.toEqual([
    { matchId: 'old-A', groupCode: 'A' },
  ])
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_published',
    scheduleStatus: 'none',
    updateTime: 'SERVER_DATE',
  })
})

test('generateGroupMatches treats a missing phase as group_draft', async () => {
  const tournament = seedTournament()
  delete tournament.groupKnockoutPhase
  seedSavedGroups(tournament._id)

  const result = await main({ action: 'generateGroupMatches', tournamentId: tournament._id })

  expect(result).toEqual({ success: true, data: { count: 12 } })
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_published',
    scheduleStatus: 'none',
    updateTime: 'SERVER_DATE',
  })
})

test.each([
  ['group_published', 'group_published'],
  ['group_completed', 'group_completed'],
  ['knockout_published', 'knockout_published'],
  ['completed', 'completed'],
  ['null', null],
  ['empty string', ''],
  ['false', false],
])('generateGroupMatches rejects locked phase %s without deleting brackets or rewriting tournament', async (_label, phase) => {
  const tournament = seedTournament({ groupKnockoutPhase: phase })
  seedSavedGroups(tournament._id)
  const existingBracketId = seedGroupBracket(tournament._id, 'A')
  const existingBracket = mockClone(mockState.collections.tournament_brackets.get(existingBracketId))

  const result = await main({ action: 'generateGroupMatches', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({ code: 'PHASE_LOCKED', currentPhase: phase })
  expect(mockState.collections.tournament_brackets.get(existingBracketId)).toEqual(existingBracket)
  expect(Array.from(mockState.collections.tournament_brackets.keys())).toEqual([existingBracketId])
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: phase,
    scheduleStatus: 'none',
    updateTime: 'OLD_TIME',
  })
})

test.each([
  ['saveGroups', { groups: buildGroups() }],
  ['generateGroupMatches', {}],
])('%s rejects non-admin callers', async (action, payload) => {
  const tournament = seedTournament()
  mockState.collections.members.set('admin-member', {
    _id: 'admin-member',
    openid: 'admin-openid',
    admin: false,
  })

  const result = await main({ action, tournamentId: tournament._id, ...payload })

  expect(result).toEqual({
    success: false,
    error: { code: 'FORBIDDEN', message: '需要管理员权限' },
  })
})
