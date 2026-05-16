# Phase 10-2 Implementation Plan — Player Detail rebuild + H2H + Rank Chart

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the player-detail experience that Phase 10-1 unlocked the data for — extend `points-engine.playerStats`, add a new `playerH2H` action, ship two new components (`rank-chart`, `h2h-row`), and rebuild `pages/player-detail/index` to surface hero rank + stats (3 cards × 2) + 12-week rank trend chart + H2H + clean recent matches.

**Architecture:**
- `points-engine.playerStats` extends additively: existing `stats.singles/doubles.{winCount, lossCount, totalPoints}` stay; new fields `winRate`, `currentRank.{singles, doubles}`, `rankHistory.{singles, doubles}[]` (last 12 weeks from `rank_snapshots`), `weeklySnapshot.{singles, doubles}.{pointsDelta, wins, losses}` (live via `aggregateWeeklyPlayerDelta`).
- `recent[]` gets enriched with `tournamentFormat` (joined from `tournaments`), derived `roundLabel`, explicit `opponentId/opponentName`, `pointsAwarded` (per-player from entries), `confirmedAt`. Display dropped: no `resultStatus` badge.
- New `points-engine.playerH2H` action returns `{ singles[], doubles[] }`, each row `{ memberId, name, avatarUrl, wins, losses, lastPlayedAt }`. Algorithm reads `pointsAwarded.entries[].role` (NOT trust `loserId` — Phase 8 confirmOne doesn't guarantee writing it). `resolveOpponentIds` helper handles singles vs doubles partner/opponent disambiguation via `team` metadata when present, otherwise via opposite winner/loser role; if doubles schema can't cleanly separate partner from opponent, `doubles` returns `[]` and we PROGRESS-note follow-up.
- New `components/rank-chart` is a no-third-party canvas component: horizontal gridlines + ink polyline + lime end-dot + rank label. Renders "数据不足" when `data.length < 2`.
- New `components/h2h-row` is an avatar + name + win-loss pill + `→` arrow row that emits `tap` with the opponent's `playerId`.
- `pages/player-detail/index` IA: HERO → ABOUT (conditional) → SINGLES 3-card → DOUBLES 3-card (conditional) → RANK-CHART singles → RANK-CHART doubles (conditional) → H2H singles → H2H doubles (conditional) → RECENT. Single-stacked layout — **no internal tab** between singles/doubles.
- Visual-revamp stream already touched player-detail (commit `4918848`); per Codex P4 边界 rule the IA owner (this plan) must preserve existing WXSS tokens / layout intent and only add/modify what's needed for new data.

**Tech Stack:** Same as Phase 10-1 — WeChat Cloud Functions (Node 16) · Mini Program · Jest 29 (extends the in-memory db emulator pattern landed in Phase 10-1).

**Reference:**
- Spec: `docs/superpowers/specs/2026-05-16-rank-and-player-detail-design.md` (§5.4 / §5.5 / §2.2 / §7 / §8)
- Phase 10-1 plan: `docs/superpowers/plans/10-1-phase-10-1-rank-and-edit-profile.md`
- Existing player-detail (post visual revamp): `miniprogram/pages/player-detail/index.{wxml,wxss,js}`
- Communication log: `docs/communication/2026-05-16-claude-codex-v2-1-log.md`

**Commit discipline:** Explicit pathspec (`git commit -- <paths>`) per Phase 9 / 10-1 protocol — never `git add .`.

**Compatibility:** Existing callers of `points-engine.playerStats` (current `mine` / legacy paths) read `stats.singles/doubles.{winCount, lossCount, totalPoints}` + `recent`. All new fields are additive; no rename of existing fields. Full regression must stay green.

---

## File Structure (lock decomposition before tasks)

### Backend — cloudfunctions/

| File | Status | Responsibility |
|---|---|---|
| `cloudfunctions/points-engine/index.js` | modify | `playerStatsCompat` returns new fields; route `playerH2H` action |
| `cloudfunctions/points-engine/__tests__/index.test.js` | modify | Tests for new `playerStats` fields + `playerH2H` integration |
| `cloudfunctions/points-engine/lib/player-stats.js` | create | Pure helpers `deriveRoundLabel` + `enrichRecent` (extracted for testability) |
| `cloudfunctions/points-engine/lib/__tests__/player-stats.test.js` | create | Unit tests for helpers |
| `cloudfunctions/points-engine/lib/player-h2h.js` | create | `resolveOpponentIds` + `computeH2H` pure functions |
| `cloudfunctions/points-engine/lib/__tests__/player-h2h.test.js` | create | Unit tests |
| `cloudfunctions/points-engine/lib/week-window.js` | create | Local copy of natural-week helpers used by `playerStats.weeklySnapshot` |
| `scripts/sync-shared-libs.sh` | modify | Verify `weekly-star/lib/week-window.js` and `points-engine/lib/week-window.js` stay identical |

### Frontend — components/

| File | Status | Responsibility |
|---|---|---|
| `miniprogram/components/rank-chart/index.js` | create | Props: `data` (array of `{weekStart, rank}`), `height`, `color`; computes canvas polyline points + end dot |
| `miniprogram/components/rank-chart/index.json` | create | `{ "component": true }` |
| `miniprogram/components/rank-chart/index.wxml` | create | Canvas render or "数据不足" empty state |
| `miniprogram/components/rank-chart/index.wxss` | create | Container styles |
| `miniprogram/components/h2h-row/index.js` | create | Props: `playerId / name / avatarUrl / wins / losses`; emits `tap` |
| `miniprogram/components/h2h-row/index.json` | create | `{ "component": true }` |
| `miniprogram/components/h2h-row/index.wxml` | create | avatar + name + win-loss pill + → arrow |
| `miniprogram/components/h2h-row/index.wxss` | create | Pill color logic (win→lime, loss→danger-soft, even→neutral) |

### Frontend — page

| File | Status | Responsibility |
|---|---|---|
| `miniprogram/pages/player-detail/index.js` | modify | Parallel data load (3 calls); derive winRatePct + rankSubtitle; expand/collapse H2H lists; preserve existing onLoad query handling |
| `miniprogram/pages/player-detail/index.wxml` | modify | Add HERO rank subtitle, 3-card stat rows (× 2 types), rank-chart × 2, H2H sections, refactor recent rows |
| `miniprogram/pages/player-detail/index.wxss` | modify | New layout for stats cards (3-col grid), chart container, H2H section, recent rows (remove status-badge styles) |
| `miniprogram/pages/player-detail/index.json` | modify | Register `rank-chart`, `h2h-row` components |

### Docs

| File | Status | Responsibility |
|---|---|---|
| `docs/superpowers/plans/PROGRESS.md` | append | Phase 10-2 progress entries (per-task commit SHA + E2E results) |

---

## Task 1: `playerStats` — add `winRate` per bucket (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`
- Modify: `cloudfunctions/points-engine/index.js`

- [ ] **Step 1:** Append a new test block. Reuse the `jest.mock('wx-server-sdk', ...)` in-memory db pattern landed in Phase 10-1 (T12/T14). Add:

```js
describe('playerStats — winRate', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
  })

  test('singles 8W/2L → winRate 0.8 (≈0.8 within 5 decimals)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p', avatarUrl: '' })
    for (let i = 0; i < 8; i++) {
      cloud.__rows.match_results.push({
        _id: `w${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-01', createTime: '2026-04-01', playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] }
      })
    }
    for (let i = 0; i < 2; i++) {
      cloud.__rows.match_results.push({
        _id: `l${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-02', createTime: '2026-04-02', playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] }
      })
    }
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.stats.singles.winRate).toBeCloseTo(0.8, 5)
  })

  test('player with 0 matches → winRate = 0 (no divide-by-zero)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.stats.singles.winRate).toBe(0)
    expect(res.data.stats.doubles.winRate).toBe(0)
  })
})
```

- [ ] **Step 2:** Run; confirm failure (`winRate` undefined).

```bash
cd cloudfunctions/points-engine && npx jest __tests__/index.test.js -t 'winRate' --verbose
```

- [ ] **Step 3:** Edit `playerStatsCompat` in `cloudfunctions/points-engine/index.js`. After the `if (me) { buckets[t] = {...} }` block, ensure every bucket carries a `winRate` (even when 0 matches):

```js
async function playerStatsCompat({ playerId, currentSeasonId }) {
  if (!playerId) return { success: false, error: { code: 'INVALID_ARG', message: 'playerId 必填' } }
  const seasonId = currentSeasonId
  const buckets = {
    singles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 },
    doubles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 }
  }
  if (seasonId) {
    for (const t of ['singles', 'doubles']) {
      const list = await aggregateRanks({ db, seasonId, type: t, pageSize: 100 })
      const me = list.find(x => x.memberId === playerId)
      if (me) {
        const wins = me.wins || 0
        const losses = me.losses || 0
        const matches = wins + losses
        buckets[t] = {
          winCount: wins,
          lossCount: losses,
          totalPoints: me.totalPoints || 0,
          winRate: matches > 0 ? wins / matches : 0
        }
      }
    }
  }
  const recent = await fetchRecentForPlayer(playerId)
  return { success: true, data: { stats: buckets, recent } }
}
```

- [ ] **Step 4:** Run; confirm green.

```bash
cd cloudfunctions/points-engine && npx jest __tests__/index.test.js --verbose
```

(All existing tests + the 2 new ones pass.)

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
git commit -m "feat(points-engine): playerStats returns winRate per bucket" -- cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
```

---

## Task 2: `playerStats` — add `currentRank` (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`
- Modify: `cloudfunctions/points-engine/index.js`

- [ ] **Step 1:** Append a test block:

```js
describe('playerStats — currentRank', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
  })

  test('player ranked #2 in singles, unranked in doubles → { singles: 2, doubles: null }', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' }, { _id: 'B', name: 'b' })
    // A=100, B=50 → singles ranks: B=1, A=2 (B has more points than A)
    cloud.__rows.match_results.push(
      { _id: 'mA', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-01', createTime: '2026-04-01', playerIds: ['A'],
        pointsAwarded: { entries: [{ memberId: 'A', points: 50, role: 'winner' }] } },
      { _id: 'mB1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-01', createTime: '2026-04-01', playerIds: ['B'],
        pointsAwarded: { entries: [{ memberId: 'B', points: 100, role: 'winner' }] } }
    )
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'A', currentSeasonId: 's2026' })
    expect(res.data.currentRank.singles).toBe(2)
    expect(res.data.currentRank.doubles).toBeNull()
  })

  test('player not on any leaderboard → both ranks null', async () => {
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'GHOST', currentSeasonId: 's2026' })
    expect(res.data.currentRank).toEqual({ singles: null, doubles: null })
  })
})
```

- [ ] **Step 2:** Run; confirm failure.
- [ ] **Step 3:** Update `playerStatsCompat` to also derive rank from the same `aggregateRanks` call (avoid re-querying):

```js
async function playerStatsCompat({ playerId, currentSeasonId }) {
  if (!playerId) return { success: false, error: { code: 'INVALID_ARG', message: 'playerId 必填' } }
  const seasonId = currentSeasonId
  const buckets = {
    singles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 },
    doubles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 }
  }
  const currentRank = { singles: null, doubles: null }
  if (seasonId) {
    for (const t of ['singles', 'doubles']) {
      const list = await aggregateRanks({ db, seasonId, type: t, pageSize: 100 })
      const idx = list.findIndex(x => x.memberId === playerId)
      if (idx >= 0) {
        const me = list[idx]
        const wins = me.wins || 0
        const losses = me.losses || 0
        const matches = wins + losses
        buckets[t] = {
          winCount: wins,
          lossCount: losses,
          totalPoints: me.totalPoints || 0,
          winRate: matches > 0 ? wins / matches : 0
        }
        currentRank[t] = idx + 1
      }
    }
  }
  const recent = await fetchRecentForPlayer(playerId)
  return { success: true, data: { stats: buckets, currentRank, recent } }
}
```

- [ ] **Step 4:** Run; confirm green (including prior tests).
- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
git commit -m "feat(points-engine): playerStats returns currentRank (null when unranked)" -- cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
```

---

## Task 3: `playerStats` — add `rankHistory` (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`
- Modify: `cloudfunctions/points-engine/index.js`

- [ ] **Step 1:** Append:

```js
describe('playerStats — rankHistory', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
  })

  test('returns up to 12 weeks ordered weekStart ASC for both types', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    // Seed 14 weekly snapshots for singles (oldest first)
    for (let i = 0; i < 14; i++) {
      const day = `2026-0${Math.floor((i + 1) / 4) + 1}-${String((i + 1) * 2).padStart(2, '0')}`
      cloud.__rows.rank_snapshots.push({
        _id: `s_${i}`, seasonId: 's2026', type: 'singles', memberId: 'P',
        weekId: `ws_${day}`, weekStart: day, weekEnd: day,
        effectiveAt: new Date(day), computedAt: new Date(day),
        rank: 10 - i, totalPoints: 100 + i, wins: i, losses: 0, snapshotKind: 'weekly'
      })
    }
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.rankHistory.singles).toHaveLength(12)
    // Ordered ASC by weekStart → first entry is older than last
    expect(res.data.rankHistory.singles[0].weekStart < res.data.rankHistory.singles[11].weekStart).toBe(true)
    // Only {weekStart, rank} shape exposed (not the full snapshot row)
    expect(Object.keys(res.data.rankHistory.singles[0]).sort()).toEqual(['rank', 'weekStart'])
    expect(res.data.rankHistory.doubles).toEqual([])
  })

  test('fewer than 12 weeks available → returns all', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    cloud.__rows.rank_snapshots.push({
      _id: 'only', seasonId: 's2026', type: 'singles', memberId: 'P',
      weekId: 'ws_2026-05-04', weekStart: '2026-05-04', weekEnd: '2026-05-10',
      effectiveAt: new Date('2026-05-10'), computedAt: new Date('2026-05-11'),
      rank: 3, totalPoints: 100, wins: 5, losses: 1, snapshotKind: 'weekly'
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.rankHistory.singles).toEqual([{ weekStart: '2026-05-04', rank: 3 }])
  })
})
```

- [ ] **Step 2:** Run; confirm failure.
- [ ] **Step 3:** Add a helper above `playerStatsCompat`:

```js
async function fetchRankHistory({ seasonId, type, memberId, limit = 12 }) {
  if (!seasonId) return []
  const res = await db.collection('rank_snapshots')
    .where({ seasonId, type, memberId })
    .orderBy('weekStart', 'desc')
    .limit(limit)
    .get()
  const rows = (res && res.data) || []
  // Reverse to ASC and project to {weekStart, rank} only
  return rows
    .map(r => ({ weekStart: r.weekStart, rank: r.rank }))
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : a.weekStart > b.weekStart ? 1 : 0))
}
```

Update `playerStatsCompat` to invoke and include:

```js
const [rhSingles, rhDoubles] = await Promise.all([
  fetchRankHistory({ seasonId, type: 'singles', memberId: playerId }),
  fetchRankHistory({ seasonId, type: 'doubles', memberId: playerId })
])
const rankHistory = { singles: rhSingles, doubles: rhDoubles }
// ...
return { success: true, data: { stats: buckets, currentRank, rankHistory, recent } }
```

- [ ] **Step 4:** Run; confirm green.
- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
git commit -m "feat(points-engine): playerStats returns rankHistory (last 12 weeks, ASC)" -- cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
```

---

## Task 4: `playerStats` — add `weeklySnapshot` (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`
- Modify: `cloudfunctions/points-engine/index.js`
- Modify: `cloudfunctions/points-engine/lib/weekly-delta.js`
- Modify: `cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js`
- Create: `cloudfunctions/points-engine/lib/week-window.js`
- Modify: `scripts/sync-shared-libs.sh`

- [ ] **Step 1:** Append:

```js
describe('playerStats — weeklySnapshot (this-week delta)', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
  })

  test('player has 3W 1L worth 70 points this week (singles)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' })
    const today = new Date()
    const day = today.toISOString().slice(0, 10) // e.g. '2026-05-16'
    for (let i = 0; i < 3; i++) {
      cloud.__rows.match_results.push({
        _id: `w${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: day, createTime: day, playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] }
      })
    }
    cloud.__rows.match_results.push({
      _id: 'l1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: day, createTime: day, playerIds: ['P'],
      pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] }
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.weeklySnapshot.singles).toEqual({ pointsDelta: 70, wins: 3, losses: 1 })
    expect(res.data.weeklySnapshot.doubles).toEqual({ pointsDelta: 0, wins: 0, losses: 0 })
  })
})
```

- [ ] **Step 2:** Run; confirm failure.
- [ ] **Step 3:** Copy the natural-week helper into the `points-engine` package and update sync verification:

```bash
cp cloudfunctions/weekly-star/lib/week-window.js cloudfunctions/points-engine/lib/week-window.js
```

Then extend `scripts/sync-shared-libs.sh` after the `aggregate.js` check:

```bash
WEEK_SRC="$ROOT/cloudfunctions/weekly-star/lib/week-window.js"
WEEK_COPY="$ROOT/cloudfunctions/points-engine/lib/week-window.js"
if [ ! -f "$WEEK_COPY" ]; then echo "[sync] missing: $WEEK_COPY"; exit 1; fi
if [ "$(shasum256 "$WEEK_SRC")" != "$(shasum256 "$WEEK_COPY")" ]; then
  echo "[sync] week-window.js mismatch: $WEEK_SRC ↔ $WEEK_COPY"
  diff "$WEEK_SRC" "$WEEK_COPY" || true
  exit 1
fi
echo "[sync] week-window.js ok"
```

> Cloud functions are deployed as independent packages; do not require `../weekly-star/lib/week-window` from `points-engine`.

- [ ] **Step 4:** At the top of `cloudfunctions/points-engine/index.js`, add the require:

```js
const { aggregateWeeklyPlayerDelta } = require('./lib/weekly-delta')
const { getCurrentNaturalWeek } = require('./lib/week-window')
```

Update `aggregateWeeklyPlayerDelta` so it supports both production `Date` timestamps and legacy/test date strings. Build a date branch from `week.start/week.end` and a string branch from `week.weekStart/week.weekEnd`; include both in the CloudBase `_.or(...)` date filter for `confirmedAt`, and both fallback branches for `confirmedAt == null && createTime ...`.

Add a unit test in `cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js` that uses `confirmedAt: new Date(...)` and `week: { start: Date, end: Date, weekStart, weekEnd }`, proving Date production rows are counted.

In `playerStatsCompat`, compute the current week and pass the full week object to the helper for both types:

```js
const week = getCurrentNaturalWeek()
const [wsSingles, wsDoubles] = await Promise.all([
  aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId, week }),
  aggregateWeeklyPlayerDelta({ db, seasonId, type: 'doubles', playerId, week })
])
const weeklySnapshot = { singles: wsSingles, doubles: wsDoubles }
// include weeklySnapshot in the response:
return { success: true, data: { stats: buckets, currentRank, rankHistory, weeklySnapshot, recent } }
```

- [ ] **Step 5:** Run; confirm green.
- [ ] **Step 6:** Commit.

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js cloudfunctions/points-engine/lib/weekly-delta.js cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js cloudfunctions/points-engine/lib/week-window.js scripts/sync-shared-libs.sh
git commit -m "feat(points-engine): playerStats returns weeklySnapshot via aggregateWeeklyPlayerDelta" -- cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js cloudfunctions/points-engine/lib/weekly-delta.js cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js cloudfunctions/points-engine/lib/week-window.js scripts/sync-shared-libs.sh
```

---

## Task 5: `deriveRoundLabel` + `enrichRecent` helpers (TDD)

**Files:**
- Create: `cloudfunctions/points-engine/lib/player-stats.js`
- Create: `cloudfunctions/points-engine/lib/__tests__/player-stats.test.js`

- [ ] **Step 1:** Create the tests:

```js
const { deriveRoundLabel, enrichRecent } = require('../player-stats')

describe('deriveRoundLabel', () => {
  test('regular format → null', () => {
    expect(deriveRoundLabel({ format: 'regular', totalRounds: 5 }, 3)).toBeNull()
  })

  test('knockout final (round === totalRounds) → "F"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 4 }, 4)).toBe('F')
  })

  test('knockout semi (totalRounds - round === 1) → "SF"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 4 }, 3)).toBe('SF')
  })

  test('knockout 1/4 (totalRounds - round === 2) → "QF"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 4 }, 2)).toBe('QF')
  })

  test('knockout earlier rounds → "R<n>"', () => {
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 5 }, 1)).toBe('R1')
    expect(deriveRoundLabel({ format: 'knockout', totalRounds: 5 }, 2)).toBe('R2')
  })

  test('missing tournament → null (defensive)', () => {
    expect(deriveRoundLabel(null, 3)).toBeNull()
  })
})

describe('enrichRecent', () => {
  const tournaments = new Map([
    ['t1', { _id: 't1', name: '春季锦标赛', format: 'knockout', totalRounds: 4 }],
    ['t2', { _id: 't2', name: '五月例赛',   format: 'regular',  totalRounds: 0 }]
  ])
  const members = new Map([
    ['P', { _id: 'P', name: 'p', avatarUrl: '' }],
    ['X', { _id: 'X', name: '张昊', avatarUrl: 'x.png' }],
    ['Y', { _id: 'Y', name: '陈思远', avatarUrl: 'y.png' }]
  ])

  test('knockout SF won → roundLabel="SF", won=true, pointsAwarded from entries[P], opponent=X', () => {
    const row = {
      _id: 'm1', tournamentId: 't1', round: 3,
      score: '6-4, 6-2',
      playerIds: ['P', 'X'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'X', points: 10, role: 'loser' }
      ]},
      confirmedAt: '2026-05-14', createTime: '2026-05-14'
    }
    const out = enrichRecent([row], 'P', tournaments, members)
    expect(out[0]).toMatchObject({
      tournamentId: 't1', tournamentName: '春季锦标赛', tournamentFormat: 'knockout',
      round: 3, roundLabel: 'SF', score: '6-4, 6-2',
      opponentId: 'X', opponentName: '张昊',
      won: true, pointsAwarded: 20,
      confirmedAt: '2026-05-14'
    })
  })

  test('regular loss → roundLabel=null, won=false, opponent inferred from entries', () => {
    const row = {
      _id: 'm2', tournamentId: 't2', round: 1,
      score: '3-6, 4-6',
      playerIds: ['P', 'Y'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 10, role: 'loser' },
        { memberId: 'Y', points: 20, role: 'winner' }
      ]},
      confirmedAt: '2026-05-10', createTime: '2026-05-10'
    }
    const out = enrichRecent([row], 'P', tournaments, members)
    expect(out[0]).toMatchObject({
      roundLabel: null, won: false, opponentId: 'Y', opponentName: '陈思远', pointsAwarded: 10
    })
  })

  test('unknown opponent id → opponentName falls back to id; missing tournament → tournamentName=""', () => {
    const row = {
      _id: 'm3', tournamentId: 't_missing', round: 1, score: '6-0',
      playerIds: ['P', 'Z'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'Z', points: 0,  role: 'loser' }
      ]},
      confirmedAt: null, createTime: '2026-05-09'
    }
    const out = enrichRecent([row], 'P', new Map(), members)
    expect(out[0].opponentName).toBe('Z')
    expect(out[0].tournamentName).toBe('')
    expect(out[0].tournamentFormat).toBeNull()
  })
})
```

- [ ] **Step 2:** Run; confirm failure.
- [ ] **Step 3:** Create `cloudfunctions/points-engine/lib/player-stats.js`:

```js
function deriveRoundLabel(tournament, round) {
  if (!tournament) return null
  if (tournament.format !== 'knockout') return null
  const total = tournament.totalRounds || 0
  if (!round || total <= 0) return null
  const gap = total - round
  if (gap === 0) return 'F'
  if (gap === 1) return 'SF'
  if (gap === 2) return 'QF'
  return `R${round}`
}

function enrichRecent(rows, playerId, tournamentsMap, membersMap) {
  return (rows || []).map(row => {
    const t = tournamentsMap.get(row.tournamentId) || null
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    const mine = entries.find(e => e.memberId === playerId)
    // Opponent: singles = first non-self. Doubles = prefer the first opposite-role entry,
    // so the player's partner (same role) is not displayed as "vs".
    const opponentEntry = row.tournamentType === 'doubles' && mine && mine.role
      ? entries.find(e => e.memberId !== playerId && e.role && e.role !== mine.role)
      : entries.find(e => e.memberId !== playerId)
    const opponentId = opponentEntry ? opponentEntry.memberId : null
    const opponentMember = opponentId ? membersMap.get(opponentId) : null
    return {
      _id: row._id,
      tournamentId: row.tournamentId,
      tournamentName: t ? (t.name || '') : '',
      tournamentFormat: t ? (t.format || null) : null,
      round: row.round,
      roundLabel: deriveRoundLabel(t, row.round),
      score: row.score || '',
      opponentId,
      opponentName: opponentMember ? (opponentMember.name || opponentId) : (opponentId || ''),
      won: mine ? mine.role === 'winner' : false,
      pointsAwarded: mine ? (mine.points || 0) : 0,
      createTime: row.createTime,
      confirmedAt: row.confirmedAt || null
    }
  })
}

module.exports = { deriveRoundLabel, enrichRecent }
```

- [ ] **Step 4:** Run; confirm green.

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/player-stats.test.js --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/lib/player-stats.js cloudfunctions/points-engine/lib/__tests__/player-stats.test.js
git commit -m "feat(points-engine): deriveRoundLabel + enrichRecent helpers (TDD)" -- cloudfunctions/points-engine/lib/player-stats.js cloudfunctions/points-engine/lib/__tests__/player-stats.test.js
```

---

## Task 6: `playerStats.recent` — wire enrichment

**Files:**
- Modify: `cloudfunctions/points-engine/index.js`
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`

- [ ] **Step 1:** Append integration test asserting the page contract:

```js
describe('playerStats.recent enrichment', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.tournaments = cloud.__rows.tournaments || []
    cloud.__rows.tournaments.length = 0
  })

  test('recent rows carry tournamentName/Format, roundLabel, opponent, pointsAwarded, confirmedAt', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'P', name: 'p' }, { _id: 'X', name: '张昊' })
    cloud.__rows.tournaments.push({ _id: 't1', name: '春季锦标赛', format: 'knockout', totalRounds: 4 })
    cloud.__rows.match_results.push({
      _id: 'm1', tournamentId: 't1', round: 3, score: '6-4, 6-2',
      seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      playerIds: ['P', 'X'],
      confirmedAt: '2026-05-14', createTime: '2026-05-14',
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'X', points: 10, role: 'loser' }
      ]}
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.data.recent[0]).toMatchObject({
      tournamentName: '春季锦标赛',
      tournamentFormat: 'knockout',
      roundLabel: 'SF',
      opponentId: 'X',
      opponentName: '张昊',
      won: true,
      pointsAwarded: 20,
      confirmedAt: '2026-05-14'
    })
  })
})
```

(Make sure the mock `wx-server-sdk` `__rows` exposes a `tournaments` collection — extend the mock to include `tournaments` in its `rows` and `collections` map if not already.)

- [ ] **Step 2:** Run; confirm failure (`recent[0]` still raw `match_results` shape).
- [ ] **Step 3:** Edit `playerStatsCompat`. Wrap `fetchRecentForPlayer` with a join+enrich pass:

```js
const { enrichRecent } = require('./lib/player-stats')

// ... within playerStatsCompat, replace `const recent = await fetchRecentForPlayer(playerId)` with:
const rawRecent = await fetchRecentForPlayer(playerId)
const tournamentIds = [...new Set(rawRecent.map(r => r.tournamentId).filter(Boolean))]
const memberIds = [...new Set(rawRecent.flatMap(r => (
  ((r.pointsAwarded && r.pointsAwarded.entries) || []).map(e => e.memberId)
)).filter(Boolean))]
const [tRows, mRows] = await Promise.all([
  tournamentIds.length > 0
    ? db.collection('tournaments').where({ _id: _.in(tournamentIds) }).get().then(r => r.data || [])
    : Promise.resolve([]),
  memberIds.length > 0
    ? db.collection('members').where({ _id: _.in(memberIds) }).get().then(r => r.data || [])
    : Promise.resolve([])
])
const tournamentsMap = new Map(tRows.map(t => [t._id, t]))
const membersMap = new Map(mRows.map(m => [m._id, m]))
const recent = enrichRecent(rawRecent, playerId, tournamentsMap, membersMap)
```

- [ ] **Step 4:** Run all `cloudfunctions/points-engine` tests; confirm green.

```bash
cd cloudfunctions/points-engine && npx jest --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
git commit -m "feat(points-engine): playerStats.recent enriched with tournament/opponent/roundLabel" -- cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
```

---

## Task 7: `resolveOpponentIds` + `computeH2H` helpers (TDD)

**Files:**
- Create: `cloudfunctions/points-engine/lib/player-h2h.js`
- Create: `cloudfunctions/points-engine/lib/__tests__/player-h2h.test.js`

- [ ] **Step 1:** Create the tests:

```js
const { resolveOpponentIds, computeH2H } = require('../player-h2h')

describe('resolveOpponentIds', () => {
  test('singles: opponent = the one non-self entry', () => {
    const row = {
      tournamentType: 'singles',
      playerIds: ['P', 'X'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'X', points: 10, role: 'loser' }
      ]}
    }
    expect(resolveOpponentIds(row, 'P')).toEqual(['X'])
  })

  test('doubles with team metadata: opponents = the two non-team members', () => {
    // Per spec §5.5: only act when teams can be unambiguously distinguished.
    // Convention used here: pointsAwarded.entries[i].team in {1, 2}.
    const row = {
      tournamentType: 'doubles',
      playerIds: ['P', 'M', 'X', 'Y'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 15, role: 'winner', team: 1 },
        { memberId: 'M', points: 15, role: 'winner', team: 1 },
        { memberId: 'X', points: 5,  role: 'loser',  team: 2 },
        { memberId: 'Y', points: 5,  role: 'loser',  team: 2 }
      ]}
    }
    expect(resolveOpponentIds(row, 'P').sort()).toEqual(['X', 'Y'])
  })

  test('doubles without team metadata but with winner/loser roles → opponents = opposite-role members', () => {
    const row = {
      tournamentType: 'doubles',
      playerIds: ['P', 'M', 'X', 'Y'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 15, role: 'winner' },
        { memberId: 'M', points: 15, role: 'winner' },
        { memberId: 'X', points: 5,  role: 'loser'  },
        { memberId: 'Y', points: 5,  role: 'loser'  }
      ]}
    }
    expect(resolveOpponentIds(row, 'P').sort()).toEqual(['X', 'Y'])
  })

  test('doubles without team metadata or roles → returns [] (cannot disambiguate)', () => {
    const row = {
      tournamentType: 'doubles',
      playerIds: ['P', 'M', 'X', 'Y'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 15 },
        { memberId: 'M', points: 15 },
        { memberId: 'X', points: 5  },
        { memberId: 'Y', points: 5  }
      ]}
    }
    expect(resolveOpponentIds(row, 'P')).toEqual([])
  })
})

describe('computeH2H', () => {
  test('aggregates wins/losses against each opponent and sorts by (wins+losses) DESC', () => {
    const rows = [
      { tournamentType: 'singles', playerIds: ['P', 'A'],
        confirmedAt: '2026-05-10',
        pointsAwarded: { entries: [
          { memberId: 'P', points: 20, role: 'winner' },
          { memberId: 'A', points: 10, role: 'loser' }
        ]}},
      { tournamentType: 'singles', playerIds: ['P', 'A'],
        confirmedAt: '2026-05-12',
        pointsAwarded: { entries: [
          { memberId: 'P', points: 10, role: 'loser' },
          { memberId: 'A', points: 20, role: 'winner' }
        ]}},
      { tournamentType: 'singles', playerIds: ['P', 'B'],
        confirmedAt: '2026-05-13',
        pointsAwarded: { entries: [
          { memberId: 'P', points: 20, role: 'winner' },
          { memberId: 'B', points: 10, role: 'loser' }
        ]}}
    ]
    const members = new Map([
      ['A', { _id: 'A', name: '甲', avatarUrl: 'a.png' }],
      ['B', { _id: 'B', name: '乙', avatarUrl: 'b.png' }]
    ])
    const out = computeH2H(rows, 'P', members)
    expect(out).toEqual([
      { memberId: 'A', name: '甲', avatarUrl: 'a.png', wins: 1, losses: 1, lastPlayedAt: '2026-05-12' },
      { memberId: 'B', name: '乙', avatarUrl: 'b.png', wins: 1, losses: 0, lastPlayedAt: '2026-05-13' }
    ])
  })

  test('empty rows → []', () => {
    expect(computeH2H([], 'P', new Map())).toEqual([])
  })

  test('unknown member fallback: name === id when not in membersMap', () => {
    const rows = [
      { tournamentType: 'singles', playerIds: ['P', 'GHOST'],
        confirmedAt: '2026-05-10',
        pointsAwarded: { entries: [
          { memberId: 'P', points: 20, role: 'winner' },
          { memberId: 'GHOST', points: 10, role: 'loser' }
        ]}}
    ]
    const out = computeH2H(rows, 'P', new Map())
    expect(out[0]).toMatchObject({ memberId: 'GHOST', name: 'GHOST' })
  })

  test('lastPlayedAt uses confirmedAt; falls back to createTime when confirmedAt missing', () => {
    const rows = [
      { tournamentType: 'singles', playerIds: ['P', 'A'],
        confirmedAt: null, createTime: '2026-05-09',
        pointsAwarded: { entries: [
          { memberId: 'P', points: 20, role: 'winner' },
          { memberId: 'A', points: 10, role: 'loser' }
        ]}}
    ]
    const out = computeH2H(rows, 'P', new Map([['A', { _id: 'A', name: 'a' }]]))
    expect(out[0].lastPlayedAt).toBe('2026-05-09')
  })
})
```

- [ ] **Step 2:** Run; confirm failure.
- [ ] **Step 3:** Implement `cloudfunctions/points-engine/lib/player-h2h.js`:

```js
function resolveOpponentIds(row, playerId) {
  const type = row.tournamentType
  const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
  if (type === 'singles') {
    return entries.filter(e => e.memberId !== playerId).map(e => e.memberId)
  }
  if (type === 'doubles') {
    const mine = entries.find(e => e.memberId === playerId)
    if (!mine) return []
    if (mine.team != null) {
      return entries.filter(e => e.team != null && e.team !== mine.team).map(e => e.memberId)
    }
    if (mine.role) {
      const opponents = entries.filter(e => e.memberId !== playerId && e.role && e.role !== mine.role).map(e => e.memberId)
      return opponents.length > 0 ? opponents : []
    }
    return []   // cannot disambiguate without team metadata or winner/loser role
  }
  return []
}

function computeH2H(rows, playerId, membersMap) {
  const byOpp = new Map()
  for (const row of rows || []) {
    const mineEntry = ((row.pointsAwarded && row.pointsAwarded.entries) || []).find(e => e.memberId === playerId)
    if (!mineEntry) continue
    const opponentIds = resolveOpponentIds(row, playerId)
    const ts = row.confirmedAt || row.createTime || null
    for (const oppId of opponentIds) {
      const cur = byOpp.get(oppId) || { memberId: oppId, name: null, avatarUrl: null, wins: 0, losses: 0, lastPlayedAt: null }
      if (mineEntry.role === 'winner') cur.wins += 1
      else if (mineEntry.role === 'loser') cur.losses += 1
      if (!cur.lastPlayedAt || (ts && ts > cur.lastPlayedAt)) cur.lastPlayedAt = ts
      byOpp.set(oppId, cur)
    }
  }
  return [...byOpp.values()].map(row => {
    const m = membersMap.get(row.memberId)
    return {
      memberId: row.memberId,
      name: (m && m.name) || row.memberId,
      avatarUrl: (m && m.avatarUrl) || '',
      wins: row.wins, losses: row.losses, lastPlayedAt: row.lastPlayedAt
    }
  }).sort((a, b) => {
    const sa = a.wins + a.losses
    const sb = b.wins + b.losses
    if (sb !== sa) return sb - sa
    return a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0
  })
}

module.exports = { resolveOpponentIds, computeH2H }
```

- [ ] **Step 4:** Run; confirm green.
- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/lib/player-h2h.js cloudfunctions/points-engine/lib/__tests__/player-h2h.test.js
git commit -m "feat(points-engine): resolveOpponentIds + computeH2H helpers (TDD)" -- cloudfunctions/points-engine/lib/player-h2h.js cloudfunctions/points-engine/lib/__tests__/player-h2h.test.js
```

---

## Task 8: `playerH2H` action — wire to cloud function (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/index.js`
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`

- [ ] **Step 1:** Append integration test:

```js
describe('playerH2H action', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
  })

  test('returns { singles: [...], doubles: [...] } shaped per spec', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: '甲', avatarUrl: 'a' }, { _id: 'P', name: 'p' })
    cloud.__rows.match_results.push({
      _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: '2026-05-10', createTime: '2026-05-10', playerIds: ['P', 'A'],
      pointsAwarded: { entries: [
        { memberId: 'P', points: 20, role: 'winner' },
        { memberId: 'A', points: 10, role: 'loser' }
      ]}
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', playerId: 'P', currentSeasonId: 's2026' })
    expect(res.success).toBe(true)
    expect(res.data.singles).toEqual([
      { memberId: 'A', name: '甲', avatarUrl: 'a', wins: 1, losses: 0, lastPlayedAt: '2026-05-10' }
    ])
    expect(res.data.doubles).toEqual([])
  })

  test('missing playerId → INVALID_ARG', async () => {
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', currentSeasonId: 's2026' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('INVALID_ARG')
  })

  test('non-existent playerId → NOT_FOUND', async () => {
    const { main } = require('../index')
    const res = await main({ action: 'playerH2H', playerId: 'GHOST', currentSeasonId: 's2026' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })
})
```

- [ ] **Step 2:** Run; confirm failure (unknown action).
- [ ] **Step 3:** Edit `cloudfunctions/points-engine/index.js`:

Add at the top:

```js
const { computeH2H } = require('./lib/player-h2h')
```

Add the action route near the existing routes (around line 17):

```js
if (action === 'playerH2H')        return await playerH2HCompat(event)
```

Add the function:

```js
async function playerH2HCompat({ playerId, currentSeasonId }) {
  if (!playerId) return { success: false, error: { code: 'INVALID_ARG', message: 'playerId 必填' } }
  if (!currentSeasonId) return { success: true, data: { singles: [], doubles: [] } }

  const memberRes = await db.collection('members').doc(playerId).get().catch(() => ({ data: null }))
  if (!memberRes || !memberRes.data) {
    return { success: false, error: { code: 'NOT_FOUND', message: playerId } }
  }

  // Fetch all confirmed matches in current season where player participated
  let rows = []
  try {
    rows = (await db.collection('match_results')
      .where({ seasonId: currentSeasonId, resultStatus: 'confirmed', playerIds: _.in([playerId]) })
      .limit(1000)
      .get()).data || []
  } catch (e) {
    rows = []
  }

  // Resolve all opponent memberIds for join
  const allOpponentIds = new Set()
  for (const r of rows) {
    const entries = (r.pointsAwarded && r.pointsAwarded.entries) || []
    for (const e of entries) if (e.memberId !== playerId) allOpponentIds.add(e.memberId)
  }
  const membersMap = new Map()
  if (allOpponentIds.size > 0) {
    const ids = [...allOpponentIds]
    // Chunk to avoid potential _.in size limits
    const chunkSize = 50
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize)
      const r = await db.collection('members').where({ _id: _.in(chunk) }).get()
      for (const m of (r.data || [])) membersMap.set(m._id, m)
    }
  }

  const singlesRows = rows.filter(r => r.tournamentType === 'singles')
  const doublesRows = rows.filter(r => r.tournamentType === 'doubles')
  return {
    success: true,
    data: {
      singles: computeH2H(singlesRows, playerId, membersMap),
      doubles: computeH2H(doublesRows, playerId, membersMap)
    }
  }
}
```

- [ ] **Step 4:** Run; confirm green.

```bash
cd cloudfunctions/points-engine && npx jest --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
git commit -m "feat(points-engine): playerH2H action (singles + doubles when team metadata present)" -- cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
```

---

## Task 9: `rank-chart` component

**Files:**
- Create: `miniprogram/components/rank-chart/index.js`
- Create: `miniprogram/components/rank-chart/index.json`
- Create: `miniprogram/components/rank-chart/index.wxml`
- Create: `miniprogram/components/rank-chart/index.wxss`

- [ ] **Step 1:** Create `index.json`:

```json
{ "component": true }
```

- [ ] **Step 2:** Create `index.js`. The component takes `data: [{weekStart, rank}]` (≥ 0 length), computes chart points in `observers`, initializes the canvas in `ready()`, and redraws after data changes. Pure transform — no API:

```js
Component({
  properties: {
    data: {
      type: Array,
      value: []
    },
    height: { type: Number, value: 100 },   // viewBox height (no unit)
    width:  { type: Number, value: 320 },   // viewBox width
    color:  { type: String, value: '#0A0A0A' }
  },
  data: {
    points: '',
    endX: 0, endY: 0, endRank: null, endLabelStyle: '',
    hasEnoughData: false
  },
  lifetimes: {
    attached() { this.recompute() },
    ready() { this.initCanvas() }
  },
  observers: {
    'data, width, height, color': function() {
      this.recompute()
    }
  },
  methods: {
    initCanvas() {
      const query = this.createSelectorQuery()
      query.select('#rank-chart-canvas').fields({ node: true, size: true }).exec(res => {
        const meta = res && res[0]
        const canvas = meta && meta.node
        if (!canvas) return
        const dpr = wx.getSystemInfoSync().pixelRatio || 1
        canvas.width = meta.width * dpr
        canvas.height = meta.height * dpr
        const ctx = canvas.getContext('2d')
        ctx.scale(dpr, dpr)
        this._ctx = ctx
        this._cw = meta.width
        this._ch = meta.height
        this.draw()
      })
    },
    recompute() {
      const data = this.data.data || []
      if (data.length < 2) {
        this.setData({ hasEnoughData: false, points: '', endRank: null, endLabelStyle: '' }, () => this.draw())
        return
      }
      const W = this.data.width
      const H = this.data.height
      const padX = 12
      const padY = 12
      const ranks = data.map(d => d.rank).filter(r => r != null)
      const maxRank = Math.max(...ranks)
      const minRank = Math.min(...ranks)
      const span = Math.max(1, maxRank - minRank)
      const innerW = W - padX * 2
      const innerH = H - padY * 2
      const points = data.map((d, i) => {
        const x = padX + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1))
        // smaller rank = better → higher visually (smaller y)
        const yNorm = (d.rank - minRank) / span      // 0 for best
        const y = padY + yNorm * innerH
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      const lastIdx = data.length - 1
      const [endX, endY] = points[lastIdx].split(',').map(Number)
      this.setData({
        hasEnoughData: true,
        points: points.join(' '),
        endX, endY,
        endRank: data[lastIdx].rank,
        endLabelStyle: `left: ${(endX / W * 100).toFixed(2)}%; top: ${(endY / H * 100).toFixed(2)}%;`
      }, () => this.draw())
    },
    draw() {
      const ctx = this._ctx
      const w = this._cw
      const h = this._ch
      if (!ctx || !w || !h) return
      ctx.clearRect(0, 0, w, h)
      if (!this.data.hasEnoughData) return

      ctx.strokeStyle = '#E5E7EB'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      for (const ratio of [0.2, 0.5, 0.8]) {
        const y = ratio * h
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(w, y)
        ctx.stroke()
      }
      ctx.setLineDash([])

      ctx.strokeStyle = this.data.color
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      const pts = this.data.points.split(' ').map(p => p.split(',').map(Number))
      const sx = w / this.data.width
      const sy = h / this.data.height
      ctx.beginPath()
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = pts[i]
        if (i === 0) ctx.moveTo(x * sx, y * sy)
        else ctx.lineTo(x * sx, y * sy)
      }
      ctx.stroke()

      const [ex, ey] = pts[pts.length - 1]
      ctx.beginPath()
      ctx.arc(ex * sx, ey * sy, 5, 0, Math.PI * 2)
      ctx.fillStyle = '#BEE645'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#0A0A0A'
      ctx.stroke()
    }
  }
})
```

- [ ] **Step 3:** Create `index.wxml`:

```xml
<view class="rank-chart">
  <view wx:if="{{!hasEnoughData}}" class="chart-empty">
    <text class="chart-empty-text">数据不足</text>
  </view>
  <view wx:else class="chart-svg-wrap">
    <canvas
      type="2d"
      id="rank-chart-canvas"
      class="rank-chart-canvas"
      style="height: {{height}}rpx;"
    />
    <text class="end-label" style="{{endLabelStyle}}">#{{endRank}}</text>
  </view>
</view>
```

> Implementation note: Mini Program WXML does not parse inline `<svg>` tags directly. Use `<canvas type="2d">` and initialize it from component `ready()` via `createSelectorQuery().fields({ node: true, size: true })`; do not rely on a canvas `bind:ready` event.

- [ ] **Step 4:** Create `index.wxss`:

```css
.rank-chart {
  background: var(--color-bg-2, #FAFAFA);
  border: 1rpx solid var(--color-border, #E5E7EB);
  border-radius: 24rpx;
  padding: 24rpx;
  position: relative;
}
.rank-chart-canvas {
  display: block;
  width: 100%;
}
.chart-svg-wrap { position: relative; }
.chart-empty {
  height: 200rpx;
  display: flex; align-items: center; justify-content: center;
}
.chart-empty-text { color: var(--color-muted-2, #9CA3AF); font-size: 24rpx; }
.end-label {
  position: absolute;
  font-size: 20rpx;
  font-weight: 700;
  color: var(--color-ink, #0A0A0A);
  background: rgba(255,255,255,0.85);
  padding: 0 6rpx;
  border-radius: 4rpx;
  pointer-events: none;
  transform: translate(-50%, -120%);
}
```

- [ ] **Step 5:** Smoke-test in DevTools: mount this component inside a scratch page with `data=[{weekStart:'2026-02-23',rank:6},{weekStart:'2026-03-02',rank:5},...]`, verify line draws and end dot/label appear. Edge cases:
  - `data=[]` → "数据不足"
  - `data=[one point]` → "数据不足"

- [ ] **Step 6:** Commit.

```bash
git add miniprogram/components/rank-chart
git commit -m "feat(rank-chart): canvas polyline component (gridlines + lime end-dot)" -- miniprogram/components/rank-chart/index.js miniprogram/components/rank-chart/index.json miniprogram/components/rank-chart/index.wxml miniprogram/components/rank-chart/index.wxss
```

---

## Task 10: `h2h-row` component

**Files:**
- Create: `miniprogram/components/h2h-row/index.js`
- Create: `miniprogram/components/h2h-row/index.json`
- Create: `miniprogram/components/h2h-row/index.wxml`
- Create: `miniprogram/components/h2h-row/index.wxss`

- [ ] **Step 1:** Create `index.json`:

```json
{ "component": true }
```

- [ ] **Step 2:** Create `index.js`:

```js
Component({
  properties: {
    playerId:  String,
    name:      String,
    avatarUrl: String,
    wins:      { type: Number, value: 0 },
    losses:    { type: Number, value: 0 }
  },
  data: {
    pillClass: 'neutral',
    record: '0-0'
  },
  observers: {
    'wins, losses': function(wins, losses) {
      let pillClass = 'neutral'
      if (wins > losses) pillClass = 'win'
      else if (losses > wins) pillClass = 'loss'
      this.setData({ pillClass, record: `${wins}-${losses}` })
    }
  },
  methods: {
    onTap() {
      if (!this.data.playerId) return
      this.triggerEvent('tap', { playerId: this.data.playerId })
    }
  }
})
```

- [ ] **Step 3:** Create `index.wxml`:

```xml
<view class="h2h-row" bindtap="onTap">
  <image class="avatar" src="{{avatarUrl || '/images/icons/avatar.png'}}" mode="aspectFill" />
  <text class="name">{{name}}</text>
  <text class="pill pill-{{pillClass}} num">{{record}}</text>
  <text class="arrow">→</text>
</view>
```

- [ ] **Step 4:** Create `index.wxss`:

```css
.h2h-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 16rpx 0;
  border-bottom: 1rpx solid var(--color-bg-3, #F3F4F6);
}
.h2h-row .avatar {
  width: 56rpx; height: 56rpx; border-radius: 50%;
  background: var(--color-bg-3, #F3F4F6);
}
.h2h-row .name {
  flex: 1; min-width: 0;
  font-size: 28rpx; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.h2h-row .pill {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  font-size: 24rpx; font-weight: 700;
  color: var(--color-ink, #0A0A0A);
  background: var(--color-bg-3, #F3F4F6);
}
.h2h-row .pill-win  { background: #DDF099; }
.h2h-row .pill-loss { background: #FEE2E2; color: var(--color-danger, #DC2626); }
.h2h-row .arrow { font-size: 28rpx; color: var(--color-muted-2, #9CA3AF); }
```

- [ ] **Step 5:** Smoke test in DevTools: mount with wins=3 losses=0 (lime pill), wins=1 losses=3 (red pill), wins=1 losses=1 (neutral). Tap fires event with `playerId`.

- [ ] **Step 6:** Commit.

```bash
git add miniprogram/components/h2h-row
git commit -m "feat(h2h-row): tappable opponent row with win/loss pill" -- miniprogram/components/h2h-row/index.js miniprogram/components/h2h-row/index.json miniprogram/components/h2h-row/index.wxml miniprogram/components/h2h-row/index.wxss
```

---

## Task 11: `player-detail` — load `playerH2H` + extend page data

**Files:**
- Modify: `miniprogram/pages/player-detail/index.js`
- Modify: `miniprogram/pages/player-detail/index.json`

- [ ] **Step 1:** Update `index.json` to register the two new components:

```json
{
  "usingComponents": {
    "skeleton-loader": "/components/skeleton-loader/index",
    "rank-chart": "/components/rank-chart/index",
    "h2h-row": "/components/h2h-row/index"
  },
  "navigationBarTitleText": "球员详情"
}
```

(Preserve any existing entries — only add the two new lines.)

- [ ] **Step 2:** Replace `pages/player-detail/index.js` with a version that parallel-loads all 3 endpoints and derives display strings up-front. Keep existing skeleton/empty handling intact:

```js
const { callFunction } = require('../../utils/cloud')

const PLAY_STYLE_LABEL = {
  baseliner: '底线型',
  'serve-volleyer': '发球上网',
  'all-court': '全场型',
  'counter-puncher': '反击型',
  'aggressive-baseliner': '进攻底线型'
}

const H2H_DEFAULT_VISIBLE = 5

Page({
  data: {
    playerId: '',
    player: null,
    stats: null,
    currentRank: { singles: null, doubles: null },
    rankHistory: { singles: [], doubles: [] },
    weeklySnapshot: { singles: null, doubles: null },
    recent: [],
    h2h: { singles: [], doubles: [] },
    h2hExpanded: { singles: false, doubles: false },
    seasonYear: new Date().getFullYear(),
    loading: false,
    // derived strings (computed once in setStateFromResponses)
    rankSubtitle: '',
    playStyleLabel: '',
    singlesPct: '—',
    doublesPct: '—',
    hasDoubles: false
  },

  async onLoad(query) {
    const playerId = query && query.id
    if (!playerId) {
      wx.showToast({ title: '参数错误', icon: 'none' })
      return
    }
    this.setData({ playerId })
    await this.loadAll(playerId)
  },

  async loadAll(playerId) {
    this.setData({ loading: true })
    const seasonId = this._getCurrentSeasonId()
    try {
      const [playerRes, statsRes, h2hRes] = await Promise.all([
        callFunction({ name: 'members',       data: { action: 'getById', _id: playerId } }),
        callFunction({ name: 'points-engine', data: { action: 'playerStats', playerId, currentSeasonId: seasonId } }),
        callFunction({ name: 'points-engine', data: { action: 'playerH2H',  playerId, currentSeasonId: seasonId } })
      ])
      const player = (playerRes && playerRes.result && playerRes.result.data) || null
      const statsData = (statsRes && statsRes.result && statsRes.result.data) || {}
      const h2hData = (h2hRes && h2hRes.result && h2hRes.result.data) || { singles: [], doubles: [] }
      this.setStateFromResponses({ player, statsData, h2hData })
    } catch (err) {
      console.error('[player-detail] loadAll', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  setStateFromResponses({ player, statsData, h2hData }) {
    const stats = statsData.stats || {
      singles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 },
      doubles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 }
    }
    const currentRank = statsData.currentRank || { singles: null, doubles: null }
    const rankHistory = statsData.rankHistory || { singles: [], doubles: [] }
    const weeklySnapshot = statsData.weeklySnapshot || { singles: null, doubles: null }
    const recent = statsData.recent || []

    const seasonYear = this.data.seasonYear
    const rankSubtitle = `S${seasonYear} · 单打 ${currentRank.singles != null ? '#' + currentRank.singles : '未上榜'} · 双打 ${currentRank.doubles != null ? '#' + currentRank.doubles : '未上榜'}`
    const playStyleLabel = (player && player.playStyle && PLAY_STYLE_LABEL[player.playStyle]) || (player && player.playStyle) || '打法未设置'
    const fmt = (b) => {
      const matches = (b.winCount || 0) + (b.lossCount || 0)
      return matches > 0 ? Math.round(b.winRate * 100) + '%' : '—'
    }
    const hasDoubles = (stats.doubles.winCount + stats.doubles.lossCount) > 0
      || (h2hData.doubles && h2hData.doubles.length > 0)
      || (rankHistory.doubles && rankHistory.doubles.length > 0)

    this.setData({
      player, stats, currentRank, rankHistory, weeklySnapshot, recent,
      h2h: h2hData,
      rankSubtitle, playStyleLabel,
      singlesPct: fmt(stats.singles), doublesPct: fmt(stats.doubles),
      hasDoubles
    })
  },

  _getCurrentSeasonId() {
    // Match the current rank/home pages and DATABASE_SCHEMA convention.
    return `season_${this.data.seasonYear}`
  },

  onH2HTap(e) {
    const playerId = e.detail && e.detail.playerId
    if (!playerId) return
    wx.navigateTo({ url: `/pages/player-detail/index?id=${playerId}` })
  },

  toggleH2HExpanded(e) {
    const type = e.currentTarget.dataset.type
    if (type !== 'singles' && type !== 'doubles') return
    const next = { ...this.data.h2hExpanded, [type]: !this.data.h2hExpanded[type] }
    this.setData({ h2hExpanded: next })
  },

})
```

**Also add** to the `data` object at the top: `h2hVisible: { singles: [], doubles: [] }` and `h2hDefaultVisible: H2H_DEFAULT_VISIBLE`. **Replace** `setStateFromResponses` to also compute the visible slice in one go:

```js
setStateFromResponses({ player, statsData, h2hData }) {
  const stats = statsData.stats || {
    singles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 },
    doubles: { winCount: 0, lossCount: 0, totalPoints: 0, winRate: 0 }
  }
  const currentRank = statsData.currentRank || { singles: null, doubles: null }
  const rankHistory = statsData.rankHistory || { singles: [], doubles: [] }
  const weeklySnapshot = statsData.weeklySnapshot || { singles: null, doubles: null }
  const recent = statsData.recent || []

  const seasonYear = this.data.seasonYear
  const rankSubtitle = `S${seasonYear} · 单打 ${currentRank.singles != null ? '#' + currentRank.singles : '未上榜'} · 双打 ${currentRank.doubles != null ? '#' + currentRank.doubles : '未上榜'}`
  const playStyleLabel = (player && player.playStyle && PLAY_STYLE_LABEL[player.playStyle]) || (player && player.playStyle) || '打法未设置'
  const fmt = (b) => {
    const matches = (b.winCount || 0) + (b.lossCount || 0)
    return matches > 0 ? Math.round(b.winRate * 100) + '%' : '—'
  }
  const hasDoubles = (stats.doubles.winCount + stats.doubles.lossCount) > 0
    || (h2hData.doubles && h2hData.doubles.length > 0)
    || (rankHistory.doubles && rankHistory.doubles.length > 0)

  const slice = (arr, expanded) => expanded ? arr : arr.slice(0, H2H_DEFAULT_VISIBLE)
  const h2hVisible = {
    singles: slice(h2hData.singles || [], this.data.h2hExpanded.singles),
    doubles: slice(h2hData.doubles || [], this.data.h2hExpanded.doubles)
  }

  this.setData({
    player, stats, currentRank, rankHistory, weeklySnapshot, recent,
    h2h: h2hData, h2hVisible,
    rankSubtitle, playStyleLabel,
    singlesPct: fmt(stats.singles), doublesPct: fmt(stats.doubles),
    hasDoubles
  })
}
```

- [ ] **Step 3:** Commit (page still old WXML — next tasks build the layout).

```bash
git add miniprogram/pages/player-detail/index.js miniprogram/pages/player-detail/index.json
git commit -m "feat(player-detail): parallel-load playerStats + playerH2H, derive page data" -- miniprogram/pages/player-detail/index.js miniprogram/pages/player-detail/index.json
```

---

## Task 12: `player-detail` WXML — HERO + ABOUT + stats (× 2)

**Files:**
- Modify: `miniprogram/pages/player-detail/index.wxml`
- Modify: `miniprogram/pages/player-detail/index.wxss`

- [ ] **Step 1:** Read the current WXML (post-visual-revamp) to preserve hero/about/section structure. The hero section currently shows tape + avatar + name + playStyle pill — extend it to also include `rankSubtitle` between name and playStyle pill:

```xml
<!-- HERO -->
<view class="pd-hero anim-stage-rise">
  <view class="pd-hero-tapes">
    <text class="tape tape-stamped">PLAYER · 球员档案</text>
  </view>
  <view class="pd-hero-main">
    <view class="pd-avatar-wrap">
      <image class="pd-avatar" src="{{(player && player.avatarUrl) || '/images/icons/usercenter.png'}}" mode="aspectFill" />
    </view>
    <view class="pd-hero-info">
      <text class="pd-name">{{player && player.name}}</text>
      <text class="pd-rank-subtitle">{{rankSubtitle}}</text>
      <view class="pd-meta">
        <text class="pd-style-pill">{{playStyleLabel}}</text>
      </view>
    </view>
  </view>
</view>
```

- [ ] **Step 2:** Update the SINGLES stat section. Replace the existing 3-card block (currently `MATCHES / WINS / POINTS`) with the spec-mandated cards (`胜场/总 · 胜率 · 积分`):

```xml
<view wx:if="{{stats}}" class="pd-section anim-stage-rise anim-delay-2">
  <view class="pd-section-head">
    <text class="tape tape-lime tape-stamped-lime">SINGLES · 单打</text>
  </view>
  <view class="pd-stats-row">
    <view class="pd-stat pd-stat-paper">
      <text class="pd-stat-num num">{{stats.singles.winCount}}<text class="pd-stat-denom">/{{stats.singles.winCount + stats.singles.lossCount}}</text></text>
      <text class="pd-stat-label">胜场/总</text>
    </view>
    <view class="pd-stat pd-stat-lime">
      <text class="pd-stat-num num">{{singlesPct}}</text>
      <text class="pd-stat-label">胜率</text>
    </view>
    <view class="pd-stat pd-stat-ink">
      <text class="pd-stat-num num">{{stats.singles.totalPoints}}</text>
      <text class="pd-stat-label">积分</text>
    </view>
  </view>
</view>
```

- [ ] **Step 3:** Update the DOUBLES section similarly (wrap with `wx:if="{{hasDoubles}}"`); use the existing ghost tape variant if defined, and a different card background palette to visually distinguish from singles:

```xml
<view wx:if="{{stats && hasDoubles}}" class="pd-section anim-stage-rise anim-delay-3">
  <view class="pd-section-head">
    <text class="tape tape-ghost">DOUBLES · 双打</text>
  </view>
  <view class="pd-stats-row">
    <view class="pd-stat pd-stat-paper">
      <text class="pd-stat-num num">{{stats.doubles.winCount}}<text class="pd-stat-denom">/{{stats.doubles.winCount + stats.doubles.lossCount}}</text></text>
      <text class="pd-stat-label">胜场/总</text>
    </view>
    <view class="pd-stat pd-stat-paper-alt">
      <text class="pd-stat-num num">{{doublesPct}}</text>
      <text class="pd-stat-label">胜率</text>
    </view>
    <view class="pd-stat pd-stat-paper-alt">
      <text class="pd-stat-num num">{{stats.doubles.totalPoints}}</text>
      <text class="pd-stat-label">积分</text>
    </view>
  </view>
</view>
```

- [ ] **Step 4:** In `index.wxss`, add:

```css
.pd-rank-subtitle {
  display: block;
  margin-top: 4rpx;
  font-size: 22rpx;
  color: var(--color-muted, #6B7280);
  letter-spacing: 0.02em;
}
.pd-stat-denom {
  font-size: 22rpx;
  color: var(--color-muted-2, #9CA3AF);
  font-weight: 700;
}
.pd-style-pill {
  display: inline-block;
  margin-top: 8rpx;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  background: var(--color-bg-3, #F3F4F6);
  border: 1rpx solid var(--color-border, #E5E7EB);
  font-size: 22rpx;
  font-weight: 600;
}
/* Preserve existing pd-stat-paper / pd-stat-lime / pd-stat-ink / pd-stat-paper-alt styles from visual revamp */
```

- [ ] **Step 5:** Smoke test in DevTools (use any existing player with confirmed matches): verify hero subtitle shows `S2026 · 单打 #N · 双打 #M`, 3 cards rendered for singles, doubles section hidden when player has no doubles.

- [ ] **Step 6:** Commit.

```bash
git add miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss
git commit -m "feat(player-detail): hero rank subtitle + 3-card stats (singles/doubles)" -- miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss
```

---

## Task 13: `player-detail` — rank-chart × 2 sections

**Files:**
- Modify: `miniprogram/pages/player-detail/index.wxml`
- Modify: `miniprogram/pages/player-detail/index.wxss`

- [ ] **Step 1:** Append two rank-chart sections (singles section always renders so empty/new players see "数据不足"; doubles only if data exists and `hasDoubles` true):

```xml
<view class="pd-section anim-stage-rise anim-delay-4">
  <view class="pd-section-head">
    <text class="tape">排名走势 · 单打 · 12周</text>
  </view>
  <rank-chart data="{{rankHistory.singles}}" />
  <view wx:if="{{rankHistory.singles.length >= 2}}" class="pd-chart-meta">
    <text>越靠上名次越好 · {{rankHistory.singles.length}} 周</text>
  </view>
</view>

<view wx:if="{{hasDoubles && rankHistory.doubles.length > 0}}" class="pd-section anim-stage-rise anim-delay-4">
  <view class="pd-section-head">
    <text class="tape">排名走势 · 双打 · 12周</text>
  </view>
  <rank-chart data="{{rankHistory.doubles}}" />
  <view wx:if="{{rankHistory.doubles.length >= 2}}" class="pd-chart-meta">
    <text>越靠上名次越好 · {{rankHistory.doubles.length}} 周</text>
  </view>
</view>
```

- [ ] **Step 2:** In `index.wxss`:

```css
.pd-chart-meta {
  margin-top: 12rpx;
  font-size: 20rpx;
  color: var(--color-muted-2, #9CA3AF);
}
```

- [ ] **Step 3:** Smoke test:
  - Player with ≥ 2 weeks of snapshots → chart renders polyline + end dot + label
  - Player with 1 week → chart shows "数据不足"
  - Player with 0 doubles match → doubles chart section hidden entirely

- [ ] **Step 4:** Commit.

```bash
git add miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss
git commit -m "feat(player-detail): rank-chart sections (singles + doubles, 12 weeks)" -- miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss
```

---

## Task 14: `player-detail` — H2H sections (× 2 with expand-all)

**Files:**
- Modify: `miniprogram/pages/player-detail/index.wxml`
- Modify: `miniprogram/pages/player-detail/index.wxss`

- [ ] **Step 1:** Append H2H sections:

```xml
<view wx:if="{{h2h.singles.length > 0}}" class="pd-section anim-stage-rise anim-delay-5">
  <view class="pd-section-head">
    <text class="tape">交手记录 · H2H · 单打</text>
    <text class="pd-section-count num">{{h2h.singles.length}}</text>
  </view>
  <h2h-row
    wx:for="{{h2hVisible.singles}}" wx:key="memberId"
    player-id="{{item.memberId}}"
    name="{{item.name}}"
    avatar-url="{{item.avatarUrl}}"
    wins="{{item.wins}}"
    losses="{{item.losses}}"
    bind:tap="onH2HTap"
  />
  <view
    wx:if="{{h2h.singles.length > 5 && !h2hExpanded.singles}}"
    class="pd-h2h-expand"
    data-type="singles"
    bindtap="toggleH2HExpanded"
  >
    <text>展开全部 {{h2h.singles.length}} 人 →</text>
  </view>
</view>

<view wx:if="{{hasDoubles && h2h.doubles.length > 0}}" class="pd-section anim-stage-rise anim-delay-5">
  <view class="pd-section-head">
    <text class="tape">交手记录 · H2H · 双打</text>
    <text class="pd-section-count num">{{h2h.doubles.length}}</text>
  </view>
  <h2h-row
    wx:for="{{h2hVisible.doubles}}" wx:key="memberId"
    player-id="{{item.memberId}}"
    name="{{item.name}}"
    avatar-url="{{item.avatarUrl}}"
    wins="{{item.wins}}"
    losses="{{item.losses}}"
    bind:tap="onH2HTap"
  />
  <view
    wx:if="{{h2h.doubles.length > 5 && !h2hExpanded.doubles}}"
    class="pd-h2h-expand"
    data-type="doubles"
    bindtap="toggleH2HExpanded"
  >
    <text>展开全部 {{h2h.doubles.length}} 人 →</text>
  </view>
</view>
```

- [ ] **Step 2:** Update `pages/player-detail/index.js` `toggleH2HExpanded` so it also recomputes `h2hVisible` (use the same `H2H_DEFAULT_VISIBLE` constant from Task 11):

```js
toggleH2HExpanded(e) {
  const type = e.currentTarget.dataset.type
  if (type !== 'singles' && type !== 'doubles') return
  const nextExpanded = { ...this.data.h2hExpanded, [type]: !this.data.h2hExpanded[type] }
  const slice = (arr, expanded) => expanded ? arr : arr.slice(0, H2H_DEFAULT_VISIBLE)
  const nextVisible = {
    singles: slice(this.data.h2h.singles, nextExpanded.singles),
    doubles: slice(this.data.h2h.doubles, nextExpanded.doubles)
  }
  this.setData({ h2hExpanded: nextExpanded, h2hVisible: nextVisible })
}
```

- [ ] **Step 3:** In `index.wxss`:

```css
.pd-h2h-expand {
  margin-top: 16rpx;
  padding: 12rpx 0;
  text-align: center;
  font-size: 24rpx;
  font-weight: 700;
  color: var(--color-ink, #0A0A0A);
  border: 1rpx dashed var(--color-border, #E5E7EB);
  border-radius: 16rpx;
}
```

- [ ] **Step 4:** Smoke test: open any player with > 5 opponents → see 5 rows + expand button → tap → see all rows + button disappears. Tap any row → navigates to that opponent's player-detail.

- [ ] **Step 5:** Commit.

```bash
git add miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss miniprogram/pages/player-detail/index.js
git commit -m "feat(player-detail): H2H sections (top 5 + expand-all) tappable to opponent" -- miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss miniprogram/pages/player-detail/index.js
```

---

## Task 15: `player-detail` — recent matches refactor

**Files:**
- Modify: `miniprogram/pages/player-detail/index.wxml`
- Modify: `miniprogram/pages/player-detail/index.wxss`

- [ ] **Step 1:** Replace the existing recent matches block (currently shows `R{round}` + tournamentName + status badge). New structure shows `roundLabel` (or `常规赛` for regular) + tournamentName + date / score + opponent + `+points` pill — no status badge:

```xml
<view class="pd-section anim-stage-rise anim-delay-6">
  <view class="pd-section-head">
    <text class="tape">最近比赛 · RECENT</text>
    <text wx:if="{{recent.length}}" class="pd-section-count num">{{recent.length}}</text>
  </view>
  <view wx:if="{{recent.length > 0}}" class="pd-recent-list">
    <view wx:for="{{recent}}" wx:key="_id" class="pd-recent-row">
      <view class="pd-recent-top">
        <text class="pd-recent-badge {{item.tournamentFormat === 'regular' ? 'reg' : ''}}">
          {{item.tournamentFormat === 'regular' ? '常规赛' : (item.roundLabel || ('R' + item.round))}}
        </text>
        <text class="pd-recent-tour">{{item.tournamentName}}</text>
        <text class="pd-recent-date">{{item.confirmedAt || item.createTime}}</text>
      </view>
      <view class="pd-recent-result">
        <view class="pd-recent-result-left">
          <text class="pd-recent-score num">{{item.score}}</text>
          <text class="pd-recent-opp"> vs {{item.opponentName}}</text>
        </view>
        <text class="pd-recent-points {{item.won ? 'win' : 'loss'}} num">+{{item.pointsAwarded}}</text>
      </view>
    </view>
  </view>
  <view wx:else class="pd-recent-empty">
    <text>暂无近期比赛</text>
  </view>
</view>
```

- [ ] **Step 2:** Remove any legacy CSS rules in `index.wxss` matching `.pd-recent-status`, `.status-confirmed`, `.status-submitted`, `.status-disputed`, `.status-pending` — these belong to the dropped status badge. Add new styles:

```css
.pd-recent-row { padding: 16rpx 0; border-bottom: 1rpx solid var(--color-bg-3, #F3F4F6); }
.pd-recent-top { display: flex; align-items: center; gap: 12rpx; font-size: 22rpx; color: var(--color-muted, #6B7280); }
.pd-recent-badge {
  background: var(--color-ink, #0A0A0A); color: #FFFFFF;
  border-radius: 6rpx; padding: 2rpx 12rpx;
  font-size: 20rpx; font-weight: 700; letter-spacing: 0.05em;
}
.pd-recent-badge.reg { background: var(--color-muted, #6B7280); }
.pd-recent-tour { flex: 1; font-weight: 600; color: var(--color-ink, #0A0A0A); }
.pd-recent-date { font-size: 20rpx; color: var(--color-muted-2, #9CA3AF); }
.pd-recent-result { display: flex; justify-content: space-between; align-items: center; margin-top: 8rpx; }
.pd-recent-result-left { display: flex; align-items: baseline; gap: 8rpx; }
.pd-recent-score { font-size: 28rpx; font-weight: 800; }
.pd-recent-opp { font-size: 24rpx; color: var(--color-muted, #6B7280); }
.pd-recent-points {
  font-size: 22rpx; font-weight: 700;
  padding: 4rpx 14rpx; border-radius: 999rpx;
}
.pd-recent-points.win  { background: #DDF099; color: var(--color-ink, #0A0A0A); }
.pd-recent-points.loss { background: #FEE2E2; color: var(--color-danger, #DC2626); }
```

- [ ] **Step 3:** Smoke test:
  - Knockout SF match → badge shows `SF`
  - Regular match → badge shows `常规赛` (gray)
  - Win → green `+20` pill, loss → red `+10` pill
  - No `已确认/待打` badges anywhere
  - `grep -rn 'pd-recent-status\|status-confirmed\|status-submitted' miniprogram/pages/player-detail/` → 0 hits

- [ ] **Step 4:** Commit.

```bash
git add miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss
git commit -m "feat(player-detail): recent matches refactor — drop status badge, add +points pill" -- miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/index.wxss
```

---

## Task 16: Full regression + manual E2E + PROGRESS

**Files:**
- Modify: `docs/superpowers/plans/PROGRESS.md`

- [ ] **Step 1:** Run cloud-function regression:

```bash
for d in cloudfunctions/*/; do
  if [ -f "$d/package.json" ] && grep -q '"test"' "$d/package.json"; then
    echo "=== $d ==="
    (cd "$d" && npm test --silent) || { echo "FAILED $d"; exit 1; }
  fi
done
```

Expected: all green. Compare against post-10-1 baseline (likely ~210+ cloud tests + ~25 new from Phase 10-2 = ~235+).

- [ ] **Step 2:** Run miniprogram tests:

```bash
cd /Users/liaoxiaole/FOPEN-PURE && npm test --silent 2>/dev/null || echo "(no top-level mp tests)"
```

- [ ] **Step 3:** Manual E2E in WeChat DevTools — write results into PROGRESS.md:

| # | Scenario | Pass Criteria |
|---|---|---|
| E2E-4 | Open any player-detail with ≥ 1 H2H opponent → tap an h2h-row | Navigates to that opponent's player-detail; can repeat the tap to chain back |
| E2E-6 | Create a brand-new member (no matches, no playStyle, no snapshots) → open their player-detail | Hero subtitle says `单打 未上榜 · 双打 未上榜`; playStyle pill shows `打法未设置`; 3 cards show `0/0 · — · 0`; rank-chart shows `数据不足`; H2H sections hidden; recent shows `暂无近期比赛`; page does not crash |
| E2E-additional | Open a player with rich data (12+ weeks, 6+ H2H opponents) | Singles chart renders polyline + lime end dot + label; doubles chart hidden (or shown if doubles played); H2H singles shows 5 + `展开全部 N 人 →`; expanding shows all; recent shows knockout `SF/QF/F`-style badges and `常规赛` gray badge correctly |

- [ ] **Step 4:** Visual-debt grep — these all must return zero hits inside `miniprogram/pages/player-detail/`:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
grep -rEn '#333|#999|linear-gradient\(135deg' miniprogram/pages/player-detail/ || echo "(clean)"
grep -rEn 'border-left:\s*[2-9][0-9]*rpx|border-left:\s*[3-9]px' miniprogram/pages/player-detail/ || echo "(clean)"
grep -rEn 'status-(confirmed|pending|submitted|disputed)|pd-recent-status' miniprogram/pages/player-detail/ || echo "(clean)"
```

(All three must show "(clean)" or have zero matches.)

- [ ] **Step 5:** Append a new entry to `docs/superpowers/plans/PROGRESS.md`:

```markdown
### 2026-MM-DD · Phase 10-2 complete

| Task | Description | Commit | Status |
|---|---|---|---|
| 1 | playerStats winRate | <sha> | ✅ |
| 2 | playerStats currentRank | <sha> | ✅ |
| 3 | playerStats rankHistory | <sha> | ✅ |
| 4 | playerStats weeklySnapshot | <sha> | ✅ |
| 5 | deriveRoundLabel + enrichRecent helpers | <sha> | ✅ |
| 6 | playerStats.recent enrichment | <sha> | ✅ |
| 7 | resolveOpponentIds + computeH2H helpers | <sha> | ✅ |
| 8 | playerH2H action | <sha> | ✅ |
| 9 | rank-chart component (canvas) | <sha> | ✅ |
| 10 | h2h-row component | <sha> | ✅ |
| 11 | player-detail data orchestration | <sha> | ✅ |
| 12 | player-detail hero + 3-card stats | <sha> | ✅ |
| 13 | player-detail rank-chart × 2 | <sha> | ✅ |
| 14 | player-detail H2H × 2 + expand all | <sha> | ✅ |
| 15 | player-detail recent matches refactor | <sha> | ✅ |

Cloud tests: <N> passing (10-1 baseline + ~25 Phase 10-2 new).
Manual E2E-4 / E2E-6 verified in DevTools.
Visual-debt grep: clean.

**Open follow-ups:**
- Doubles H2H uses `pointsAwarded.entries[].team` when present, otherwise opposite winner/loser `role`. If production data has neither, doubles H2H stays empty until match-results writes are updated to store team/role metadata. Track as Phase 11 backlog.
- rank-chart canvas approach: revisit if performance/render issues observed on real devices.
```

- [ ] **Step 6:** Commit.

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(plans): Phase 10-2 complete — player-detail rebuild + H2H + chart" -- docs/superpowers/plans/PROGRESS.md
```

---

## Spec Coverage Self-Check

| Spec section | Plan task(s) | Status |
|---|---|---|
| §1.2 scope — `points-engine.playerH2H` new action | T7, T8 | ✅ |
| §1.2 scope — `points-engine.playerStats` add winRate / currentRank / rankHistory / weeklySnapshot | T1, T2, T3, T4 | ✅ |
| §1.2 scope — recent[] enrichment (tournamentFormat / roundLabel / opponentId / pointsAwarded) | T5, T6 | ✅ |
| §1.2 scope — `components/rank-chart` new | T9 | ✅ |
| §1.2 scope — `components/h2h-row` new | T10 | ✅ |
| §1.2 scope — `pages/player-detail` rebuild | T11–T15 | ✅ |
| §1.4 acceptance #4 (3 cards × 2 + hero subtitle) | T12 | ✅ |
| §1.4 acceptance #5 (chart + H2H tap + recent without status) | T13, T14, T15, T16 (E2E-4) | ✅ |
| §2.2 IA — HERO + ABOUT + SINGLES + DOUBLES + 排名走势 × 2 + H2H × 2 + RECENT (stacked, no internal tab) | T12, T13, T14, T15 | ✅ |
| §3 visual — rank-chart canvas rendering; h2h-row pills | T9, T10 | ✅ |
| §5.4 — playerStats output shape | T1–T6 | ✅ |
| §5.5 — playerH2H output shape + algorithm + resolveOpponentIds | T7, T8 | ✅ |
| §7.2 — error codes (NOT_FOUND etc.) | inherits wrapper from v2.1; T11 surfaces via `wx.showToast` | ✅ |
| §7.3 — data-missing UI states | T11–T15 (conditional WXML) + T16 E2E-6 | ✅ |
| §8.3 E2E-4 / E2E-6 | T16 | ✅ |
| §8.4 perf basis | T16 (manual smoke, not blocking) | ⚠️ Note in PROGRESS |
| §8.5 visual-debt grep (3 patterns clean) | T16 step 4 | ✅ |
| 兼容性回归 — old playerStats consumers (mine, etc.) | additive only — verified by T1–T6 GREEN of full suite | ✅ |

**Open follow-ups (call out in PROGRESS):**
- Doubles H2H uses `pointsAwarded.entries[].team` or opposite winner/loser `role`. If production data carries neither, doubles list is `[]` — track Phase 11 backlog item to backfill team/role on `confirmOne`.
- rank-chart uses `<canvas type="2d">` for portability. If real-device rendering is laggy, swap to absolutely-positioned `<view>` segments — adjust T9 and amend PROGRESS.

---

**END OF PLAN**
