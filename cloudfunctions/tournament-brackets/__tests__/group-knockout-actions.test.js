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

const { GROUP_CODES, groupBracketDocId, knockoutBracketDocId } = require('../lib/group-knockout')
const { main } = require('../index')

function createCollections() {
  return {
    members: new Map(),
    tournaments: new Map(),
    tournament_groups: new Map(),
    tournament_brackets: new Map(),
    match_results: new Map(),
    tournament_snapshots: new Map(),
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
    seasonId: 'season_2026',
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

function buildGroupBracketMatches(tournamentId, group) {
  const pairs = [[1, 2], [1, 3], [2, 3]]
  return pairs.map(([slotNo1, slotNo2], index) => {
    const slot1 = group.slots.find(slot => slot.slotNo === slotNo1)
    const slot2 = group.slots.find(slot => slot.slotNo === slotNo2)
    return {
      matchId: `match_${group.groupCode}_${slotNo1}_${slotNo2}`,
      tournamentId,
      bracketId: groupBracketDocId(tournamentId, group.groupCode),
      matchKind: 'group',
      stage: 'group',
      groupCode: group.groupCode,
      groupSlot1: slotNo1,
      groupSlot2: slotNo2,
      round: index + 1,
      position: index + 1,
      type: 'singles',
      player1: playerFromSlot(slot1),
      player2: playerFromSlot(slot2),
      status: 'pending',
      resultStatus: 'pending',
    }
  })
}

function seedGroupBracket(tournamentId, groupCode = 'A', group = null) {
  const id = groupBracketDocId(tournamentId, groupCode)
  mockState.collections.tournament_brackets.set(id, {
    _id: id,
    tournamentId,
    format: 'group_knockout',
    stage: 'group',
    groupCode,
    round: 1,
    type: 'singles',
    matches: group ? buildGroupBracketMatches(tournamentId, group) : [{ matchId: `old-${groupCode}`, groupCode }],
    createTime: 'OLD_TIME',
    updateTime: 'OLD_TIME',
  })
  return id
}

function seedAllGroupBrackets(tournamentId, groups = buildGroups()) {
  return groups.map(group => seedGroupBracket(tournamentId, group.groupCode, group))
}

function playerFromSlot(slot) {
  return {
    id: slot.playerId,
    name: slot.playerName,
    registrationId: slot.registrationId,
  }
}

function seedGroupResult(tournamentId, groupCode, player1Slot, player2Slot, a, b, overrides = {}) {
  const winnerSlot = a > b ? player1Slot : player2Slot
  const id = overrides._id || `result_${tournamentId}_${groupCode}_${player1Slot.slotNo}_${player2Slot.slotNo}`
  mockState.collections.match_results.set(id, {
    _id: id,
    tournamentId,
    sourceMatchId: `match_${groupCode}_${player1Slot.slotNo}_${player2Slot.slotNo}`,
    stage: 'group',
    matchKind: 'group',
    groupCode,
    player1: playerFromSlot(player1Slot),
    player2: playerFromSlot(player2Slot),
    score: { sets: [{ a, b }], tiebreak: null },
    resultStatus: 'confirmed',
    winner: playerFromSlot(winnerSlot),
    ...overrides,
  })
  return id
}

function seedClearConfirmedGroupResults(tournamentId, groups = buildGroups()) {
  for (const group of groups) {
    const [slot1, slot2, slot3] = group.slots
    seedGroupResult(tournamentId, group.groupCode, slot1, slot2, 4, 1)
    seedGroupResult(tournamentId, group.groupCode, slot1, slot3, 4, 0)
    seedGroupResult(tournamentId, group.groupCode, slot2, slot3, 4, 2)
  }
}

function seedUnresolvedTieResults(tournamentId, groupCode, slots) {
  seedGroupResult(tournamentId, groupCode, slots[0], slots[1], 4, 2)
  seedGroupResult(tournamentId, groupCode, slots[0], slots[2], 2, 4)
  seedGroupResult(tournamentId, groupCode, slots[1], slots[2], 4, 2)
}

function seedKnockoutBracket(tournamentId, round = 1, overrides = {}) {
  const id = knockoutBracketDocId(tournamentId, round)
  mockState.collections.tournament_brackets.set(id, {
    _id: id,
    tournamentId,
    format: 'group_knockout',
    stage: 'knockout',
    round,
    type: 'singles',
    matches: [{ matchId: `old-ko-${round}`, round, position: 1 }],
    createTime: 'OLD_TIME',
    updateTime: 'OLD_TIME',
    ...overrides,
  })
  return id
}

function seedKnockoutResult(tournamentId, id, resultStatus = 'pending', overrides = {}) {
  mockState.collections.match_results.set(id, {
    _id: id,
    tournamentId,
    sourceMatchId: id,
    stage: 'knockout',
    matchKind: 'bracket',
    resultStatus,
    ...overrides,
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
  const groupResultRows = Array.from(mockState.collections.match_results.values())
    .filter(row => row.stage === 'group')
  expect(groupResultRows).toHaveLength(12)
  expect(mockState.collections.match_results.get(`result_gk_1_${groupBrackets[0].matches[0].matchId}`)).toMatchObject({
    tournamentId: tournament._id,
    seasonId: tournament.seasonId,
    tournamentType: 'singles',
    type: 'singles',
    format: 'group_knockout',
    stage: 'group',
    groupCode: 'A',
    groupSlot1: 1,
    groupSlot2: 2,
    matchKind: 'group',
    sourceMatchId: groupBrackets[0].matches[0].matchId,
    resultStatus: 'pending',
    score: null,
    winner: null,
    pointsAwarded: null,
    playerIds: ['p1', 'p2'],
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

test('getGroupKnockoutBracket returns groups, standings, and knockout docs', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'knockout_published' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id)
  seedClearConfirmedGroupResults(tournament._id, groups)
  seedKnockoutBracket(tournament._id, 1)
  mockState.collections.members.set('admin-member', {
    _id: 'admin-member',
    openid: 'admin-openid',
    admin: false,
  })

  const result = await main({ action: 'getGroupKnockoutBracket', tournamentId: tournament._id })

  expect(result.success).toBe(true)
  expect(result.data.tournament).toMatchObject({
    _id: tournament._id,
    format: 'group_knockout',
  })
  expect(result.data.groups.map(group => group.groupCode)).toEqual(['A', 'B', 'C', 'D'])
  expect(Object.keys(result.data.standings)).toEqual(['A', 'B', 'C', 'D'])
  expect(result.data.standings.A.rows.map(row => row.source)).toEqual(['A1', 'A2', ''])
  expect(result.data.groupBrackets).toHaveLength(4)
  expect(result.data.groupBrackets.map(bracket => bracket.stage)).toEqual(['group', 'group', 'group', 'group'])
  expect(result.data.knockoutBrackets).toHaveLength(1)
  expect(result.data.knockoutBrackets[0]).toMatchObject({
    _id: knockoutBracketDocId(tournament._id, 1),
    stage: 'knockout',
    round: 1,
  })
})

test('confirmKnockoutSeeds blocks unresolved manual tie without mutation', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id)
  seedUnresolvedTieResults(tournament._id, 'A', groups[0].slots)
  for (const group of groups.slice(1)) {
    seedClearConfirmedGroupResults(tournament._id, [group])
  }
  const existingKnockoutId = seedKnockoutBracket(tournament._id, 1)
  const existingKnockout = mockClone(mockState.collections.tournament_brackets.get(existingKnockoutId))

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'MANUAL_TIEBREAK_REQUIRED',
    groupCodes: ['A'],
  })
  expect(mockState.collections.tournament_brackets.get(existingKnockoutId)).toEqual(existingKnockout)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    updateTime: 'OLD_TIME',
  })
})

test('confirmKnockoutSeeds requires complete group brackets and confirmed results', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  groups.slice(0, 3).forEach(group => seedGroupBracket(tournament._id, group.groupCode, group))
  seedClearConfirmedGroupResults(tournament._id, groups)

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUPS_NOT_READY',
  })
  expect(mockState.collections.tournament_brackets.size).toBe(3)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    updateTime: 'OLD_TIME',
  })
})

test('confirmKnockoutSeeds rejects missing expected group result by bracket match id', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  mockState.collections.match_results.delete(`result_${tournament._id}_A_1_3`)

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUPS_NOT_READY',
    details: {
      missingSourceMatchIds: ['match_A_1_3'],
    },
  })
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    updateTime: 'OLD_TIME',
  })
})

test('confirmKnockoutSeeds rejects duplicate confirmed sourceMatchId even when counts balance', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  mockState.collections.match_results.delete(`result_${tournament._id}_A_1_3`)
  seedGroupResult(tournament._id, 'A', groups[0].slots[0], groups[0].slots[1], 4, 2, {
    _id: `result_${tournament._id}_A_duplicate`,
    sourceMatchId: 'match_A_1_2',
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUPS_NOT_READY',
    details: {
      missingSourceMatchIds: ['match_A_1_3'],
      duplicateSourceMatchIds: ['match_A_1_2'],
    },
  })
  expect(mockState.collections.tournaments.get(tournament._id).groupKnockoutPhase).toBe('group_completed')
})

test('confirmKnockoutSeeds rejects unrelated extra confirmed group rows even when counts balance', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  mockState.collections.match_results.delete(`result_${tournament._id}_A_1_3`)
  seedGroupResult(tournament._id, 'A', groups[0].slots[0], groups[0].slots[2], 4, 0, {
    _id: `result_${tournament._id}_A_unrelated`,
    sourceMatchId: 'match_A_unrelated',
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUPS_NOT_READY',
    details: {
      missingSourceMatchIds: ['match_A_1_3'],
      unrelatedResultIds: [`result_${tournament._id}_A_unrelated`],
    },
  })
  expect(mockState.collections.tournaments.get(tournament._id).groupKnockoutPhase).toBe('group_completed')
})

test('confirmKnockoutSeeds rejects unrelated extra confirmed legacy group row without matchKind', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  seedGroupResult(tournament._id, 'A', groups[0].slots[0], groups[0].slots[1], 4, 1, {
    _id: `result_${tournament._id}_A_legacy_unrelated`,
    sourceMatchId: 'legacy_unrelated_A',
    matchKind: undefined,
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUPS_NOT_READY',
    details: {
      unrelatedResultIds: [`result_${tournament._id}_A_legacy_unrelated`],
    },
  })
  expect(mockState.collections.tournaments.get(tournament._id).groupKnockoutPhase).toBe('group_completed')
})

test('confirmKnockoutSeeds rejects confirmed result players that do not match the bracket match', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  const row = mockState.collections.match_results.get(`result_${tournament._id}_A_1_3`)
  mockState.collections.match_results.set(row._id, {
    ...row,
    player2: playerFromSlot(groups[1].slots[0]),
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUPS_NOT_READY',
    details: {
      playerMismatchSourceMatchIds: ['match_A_1_3'],
    },
  })
  expect(mockState.collections.tournaments.get(tournament._id).groupKnockoutPhase).toBe('group_completed')
})

test('confirmKnockoutSeeds rejects confirmed result rows with incomplete players', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  const row = mockState.collections.match_results.get(`result_${tournament._id}_A_1_3`)
  mockState.collections.match_results.set(row._id, {
    ...row,
    player2: null,
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUPS_NOT_READY',
    details: {
      playerMismatchSourceMatchIds: ['match_A_1_3'],
    },
  })
  expect(mockState.collections.tournaments.get(tournament._id).groupKnockoutPhase).toBe('group_completed')
})

test('confirmKnockoutSeeds accepts expected group rows before stage and groupCode are persisted', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  const row = mockState.collections.match_results.get(`result_${tournament._id}_A_1_3`)
  mockState.collections.match_results.set(row._id, {
    ...row,
    stage: undefined,
    groupCode: undefined,
    matchKind: 'group',
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(true)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'knockout_published',
    updateTime: 'SERVER_DATE',
  })
})

test('confirmKnockoutSeeds creates knockout brackets and freezes rank snapshots', async () => {
  const groups = buildGroups()
  const manualOverrides = {
    C: {
      groupCode: 'C',
      reason: 'manual_tiebreak',
      finalRows: groups[2].slots.map(slot => ({ playerId: slot.playerId })),
      overrideBy: 'admin-openid',
      overrideAt: 'OLD_TIME',
    },
  }
  const tournament = seedTournament({
    groupKnockoutPhase: 'group_completed',
    groupRankSnapshot: { manualOverrides },
  })
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  seedKnockoutBracket(tournament._id, 1)

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result).toMatchObject({
    success: true,
    data: {
      knockoutRounds: 3,
      seeds: {
        A1: { id: 'p1', name: 'Player 1', registrationId: 'reg_1' },
        A2: { id: 'p2', name: 'Player 2', registrationId: 'reg_2' },
        B1: { id: 'p4', name: 'Player 4', registrationId: 'reg_4' },
        B2: { id: 'p5', name: 'Player 5', registrationId: 'reg_5' },
        C1: { id: 'p7', name: 'Player 7', registrationId: 'reg_7' },
        C2: { id: 'p8', name: 'Player 8', registrationId: 'reg_8' },
        D1: { id: 'p10', name: 'Player 10', registrationId: 'reg_10' },
        D2: { id: 'p11', name: 'Player 11', registrationId: 'reg_11' },
      },
    },
  })

  const knockoutBrackets = [1, 2, 3].map(round => mockState.collections.tournament_brackets.get(knockoutBracketDocId(tournament._id, round)))
  expect(knockoutBrackets.every(Boolean)).toBe(true)
  expect(knockoutBrackets.map(bracket => bracket.stage)).toEqual(['knockout', 'knockout', 'knockout'])
  expect(knockoutBrackets[0].matches.map(match => [match.player1Source, match.player2Source])).toEqual([
    ['A1', 'C2'],
    ['B1', 'D2'],
    ['C1', 'A2'],
    ['D1', 'B2'],
  ])
  expect(knockoutBrackets[0].matches.map(match => [match.player1.id, match.player2.id])).toEqual([
    ['p1', 'p8'],
    ['p4', 'p11'],
    ['p7', 'p2'],
    ['p10', 'p5'],
  ])
  for (const bracket of knockoutBrackets.slice(1)) {
    expect(bracket.matches.every(match => match.player1 === null && match.player2 === null)).toBe(true)
    expect(bracket.matches.every(match => match.player1Source === undefined && match.player2Source === undefined)).toBe(true)
  }
  const knockoutResultRows = Array.from(mockState.collections.match_results.values())
    .filter(row => row.stage === 'knockout')
    .sort((a, b) => (a.round - b.round) || (a.position - b.position))
  expect(knockoutResultRows).toHaveLength(7)
  expect(knockoutResultRows.filter(row => row.round === 1)).toHaveLength(4)
  expect(knockoutResultRows.filter(row => row.round === 2)).toHaveLength(2)
  expect(knockoutResultRows.filter(row => row.round === 3)).toHaveLength(1)
  expect(mockState.collections.match_results.get(`result_gk_1_${knockoutBrackets[0].matches[0].matchId}`)).toMatchObject({
    tournamentId: tournament._id,
    seasonId: tournament.seasonId,
    tournamentType: 'singles',
    type: 'singles',
    format: 'group_knockout',
    stage: 'knockout',
    matchKind: 'bracket',
    sourceMatchId: knockoutBrackets[0].matches[0].matchId,
    round: 1,
    position: 1,
    player1: { id: 'p1' },
    player2: { id: 'p8' },
    playerIds: ['p1', 'p8'],
    resultStatus: 'pending',
    score: null,
    winner: null,
    pointsAwarded: null,
  })
  expect(mockState.collections.match_results.get(`result_gk_1_${knockoutBrackets[1].matches[0].matchId}`)).toMatchObject({
    stage: 'knockout',
    round: 2,
    position: 1,
    player1: null,
    player2: null,
    playerIds: [],
    resultStatus: 'pending',
  })
  expect(mockState.collections.match_results.get(`result_gk_1_${knockoutBrackets[2].matches[0].matchId}`)).toMatchObject({
    stage: 'knockout',
    round: 3,
    position: 1,
    player1: null,
    player2: null,
    playerIds: [],
    resultStatus: 'pending',
  })
  expect(GROUP_CODES.map(groupCode => mockState.collections.tournament_brackets.has(groupBracketDocId(tournament._id, groupCode)))).toEqual([true, true, true, true])

  const updatedTournament = mockState.collections.tournaments.get(tournament._id)
  expect(updatedTournament).toMatchObject({
    groupKnockoutPhase: 'knockout_published',
    scheduleStatus: 'none',
    updateTime: 'SERVER_DATE',
    groupRankSnapshot: {
      metadata: {
        confirmedBy: 'admin-openid',
        confirmedAt: 'SERVER_DATE',
      },
      version: 1,
    },
    knockoutSeedSnapshot: {
      metadata: {
        confirmedBy: 'admin-openid',
        confirmedAt: 'SERVER_DATE',
      },
      version: 1,
    },
  })
  expect(updatedTournament.groupRankSnapshot.confirmedBy).toBeUndefined()
  expect(updatedTournament.groupRankSnapshot.confirmedAt).toBeUndefined()
  expect(updatedTournament.knockoutSeedSnapshot.confirmedBy).toBeUndefined()
  expect(updatedTournament.knockoutSeedSnapshot.confirmedAt).toBeUndefined()
  expect(updatedTournament.groupRankSnapshot.seeds).toBeUndefined()
  expect(updatedTournament.groupRankSnapshot.groups.A).toMatchObject({ groupCode: 'A' })
  expect(updatedTournament.groupRankSnapshot.manualOverrides).toEqual(manualOverrides)
  expect(updatedTournament.groupRankSnapshot.sourceResultIds).toHaveLength(12)
  expect(updatedTournament.knockoutSeedSnapshot.seeds).toEqual(result.data.seeds)
  expect(updatedTournament.knockoutSeedSnapshot.standings).toBeUndefined()
  expect(updatedTournament.knockoutSeedSnapshot.bracket).toHaveLength(3)
  expect(updatedTournament.knockoutSeedSnapshot.bracketDocIds).toEqual([
    knockoutBracketDocId(tournament._id, 1),
    knockoutBracketDocId(tournament._id, 2),
    knockoutBracketDocId(tournament._id, 3),
  ])
  expect(updatedTournament.knockoutSeedSnapshot.seedSources.A1).toMatchObject({
    groupCode: 'A',
    rank: 1,
    playerId: 'p1',
  })
})

test('confirmKnockoutSeeds replaces stale deterministic knockout docs even without stage', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  seedKnockoutBracket(tournament._id, 2, {
    stage: undefined,
    matches: [{ matchId: 'stale-round-2', round: 2, position: 1 }],
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(true)
  expect(mockState.collections.tournament_brackets.get(knockoutBracketDocId(tournament._id, 2))).toMatchObject({
    _id: knockoutBracketDocId(tournament._id, 2),
    stage: 'knockout',
    round: 2,
  })
  expect(mockState.collections.tournament_brackets.get(knockoutBracketDocId(tournament._id, 2)).matches).not.toEqual([
    { matchId: 'stale-round-2', round: 2, position: 1 },
  ])
})

test('confirmKnockoutSeeds removes pending knockout match results when reconfirming seeds', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  const pendingResultId = seedKnockoutResult(tournament._id, 'pending_knockout_result', 'pending')

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(true)
  expect(mockState.collections.match_results.has(pendingResultId)).toBe(false)
})

test('confirmKnockoutSeeds removes pending knockout result without stage when it matches an existing knockout match id', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  seedKnockoutBracket(tournament._id, 1, {
    matches: [{ matchId: 'existing-ko-r1-m1', round: 1, position: 1 }],
  })
  const pendingResultId = seedKnockoutResult(tournament._id, 'pending_knockout_without_stage', 'pending', {
    sourceMatchId: 'existing-ko-r1-m1',
    stage: undefined,
    matchKind: undefined,
  })

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(true)
  expect(mockState.collections.match_results.has(pendingResultId)).toBe(false)
})

test('confirmKnockoutSeeds blocks confirmed knockout match results without mutation', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  const knockoutBracketId = seedKnockoutBracket(tournament._id, 1)
  const confirmedResultId = seedKnockoutResult(tournament._id, 'confirmed_knockout_result', 'confirmed')
  const existingBracket = mockClone(mockState.collections.tournament_brackets.get(knockoutBracketId))

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'KNOCKOUT_ALREADY_STARTED',
    resultIds: [confirmedResultId],
  })
  expect(mockState.collections.tournament_brackets.get(knockoutBracketId)).toEqual(existingBracket)
  expect(mockState.collections.match_results.has(confirmedResultId)).toBe(true)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    updateTime: 'OLD_TIME',
  })
})

test('confirmKnockoutSeeds blocks confirmed knockout result without stage when it matches an existing knockout match id', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  seedAllGroupBrackets(tournament._id, groups)
  seedClearConfirmedGroupResults(tournament._id, groups)
  const knockoutBracketId = seedKnockoutBracket(tournament._id, 1, {
    matches: [{ matchId: 'existing-ko-r1-m1', round: 1, position: 1 }],
  })
  const confirmedResultId = seedKnockoutResult(tournament._id, 'confirmed_knockout_without_stage', 'confirmed', {
    sourceMatchId: 'existing-ko-r1-m1',
    stage: undefined,
    matchKind: undefined,
  })
  const existingBracket = mockClone(mockState.collections.tournament_brackets.get(knockoutBracketId))

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'KNOCKOUT_ALREADY_STARTED',
    resultIds: [confirmedResultId],
  })
  expect(mockState.collections.tournament_brackets.get(knockoutBracketId)).toEqual(existingBracket)
  expect(mockState.collections.match_results.has(confirmedResultId)).toBe(true)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    updateTime: 'OLD_TIME',
  })
})

test.each([
  ['missing', undefined],
  ['group_published', 'group_published'],
  ['knockout_published', 'knockout_published'],
  ['completed', 'completed'],
  ['null', null],
  ['empty string', ''],
  ['false', false],
])('confirmKnockoutSeeds rejects locked phase %s without deleting existing docs', async (_label, phase) => {
  const tournament = seedTournament({ groupKnockoutPhase: phase })
  if (phase === undefined) delete tournament.groupKnockoutPhase
  const groupBracketId = seedGroupBracket(tournament._id, 'A')
  const knockoutBracketId = seedKnockoutBracket(tournament._id, 1)
  const groupBracket = mockClone(mockState.collections.tournament_brackets.get(groupBracketId))
  const knockoutBracket = mockClone(mockState.collections.tournament_brackets.get(knockoutBracketId))

  const result = await main({ action: 'confirmKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({ code: 'PHASE_LOCKED', currentPhase: phase === undefined ? 'group_draft' : phase })
  expect(mockState.collections.tournament_brackets.get(groupBracketId)).toEqual(groupBracket)
  expect(mockState.collections.tournament_brackets.get(knockoutBracketId)).toEqual(knockoutBracket)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    scheduleStatus: 'none',
    updateTime: 'OLD_TIME',
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

test('resetGroups rejects when any group match is confirmed', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_published' })
  seedGroupResult(tournament._id, 'A', buildGroups()[0].slots[0], buildGroups()[0].slots[1], 4, 1)

  const result = await main({ action: 'resetGroups', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({ code: 'GROUP_ALREADY_STARTED' })
  expect(mockState.collections.match_results.size).toBe(1)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_published',
    updateTime: 'OLD_TIME',
  })
})

test('resetGroups rejects confirmed legacy group rows matched by existing bracket match id', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_published' })
  const groups = buildGroups()
  const groupBracketId = seedGroupBracket(tournament._id, 'A', groups[0])
  const confirmedResultId = seedGroupResult(tournament._id, 'A', groups[0].slots[0], groups[0].slots[1], 4, 1, {
    _id: 'legacy_confirmed_group_result',
    sourceMatchId: 'match_A_1_2',
    stage: undefined,
    groupCode: undefined,
    matchKind: undefined,
  })
  const bracket = mockClone(mockState.collections.tournament_brackets.get(groupBracketId))

  const result = await main({ action: 'resetGroups', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUP_ALREADY_STARTED',
    resultIds: [confirmedResultId],
  })
  expect(mockState.collections.tournament_brackets.get(groupBracketId)).toEqual(bracket)
  expect(mockState.collections.match_results.has(confirmedResultId)).toBe(true)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_published',
    updateTime: 'OLD_TIME',
  })
})

test('resetGroups rejects confirmed legacy group rows by groupCode even with unrelated source match id', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_published' })
  const groups = buildGroups()
  const groupBracketId = seedGroupBracket(tournament._id, 'A', groups[0])
  const confirmedResultId = seedGroupResult(tournament._id, 'A', groups[0].slots[0], groups[0].slots[1], 4, 1, {
    _id: 'legacy_confirmed_group_result_unrelated_source',
    sourceMatchId: 'legacy-unrelated-source-match',
    stage: undefined,
    matchKind: undefined,
  })
  const bracket = mockClone(mockState.collections.tournament_brackets.get(groupBracketId))
  const resultRow = mockClone(mockState.collections.match_results.get(confirmedResultId))

  const result = await main({ action: 'resetGroups', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'GROUP_ALREADY_STARTED',
    resultIds: [confirmedResultId],
  })
  expect(mockState.collections.tournament_brackets.get(groupBracketId)).toEqual(bracket)
  expect(mockState.collections.match_results.get(confirmedResultId)).toEqual(resultRow)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_published',
    updateTime: 'OLD_TIME',
  })
})

test('resetGroups clears group brackets and rewinds phase to group_draft', async () => {
  const tournament = seedTournament({
    groupKnockoutPhase: 'group_published',
    groupRankSnapshot: { groups: { A: [] } },
  })
  const groups = buildGroups()
  seedSavedGroups(tournament._id, groups)
  const groupBracketId = seedGroupBracket(tournament._id, 'A', groups[0])
  const knockoutBracketId = seedKnockoutBracket(tournament._id, 1)
  const pendingGroupResultId = seedGroupResult(tournament._id, 'A', groups[0].slots[0], groups[0].slots[1], 4, 1, {
    _id: 'pending_group_result',
    resultStatus: 'pending',
  })
  const pendingLegacyGroupResultId = seedGroupResult(tournament._id, 'A', groups[0].slots[0], groups[0].slots[2], 4, 1, {
    _id: 'pending_legacy_group_result',
    sourceMatchId: 'match_A_1_3',
    stage: undefined,
    groupCode: undefined,
    matchKind: undefined,
    resultStatus: 'pending',
  })
  const pendingKnockoutResultId = seedKnockoutResult(tournament._id, 'pending_knockout_result', 'pending')

  const result = await main({ action: 'resetGroups', tournamentId: tournament._id })

  expect(result).toEqual({ success: true, data: { removedBrackets: 1, removedRows: 2 } })
  expect(mockState.collections.tournament_brackets.has(groupBracketId)).toBe(false)
  expect(mockState.collections.tournament_brackets.has(knockoutBracketId)).toBe(true)
  expect(mockState.collections.match_results.has(pendingGroupResultId)).toBe(false)
  expect(mockState.collections.match_results.has(pendingLegacyGroupResultId)).toBe(false)
  expect(mockState.collections.match_results.has(pendingKnockoutResultId)).toBe(true)
  expect(mockState.collections.tournament_groups.size).toBe(4)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_draft',
    groupRankSnapshot: null,
    updateTime: 'SERVER_DATE',
  })
})

test('resetGroups rejects locked group_completed phase without mutation', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const groupBracketId = seedGroupBracket(tournament._id, 'A')
  const bracket = mockClone(mockState.collections.tournament_brackets.get(groupBracketId))

  const result = await main({ action: 'resetGroups', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({ code: 'PHASE_LOCKED', currentPhase: 'group_completed' })
  expect(mockState.collections.tournament_brackets.get(groupBracketId)).toEqual(bracket)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    updateTime: 'OLD_TIME',
  })
})

test('resetKnockoutSeeds rejects confirmed knockout scores', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'knockout_published' })
  const confirmedResultId = seedKnockoutResult(tournament._id, 'confirmed_knockout_result', 'confirmed')

  const result = await main({ action: 'resetKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'KNOCKOUT_ALREADY_STARTED',
    resultIds: [confirmedResultId],
  })
  expect(mockState.collections.match_results.has(confirmedResultId)).toBe(true)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'knockout_published',
    updateTime: 'OLD_TIME',
  })
})

test('resetKnockoutSeeds rejects confirmed legacy knockout scores matched by existing bracket match id', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'knockout_published' })
  const knockoutBracketId = seedKnockoutBracket(tournament._id, 1, {
    matches: [{ matchId: 'existing-ko-r1-m1', round: 1, position: 1 }],
  })
  const confirmedResultId = seedKnockoutResult(tournament._id, 'legacy_confirmed_knockout_result', 'confirmed', {
    sourceMatchId: 'existing-ko-r1-m1',
    stage: undefined,
    matchKind: undefined,
  })

  const result = await main({ action: 'resetKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({
    code: 'KNOCKOUT_ALREADY_STARTED',
    resultIds: [confirmedResultId],
  })
  expect(mockState.collections.tournament_brackets.has(knockoutBracketId)).toBe(true)
  expect(mockState.collections.match_results.has(confirmedResultId)).toBe(true)
})

test('resetKnockoutSeeds removes stale deterministic knockout docs even without stage', async () => {
  const tournament = seedTournament({
    groupKnockoutPhase: 'knockout_published',
    groupRankSnapshot: { groups: { A: [] } },
    knockoutSeedSnapshot: { seeds: {}, version: 1 },
  })
  const groupBracketId = seedGroupBracket(tournament._id, 'A')
  const deterministicKnockoutBracketId = seedKnockoutBracket(tournament._id, 2, {
    stage: undefined,
    matches: [{ matchId: 'stale-round-2', round: 2, position: 1 }],
  })
  const extraKnockoutBracketId = 'custom_knockout_bracket'
  mockState.collections.tournament_brackets.set(extraKnockoutBracketId, {
    _id: extraKnockoutBracketId,
    tournamentId: tournament._id,
    format: 'group_knockout',
    stage: 'knockout',
    round: 9,
    type: 'singles',
    matches: [{ matchId: 'custom-ko', round: 9, position: 1 }],
  })

  const result = await main({ action: 'resetKnockoutSeeds', tournamentId: tournament._id })

  expect(result).toEqual({ success: true, data: { removedBrackets: 2, removedRows: 0 } })
  expect(mockState.collections.tournament_brackets.has(groupBracketId)).toBe(true)
  expect(mockState.collections.tournament_brackets.has(deterministicKnockoutBracketId)).toBe(false)
  expect(mockState.collections.tournament_brackets.has(extraKnockoutBracketId)).toBe(false)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    knockoutSeedSnapshot: null,
    groupRankSnapshot: null,
    updateTime: 'SERVER_DATE',
  })
})

test('resetKnockoutSeeds archives old snapshot to tournament_snapshots', async () => {
  const oldSnapshot = {
    seeds: { A1: { id: 'p1', name: 'Player 1' } },
    metadata: { confirmedBy: 'admin-openid', confirmedAt: 'OLD_TIME' },
    version: 1,
  }
  const tournament = seedTournament({
    groupKnockoutPhase: 'knockout_published',
    groupRankSnapshot: { groups: { A: [] } },
    knockoutSeedSnapshot: oldSnapshot,
  })
  const groupBracketId = seedGroupBracket(tournament._id, 'A')
  const knockoutBracketId = seedKnockoutBracket(tournament._id, 1)
  const pendingKnockoutResultId = seedKnockoutResult(tournament._id, 'pending_knockout_result', 'pending')

  const result = await main({ action: 'resetKnockoutSeeds', tournamentId: tournament._id })

  expect(result).toEqual({ success: true, data: { removedBrackets: 1, removedRows: 1 } })
  expect(mockState.collections.tournament_brackets.has(groupBracketId)).toBe(true)
  expect(mockState.collections.tournament_brackets.has(knockoutBracketId)).toBe(false)
  expect(mockState.collections.match_results.has(pendingKnockoutResultId)).toBe(false)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    knockoutSeedSnapshot: null,
    groupRankSnapshot: null,
    updateTime: 'SERVER_DATE',
  })
  const snapshots = Array.from(mockState.collections.tournament_snapshots.values())
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0]).toMatchObject({
    tournamentId: tournament._id,
    kind: 'knockoutSeedSnapshot',
    snapshot: oldSnapshot,
    overwrittenAt: 'SERVER_DATE',
  })
})

test('resetKnockoutSeeds rejects locked group_completed phase without mutation', async () => {
  const tournament = seedTournament({ groupKnockoutPhase: 'group_completed' })
  const knockoutBracketId = seedKnockoutBracket(tournament._id, 1)
  const bracket = mockClone(mockState.collections.tournament_brackets.get(knockoutBracketId))

  const result = await main({ action: 'resetKnockoutSeeds', tournamentId: tournament._id })

  expect(result.success).toBe(false)
  expect(result.error).toMatchObject({ code: 'PHASE_LOCKED', currentPhase: 'group_completed' })
  expect(mockState.collections.tournament_brackets.get(knockoutBracketId)).toEqual(bracket)
  expect(mockState.collections.tournaments.get(tournament._id)).toMatchObject({
    groupKnockoutPhase: 'group_completed',
    updateTime: 'OLD_TIME',
  })
})

test.each([
  ['saveGroups', { groups: buildGroups() }],
  ['generateGroupMatches', {}],
  ['confirmKnockoutSeeds', {}],
  ['resetGroups', {}],
  ['resetKnockoutSeeds', {}],
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
