#!/usr/bin/env node

const {
  BUSINESS_COLLECTIONS,
  assertResetSafety,
  assertFixturePrerequisites,
  cleanupBusinessCollections,
} = require('./cleanup-test-data')
const {
  selectActors,
  buildE2EFixture,
} = require('./lib/e2e-fixture')

const VALID_MODES = new Set(['cleanup-only', 'seed-only', 'cleanup-seed-smoke'])
const PAGE_SIZE = 1000

async function runE2ERegressionSmoke({
  db,
  callFunction,
  mode,
  seasonId,
  now = new Date(),
  log = console.log,
}) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid mode "${mode}". Expected one of: ${Array.from(VALID_MODES).join(', ')}`)
  }
  if (!db) throw new Error('E2E regression smoke requires db')
  if (mode === 'cleanup-seed-smoke' && typeof callFunction !== 'function') {
    throw new Error('E2E regression smoke requires callFunction for cleanup-seed-smoke mode')
  }

  const prerequisites = {
    members: await fetchCollectionRows(db, 'members'),
    courts: await fetchCollectionRows(db, 'courts'),
    seasons: await fetchCollectionRows(db, 'seasons'),
  }
  if (prerequisites.seasons.length < 1) {
    throw new Error('Fixture prerequisites failed: need at least one season before smoke')
  }
  assertFixturePrerequisites(prerequisites)

  if (mode === 'cleanup-only' || mode === 'cleanup-seed-smoke') {
    await cleanupBusinessCollections(db, BUSINESS_COLLECTIONS, log)
  }
  if (mode === 'cleanup-only') {
    return { mode, fixture: null, smoke: [] }
  }

  const selectedSeasonId = seasonId || prerequisites.seasons[0]._id || prerequisites.seasons[0].id
  if (!selectedSeasonId) throw new Error('E2E regression smoke requires seasonId')

  const actors = selectActors(prerequisites)
  const fixture = buildE2EFixture({ actors, seasonId: selectedSeasonId, now })
  await seedFixture(db, fixture.collections, log)

  const smoke = mode === 'cleanup-seed-smoke'
    ? await runReadOnlySmoke({ callFunction, fixture, seasonId: selectedSeasonId, log })
    : []

  return { mode, fixture, smoke }
}

async function seedFixture(db, collections, log = console.log) {
  for (const [name, docs] of Object.entries(collections || {})) {
    for (const doc of docs) {
      if (!doc || !doc._id) {
        throw new Error(`Fixture collection "${name}" requires _id for every document`)
      }
      const { _id, ...data } = doc
      await db.collection(name).doc(_id).set({ data })
    }
    log(`[seed] ${name}: ${docs.length}`)
  }
}

async function runReadOnlySmoke({ callFunction, fixture, seasonId, log = console.log }) {
  if (typeof callFunction !== 'function') throw new Error('runReadOnlySmoke requires callFunction')
  if (!fixture) throw new Error('runReadOnlySmoke requires fixture')

  const playerA = fixture.actors.players[0]
  const playerB = fixture.actors.players[1]
  const expectedA = expectedSinglesSummary(fixture, playerA._id)
  const checks = []

  const rankList = await callFunction('points-engine', {
    action: 'rankList',
    type: 'singles',
    currentSeasonId: seasonId,
  })
  const rankResult = assertCloudSuccess(rankList, 'rankList.singles')
  const rankRows = requireArray(rankResult.data && rankResult.data.rankList, 'rankList.singles result.data.rankList')
  const rankA = findPlayerRow(rankRows, playerA._id)
  assertMetricExact(rankA, 'totalPoints', expectedA.totalPoints, 'rankList.singles totalPoints')
  assertMetricExact(rankA, 'winCount', expectedA.winCount, 'rankList.singles winCount')
  log('[smoke] rankList.singles: ok')
  checks.push({ name: 'rankList.singles' })

  const playerStats = await callFunction('points-engine', {
    action: 'playerStats',
    playerId: playerA._id,
    currentSeasonId: seasonId,
  })
  const statsResult = assertCloudSuccess(playerStats, 'playerStats.A')
  const stats = requireObject(statsResult.data, 'playerStats.A result.data')
  const singlesStats = requireObject(stats.stats && stats.stats.singles, 'playerStats.A result.data.stats.singles')
  assertMetricExact(singlesStats, 'totalPoints', expectedA.totalPoints, 'playerStats.A totalPoints')
  assertMetricExact(singlesStats, 'winCount', expectedA.winCount, 'playerStats.A winCount')
  const recentRows = requireArray(stats.recent, 'playerStats.A result.data.recent')
  if (recentRows.length < 1) {
    throw new Error('playerStats.A expected recent rows')
  }
  log('[smoke] playerStats.A: ok')
  checks.push({ name: 'playerStats.A' })

  const playerH2H = await callFunction('points-engine', {
    action: 'playerH2H',
    playerId: playerA._id,
    opponentId: playerB._id,
    currentSeasonId: seasonId,
  })
  const h2hResult = assertCloudSuccess(playerH2H, 'playerH2H.A')
  const h2hData = requireObject(h2hResult.data, 'playerH2H.A result.data')
  const opponentRows = requireArray(h2hData.singles, 'playerH2H.A result.data.singles')
  requireArray(h2hData.doubles, 'playerH2H.A result.data.doubles')
  if (!opponentRows.some(row => row && [row.opponentId, row.memberId, row.playerId, row.id, row._id].includes(playerB._id))) {
    throw new Error('playerH2H.A expected opponent B')
  }
  log('[smoke] playerH2H.A: ok')
  checks.push({ name: 'playerH2H.A' })

  return checks
}

function assertCloudSuccess(res, label) {
  const result = res && Object.prototype.hasOwnProperty.call(res, 'result') ? res.result : res
  if (!result || result.success !== true) {
    const message = formatCloudError(result)
    throw new Error(`${label} failed${message ? `: ${message}` : ''}`)
  }
  return result
}

function formatCloudError(result) {
  if (!result) return 'missing result'
  if (result.error && typeof result.error === 'object') {
    return [result.error.code, result.error.message].filter(Boolean).join(': ')
  }
  if (result.error) return String(result.error)
  if (result.errCode || result.errMsg) return [result.errCode, result.errMsg].filter(Boolean).join(': ')
  if (result.message) return String(result.message)
  return 'expected success true'
}

function expectedSinglesSummary(fixture, memberId) {
  let totalPoints = 0
  let winCount = 0

  for (const row of fixture.collections.match_results || []) {
    if (row.tournamentType !== 'singles' || row.resultStatus !== 'confirmed') continue
    if (row.winnerId === memberId) winCount += 1
    for (const entry of (row.pointsAwarded && row.pointsAwarded.entries) || []) {
      if (entry.memberId === memberId) totalPoints += entry.points || 0
    }
  }

  for (const row of fixture.collections.tournament_points || []) {
    if (row.tournamentType === 'singles' && row.memberId === memberId) {
      totalPoints += row.points || 0
    }
  }

  return { totalPoints, winCount }
}

function assertMetricExact(row, field, expected, label) {
  if (!row) throw new Error(`${label} expected player A row`)
  const value = row[field]
  if (value !== expected) {
    throw new Error(`${label} expected ${expected}, got ${value == null ? 'missing' : value}`)
  }
}

function findPlayerRow(rows, playerId) {
  return rows.find(row => row && [row.memberId, row.playerId, row.id, row._id].includes(playerId))
}

function requireObject(value, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`)
  }
  return value
}

function formatActorSummary(actors) {
  if (!actors) return null
  return {
    admin: formatActor(actors.adminMember),
    players: (actors.players || []).slice(0, 5).map((player, index) => ({
      label: String.fromCharCode(65 + index),
      ...formatActor(player),
    })),
  }
}

function formatActor(actor) {
  if (!actor) return null
  return {
    memberId: actor._id || actor.id || null,
    name: actor.name || '',
    openid: actor.openid || actor.openId || null,
  }
}

async function fetchCollectionRows(db, name) {
  const result = await db.collection(name).limit(PAGE_SIZE).get()
  return result.data || []
}

async function main() {
  const env = assertResetSafety(process.env)
  const mode = process.env.SMOKE_MODE || 'cleanup-seed-smoke'
  const now = new Date()
  const seasonId = process.env.SEASON_ID || `season_${now.getFullYear()}`

  console.log(`>>> Target cloud env: ${env}`)
  console.log(`>>> E2E smoke mode: ${mode}`)
  console.log(`>>> Season: ${seasonId}`)
  console.log('>>> Cloud smoke starts in 5 seconds. Press Ctrl-C to cancel.')
  await sleep(5000)

  const tcb = require('@cloudbase/node-sdk')
  const app = tcb.init({ env })
  const db = app.database()
  const result = await runE2ERegressionSmoke({
    db,
    callFunction: (name, data) => app.callFunction({ name, data }),
    mode,
    seasonId,
    now,
  })

  console.log(JSON.stringify({
    mode: result.mode,
    fixtureIds: result.fixture ? result.fixture.ids : null,
    actors: result.fixture ? formatActorSummary(result.fixture.actors) : null,
    smoke: result.smoke.map(check => check.name),
  }, null, 2))
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

if (require.main === module) {
  main().catch(err => {
    console.error(`[abort] ${err.message}`)
    process.exit(1)
  })
}

module.exports = {
  VALID_MODES,
  runE2ERegressionSmoke,
  seedFixture,
  runReadOnlySmoke,
  formatActorSummary,
}
