# Ranking Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add settlement-driven ranking and player analytics caches so rankings update after score confirmation, player detail explains recent form and doubles relationships, and doubles H2H displays team-vs-team.

**Architecture:** Add a new `analytics-engine` cloud function with pure calculators and cache writers for `player_analytics`, `pair_analytics`, and `analytics_jobs`. Keep existing `rank` and `player-detail` pages, but have score settlement refresh `rank_cache`, trigger analytics refresh for affected members/pairs, and expose analytics data through additive APIs with fallbacks to current `points-engine` contracts.

**Tech Stack:** WeChat Mini Program native JS, `wx-server-sdk`, CloudBase database collections, Jest 29, existing `utils/page-cache`, existing `points-engine` ranking logic.

## Global Constraints

- Keep existing rankings, score confirmation, tournament scheduling, and points rules behavior unchanged.
- Do not add a new data-center tab or page.
- Score confirmation must not roll back when analytics cache refresh fails.
- Trend display states must include `▲N`, `▼N`, `持平`, `新上榜`, and `暂无历史`.
- Doubles H2H must display `subjectTeam` vs `opponentTeam`, not `current user` vs one opponent.
- Official settlement routes that change confirmed scores must refresh rank cache and analytics: `batchConfirm`, `batchAdminSave`, `reconfirmMatch`, and `confirmAll`.
- Ranking and cumulative player totals must continue to use the existing source of truth: `baseline_standings + confirmed match_results + tournament_points`, through `points-engine` ranking/player stats helpers. Analytics must not replace those totals with match-only aggregates.
- Analytics caches may store member ids, pair ids, and aggregate counts; display names, avatar URLs, and public visibility must be resolved at read time from current `members` data through analytics-owned identity helpers that anonymize both name and avatar when `publicProfileConsent !== true`.
- Analytics and snapshot rebuilds must page through full collections; no production query may silently cap a season at 500 rows.
- New collections must be created or documented with required indexes before deployment: `player_analytics`, `pair_analytics`, and `analytics_jobs`.
- Use additive APIs and fields so existing pages keep working while analytics caches are unavailable.
- Prefer focused pure helpers under `cloudfunctions/analytics-engine/lib/` and keep cloud SDK code in `cloudfunctions/analytics-engine/index.js`.

---

## File Structure

Create:

- `cloudfunctions/analytics-engine/package.json` — cloud function package and Jest config.
- `cloudfunctions/analytics-engine/config.json` — cloud function config.
- `cloudfunctions/analytics-engine/index.js` — cloud entry actions, CloudBase reads/writes, job logging.
- `cloudfunctions/analytics-engine/lib/ids.js` — stable cache ids and pair id normalization.
- `cloudfunctions/analytics-engine/lib/teams.js` — singles/doubles team extraction and display helpers.
- `cloudfunctions/analytics-engine/lib/player-analytics.js` — pure player analytics aggregation.
- `cloudfunctions/analytics-engine/lib/pair-analytics.js` — pure doubles pair analytics aggregation.
- `cloudfunctions/analytics-engine/lib/identity.js` — resolve public-safe display names from cached member ids at read time.
- `cloudfunctions/analytics-engine/lib/__tests__/ids.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/teams.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/player-analytics.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/pair-analytics.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/identity.test.js`
- `cloudfunctions/analytics-engine/__tests__/index.test.js`

Modify:

- `cloudfunctions/match-results/index.js` — call analytics refresh after successful admin confirmation paths.
- `cloudfunctions/match-results/lib/handlers/batch.js` — return `analyticsStatus` and `settlementImpact` from batch admin save / confirm.
- `cloudfunctions/match-results/lib/handlers/submit.js` — return analytics metadata for direct `confirmAll` and `reconfirmMatch`.
- `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`
- `cloudfunctions/match-results/lib/__tests__/handlers/submit.test.js`
- `cloudfunctions/match-results/__tests__/analytics-integration.test.js`
- `cloudfunctions/points-engine/lib/settlement-impact.js` — pure rank/points impact summary used during rank cache refresh.
- `cloudfunctions/points-engine/lib/__tests__/settlement-impact.test.js`
- `cloudfunctions/points-engine/index.js` — return explicit trend state fields from `rankList`, write snapshot rows after rank cache refresh, and expose a rebuild action.
- `cloudfunctions/points-engine/__tests__/index.test.js`
- `miniprogram/pages/rank/index.js`
- `miniprogram/pages/rank/index.wxml`
- `miniprogram/pages/rank/__tests__/index.test.js`
- `miniprogram/pages/tournament-score/index.js`
- `miniprogram/pages/tournament-score/__tests__/index.test.js`
- `miniprogram/components/batch-result-sheet/index.js`
- `miniprogram/components/batch-result-sheet/index.wxml`
- `miniprogram/components/batch-result-sheet/__tests__/index.test.js`
- `miniprogram/pages/player-detail/index.js`
- `miniprogram/pages/player-detail/index.wxml`
- `miniprogram/pages/player-detail/index.wxss`
- `miniprogram/pages/player-detail/__tests__/index.test.js`
- `miniprogram/components/h2h-row/index.js`
- `miniprogram/components/h2h-row/index.wxml`
- `miniprogram/components/h2h-row/index.wxss`
- `miniprogram/components/h2h-row/__tests__/index.test.js`
- `cloudfunctions/DATABASE_SCHEMA.md`
- `docs/testing/e2e-regression-runbook.md`

---

### Task 1: Analytics Engine Pure Aggregators

**Files:**
- Create: `cloudfunctions/analytics-engine/package.json`
- Create: `cloudfunctions/analytics-engine/config.json`
- Create: `cloudfunctions/analytics-engine/lib/ids.js`
- Create: `cloudfunctions/analytics-engine/lib/teams.js`
- Create: `cloudfunctions/analytics-engine/lib/player-analytics.js`
- Create: `cloudfunctions/analytics-engine/lib/pair-analytics.js`
- Create: `cloudfunctions/analytics-engine/lib/identity.js`
- Create: `cloudfunctions/analytics-engine/lib/__tests__/ids.test.js`
- Create: `cloudfunctions/analytics-engine/lib/__tests__/teams.test.js`
- Create: `cloudfunctions/analytics-engine/lib/__tests__/player-analytics.test.js`
- Create: `cloudfunctions/analytics-engine/lib/__tests__/pair-analytics.test.js`
- Create: `cloudfunctions/analytics-engine/lib/__tests__/identity.test.js`

**Interfaces:**
- Produces: `analyticsPlayerId(seasonId: string, memberId: string): string`
- Produces: `pairKey(memberIds: string[]): { pairId: string, memberIds: string[] }`
- Produces: `sideMembers(side: object): Array<{ memberId: string, name: string }>`
- Produces: `teamLabel(members: Array<{ name: string, memberId: string }>): string`
- Produces: `buildPlayerAnalytics({ seasonId, memberId, rows, membersById, rankRowsByType }): object`
- Produces: `buildPairAnalytics({ seasonId, pairMemberIds, rows, membersById }): object`
- Produces: `resolveAnalyticsIdentities(doc: object, membersById: Map): object`
- Produces: `analytics.doubles.teamH2H: Array<{ key, subjectTeam, opponentTeam, subjectTeamLabel, opponentTeamLabel, wins, losses, recentMatches }>`

- [ ] **Step 1: Create package and config**

Write `cloudfunctions/analytics-engine/package.json`:

```json
{
  "name": "analytics-engine",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "test": "jest"
  },
  "dependencies": {
    "wx-server-sdk": "~3.0.4"
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

Write `cloudfunctions/analytics-engine/config.json`:

```json
{}
```

- [ ] **Step 2: Write failing id tests**

Create `cloudfunctions/analytics-engine/lib/__tests__/ids.test.js`:

```js
const { analyticsPlayerId, pairKey, pairAnalyticsId } = require('../ids')

test('analyticsPlayerId is stable by season and member', () => {
  expect(analyticsPlayerId('season_2026', 'member_a')).toBe('pa_season_2026_member_a')
})

test('pairKey sorts ids and rejects non-pairs', () => {
  expect(pairKey(['b', 'a'])).toEqual({ pairId: 'a__b', memberIds: ['a', 'b'] })
  expect(() => pairKey(['a'])).toThrow('PAIR_REQUIRES_TWO_MEMBERS')
  expect(() => pairKey(['a', 'a'])).toThrow('PAIR_REQUIRES_TWO_DISTINCT_MEMBERS')
})

test('pairAnalyticsId uses normalized pair id', () => {
  expect(pairAnalyticsId('season_2026', ['b', 'a'])).toBe('pair_season_2026_a__b')
})
```

- [ ] **Step 3: Run id tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js
```

Expected: FAIL with `Cannot find module '../ids'`.

- [ ] **Step 4: Implement id helpers**

Create `cloudfunctions/analytics-engine/lib/ids.js`:

```js
function analyticsPlayerId(seasonId, memberId) {
  return `pa_${seasonId}_${memberId}`
}

function pairKey(memberIds) {
  const ids = [...new Set((memberIds || []).filter(Boolean))].sort()
  if (ids.length !== 2) {
    const err = new Error(ids.length === 1 ? 'PAIR_REQUIRES_TWO_DISTINCT_MEMBERS' : 'PAIR_REQUIRES_TWO_MEMBERS')
    err.code = err.message
    throw err
  }
  return { pairId: `${ids[0]}__${ids[1]}`, memberIds: ids }
}

function pairAnalyticsId(seasonId, memberIds) {
  return `pair_${seasonId}_${pairKey(memberIds).pairId}`
}

module.exports = { analyticsPlayerId, pairKey, pairAnalyticsId }
```

- [ ] **Step 5: Verify id helpers pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js
```

Expected: PASS.

- [ ] **Step 6: Write failing team helper tests**

Create `cloudfunctions/analytics-engine/lib/__tests__/teams.test.js`:

```js
const { sideMembers, sideHasMember, opponentSide, teamLabel, resultRoleForMember } = require('../teams')

const doublesRow = {
  player1: { id: 'A', name: '乐乐', partnerId: 'B', partnerName: '小野马' },
  player2: { id: 'C', name: '小天', partnerId: 'D', partnerName: '标子' },
  pointsAwarded: { entries: [
    { memberId: 'A', role: 'winner' },
    { memberId: 'B', role: 'winner' },
    { memberId: 'C', role: 'loser' },
    { memberId: 'D', role: 'loser' }
  ] }
}

test('sideMembers extracts primary and partner members', () => {
  expect(sideMembers(doublesRow.player1)).toEqual([
    { memberId: 'A', name: '乐乐' },
    { memberId: 'B', name: '小野马' }
  ])
})

test('opponentSide returns the other doubles side', () => {
  expect(teamLabel(sideMembers(opponentSide(doublesRow, 'A')))).toBe('小天 / 标子')
})

test('resultRoleForMember reads pointsAwarded role', () => {
  expect(resultRoleForMember(doublesRow, 'A')).toBe('winner')
  expect(resultRoleForMember(doublesRow, 'D')).toBe('loser')
  expect(resultRoleForMember(doublesRow, 'X')).toBe(null)
})

test('sideHasMember detects primary and partner ids', () => {
  expect(sideHasMember(doublesRow.player1, 'A')).toBe(true)
  expect(sideHasMember(doublesRow.player1, 'B')).toBe(true)
  expect(sideHasMember(doublesRow.player1, 'C')).toBe(false)
})
```

- [ ] **Step 7: Run team helper tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/teams.test.js
```

Expected: FAIL with `Cannot find module '../teams'`.

- [ ] **Step 8: Implement team helpers**

Create `cloudfunctions/analytics-engine/lib/teams.js`:

```js
function sideMembers(side) {
  if (!side) return []
  const out = []
  const id = side.id || side.memberId || side.playerId || side._id
  if (id) out.push({ memberId: id, name: side.name || id })
  if (side.partnerId) out.push({ memberId: side.partnerId, name: side.partnerName || side.partnerId })
  return out
}

function sideHasMember(side, memberId) {
  return sideMembers(side).some(member => member.memberId === memberId)
}

function subjectSide(row, memberId) {
  if (sideHasMember(row && row.player1, memberId)) return row.player1
  if (sideHasMember(row && row.player2, memberId)) return row.player2
  return null
}

function opponentSide(row, memberId) {
  if (sideHasMember(row && row.player1, memberId)) return row.player2 || null
  if (sideHasMember(row && row.player2, memberId)) return row.player1 || null
  return null
}

function teamLabel(members) {
  const names = (members || []).map(member => member.name || member.memberId).filter(Boolean)
  return names.join(' / ')
}

function resultRoleForMember(row, memberId) {
  const entries = (row && row.pointsAwarded && row.pointsAwarded.entries) || []
  const hit = entries.find(entry => entry.memberId === memberId)
  return hit && hit.role ? hit.role : null
}

module.exports = { sideMembers, sideHasMember, subjectSide, opponentSide, teamLabel, resultRoleForMember }
```

- [ ] **Step 9: Verify team helper tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/teams.test.js
```

Expected: PASS.

- [ ] **Step 10: Write failing player analytics tests**

Create `cloudfunctions/analytics-engine/lib/__tests__/player-analytics.test.js`:

```js
const { buildPlayerAnalytics } = require('../player-analytics')

const membersById = new Map([
  ['P', { _id: 'P', name: '乐乐' }],
  ['A', { _id: 'A', name: '小天' }],
  ['B', { _id: 'B', name: '标子' }],
  ['M', { _id: 'M', name: '小野马' }]
])

test('buildPlayerAnalytics includes lastFive, strongAgainst and strugglesAgainst', () => {
  const rows = [
    row('m1', 'singles', ['P', 'A'], 'P', 'A', '2026-06-01'),
    row('m2', 'singles', ['P', 'A'], 'A', 'P', '2026-06-02'),
    row('m3', 'singles', ['P', 'B'], 'P', 'B', '2026-06-03'),
    row('m4', 'singles', ['P', 'B'], 'P', 'B', '2026-06-04'),
    row('m5', 'singles', ['P', 'B'], 'P', 'B', '2026-06-05'),
    doublesRow('d1', ['P', 'M'], ['A', 'B'], ['P', 'M'], ['A', 'B'], '2026-06-06')
  ]

  const out = buildPlayerAnalytics({
    seasonId: 'season_2026',
    memberId: 'P',
    rows,
    membersById,
    rankRowsByType: { singles: [], doubles: [] }
  })

  expect(out._id).toBe('pa_season_2026_P')
  expect(out.singles.lastFive.summary).toBe('4W-1L')
  expect(out.singles.strongAgainst[0]).toMatchObject({ memberId: 'B', name: '标子', wins: 3, losses: 0 })
  expect(out.singles.strugglesAgainst[0]).toMatchObject({ memberId: 'A', name: '小天', wins: 1, losses: 1 })
  expect(out.doubles.bestPartners[0]).toMatchObject({ memberId: 'M', name: '小野马', wins: 1, losses: 0, matches: 1 })
  expect(out.doubles.teamH2H[0]).toMatchObject({ subjectTeam: [{ memberId: 'P' }, { memberId: 'M' }], opponentTeam: [{ memberId: 'A' }, { memberId: 'B' }], wins: 1, losses: 0 })
  expect(out.recentMatches[0]).toMatchObject({ matchId: 'd1', tournamentType: 'doubles', subjectTeam: [{ memberId: 'P' }, { memberId: 'M' }], opponentTeam: [{ memberId: 'A' }, { memberId: 'B' }] })
})

function row(id, type, playerIds, winnerId, loserId, confirmedAt) {
  return {
    _id: id,
    tournamentType: type,
    seasonId: 'season_2026',
    resultStatus: 'confirmed',
    confirmedAt,
    createTime: confirmedAt,
    playerIds,
    player1: { id: playerIds[0], name: nameOf(playerIds[0]) },
    player2: { id: playerIds[1], name: nameOf(playerIds[1]) },
    pointsAwarded: { entries: [
      { memberId: winnerId, points: 20, role: 'winner' },
      { memberId: loserId, points: 10, role: 'loser' }
    ] }
  }
}

function doublesRow(id, subjectIds, opponentIds, winnerIds, loserIds, confirmedAt) {
  return {
    _id: id,
    tournamentType: 'doubles',
    seasonId: 'season_2026',
    resultStatus: 'confirmed',
    confirmedAt,
    createTime: confirmedAt,
    playerIds: [...subjectIds, ...opponentIds],
    player1: { id: subjectIds[0], name: nameOf(subjectIds[0]), partnerId: subjectIds[1], partnerName: nameOf(subjectIds[1]) },
    player2: { id: opponentIds[0], name: nameOf(opponentIds[0]), partnerId: opponentIds[1], partnerName: nameOf(opponentIds[1]) },
    pointsAwarded: { entries: [
      ...winnerIds.map(memberId => ({ memberId, points: 20, role: 'winner' })),
      ...loserIds.map(memberId => ({ memberId, points: 10, role: 'loser' }))
    ] }
  }
}

function nameOf(id) {
  return (membersById.get(id) && membersById.get(id).name) || id
}
```

- [ ] **Step 11: Run player analytics tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js
```

Expected: FAIL with `Cannot find module '../player-analytics'`.

- [ ] **Step 12: Implement player analytics**

Create `cloudfunctions/analytics-engine/lib/player-analytics.js` with this public shape and supporting helpers:

```js
const { analyticsPlayerId, pairKey } = require('./ids')
const { opponentSide, resultRoleForMember, sideMembers, subjectSide } = require('./teams')

function buildPlayerAnalytics({ seasonId, memberId, rows, membersById, rankRowsByType }) {
  const relevantRows = (rows || [])
    .filter(row => row && row.resultStatus === 'confirmed' && Array.isArray(row.playerIds) && row.playerIds.includes(memberId))
    .sort((a, b) => timeOf(b) - timeOf(a))
  const singlesRows = relevantRows.filter(row => row.tournamentType !== 'doubles')
  const doublesRows = relevantRows.filter(row => row.tournamentType === 'doubles')
  return {
    _id: analyticsPlayerId(seasonId, memberId),
    seasonId,
    memberId,
    updatedAt: new Date(),
    sourceVersion: 1,
    singles: buildBucket({ rows: singlesRows, memberId, membersById, type: 'singles' }),
    doubles: buildBucket({ rows: doublesRows, memberId, membersById, type: 'doubles' }),
    recentMatches: relevantRows.slice(0, 10).map(row => formatRecent(row, memberId, membersById)),
    lastSettlementImpact: null,
    rankSnapshot: rankRowsByType || { singles: [], doubles: [] }
  }
}

function buildBucket({ rows, memberId, membersById, type }) {
  const wins = rows.filter(row => resultRoleForMember(row, memberId) === 'winner').length
  const losses = rows.filter(row => resultRoleForMember(row, memberId) === 'loser').length
  return {
    matchWinCount: wins,
    matchLossCount: losses,
    lastFive: buildLastFive(rows, memberId),
    bestPartners: type === 'doubles' ? buildBestPartners(rows, memberId, membersById) : [],
    teamH2H: type === 'doubles' ? buildTeamH2H(rows, memberId, membersById) : [],
    strongAgainst: buildOpponentRecords(rows, memberId, membersById).filter(row => row.wins > row.losses),
    strugglesAgainst: buildOpponentRecords(rows, memberId, membersById).filter(row => row.losses >= row.wins)
  }
}

function buildLastFive(rows, memberId) {
  const list = rows.slice(0, 5).map(row => resultRoleForMember(row, memberId) === 'winner' ? 'W' : 'L')
  const wins = list.filter(v => v === 'W').length
  const losses = list.filter(v => v === 'L').length
  return { results: list, wins, losses, summary: `${wins}W-${losses}L` }
}

function buildBestPartners(rows, memberId, membersById) {
  const map = new Map()
  for (const row of rows) {
    const subject = subjectSide(row, memberId)
    for (const member of sideMembers(subject)) {
      if (member.memberId === memberId) continue
      const current = map.get(member.memberId) || { memberId: member.memberId, name: memberName(membersById, member.memberId, member.name), wins: 0, losses: 0, matches: 0 }
      current.matches += 1
      if (resultRoleForMember(row, memberId) === 'winner') current.wins += 1
      else current.losses += 1
      current.winRate = current.matches > 0 ? current.wins / current.matches : 0
      map.set(member.memberId, current)
    }
  }
  return [...map.values()].sort((a, b) => b.winRate - a.winRate || b.matches - a.matches || a.memberId.localeCompare(b.memberId))
}

function buildTeamH2H(rows, memberId, membersById) {
  const map = new Map()
  for (const row of rows) {
    const subject = sideMembers(subjectSide(row, memberId)).map(member => ({ ...member, name: memberName(membersById, member.memberId, member.name) }))
    const opponent = sideMembers(opponentSide(row, memberId)).map(member => ({ ...member, name: memberName(membersById, member.memberId, member.name) }))
    if (subject.length !== 2 || opponent.length !== 2) continue
    const subjectKey = pairKey(subject.map(member => member.memberId)).pairId
    const opponentKey = pairKey(opponent.map(member => member.memberId)).pairId
    const key = `${subjectKey}__vs__${opponentKey}`
    const current = map.get(key) || {
      key,
      subjectTeam: subject,
      opponentTeam: opponent,
      wins: 0,
      losses: 0,
      recentMatches: []
    }
    const role = resultRoleForMember(row, memberId)
    if (role === 'winner') current.wins += 1
    else if (role === 'loser') current.losses += 1
    current.recentMatches.push(formatRecent(row, memberId, membersById))
    current.recentMatches = current.recentMatches
      .sort((a, b) => timeOf({ confirmedAt: b.confirmedAt }) - timeOf({ confirmedAt: a.confirmedAt }))
      .slice(0, 3)
    map.set(key, current)
  }
  return [...map.values()].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || a.key.localeCompare(b.key))
}

function buildOpponentRecords(rows, memberId, membersById) {
  const map = new Map()
  for (const row of rows) {
    const opponents = sideMembers(opponentSide(row, memberId))
    for (const opponent of opponents) {
      const current = map.get(opponent.memberId) || { memberId: opponent.memberId, name: memberName(membersById, opponent.memberId, opponent.name), wins: 0, losses: 0, matches: 0 }
      current.matches += 1
      if (resultRoleForMember(row, memberId) === 'winner') current.wins += 1
      else current.losses += 1
      current.winRate = current.matches > 0 ? current.wins / current.matches : 0
      map.set(opponent.memberId, current)
    }
  }
  return [...map.values()].sort((a, b) => b.matches - a.matches || a.memberId.localeCompare(b.memberId))
}

function formatRecent(row, memberId, membersById) {
  const subject = sideMembers(subjectSide(row, memberId)).map(member => ({ ...member, name: memberName(membersById, member.memberId, member.name) }))
  const opponent = sideMembers(opponentSide(row, memberId)).map(member => ({ ...member, name: memberName(membersById, member.memberId, member.name) }))
  return {
    matchId: row._id,
    tournamentId: row.tournamentId || '',
    tournamentType: row.tournamentType || 'singles',
    confirmedAt: row.confirmedAt || row.createTime || null,
    won: resultRoleForMember(row, memberId) === 'winner',
    pointsAwarded: pointsFor(row, memberId),
    subjectTeam: subject,
    opponentTeam: opponent
  }
}

function pointsFor(row, memberId) {
  const entries = (row && row.pointsAwarded && row.pointsAwarded.entries) || []
  const entry = entries.find(item => item.memberId === memberId)
  return entry ? Number(entry.points) || 0 : 0
}

function memberName(membersById, memberId, fallback) {
  const member = membersById && membersById.get(memberId)
  return (member && member.name) || fallback || memberId
}

function timeOf(row) {
  return new Date((row && (row.confirmedAt || row.createTime)) || 0).getTime() || 0
}

module.exports = { buildPlayerAnalytics, buildBucket, buildLastFive, buildTeamH2H, formatRecent }
```

- [ ] **Step 13: Verify player analytics tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js
```

Expected: PASS.

- [ ] **Step 14: Write failing pair analytics tests**

Create `cloudfunctions/analytics-engine/lib/__tests__/pair-analytics.test.js`:

```js
const { buildPairAnalytics } = require('../pair-analytics')

const membersById = new Map([
  ['A', { _id: 'A', name: '乐乐' }],
  ['B', { _id: 'B', name: '小野马' }],
  ['C', { _id: 'C', name: '小天' }],
  ['D', { _id: 'D', name: '标子' }]
])

test('buildPairAnalytics aggregates team-vs-team matchups', () => {
  const rows = [
    row('m1', ['A', 'B'], ['C', 'D'], ['A', 'B'], ['C', 'D'], '2026-06-01'),
    row('m2', ['A', 'B'], ['C', 'D'], ['C', 'D'], ['A', 'B'], '2026-06-02'),
    row('m3', ['A', 'B'], ['C', 'D'], ['A', 'B'], ['C', 'D'], '2026-06-03')
  ]

  const out = buildPairAnalytics({ seasonId: 'season_2026', pairMemberIds: ['B', 'A'], rows, membersById })

  expect(out._id).toBe('pair_season_2026_A__B')
  expect(out.memberIds).toEqual(['A', 'B'])
  expect(out).toMatchObject({ matches: 3, wins: 2, losses: 1, winRate: 2 / 3 })
  expect(out.matchups[0]).toMatchObject({
    opponentPairId: 'C__D',
    opponentMemberIds: ['C', 'D'],
    wins: 2,
    losses: 1
  })
})

function row(id, subjectIds, opponentIds, winnerIds, loserIds, confirmedAt) {
  return {
    _id: id,
    tournamentType: 'doubles',
    seasonId: 'season_2026',
    resultStatus: 'confirmed',
    confirmedAt,
    createTime: confirmedAt,
    playerIds: [...subjectIds, ...opponentIds],
    player1: { id: subjectIds[0], name: nameOf(subjectIds[0]), partnerId: subjectIds[1], partnerName: nameOf(subjectIds[1]) },
    player2: { id: opponentIds[0], name: nameOf(opponentIds[0]), partnerId: opponentIds[1], partnerName: nameOf(opponentIds[1]) },
    pointsAwarded: { entries: [
      ...winnerIds.map(memberId => ({ memberId, points: 20, role: 'winner' })),
      ...loserIds.map(memberId => ({ memberId, points: 10, role: 'loser' }))
    ] }
  }
}

function nameOf(id) {
  return membersById.get(id).name
}
```

- [ ] **Step 15: Run pair analytics tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/pair-analytics.test.js
```

Expected: FAIL with `Cannot find module '../pair-analytics'`.

- [ ] **Step 16: Implement pair analytics**

Create `cloudfunctions/analytics-engine/lib/pair-analytics.js`:

```js
const { pairAnalyticsId, pairKey } = require('./ids')
const { resultRoleForMember, sideMembers } = require('./teams')

function buildPairAnalytics({ seasonId, pairMemberIds, rows, membersById }) {
  const normalized = pairKey(pairMemberIds)
  const pairSet = new Set(normalized.memberIds)
  const pairRows = (rows || [])
    .filter(row => row && row.tournamentType === 'doubles' && row.resultStatus === 'confirmed')
    .filter(row => rowHasPair(row, pairSet))
    .sort((a, b) => timeOf(b) - timeOf(a))
  let wins = 0
  let losses = 0
  const matchups = new Map()
  for (const row of pairRows) {
    const role = resultRoleForMember(row, normalized.memberIds[0])
    if (role === 'winner') wins += 1
    else if (role === 'loser') losses += 1
    const opponent = opponentMembers(row, pairSet)
    if (opponent.length === 2) {
      const opponentKey = pairKey(opponent.map(member => member.memberId))
      const current = matchups.get(opponentKey.pairId) || {
        opponentPairId: opponentKey.pairId,
        opponentMemberIds: opponentKey.memberIds,
        wins: 0,
        losses: 0,
        lastPlayedAt: null
      }
      if (role === 'winner') current.wins += 1
      else if (role === 'loser') current.losses += 1
      if (!current.lastPlayedAt || timeOf(row) > timeOf({ confirmedAt: current.lastPlayedAt })) {
        current.lastPlayedAt = row.confirmedAt || row.createTime || null
      }
      matchups.set(opponentKey.pairId, current)
    }
  }
  return {
    _id: pairAnalyticsId(seasonId, normalized.memberIds),
    seasonId,
    pairId: normalized.pairId,
    memberIds: normalized.memberIds,
    matches: pairRows.length,
    wins,
    losses,
    winRate: pairRows.length > 0 ? wins / pairRows.length : 0,
    recentMatches: pairRows.slice(0, 5).map(row => ({ matchId: row._id, confirmedAt: row.confirmedAt || row.createTime || null })),
    matchups: [...matchups.values()].sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses) || a.opponentPairId.localeCompare(b.opponentPairId)),
    updatedAt: new Date(),
    sourceVersion: 1
  }
}

function rowHasPair(row, pairSet) {
  return [row.player1, row.player2].some(side => {
    const ids = sideMembers(side).map(member => member.memberId)
    return ids.length === 2 && ids.every(id => pairSet.has(id))
  })
}

function opponentMembers(row, pairSet) {
  for (const side of [row.player1, row.player2]) {
    const members = sideMembers(side)
    if (members.length === 2 && members.every(member => !pairSet.has(member.memberId))) return members
  }
  return []
}

function timeOf(row) {
  return new Date((row && (row.confirmedAt || row.createTime)) || 0).getTime() || 0
}

module.exports = { buildPairAnalytics, rowHasPair, opponentMembers }
```

- [ ] **Step 17: Write failing public identity resolution tests**

Create `cloudfunctions/analytics-engine/lib/__tests__/identity.test.js`:

```js
const { resolveAnalyticsIdentities } = require('../identity')

test('resolveAnalyticsIdentities formats cached member ids from current member consent', () => {
  const membersById = new Map([
    ['A', { _id: 'A', name: '乐乐', avatarUrl: 'cloud://avatar-a', publicProfileConsent: false }],
    ['B', { _id: 'B', name: '小野马', avatarUrl: 'cloud://avatar-b', publicProfileConsent: true }],
    ['C', { _id: 'C', name: '小天', avatarUrl: 'cloud://avatar-c', publicProfileConsent: true }],
    ['D', { _id: 'D', name: '标子', avatarUrl: 'cloud://avatar-d', publicProfileConsent: true }]
  ])
  const out = resolveAnalyticsIdentities({
    memberId: 'A',
    doubles: {
      teamH2H: [{
        key: 'A__B__vs__C__D',
        subjectTeam: [{ memberId: 'A' }, { memberId: 'B' }],
        opponentTeam: [{ memberId: 'C' }, { memberId: 'D' }],
        wins: 1,
        losses: 0,
        recentMatches: []
      }]
    }
  }, membersById)

  expect(out.displayName).toBe('选手01')
  expect(out.doubles.teamH2H[0].subjectTeamLabel).toBe('选手01 / 小野马')
  expect(out.doubles.teamH2H[0].opponentTeamLabel).toBe('小天 / 标子')
})
```

- [ ] **Step 18: Run identity tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/identity.test.js
```

Expected: FAIL with `Cannot find module '../identity'`.

- [ ] **Step 19: Implement public identity resolution**

Create `cloudfunctions/analytics-engine/lib/identity.js`:

```js
const { DEFAULT_PUBLIC_AVATAR_URL, anonymousProfileName, hasPublicProfileConsent } = require('../../_shared/public-profile')

function resolveAnalyticsIdentities(doc, membersById) {
  if (!doc) return doc
  const memberIdentity = identityFor(membersById, doc.memberId, 0)
  const out = {
    ...doc,
    displayName: memberIdentity.name,
    avatarUrl: memberIdentity.avatarUrl,
    publicProfileVisible: memberIdentity.publicProfileVisible
  }
  if (out.doubles && Array.isArray(out.doubles.teamH2H)) {
    out.doubles = {
      ...out.doubles,
      teamH2H: out.doubles.teamH2H.map(row => resolveTeamH2HRow(row, membersById))
    }
  }
  if (Array.isArray(out.recentMatches)) {
    out.recentMatches = out.recentMatches.map(row => resolveRecentRow(row, membersById))
  }
  return out
}

function resolveTeamH2HRow(row, membersById) {
  const subjectTeam = resolveTeam(row.subjectTeam, membersById)
  const opponentTeam = resolveTeam(row.opponentTeam, membersById)
  return {
    ...row,
    subjectTeam,
    opponentTeam,
    subjectTeamLabel: teamLabel(subjectTeam),
    opponentTeamLabel: teamLabel(opponentTeam)
  }
}

function resolveRecentRow(row, membersById) {
  const subjectTeam = resolveTeam(row.subjectTeam, membersById)
  const opponentTeam = resolveTeam(row.opponentTeam, membersById)
  return {
    ...row,
    subjectTeam,
    opponentTeam,
    subjectTeamLabel: teamLabel(subjectTeam),
    opponentTeamLabel: teamLabel(opponentTeam)
  }
}

function resolveTeam(team, membersById) {
  return (team || []).map((member, index) => {
    const identity = identityFor(membersById, member.memberId, index)
    return { memberId: member.memberId, name: identity.name, avatarUrl: identity.avatarUrl, publicProfileVisible: identity.publicProfileVisible }
  })
}

function identityFor(membersById, memberId, index) {
  const member = membersById && membersById.get(memberId)
  const visible = hasPublicProfileConsent(member)
  return {
    name: visible && member && member.name ? member.name : anonymousProfileName({ index }),
    avatarUrl: visible && member && member.avatarUrl ? member.avatarUrl : DEFAULT_PUBLIC_AVATAR_URL,
    publicProfileVisible: visible
  }
}

function teamLabel(team) {
  return (team || []).map(member => member.name || member.memberId).filter(Boolean).join(' / ')
}

module.exports = { resolveAnalyticsIdentities }
```

- [ ] **Step 20: Verify all pure analytics tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js lib/__tests__/teams.test.js lib/__tests__/player-analytics.test.js lib/__tests__/pair-analytics.test.js lib/__tests__/identity.test.js
```

Expected: PASS.

- [ ] **Step 21: Commit Task 1**

```bash
git add cloudfunctions/analytics-engine
git commit -m "feat(analytics): add pure ranking analytics aggregators"
```

---

### Task 2: Analytics Engine Cloud Actions and Cache Writes

**Files:**
- Create: `cloudfunctions/analytics-engine/index.js`
- Create: `cloudfunctions/analytics-engine/__tests__/index.test.js`
- Modify: `cloudfunctions/analytics-engine/package.json`

**Interfaces:**
- Consumes from Task 1: `buildPlayerAnalytics`, `buildPairAnalytics`, `resolveAnalyticsIdentities`, `analyticsPlayerId`, `pairAnalyticsId`, `pairKey`.
- Produces cloud actions:
  - `refreshAfterSettlement({ seasonId, affectedMemberIds, matchIds })`
  - `rebuildSeason({ seasonId })`
  - `getPlayerAnalytics({ seasonId, memberId })`
  - `getPairAnalytics({ seasonId, memberId })`
- Produces cache documents in `player_analytics`, `pair_analytics`, and `analytics_jobs`.
- Produces `getPlayerAnalytics` responses that resolve display names from current `members`, not from stale cached names.

- [ ] **Step 1: Write failing cloud action tests**

Create `cloudfunctions/analytics-engine/__tests__/index.test.js`:

```js
jest.mock('wx-server-sdk', () => {
  const rows = {
    members: [],
    match_results: [],
    player_analytics: [],
    pair_analytics: [],
    analytics_jobs: []
  }
  const _ = {
    in: (value) => ({ __op: 'in', value })
  }
  function rowMatches(row, filter) {
    for (const [key, value] of Object.entries(filter || {})) {
      const cell = row[key]
      if (value && value.__op === 'in') {
        if (Array.isArray(cell)) {
          if (!cell.some(item => value.value.includes(item))) return false
        } else if (!value.value.includes(cell)) return false
      } else if (cell !== value) return false
    }
    return true
  }
  function collection(name) {
    return {
      where(filter) {
        const filtered = (rows[name] || []).filter(row => rowMatches(row, filter))
        let offset = 0
        let count = filtered.length
        return {
          skip(n) { offset = Number(n) || 0; return this },
          limit(n) { count = Number(n) || count; return this },
          orderBy() { return this },
          async get() { return { data: filtered.slice(offset, offset + count) } }
        }
      },
      doc(id) {
        return {
          async get() { return { data: (rows[name] || []).find(row => row._id === id) || null } },
          async update({ data }) {
            const index = rows[name].findIndex(row => row._id === id)
            if (index >= 0) rows[name][index] = { ...rows[name][index], ...data }
            return { stats: { updated: index >= 0 ? 1 : 0 } }
          }
        }
      },
      async add({ data }) {
        rows[name].push({ ...data })
        return { _id: data && data._id }
      }
    }
  }
  return {
    DYNAMIC_CURRENT_ENV: 'test',
    init: jest.fn(),
    database: () => ({ command: _, collection }),
    __rows: rows
  }
})

beforeEach(() => {
  const cloud = require('wx-server-sdk')
  for (const key of Object.keys(cloud.__rows)) cloud.__rows[key].length = 0
})

test('refreshAfterSettlement writes affected player and pair analytics plus job success', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push(
    { _id: 'A', name: '乐乐' },
    { _id: 'B', name: '小野马' },
    { _id: 'C', name: '小天' },
    { _id: 'D', name: '标子' }
  )
  cloud.__rows.match_results.push({
    _id: 'm1',
    seasonId: 'season_2026',
    tournamentType: 'doubles',
    resultStatus: 'confirmed',
    confirmedAt: '2026-06-01',
    createTime: '2026-06-01',
    playerIds: ['A', 'B', 'C', 'D'],
    player1: { id: 'A', name: '乐乐', partnerId: 'B', partnerName: '小野马' },
    player2: { id: 'C', name: '小天', partnerId: 'D', partnerName: '标子' },
    pointsAwarded: { entries: [
      { memberId: 'A', points: 20, role: 'winner' },
      { memberId: 'B', points: 20, role: 'winner' },
      { memberId: 'C', points: 10, role: 'loser' },
      { memberId: 'D', points: 10, role: 'loser' }
    ] }
  })

  const { main } = require('../index')
  const res = await main({ action: 'refreshAfterSettlement', seasonId: 'season_2026', affectedMemberIds: ['A', 'B', 'C', 'D'], matchIds: ['m1'] })

  expect(res.success).toBe(true)
  expect(cloud.__rows.player_analytics.find(row => row._id === 'pa_season_2026_A')).toBeTruthy()
  expect(cloud.__rows.pair_analytics.find(row => row._id === 'pair_season_2026_A__B')).toBeTruthy()
  expect(cloud.__rows.analytics_jobs[0]).toMatchObject({ status: 'success', jobType: 'refreshAfterSettlement' })
})

test('getPlayerAnalytics resolves cached ids through current member privacy state', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '乐乐', publicProfileConsent: false })
  cloud.__rows.player_analytics.push({ _id: 'pa_season_2026_A', seasonId: 'season_2026', memberId: 'A', doubles: { teamH2H: [] } })
  const { main } = require('../index')
  const res = await main({ action: 'getPlayerAnalytics', seasonId: 'season_2026', memberId: 'A' })
  expect(res.success).toBe(true)
  expect(res.data).toMatchObject({ _id: 'pa_season_2026_A', seasonId: 'season_2026', memberId: 'A', displayName: '选手01', publicProfileVisible: false })
})

test('rebuildSeason writes analytics for all confirmed rows', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '乐乐' }, { _id: 'B', name: '小天' })
  cloud.__rows.match_results.push({
    _id: 'm1',
    seasonId: 'season_2026',
    tournamentType: 'singles',
    resultStatus: 'confirmed',
    confirmedAt: '2026-06-01',
    createTime: '2026-06-01',
    playerIds: ['A', 'B'],
    player1: { id: 'A', name: '乐乐' },
    player2: { id: 'B', name: '小天' },
    pointsAwarded: { entries: [
      { memberId: 'A', points: 20, role: 'winner' },
      { memberId: 'B', points: 10, role: 'loser' }
    ] }
  })
  const { main } = require('../index')
  const res = await main({ action: 'rebuildSeason', seasonId: 'season_2026' })
  expect(res.success).toBe(true)
  expect(res.data.playerCount).toBe(2)
  expect(cloud.__rows.player_analytics).toHaveLength(2)
})

test('rebuildSeason pages beyond the first 500 confirmed rows', async () => {
  const cloud = require('wx-server-sdk')
  for (let i = 0; i < 510; i += 1) {
    const id = `P${i}`
    cloud.__rows.members.push({ _id: id, name: id })
    cloud.__rows.match_results.push({
      _id: `m${i}`,
      seasonId: 'season_2026',
      tournamentType: 'singles',
      resultStatus: 'confirmed',
      confirmedAt: '2026-06-01',
      createTime: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`,
      playerIds: [id],
      player1: { id, name: id },
      pointsAwarded: { entries: [{ memberId: id, points: 1, role: 'winner' }] }
    })
  }
  const { main } = require('../index')
  const res = await main({ action: 'rebuildSeason', seasonId: 'season_2026' })
  expect(res.success).toBe(true)
  expect(res.data.playerCount).toBe(510)
})
```

- [ ] **Step 2: Run cloud action tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- __tests__/index.test.js
```

Expected: FAIL with `Cannot find module '../index'`.

- [ ] **Step 3: Implement cloud actions**

Create `cloudfunctions/analytics-engine/index.js`:

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { analyticsPlayerId, pairAnalyticsId, pairKey } = require('./lib/ids')
const { sideMembers } = require('./lib/teams')
const { buildPlayerAnalytics } = require('./lib/player-analytics')
const { buildPairAnalytics } = require('./lib/pair-analytics')
const { resolveAnalyticsIdentities } = require('./lib/identity')

exports.main = async (event = {}) => main(event)

async function main(event = {}) {
  const action = event.action || ''
  try {
    if (action === 'refreshAfterSettlement') return await refreshAfterSettlement(event)
    if (action === 'rebuildSeason') return await rebuildSeason(event)
    if (action === 'getPlayerAnalytics') return await getPlayerAnalytics(event)
    if (action === 'getPairAnalytics') return await getPairAnalytics(event)
    return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } }
  } catch (err) {
    await writeJob({ jobType: action || 'unknown', seasonId: event.seasonId || '', status: 'failed', affectedMemberIds: event.affectedMemberIds || [], matchIds: event.matchIds || [], error: err.message || String(err) }).catch(() => null)
    return { success: false, error: { code: err.code || 'INTERNAL', message: err.message || String(err) } }
  }
}

async function refreshAfterSettlement({ seasonId, affectedMemberIds = [], matchIds = [] }) {
  if (!seasonId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId required' } }
  const affected = [...new Set((affectedMemberIds || []).filter(Boolean))]
  await ensureCollections()
  const rows = await fetchSeasonRows(seasonId)
  const membersById = await fetchMembersByIds([...new Set(rows.flatMap(row => row.playerIds || []))])
  const playerRows = []
  for (const memberId of affected) {
    const doc = buildPlayerAnalytics({ seasonId, memberId, rows, membersById, rankRowsByType: { singles: [], doubles: [] } })
    await upsert('player_analytics', doc._id, doc)
    playerRows.push(doc)
  }
  const pairIds = collectAffectedPairs(rows, affected)
  const pairRows = []
  for (const pairMemberIds of pairIds) {
    const doc = buildPairAnalytics({ seasonId, pairMemberIds, rows, membersById })
    await upsert('pair_analytics', doc._id, doc)
    pairRows.push(doc)
  }
  await writeJob({ jobType: 'refreshAfterSettlement', seasonId, status: 'success', affectedMemberIds: affected, matchIds, error: '' })
  return { success: true, data: { playerCount: playerRows.length, pairCount: pairRows.length, analyticsStatus: 'success' } }
}

async function rebuildSeason({ seasonId }) {
  if (!seasonId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId required' } }
  const rows = await fetchSeasonRows(seasonId)
  const affected = [...new Set(rows.flatMap(row => row.playerIds || []))]
  return refreshAfterSettlement({ seasonId, affectedMemberIds: affected, matchIds: rows.map(row => row._id).filter(Boolean) })
}

async function getPlayerAnalytics({ seasonId, memberId }) {
  if (!seasonId || !memberId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId and memberId required' } }
  const res = await db.collection('player_analytics').doc(analyticsPlayerId(seasonId, memberId)).get().catch(() => ({ data: null }))
  if (!res.data) return { success: true, data: null }
  const membersById = await fetchMembersForAnalyticsDoc(res.data)
  return { success: true, data: resolveAnalyticsIdentities(res.data, membersById) }
}

async function getPairAnalytics({ seasonId, memberId }) {
  if (!seasonId || !memberId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId and memberId required' } }
  const rows = await db.collection('pair_analytics').where({ seasonId, memberIds: _.in([memberId]) }).limit(100).get()
  return { success: true, data: rows.data || [] }
}

async function fetchSeasonRows(seasonId) {
  const out = []
  const pageSize = 100
  let skip = 0
  while (true) {
    const page = (await db.collection('match_results')
      .where({ seasonId, resultStatus: 'confirmed' })
      .orderBy('createTime', 'asc')
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get()).data || []
    out.push(...page)
    if (page.length < pageSize) break
    skip += pageSize
  }
  return out
}

async function fetchMembersByIds(ids) {
  const out = new Map()
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50)
    const res = await db.collection('members').where({ _id: _.in(chunk) }).get()
    for (const member of (res.data || [])) out.set(member._id, member)
  }
  return out
}

function collectAffectedPairs(rows, affectedMemberIds) {
  const affected = new Set(affectedMemberIds)
  const map = new Map()
  for (const row of rows || []) {
    if (!row || row.tournamentType !== 'doubles') continue
    for (const side of [row.player1, row.player2]) {
      const ids = sideMembers(side).map(member => member.memberId)
      if (ids.length !== 2 || !ids.some(id => affected.has(id))) continue
      const normalized = pairKey(ids)
      map.set(normalized.pairId, normalized.memberIds)
    }
  }
  return [...map.values()]
}

async function upsert(collectionName, id, data) {
  const collection = db.collection(collectionName)
  const existing = await collection.doc(id).get().catch(() => ({ data: null }))
  if (existing && existing.data) {
    const { _id, ...patch } = data
    await collection.doc(id).update({ data: patch })
  } else {
    await collection.add({ data: { ...data, _id: id } })
  }
}

async function writeJob({ jobType, seasonId, status, affectedMemberIds, matchIds, error }) {
  const now = new Date()
  await db.collection('analytics_jobs').add({
    data: {
      _id: `analytics_${jobType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      jobType,
      seasonId,
      status,
      affectedMemberIds,
      matchIds,
      error,
      createTime: now,
      updateTime: now
    }
  })
}

async function ensureCollections() {
  if (!db || typeof db.createCollection !== 'function') return
  for (const name of ['player_analytics', 'pair_analytics', 'analytics_jobs']) {
    await db.createCollection(name).catch(() => null)
  }
}

async function fetchMembersForAnalyticsDoc(doc) {
  return fetchMembersByIds(collectMemberIdsFromAnalyticsDoc(doc))
}

function collectMemberIdsFromAnalyticsDoc(doc) {
  const ids = new Set()
  if (doc && doc.memberId) ids.add(doc.memberId)
  const visitTeam = team => (team || []).forEach(member => member && member.memberId && ids.add(member.memberId))
  const visitRows = rows => (rows || []).forEach(row => {
    visitTeam(row.subjectTeam)
    visitTeam(row.opponentTeam)
  })
  if (doc && doc.doubles) visitRows(doc.doubles.teamH2H)
  visitRows(doc && doc.recentMatches)
  return [...ids]
}

module.exports = { main, collectAffectedPairs }
```

- [ ] **Step 4: Verify cloud action tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- __tests__/index.test.js
```

Expected: PASS.

- [ ] **Step 5: Run all analytics-engine tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test
```

Expected: PASS for all analytics-engine suites.

- [ ] **Step 6: Commit Task 2**

```bash
git add cloudfunctions/analytics-engine
git commit -m "feat(analytics): add analytics cache cloud actions"
```

---

### Task 3: Settlement Integration and Immediate Rank Cache Refresh

**Files:**
- Modify: `cloudfunctions/match-results/index.js`
- Modify: `cloudfunctions/match-results/lib/handlers/batch.js`
- Modify: `cloudfunctions/match-results/lib/handlers/submit.js`
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`
- Create: `cloudfunctions/match-results/lib/__tests__/handlers/submit.test.js`
- Create: `cloudfunctions/match-results/__tests__/analytics-integration.test.js`
- Modify: `miniprogram/pages/tournament-score/index.js`
- Modify: `miniprogram/pages/tournament-score/__tests__/index.test.js`
- Modify: `miniprogram/components/batch-result-sheet/index.js`
- Modify: `miniprogram/components/batch-result-sheet/index.wxml`
- Modify: `miniprogram/components/batch-result-sheet/__tests__/index.test.js`

**Interfaces:**
- Consumes from Task 2: cloud function action `analytics-engine.refreshAfterSettlement`.
- Produces from `match-results`: admin settlement result data includes:
  - `analyticsStatus: 'success' | 'failed' | 'skipped'`
  - `analyticsMessage: string`
  - `settlementImpact: Array<{ memberId, name, pointsDelta, rankDelta, trendLabel }>`
- Produces frontend cache clearing: `removeCachesByPrefix('rank:')` and `removeCachesByPrefix('player-detail:')` after batch admin save, batch confirm, direct reconfirm, or direct confirm-all success.

- [ ] **Step 1: Write failing batch handler test for analytics metadata passthrough**

Append to `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`:

```js
test('batchAdminSave returns analytics metadata when ctx.afterSettlement succeeds', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    isAdmin: true,
    matches: [{ _id: 'mr_a', resultStatus: 'submitted', playerIds: ['A', 'B'], tournamentId: 't1', updateTime, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }]
  })
  ctx.afterSettlement = jest.fn(async ({ successIds }) => ({
    analyticsStatus: 'success',
    analyticsMessage: '排行榜已更新',
    settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }],
    refreshedMatchIds: successIds
  }))

  const result = await batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_analytics'
  })

  expect(ctx.afterSettlement).toHaveBeenCalledWith({ successIds: ['mr_a'], requestId: 'req_analytics' })
  expect(result.analyticsStatus).toBe('success')
  expect(result.settlementImpact).toEqual([{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }])
})

test('batchAdminSave does not fail confirmation when ctx.afterSettlement fails', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    isAdmin: true,
    matches: [{ _id: 'mr_a', resultStatus: 'submitted', playerIds: ['A', 'B'], tournamentId: 't1', updateTime, score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }]
  })
  ctx.afterSettlement = jest.fn(async () => { throw new Error('analytics down') })

  const result = await batchAdminSave(ctx, {
    matches: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_analytics_fail'
  })

  expect(result.successIds).toEqual(['mr_a'])
  expect(result.analyticsStatus).toBe('failed')
  expect(result.analyticsMessage).toBe('比分已确认，数据分析稍后重算')
})
```

- [ ] **Step 2: Run batch handler tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- lib/__tests__/handlers/batch.test.js -t "analytics"
```

Expected: FAIL because `afterSettlement` is not called and `analyticsStatus` is missing.

- [ ] **Step 3: Add settlement hook helper in batch handler**

Modify `cloudfunctions/match-results/lib/handlers/batch.js` by adding:

```js
async function runAfterSettlement(ctx, successIds, requestId) {
  if (!Array.isArray(successIds) || successIds.length === 0 || !ctx || typeof ctx.afterSettlement !== 'function') {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  try {
    return await ctx.afterSettlement({ successIds, requestId })
  } catch (err) {
    return {
      analyticsStatus: 'failed',
      analyticsMessage: '比分已确认，数据分析稍后重算',
      settlementImpact: []
    }
  }
}
```

Then before each admin result return in `batchConfirm` and `batchAdminSave`, merge:

```js
const analytics = await runAfterSettlement(ctx, successIds, requestId)
return { requestId, successIds, failures, ...analytics }
```

Do not call `runAfterSettlement` in `batchSubmit`; member submissions are not official settlement.

- [ ] **Step 4: Verify batch analytics tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- lib/__tests__/handlers/batch.test.js -t "analytics"
```

Expected: PASS.

- [ ] **Step 5: Write failing direct settlement handler tests**

Create `cloudfunctions/match-results/lib/__tests__/handlers/submit.test.js`:

```js
const { confirmAll, reconfirmMatch } = require('../../handlers/submit')

function makeCtx(overrides = {}) {
  return {
    submitter: { _id: 'admin1', isAdmin: true },
    stateSvc: {
      confirmAll: jest.fn(async () => ({ confirmedCount: 2 })),
      reconfirmMatch: jest.fn(async () => ({ ok: true }))
    },
    afterSettlement: jest.fn(async ({ successIds }) => ({
      analyticsStatus: 'success',
      analyticsMessage: '排行榜已更新',
      settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }],
      refreshedMatchIds: successIds
    })),
    afterSettlementByTournament: jest.fn(async ({ tournamentId }) => ({
      analyticsStatus: 'success',
      analyticsMessage: '排行榜已更新',
      settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }],
      refreshedTournamentId: tournamentId
    })),
    ...overrides
  }
}

test('reconfirmMatch returns analytics metadata without changing the success contract', async () => {
  const ctx = makeCtx()
  const result = await reconfirmMatch(ctx, { matchId: 'm1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null } })
  expect(ctx.afterSettlement).toHaveBeenCalledWith({ successIds: ['m1'], requestId: 'reconfirmMatch:m1' })
  expect(result).toMatchObject({ ok: true, analyticsStatus: 'success', analyticsMessage: '排行榜已更新' })
})

test('confirmAll refreshes analytics by tournament when confirmed rows are unknown', async () => {
  const ctx = makeCtx()
  const result = await confirmAll(ctx, { tournamentId: 't1' })
  expect(ctx.afterSettlementByTournament).toHaveBeenCalledWith({ tournamentId: 't1', requestId: 'confirmAll:t1' })
  expect(result).toMatchObject({ confirmedCount: 2, analyticsStatus: 'success' })
})
```

- [ ] **Step 6: Run direct settlement handler tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- lib/__tests__/handlers/submit.test.js -t "analytics|reconfirmMatch returns|confirmAll refreshes"
```

Expected: FAIL because `confirmAll` and `reconfirmMatch` do not call analytics hooks.

- [ ] **Step 7: Implement direct settlement analytics hooks**

Modify `cloudfunctions/match-results/lib/handlers/submit.js`:

```js
async function runAfterSettlement(ctx, successIds, requestId) {
  if (!Array.isArray(successIds) || successIds.length === 0 || !ctx || typeof ctx.afterSettlement !== 'function') {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  try {
    return await ctx.afterSettlement({ successIds, requestId })
  } catch (err) {
    return { analyticsStatus: 'failed', analyticsMessage: '比分已确认，数据分析稍后重算', settlementImpact: [] }
  }
}

async function runAfterSettlementByTournament(ctx, tournamentId, requestId) {
  if (!tournamentId || !ctx || typeof ctx.afterSettlementByTournament !== 'function') {
    return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
  }
  try {
    return await ctx.afterSettlementByTournament({ tournamentId, requestId })
  } catch (err) {
    return { analyticsStatus: 'failed', analyticsMessage: '比分已确认，数据分析稍后重算', settlementImpact: [] }
  }
}
```

Then update direct admin handlers:

```js
async function confirmAll(ctx, event) {
  const admin = ctx.submitter
  await assertSchedulePublishedForTournament(ctx, event.tournamentId)
  const r = await ctx.stateSvc.confirmAll({ tournamentId: event.tournamentId, admin })
  const analytics = await runAfterSettlementByTournament(ctx, event.tournamentId, `confirmAll:${event.tournamentId}`)
  return { ...r, ...analytics }
}

async function reconfirmMatch(ctx, event) {
  const admin = ctx.submitter
  await assertSchedulePublishedForMatch(ctx, event.matchId)
  const r = await ctx.stateSvc.reconfirmMatch({ matchId: event.matchId, newScore: event.newScore, admin })
  const analytics = await runAfterSettlement(ctx, [event.matchId], `reconfirmMatch:${event.matchId}`)
  return { ok: true, ...(r || {}), ...analytics }
}
```

- [ ] **Step 8: Write failing match-results index test for cloud calls**

Append or create a focused test in `cloudfunctions/match-results/__tests__/analytics-integration.test.js`:

```js
const { __test__ } = require('../index')
const { buildBatchCtx } = __test__

test('buildBatchCtx.afterSettlement refreshes rank cache and analytics cache', async () => {
  const calls = []
  const ctx = buildBatchCtx({
    _id: 'admin1',
    openid: 'openid_admin',
    isAdmin: true
  }, true, {
    callFunction: async ({ name, data }) => {
      calls.push({ name, data })
      if (name === 'points-engine') {
        return { result: { success: true, data: { settlementImpact: [{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }] } } }
      }
      return { result: { success: true, data: { analyticsStatus: 'success' } } }
    },
    getMatchesByIds: async () => [
      { _id: 'm1', seasonId: 'season_2026', tournamentType: 'singles', playerIds: ['A', 'B'] }
    ]
  })

  const result = await ctx.afterSettlement({ successIds: ['m1'], requestId: 'req1' })

  expect(result.analyticsStatus).toBe('success')
  expect(result.settlementImpact).toEqual([{ memberId: 'A', pointsDelta: 20, rankDelta: 1, trendLabel: '▲1' }])
  expect(calls).toEqual([
    { name: 'points-engine', data: { action: 'refreshRankCache', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], writeSnapshot: true, snapshotKind: 'settlement' } },
    { name: 'analytics-engine', data: { action: 'refreshAfterSettlement', seasonId: 'season_2026', affectedMemberIds: ['A', 'B'], matchIds: ['m1'] } }
  ])
})
```

Export `buildBatchCtx` from the existing `exports.__test__` block at the bottom of `cloudfunctions/match-results/index.js`:

```js
exports.__test__ = {
  collectPlayerIds,
  resolveMatchType,
  resolveSubmitterByOpenid,
  resolveStateMatchId,
  guardDirectScoreRowRead,
  mergeScheduledMatchDoc,
  shouldRemoveOrphanMatchDoc,
  buildBatchCtx,
  buildSubmitCtx
}
```

Change `buildBatchCtx` to accept injectable dependencies and attach the new hook while preserving all existing fields:

```diff
-function buildBatchCtx(submitter, isAdminFlag) {
+function buildBatchCtx(submitter, isAdminFlag, options = {}) {
  const scoreRule = require('./lib/score-rule')
+  const callFunction = options.callFunction || cloud.callFunction
+  const getMatchesByIds = options.getMatchesByIds || defaultGetMatchesByIds
+  const getMatchesByTournament = options.getMatchesByTournament || defaultGetMatchesByTournament
  return {
    callerOpenid: submitter.openid,
    callerMemberId: submitter._id,
    isAdmin: isAdminFlag,
    confirmedAtNow: new Date(),
    nowDate: new Date(),
+    afterSettlement: buildAfterSettlement({ callFunction, getMatchesByIds }),
+    afterSettlementByTournament: buildAfterSettlementByTournament({ callFunction, getMatchesByTournament }),
    db: {
  }
}
```

Keep the existing `db`, `confirmOne`, and `validateScore` fields in `buildBatchCtx`; this diff only adds `options`, `callFunction`, `getMatchesByIds`, `getMatchesByTournament`, `afterSettlement`, and `afterSettlementByTournament`.

Also update `buildSubmitCtx` so direct `confirmAll` and `reconfirmMatch` use the same refresh path:

```js
function buildSubmitCtx(submitter, options = {}) {
  const callFunction = options.callFunction || cloud.callFunction
  const getMatchesByIds = options.getMatchesByIds || defaultGetMatchesByIds
  const getMatchesByTournament = options.getMatchesByTournament || defaultGetMatchesByTournament
  return {
    submitter,
    stateSvc,
    afterSettlement: buildAfterSettlement({ callFunction, getMatchesByIds }),
    afterSettlementByTournament: buildAfterSettlementByTournament({ callFunction, getMatchesByTournament })
  }
}
```

- [ ] **Step 9: Run integration test to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- __tests__/analytics-integration.test.js
```

Expected: FAIL because `buildBatchCtx` / `buildSubmitCtx` are not exported from `exports.__test__` and settlement hooks are not implemented.

- [ ] **Step 10: Implement afterSettlement in match-results index**

Modify `cloudfunctions/match-results/index.js`:

```js
async function defaultGetMatchesByIds(matchIds) {
  if (!matchIds || matchIds.length === 0) return []
  const out = []
  const uniqueIds = [...new Set(matchIds.filter(Boolean))]
  for (let i = 0; i < uniqueIds.length; i += 50) {
    const chunk = uniqueIds.slice(i, i + 50)
    const res = await db.collection('match_results').where({ _id: _.in(chunk) }).get()
    out.push(...((res && res.data) || []))
  }
  return out
}

async function defaultGetMatchesByTournament(tournamentId) {
  if (!tournamentId) return []
  const out = []
  const pageSize = 100
  let skip = 0
  while (true) {
    const page = (await db.collection('match_results')
      .where({ tournamentId, resultStatus: 'confirmed' })
      .orderBy('createTime', 'asc')
      .orderBy('_id', 'asc')
      .skip(skip)
      .limit(pageSize)
      .get()).data || []
    out.push(...page)
    if (page.length < pageSize) break
    skip += pageSize
  }
  return out
}

function collectAffectedMemberIds(rows) {
  return [...new Set((rows || []).flatMap(row => row.playerIds || []).filter(Boolean))]
}

function collectSeasonIds(rows) {
  return [...new Set((rows || []).map(row => row.seasonId).filter(Boolean))]
}
```

Add the hook builder near `collectSeasonIds`:

```js
function buildAfterSettlement({ callFunction, getMatchesByIds }) {
  return async function afterSettlement({ successIds = [] } = {}) {
    try {
      const rows = await getMatchesByIds(successIds)
      const seasonIds = collectSeasonIds(rows)
      const affectedMemberIds = collectAffectedMemberIds(rows)
      if (seasonIds.length !== 1 || affectedMemberIds.length === 0) {
        return { analyticsStatus: 'skipped', analyticsMessage: '', settlementImpact: [] }
      }
      const seasonId = seasonIds[0]
      const rankRes = await callFunction({
        name: 'points-engine',
        data: { action: 'refreshRankCache', seasonId, affectedMemberIds, writeSnapshot: true, snapshotKind: 'settlement' }
      })
      const rankData = rankRes && rankRes.result && rankRes.result.data
      const analyticsRes = await callFunction({
        name: 'analytics-engine',
        data: { action: 'refreshAfterSettlement', seasonId, affectedMemberIds, matchIds: successIds }
      })
      const analyticsOk = !(analyticsRes && analyticsRes.result && analyticsRes.result.success === false)
      return {
        analyticsStatus: analyticsOk ? 'success' : 'failed',
        analyticsMessage: analyticsOk ? '排行榜已更新' : '比分已确认，数据分析稍后重算',
        settlementImpact: (rankData && rankData.settlementImpact) || [],
        refreshedMatchIds: successIds
      }
    } catch (err) {
      return {
        analyticsStatus: 'failed',
        analyticsMessage: '比分已确认，数据分析稍后重算',
        settlementImpact: [],
        analyticsError: err && err.message ? err.message : String(err)
      }
    }
  }
}

function buildAfterSettlementByTournament({ callFunction, getMatchesByTournament }) {
  return async function afterSettlementByTournament({ tournamentId } = {}) {
    const rows = await getMatchesByTournament(tournamentId)
    const successIds = rows.map(row => row._id).filter(Boolean)
    return buildAfterSettlement({ callFunction, getMatchesByIds: async () => rows })({ successIds })
  }
}
```

Then apply the same `buildBatchCtx` signature/export changes from Step 5.

- [ ] **Step 11: Verify match-results integration tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- __tests__/analytics-integration.test.js lib/__tests__/handlers/batch.test.js -t "analytics"
```

Expected: PASS.

- [ ] **Step 12: Write failing miniprogram tournament-score cache clearing test**

Append to `miniprogram/pages/tournament-score/__tests__/index.test.js`:

```js
test('_applySheetResult clears rank and player-detail caches after admin analytics success', () => {
  const def = loadPage()
  const { removeCachesByPrefix } = require('../../../utils/page-cache')
  const ctx = makeCtx(def, {
    sheet: { visible: true, title: '', mode: 'adminSave', items: [{ matchId: 'm1' }], result: null, requestId: 'req' }
  })

  ctx._applySheetResult({
    ok: true,
    data: {
      requestId: 'req',
      successIds: ['m1'],
      failures: [],
      analyticsStatus: 'success',
      analyticsMessage: '排行榜已更新',
      settlementImpact: [{ memberId: 'A', trendLabel: '▲1', pointsDelta: 20 }]
    }
  }, [{ matchId: 'm1' }])

  expect(removeCachesByPrefix).toHaveBeenCalledWith('rank:')
  expect(removeCachesByPrefix).toHaveBeenCalledWith('player-detail:')
  expect(ctx.data.sheet.result.analyticsMessage).toBe('排行榜已更新')
})

test('onReconfirm clears rank and player-detail caches after direct analytics success', async () => {
  const def = loadPage()
  const { removeCachesByPrefix } = require('../../../utils/page-cache')
  wx.cloud.callFunction.mockResolvedValue({
    result: {
      success: true,
      data: {
        ok: true,
        analyticsStatus: 'success',
        analyticsMessage: '排行榜已更新',
        settlementImpact: [{ memberId: 'A', trendLabel: '▲1', pointsDelta: 20 }]
      }
    }
  })
  const ctx = makeCtx(def)
  ctx.refresh = jest.fn(async () => null)

  await ctx.onReconfirm({ detail: { matchId: 'm1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null } } })

  expect(removeCachesByPrefix).toHaveBeenCalledWith('rank:')
  expect(removeCachesByPrefix).toHaveBeenCalledWith('player-detail:')
})
```

If `removeCachesByPrefix` is not mocked in this test file, add:

```js
jest.mock('../../../utils/page-cache', () => ({ removeCachesByPrefix: jest.fn() }))
```

- [ ] **Step 13: Run miniprogram test to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-score/__tests__/index.test.js -t "analytics"
```

Expected: FAIL because `_applySheetResult` does not clear caches.

- [ ] **Step 14: Implement frontend cache clearing and toast**

Modify `miniprogram/pages/tournament-score/index.js` imports:

```js
const { removeCachesByPrefix } = require('../../utils/page-cache')
```

Modify `_applySheetResult` after successful result:

```js
this._handleSettlementAnalytics(res.data)
this.setData({ 'sheet.result': res.data })
```

Add a shared helper and call it from `onReconfirm` after `r.success`:

```js
_handleSettlementAnalytics(data) {
  if (!data || (data.analyticsStatus !== 'success' && data.analyticsStatus !== 'failed')) return
  removeCachesByPrefix('rank:')
  removeCachesByPrefix('player-detail:')
  if (data.analyticsMessage) {
    wx.showToast({ title: data.analyticsMessage, icon: data.analyticsStatus === 'success' ? 'success' : 'none', duration: 2000 })
  }
}
```

```js
this._handleSettlementAnalytics(r.data || r)
```

- [ ] **Step 15: Add batch-result-sheet analytics display test**

Append to `miniprogram/components/batch-result-sheet/__tests__/index.test.js`:

```js
test('template renders analytics message and settlement impact', () => {
  const fs = require('fs')
  const path = require('path')
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('analyticsMessage')
  expect(wxml).toContain('settlementImpact')
})
```

- [ ] **Step 16: Implement batch-result-sheet analytics display**

Modify `miniprogram/components/batch-result-sheet/index.wxml` inside `stateName === 'result'` block:

```xml
<view wx:if="{{result.analyticsMessage}}" class="brs-analytics">
  <text>{{result.analyticsMessage}}</text>
</view>
<view wx:if="{{result.settlementImpact && result.settlementImpact.length}}" class="brs-impact">
  <view wx:for="{{result.settlementImpact}}" wx:key="memberId" class="brs-impact-row">
    <text>{{item.name || item.memberId}}</text>
    <text>{{item.trendLabel || ''}}</text>
    <text wx:if="{{item.pointsDelta}}">+{{item.pointsDelta}}</text>
  </view>
</view>
```

Add focused styles to `miniprogram/components/batch-result-sheet/index.wxss`:

```css
.brs-analytics {
  margin: 12rpx 0;
  padding: 14rpx 18rpx;
  border-radius: 8rpx;
  background: var(--color-bg-surface);
  color: var(--color-text-primary);
  font-size: 24rpx;
}

.brs-impact {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  margin-bottom: 12rpx;
}

.brs-impact-row {
  display: flex;
  justify-content: space-between;
  gap: 12rpx;
  font-size: 22rpx;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 17: Run Task 3 tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- __tests__/analytics-integration.test.js lib/__tests__/handlers/batch.test.js lib/__tests__/handlers/submit.test.js
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-score/__tests__/index.test.js components/batch-result-sheet/__tests__/index.test.js
```

Expected: PASS for listed suites.

- [ ] **Step 18: Commit Task 3**

```bash
git add cloudfunctions/match-results miniprogram/pages/tournament-score miniprogram/components/batch-result-sheet
git commit -m "feat(scores): refresh analytics after score settlement"
```

---

### Task 4: Rank Trend States

**Files:**
- Modify: `cloudfunctions/points-engine/index.js`
- Create: `cloudfunctions/points-engine/lib/settlement-impact.js`
- Create: `cloudfunctions/points-engine/lib/__tests__/settlement-impact.test.js`
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`
- Modify: `miniprogram/pages/rank/index.js`
- Modify: `miniprogram/pages/rank/index.wxml`
- Modify: `miniprogram/pages/rank/__tests__/index.test.js`
- Modify: `miniprogram/components/rank-row/index.js`
- Modify: `miniprogram/components/rank-row/index.wxml`
- Create: `miniprogram/components/rank-row/__tests__/index.test.js`

**Interfaces:**
- Produces backend rank row fields:
  - `trendDelta: number | null`
  - `trendState: 'up' | 'down' | 'flat' | 'new' | 'no_history'`
  - `trendLabel: string`
- Consumes frontend row fields `trendState` and `trendLabel`.
- Produces `points-engine.refreshRankCache({ affectedMemberIds, writeSnapshot, snapshotKind }).data.settlementImpact`.
- Produces `points-engine.rebuildRankSnapshots({ seasonId, snapshotKind })` for initial baseline/backfill.

- [ ] **Step 1: Write failing settlement impact helper tests**

Create `cloudfunctions/points-engine/lib/__tests__/settlement-impact.test.js`:

```js
const { buildSettlementImpact } = require('../settlement-impact')

test('buildSettlementImpact compares previous cached ranks with refreshed ranks', () => {
  const out = buildSettlementImpact({
    affectedMemberIds: ['A', 'B', 'NEW'],
    beforeRankRows: [
      { _id: 'A', name: '乐乐', totalPoints: 100, rank: 3 },
      { _id: 'B', name: '小野马', totalPoints: 90, rank: 2 }
    ],
    afterRankRows: [
      { _id: 'A', name: '乐乐', totalPoints: 120, rank: 1 },
      { _id: 'B', name: '小野马', totalPoints: 100, rank: 3 },
      { _id: 'NEW', name: '新选手', totalPoints: 10, rank: 9 }
    ]
  })

  expect(out).toEqual([
    { memberId: 'A', name: '乐乐', pointsDelta: 20, rankDelta: 2, trendLabel: '▲2' },
    { memberId: 'B', name: '小野马', pointsDelta: 10, rankDelta: -1, trendLabel: '▼1' },
    { memberId: 'NEW', name: '新选手', pointsDelta: 10, rankDelta: null, trendLabel: '首次进入榜单' }
  ])
})
```

- [ ] **Step 2: Run settlement impact helper tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- lib/__tests__/settlement-impact.test.js
```

Expected: FAIL with `Cannot find module '../settlement-impact'`.

- [ ] **Step 3: Implement settlement impact helper**

Create `cloudfunctions/points-engine/lib/settlement-impact.js`:

```js
function buildSettlementImpact({ beforeRankRows = [], afterRankRows = [], affectedMemberIds = [] } = {}) {
  const before = rankMap(beforeRankRows)
  const after = rankMap(afterRankRows)
  return [...new Set((affectedMemberIds || []).filter(Boolean))]
    .map(memberId => impactFor(memberId, before.get(memberId), after.get(memberId)))
    .filter(Boolean)
}

function rankMap(rows) {
  const map = new Map()
  ;(rows || []).forEach((row, index) => {
    const memberId = row && (row._id || row.memberId)
    if (!memberId) return
    map.set(memberId, {
      memberId,
      name: row.name || memberId,
      totalPoints: Number(row.totalPoints) || 0,
      rank: Number(row.rank) || index + 1
    })
  })
  return map
}

function impactFor(memberId, before, after) {
  if (!after) return null
  const pointsDelta = after.totalPoints - (before ? before.totalPoints : 0)
  const rankDelta = before ? before.rank - after.rank : null
  return {
    memberId,
    name: after.name || (before && before.name) || memberId,
    pointsDelta,
    rankDelta,
    trendLabel: trendLabel(rankDelta)
  }
}

function trendLabel(rankDelta) {
  if (rankDelta == null) return '首次进入榜单'
  if (rankDelta > 0) return `▲${rankDelta}`
  if (rankDelta < 0) return `▼${Math.abs(rankDelta)}`
  return '持平'
}

module.exports = { buildSettlementImpact }
```

- [ ] **Step 4: Write failing rank cache impact and snapshot tests**

Append to `cloudfunctions/points-engine/__tests__/index.test.js`:

```js
test('refreshRankCache returns settlementImpact and writes snapshot rows after cache refresh', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '甲', publicProfileConsent: true })
  cloud.__rows.baseline_standings.push({ _id: 'bs_A', seasonId: 'season_2026', type: 'singles', memberId: 'A', totalPoints: 100, wins: 1, losses: 0, createTime: '2026-05-01' })
  cloud.__rows.rank_cache.push({
    _id: 'rank_cache_season_2026_singles',
    seasonId: 'season_2026',
    type: 'singles',
    rankList: [{ _id: 'A', name: '甲', totalPoints: 80, winCount: 1, lossCount: 0, rank: 3 }]
  })

  const { main } = require('../index')
  const res = await main({
    action: 'refreshRankCache',
    seasonId: 'season_2026',
    affectedMemberIds: ['A'],
    writeSnapshot: true,
    snapshotKind: 'settlement',
    now: '2026-07-07T10:00:00.000Z'
  })

  expect(res.success).toBe(true)
  expect(res.data.settlementImpact[0]).toMatchObject({ memberId: 'A', pointsDelta: 20 })
  expect(cloud.__rows.rank_snapshots.some(row => row.seasonId === 'season_2026' && row.type === 'singles' && row.memberId === 'A' && row.snapshotKind === 'settlement')).toBe(true)
})

test('rebuildRankSnapshots writes baseline snapshots for current rank lists', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '甲', publicProfileConsent: true })
  cloud.__rows.baseline_standings.push({ _id: 'bs_A', seasonId: 'season_2026', type: 'singles', memberId: 'A', totalPoints: 100, wins: 1, losses: 0, createTime: '2026-05-01' })
  const { main } = require('../index')
  const res = await main({ action: 'rebuildRankSnapshots', seasonId: 'season_2026', snapshotKind: 'baseline', now: '2026-07-07T10:00:00.000Z' })
  expect(res.success).toBe(true)
  expect(cloud.__rows.rank_snapshots.some(row => row.memberId === 'A' && row.snapshotKind === 'baseline')).toBe(true)
})
```

- [ ] **Step 5: Implement refresh cache impact and snapshot writing**

Modify `cloudfunctions/points-engine/index.js` imports:

```js
const { buildSettlementImpact } = require('./lib/settlement-impact')
```

Add the action route near the other compat actions:

```js
if (action === 'rebuildRankSnapshots') return await rebuildRankSnapshots(event)
```

Modify `refreshRankCache`:

```js
async function refreshRankCache({ seasonId, now, affectedMemberIds = [], writeSnapshot = false, snapshotKind = 'settlement' } = {}) {
  const computedAt = new Date(now || Date.now())
  const resolvedSeasonId = seasonId || `season_${toBeijingDateKey(computedAt).slice(0, 4)}`
  const cacheDate = toBeijingDateKey(computedAt)
  const refreshedTypes = []
  const settlementImpact = []
  for (const type of ['singles', 'doubles']) {
    const previousCache = await fetchRankCache({ seasonId: resolvedSeasonId, type })
    const beforeRankRows = withRankNumbers((previousCache && previousCache.rankList) || [])
    const rankList = withRankNumbers(await buildRankList({ seasonId: resolvedSeasonId, type }))
    settlementImpact.push(...buildSettlementImpact({ beforeRankRows, afterRankRows: rankList, affectedMemberIds }))
    await upsertRankCache({
      _id: rankCacheId(resolvedSeasonId, type),
      seasonId: resolvedSeasonId,
      type,
      rankList,
      cacheDate,
      computedAt,
      updateTime: computedAt
    })
    if (writeSnapshot) {
      await writeRankSnapshotsFromRankList({ seasonId: resolvedSeasonId, type, rankList, snapshotKind, computedAt })
    }
    refreshedTypes.push(type)
  }
  return { success: true, data: { seasonId: resolvedSeasonId, cacheDate, refreshedTypes, settlementImpact } }
}
```

Add helpers:

```js
function withRankNumbers(rankList) {
  return (rankList || []).map((row, index) => ({ ...row, rank: Number(row.rank) || index + 1 }))
}

async function writeRankSnapshotsFromRankList({ seasonId, type, rankList, snapshotKind, computedAt }) {
  const weekId = `${snapshotKind}_${toBeijingDateKey(computedAt)}`
  const weekStart = toBeijingDateKey(computedAt)
  const weekEnd = weekStart
  for (const row of rankList || []) {
    const memberId = row._id || row.memberId
    if (!memberId) continue
    await upsertRankSnapshot({
      _id: `rs_${seasonId}_${weekId}_${type}_${memberId}`,
      seasonId,
      weekId,
      weekStart,
      weekEnd,
      effectiveAt: computedAt,
      type,
      memberId,
      rank: row.rank,
      totalPoints: row.totalPoints || 0,
      wins: row.winCount || 0,
      losses: row.lossCount || 0,
      snapshotKind,
      computedAt
    })
  }
}

async function upsertRankSnapshot(row) {
  const existing = await db.collection('rank_snapshots').doc(row._id).get().catch(() => null)
  if (existing && existing.data) {
    const { _id, ...data } = row
    await db.collection('rank_snapshots').doc(row._id).update({ data })
    return
  }
  await db.collection('rank_snapshots').add({ data: row })
}

async function rebuildRankSnapshots({ seasonId, snapshotKind = 'baseline', now } = {}) {
  if (!seasonId) return { success: false, error: { code: 'INVALID_ARG', message: 'seasonId required' } }
  const computedAt = new Date(now || Date.now())
  const writtenTypes = []
  for (const type of ['singles', 'doubles']) {
    const rankList = withRankNumbers(await buildRankList({ seasonId, type }))
    await writeRankSnapshotsFromRankList({ seasonId, type, rankList, snapshotKind, computedAt })
    writtenTypes.push(type)
  }
  return { success: true, data: { seasonId, snapshotKind, writtenTypes } }
}
```

- [ ] **Step 6: Write failing points-engine trend state tests**

Append to `cloudfunctions/points-engine/__tests__/index.test.js`:

```js
test('rankList marks flat trend when snapshot rank equals current rank', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '甲' })
  cloud.__rows.baseline_standings.push({ _id: 'bs_A', seasonId: 'season_2026', type: 'singles', memberId: 'A', totalPoints: 100, wins: 1, losses: 0, createTime: '2026-05-01' })
  cloud.__rows.rank_snapshots.push({ _id: 'rs_A', seasonId: 'season_2026', type: 'singles', memberId: 'A', rank: 1, effectiveAt: new Date('2026-05-10'), computedAt: new Date('2026-05-10') })
  const { main } = require('../index')
  const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })
  expect(res.data.rankList[0]).toMatchObject({ trendDelta: 0, trendState: 'flat', trendLabel: '持平' })
})

test('rankList marks no_history when no snapshot exists anywhere', async () => {
  const cloud = require('wx-server-sdk')
  cloud.__rows.members.push({ _id: 'A', name: '甲' })
  cloud.__rows.baseline_standings.push({ _id: 'bs_A', seasonId: 'season_2026', type: 'singles', memberId: 'A', totalPoints: 100, wins: 1, losses: 0, createTime: '2026-05-01' })
  const { main } = require('../index')
  const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })
  expect(res.data.rankList[0]).toMatchObject({ trendDelta: null, trendState: 'no_history', trendLabel: '暂无历史' })
})
```

- [ ] **Step 7: Run trend backend tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- __tests__/index.test.js -t "trend"
```

Expected: FAIL because `trendState` and `trendLabel` are missing.

- [ ] **Step 8: Implement trend state helper**

Modify `cloudfunctions/points-engine/index.js`:

```js
function trendMeta(snap, currentRank, hasAnySnapshot) {
  if (!hasAnySnapshot) return { trendDelta: null, trendState: 'no_history', trendLabel: '暂无历史' }
  if (!snap) return { trendDelta: null, trendState: 'new', trendLabel: '新上榜' }
  const delta = snap.rank - currentRank
  if (delta > 0) return { trendDelta: delta, trendState: 'up', trendLabel: `▲${delta}` }
  if (delta < 0) return { trendDelta: delta, trendState: 'down', trendLabel: `▼${Math.abs(delta)}` }
  return { trendDelta: 0, trendState: 'flat', trendLabel: '持平' }
}
```

Add a helper:

```js
async function hasAnyRankSnapshot({ seasonId, type }) {
  try {
    const res = await db.collection('rank_snapshots').where({ seasonId, type }).limit(1).get()
    return !!(res && res.data && res.data.length)
  } catch (err) {
    if (isMissingCollectionError(err)) return false
    throw err
  }
}
```

Modify `buildRankList`:

```js
const [snapshotMap, hasHistory] = await Promise.all([
  fetchLatestSnapshotMap({ seasonId, type, memberIds }),
  hasAnyRankSnapshot({ seasonId, type })
])
const out = withWinRate.map((row, i) => {
  const currentRank = i + 1
  const snap = snapshotMap.get(row._id)
  return { ...row, ...trendMeta(snap, currentRank, hasHistory) }
})
```

- [ ] **Step 9: Verify backend trend tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- __tests__/index.test.js -t "trend"
```

Expected: PASS.

- [ ] **Step 10: Write failing rank-row tests**

Create `miniprogram/components/rank-row/__tests__/index.test.js`:

```js
const fs = require('fs')
const path = require('path')

function loadComponent() {
  jest.resetModules()
  let componentDef
  global.Component = (def) => { componentDef = def }
  require('../index')
  return componentDef
}

afterEach(() => {
  delete global.Component
})

test('rank-row exposes trendState and trendLabel properties', () => {
  const def = loadComponent()
  expect(def.properties.trendState).toBeTruthy()
  expect(def.properties.trendLabel).toBeTruthy()
})

test('rank-row template renders explicit trendLabel', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('{{trendLabel}}')
  expect(wxml).toContain('trendState')
})
```

- [ ] **Step 11: Run rank-row tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- components/rank-row/__tests__/index.test.js
```

Expected: FAIL because `trendState` and `trendLabel` are not defined.

- [ ] **Step 12: Implement rank-row trend labels**

Modify `miniprogram/components/rank-row/index.js` properties:

```js
trendDelta: { type: null, value: null },
trendState: { type: String, value: 'no_history' },
trendLabel: { type: String, value: '暂无历史' },
```

Modify `miniprogram/components/rank-row/index.wxml` trend cell:

```xml
<view class="trend-cell trend-{{trendState}}">
  <text class="trend-text">{{trendLabel || '暂无历史'}}</text>
</view>
```

Modify `miniprogram/components/rank-row/index.wxss` by mapping existing colors:

```css
.trend-up .trend-text { color: var(--color-success); }
.trend-down .trend-text { color: var(--color-danger); }
.trend-flat .trend-text,
.trend-new .trend-text,
.trend-no_history .trend-text {
  color: var(--color-muted);
  font-weight: 800;
}
```

- [ ] **Step 13: Update rank page sanitizer and template**

Modify `miniprogram/pages/rank/index.js` `_sanitizeRankRow`:

```js
_sanitizeRankRow(row) {
  const { avatarUrl, ...safeRow } = row || {}
  return {
    ...safeRow,
    winRatePct: this._formatWinRatePct(row),
    trendState: safeRow.trendState || this._deriveTrendState(safeRow),
    trendLabel: safeRow.trendLabel || this._deriveTrendLabel(safeRow)
  }
},

_deriveTrendState(row) {
  if (!row || row.trendDelta === null || row.trendDelta === undefined) return 'no_history'
  if (row.trendDelta > 0) return 'up'
  if (row.trendDelta < 0) return 'down'
  return 'flat'
},

_deriveTrendLabel(row) {
  if (!row || row.trendDelta === null || row.trendDelta === undefined) return '暂无历史'
  if (row.trendDelta > 0) return `▲${row.trendDelta}`
  if (row.trendDelta < 0) return `▼${Math.abs(row.trendDelta)}`
  return '持平'
}
```

Modify `miniprogram/pages/rank/index.wxml` rank-row invocation:

```xml
trend-state="{{item.trendState}}"
trend-label="{{item.trendLabel}}"
```

- [ ] **Step 14: Add rank page tests for trend labels**

Append to `miniprogram/pages/rank/__tests__/index.test.js`:

```js
test('loadRank preserves backend trend labels', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValue({
    result: { data: { rankList: [
      { _id: 'A', winCount: 1, lossCount: 0, winRate: 1, trendDelta: 0, trendState: 'flat', trendLabel: '持平' },
      { _id: 'B', winCount: 1, lossCount: 0, winRate: 1, trendDelta: null, trendState: 'new', trendLabel: '新上榜' }
    ] } }
  })
  const ctx = makeCtx(def, { activeTab: 'singles', seasonYear: 2026 })
  await ctx.loadRank()
  expect(ctx.data.rankList.map(row => row.trendLabel)).toEqual(['持平', '新上榜'])
})
```

- [ ] **Step 15: Run Task 4 tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- lib/__tests__/settlement-impact.test.js __tests__/index.test.js -t "trend|refreshRankCache returns"
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- components/rank-row/__tests__/index.test.js pages/rank/__tests__/index.test.js
```

Expected: PASS.

- [ ] **Step 16: Commit Task 4**

```bash
git add cloudfunctions/points-engine miniprogram/components/rank-row miniprogram/pages/rank
git commit -m "feat(rank): show explicit ranking trend states"
```

---

### Task 5: Player Detail Analytics UI and Team H2H

**Files:**
- Modify: `miniprogram/pages/player-detail/index.js`
- Modify: `miniprogram/pages/player-detail/index.wxml`
- Modify: `miniprogram/pages/player-detail/index.wxss`
- Modify: `miniprogram/pages/player-detail/__tests__/index.test.js`
- Modify: `miniprogram/components/h2h-row/index.js`
- Modify: `miniprogram/components/h2h-row/index.wxml`
- Modify: `miniprogram/components/h2h-row/index.wxss`
- Modify: `miniprogram/components/h2h-row/__tests__/index.test.js`

**Interfaces:**
- Consumes analytics shape from Task 2:
  - `analytics.singles.lastFive.summary`
  - `analytics.doubles.bestPartners`
  - `analytics.doubles.teamH2H`
  - `analytics.singles.strongAgainst`
  - `analytics.singles.strugglesAgainst`
  - `analytics.doubles.strongAgainst`
  - `analytics.doubles.strugglesAgainst`
  - `analytics.recentMatches`
- Produces H2H row props:
  - `subject-team-label: string`
  - `opponent-team-label: string`
  - `record: string`
  - `expanded: boolean`
  - `recent-matches: array`

- [ ] **Step 1: Write failing h2h-row team layout tests**

Modify `miniprogram/components/h2h-row/__tests__/index.test.js`:

```js
test('component supports team-vs-team labels and expanded recent matches', () => {
  const def = loadComponent()
  expect(def.properties.subjectTeamLabel).toBeTruthy()
  expect(def.properties.opponentTeamLabel).toBeTruthy()
  expect(def.properties.recentMatches).toBeTruthy()
})

test('template renders subject and opponent team labels', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  expect(wxml).toContain('{{subjectTeamLabel}}')
  expect(wxml).toContain('{{opponentTeamLabel}}')
  expect(wxml).toContain('recentMatches')
})
```

- [ ] **Step 2: Run h2h-row tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- components/h2h-row/__tests__/index.test.js
```

Expected: FAIL because team props are missing.

- [ ] **Step 3: Implement h2h-row team layout**

Modify `miniprogram/components/h2h-row/index.js` properties:

```js
subjectTeamLabel: String,
opponentTeamLabel: String,
recentMatches: { type: Array, value: [] },
expanded: { type: Boolean, value: false },
```

Keep legacy `playerId`, `name`, `avatarUrl`, `wins`, `losses` props for singles rows.

Modify `onTap`:

```js
onTap() {
  if (this.data.subjectTeamLabel || this.data.opponentTeamLabel) {
    this.triggerEvent('toggle', { key: `${this.data.subjectTeamLabel}|${this.data.opponentTeamLabel}` })
    return
  }
  if (!this.data.playerId) return
  this.triggerEvent('tap', { playerId: this.data.playerId })
}
```

Modify `miniprogram/components/h2h-row/index.wxml`:

```xml
<view class="h2h-row" bindtap="onTap" hover-class="h2h-row--active" hover-stay-time="80">
  <block wx:if="{{subjectTeamLabel || opponentTeamLabel}}">
    <view class="team team-subject">
      <text class="team-kicker">我方组合</text>
      <text class="team-name">{{subjectTeamLabel}}</text>
    </view>
    <text class="pill pill-{{pillClass}} num">{{record}}</text>
    <view class="team team-opponent">
      <text class="team-kicker">对手组合</text>
      <text class="team-name">{{opponentTeamLabel}}</text>
    </view>
    <view wx:if="{{expanded && recentMatches.length}}" class="h2h-recent">
      <view wx:for="{{recentMatches}}" wx:key="matchId" class="h2h-recent-row">
        <text>{{item.confirmedAt || item.createTime}}</text>
        <text>{{item.score || ''}}</text>
      </view>
    </view>
  </block>
  <block wx:else>
    <image class="avatar" src="{{avatarUrl || '/images/icons/default-avatar.png'}}" mode="aspectFill" />
    <text class="name">{{name}}</text>
    <text class="pill pill-{{pillClass}} num">{{record}}</text>
  </block>
</view>
```

Add focused styles:

```css
.team {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.team-opponent {
  text-align: right;
}
.team-kicker {
  color: var(--color-muted);
  font-size: 20rpx;
  font-weight: 800;
}
.team-name {
  color: var(--color-text-primary);
  font-size: 26rpx;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.h2h-recent {
  grid-column: 1 / -1;
  margin-top: 12rpx;
  border-top: 1rpx solid var(--color-border);
  padding-top: 10rpx;
}
.h2h-recent-row {
  display: flex;
  justify-content: space-between;
  color: var(--color-muted);
  font-size: 22rpx;
}
```

- [ ] **Step 4: Verify h2h-row tests pass**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- components/h2h-row/__tests__/index.test.js
```

Expected: PASS.

- [ ] **Step 5: Write failing player-detail analytics tests**

Append to `miniprogram/pages/player-detail/__tests__/index.test.js`:

```js
test('loadAll fetches analytics and maps recent form, best partner, and team h2h', async () => {
  const def = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockImplementation(({ name, data }) => {
    if (name === 'members') return Promise.resolve({ result: { data: { _id: 'A', name: '乐乐' } } })
    if (name === 'points-engine' && data.action === 'playerStats') {
      return Promise.resolve({ result: { success: true, data: { stats: { singles: {}, doubles: {} }, currentRank: {}, rankHistory: {}, recent: [] } } })
    }
    if (name === 'points-engine' && data.action === 'playerH2H') {
      return Promise.resolve({ result: { success: true, data: { singles: [], doubles: [] } } })
    }
    if (name === 'analytics-engine' && data.action === 'getPlayerAnalytics') {
      return Promise.resolve({ result: { success: true, data: {
        singles: { lastFive: { summary: '4W-1L' }, strongAgainst: [{ memberId: 'B', name: '标子', wins: 3, losses: 0 }], strugglesAgainst: [{ memberId: 'C', name: '小天', wins: 1, losses: 2 }] },
        doubles: {
          bestPartners: [{ memberId: 'P', name: '小野马', matches: 5, winRate: 0.8 }],
          teamH2H: [{
            key: 'A__P__vs__B__C',
            subjectTeamLabel: '乐乐 / 小野马',
            opponentTeamLabel: '小天 / 标子',
            wins: 2,
            losses: 1,
            recentMatches: [{ matchId: 'd1', score: '4-2', confirmedAt: '2026-06-01' }]
          }]
        },
        recentMatches: [{ matchId: 'd1', tournamentType: 'doubles', subjectTeamLabel: '乐乐 / 小野马', opponentTeamLabel: '小天 / 标子' }]
      } } })
    }
    return Promise.resolve({ result: { success: true, data: null } })
  })
  const ctx = makeCtx(def, { seasonYear: 2026 })
  await ctx.loadAll('A')
  await Promise.resolve()
  expect(ctx.data.analytics.singles.lastFive.summary).toBe('4W-1L')
  expect(ctx.data.activeFormSummary).toBe('4W-1L')
  expect(ctx.data.bestPartner).toMatchObject({ name: '小野马', matches: 5 })
  expect(ctx.data.bestPartnerWinRatePct).toBe('80%')
  expect(ctx.data.advantageInsight.name).toBe('标子')
  expect(ctx.data.struggleInsight.name).toBe('小天')
  expect(ctx._teamH2HFromAnalytics().map(row => row.opponentTeamLabel)).toEqual(['小天 / 标子'])
})
```

- [ ] **Step 6: Run player-detail analytics test to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/player-detail/__tests__/index.test.js -t "analytics"
```

Expected: FAIL because `analytics-engine.getPlayerAnalytics` is not called and mapped.

- [ ] **Step 7: Implement player-detail analytics fetch and mapping**

Modify `miniprogram/pages/player-detail/index.js`:

Add defaults:

```js
const DEFAULT_ANALYTICS = {
  singles: { lastFive: null, strongAgainst: [], strugglesAgainst: [] },
  doubles: { lastFive: null, bestPartners: [], teamH2H: [], strongAgainst: [], strugglesAgainst: [] },
  recentMatches: []
}
```

Add data fields:

```js
analytics: DEFAULT_ANALYTICS,
activeFormSummary: '',
bestPartner: null,
bestPartnerWinRatePct: '',
advantageInsight: null,
struggleInsight: null,
expandedTeamH2HKey: '',
```

In `loadAll`, add a third call:

```js
callFunction({ name: 'analytics-engine', data: { action: 'getPlayerAnalytics', seasonId, memberId: playerId } })
```

Map result defensively:

```js
const analyticsResult = analyticsRes && analyticsRes.result
const analytics = (analyticsResult && analyticsResult.success !== false && analyticsResult.data) || DEFAULT_ANALYTICS
```

Add to `setStateFromResponses` input and state:

```js
analytics,
...this._getAnalyticsActiveData(this.data.activeTab, analytics)
```

Add helper:

```js
_getAnalyticsActiveData(type, analytics = this.data.analytics || DEFAULT_ANALYTICS) {
  const activeType = type === 'doubles' ? 'doubles' : 'singles'
  const bucket = analytics[activeType] || {}
  const bestPartner = activeType === 'doubles' && bucket.bestPartners && bucket.bestPartners[0] ? bucket.bestPartners[0] : null
  return {
    activeFormSummary: bucket.lastFive && bucket.lastFive.summary ? bucket.lastFive.summary : '',
    bestPartner,
    bestPartnerWinRatePct: bestPartner ? `${Math.round(Number(bestPartner.winRate || 0) * 100)}%` : '',
    advantageInsight: bucket.strongAgainst && bucket.strongAgainst[0] ? bucket.strongAgainst[0] : null,
    struggleInsight: bucket.strugglesAgainst && bucket.strugglesAgainst[0] ? bucket.strugglesAgainst[0] : null
  }
}
```

Update `onTabChange` to merge `_getAnalyticsActiveData(tab)`.

- [ ] **Step 8: Render analytics modules in player-detail**

Modify `miniprogram/pages/player-detail/index.wxml` after active stats:

```xml
<view class="pd-section pd-analytics-grid anim-stage-rise anim-delay-4" wx:if="{{activeFormSummary || bestPartner || advantageInsight || struggleInsight}}">
  <view class="pd-analytics-card" wx:if="{{activeFormSummary}}">
    <text class="pd-analytics-label">近 5 场</text>
    <text class="pd-analytics-value num">{{activeFormSummary}}</text>
  </view>
  <view class="pd-analytics-card" wx:if="{{bestPartner}}">
    <text class="pd-analytics-label">最佳搭档</text>
    <text class="pd-analytics-value">{{bestPartner.name}}</text>
    <text class="pd-analytics-meta">{{bestPartner.matches}} 场 · {{bestPartnerWinRatePct}}</text>
  </view>
  <view class="pd-analytics-card" wx:if="{{advantageInsight}}">
    <text class="pd-analytics-label">优势对手</text>
    <text class="pd-analytics-value">{{advantageInsight.name}}</text>
    <text class="pd-analytics-meta">{{advantageInsight.wins}}-{{advantageInsight.losses}}</text>
  </view>
  <view class="pd-analytics-card" wx:if="{{struggleInsight}}">
    <text class="pd-analytics-label">苦主</text>
    <text class="pd-analytics-value">{{struggleInsight.name}}</text>
    <text class="pd-analytics-meta">{{struggleInsight.wins}}-{{struggleInsight.losses}}</text>
  </view>
</view>
```

Add styles:

```css
.pd-analytics-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12rpx;
}
.pd-analytics-card {
  min-width: 0;
  padding: 18rpx;
  border: 1rpx solid var(--color-border);
  border-radius: 8rpx;
  background: var(--color-bg-surface);
}
.pd-analytics-label {
  color: var(--color-muted);
  font-size: 20rpx;
  font-weight: 800;
}
.pd-analytics-value {
  display: block;
  margin-top: 6rpx;
  color: var(--color-text-primary);
  font-size: 28rpx;
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pd-analytics-meta {
  display: block;
  margin-top: 4rpx;
  color: var(--color-muted);
  font-size: 22rpx;
}
```

- [ ] **Step 9: Adapt doubles H2H active rows**

In `miniprogram/pages/player-detail/index.js`, add a mapping helper:

```js
_teamH2HFromAnalytics(analytics = this.data.analytics || DEFAULT_ANALYTICS) {
  const rows = analytics && analytics.doubles && analytics.doubles.teamH2H
  return Array.isArray(rows) ? rows.map(row => ({
    key: row.key || `${row.subjectTeamLabel || ''}|${row.opponentTeamLabel || ''}`,
    subjectTeamLabel: row.subjectTeamLabel || '我方组合',
    opponentTeamLabel: row.opponentTeamLabel || '对手组合',
    wins: row.wins || 0,
    losses: row.losses || 0,
    recentMatches: row.recentMatches || []
  })) : []
}
```

Then for doubles active H2H prefer analytics rows if present:

```js
const teamH2H = activeType === 'doubles' ? this._teamH2HFromAnalytics(analytics) : []
activeH2H: teamH2H.length ? teamH2H : existingRows.map(row => ({ ...row, key: row.key || row.memberId }))
```

Update WXML `h2h-row` call:

```xml
wx:key="key"
subject-team-label="{{item.subjectTeamLabel}}"
opponent-team-label="{{item.opponentTeamLabel}}"
recent-matches="{{item.recentMatches}}"
expanded="{{expandedTeamH2HKey === item.key}}"
bind:toggle="onTeamH2HToggle"
```

Add handler:

```js
onTeamH2HToggle(e) {
  const key = e.detail && e.detail.key
  this.setData({ expandedTeamH2HKey: this.data.expandedTeamH2HKey === key ? '' : key })
}
```

- [ ] **Step 10: Run Task 5 tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- components/h2h-row/__tests__/index.test.js pages/player-detail/__tests__/index.test.js
```

Expected: PASS.

- [ ] **Step 11: Commit Task 5**

```bash
git add miniprogram/pages/player-detail miniprogram/components/h2h-row
git commit -m "feat(player): show cached analytics and team h2h"
```

---

### Task 6: Schema, Runbook, and End-to-End Verification

**Files:**
- Modify: `cloudfunctions/DATABASE_SCHEMA.md`
- Modify: `docs/testing/e2e-regression-runbook.md`

**Interfaces:**
- Documents `player_analytics`, `pair_analytics`, `analytics_jobs`.
- Documents deploy and rebuild commands.
- Produces final validation evidence before implementation completion.

- [ ] **Step 1: Update database schema**

Append to `cloudfunctions/DATABASE_SCHEMA.md` after `rank_cache`:

```markdown
## player_analytics

Per-season per-member analytics cache generated by `analytics-engine`.

| Field | Type | Description |
|---|---|---|
| `_id` | string | `pa_<seasonId>_<memberId>` |
| `seasonId` | string | Season id, for example `season_2026` |
| `memberId` | string | Member id |
| `singles` | object | Singles aggregate, last five, strongAgainst, strugglesAgainst |
| `doubles` | object | Doubles aggregate, last five, bestPartners, teamH2H, strongAgainst, strugglesAgainst |
| `recentMatches` | array | Id-based recent rows; doubles rows include `subjectTeam` and `opponentTeam` member ids, labels resolved on read |
| `lastSettlementImpact` | object/null | Last settlement impact shown after score confirmation |
| `sourceVersion` | number | Analytics schema version |
| `updatedAt` | Date | Cache update time |

Privacy rule: cache member ids and aggregate records; resolve names, avatar URLs, and public visibility from current `members` data in `analytics-engine.getPlayerAnalytics` so revoke/delete flows cannot leave stale display names in the UI.

Indexes:

1. `_id` unique
2. `(seasonId, memberId)` for player analytics reads

## pair_analytics

Per-season per-doubles-pair analytics cache generated by `analytics-engine`.

| Field | Type | Description |
|---|---|---|
| `_id` | string | `pair_<seasonId>_<memberA>__<memberB>` with sorted member ids |
| `seasonId` | string | Season id |
| `pairId` | string | `<memberA>__<memberB>` |
| `memberIds` | array | Sorted member ids |
| `matches` | number | Total doubles matches for the pair |
| `wins` | number | Pair wins |
| `losses` | number | Pair losses |
| `winRate` | number | `wins / matches`, or 0 |
| `recentMatches` | array | Id-based last 5 pair matches |
| `matchups` | array | Opponent pair id/member id records with wins/losses |
| `sourceVersion` | number | Analytics schema version |
| `updatedAt` | Date | Cache update time |

Indexes:

1. `_id` unique
2. `(seasonId, memberIds)` for pair analytics reads by member id
3. `(seasonId, pairId)` for direct pair lookup and audit tools

## analytics_jobs

Refresh and rebuild audit log for analytics cache work.

| Field | Type | Description |
|---|---|---|
| `_id` | string | Generated job id |
| `jobType` | string | `refreshAfterSettlement` or `rebuildSeason` |
| `seasonId` | string | Season id |
| `status` | string | `success` or `failed` |
| `affectedMemberIds` | array | Members touched by the job |
| `matchIds` | array | Match result ids touched by the job |
| `error` | string | Failure message, empty on success |
| `createTime` | Date | Create time |
| `updateTime` | Date | Update time |

Indexes:

1. `_id` unique
2. `(seasonId, jobType, createTime DESC)` for rebuild/refresh audit
3. `(status, updateTime DESC)` for failed job review
```

- [ ] **Step 2: Update E2E runbook**

Add to `docs/testing/e2e-regression-runbook.md`:

```markdown
### Ranking Analytics Smoke

1. Deploy `analytics-engine`, `points-engine`, and `match-results` to the target environment.
2. Rebuild current season rank snapshots:
   `points-engine.rebuildRankSnapshots({ seasonId: 'season_2026', snapshotKind: 'baseline' })`
3. Rebuild current season analytics:
   `analytics-engine.rebuildSeason({ seasonId: 'season_2026' })`
4. Confirm one singles score as admin through batch confirm.
5. Verify `rank_cache` updates, rank snapshots receive a `settlement` row, and rank page no longer shows only `—` for trend states.
6. Confirm one doubles score as admin through direct reconfirm.
7. Open the affected player detail page.
8. Verify recent form, best partner, strong/struggle opponent cards, and team-vs-team doubles H2H.
9. Revoke public display for one affected member.
10. Verify analytics rows render the revoked member through anonymous public identity.
11. If analytics refresh fails, verify the score remains confirmed and `analytics_jobs` records `status: failed`.
```

- [ ] **Step 3: Run full focused tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results
npm test -- __tests__/analytics-integration.test.js lib/__tests__/handlers/batch.test.js lib/__tests__/handlers/submit.test.js
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- lib/__tests__/settlement-impact.test.js __tests__/index.test.js
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/rank/__tests__/index.test.js pages/player-detail/__tests__/index.test.js pages/tournament-score/__tests__/index.test.js components/h2h-row/__tests__/index.test.js components/batch-result-sheet/__tests__/index.test.js
```

Expected: PASS for all listed suites.

- [ ] **Step 4: Run packaging safety checks**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git status --short
```

Expected: only intended files are modified.

- [ ] **Step 5: Commit Task 6**

```bash
git add cloudfunctions/DATABASE_SCHEMA.md docs/testing/e2e-regression-runbook.md
git commit -m "docs(analytics): document ranking analytics caches"
```

---

## Final Verification

- [ ] Run all changed cloud function suites:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine && npm test
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test
```

Expected: PASS.

- [ ] Run all changed mini-program suites:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/rank/__tests__/index.test.js pages/player-detail/__tests__/index.test.js pages/tournament-score/__tests__/index.test.js components/h2h-row/__tests__/index.test.js components/batch-result-sheet/__tests__/index.test.js
```

Expected: PASS.

- [ ] Run WeChat Developer Tools smoke after deployment:

```text
1. Open an admin session.
2. Confirm a singles score.
3. Open Rankings and verify points/rank are refreshed and TREND is not a generic dash.
4. Confirm a doubles score.
5. Open one affected player detail page and verify best partner plus team-vs-team H2H.
```

Expected: confirmed scores remain saved, rank data updates, and doubles H2H shows two teams.
