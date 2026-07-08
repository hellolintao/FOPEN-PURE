jest.mock('wx-server-sdk', () => {
  const db = {
    command: {
      in: values => ({ $in: values }),
      remove: jest.fn(() => ({ $remove: true })),
    },
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        get: jest.fn(async () => ({ data: null })),
        update: jest.fn(async () => ({})),
      })),
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ data: [] })),
        limit: jest.fn(() => ({ get: jest.fn(async () => ({ data: [] })) })),
      })),
      add: jest.fn(async () => ({})),
    })),
    serverDate: jest.fn(() => 'server-date'),
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    database: jest.fn(() => db),
  }
})

const { __test__ } = require('../index')
const { buildBatchCtx, buildSubmitCtx } = __test__

test('buildBatchCtx.afterSettlement refreshes rank cache and analytics cache', async () => {
  const calls = []
  const ctx = buildBatchCtx({
    _id: 'admin1',
    openid: 'openid_admin',
    isAdmin: true,
  }, true, {
    callFunction: async ({ name, data }) => {
      calls.push({ name, data })
      if (name === 'points-engine') {
        return { result: { success: true, data: { settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }] } } }
      }
      return { result: { success: true, data: { analyticsStatus: 'success' } } }
    },
    getMatchesByIds: async () => [
      { _id: 'm1', seasonId: 'season_2026', tournamentType: 'singles', playerIds: ['A', 'B'] },
    ],
  })

  const result = await ctx.afterSettlement({ successIds: ['m1'], requestId: 'req1' })

  expect(result.analyticsStatus).toBe('success')
  expect(result.settlementImpact).toEqual([{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }])
  expect(calls).toEqual([
    { name: 'points-engine', data: { action: 'refreshRankCache', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], writeSnapshot: true, snapshotKind: 'settlement' } },
    { name: 'analytics-engine', data: { action: 'refreshAfterSettlement', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], matchIds: ['m1'] } },
  ])
})

test('buildBatchCtx.afterSettlement refreshes each season when successful rows span seasons', async () => {
  const calls = []
  const ctx = buildBatchCtx({
    _id: 'admin1',
    openid: 'openid_admin',
    isAdmin: true,
  }, true, {
    callFunction: async ({ name, data }) => {
      calls.push({ name, data })
      if (name === 'points-engine') {
        return { result: { success: true, data: { settlementImpact: [{ seasonId: data.seasonId, memberId: data.affectedMemberIds[0] }] } } }
      }
      return { result: { success: true, data: { analyticsStatus: 'success' } } }
    },
    getMatchesByIds: async () => [
      { _id: 'm1', seasonId: 'season_2026', tournamentType: 'singles', playerIds: ['A', 'B'] },
      { _id: 'm2', seasonId: 'season_2025', tournamentType: 'singles', playerIds: ['C', 'D'] },
    ],
  })

  const result = await ctx.afterSettlement({ successIds: ['m1', 'm2'], requestId: 'req_multi_season' })

  expect(result.analyticsStatus).toBe('success')
  expect(result.refreshedMatchIds).toEqual(['m1', 'm2'])
  expect(calls).toEqual([
    { name: 'points-engine', data: { action: 'refreshRankCache', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], writeSnapshot: true, snapshotKind: 'settlement' } },
    { name: 'analytics-engine', data: { action: 'refreshAfterSettlement', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], matchIds: ['m1'] } },
    { name: 'points-engine', data: { action: 'refreshRankCache', seasonId: 'season_2025', affectedMemberIds: ['C', 'D'], writeSnapshot: true, snapshotKind: 'settlement' } },
    { name: 'analytics-engine', data: { action: 'refreshAfterSettlement', seasonId: 'season_2025', affectedMemberIds: ['C', 'D'], matchIds: ['m2'] } },
  ])
  expect(result.settlementImpact).toEqual([
    { seasonId: 'season_2026', memberId: 'A' },
    { seasonId: 'season_2025', memberId: 'C' },
  ])
})

test('buildSubmitCtx exposes tournament-level settlement refresh hook', async () => {
  const calls = []
  const ctx = buildSubmitCtx({
    _id: 'admin1',
    openid: 'openid_admin',
    isAdmin: true,
  }, {
    callFunction: async ({ name, data }) => {
      calls.push({ name, data })
      if (name === 'points-engine') {
        return { result: { success: true, data: { settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }] } } }
      }
      return { result: { success: true, data: { analyticsStatus: 'success' } } }
    },
    getMatchesByTournament: async () => [
      { _id: 'm1', seasonId: 'season_2026', tournamentType: 'singles', playerIds: ['A', 'B'], tournamentId: 't1' },
    ],
  })

  const result = await ctx.afterSettlementByTournament({ tournamentId: 't1', requestId: 'req2' })

  expect(result.analyticsStatus).toBe('success')
  expect(calls).toEqual([
    { name: 'points-engine', data: { action: 'refreshRankCache', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], writeSnapshot: true, snapshotKind: 'settlement' } },
    { name: 'analytics-engine', data: { action: 'refreshAfterSettlement', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], matchIds: ['m1'] } },
  ])
})
