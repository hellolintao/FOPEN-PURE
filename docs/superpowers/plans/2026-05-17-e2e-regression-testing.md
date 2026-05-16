# E2E Regression Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable regression suite for the full tournament flow: create/schedule matches, submit scores, confirm/save results, update points, and verify rank/player-detail/my-match surfaces.

**Architecture:** Add fast local Jest coverage around pure business invariants and page orchestration first, then extend the existing cloud cleanup script into a guarded cleanup/seed/smoke tool. The cloud smoke is split into database-level aggregation checks and DevTools/login-state checks because `match-results` write actions depend on `wxContext.OPENID`.

**Tech Stack:** Node.js + Jest 29, WeChat Mini Program native JS tests, `@cloudbase/node-sdk` scripts, existing WeChat cloud functions.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `docs/superpowers/specs/2026-05-17-e2e-regression-testing-design.md` | read only | Source spec for this plan |
| `scripts/package.json` | modify | Add Jest script/devDependency for scripts tests |
| `scripts/package-lock.json` | modify | Lock Jest dependency for scripts package |
| `scripts/cleanup-test-data.js` | modify | Preserve existing cleanup behavior, export helpers, add 8 collections and third safety variable |
| `scripts/lib/e2e-fixture.js` | create | Build deterministic E2E fixture docs from existing members/courts/seasons |
| `scripts/e2e-regression-smoke.js` | create | Orchestrate cleanup-only, seed-only, cleanup-seed-smoke modes |
| `scripts/__tests__/cleanup-test-data.test.js` | create | RED/GREEN tests for cleanup targets and safety guards |
| `scripts/__tests__/e2e-fixture.test.js` | create | RED/GREEN tests for fixture document shape and score schema |
| `scripts/__tests__/e2e-regression-smoke.test.js` | create | RED/GREEN tests for smoke orchestration using fake DB/cloud calls |
| `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js` | modify | Add regression assertions for tiebreak scores and admin save |
| `cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js` | modify | Add admin-as-player and bucket shape regressions |
| `cloudfunctions/match-results/lib/__tests__/state.test.js` | modify | Add full regular/doubles/knockout regression coverage not already present |
| `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js` | modify | Add fixture-level rank aggregation assertions |
| `cloudfunctions/points-engine/lib/__tests__/player-stats.test.js` | modify | Add recent score/tiebreak/doubles opponent assertions |
| `miniprogram/pages/tournament-score/__tests__/index.test.js` | modify | Add member submit sheet and retry/close refresh tests |
| `miniprogram/pages/my-match/__tests__/index.test.js` | create | Test pending/submitted navigation and load states |
| `miniprogram/pages/rank/__tests__/index.test.js` | create | Test rank/hero loading, tab changes, and navigation |
| `miniprogram/pages/player-detail/__tests__/index.test.js` | create | Test stats/H2H/recent mapping and H2H navigation |
| `docs/testing/e2e-regression-checklist.md` | create | Manual E2E checklist with steps, page expectations, and database assertions |
| `docs/testing/e2e-regression-runbook.md` | create | Commands for local tests, cloud smoke, DevTools smoke, and cleanup |

---

## Task 1: Scripts Jest Harness and Cleanup Safety

**Files:**
- Modify: `scripts/package.json`
- Modify: `scripts/package-lock.json`
- Modify: `scripts/cleanup-test-data.js`
- Create: `scripts/__tests__/cleanup-test-data.test.js`

- [ ] **Step 1: Write the failing cleanup safety tests**

Create `scripts/__tests__/cleanup-test-data.test.js`:

```js
const {
  BUSINESS_COLLECTIONS,
  assertResetSafety,
  assertFixturePrerequisites,
} = require('../cleanup-test-data')

describe('cleanup-test-data safety contract', () => {
  test('business collections include rank snapshots and weekly stars', () => {
    expect(BUSINESS_COLLECTIONS).toEqual([
      'tournaments',
      'tournament_brackets',
      'tournament_registrations',
      'match_results',
      'tournament_points',
      'free_plays',
      'rank_snapshots',
      'weekly_stars',
    ])
  })

  test('requires FOPEN_RESET_BUSINESS_DATA=YES in addition to matching env confirmation', () => {
    expect(() => assertResetSafety({
      FOPEN_CLOUD_ENV: 'cloud_test',
      FOPEN_CLEANUP_CONFIRM: 'cloud_test',
    })).toThrow(/FOPEN_RESET_BUSINESS_DATA/)

    expect(() => assertResetSafety({
      FOPEN_CLOUD_ENV: 'cloud_test',
      FOPEN_CLEANUP_CONFIRM: 'cloud_test',
      FOPEN_RESET_BUSINESS_DATA: 'YES',
    })).not.toThrow()
  })

  test('rejects mismatched cloud env confirmation', () => {
    expect(() => assertResetSafety({
      FOPEN_CLOUD_ENV: 'cloud_a',
      FOPEN_CLEANUP_CONFIRM: 'cloud_b',
      FOPEN_RESET_BUSINESS_DATA: 'YES',
    })).toThrow(/FOPEN_CLEANUP_CONFIRM/)
  })

  test('requires at least one admin, five normal members, and two courts before destructive cleanup', () => {
    expect(() => assertFixturePrerequisites({
      members: [
        { _id: 'admin', admin: true },
        { _id: 'm1' },
        { _id: 'm2' },
        { _id: 'm3' },
        { _id: 'm4' },
      ],
      courts: [{ _id: 'c1', enabled: true }, { _id: 'c2', enabled: true }],
    })).toThrow(/5 normal members/)

    expect(() => assertFixturePrerequisites({
      members: [
        { _id: 'admin', admin: true },
        { _id: 'm1' },
        { _id: 'm2' },
        { _id: 'm3' },
        { _id: 'm4' },
        { _id: 'm5' },
      ],
      courts: [{ _id: 'c1', enabled: true }, { _id: 'c2', enabled: true }],
    })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npx jest ../scripts/__tests__/cleanup-test-data.test.js --env=node --runInBand
```

Expected: FAIL because `scripts/cleanup-test-data.js` currently runs immediately on require and does not export `BUSINESS_COLLECTIONS`, `assertResetSafety`, or `assertFixturePrerequisites`.

- [ ] **Step 3: Update `scripts/package.json` to make scripts tests first-class**

Modify `scripts/package.json`:

```json
{
  "name": "fopen-scripts",
  "version": "1.0.0",
  "private": true,
  "description": "Local maintenance scripts for FOPEN-PURE",
  "license": "UNLICENSED",
  "scripts": {
    "audit:polish-data": "node audit-polish-data.js",
    "test": "jest"
  },
  "dependencies": {
    "@cloudbase/node-sdk": "^2.10.0"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.js"]
  }
}
```

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm install
```

Expected: `scripts/package-lock.json` records Jest. No app code changes.

- [ ] **Step 4: Refactor cleanup script minimally to pass the safety tests**

Replace the top-level constants and CLI guard in `scripts/cleanup-test-data.js` with this shape, preserving the existing row-removal loop:

```js
#!/usr/bin/env node

const tcb = require('@cloudbase/node-sdk')

const BUSINESS_COLLECTIONS = [
  'tournaments',
  'tournament_brackets',
  'tournament_registrations',
  'match_results',
  'tournament_points',
  'free_plays',
  'rank_snapshots',
  'weekly_stars',
]

const PAGE_SIZE = 1000

function assertResetSafety(env = process.env) {
  if (!env.FOPEN_CLOUD_ENV || env.FOPEN_CLEANUP_CONFIRM !== env.FOPEN_CLOUD_ENV) {
    throw new Error('FOPEN_CLEANUP_CONFIRM must be set and equal to FOPEN_CLOUD_ENV')
  }
  if (env.FOPEN_RESET_BUSINESS_DATA !== 'YES') {
    throw new Error('FOPEN_RESET_BUSINESS_DATA=YES is required for destructive cleanup')
  }
}

function assertFixturePrerequisites({ members = [], courts = [] }) {
  const admins = members.filter(m => m && (m.admin === true || m.isAdmin === true))
  const normalMembers = members.filter(m => m && !(m.admin === true || m.isAdmin === true))
  const enabledCourts = courts.filter(c => c && c.enabled !== false)
  if (admins.length < 1) throw new Error('Fixture prerequisite failed: need at least 1 admin member')
  if (normalMembers.length < 5) throw new Error('Fixture prerequisite failed: need at least 5 normal members')
  if (enabledCourts.length < 2) throw new Error('Fixture prerequisite failed: need at least 2 enabled courts')
}

async function fetchPrerequisites(db) {
  const [membersRes, courtsRes] = await Promise.all([
    db.collection('members').limit(200).get(),
    db.collection('courts').limit(50).get(),
  ])
  return {
    members: membersRes.data || [],
    courts: courtsRes.data || [],
  }
}

async function cleanupBusinessCollections(db, collections = BUSINESS_COLLECTIONS, log = console.log) {
  const summary = []
  for (const name of collections) {
    const total = await countCollection(db, name)
    if (total === null) {
      log(`>>> ${name}: collection does not exist, skipped`)
      summary.push({ collection: name, before: null, removed: 0, remaining: null })
      continue
    }
    log(`>>> ${name}: ${total} rows before cleanup`)
    let removed = 0
    while (true) {
      const page = await db.collection(name).limit(PAGE_SIZE).get()
      const rows = page.data || []
      if (rows.length === 0) break
      for (const row of rows) {
        if (!row._id) continue
        await db.collection(name).doc(row._id).remove()
        removed += 1
      }
    }
    const remaining = await countCollection(db, name)
    log(`<<< ${name}: removed ${removed}, remaining ${remaining}`)
    summary.push({ collection: name, before: total, removed, remaining })
  }
  return summary
}

async function main() {
  assertResetSafety(process.env)
  const env = process.env.FOPEN_CLOUD_ENV
  console.log(`>>> Target cloud env: ${env}`)
  console.log(`>>> Collections: ${BUSINESS_COLLECTIONS.join(' / ')}`)
  console.log('>>> Destructive cleanup starts in 5 seconds. Press Ctrl-C to cancel.')
  await sleep(5000)

  const app = tcb.init({ env })
  const db = app.database()
  const prerequisites = await fetchPrerequisites(db)
  assertFixturePrerequisites(prerequisites)
  await cleanupBusinessCollections(db)
  console.log('done.')
}

async function countCollection(db, name) {
  try {
    const result = await db.collection(name).count()
    return result.total || 0
  } catch (err) {
    if (err && err.code === 'DATABASE_COLLECTION_NOT_EXIST') return null
    throw err
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  BUSINESS_COLLECTIONS,
  assertResetSafety,
  assertFixturePrerequisites,
  cleanupBusinessCollections,
  countCollection,
}
```

- [ ] **Step 5: Run cleanup tests to verify GREEN**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- cleanup-test-data.test.js --runInBand
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/package.json scripts/package-lock.json scripts/cleanup-test-data.js scripts/__tests__/cleanup-test-data.test.js
git commit -m "test(scripts): guard e2e cleanup reset"
```

---

## Task 2: Deterministic E2E Fixture Builder

**Files:**
- Create: `scripts/lib/e2e-fixture.js`
- Create: `scripts/__tests__/e2e-fixture.test.js`

- [ ] **Step 1: Write fixture builder failing tests**

Create `scripts/__tests__/e2e-fixture.test.js`:

```js
const {
  selectActors,
  buildE2EFixture,
  SCORE_A_BEATS_B_4_2,
  SCORE_B_WINS_TIEBREAK,
} = require('../lib/e2e-fixture')

const members = [
  { _id: 'admin', name: 'Admin', admin: true, openid: 'oa' },
  { _id: 'A', name: 'A' },
  { _id: 'B', name: 'B' },
  { _id: 'C', name: 'C' },
  { _id: 'D', name: 'D' },
  { _id: 'E', name: 'E' },
]
const courts = [
  { _id: 'court1', courtId: 'court1', name: 'Court 1', enabled: true },
  { _id: 'court2', courtId: 'court2', name: 'Court 2', enabled: true },
]

describe('selectActors', () => {
  test('selects one admin, five normal members, and two enabled courts', () => {
    const actors = selectActors({ members, courts })
    expect(actors.adminMember._id).toBe('admin')
    expect(actors.players.map(p => p._id)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(actors.courts.map(c => c.courtId)).toEqual(['court1', 'court2'])
  })
})

describe('buildE2EFixture', () => {
  test('uses current score schema for straight score and tiebreak score', () => {
    expect(SCORE_A_BEATS_B_4_2).toEqual({ sets: [{ a: 4, b: 2 }], tiebreak: null })
    expect(SCORE_B_WINS_TIEBREAK).toEqual({ sets: [{ a: 3, b: 3 }], tiebreak: '5-7' })
  })

  test('builds confirmed and interactive fixture subsets', () => {
    const fixture = buildE2EFixture({
      actors: selectActors({ members, courts }),
      seasonId: 'season_2026',
      now: new Date('2026-05-17T10:00:00.000Z'),
    })

    expect(fixture.ids.regularSinglesTournamentId).toBe('e2e_regular_singles_20260517_1000')
    expect(fixture.collections.tournaments).toHaveLength(4)
    expect(fixture.collections.match_results.some(r => r.resultStatus === 'confirmed')).toBe(true)
    expect(fixture.collections.match_results.some(r => r.resultStatus === 'pending')).toBe(true)
    expect(fixture.collections.match_results.some(r => r.resultStatus === 'submitted')).toBe(true)
    expect(fixture.collections.tournament_points.some(p => p.rank === 'champion')).toBe(true)
  })

  test('doubles fixture contains four playerIds and opposite-side award roles', () => {
    const fixture = buildE2EFixture({
      actors: selectActors({ members, courts }),
      seasonId: 'season_2026',
      now: new Date('2026-05-17T10:00:00.000Z'),
    })
    const doubles = fixture.collections.match_results.find(r => r.tournamentType === 'doubles' && r.resultStatus === 'confirmed')
    expect(doubles.playerIds).toEqual(['A', 'B', 'C', 'D'])
    expect(doubles.pointsAwarded.entries.filter(e => e.role === 'winner').map(e => e.memberId)).toEqual(['A', 'B'])
    expect(doubles.pointsAwarded.entries.filter(e => e.role === 'loser').map(e => e.memberId)).toEqual(['C', 'D'])
  })
})
```

- [ ] **Step 2: Run fixture tests to verify RED**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- e2e-fixture.test.js --runInBand
```

Expected: FAIL with `Cannot find module '../lib/e2e-fixture'`.

- [ ] **Step 3: Implement fixture builder**

Create `scripts/lib/e2e-fixture.js`:

```js
const SCORE_A_BEATS_B_4_2 = { sets: [{ a: 4, b: 2 }], tiebreak: null }
const SCORE_B_WINS_TIEBREAK = { sets: [{ a: 3, b: 3 }], tiebreak: '5-7' }
const POINTS_RULES = {
  winLoss: { win: 20, loss: 10, walkover: 0 },
  placement: { champion: 100, runnerUp: 60, semifinal: 30, quarterfinal: 10, participation: 5 },
}

function selectActors({ members = [], courts = [] }) {
  const adminMember = members.find(m => m && (m.admin === true || m.isAdmin === true))
  const players = members.filter(m => m && !(m.admin === true || m.isAdmin === true)).slice(0, 5)
  const enabledCourts = courts.filter(c => c && c.enabled !== false).slice(0, 2)
  if (!adminMember) throw new Error('Fixture requires one admin member')
  if (players.length < 5) throw new Error('Fixture requires five normal members')
  if (enabledCourts.length < 2) throw new Error('Fixture requires two enabled courts')
  return { adminMember, players, courts: enabledCourts }
}

function buildE2EFixture({ actors, seasonId, now = new Date() }) {
  const stamp = timestampKey(now)
  const [A, B, C, D, E] = actors.players
  const admin = actors.adminMember
  const [court1, court2] = actors.courts
  const ids = {
    regularSinglesTournamentId: `e2e_regular_singles_${stamp}`,
    knockoutSinglesTournamentId: `e2e_knockout_singles_${stamp}`,
    doublesTournamentId: `e2e_regular_doubles_${stamp}`,
    interactiveTournamentId: `e2e_interactive_${stamp}`,
  }

  const tournaments = [
    tournamentDoc(ids.regularSinglesTournamentId, `E2E_常规赛单打_${stamp}`, 'singles', 'regular', seasonId, 'completed', now),
    tournamentDoc(ids.knockoutSinglesTournamentId, `E2E_淘汰赛单打_${stamp}`, 'singles', 'knockout', seasonId, 'completed', now),
    tournamentDoc(ids.doublesTournamentId, `E2E_常规赛双打_${stamp}`, 'doubles', 'regular', seasonId, 'completed', now),
    tournamentDoc(ids.interactiveTournamentId, `E2E_登录态验证_${stamp}`, 'singles', 'regular', seasonId, 'ongoing', now),
  ]

  const match_results = [
    confirmedSingles(ids.regularSinglesTournamentId, 'rs_m1', 1, 1, A, B, SCORE_A_BEATS_B_4_2, A, now, seasonId),
    confirmedSingles(ids.regularSinglesTournamentId, 'rs_m2', 1, 2, C, D, SCORE_B_WINS_TIEBREAK, D, now, seasonId),
    confirmedSingles(ids.knockoutSinglesTournamentId, 'ko_r1_m1', 1, 1, A, B, { sets: [{ a: 4, b: 0 }], tiebreak: null }, A, now, seasonId, 'bracket'),
    confirmedSingles(ids.knockoutSinglesTournamentId, 'ko_r1_m2', 1, 2, C, D, { sets: [{ a: 4, b: 1 }], tiebreak: null }, C, now, seasonId, 'bracket'),
    confirmedSingles(ids.knockoutSinglesTournamentId, 'ko_f_m1', 2, 1, A, C, SCORE_A_BEATS_B_4_2, A, now, seasonId, 'bracket'),
    confirmedDoubles(ids.doublesTournamentId, 'db_m1', A, B, C, D, SCORE_A_BEATS_B_4_2, now, seasonId),
    pendingSingles(ids.interactiveTournamentId, 'int_pending', 1, 1, admin, A, now, seasonId),
    submittedSingles(ids.interactiveTournamentId, 'int_submitted', 1, 2, B, C, SCORE_A_BEATS_B_4_2, now, seasonId),
  ]

  const tournament_points = [
    placement(ids.knockoutSinglesTournamentId, A, seasonId, 'singles', 'champion', 100, now),
    placement(ids.knockoutSinglesTournamentId, C, seasonId, 'singles', 'runnerUp', 60, now),
    placement(ids.knockoutSinglesTournamentId, B, seasonId, 'singles', 'semifinal', 30, now),
    placement(ids.knockoutSinglesTournamentId, D, seasonId, 'singles', 'semifinal', 30, now),
  ]

  const tournament_registrations = [
    ...registrations(ids.regularSinglesTournamentId, [A, B, C, D], now),
    ...registrations(ids.knockoutSinglesTournamentId, [A, B, C, D], now),
    ...registrations(ids.doublesTournamentId, [A, B, C, D], now),
    ...registrations(ids.interactiveTournamentId, [admin, A, B, C], now),
  ]

  const tournament_brackets = [
    bracket(ids.knockoutSinglesTournamentId, 1, [
      bracketMatch('ko_r1_m1', 1, 1, A, B, A, 'confirmed'),
      bracketMatch('ko_r1_m2', 1, 2, C, D, C, 'confirmed'),
    ]),
    bracket(ids.knockoutSinglesTournamentId, 2, [
      bracketMatch('ko_f_m1', 2, 1, A, C, A, 'confirmed'),
    ]),
  ]

  return {
    ids,
    actors: { adminMember: admin, players: [A, B, C, D, E], courts: [court1, court2] },
    collections: {
      tournaments,
      tournament_brackets,
      tournament_registrations,
      match_results,
      tournament_points,
      free_plays: [],
      rank_snapshots: [],
      weekly_stars: [],
    },
  }
}

function tournamentDoc(_id, name, type, format, seasonId, status, now) {
  return { _id, name, type, format, seasonId, status, pointsRules: POINTS_RULES, createTime: now, updateTime: now }
}

function registrations(tournamentId, players, now) {
  return players.map(p => ({
    _id: `reg_${tournamentId}_${p._id}`,
    tournamentId,
    playerId: p._id,
    playerName: p.name || p._id,
    registrationStatus: 'confirmed',
    createTime: now,
    updateTime: now,
  }))
}

function confirmedSingles(tournamentId, sourceMatchId, round, position, p1, p2, score, winner, now, seasonId, matchKind = 'regularRound') {
  const loser = winner._id === p1._id ? p2 : p1
  return baseMatch({
    tournamentId, sourceMatchId, round, position, p1, p2, score, winner, now, seasonId,
    tournamentType: 'singles',
    matchKind,
    resultStatus: 'confirmed',
    pointsAwarded: awardEntries([winner], [loser]),
  })
}

function submittedSingles(tournamentId, sourceMatchId, round, position, p1, p2, score, now, seasonId) {
  return baseMatch({ tournamentId, sourceMatchId, round, position, p1, p2, score, winner: null, now, seasonId, tournamentType: 'singles', matchKind: 'regularRound', resultStatus: 'submitted', pointsAwarded: null })
}

function pendingSingles(tournamentId, sourceMatchId, round, position, p1, p2, now, seasonId) {
  return baseMatch({ tournamentId, sourceMatchId, round, position, p1, p2, score: null, winner: null, now, seasonId, tournamentType: 'singles', matchKind: 'regularRound', resultStatus: 'pending', pointsAwarded: null })
}

function confirmedDoubles(tournamentId, sourceMatchId, A, B, C, D, score, now, seasonId) {
  return {
    ...baseMatch({
      tournamentId,
      sourceMatchId,
      round: 1,
      position: 1,
      p1: { _id: A._id, name: A.name, partnerId: B._id, partnerName: B.name },
      p2: { _id: C._id, name: C.name, partnerId: D._id, partnerName: D.name },
      score,
      winner: { _id: A._id, name: A.name, partnerId: B._id, partnerName: B.name },
      now,
      seasonId,
      tournamentType: 'doubles',
      matchKind: 'regularRound',
      resultStatus: 'confirmed',
      pointsAwarded: { source: 'match', entries: [
        { memberId: A._id, points: 20, role: 'winner' },
        { memberId: B._id, points: 20, role: 'winner' },
        { memberId: C._id, points: 10, role: 'loser' },
        { memberId: D._id, points: 10, role: 'loser' },
      ] },
    }),
    playerIds: [A._id, B._id, C._id, D._id],
  }
}

function baseMatch({ tournamentId, sourceMatchId, round, position, p1, p2, score, winner, now, seasonId, tournamentType, matchKind, resultStatus, pointsAwarded }) {
  const player1 = toPlayerSide(p1)
  const player2 = toPlayerSide(p2)
  return {
    _id: `result_${tournamentId}_${sourceMatchId}`,
    tournamentId,
    seasonId,
    tournamentType,
    matchKind,
    sourceMatchId,
    round,
    position,
    player1,
    player2,
    playerIds: collectIds(player1, player2),
    score,
    resultStatus,
    winner: winner ? toPlayerSide(winner) : null,
    winnerId: winner ? winner._id : null,
    confirmedAt: resultStatus === 'confirmed' ? now : null,
    confirmedBy: resultStatus === 'confirmed' ? 'e2e_seed' : null,
    submittedAt: resultStatus === 'submitted' ? now : null,
    submittedBy: resultStatus === 'submitted' ? player1.id : null,
    pointsAwarded,
    createTime: now,
    updateTime: now,
  }
}

function toPlayerSide(p) {
  return {
    id: p._id,
    name: p.name || p._id,
    partnerId: p.partnerId || null,
    partnerName: p.partnerName || null,
  }
}

function collectIds(player1, player2) {
  return [player1.id, player1.partnerId, player2.id, player2.partnerId].filter(Boolean)
}

function awardEntries(winners, losers) {
  return { source: 'match', entries: [
    ...winners.map(p => ({ memberId: p._id, points: 20, role: 'winner' })),
    ...losers.map(p => ({ memberId: p._id, points: 10, role: 'loser' })),
  ] }
}

function placement(tournamentId, member, seasonId, tournamentType, rank, points, now) {
  return {
    _id: `${tournamentId}_${member._id}_placement`,
    tournamentId,
    memberId: member._id,
    seasonId,
    tournamentType,
    points,
    rank,
    awardedAt: now,
    createTime: now,
    updateTime: now,
  }
}

function bracket(tournamentId, round, matches) {
  return { _id: `bracket_${tournamentId}_round_${round}`, tournamentId, round, type: 'singles', matches }
}

function bracketMatch(matchId, round, position, p1, p2, winner, status) {
  return { matchId, round, position, player1: toPlayerSide(p1), player2: toPlayerSide(p2), winner: toPlayerSide(winner), status, resultStatus: status }
}

function timestampKey(now) {
  const d = new Date(now)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

module.exports = {
  POINTS_RULES,
  SCORE_A_BEATS_B_4_2,
  SCORE_B_WINS_TIEBREAK,
  selectActors,
  buildE2EFixture,
}
```

- [ ] **Step 4: Run fixture tests to verify GREEN**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- e2e-fixture.test.js --runInBand
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/lib/e2e-fixture.js scripts/__tests__/e2e-fixture.test.js
git commit -m "test(scripts): build e2e regression fixture"
```

---

## Task 3: Cloud Smoke Orchestrator

**Files:**
- Create: `scripts/e2e-regression-smoke.js`
- Create: `scripts/__tests__/e2e-regression-smoke.test.js`
- Modify: `scripts/cleanup-test-data.js`

- [ ] **Step 1: Write failing smoke orchestrator tests**

Create `scripts/__tests__/e2e-regression-smoke.test.js`:

```js
const { runE2ERegressionSmoke } = require('../e2e-regression-smoke')

function makeFakeDb(seed = {}) {
  const rows = {
    members: seed.members || [
      { _id: 'admin', name: 'Admin', admin: true },
      { _id: 'A', name: 'A' },
      { _id: 'B', name: 'B' },
      { _id: 'C', name: 'C' },
      { _id: 'D', name: 'D' },
      { _id: 'E', name: 'E' },
    ],
    courts: seed.courts || [
      { _id: 'court1', courtId: 'court1', enabled: true },
      { _id: 'court2', courtId: 'court2', enabled: true },
    ],
    seasons: seed.seasons || [{ _id: 'season_2026', current: true }],
    tournaments: [],
    tournament_brackets: [],
    tournament_registrations: [],
    match_results: [],
    tournament_points: [],
    free_plays: [],
    rank_snapshots: [],
    weekly_stars: [],
  }
  const removed = []
  function collection(name) {
    rows[name] = rows[name] || []
    return {
      limit(n) {
        return { get: async () => ({ data: rows[name].slice(0, n) }) }
      },
      count: async () => ({ total: rows[name].length }),
      doc(id) {
        return {
          remove: async () => {
            const idx = rows[name].findIndex(r => r._id === id)
            if (idx >= 0) {
              rows[name].splice(idx, 1)
              removed.push(`${name}:${id}`)
            }
          },
          set: async ({ data }) => {
            const idx = rows[name].findIndex(r => r._id === id)
            const next = { ...data, _id: id }
            if (idx >= 0) rows[name][idx] = next
            else rows[name].push(next)
          },
        }
      },
      add: async ({ data }) => {
        rows[name].push(data)
        return { _id: data._id }
      },
      where(filter) {
        return {
          limit(n) {
            return {
              get: async () => ({ data: rows[name].filter(row => Object.entries(filter).every(([k, v]) => row[k] === v)).slice(0, n) })
            }
          },
          get: async () => ({ data: rows[name].filter(row => Object.entries(filter).every(([k, v]) => row[k] === v)) })
        }
      },
    }
  }
  return { db: { collection }, rows, removed }
}

test('cleanup-seed-smoke clears business collections, seeds fixture, and calls read-only cloud functions', async () => {
  const fake = makeFakeDb()
  const calls = []
  const result = await runE2ERegressionSmoke({
    db: fake.db,
    callFunction: async (name, data) => {
      calls.push({ name, data })
      if (data.action === 'rankList') {
        return { result: { success: true, data: { rankList: [{ _id: 'A', totalPoints: 160, winCount: 3, lossCount: 0 }] } } }
      }
      if (data.action === 'playerStats') {
        return { result: { success: true, data: { stats: { singles: { totalPoints: 160, winCount: 3, lossCount: 0 } }, recent: [{ _id: 'm1', score: '4-2', pointsAwarded: 20 }] } } }
      }
      if (data.action === 'playerH2H') {
        return { result: { success: true, data: { singles: [{ opponentId: 'B', wins: 2, losses: 0 }] } } }
      }
      return { result: { success: false, error: { code: 'UNKNOWN_TEST_ACTION', message: data.action } } }
    },
    mode: 'cleanup-seed-smoke',
    seasonId: 'season_2026',
    now: new Date('2026-05-17T10:00:00.000Z'),
    log: () => {},
  })

  expect(fake.rows.tournaments.length).toBeGreaterThan(0)
  expect(fake.rows.match_results.some(r => r.resultStatus === 'confirmed')).toBe(true)
  expect(calls.map(c => c.data.action)).toEqual(expect.arrayContaining(['rankList', 'playerStats', 'playerH2H']))
  expect(result.smoke.map(s => s.name)).toEqual(['rankList.singles', 'playerStats.A', 'playerH2H.A'])
  expect(result.fixture.ids.regularSinglesTournamentId).toBe('e2e_regular_singles_20260517_1000')
})

test('seed-only does not remove existing business rows', async () => {
  const fake = makeFakeDb()
  fake.rows.tournaments.push({ _id: 'existing' })
  await runE2ERegressionSmoke({
    db: fake.db,
    callFunction: async () => ({ result: { success: true, data: { rankList: [] } } }),
    mode: 'seed-only',
    seasonId: 'season_2026',
    now: new Date('2026-05-17T10:00:00.000Z'),
    log: () => {},
  })
  expect(fake.rows.tournaments.some(t => t._id === 'existing')).toBe(true)
})
```

- [ ] **Step 2: Run smoke tests to verify RED**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- e2e-regression-smoke.test.js --runInBand
```

Expected: FAIL with `Cannot find module '../e2e-regression-smoke'`.

- [ ] **Step 3: Implement smoke orchestrator with dependency injection**

Create `scripts/e2e-regression-smoke.js`:

```js
#!/usr/bin/env node

const tcb = require('@cloudbase/node-sdk')
const {
  BUSINESS_COLLECTIONS,
  assertResetSafety,
  assertFixturePrerequisites,
  cleanupBusinessCollections,
} = require('./cleanup-test-data')
const { selectActors, buildE2EFixture } = require('./lib/e2e-fixture')

const VALID_MODES = new Set(['cleanup-only', 'seed-only', 'cleanup-seed-smoke'])

async function runE2ERegressionSmoke({ db, callFunction, mode, seasonId, now = new Date(), log = console.log }) {
  if (!VALID_MODES.has(mode)) throw new Error(`Invalid mode: ${mode}`)
  const prerequisites = await loadPrerequisites(db)
  assertFixturePrerequisites(prerequisites)

  if (mode === 'cleanup-only' || mode === 'cleanup-seed-smoke') {
    await cleanupBusinessCollections(db, BUSINESS_COLLECTIONS, log)
  }

  if (mode === 'cleanup-only') return { mode, fixture: null, smoke: [] }

  const actors = selectActors(prerequisites)
  const fixture = buildE2EFixture({ actors, seasonId, now })
  await seedFixture(db, fixture.collections, log)

  const smoke = mode === 'cleanup-seed-smoke'
    ? await runReadOnlySmoke({ callFunction, fixture, seasonId, log })
    : []

  return { mode, fixture, smoke }
}

async function loadPrerequisites(db) {
  const [membersRes, courtsRes, seasonsRes] = await Promise.all([
    db.collection('members').limit(200).get(),
    db.collection('courts').limit(50).get(),
    db.collection('seasons').limit(20).get(),
  ])
  const seasons = seasonsRes.data || []
  if (seasons.length === 0) throw new Error('Fixture prerequisite failed: need at least one season')
  return {
    members: membersRes.data || [],
    courts: courtsRes.data || [],
    seasons,
  }
}

async function seedFixture(db, collections, log = console.log) {
  for (const [name, docs] of Object.entries(collections)) {
    for (const doc of docs) {
      if (!doc || !doc._id) throw new Error(`Fixture doc in ${name} is missing _id`)
      const { _id, ...data } = doc
      await db.collection(name).doc(_id).set({ data })
    }
    log(`[seed] ${name}: ${docs.length}`)
  }
}

async function runReadOnlySmoke({ callFunction, fixture, seasonId, log = console.log }) {
  const [A] = fixture.actors.players
  const checks = []

  const rankSingles = await callFunction('points-engine', { action: 'rankList', type: 'singles', currentSeasonId: seasonId })
  assertCloudSuccess(rankSingles, 'points-engine.rankList.singles')
  const rankA = ((rankSingles.result.data && rankSingles.result.data.rankList) || []).find(row => row._id === A._id)
  if (!rankA || rankA.totalPoints < 160 || rankA.winCount < 3) {
    throw new Error(`rankList.singles did not include expected A totals: ${JSON.stringify(rankA)}`)
  }
  checks.push({ name: 'rankList.singles', ok: true })

  const stats = await callFunction('points-engine', { action: 'playerStats', playerId: A._id, currentSeasonId: seasonId })
  assertCloudSuccess(stats, 'points-engine.playerStats')
  const singlesStats = stats.result.data && stats.result.data.stats && stats.result.data.stats.singles
  const recent = (stats.result.data && stats.result.data.recent) || []
  if (!singlesStats || singlesStats.totalPoints < 160 || recent.length < 1) {
    throw new Error(`playerStats.A did not include expected totals/recent: ${JSON.stringify(stats.result.data)}`)
  }
  checks.push({ name: 'playerStats.A', ok: true })

  const h2h = await callFunction('points-engine', { action: 'playerH2H', playerId: A._id, currentSeasonId: seasonId })
  assertCloudSuccess(h2h, 'points-engine.playerH2H')
  const h2hSingles = (h2h.result.data && h2h.result.data.singles) || []
  if (!h2hSingles.some(row => row.opponentId === 'B')) {
    throw new Error(`playerH2H.A did not include opponent B: ${JSON.stringify(h2h.result.data)}`)
  }
  checks.push({ name: 'playerH2H.A', ok: true })

  for (const check of checks) log(`[smoke] ${check.name}: ok`)
  return checks
}

function assertCloudSuccess(res, label) {
  if (!res || !res.result || res.result.success !== true) {
    throw new Error(`${label} failed: ${JSON.stringify(res && res.result)}`)
  }
}

function initCloud(env) {
  const app = tcb.init({ env })
  return {
    db: app.database(),
    callFunction: async (name, data) => app.callFunction({ name, data }),
  }
}

async function main() {
  assertResetSafety(process.env)
  const env = process.env.FOPEN_CLOUD_ENV
  const mode = process.env.FOPEN_E2E_MODE || 'cleanup-seed-smoke'
  const seasonId = process.env.SEASON_ID || `season_${new Date().getFullYear()}`
  console.log(`>>> Target cloud env: ${env}`)
  console.log(`>>> E2E mode: ${mode}`)
  console.log(`>>> Season: ${seasonId}`)
  console.log('>>> Destructive mode starts in 5 seconds. Press Ctrl-C to cancel.')
  await new Promise(resolve => setTimeout(resolve, 5000))
  const { db, callFunction } = initCloud(env)
  const result = await runE2ERegressionSmoke({ db, callFunction, mode, seasonId, now: new Date(), log: console.log })
  console.log(JSON.stringify({ mode: result.mode, fixtureIds: result.fixture && result.fixture.ids, smoke: result.smoke }, null, 2))
}

if (require.main === module) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  runE2ERegressionSmoke,
  seedFixture,
  runReadOnlySmoke,
}
```

- [ ] **Step 4: Run smoke orchestrator tests to verify GREEN**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- e2e-regression-smoke.test.js --runInBand
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Verify safety failure from CLI**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
node scripts/e2e-regression-smoke.js
```

Expected: exits non-zero and prints `FOPEN_CLEANUP_CONFIRM must be set and equal to FOPEN_CLOUD_ENV`.

- [ ] **Step 6: Commit Task 3**

```bash
git add scripts/e2e-regression-smoke.js scripts/__tests__/e2e-regression-smoke.test.js scripts/cleanup-test-data.js
git commit -m "test(scripts): add guarded e2e smoke runner"
```

---

## Task 4: Cloud Function Regression Tests

**Files:**
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js`
- Modify: `cloudfunctions/match-results/lib/__tests__/state.test.js`
- Modify: `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`
- Modify: `cloudfunctions/points-engine/lib/__tests__/player-stats.test.js`

- [ ] **Step 1: Add failing batch regression tests**

Append to `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`:

```js
test('batchSubmit accepts 3-3 tiebreak score using current string schema', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_tb', resultStatus: 'pending', playerIds: ['mA', 'mB'] }],
  })
  ctx.validateScore = (score) => {
    expect(score).toEqual({ sets: [{ a: 3, b: 3 }], tiebreak: '5-7' })
    return { valid: true, winner: 'b' }
  }
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_tb', score: { sets: [{ a: 3, b: 3 }], tiebreak: '5-7' } }],
    requestId: 'req_tb',
  })
  expect(result.successIds).toEqual(['mr_tb'])
  expect(ctx._state.matchesById.mr_tb.score.tiebreak).toBe('5-7')
})

test('batchAdminSave refuses non-admin caller before validating scores', async () => {
  const ctx = makeCtx({ matches: [{ _id: 'mr_a', resultStatus: 'pending' }], isAdmin: false })
  await expect(batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_admin_forbidden',
  })).rejects.toMatchObject({ code: 'FORBIDDEN' })
})
```

- [ ] **Step 2: Run batch tests to verify RED/GREEN status**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- lib/__tests__/handlers/batch.test.js --runInBand
```

Expected: If either test fails, fix `lib/handlers/batch.js` minimally so `batchSubmit` preserves `tiebreak: '5-7'` and `batchAdminSave` keeps the existing admin gate. If both pass immediately, keep the tests as regression coverage.

- [ ] **Step 3: Add mySummary mixed-role tests**

Append to `cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js`:

```js
test('mySummary treats admin caller as player and does not include non-participant pending admin work', async () => {
  const ctx = makeCtx({
    memberId: 'admin1',
    allMatches: [
      { _id: 'mine_pending', tournamentId: 't1', resultStatus: 'pending', playerIds: ['admin1', 'mA'], round: 1, position: 1, player1: { name: 'Admin' }, player2: { name: 'A' } },
      { _id: 'other_submitted', tournamentId: 't1', resultStatus: 'submitted', playerIds: ['mB', 'mC'], round: 1, position: 2, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
    ],
    tournaments: { t1: { _id: 't1', name: 'E2E' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending.map(x => x.matchId)).toEqual(['mine_pending'])
  expect(result.submitted).toEqual([])
})
```

- [ ] **Step 4: Run mySummary tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- lib/__tests__/handlers/my-summary.test.js --runInBand
```

Expected: PASS. If it fails because `mySummary` leaks admin work, fix `lib/handlers/my-summary.js` to use only `playerIds` membership.

- [ ] **Step 5: Add state regression tests for doubles and tiebreak**

Append to `cloudfunctions/match-results/lib/__tests__/state.test.js`:

```js
test('regular doubles confirmation awards both winners and both losers', async () => {
  const seed = seed4Knockout()
  seed.tournaments[0] = { ...seed.tournaments[0], _id: 'TD', type: 'doubles', format: 'regular' }
  seed.match_results = [{
    _id: 'result_TD_d1',
    tournamentId: 'TD',
    sourceMatchId: 'd1',
    matchKind: 'regularRound',
    round: 1,
    position: 1,
    player1: { id: 'A', partnerId: 'B' },
    player2: { id: 'C', partnerId: 'D' },
    playerIds: ['A', 'B', 'C', 'D'],
    resultStatus: 'pending',
    tournamentType: 'doubles',
    seasonId: 'S1',
    pointsAwarded: null,
  }]
  seed.tournament_registrations = ['A', 'B', 'C', 'D'].map(id => ({ _id: `reg_${id}`, tournamentId: 'TD', playerId: id, registrationStatus: 'confirmed' }))
  const db = makeDb(seed)
  const svc = createMatchStateService({ db, awardLib: award, scoreRule })
  await svc.submitResult({ matchId: 'd1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
  const row = db.__all().match_results[0]
  expect(row.pointsAwarded.entries.filter(e => e.role === 'winner').map(e => e.memberId)).toEqual(['A', 'B'])
  expect(row.pointsAwarded.entries.filter(e => e.role === 'loser').map(e => e.memberId)).toEqual(['C', 'D'])
})

test('regular singles tiebreak 5-7 awards player2 as winner', async () => {
  const db = makeDb(seed4Knockout())
  const svc = createMatchStateService({ db, awardLib: award, scoreRule })
  await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 3, b: 3 }], tiebreak: '5-7' }, submitter: { _id: 'admin1', isAdmin: true } })
  const row = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
  expect(row.winner).toEqual({ id: 'B' })
})
```

- [ ] **Step 6: Run state tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- lib/__tests__/state.test.js --runInBand
```

Expected: PASS. If the doubles test fails, fix `cloudfunctions/_shared/award.js` and re-run `scripts/sync-shared-libs.sh`.

- [ ] **Step 7: Add points-engine aggregate/recent regressions**

Append to `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`:

```js
test('E2E fixture ranking combines match winLoss and placement points', async () => {
  const seasonId = 'season_2026'
  const db = makeFakeDb({
    matchResults: [
      { _id: 'm1', seasonId, tournamentType: 'singles', resultStatus: 'confirmed', createTime: new Date('2026-05-17T10:00:00Z'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] } },
      { _id: 'm2', seasonId, tournamentType: 'singles', resultStatus: 'confirmed', createTime: new Date('2026-05-17T11:00:00Z'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'C', points: 10, role: 'loser' }] } },
    ],
    tournamentPoints: [
      { _id: 'tp_A', seasonId, tournamentType: 'singles', memberId: 'A', points: 100, rank: 'champion', createTime: new Date('2026-05-17T12:00:00Z') },
      { _id: 'tp_C', seasonId, tournamentType: 'singles', memberId: 'C', points: 60, rank: 'runnerUp', createTime: new Date('2026-05-17T12:00:00Z') },
    ],
  })
  const list = await aggregateRanks({ db, seasonId, type: 'singles', pageSize: 100 })
  expect(list[0]).toMatchObject({ memberId: 'A', totalPoints: 140, wins: 2 })
  expect(list.find(r => r.memberId === 'C')).toMatchObject({ totalPoints: 70, losses: 1 })
})
```

Append to `cloudfunctions/points-engine/lib/__tests__/player-stats.test.js`:

```js
test('formatScore keeps current tiebreak string schema', () => {
  expect(formatScore({ sets: [{ a: 3, b: 3 }], tiebreak: '5-7' })).toBe('3-3 (5-7)')
})
```

- [ ] **Step 8: Run points-engine tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- lib/__tests__/aggregate.test.js lib/__tests__/player-stats.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js cloudfunctions/match-results/lib/__tests__/state.test.js cloudfunctions/points-engine/lib/__tests__/aggregate.test.js cloudfunctions/points-engine/lib/__tests__/player-stats.test.js
git commit -m "test(e2e): cover score and points regressions"
```

---

## Task 5: Mini Program Page Regression Tests

**Files:**
- Modify: `miniprogram/pages/tournament-score/__tests__/index.test.js`
- Create: `miniprogram/pages/my-match/__tests__/index.test.js`
- Create: `miniprogram/pages/rank/__tests__/index.test.js`
- Create: `miniprogram/pages/player-detail/__tests__/index.test.js`

- [ ] **Step 1: Add tournament-score member sheet and retry tests**

Append to `miniprogram/pages/tournament-score/__tests__/index.test.js`:

```js
test('member bottom button opens submit sheet with dirty local drafts', () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    isAdmin: false,
    tournamentId: 't1',
    tournament: { _id: 't1', name: '周赛', format: 'regular' },
    rowsByRound: [{ round: 1, matches: [matchA] }],
    draftMap: {
      m1: {
        matchId: 'm1',
        canEdit: true,
        filled: true,
        dirty: true,
        isConfirmed: false,
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
      },
    },
  })

  ctx.onPlayerBatchSheet()

  expect(ctx.data.sheet).toMatchObject({
    visible: true,
    title: '提交比分',
    mode: 'submit',
    items: [{ matchId: 'result_t1_m1', sourceMatchId: 'm1' }],
  })
})

test('sheet close hides sheet and refreshes rows', async () => {
  const def = loadPage()
  const ctx = makeCtx(def, { sheet: { visible: true, title: '', mode: 'submit', items: [], result: null, requestId: 'req' } })
  ctx.refresh = jest.fn()

  ctx.onSheetClose()

  expect(ctx.data.sheet.visible).toBe(false)
  expect(ctx.refresh).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tournament-score tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-score/__tests__/index.test.js --runInBand
```

Expected: PASS. If member sheet fails because helper defaults force admin identity, adjust the test `makeCtx` data only; do not change production behavior.

- [ ] **Step 3: Create my-match page tests**

Create `miniprogram/pages/my-match/__tests__/index.test.js`:

```js
function loadPage() {
  jest.resetModules()
  let pageDef
  global.Page = def => { pageDef = def }
  global.wx = { navigateTo: jest.fn(), switchTab: jest.fn() }
  jest.mock('../../../utils/cloud', () => ({ call: jest.fn() }))
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...def.data, ...data },
    setData(patch) { Object.assign(this.data, patch) },
  }
}

test('loads mySummary into loaded state', async () => {
  const def = loadPage()
  const { call } = require('../../../utils/cloud')
  call.mockResolvedValueOnce({ ok: true, data: { pending: [{ matchId: 'm1' }], submitted: [], confirmed: [] } })
  const ctx = makeCtx(def)

  await ctx._load()

  expect(ctx.data.loadState).toBe('loaded')
  expect(ctx.data.summary.pending).toHaveLength(1)
})

test('pending row navigates to tournament-score with tournamentId and matchId', () => {
  const def = loadPage()
  const ctx = makeCtx(def)
  ctx.onPendingRow({ currentTarget: { dataset: { tournamentid: 't1', matchid: 'mr1' } } })
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1&matchId=mr1' })
})

test('record now opens first pending match', () => {
  const def = loadPage()
  const ctx = makeCtx(def, { summary: { pending: [{ tournamentId: 't1', matchId: 'mr1' }] } })
  ctx.onRecordNow()
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/tournament-score/index?tournamentId=t1&matchId=mr1' })
})
```

- [ ] **Step 4: Run my-match tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/my-match/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Create rank page tests**

Create `miniprogram/pages/rank/__tests__/index.test.js`:

```js
function loadPage() {
  jest.resetModules()
  let pageDef
  global.Page = def => { pageDef = def }
  global.getApp = () => ({ globalData: { currentMember: { _id: 'A' } } })
  global.wx = { navigateTo: jest.fn(), showToast: jest.fn() }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...def.data, ...data },
    setData(patch) { Object.assign(this.data, patch) },
  }
}

test('loadRank maps winRate to display percentage', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValueOnce({ result: { data: { rankList: [{ _id: 'A', winRate: 0.75, totalPoints: 120 }] } } })
  const ctx = makeCtx(def)

  await ctx.loadRank()

  expect(ctx.data.rankList[0]).toMatchObject({ _id: 'A', winRatePct: '75%' })
})

test('star tap navigates to player detail', () => {
  const def = loadPage()
  const ctx = makeCtx(def, { starHero: { star: { memberId: 'A' } } })
  ctx.onStarTap()
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/player-detail/index?id=A' })
})

test('tab change reloads rank and hero', () => {
  const def = loadPage()
  const ctx = makeCtx(def, { activeTab: 'singles' })
  ctx.loadRank = jest.fn()
  ctx.loadHero = jest.fn()
  ctx.onTabChange({ detail: { value: 'doubles' }, currentTarget: { dataset: {} } })
  expect(ctx.data.activeTab).toBe('doubles')
  expect(ctx.loadRank).toHaveBeenCalled()
  expect(ctx.loadHero).toHaveBeenCalled()
})
```

- [ ] **Step 6: Run rank tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/rank/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 7: Create player-detail page tests**

Create `miniprogram/pages/player-detail/__tests__/index.test.js`:

```js
function loadPage() {
  jest.resetModules()
  let pageDef
  global.Page = def => { pageDef = def }
  global.wx = { navigateTo: jest.fn(), showToast: jest.fn() }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...def.data, ...data },
    setData(patch) { Object.assign(this.data, patch) },
  }
}

test('setStateFromResponses maps stats, rank subtitle, h2h and recent', () => {
  const def = loadPage()
  const ctx = makeCtx(def, { seasonYear: 2026 })
  ctx.setStateFromResponses({
    player: { _id: 'A', name: 'A', playStyle: 'baseliner' },
    statsData: {
      stats: { singles: { winCount: 3, lossCount: 1, totalPoints: 100, winRate: 0.75 }, doubles: { winCount: 0, lossCount: 0, totalPoints: 0 } },
      currentRank: { singles: 1, doubles: null },
      rankHistory: { singles: [{ weekStart: '2026-05-11', rank: 1 }], doubles: [] },
      recent: [{ _id: 'm1', score: '4-2', pointsAwarded: 20 }],
    },
    h2hData: { singles: [{ opponentId: 'B', wins: 1, losses: 0 }], doubles: [] },
  })
  expect(ctx.data.rankSubtitle).toBe('S2026 · 单打 #1 · 双打 未上榜')
  expect(ctx.data.singlesPct).toBe('75%')
  expect(ctx.data.h2hVisible.singles).toHaveLength(1)
  expect(ctx.data.recent[0].pointsAwarded).toBe(20)
})

test('H2H tap navigates to opponent player detail', () => {
  const def = loadPage()
  const ctx = makeCtx(def)
  ctx.onH2HTap({ detail: { playerId: 'B' } })
  expect(wx.navigateTo).toHaveBeenCalledWith({ url: '/pages/player-detail/index?id=B' })
})
```

- [ ] **Step 8: Run player-detail tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/player-detail/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 9: Run all miniprogram tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- --runInBand
```

Expected: PASS. Baseline before this plan was 26 miniprogram tests; after Task 5 the count should increase by the new tests.

- [ ] **Step 10: Commit Task 5**

```bash
git add miniprogram/pages/tournament-score/__tests__/index.test.js miniprogram/pages/my-match/__tests__/index.test.js miniprogram/pages/rank/__tests__/index.test.js miniprogram/pages/player-detail/__tests__/index.test.js
git commit -m "test(miniprogram): cover e2e page regressions"
```

---

## Task 6: Manual E2E Checklist and Runbook

**Files:**
- Create: `docs/testing/e2e-regression-checklist.md`
- Create: `docs/testing/e2e-regression-runbook.md`

- [ ] **Step 1: Write the manual E2E checklist**

Create `docs/testing/e2e-regression-checklist.md`:

```markdown
# FOPEN E2E Regression Checklist

## Scope

Use this after `scripts/e2e-regression-smoke.js` has seeded fixture data. The fixture keeps confirmed rows for rank/player-detail smoke and interactive rows for login-state submit/confirm smoke.

## E2E-01 Admin Creates Regular Singles Tournament

Role: admin.

Steps:
1. Open the management entry.
2. Create a regular singles tournament.
3. Select 4 members and 2 courts.
4. Save schedule and finish creation.
5. Open tournament detail, then the score page.

Expected page state:
- Tournament appears as upcoming or ongoing.
- Score page shows at least 2 playable rows.

Expected database state:
- `tournaments` contains one `E2E_常规赛单打` row.
- `tournament_registrations` contains 4 confirmed rows for that tournament.
- `match_results` contains pending rows for that tournament.

## E2E-02 Member Submits Score

Role: normal member participating in the interactive fixture.

Steps:
1. Open `my-match`.
2. Tap the first pending score row.
3. Fill `4-2`.
4. Submit score.
5. Return to `my-match`.

Expected page state:
- The row moves from pending to submitted/confirming.

Expected database state:
- `match_results.resultStatus` is `submitted`.
- `score` is `{ sets: [{ a: 4, b: 2 }], tiebreak: null }`.
- `pointsAwarded` is `null`.

## E2E-03 Admin Confirms Submitted Score

Role: admin.

Steps:
1. Open management entry.
2. Open pending review for the interactive tournament.
3. Confirm the submitted row.
4. Open rank page and the winner player-detail page.

Expected page state:
- Pending review count decreases.
- Winner rank/player-detail shows increased points after refresh.

Expected database state:
- The row is `confirmed`.
- `pointsAwarded.entries` contains winner +20 and loser +10.

## E2E-04 Admin Saves Pending Score Directly

Role: admin.

Steps:
1. Open a pending score row.
2. Enter `4-2`.
3. Use “确认和保存比赛”.

Expected database state:
- The row becomes `confirmed` without needing a submitted intermediate state.
- `pointsAwarded.entries` is present.

## E2E-05 Knockout Complete Flow

Role: admin.

Steps:
1. Open the seeded knockout singles tournament.
2. Confirm both R1 matches.
3. Confirm the final.
4. Open rank and champion player-detail.

Expected database state:
- Final slots are populated from R1 winners.
- Tournament status is `completed`.
- `tournament_points` contains champion, runnerUp, and semifinal placement rows.

## E2E-06 Reconfirm Rollback

Role: admin.

Steps:
1. Open a completed knockout R1 match.
2. Change the score so the other player wins.
3. Save.

Expected database state:
- Downstream final row clears `score`, `winner`, and `pointsAwarded`.
- Placement rows are cleared or recalculated.
- Tournament status becomes `ongoing`.

## E2E-07 Doubles Points

Role: admin or participating member.

Steps:
1. Open seeded doubles tournament.
2. Confirm A+B vs C+D.
3. Open doubles rank and A player-detail.

Expected database state:
- A/B receive winner entries.
- C/D receive loser entries.

## E2E-08 Non-participant Cannot Submit

Role: normal member not in the match.

Steps:
1. Open a match that does not include the current member.
2. Try to submit score.

Expected:
- Page is not editable or submit fails.
- `match_results` row remains unchanged.

## E2E-09 Admin Mixed Role

Role: admin who participates in the interactive fixture.

Steps:
1. Open `my-match`.
2. Open management entry.

Expected:
- `my-match` shows only member participant view.
- Management entry shows admin actions.

## E2E-10 Member Cannot Overwrite Confirmed

Role: normal member.

Steps:
1. Open a confirmed match.
2. Try to edit and submit.

Expected:
- Page is read-only or submit fails.
- `score`, `resultStatus`, and `pointsAwarded` remain unchanged.
```

- [ ] **Step 2: Write the runbook**

Create `docs/testing/e2e-regression-runbook.md`:

```markdown
# FOPEN E2E Regression Runbook

## Local Regression

Run scripts tests:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- --runInBand
```

Run match-results tests:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- --runInBand
```

Run points-engine tests:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- --runInBand
```

Run miniprogram tests:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- --runInBand
```

## Guarded Cloud Cleanup, Seed, and Smoke

This clears business test collections and keeps `members`, `courts`, `seasons`, and `_request_log`.

```bash
cd /Users/liaoxiaole/FOPEN-PURE
FOPEN_CLOUD_ENV=cloud1-0gthnke69a09f52a \
FOPEN_CLEANUP_CONFIRM=cloud1-0gthnke69a09f52a \
FOPEN_RESET_BUSINESS_DATA=YES \
FOPEN_E2E_MODE=cleanup-seed-smoke \
SEASON_ID=season_2026 \
node scripts/e2e-regression-smoke.js
```

Use cleanup-only after manual verification:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
FOPEN_CLOUD_ENV=cloud1-0gthnke69a09f52a \
FOPEN_CLEANUP_CONFIRM=cloud1-0gthnke69a09f52a \
FOPEN_RESET_BUSINESS_DATA=YES \
FOPEN_E2E_MODE=cleanup-only \
SEASON_ID=season_2026 \
node scripts/e2e-regression-smoke.js
```

## DevTools Login-state Smoke

1. Seed fixture with `cleanup-seed-smoke`.
2. Open the mini program in WeChat DevTools.
3. Use `docs/testing/e2e-regression-checklist.md` cases E2E-02, E2E-03, and E2E-09 for login-state paths.
4. Keep fixture data if another role needs to verify the same seeded tournament.
```

- [ ] **Step 3: Verify docs contain no placeholder markers**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
node -e "const fs=require('fs'); const files=['docs/testing/e2e-regression-checklist.md','docs/testing/e2e-regression-runbook.md']; const needles=[String.fromCharCode(84,66,68),'待'+'定','占'+'位','以后'+'再补']; let found=false; for (const f of files) { const text=fs.readFileSync(f,'utf8'); for (const n of needles) if (text.includes(n)) { console.error(f+': '+n); found=true; } } process.exit(found ? 1 : 0)"
```

Expected: exit code 1 with no matches.

- [ ] **Step 4: Commit Task 6**

```bash
git add docs/testing/e2e-regression-checklist.md docs/testing/e2e-regression-runbook.md
git commit -m "docs(testing): add e2e regression runbook"
```

---

## Task 7: Full Verification

**Files:**
- No source file changes unless verification exposes a defect.

- [ ] **Step 1: Run scripts tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- --runInBand
```

Expected: all scripts tests pass, including cleanup, fixture, smoke, and existing backfill tests.

- [ ] **Step 2: Run core cloud function tests**

Run each command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/_shared
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/tournament-brackets
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/tournaments
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/weekly-star
npm test -- --runInBand
```

Expected: all pass. If a package lacks installed dependencies, run `npm install` inside that package and re-run the same command.

- [ ] **Step 3: Run miniprogram tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- --runInBand
```

Expected: all pass.

- [ ] **Step 4: Run sync mirror check**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
bash scripts/sync-shared-libs.sh
```

Expected: all hash checks pass. If this reports drift, inspect the reported file pair and sync only the intended mirror.

- [ ] **Step 5: Run safe-failure smoke command**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
node scripts/e2e-regression-smoke.js
```

Expected: command exits non-zero with the safety error. This proves the destructive script cannot run without explicit env confirmation.

- [ ] **Step 6: Run target cloud smoke only after confirming destructive reset**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
FOPEN_CLOUD_ENV=cloud1-0gthnke69a09f52a \
FOPEN_CLEANUP_CONFIRM=cloud1-0gthnke69a09f52a \
FOPEN_RESET_BUSINESS_DATA=YES \
FOPEN_E2E_MODE=cleanup-seed-smoke \
SEASON_ID=season_2026 \
node scripts/e2e-regression-smoke.js
```

Expected:
- 8 business collections are cleared.
- Fixture ids are printed.
- `rankList.singles`, `playerStats.A`, and `playerH2H.A` smoke checks print `ok`.
- Fixture remains in the target environment for DevTools/manual E2E.

- [ ] **Step 7: Record verification outcome**

Create or append a short run note in `docs/testing/e2e-regression-runbook.md` under a `## Last Verified` section:

```markdown
## Last Verified

- Date: 2026-05-17
- Local scripts tests: PASS
- Cloud function tests: PASS
- Miniprogram tests: PASS
- Sync mirrors: PASS
- Safe-failure smoke: PASS
- Target cloud smoke: PASS or not run, with reason
- Fixture state: retained for DevTools smoke or cleaned
```

- [ ] **Step 8: Commit Task 7**

```bash
git add docs/testing/e2e-regression-runbook.md
git commit -m "docs(testing): record e2e regression verification"
```

---

## Task 8: Final Handoff

**Files:**
- No source file changes unless verification exposes a defect.

- [ ] **Step 1: Check git status**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git status --short
```

Expected: clean, or only intentional fixture/report artifacts explicitly listed.

- [ ] **Step 2: Summarize deliverables**

Prepare final handoff with:

```markdown
Implemented:
- Local Jest regression coverage for scripts, match-results, points-engine, and miniprogram pages.
- Guarded cloud cleanup/seed/smoke runner.
- Manual E2E checklist and runbook.

Verified:
- scripts tests: PASS
- match-results tests: PASS
- points-engine tests: PASS
- miniprogram tests: PASS
- sync-shared-libs: PASS
- cloud smoke: PASS or not run with reason

Cloud data:
- Fixture retained or cleaned.
- Target env: cloud1-0gthnke69a09f52a.
```

- [ ] **Step 3: Commit any remaining intentional documentation update**

If Task 7 updated runbook after the last commit, run:

```bash
git add docs/testing/e2e-regression-runbook.md
git commit -m "docs(testing): finalize e2e regression notes"
```

Expected: either a new commit is created, or no commit is needed because the working tree is clean.

---

## Execution Notes

- Do not run the destructive cloud smoke until after all local tests pass and the exact target env is visible in the command.
- Do not clear `members`, `courts`, `seasons`, or `_request_log`.
- Do not add a test-only cloud function to bypass `wxContext.OPENID`.
- If DevTools automator is unavailable, record Layer C as manual smoke and execute the checklist by hand.
- If target cloud smoke fails after seeding, leave fixture data in place for inspection and do not run cleanup-only until the failure is understood.
