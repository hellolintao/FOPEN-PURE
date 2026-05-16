# Phase 10-1 Implementation Plan — Rank Page + Edit Profile

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `rank_snapshots` data foundation + reformed rank page (5 cols, weekly-star hero) + edit-profile playStyle/Note inputs, so the club can see weekly trends and members can set their play style. Phase 10-2 (player-detail rewrite) ships in a separate plan after this lands.

**Architecture:**
- New `rank_snapshots` collection stores per-ranked-player-per-week rows (10 cols incl. `effectiveAt`); 4 indexes to support trend-lookup, history fetch, and idempotent upsert.
- `aggregateRanks` extended with optional `asOf` parameter (date filter on both `match_results.confirmedAt|createTime` and `tournament_points.awardedAt|createTime`) + stable tiebreaker (`totalPoints DESC, wins DESC, losses ASC, memberId ASC`).
- `weekly-star` cloud function gets new `current` action (3-mode: `current` / `fallback` / `empty`) for rank-page weekly hero, plus cron double-write that produces both `weekly_stars` top-1 doc and a `rank_snapshots` row per ranked entry. This matches current `aggregateRanks` semantics: unranked members with no point source do not get synthetic rank rows.
- One-shot `scripts/backfill-rank-snapshots-W0.js` and admin-triggered `recomputeRankSnapshots` action seed the comparison baseline so trend arrows light up from day 1.
- `points-engine.rankList` returns `winRate` + `trendDelta` per row (latest snapshot picked by `effectiveAt DESC, computedAt DESC`).
- `rank-row` component grows from 3 cols (rank/avatar/utr) → 5 cols (rank/player/winRate/totalPoints/trendDelta); WXML reshaped, JS props renamed cleanly (no shim).
- `pages/rank/index` drops the standalone champion hero, makes the weekly-star card the only clickable hero, drives subtitle from `weekly-star.current` payload, and adopts the new 5-col list header.
- `members.update` tightens `playStyleNote` cap from 100→50 chars (per spec §4.2), and `pages/edit-profile/index` gains a `radio-group` playStyle picker + a 50-char `textarea` for the note.

**Tech Stack:** WeChat Cloud Functions (Node 16, wx-server-sdk) · WeChat Mini Program (WXML/WXSS/JS, no npm runtime) · Jest 29 (in-memory db emulator pattern, see `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`) · existing `utils/cloud.callFunction` wrapper.

**Timestamp policy:** Production filters must compare `Date` values, not date-key strings. Use `week.start` / `week.end` for queries and `effectiveAt`; use `week.weekStart` / `week.weekEnd` only for display and persisted date-key fields. Normalize `asOf` with `new Date(asOf)` before building cloud query filters. Test fixtures may use ISO strings only inside fake DB unit tests where both sides are strings.

**Reference:**
- Spec: `docs/superpowers/specs/2026-05-16-rank-and-player-detail-design.md`
- Communication log: `docs/communication/2026-05-16-claude-codex-v2-1-log.md`
- Precedent plan: `docs/superpowers/plans/09-phase-9-v2.1-quality-iteration.md`

**Commit discipline:** Use **explicit pathspec** for every commit (`git commit -- <paths>`) per the Phase 9 protocol — don't `git add .` because the visual-revamp stream may have staged unrelated files in the worktree.

**Goal-progress checkpoints:** Run `npm test --prefix cloudfunctions/points-engine` and `npm test --prefix cloudfunctions/weekly-star` after each backend task; run `npm test --prefix cloudfunctions/members` after T15. Phase 10-1 acceptance gate: full regression `213/213` (cloud 191 + miniprogram 22) + new tests **all green** before merge.

---

## File Structure (lock decomposition before tasks)

### Backend — cloudfunctions/

| File | Status | Responsibility |
|---|---|---|
| `cloudfunctions/points-engine/lib/aggregate.js` | modify | Add `asOf` filter + stable tiebreaker |
| `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js` | modify | Cover `asOf` + tiebreaker cases |
| `cloudfunctions/points-engine/lib/weekly-delta.js` | create | Pure-function `aggregateWeeklyPlayerDelta` |
| `cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js` | create | Unit tests for the above |
| `cloudfunctions/points-engine/index.js` | modify | `rankListCompat` returns `winRate` + `trendDelta`; expose new internal calls if needed |
| `cloudfunctions/points-engine/__tests__/index.test.js` | modify | Cover `rankList` new fields |
| `cloudfunctions/weekly-star/lib/week-window.js` | modify | Add `getCurrentNaturalWeek` (mirror of `getPreviousNaturalWeek`) |
| `cloudfunctions/weekly-star/lib/__tests__/week-window.test.js` | create (if absent) or modify | Cover new helper |
| `cloudfunctions/weekly-star/lib/aggregate.js` | create/sync | Local deployable copy of `points-engine/lib/aggregate.js`; required because WeChat packages each cloud function directory independently |
| `cloudfunctions/weekly-star/lib/current.js` | create | 3-mode (`current`/`fallback`/`empty`) resolver for rank-page hero |
| `cloudfunctions/weekly-star/lib/__tests__/current.test.js` | create | Unit tests |
| `cloudfunctions/weekly-star/lib/snapshot-writer.js` | create | Pure helper that builds `rank_snapshots` rows from aggregate output (used by cron + recompute) |
| `cloudfunctions/weekly-star/lib/__tests__/snapshot-writer.test.js` | create | Unit tests |
| `cloudfunctions/weekly-star/index.js` | modify | Wire `current` action; cron `compute` calls snapshot-writer; new `recomputeRankSnapshots` action |
| `cloudfunctions/weekly-star/__tests__/index.test.js` | modify | Integration tests for `current` + cron double-write + `recomputeRankSnapshots` |
| `cloudfunctions/members/lib/validate.js` | modify | Tighten `playStyleNote` cap 100→50 chars |
| `cloudfunctions/members/__tests__/validate.test.js` | create | Unit tests for enum + length |
| `cloudfunctions/DATABASE_SCHEMA.md` | modify | New `rank_snapshots` section; `members.playStyleNote` ≤ 50 |

### Backend — scripts/

| File | Status | Responsibility |
|---|---|---|
| `scripts/backfill-rank-snapshots-W0.js` | create | One-shot baseline writer (also reused by `recomputeRankSnapshots` action) |
| `scripts/__tests__/backfill-rank-snapshots-W0.test.js` | create | Unit test with in-memory db emulator |
| `scripts/sync-shared-libs.sh` | modify | Verify `points-engine/lib/aggregate.js` stays identical to `weekly-star/lib/aggregate.js` |

### Frontend — miniprogram/

| File | Status | Responsibility |
|---|---|---|
| `miniprogram/components/rank-row/index.js` | modify | Replace props `utr / trend` → `winRate / totalPoints / trendDelta` |
| `miniprogram/components/rank-row/index.wxml` | modify | 5-col grid layout |
| `miniprogram/components/rank-row/index.wxss` | modify | Grid template adjustment |
| `miniprogram/pages/rank/index.js` | modify | Call `weekly-star.current`; pass new props to `rank-row`; remove champion hero state |
| `miniprogram/pages/rank/index.wxml` | modify | Drop `<champion>` block; weekly-star card becomes only hero + `bindtap`; 5-col list head |
| `miniprogram/pages/rank/index.wxss` | modify | Layout fix-ups |
| `miniprogram/pages/edit-profile/index.js` | modify | Load/edit/submit playStyle + playStyleNote; switch to `utils/cloud.callFunction` |
| `miniprogram/pages/edit-profile/index.wxml` | modify | Add `radio-group` + `textarea` |
| `miniprogram/pages/edit-profile/index.wxss` | modify | Styling for new fields |

### Docs

| File | Status | Responsibility |
|---|---|---|
| `docs/superpowers/plans/PROGRESS.md` | append | Phase 10-1 progress entries (per-task commit SHA) |

---

## Task 1: DATABASE_SCHEMA.md — add `rank_snapshots`, tighten `playStyleNote`

**Files:**
- Modify: `cloudfunctions/DATABASE_SCHEMA.md`

- [ ] **Step 1:** Open `cloudfunctions/DATABASE_SCHEMA.md` and locate the section for collections.
- [ ] **Step 2:** Add a new top-level section `## rank_snapshots` with the full schema from spec §4.1:

```markdown
## rank_snapshots

每位上榜选手每周一行的历史排名快照。用于 trendDelta（与 latest 快照比对）和 rankHistory（折线图）；未产生积分来源、尚未上榜的成员不写合成 0 分快照。

| Field | Type | Description |
|---|---|---|
| `_id` | string | 推荐格式 `rs_<seasonId>_<weekId>_<type>_<memberId>`；唯一索引由 `(seasonId, type, weekId, memberId)` 兜底 |
| `seasonId` | string | 赛季，例 `s2026` |
| `weekId` | string | weekly = `ws_YYYY-MM-DD`（Monday key，沿用 `getWeekId`）；baseline = `baseline_YYYY-MM-DD` |
| `weekStart` | string | yyyy-mm-dd（周一）；baseline 行使用当天日期 |
| `weekEnd` | string | yyyy-mm-dd（周日）；baseline 行使用当天日期 |
| `effectiveAt` | Date | trend/latest 排序的权威字段。weekly=weekEnd 23:59:59；baseline=回填时刻 |
| `type` | string | `singles` \| `doubles` |
| `memberId` | string | 选手 ID |
| `rank` | number | 截至该周结束时的排名（数组下标 + 1） |
| `totalPoints` | number | 截至该周结束累计积分 |
| `wins` | number | 累计胜场 |
| `losses` | number | 累计负场 |
| `snapshotKind` | string | `weekly` \| `baseline` |
| `computedAt` | Date | 写入时间 |

**索引（必建）：**

1. `(seasonId, type, weekStart DESC, rank ASC)` — rank 折线图按周倒序、单周内按 rank 升序
2. `(seasonId, type, memberId, weekStart ASC)` — 单玩家 rankHistory（折线图数据源）
3. `(seasonId, type, memberId, effectiveAt DESC, computedAt DESC)` — `rankList.trendDelta` 查最近一份有效快照
4. `(seasonId, type, weekId, memberId)` UNIQUE — cron / backfill 幂等 upsert

**容量估算：** 100 人 × 52 周 × 2 type = 10400 文档/年。
```

- [ ] **Step 3:** In the `## members` section, change the `playStyleNote` row description from `≤ 100 字` (or similar) to `≤ 50 字` so doc matches the new validate.js cap.
- [ ] **Step 4:** Commit.

```bash
git add cloudfunctions/DATABASE_SCHEMA.md
git commit -- cloudfunctions/DATABASE_SCHEMA.md -m "docs(schema): add rank_snapshots, tighten playStyleNote to 50 chars"
```

---

## Task 2: `aggregateRanks` — add `asOf` parameter (RED)

**Files:**
- Modify: `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`

- [ ] **Step 1:** Open `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`. Locate the existing `makeFakeDb` helper. Note that the fake row matcher already handles plain-value equality and `__op` operators; we'll extend by passing `confirmedAt` / `createTime` / `awardedAt` values and rely on `__op:'lt'` / `__op:'lte'` comparators.

  **Important:** Production data compares `Date` values. For new `asOf` tests, prefer `new Date('2026-01-10T00:00:00')` for row timestamps and `asOf: new Date('2026-02-01T00:00:00')` for calls. If you keep existing tests as strings, keep both sides strings only within that fake DB test so the comparator remains meaningful.
- [ ] **Step 2:** Add support for `lt` / `lte` operators in the fake `_` and `matchRow`:

```js
// in makeFakeDb, inside `const _ = { ... }`:
lt(value)  { return { __op: 'lt',  value } },
lte(value) { return { __op: 'lte', value } },

// in matchRow's __op switch:
else if (v.__op === 'lt')  { if (!(cell < v.value))  return false }
else if (v.__op === 'lte') { if (!(cell <= v.value)) return false }
```

- [ ] **Step 3:** Append a new `describe('aggregateRanks asOf parameter', () => { ... })` block with three failing tests:

```js
describe('aggregateRanks asOf parameter', () => {
  const seasonId = 's2026'
  const type = 'singles'
  const d = (key) => new Date(`${key}T00:00:00`)

  test('without asOf → equivalent to historical behavior (aggregates all)', async () => {
    const db = makeFakeDb({
      matchResults: [
        { _id: 'm1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-01-10'), createTime: d('2026-01-10'),
          pointsAwarded: { entries: [
            { memberId: 'A', points: 20, role: 'winner' },
            { memberId: 'B', points: 10, role: 'loser' }
          ] } },
        { _id: 'm2', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-03-10'), createTime: d('2026-03-10'),
          pointsAwarded: { entries: [
            { memberId: 'A', points: 20, role: 'winner' },
            { memberId: 'C', points: 10, role: 'loser' }
          ] } }
      ],
      tournamentPoints: []
    })
    const out = await aggregateRanks({ db, seasonId, type })
    expect(out.find(r => r.memberId === 'A').totalPoints).toBe(40)
  })

  test('asOf cuts off future match_results by confirmedAt', async () => {
    const db = makeFakeDb({
      matchResults: [
        { _id: 'm1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-01-10'), createTime: d('2026-01-09'),
          pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }] } },
        { _id: 'm2', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: d('2026-03-10'), createTime: d('2026-03-09'),
          pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }] } }
      ],
      tournamentPoints: []
    })
    const out = await aggregateRanks({ db, seasonId, type, asOf: d('2026-02-01') })
    expect(out.find(r => r.memberId === 'A').totalPoints).toBe(20)
  })

  test('asOf cuts off tournament_points by awardedAt (fallback createTime)', async () => {
    const db = makeFakeDb({
      matchResults: [],
      tournamentPoints: [
        { _id: 'p1', seasonId, tournamentType: type, memberId: 'A', points: 50,
          awardedAt: d('2026-01-15'), createTime: d('2026-01-15') },
        { _id: 'p2', seasonId, tournamentType: type, memberId: 'A', points: 30,
          awardedAt: d('2026-04-15'), createTime: d('2026-04-15') }
      ]
    })
    const out = await aggregateRanks({ db, seasonId, type, asOf: d('2026-02-01') })
    expect(out.find(r => r.memberId === 'A').totalPoints).toBe(50)
  })
})
```

- [ ] **Step 4:** Run the new tests and confirm they fail.

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/aggregate.test.js -t 'asOf' --verbose
```

Expected: 3 tests fail because `aggregateRanks` does not yet accept `asOf` (extra matches still counted).

- [ ] **Step 5:** Commit the failing tests.

```bash
git add cloudfunctions/points-engine/lib/__tests__/aggregate.test.js
git commit -- cloudfunctions/points-engine/lib/__tests__/aggregate.test.js -m "test(points-engine): aggregateRanks asOf parameter (RED)"
```

---

## Task 3: `aggregateRanks` — implement `asOf` (GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/lib/aggregate.js`

- [ ] **Step 1:** Extend the function signature and inject `asOf` into the base filters for both collections. Replace lines 1–26 with:

```js
async function aggregateRanks({ db, seasonId, type, pageSize = 100, asOf = null }) {
  const _ = db.command
  const acc = new Map()
  const limit = Math.max(1, Math.min(Number(pageSize) || 100, 100))
  const cutoff = asOf ? new Date(asOf) : null

  // match_results: filter by confirmedAt OR createTime <= asOf (confirmedAt preferred)
  const matchBase = { seasonId, resultStatus: 'confirmed', tournamentType: type }
  const matchFilter = cutoff
    ? _.and([matchBase, _.or([
        { confirmedAt: _.lte(cutoff) },
        _.and([{ confirmedAt: _.eq(null) }, { createTime: _.lte(cutoff) }])
      ])])
    : matchBase

  await pageCollection({
    db, baseFilter: matchFilter, limit, collectionName: 'match_results',
    visit: async (m) => {
      const entries = (m.pointsAwarded && m.pointsAwarded.entries) || []
      for (const e of entries) accumulate(acc, e.memberId, e.points, e.role)
    },
    command: _
  })

  // tournament_points: filter by awardedAt OR createTime <= asOf
  const tpBase = { seasonId, tournamentType: type }
  const tpFilter = cutoff
    ? _.and([tpBase, _.or([
        { awardedAt: _.lte(cutoff) },
        _.and([{ awardedAt: _.eq(null) }, { createTime: _.lte(cutoff) }])
      ])])
    : tpBase

  await safePageTournamentPoints(db, tpFilter, limit, async (p) => {
    accumulate(acc, p.memberId, p.points, null)
  }, _)

  return [...acc.entries()]
    .map(([memberId, v]) => ({ memberId, ...v }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
}
```

- [ ] **Step 2:** In `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`, extend `makeFakeDb`'s `_` to include `eq` so the new filter compiles:

```js
eq(value) { return { __op: 'eq', value } },

// in matchRow's __op switch:
else if (v.__op === 'eq') { if (cell !== v.value) return false }
```

Also, since `confirmedAt` may be missing (=== undefined) on legacy rows, treat `cell === undefined` as null for `eq(null)`:

```js
else if (v.__op === 'eq') { if ((cell == null) !== (v.value == null) || (cell != null && cell !== v.value)) return false }
```

- [ ] **Step 3:** Run the tests and confirm all three pass.

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/aggregate.test.js -t 'asOf' --verbose
```

Expected: 3 PASS.

- [ ] **Step 4:** Full regression of the file.

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/aggregate.test.js --verbose
```

Expected: all existing tests still pass + 3 new tests pass.

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/lib/aggregate.js cloudfunctions/points-engine/lib/__tests__/aggregate.test.js
git commit -- cloudfunctions/points-engine/lib/aggregate.js cloudfunctions/points-engine/lib/__tests__/aggregate.test.js -m "feat(points-engine): aggregateRanks asOf parameter (GREEN)"
```

---

## Task 4: `aggregateRanks` — stable tiebreaker (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/lib/aggregate.js`
- Modify: `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`

- [ ] **Step 1:** Append a failing test demonstrating the current ordering is unstable when `totalPoints` ties. Seed `B` before `A`; the current `totalPoints`-only stable sort will preserve insertion order and incorrectly return `B` first, so this test must fail before the comparator is implemented:

```js
describe('aggregateRanks stable tiebreaker', () => {
  test('ties broken by wins DESC, then losses ASC, then memberId ASC', async () => {
    const seasonId = 's2026'
    const type = 'singles'
    const db = makeFakeDb({
      matchResults: [
        // B is intentionally seeded first. Old totalPoints-only sort preserves insertion order,
        // so the RED test fails until wins/losses/memberId tiebreakers are added.
        // B: 100 pts, 4W, 0L
        { _id: 'b1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-01', createTime: '2026-01-01',
          pointsAwarded: { entries: [
            { memberId: 'B', points: 100, role: 'winner' },
            { memberId: 'Y', points: 0,   role: 'loser' }
          ] } },
        ...[1,2,3].map((i) => ({
          _id: `b${i+1}`, seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-02', createTime: '2026-01-02',
          pointsAwarded: { entries: [
            { memberId: 'B', points: 0, role: 'winner' },
            { memberId: 'Y', points: 0, role: 'loser' }
          ] }
        })),
        // A: 100 pts, 5W, 1L
        { _id: 'a1', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-01', createTime: '2026-01-01',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 100, role: 'winner' },
            { memberId: 'X', points: 0,   role: 'loser' }
          ] } },
        // Aux to push A win=5 loss=1
        ...[1,2,3,4].map((i) => ({
          _id: `a${i+1}`, seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-02', createTime: '2026-01-02',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 0, role: 'winner' },
            { memberId: 'X', points: 0, role: 'loser' }
          ] }
        })),
        { _id: 'a6', seasonId, resultStatus: 'confirmed', tournamentType: type,
          confirmedAt: '2026-01-03', createTime: '2026-01-03',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 0, role: 'loser' },
            { memberId: 'X', points: 0, role: 'winner' }
          ] } }
      ],
      tournamentPoints: []
    })
    const out = await aggregateRanks({ db, seasonId, type })
    // A=100/5/1, B=100/4/0 → B has more "losses=0" but fewer wins. wins DESC ranks A first.
    expect(out[0].memberId).toBe('A')
    expect(out[1].memberId).toBe('B')
  })
})
```

- [ ] **Step 2:** Run; confirm failure (old output starts with `B`; desired output starts with `A` because wins DESC outranks losses ASC).

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/aggregate.test.js -t 'tiebreaker' --verbose
```

- [ ] **Step 3:** In `aggregate.js`, replace the final sort with the stable comparator:

```js
return [...acc.entries()]
  .map(([memberId, v]) => ({ memberId, ...v }))
  .sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints
    if (b.wins !== a.wins)               return b.wins - a.wins
    if (a.losses !== b.losses)           return a.losses - b.losses
    return a.memberId < b.memberId ? -1 : (a.memberId > b.memberId ? 1 : 0)
  })
```

- [ ] **Step 4:** Run; confirm green.

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/aggregate.test.js --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/lib/aggregate.js cloudfunctions/points-engine/lib/__tests__/aggregate.test.js
git commit -- cloudfunctions/points-engine/lib/aggregate.js cloudfunctions/points-engine/lib/__tests__/aggregate.test.js -m "feat(points-engine): aggregateRanks stable tiebreaker (wins/losses/id)"
```

---

## Task 5: `aggregateWeeklyPlayerDelta` — new internal function (RED)

**Files:**
- Create: `cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js`

- [ ] **Step 1:** Create the test file mirroring the in-memory db pattern from `aggregate.test.js`:

```js
const { aggregateWeeklyPlayerDelta } = require('../weekly-delta')

function makeFakeDb(rows) {
  const _ = {
    and(cs){return{__op:'and',clauses:cs}},
    or(cs){return{__op:'or',clauses:cs}},
    in(v){return{__op:'in',value:v}},
    gte(v){return{__op:'gte',value:v}},
    lte(v){return{__op:'lte',value:v}},
    eq(v){return{__op:'eq',value:v}}
  }
  function match(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => match(row, c))
    if (f.__op === 'or')  return f.clauses.some(c => match(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'gte') { if (!(c >= v.value)) return false }
      else if (v && v.__op === 'lte') { if (!(c <= v.value)) return false }
      else if (v && v.__op === 'in')  { if (!v.value.includes(c)) return false }
      else if (v && v.__op === 'eq')  { if (c !== v.value) return false }
      else if (v !== c) return false
    }
    return true
  }
  return {
    command: _,
    collection() { return {
      where(f){ return { get: async () => ({ data: rows.filter(r => match(r, f)) }) } }
    }}
  }
}

describe('aggregateWeeklyPlayerDelta', () => {
  const week = { weekStart: '2026-05-04', weekEnd: '2026-05-10' }
  const seasonId = 's2026'

  test('3 wins 1 loss this week → wins=3 losses=1 pointsDelta sums', async () => {
    const db = makeFakeDb([
      { _id: 'm1', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-05', createTime: '2026-05-05',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm2', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-06', createTime: '2026-05-06',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm3', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-07', createTime: '2026-05-07',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm4', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-08', createTime: '2026-05-08',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 10, role: 'loser' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 70, wins: 3, losses: 1 })
  })

  test('no matches this week → zeros', async () => {
    const db = makeFakeDb([])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 0, wins: 0, losses: 0 })
  })

  test('type filter: doubles match does not count for singles query', async () => {
    const db = makeFakeDb([
      { _id: 'm1', seasonId, tournamentType: 'doubles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-05', createTime: '2026-05-05',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 0, wins: 0, losses: 0 })
  })

  test('boundary: match confirmedAt at weekStart 00:00 included; at weekEnd+1ms excluded', async () => {
    const db = makeFakeDb([
      { _id: 'm_in', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-04', createTime: '2026-05-04',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } },
      { _id: 'm_out', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-05-11', createTime: '2026-05-11',
        playerIds: ['P'],
        pointsAwarded: { entries: [{ memberId: 'P', points: 20, role: 'winner' }] } }
    ])
    const out = await aggregateWeeklyPlayerDelta({ db, seasonId, type: 'singles', playerId: 'P', week })
    expect(out).toEqual({ pointsDelta: 20, wins: 1, losses: 0 })
  })
})
```

- [ ] **Step 2:** Run and confirm failure (module not found).

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/weekly-delta.test.js --verbose
```

Expected: `Cannot find module '../weekly-delta'`.

- [ ] **Step 3:** Commit the failing tests.

```bash
git add cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js
git commit -- cloudfunctions/points-engine/lib/__tests__/weekly-delta.test.js -m "test(points-engine): aggregateWeeklyPlayerDelta (RED)"
```

---

## Task 6: `aggregateWeeklyPlayerDelta` — implementation (GREEN)

**Files:**
- Create: `cloudfunctions/points-engine/lib/weekly-delta.js`

- [ ] **Step 1:** Create the module:

```js
async function aggregateWeeklyPlayerDelta({ db, seasonId, type, playerId, week }) {
  const _ = db.command
  if (!playerId || !week || !week.weekStart || !week.weekEnd) {
    return { pointsDelta: 0, wins: 0, losses: 0 }
  }
  const start = week.start || week.weekStart
  const end = week.end || week.weekEnd

  // confirmedAt preferred; fall back to createTime when confirmedAt is null/undefined
  const dateClause = _.or([
    _.and([
      { confirmedAt: _.gte(start) },
      { confirmedAt: _.lte(end) }
    ]),
    _.and([
      { confirmedAt: _.eq(null) },
      { createTime: _.gte(start) },
      { createTime: _.lte(end) }
    ])
  ])

  const filter = _.and([
    { seasonId },
    { resultStatus: 'confirmed' },
    { tournamentType: type },
    { playerIds: _.in([playerId]) },
    dateClause
  ])

  const res = await db.collection('match_results').where(filter).get()
  const rows = (res && res.data) || []

  let pointsDelta = 0, wins = 0, losses = 0
  for (const m of rows) {
    const entries = (m.pointsAwarded && m.pointsAwarded.entries) || []
    const mine = entries.find(e => e.memberId === playerId)
    if (!mine) continue
    pointsDelta += mine.points || 0
    if (mine.role === 'winner') wins += 1
    else if (mine.role === 'loser') losses += 1
  }
  return { pointsDelta, wins, losses }
}

module.exports = { aggregateWeeklyPlayerDelta }
```

- [ ] **Step 2:** Run tests; confirm all 4 pass.

```bash
cd cloudfunctions/points-engine && npx jest lib/__tests__/weekly-delta.test.js --verbose
```

- [ ] **Step 3:** Commit.

```bash
git add cloudfunctions/points-engine/lib/weekly-delta.js
git commit -- cloudfunctions/points-engine/lib/weekly-delta.js -m "feat(points-engine): aggregateWeeklyPlayerDelta implementation (GREEN)"
```

---

## Task 7: `week-window.js` — add `getCurrentNaturalWeek`

**Files:**
- Modify: `cloudfunctions/weekly-star/lib/week-window.js`
- Create: `cloudfunctions/weekly-star/lib/__tests__/week-window.test.js`

- [ ] **Step 1:** Create the test file (if missing):

```js
const { getCurrentNaturalWeek, getPreviousNaturalWeek, getWeekId, toDateKey } = require('../week-window')

describe('getCurrentNaturalWeek', () => {
  test('Wednesday → start=Monday, end=this exact moment, weekStart/End strings', () => {
    const now = new Date('2026-05-13T15:00:00')  // Wednesday
    const w = getCurrentNaturalWeek(now)
    expect(w.weekStart).toBe('2026-05-11')
    expect(w.weekEnd).toBe('2026-05-13')
    expect(w.weekId).toBe('ws_2026-05-11')
    expect(w.start.getDay()).toBe(1) // Monday
    expect(w.end.getTime()).toBeLessThanOrEqual(now.getTime())
  })

  test('Sunday → still in this week (Sunday is end of natural week)', () => {
    const now = new Date('2026-05-17T20:00:00') // Sunday
    const w = getCurrentNaturalWeek(now)
    expect(w.weekStart).toBe('2026-05-11')
    expect(w.weekEnd).toBe('2026-05-17')
  })

  test('Monday early morning → start = today', () => {
    const now = new Date('2026-05-11T01:00:00') // Monday 01:00
    const w = getCurrentNaturalWeek(now)
    expect(w.weekStart).toBe('2026-05-11')
  })
})
```

- [ ] **Step 2:** Run; confirm failure.

```bash
cd cloudfunctions/weekly-star && npx jest lib/__tests__/week-window.test.js --verbose
```

- [ ] **Step 3:** Implement in `lib/week-window.js`. Append before `module.exports`:

```js
function getCurrentNaturalWeek(now = new Date()) {
  const today = startOfLocalDay(now)
  const dow = today.getDay() === 0 ? 7 : today.getDay()
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() - (dow - 1))
  return {
    start: thisMonday,
    end: now,
    weekStart: toDateKey(thisMonday),
    weekEnd: toDateKey(now),
    weekId: getWeekId(thisMonday)
  }
}
```

Update the exports line:

```js
module.exports = { getPreviousNaturalWeek, getCurrentNaturalWeek, getWeekId, toDateKey }
```

- [ ] **Step 4:** Run; confirm green.

```bash
cd cloudfunctions/weekly-star && npx jest lib/__tests__/week-window.test.js --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/weekly-star/lib/week-window.js cloudfunctions/weekly-star/lib/__tests__/week-window.test.js
git commit -- cloudfunctions/weekly-star/lib/week-window.js cloudfunctions/weekly-star/lib/__tests__/week-window.test.js -m "feat(weekly-star): add getCurrentNaturalWeek helper"
```

---

## Task 8: `weekly-star.current` — `mode='current'` (RED → GREEN)

**Files:**
- Create: `cloudfunctions/weekly-star/lib/current.js`
- Create: `cloudfunctions/weekly-star/lib/__tests__/current.test.js`

- [ ] **Step 1:** Create the test file with the happy-path case first:

```js
const { resolveCurrentWeeklyStar } = require('../current')

function makeFakeDb({ matches = [], placements = [], stars = [], members = [] } = {}) {
  const _ = {
    and(cs){return{__op:'and',clauses:cs}},
    or(cs){return{__op:'or',clauses:cs}},
    in(v){return{__op:'in',value:v}},
    gte(v){return{__op:'gte',value:v}},
    lte(v){return{__op:'lte',value:v}},
    eq(v){return{__op:'eq',value:v}}
  }
  function rowMatches(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => rowMatches(row, c))
    if (f.__op === 'or')  return f.clauses.some(c => rowMatches(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'gte'){ if (!(c >= v.value)) return false }
      else if (v && v.__op === 'lte'){ if (!(c <= v.value)) return false }
      else if (v && v.__op === 'in'){ if (!v.value.includes(c)) return false }
      else if (v && v.__op === 'eq'){ if (c !== v.value) return false }
      else if (v !== c) return false
    }
    return true
  }
  const collections = {
    match_results: matches,
    tournament_points: placements,
    weekly_stars: stars,
    members
  }
  return {
    command: _,
    collection(name){
      return {
        where(f){
          const data = (collections[name] || []).filter(r => rowMatches(r, f))
          return {
            get: async () => ({ data }),
            orderBy(){ return this },
            limit(n){ return { get: async () => ({ data: data.slice(0, n) }) } }
          }
        }
      }
    }
  }
}

describe("weekly-star.current — mode='current'", () => {
  test("returns top scorer when this week has confirmed matches", async () => {
    const week = { weekStart: '2026-05-11', weekEnd: '2026-05-17' }
    const db = makeFakeDb({
      members: [
        { _id: 'A', name: '陈思远', avatarUrl: 'a.png' },
        { _id: 'B', name: '李志刚', avatarUrl: 'b.png' }
      ],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-05-12', createTime: '2026-05-12',
          pointsAwarded: { entries: [
            { memberId: 'A', points: 50, role: 'winner' },
            { memberId: 'B', points: 10, role: 'loser' }
          ] } }
      ]
    })
    const out = await resolveCurrentWeeklyStar({ db, seasonId: 's2026', type: 'singles', week })
    expect(out.mode).toBe('current')
    expect(out.star.memberId).toBe('A')
    expect(out.star.pointsDelta).toBe(50)
    expect(out.star.wins).toBe(1)
    expect(out.star.losses).toBe(0)
    expect(out.subtitle).toBe('本周积分 +50 · W-L 1-0')
  })
})
```

- [ ] **Step 2:** Run; confirm failure (module not found).
- [ ] **Step 3:** Create `cloudfunctions/weekly-star/lib/current.js`:

```js
async function resolveCurrentWeeklyStar({ db, seasonId, type, week }) {
  const _ = db.command
  const start = week.start || week.weekStart
  const end = week.end || week.weekEnd

  // 1. Try this-week matches
  const dateClause = _.or([
    _.and([{ confirmedAt: _.gte(start) }, { confirmedAt: _.lte(end) }]),
    _.and([{ confirmedAt: _.eq(null) }, { createTime: _.gte(start) }, { createTime: _.lte(end) }])
  ])
  const matchFilter = _.and([
    { seasonId }, { resultStatus: 'confirmed' }, { tournamentType: type }, dateClause
  ])
  const matchesRes = await db.collection('match_results').where(matchFilter).get()
  const matches = (matchesRes && matchesRes.data) || []

  // (placements are awarded ad-hoc; for "this week" we also scan tournament_points with same window)
  const tpFilter = _.and([
    { seasonId }, { tournamentType: type },
    _.or([
      _.and([{ awardedAt: _.gte(start) }, { awardedAt: _.lte(end) }]),
      _.and([{ awardedAt: _.eq(null) }, { createTime: _.gte(start) }, { createTime: _.lte(end) }])
    ])
  ])
  let placements = []
  try {
    const tpRes = await db.collection('tournament_points').where(tpFilter).get()
    placements = (tpRes && tpRes.data) || []
  } catch (e) {
    const msg = `${(e && (e.errMsg || e.message || e.code)) || ''}`
    if (!((e && e.errCode === -502005) || /not exist/i.test(msg))) throw e
  }

  if (matches.length === 0 && placements.length === 0) {
    return await fallbackOrEmpty({ db, seasonId, type, week })
  }

  // Aggregate per member
  const agg = new Map() // memberId -> { points, wins, losses }
  for (const m of matches) {
    const entries = (m.pointsAwarded && m.pointsAwarded.entries) || []
    for (const e of entries) {
      const cur = agg.get(e.memberId) || { points: 0, wins: 0, losses: 0 }
      cur.points += e.points || 0
      if (e.role === 'winner') cur.wins += 1
      if (e.role === 'loser')  cur.losses += 1
      agg.set(e.memberId, cur)
    }
  }
  for (const p of placements) {
    const cur = agg.get(p.memberId) || { points: 0, wins: 0, losses: 0 }
    cur.points += p.points || 0
    agg.set(p.memberId, cur)
  }
  if (agg.size === 0) return await fallbackOrEmpty({ db, seasonId, type, week })

  // Pick top scorer (tie-break: wins DESC, losses ASC, memberId ASC)
  const ranked = [...agg.entries()].map(([memberId, v]) => ({ memberId, ...v }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.wins   !== a.wins)   return b.wins - a.wins
      if (a.losses !== b.losses) return a.losses - b.losses
      return a.memberId < b.memberId ? -1 : (a.memberId > b.memberId ? 1 : 0)
    })
  const top = ranked[0]

  // Hydrate member info
  const memRes = await db.collection('members').where({ _id: top.memberId }).get()
  const m = (memRes && memRes.data && memRes.data[0]) || {}

  return {
    mode: 'current',
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    star: {
      memberId: top.memberId,
      name: m.name || top.memberId,
      avatarUrl: m.avatarUrl || '',
      pointsDelta: top.points,
      wins: top.wins,
      losses: top.losses
    },
    subtitle: `本周积分 +${top.points} · W-L ${top.wins}-${top.losses}`
  }
}

async function fallbackOrEmpty({ db, seasonId, type, week }) {
  // Find most recent weekly_stars row for this season
  const starsRes = await db.collection('weekly_stars')
    .where({ seasonId })
    .orderBy('weekStart', 'desc')
    .limit(5)
    .get()
  const stars = (starsRes && starsRes.data) || []
  // Pick one that has the right type sub-doc
  for (const s of stars) {
    const key = type === 'singles' ? 'singlesStar' : 'doublesStar'
    if (s[key] && s[key].memberId) {
      const memberId = s[key].memberId
      const memRes = await db.collection('members').where({ _id: memberId }).get()
      const m = (memRes && memRes.data && memRes.data[0]) || {}
      return {
        mode: 'fallback',
        weekStart: week.weekStart,
        weekEnd: week.weekEnd,
        star: {
          memberId,
          name: m.name || memberId,
          avatarUrl: m.avatarUrl || '',
          pointsDelta: s[key].points || 0,
          wins: s[key].wins || 0,
          losses: s[key].losses || 0
        },
        subtitle: '等本周首场'
      }
    }
  }
  return { mode: 'empty', weekStart: week.weekStart, weekEnd: week.weekEnd, star: null, subtitle: null }
}

module.exports = { resolveCurrentWeeklyStar }
```

- [ ] **Step 4:** Run the single test; confirm green.

```bash
cd cloudfunctions/weekly-star && npx jest lib/__tests__/current.test.js --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/weekly-star/lib/current.js cloudfunctions/weekly-star/lib/__tests__/current.test.js
git commit -- cloudfunctions/weekly-star/lib/current.js cloudfunctions/weekly-star/lib/__tests__/current.test.js -m "feat(weekly-star): resolveCurrentWeeklyStar — mode='current' (TDD)"
```

---

## Task 9: `weekly-star.current` — `fallback` and `empty` modes

**Files:**
- Modify: `cloudfunctions/weekly-star/lib/__tests__/current.test.js`

- [ ] **Step 1:** Add two more tests:

```js
test("mode='fallback' when this week is empty but historical weekly_stars exist", async () => {
  const week = { weekStart: '2026-05-11', weekEnd: '2026-05-17' }
  const db = makeFakeDb({
    members: [{ _id: 'X', name: '王浩', avatarUrl: 'x.png' }],
    matches: [],
    stars: [
      { _id: 'ws_2026-05-04', seasonId: 's2026', weekStart: '2026-05-04', weekEnd: '2026-05-10',
        singlesStar: { memberId: 'X', points: 60, wins: 3, losses: 1 } }
    ]
  })
  const out = await resolveCurrentWeeklyStar({ db, seasonId: 's2026', type: 'singles', week })
  expect(out.mode).toBe('fallback')
  expect(out.star.memberId).toBe('X')
  expect(out.subtitle).toBe('等本周首场')
})

test("mode='empty' when this week and history are both empty", async () => {
  const week = { weekStart: '2026-05-11', weekEnd: '2026-05-17' }
  const db = makeFakeDb({ members: [], matches: [], stars: [] })
  const out = await resolveCurrentWeeklyStar({ db, seasonId: 's2026', type: 'singles', week })
  expect(out.mode).toBe('empty')
  expect(out.star).toBeNull()
  expect(out.subtitle).toBeNull()
})
```

- [ ] **Step 2:** Run all `current.test.js` tests; expect 3 PASS. If `orderBy().limit()` fake helper isn't returning correctly, fix `makeFakeDb`'s `where()` chain to support `orderBy().limit().get()` chain (the helper sketch above already supports this; if there's a TypeError, ensure `.orderBy()` returns the same wrapper object).

```bash
cd cloudfunctions/weekly-star && npx jest lib/__tests__/current.test.js --verbose
```

- [ ] **Step 3:** Commit.

```bash
git add cloudfunctions/weekly-star/lib/__tests__/current.test.js
git commit -- cloudfunctions/weekly-star/lib/__tests__/current.test.js -m "test(weekly-star): cover fallback & empty modes"
```

---

## Task 10: snapshot-writer — builder helper (TDD)

**Files:**
- Create: `cloudfunctions/weekly-star/lib/snapshot-writer.js`
- Create: `cloudfunctions/weekly-star/lib/__tests__/snapshot-writer.test.js`

- [ ] **Step 1:** Create the test:

```js
const { buildSnapshotRows } = require('../snapshot-writer')

describe('buildSnapshotRows', () => {
  test('produces one row per ranked entry with proper _id, effectiveAt, snapshotKind', () => {
    const ranked = [
      { memberId: 'A', totalPoints: 340, wins: 17, losses: 4 },
      { memberId: 'B', totalPoints: 285, wins: 12, losses: 5 }
    ]
    const week = { weekId: 'ws_2026-05-04', weekStart: '2026-05-04', weekEnd: '2026-05-10', end: new Date('2026-05-10T23:59:59') }
    const rows = buildSnapshotRows({
      ranked, week, seasonId: 's2026', type: 'singles', snapshotKind: 'weekly', computedAt: new Date('2026-05-11T00:30:00')
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      _id: 'rs_s2026_ws_2026-05-04_singles_A',
      seasonId: 's2026', weekId: 'ws_2026-05-04',
      weekStart: '2026-05-04', weekEnd: '2026-05-10',
      type: 'singles', memberId: 'A',
      rank: 1, totalPoints: 340, wins: 17, losses: 4,
      snapshotKind: 'weekly'
    })
    expect(rows[0].effectiveAt).toEqual(new Date('2026-05-10T23:59:59'))
    expect(rows[1].rank).toBe(2)
  })

  test('baseline kind uses caller-supplied effectiveAt (now)', () => {
    const ranked = [{ memberId: 'A', totalPoints: 100, wins: 5, losses: 1 }]
    const now = new Date('2026-05-16T10:00:00')
    const rows = buildSnapshotRows({
      ranked,
      week: { weekId: 'baseline_2026-05-16', weekStart: '2026-05-16', weekEnd: '2026-05-16', end: now },
      seasonId: 's2026', type: 'doubles', snapshotKind: 'baseline', computedAt: now
    })
    expect(rows[0].effectiveAt).toEqual(now)
    expect(rows[0].snapshotKind).toBe('baseline')
    expect(rows[0]._id).toBe('rs_s2026_baseline_2026-05-16_doubles_A')
  })
})
```

- [ ] **Step 2:** Run; expect failure.
- [ ] **Step 3:** Implement:

```js
function buildSnapshotRows({ ranked, week, seasonId, type, snapshotKind, computedAt }) {
  return ranked.map((entry, index) => ({
    _id: `rs_${seasonId}_${week.weekId}_${type}_${entry.memberId}`,
    seasonId,
    weekId: week.weekId,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    effectiveAt: week.end,
    type,
    memberId: entry.memberId,
    rank: index + 1,
    totalPoints: entry.totalPoints || 0,
    wins: entry.wins || 0,
    losses: entry.losses || 0,
    snapshotKind,
    computedAt
  }))
}

module.exports = { buildSnapshotRows }
```

- [ ] **Step 4:** Run; expect green.

```bash
cd cloudfunctions/weekly-star && npx jest lib/__tests__/snapshot-writer.test.js --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/weekly-star/lib/snapshot-writer.js cloudfunctions/weekly-star/lib/__tests__/snapshot-writer.test.js
git commit -- cloudfunctions/weekly-star/lib/snapshot-writer.js cloudfunctions/weekly-star/lib/__tests__/snapshot-writer.test.js -m "feat(weekly-star): buildSnapshotRows helper (TDD)"
```

---

## Task 11: `weekly-star/index.js` — wire `current` action

**Files:**
- Modify: `cloudfunctions/weekly-star/index.js`

- [ ] **Step 1:** At the top of the file, add the new require:

```js
const { getPreviousNaturalWeek, getCurrentNaturalWeek } = require('./lib/week-window')
const { resolveCurrentWeeklyStar } = require('./lib/current')
```

(Replace the existing `getPreviousNaturalWeek` line.)

- [ ] **Step 2:** Add the action handler before the existing `latest`/`compute` branches:

```js
if (action === 'current')  return await current(event)
```

- [ ] **Step 3:** Add the function definition (above `compute`):

```js
async function current({ seasonId = `s${new Date().getFullYear()}`, type = 'singles', now }) {
  if (type !== 'singles' && type !== 'doubles') {
    return { success: false, error: { code: 'INVALID_PAYLOAD', message: 'type must be singles|doubles' } }
  }
  const week = getCurrentNaturalWeek(now ? new Date(now) : new Date())
  const data = await resolveCurrentWeeklyStar({ db, seasonId, type, week })
  return { success: true, data }
}
```

- [ ] **Step 4:** Run any existing `cloudfunctions/weekly-star/__tests__/index.test.js`:

```bash
cd cloudfunctions/weekly-star && npx jest --verbose
```

Expected: no regressions.

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/weekly-star/index.js
git commit -- cloudfunctions/weekly-star/index.js -m "feat(weekly-star): expose current action backed by resolveCurrentWeeklyStar"
```

---

## Task 12: `weekly-star.compute` — double-write `rank_snapshots`

**Files:**
- Modify: `cloudfunctions/weekly-star/index.js`
- Modify: `cloudfunctions/weekly-star/__tests__/index.test.js`
- Create: `cloudfunctions/weekly-star/lib/aggregate.js`
- Modify: `scripts/sync-shared-libs.sh`

- [ ] **Step 1:** Add a failing integration test in `cloudfunctions/weekly-star/__tests__/index.test.js` (create file if absent). Use `jest.mock('wx-server-sdk', ...)` to inject an in-memory `db`, plus expose the upserts via a shared spy:

```js
const upserts = [] // captures every upsert call
const d = (key) => new Date(`${key}T00:00:00`)

jest.mock('wx-server-sdk', () => {
  const op = (__op, value) => ({
    __op,
    value,
    and(other) { return { __op: 'fieldAnd', clauses: [this, other] } }
  })
  const _ = {
    and: (cs) => ({ __op: 'and', clauses: cs }),
    or:  (cs) => ({ __op: 'or',  clauses: cs }),
    in:  (v)  => op('in', v),
    gte: (v)  => op('gte', v),
    lte: (v)  => op('lte', v),
    eq:  (v)  => op('eq', v)
  }
  const rows = { match_results: [], tournament_points: [], members: [], weekly_stars: [], rank_snapshots: [] }
  function rowMatches(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => rowMatches(row, c))
    if (f.__op === 'or')  return f.clauses.some(c => rowMatches(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'fieldAnd') {
        for (const clause of v.clauses) {
          if (clause.__op === 'gte' && !(c >= clause.value)) return false
          if (clause.__op === 'lte' && !(c <= clause.value)) return false
        }
      }
      else if (v && v.__op === 'gte') { if (!(c >= v.value)) return false }
      else if (v && v.__op === 'lte') { if (!(c <= v.value)) return false }
      else if (v && v.__op === 'in')  { if (!v.value.includes(c)) return false }
      else if (v && v.__op === 'eq')  { if (c !== v.value) return false }
      else if (v !== c) return false
    }
    return true
  }
  function applyOrder(data, orders) {
    return [...data].sort((a, b) => {
      for (const { field, dir } of orders) {
        const av = a[field]
        const bv = b[field]
        if (av < bv) return dir === 'desc' ? 1 : -1
        if (av > bv) return dir === 'desc' ? -1 : 1
      }
      return 0
    })
  }
  function makeCollection(name) {
    return {
      where(f) {
        const data = (rows[name] || []).filter(r => rowMatches(r, f))
        const orders = []
        const chain = {
          get: async () => ({ data: applyOrder(data, orders) }),
          orderBy(field, dir = 'asc') { orders.push({ field, dir }); return chain },
          limit(n)  { return { get: async () => ({ data: applyOrder(data, orders).slice(0, n) }) } },
          skip(s)   { return { ...chain, get: async () => ({ data: applyOrder(data, orders).slice(s) }), limit(n){ return { get: async () => ({ data: applyOrder(data, orders).slice(s, s+n) }) } } } }
        }
        return chain
      },
      doc(id) {
        return {
          update: async ({ data }) => { upserts.push({ collection: name, _id: id, data }); const i = rows[name].findIndex(r => r._id === id); if (i >= 0) rows[name][i] = { ...rows[name][i], ...data }; else rows[name].push({ _id: id, ...data }); return { stats: { updated: 1 } } },
          get: async () => { const r = rows[name].find(x => x._id === id); return { data: r || null } }
        }
      },
      add: async ({ data }) => { upserts.push({ collection: name, _id: data._id, data }); rows[name].push(data); return { _id: data._id } }
    }
  }
  const api = {
    DYNAMIC_CURRENT_ENV: 'dyn',
    init: () => {},
    getWXContext: () => ({ OPENID: api.__openid || 'admin-openid' }),
    database: () => ({ command: _, collection: makeCollection, serverDate: () => new Date() }),
    __rows: rows,
    __openid: 'admin-openid',
    __upserts: upserts
  }
  return api
})

describe('weekly-star.compute double-write', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.tournament_points.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.weekly_stars.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__openid = 'admin-openid'
    upserts.length = 0
  })

  test('compute writes one rank_snapshots row per ranked entry with snapshotKind=weekly + effectiveAt=lastWeekEnd', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: '陈思远', avatarUrl: 'a' }, { _id: 'B', name: '李志刚', avatarUrl: 'b' })
    cloud.__rows.match_results.push(
      { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: d('2026-05-05'), createTime: d('2026-05-05'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] } },
      { _id: 'm2', seasonId: 's2026', tournamentType: 'doubles', resultStatus: 'confirmed',
        confirmedAt: d('2026-05-06'), createTime: d('2026-05-06'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 15, role: 'winner' }, { memberId: 'B', points: 5, role: 'loser' }] } }
    )

    const { main } = require('../index')
    const res = await main({ action: 'compute', seasonId: 's2026', now: '2026-05-12T00:30:00' })
    expect(res.success).toBe(true)

    const snapshotRows = cloud.__rows.rank_snapshots
    expect(snapshotRows.length).toBe(4) // 2 ranked entries × 2 types
    const singles = snapshotRows.filter(r => r.type === 'singles')
    expect(singles.every(r => r.snapshotKind === 'weekly')).toBe(true)
    expect(singles.every(r => r.weekStart === '2026-05-04')).toBe(true)
    expect(singles.find(r => r.memberId === 'A').rank).toBe(1)
    expect(singles.find(r => r.memberId === 'B').rank).toBe(2)
  })

  test('idempotent: same week re-run does not create duplicate docs (upsert by _id)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    cloud.__rows.match_results.push({
      _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: d('2026-05-05'), createTime: d('2026-05-05'),
      pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }] }
    })
    const { main } = require('../index')
    await main({ action: 'compute', seasonId: 's2026', now: '2026-05-12T00:30:00' })
    await main({ action: 'compute', seasonId: 's2026', now: '2026-05-12T00:30:00' })
    // Only singles has ranked entries in this fixture; rerun upserts in place.
    expect(cloud.__rows.rank_snapshots.length).toBe(1)
  })
})
```

- [ ] **Step 2:** Run; confirm failure (no rows written).
- [ ] **Step 3:** Create the deployable local aggregate copy. WeChat cloud functions package each function directory independently, so `weekly-star` must not `require('../points-engine/...')`.

```bash
cp cloudfunctions/points-engine/lib/aggregate.js cloudfunctions/weekly-star/lib/aggregate.js
```

Then extend `scripts/sync-shared-libs.sh` with a hash check so future changes do not drift:

```bash
AGG_SRC="$ROOT/cloudfunctions/points-engine/lib/aggregate.js"
AGG_COPY="$ROOT/cloudfunctions/weekly-star/lib/aggregate.js"
if [ ! -f "$AGG_COPY" ]; then echo "[sync] missing: $AGG_COPY"; exit 1; fi
if [ "$(shasum256 "$AGG_SRC")" != "$(shasum256 "$AGG_COPY")" ]; then
  echo "[sync] aggregate.js mismatch: $AGG_SRC ↔ $AGG_COPY"
  diff "$AGG_SRC" "$AGG_COPY" || true
  exit 1
fi
echo "[sync] aggregate.js ok"
```

- [ ] **Step 4:** In `cloudfunctions/weekly-star/index.js`, modify `compute()` to also build & upsert snapshot rows. At the top of the file, add:

```js
const { buildSnapshotRows } = require('./lib/snapshot-writer')
const { aggregateRanks } = require('./lib/aggregate')
```

After the existing `await upsert('weekly_stars', doc._id, doc)`, add:

```js
const computedAt = new Date()
for (const type of ['singles', 'doubles']) {
  const ranked = await aggregateRanks({ db, seasonId, type, asOf: week.end })
  const rows = buildSnapshotRows({ ranked, week, seasonId, type, snapshotKind: 'weekly', computedAt })
  for (const r of rows) {
    await upsert('rank_snapshots', r._id, r)
  }
}
```

- [ ] **Step 5:** Run tests; confirm green.

```bash
cd cloudfunctions/weekly-star && npx jest --verbose
```

- [ ] **Step 6:** Run the shared-lib sync check.

```bash
bash scripts/sync-shared-libs.sh
```

Expected: includes `[sync] aggregate.js ok`.

- [ ] **Step 7:** Commit.

```bash
git add cloudfunctions/weekly-star/index.js cloudfunctions/weekly-star/__tests__/index.test.js cloudfunctions/weekly-star/lib/aggregate.js scripts/sync-shared-libs.sh
git commit -- cloudfunctions/weekly-star/index.js cloudfunctions/weekly-star/__tests__/index.test.js cloudfunctions/weekly-star/lib/aggregate.js scripts/sync-shared-libs.sh -m "feat(weekly-star): cron compute double-writes rank_snapshots"
```

---

## Task 13: `weekly-star.recomputeRankSnapshots` — admin action

**Files:**
- Modify: `cloudfunctions/weekly-star/index.js`
- Modify: `cloudfunctions/weekly-star/__tests__/index.test.js`

- [ ] **Step 1:** Append a failing test in `__tests__/index.test.js` (reuses the in-memory `wx-server-sdk` mock from Task 12):

```js
describe('weekly-star.recomputeRankSnapshots', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.rank_snapshots.length = 0
    cloud.__rows.members.length = 0
    cloud.__openid = 'admin-openid'
  })

  test('baseline=true → snapshotKind=baseline, weekId=baseline_<today>', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'ADMIN', openid: 'admin-openid', admin: true, name: 'Admin' })
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    cloud.__rows.match_results.push({
      _id: 'm', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: d('2026-04-01'), createTime: d('2026-04-01'),
      pointsAwarded: { entries: [{ memberId: 'A', points: 100, role: 'winner' }] }
    })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: true, now: '2026-05-16T10:00:00' })
    expect(res.success).toBe(true)
    expect(res.data.weekId).toBe('baseline_2026-05-16')
    const row = cloud.__rows.rank_snapshots.find(r => r.memberId === 'A' && r.type === 'singles')
    expect(row.snapshotKind).toBe('baseline')
    expect(row.rank).toBe(1)
  })

  test('baseline=false + weekStart → snapshotKind=weekly with proper weekId/weekEnd', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'ADMIN', openid: 'admin-openid', admin: true, name: 'Admin' })
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    cloud.__rows.match_results.push({
      _id: 'm', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
      confirmedAt: d('2026-04-15'), createTime: d('2026-04-15'),
      pointsAwarded: { entries: [{ memberId: 'A', points: 100, role: 'winner' }] }
    })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: false, weekStart: '2026-04-13' })
    expect(res.success).toBe(true)
    expect(res.data.weekId).toBe('ws_2026-04-13')
    const row = cloud.__rows.rank_snapshots.find(r => r.memberId === 'A' && r.type === 'singles')
    expect(row.snapshotKind).toBe('weekly')
    expect(row.weekStart).toBe('2026-04-13')
    expect(row.weekEnd).toBe('2026-04-19')
  })

  test('baseline=false without weekStart → INVALID_PAYLOAD', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'ADMIN', openid: 'admin-openid', admin: true, name: 'Admin' })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: false })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('INVALID_PAYLOAD')
  })

  test('non-admin caller → FORBIDDEN and writes no rows', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__openid = 'member-openid'
    cloud.__rows.members.push({ _id: 'M', openid: 'member-openid', admin: false, name: 'Member' })
    const { main } = require('../index')
    const res = await main({ action: 'recomputeRankSnapshots', seasonId: 's2026', baseline: true, now: '2026-05-16T10:00:00' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('FORBIDDEN')
    expect(cloud.__rows.rank_snapshots.length).toBe(0)
  })
})
```
- [ ] **Step 2:** Run; confirm failure (unknown action / no admin guard).
- [ ] **Step 3:** Add the admin guard and action to `index.js`:

```js
if (action === 'recomputeRankSnapshots') return await recomputeRankSnapshots(event)

async function resolveAdmin() {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID
  if (!openid) return null
  const res = await db.collection('members').where({ openid }).get()
  const member = res && res.data && res.data[0]
  if (!member) return null
  const isAdmin = (typeof member.admin === 'boolean') ? member.admin : !!member.isAdmin
  return isAdmin ? member : null
}

async function recomputeRankSnapshots({ seasonId = `s${new Date().getFullYear()}`, weekStart, weekEnd, baseline = false, now }) {
  const admin = await resolveAdmin()
  if (!admin) return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } }
  // baseline=true: weekStart/weekEnd default to today; weekId='baseline_<today>'
  // baseline=false: weekStart required; computes weekEnd as +6d; weekId=getWeekId(weekStart)
  const { getWeekId, toDateKey } = require('./lib/week-window')
  const computedAt = new Date(now || Date.now())
  let week
  if (baseline) {
    const day = toDateKey(computedAt)
    week = { weekId: `baseline_${day}`, weekStart: day, weekEnd: day, end: computedAt }
  } else {
    if (!weekStart) return { success: false, error: { code: 'INVALID_PAYLOAD', message: 'weekStart required when baseline=false' } }
    const start = new Date(weekStart)
    const end = new Date(start)
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    week = { weekId: getWeekId(start), weekStart: toDateKey(start), weekEnd: toDateKey(end), end }
  }
  const { aggregateRanks } = require('./lib/aggregate')
  const { buildSnapshotRows } = require('./lib/snapshot-writer')
  let totalRows = 0
  for (const type of ['singles', 'doubles']) {
    const asOf = baseline ? null : week.end
    const ranked = await aggregateRanks({ db, seasonId, type, asOf })
    const rows = buildSnapshotRows({ ranked, week, seasonId, type, snapshotKind: baseline ? 'baseline' : 'weekly', computedAt })
    for (const r of rows) await upsert('rank_snapshots', r._id, r)
    totalRows += rows.length
  }
  return { success: true, data: { weekId: week.weekId, totalRows } }
}
```

- [ ] **Step 4:** Run; confirm green.
- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/weekly-star/index.js cloudfunctions/weekly-star/__tests__/index.test.js
git commit -- cloudfunctions/weekly-star/index.js cloudfunctions/weekly-star/__tests__/index.test.js -m "feat(weekly-star): recomputeRankSnapshots action (baseline + weekly modes)"
```

---

## Task 14: `points-engine.rankList` — add `winRate` + `trendDelta` (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/points-engine/index.js`
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`

- [ ] **Step 1:** Add a complete test block to `cloudfunctions/points-engine/__tests__/index.test.js` using the same `jest.mock('wx-server-sdk', ...)` pattern from Task 12. The mock must implement real `orderBy(field, dir).limit(1)` sorting before slicing; otherwise the `effectiveAt DESC, computedAt DESC` test below is not meaningful.

```js
describe('rankList enhancements', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
  })

  function seedMatchesForMember(memberId, wins, losses, points = 20) {
    const cloud = require('wx-server-sdk')
    for (let i = 0; i < wins; i++) {
      cloud.__rows.match_results.push({
        _id: `mw_${memberId}_${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-01', createTime: '2026-04-01',
        pointsAwarded: { entries: [{ memberId, points, role: 'winner' }] }
      })
    }
    for (let i = 0; i < losses; i++) {
      cloud.__rows.match_results.push({
        _id: `ml_${memberId}_${i}`, seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: '2026-04-02', createTime: '2026-04-02',
        pointsAwarded: { entries: [{ memberId, points: 10, role: 'loser' }] }
      })
    }
  }

  test('winRate returned as 0..1 float (8W/2L → 0.8)', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a', avatarUrl: '' })
    seedMatchesForMember('A', 8, 2)
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0]._id).toBe('A')
    expect(res.data.rankList[0].winRate).toBeCloseTo(0.8, 5)
  })

  test('winRate = 0 when member has 0 matches', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    // Member counts in aggregateRanks only via match_results; with no rows, list is empty —
    // synthesize an explicit zero row via tournament_points to exercise the divide-by-zero guard.
    cloud.__rows.tournament_points = cloud.__rows.tournament_points || []
    cloud.__rows.tournament_points.push({
      _id: 'tp1', seasonId: 's2026', tournamentType: 'singles', memberId: 'A', points: 5,
      awardedAt: '2026-04-01', createTime: '2026-04-01'
    })
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0].winRate).toBe(0)
  })

  test('trendDelta = null when no rank_snapshots row exists', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    seedMatchesForMember('A', 1, 0)
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0].trendDelta).toBeNull()
  })

  test('trendDelta picks latest snapshot by effectiveAt DESC, computedAt DESC', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' }, { _id: 'B', name: 'b' }, { _id: 'C', name: 'c' })
    seedMatchesForMember('A', 5, 1, 40)
    seedMatchesForMember('B', 3, 2, 20)
    seedMatchesForMember('C', 1, 4, 10)
    // A current rank should be 1 (highest pts). Snapshots:
    cloud.__rows.rank_snapshots.push(
      { _id: 's1', seasonId: 's2026', type: 'singles', memberId: 'A', rank: 5,
        effectiveAt: new Date('2026-05-16T10:00:00'), computedAt: new Date('2026-05-16T10:00:00'),
        snapshotKind: 'baseline' },
      { _id: 's2', seasonId: 's2026', type: 'singles', memberId: 'A', rank: 4,
        effectiveAt: new Date('2026-05-17T23:59:59'), computedAt: new Date('2026-05-18T00:30:00'),
        snapshotKind: 'weekly' }
    )
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    const rowA = res.data.rankList.find(r => r._id === 'A')
    // current rank A = 1 (highest pts), latest snapshot rank = 4 → trendDelta = 4 - 1 = 3
    expect(rowA.trendDelta).toBe(3)
  })

  test('trendDelta = 0 when snapshot rank equals current rank', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'A', name: 'a' })
    seedMatchesForMember('A', 1, 0)
    cloud.__rows.rank_snapshots.push({
      _id: 's1', seasonId: 's2026', type: 'singles', memberId: 'A', rank: 1,
      effectiveAt: new Date('2026-05-16T10:00:00'), computedAt: new Date('2026-05-16T10:00:00'),
      snapshotKind: 'baseline'
    })
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 's2026' })
    expect(res.data.rankList[0].trendDelta).toBe(0)
  })
})
```

- [ ] **Step 2:** Run; confirm failures.
- [ ] **Step 3:** In `cloudfunctions/points-engine/index.js`, locate `rankListCompat` (around line 54). Replace with:

```js
async function rankListCompat({ type = 'singles', currentSeasonId }) {
  if (!currentSeasonId) return { success: true, data: { rankList: [] } }
  const list = await aggregateRanks({ db, seasonId: currentSeasonId, type, pageSize: 100 })
  const joined = await joinMembers(list)
  // Attach winRate
  const withWinRate = joined.map(row => {
    const matches = (row.winCount || 0) + (row.lossCount || 0)
    return { ...row, winRate: matches > 0 ? row.winCount / matches : 0 }
  })
  // Attach trendDelta via latest snapshot per member
  const memberIds = withWinRate.map(r => r._id)
  const snapshotMap = await fetchLatestSnapshotMap({ seasonId: currentSeasonId, type, memberIds })
  const out = withWinRate.map((row, i) => {
    const currentRank = i + 1
    const snap = snapshotMap.get(row._id)
    const trendDelta = snap ? (snap.rank - currentRank) : null
    return { ...row, trendDelta }
  })
  return { success: true, data: { rankList: out } }
}

async function fetchLatestSnapshotMap({ seasonId, type, memberIds }) {
  if (!memberIds || memberIds.length === 0) return new Map()
  const _ = db.command
  const out = new Map()
  const chunkSize = 20
  for (let i = 0; i < memberIds.length; i += chunkSize) {
    const chunk = memberIds.slice(i, i + chunkSize)
    // Fetch latest snapshot per member: pull up to 1 row per memberId by effectiveAt DESC, computedAt DESC
    // Strategy: for each member, do a single-doc query (small N, OK).
    for (const memberId of chunk) {
      const res = await db.collection('rank_snapshots')
        .where({ seasonId, type, memberId })
        .orderBy('effectiveAt', 'desc')
        .orderBy('computedAt', 'desc')
        .limit(1)
        .get()
      const row = res && res.data && res.data[0]
      if (row) out.set(memberId, row)
    }
  }
  return out
}
```

- [ ] **Step 4:** Run; confirm green.

```bash
cd cloudfunctions/points-engine && npx jest --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js
git commit -- cloudfunctions/points-engine/index.js cloudfunctions/points-engine/__tests__/index.test.js -m "feat(points-engine): rankList returns winRate + trendDelta"
```

---

## Task 15: `members.update` — tighten `playStyleNote` 100 → 50 (RED → GREEN)

**Files:**
- Modify: `cloudfunctions/members/lib/validate.js`
- Create: `cloudfunctions/members/__tests__/validate.test.js`

- [ ] **Step 1:** Create the test file:

```js
const { validateMemberData, VALID_PLAY_STYLES } = require('../lib/validate')

describe('validateMemberData', () => {
  test('null/undefined/empty playStyle is OK', () => {
    expect(validateMemberData({ playStyle: null }).valid).toBe(true)
    expect(validateMemberData({ playStyle: '' }).valid).toBe(true)
    expect(validateMemberData({}).valid).toBe(true)
  })

  test('all 5 enum values OK', () => {
    for (const s of VALID_PLAY_STYLES) {
      expect(validateMemberData({ playStyle: s }).valid).toBe(true)
    }
  })

  test('unknown playStyle rejected', () => {
    const v = validateMemberData({ playStyle: 'unknown-style' })
    expect(v.valid).toBe(false)
    expect(v.errors[0]).toMatch(/playStyle 必须是/)
  })

  test('playStyleNote ≤ 50 chars OK', () => {
    const note50 = 'x'.repeat(50)
    expect(validateMemberData({ playStyleNote: note50 }).valid).toBe(true)
  })

  test('playStyleNote > 50 chars rejected', () => {
    const note51 = 'x'.repeat(51)
    const v = validateMemberData({ playStyleNote: note51 })
    expect(v.valid).toBe(false)
    expect(v.errors[0]).toMatch(/50/)
  })

  test('playStyleNote null OK', () => {
    expect(validateMemberData({ playStyleNote: null }).valid).toBe(true)
  })
})
```

- [ ] **Step 2:** Run; confirm `playStyleNote > 50` test fails (current cap is 100).

```bash
cd cloudfunctions/members && npx jest --verbose
```

- [ ] **Step 3:** Edit `cloudfunctions/members/lib/validate.js`:

```js
const MAX_NOTE_LENGTH = 50;

function validateMemberData(data) {
  const errors = [];
  if (data.playStyle != null && data.playStyle !== '' && !VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`);
  }
  if (data.playStyleNote != null && typeof data.playStyleNote === 'string' && data.playStyleNote.length > MAX_NOTE_LENGTH) {
    errors.push(`备注最多 ${MAX_NOTE_LENGTH} 字`);
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateMemberData, VALID_PLAY_STYLES, MAX_NOTE_LENGTH };
```

- [ ] **Step 4:** Run; confirm green.

```bash
cd cloudfunctions/members && npx jest --verbose
```

- [ ] **Step 5:** Commit.

```bash
git add cloudfunctions/members/lib/validate.js cloudfunctions/members/__tests__/validate.test.js
git commit -- cloudfunctions/members/lib/validate.js cloudfunctions/members/__tests__/validate.test.js -m "feat(members): tighten playStyleNote cap to 50 chars + unit tests"
```

---

## Task 16: W0 Backfill Script

**Files:**
- Create: `scripts/backfill-rank-snapshots-W0.js`
- Create: `scripts/__tests__/backfill-rank-snapshots-W0.test.js`

- [ ] **Step 1:** Create the test file. Since the script wraps `wx-server-sdk` initialization at top-level, the test exercises only the **side-effect-free core**: extract the snapshot-build + upsert loop into an exported function `runBackfill(deps)` that takes `db` as a parameter, and test that function:

```js
// scripts/__tests__/backfill-rank-snapshots-W0.test.js
const path = require('path')
const { runBackfill } = require('../backfill-rank-snapshots-W0')

function makeFakeDb({ matches = [], placements = [], members = [] } = {}) {
  const _ = {
    and: cs => ({ __op: 'and', clauses: cs }),
    or:  cs => ({ __op: 'or',  clauses: cs }),
    in:  v  => ({ __op: 'in',  value: v }),
    gte: v  => ({ __op: 'gte', value: v }),
    lte: v  => ({ __op: 'lte', value: v }),
    eq:  v  => ({ __op: 'eq',  value: v })
  }
  function rowMatches(row, f) {
    if (!f) return true
    if (f.__op === 'and') return f.clauses.every(c => rowMatches(row, c))
    if (f.__op === 'or')  return f.clauses.some(c => rowMatches(row, c))
    for (const [k, v] of Object.entries(f)) {
      const c = row[k]
      if (v && v.__op === 'gte') { if (!(c >= v.value)) return false }
      else if (v && v.__op === 'lte') { if (!(c <= v.value)) return false }
      else if (v && v.__op === 'in')  { if (!v.value.includes(c)) return false }
      else if (v && v.__op === 'eq')  { if (c !== v.value) return false }
      else if (v !== c) return false
    }
    return true
  }
  const rows = { match_results: matches, tournament_points: placements, members, rank_snapshots: [] }
  const upserts = []
  function makeColl(name) {
    return {
      where(f) {
        const data = (rows[name] || []).filter(r => rowMatches(r, f))
        const chain = {
          get: async () => ({ data }),
          orderBy() { return chain },
          limit(n)  { return { get: async () => ({ data: data.slice(0, n) }) } },
          skip(s)   { return { ...chain, get: async () => ({ data: data.slice(s) }), limit(n){ return { get: async () => ({ data: data.slice(s, s+n) }) } } } }
        }
        return chain
      },
      doc(id) {
        return {
          update: async ({ data }) => {
            upserts.push({ collection: name, _id: id, data })
            const i = rows[name].findIndex(r => r._id === id)
            if (i >= 0) rows[name][i] = { ...rows[name][i], ...data }
            else rows[name].push({ _id: id, ...data })
            return { stats: { updated: 1 } }
          },
          get: async () => {
            const r = rows[name].find(x => x._id === id)
            return { data: r || null }
          }
        }
      },
      add: async ({ data }) => { upserts.push({ collection: name, _id: data._id, data }); rows[name].push(data); return { _id: data._id } }
    }
  }
  return { db: { command: _, collection: makeColl, serverDate: () => new Date() }, rows, upserts }
}

describe('runBackfill (W0 baseline)', () => {
  test('writes baseline rows with snapshotKind=baseline, weekId=baseline_<today>', async () => {
    const { db, rows, upserts } = makeFakeDb({
      members: [{ _id: 'A', name: 'a' }, { _id: 'B', name: 'b' }],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-04-01', createTime: '2026-04-01',
          pointsAwarded: { entries: [{ memberId: 'A', points: 30, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] } }
      ]
    })
    const now = new Date('2026-05-16T10:00:00')
    const result = await runBackfill({ db, seasonId: 's2026', now })
    expect(result.total).toBeGreaterThanOrEqual(2)
    const singles = rows.rank_snapshots.filter(r => r.type === 'singles')
    expect(singles[0].snapshotKind).toBe('baseline')
    expect(singles[0].weekId).toBe('baseline_2026-05-16')
    expect(singles[0].effectiveAt).toEqual(now)
    expect(singles.find(r => r.memberId === 'A').rank).toBe(1)
  })

  test('same-day re-run is idempotent (upsert by _id, no duplicate)', async () => {
    const { db, rows } = makeFakeDb({
      members: [{ _id: 'A', name: 'a' }],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-04-01', createTime: '2026-04-01',
          pointsAwarded: { entries: [{ memberId: 'A', points: 30, role: 'winner' }] } }
      ]
    })
    const now = new Date('2026-05-16T10:00:00')
    await runBackfill({ db, seasonId: 's2026', now })
    await runBackfill({ db, seasonId: 's2026', now })
    // Only singles has a ranked entry in this fixture; same-day re-run upserts in place.
    expect(rows.rank_snapshots.length).toBe(1)
  })

  test('different-day re-run produces new rows with different _id', async () => {
    const { db, rows } = makeFakeDb({
      members: [{ _id: 'A', name: 'a' }],
      matches: [
        { _id: 'm1', seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed',
          confirmedAt: '2026-04-01', createTime: '2026-04-01',
          pointsAwarded: { entries: [{ memberId: 'A', points: 30, role: 'winner' }] } }
      ]
    })
    await runBackfill({ db, seasonId: 's2026', now: new Date('2026-05-16T10:00:00') })
    await runBackfill({ db, seasonId: 's2026', now: new Date('2026-05-17T10:00:00') })
    // Only singles has a ranked entry in this fixture; 1 ranked entry × 2 baseline days.
    expect(rows.rank_snapshots.length).toBe(2)
    const ids = rows.rank_snapshots.map(r => r._id).sort()
    expect(new Set(ids).size).toBe(4) // all unique
  })
})
```

- [ ] **Step 2:** Run; confirm failure.
- [ ] **Step 3:** Implement `scripts/backfill-rank-snapshots-W0.js`. Expose `runBackfill(deps)` as a pure function (for testability) and only initialize `wx-server-sdk` when run as CLI:

```js
#!/usr/bin/env node
const path = require('path')

const { aggregateRanks } = require(path.join(__dirname, '..', 'cloudfunctions', 'points-engine', 'lib', 'aggregate'))
const { buildSnapshotRows } = require(path.join(__dirname, '..', 'cloudfunctions', 'weekly-star', 'lib', 'snapshot-writer'))
const { toDateKey } = require(path.join(__dirname, '..', 'cloudfunctions', 'weekly-star', 'lib', 'week-window'))

async function runBackfill({ db, seasonId, now = new Date() }) {
  const day = toDateKey(now)
  const week = { weekId: `baseline_${day}`, weekStart: day, weekEnd: day, end: now }
  let total = 0
  for (const type of ['singles', 'doubles']) {
    const ranked = await aggregateRanks({ db, seasonId, type, pageSize: 100 })
    const rows = buildSnapshotRows({ ranked, week, seasonId, type, snapshotKind: 'baseline', computedAt: now })
    for (const r of rows) {
      try {
        await db.collection('rank_snapshots').doc(r._id).update({ data: r })
      } catch (e) {
        await db.collection('rank_snapshots').add({ data: r })
      }
      total++
    }
  }
  return { total }
}

async function mainCli() {
  const cloud = require('wx-server-sdk')
  cloud.init({ env: process.env.WX_CLOUD_ENV || cloud.DYNAMIC_CURRENT_ENV })
  const db = cloud.database()
  const seasonId = process.env.SEASON_ID || `s${new Date().getFullYear()}`
  const { total } = await runBackfill({ db, seasonId, now: new Date() })
  console.log(`[backfill] wrote ${total} baseline rows for seasonId=${seasonId}`)
}

if (require.main === module) {
  mainCli().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
}

module.exports = { runBackfill }
```

- [ ] **Step 4:** Run tests.

```bash
cd /Users/liaoxiaole/FOPEN-PURE && npx jest scripts/__tests__/backfill-rank-snapshots-W0.test.js --verbose
```

(If the project root doesn't have a Jest config that picks up `scripts/__tests__`, add the path to the `scripts/package.json` test config, or invoke with `--testPathPattern=scripts/`.)

- [ ] **Step 5:** Commit.

```bash
git add scripts/backfill-rank-snapshots-W0.js scripts/__tests__/backfill-rank-snapshots-W0.test.js
git commit -- scripts/backfill-rank-snapshots-W0.js scripts/__tests__/backfill-rank-snapshots-W0.test.js -m "feat(scripts): W0 baseline backfill for rank_snapshots"
```

---

## Task 17: `rank-row` component — 5-col layout + new props

**Files:**
- Modify: `miniprogram/components/rank-row/index.js`
- Modify: `miniprogram/components/rank-row/index.wxml`
- Modify: `miniprogram/components/rank-row/index.wxss`

- [ ] **Step 1:** Update `index.js` props:

```js
Component({
  properties: {
    rank: Number,
    name: String,
    avatarUrl: String,
    winRate: { type: Number, value: 0 },        // 0.0–1.0
    totalPoints: { type: Number, value: 0 },
    trendDelta: { type: null, value: null },    // null | number; null=no data
    highlight: Boolean,
    playerId: String
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { playerId: this.data.playerId });
    }
  }
});
```

- [ ] **Step 2:** Replace `index.wxml` with 5-col grid:

```xml
<view class="rank-row {{highlight ? 'highlight' : ''}}" bindtap="onTap">
  <view class="rank-num-cell">
    <text class="rank-num num">{{rank < 10 ? '0' + rank : rank}}</text>
  </view>

  <view class="player-cell">
    <image class="avatar" src="{{avatarUrl || '/images/icons/avatar.png'}}" mode="aspectFill" />
    <text class="name">{{name}}</text>
  </view>

  <view class="winrate-cell">
    <text class="winrate num">{{winRate > 0 ? Math.round(winRate * 100) + '%' : '—'}}</text>
  </view>

  <view class="pts-cell">
    <text class="pts num">{{totalPoints}}</text>
  </view>

  <view class="trend-cell">
    <block wx:if="{{trendDelta !== null && trendDelta > 0}}">
      <text class="trend-arrow trend-up">▲{{trendDelta}}</text>
    </block>
    <block wx:elif="{{trendDelta !== null && trendDelta < 0}}">
      <text class="trend-arrow trend-down">▼{{-trendDelta}}</text>
    </block>
    <text wx:else class="trend-flat">—</text>
  </view>
</view>
```

**Note:** WXML data binding does not support `Math.round`. Replace the winrate line with a pre-formatted property (compute the display string in the parent page's `setData` step), OR add a WXS module. Simplest: convert `winRate` to a pre-formatted string `winRatePct` in the page JS before passing to `<rank-row>`. Adjust prop:

```js
winRatePct: String,    // e.g. "71%" or "—"
```

And WXML:

```xml
<text class="winrate num">{{winRatePct || '—'}}</text>
```

Update `index.js` props accordingly. The page (Task 19) will format the value.

- [ ] **Step 3:** Update `index.wxss` to use a 5-col grid. Set `grid-template-columns` to the same dimensions as the list header in the rank page (next task).

```css
.rank-row {
  display: grid;
  grid-template-columns: 64rpx 1fr 80rpx 80rpx 80rpx;
  gap: 12rpx;
  align-items: center;
  padding: 16rpx 24rpx;
  border-bottom: 1rpx solid var(--color-border);
}
.rank-row.highlight { background: var(--color-bg-3); border-left: 4rpx solid var(--color-lime); }
.rank-num-cell { text-align: left; }
.player-cell { display: flex; align-items: center; gap: 12rpx; min-width: 0; }
.player-cell .avatar { width: 56rpx; height: 56rpx; border-radius: 50%; }
.player-cell .name { font-size: 28rpx; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.winrate-cell, .pts-cell, .trend-cell { text-align: right; }
.winrate { font-size: 26rpx; font-weight: 700; }
.pts { font-size: 28rpx; font-weight: 900; }
.trend-arrow { font-size: 24rpx; font-weight: 700; }
.trend-up { color: var(--color-success, #16A34A); }
.trend-down { color: var(--color-danger, #DC2626); }
.trend-flat { color: var(--color-muted-2, #9CA3AF); }
```

(If existing tokens differ, match them; the visual-revamp stream has defined these tokens.)

- [ ] **Step 4:** Visual sanity check: open WeChat DevTools and verify rank-row renders 5 columns. Test rendering by manually mounting in a sandbox page if needed.
- [ ] **Step 5:** Commit.

```bash
git add miniprogram/components/rank-row/index.js miniprogram/components/rank-row/index.wxml miniprogram/components/rank-row/index.wxss
git commit -- miniprogram/components/rank-row/index.js miniprogram/components/rank-row/index.wxml miniprogram/components/rank-row/index.wxss -m "feat(rank-row): 5-col layout (rank/player/winrate/pts/trend) + new props"
```

---

## Task 18: `rank` page — drop champion hero, weekly-star becomes only hero

**Files:**
- Modify: `miniprogram/pages/rank/index.js`
- Modify: `miniprogram/pages/rank/index.wxml`
- Modify: `miniprogram/pages/rank/index.wxss`

- [ ] **Step 1:** Edit `pages/rank/index.js`. Replace data + onShow + loadRank/loadWeeklyStar:

```js
const { callFunction } = require('../../utils/cloud')

Page({
  data: {
    activeTab: 'singles',
    rankList: [],              // each row enriched with winRatePct + trendDelta
    currentMember: null,
    starHero: null,            // { mode, star, subtitle, weekStart, weekEnd } from weekly-star.current
    loading: false,
    seasonYear: new Date().getFullYear(),
    rankTabOptions: [
      { label: 'SINGLES', value: 'singles' },
      { label: 'DOUBLES', value: 'doubles' }
    ]
  },

  async onShow() {
    this.setData({ currentMember: getApp().globalData.currentMember })
    await Promise.all([this.loadRank(), this.loadHero()])
  },

  async loadRank() {
    this.setData({ loading: true })
    try {
      const res = await callFunction({
        name: 'points-engine',
        data: {
          action: 'rankList',
          type: this.data.activeTab,
          currentSeasonId: `s${this.data.seasonYear}`
        }
      })
      const list = (res && res.result && res.result.data && res.result.data.rankList) || []
      const enriched = list.map(row => ({
        ...row,
        winRatePct: row.winRate > 0 ? `${Math.round(row.winRate * 100)}%` : '—'
      }))
      this.setData({ rankList: enriched })
    } catch (err) {
      console.error('[rank] loadRank', err)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadHero() {
    try {
      const res = await callFunction({
        name: 'weekly-star',
        data: {
          action: 'current',
          seasonId: `s${this.data.seasonYear}`,
          type: this.data.activeTab
        }
      })
      const d = res && res.result && res.result.data
      this.setData({ starHero: d || { mode: 'empty', star: null, subtitle: null } })
    } catch (err) {
      console.error('[rank] loadHero', err)
      this.setData({ starHero: { mode: 'empty', star: null, subtitle: null } })
    }
  },

  onTabChange(e) {
    const tab = (e.detail && e.detail.value) || (e.currentTarget && e.currentTarget.dataset.tab)
    if (!tab || tab === this.data.activeTab) return
    this.setData({ activeTab: tab })
    this.loadRank()
    this.loadHero()
  },

  onPlayerTap(e) {
    const playerId = e.detail && e.detail.playerId
    if (!playerId) return
    wx.navigateTo({ url: `/pages/player-detail/index?id=${playerId}` })
  },

  onStarTap() {
    const hero = this.data.starHero
    if (!hero || !hero.star || !hero.star.memberId) return
    wx.navigateTo({ url: `/pages/player-detail/index?id=${hero.star.memberId}` })
  }
})
```

- [ ] **Step 2:** Edit `pages/rank/index.wxml`. Remove the champion block (lines 25–42 in the current file). Replace the WEEKLY STAR block with one driven by `starHero`:

```xml
<!-- HERO: 每周之星（唯一 hero） -->
<view wx:if="{{starHero && starHero.mode !== 'empty'}}"
      class="star-card anim-stage-rise anim-delay-2"
      bindtap="onStarTap">
  <view class="star-tape-wrap">
    <text wx:if="{{starHero.mode === 'current'}}" class="tape tape-lime">★ WEEKLY STAR</text>
    <text wx:else class="tape">PREV WEEK · 上周冠军</text>
    <text class="star-range">{{starHero.weekStart}} – {{starHero.weekEnd}}</text>
  </view>
  <view class="star-body">
    <image class="star-avatar"
           src="{{(starHero.star && starHero.star.avatarUrl) || '/images/icons/usercenter.png'}}"
           mode="aspectFill" />
    <view class="star-info">
      <text class="star-name">{{starHero.star && starHero.star.name}}</text>
      <text class="star-subtitle">{{starHero.subtitle}}</text>
    </view>
    <view class="star-cta-arrow">→</view>
  </view>
</view>
```

Update LIST HEADER to 5 cols:

```xml
<view class="list-head">
  <text class="list-col list-col-rank">RANK</text>
  <text class="list-col list-col-player">PLAYER</text>
  <text class="list-col list-col-winrate">WIN%</text>
  <text class="list-col list-col-pts">PTS</text>
  <text class="list-col list-col-trend">TREND</text>
</view>
```

Update `<rank-row>` invocation:

```xml
<rank-row
  wx:for="{{rankList}}" wx:key="_id"
  rank="{{index + 1}}"
  name="{{item.name}}"
  avatar-url="{{item.avatarUrl}}"
  win-rate-pct="{{item.winRatePct}}"
  total-points="{{item.totalPoints}}"
  trend-delta="{{item.trendDelta}}"
  player-id="{{item._id}}"
  highlight="{{currentMember && item._id === currentMember._id}}"
  bind:tap="onPlayerTap"
/>
```

(Remove the previous `wx:if="{{weeklyStar || index > 0}}"` clause — list now shows everyone including rank 1.)

- [ ] **Step 3:** Update `pages/rank/index.wxss`:
  - Remove `.champion`-related styles
  - Add `.star-card { cursor: pointer; }` and `.star-cta-arrow { font-size: 36rpx; font-weight: 800; }`
  - Update `.list-head` grid template to match 5-col rank-row (`64rpx 1fr 80rpx 80rpx 80rpx`)
- [ ] **Step 4:** Smoke test in DevTools: open rank page, verify
  - Champion hero is gone
  - Weekly star card is present, tappable, with subtitle
  - List header has 5 cols aligned to rank-row cells
  - Tap weekly star navigates to player-detail
- [ ] **Step 5:** Commit.

```bash
git add miniprogram/pages/rank/index.js miniprogram/pages/rank/index.wxml miniprogram/pages/rank/index.wxss
git commit -- miniprogram/pages/rank/index.js miniprogram/pages/rank/index.wxml miniprogram/pages/rank/index.wxss -m "feat(rank): weekly-star becomes only hero (tappable), 5-col list, drop champion card"
```

---

## Task 19: `edit-profile` — playStyle picker + playStyleNote textarea

**Files:**
- Modify: `miniprogram/pages/edit-profile/index.js`
- Modify: `miniprogram/pages/edit-profile/index.wxml`
- Modify: `miniprogram/pages/edit-profile/index.wxss`

- [ ] **Step 1:** In `index.js`:
  - Add `playStyle` and `playStyleNote` fields to `data.formData`
  - Define `PLAY_STYLE_OPTIONS = [{value:'baseliner',label:'底线型'}, {value:'serve-volleyer',label:'发球上网'}, {value:'all-court',label:'全场型'}, {value:'counter-puncher',label:'反击型'}, {value:'aggressive-baseliner',label:'进攻底线型'}]`
  - In `loadUserInfo`, populate `formData.playStyle` and `formData.playStyleNote` from the returned member doc
  - Add handlers `onPlayStyleChange(e)` (radio-group `bindchange`) and `onPlayStyleNoteInput(e)` (textarea `bindinput`)
  - Replace `wx.cloud.callFunction` with the `utils/cloud.callFunction` wrapper for the update call; payload includes `playStyle`, `playStyleNote`
  - On success, update `getApp().globalData.currentMember` with the new values
  - Preserve existing handlers (`onChooseAvatar`, `uploadAvatar`, `onNameInput`, `onPhoneInput`, `onCancel`) from the current file. Do **not** paste a wholesale `Page({ ... })` replacement that drops avatar upload or existing validation.

  The following is the target shape after merging the new fields into the existing file:

```js
const { callFunction } = require('../../utils/cloud')

const PLAY_STYLE_OPTIONS = [
  { value: 'baseliner',            label: '底线型' },
  { value: 'serve-volleyer',       label: '发球上网' },
  { value: 'all-court',            label: '全场型' },
  { value: 'counter-puncher',      label: '反击型' },
  { value: 'aggressive-baseliner', label: '进攻底线型' }
]
const NOTE_MAX = 50

Page({
  data: {
    defaultAvatar: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCsl1PaL2XUIPcnYgicQ/132',
    formData: { name: '', phone: '', avatarUrl: '', playStyle: null, playStyleNote: '' },
    playStyleOptions: PLAY_STYLE_OPTIONS,
    noteMax: NOTE_MAX
  },

  onLoad() { this.loadUserInfo() },

  async loadUserInfo() {
    try {
      const res = await callFunction({ name: 'members', data: { action: 'get' } })
      const user = res && res.result && res.result.data && res.result.data[0]
      if (!user) return
      this.setData({
        formData: {
          name: user.name || '',
          phone: user.phone || '',
          avatarUrl: user.avatarUrl || '',
          playStyle: user.playStyle || null,
          playStyleNote: user.playStyleNote || ''
        }
      })
    } catch (err) {
      console.error('[edit-profile] loadUserInfo', err)
    }
  },

  onPlayStyleChange(e) {
    this.setData({ 'formData.playStyle': e.detail.value || null })
  },

  onPlayStyleNoteInput(e) {
    const v = (e.detail.value || '').slice(0, NOTE_MAX)
    this.setData({ 'formData.playStyleNote': v })
  },

  async onSave() {
    const { name, phone, avatarUrl, playStyle, playStyleNote } = this.data.formData
    if (!name || !name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '手机号格式错误', icon: 'none' })
      return
    }
    const res = await callFunction({
      name: 'members',
      data: { action: 'update', data: { name, phone, avatarUrl, playStyle: playStyle || null, playStyleNote: playStyleNote || null } }
    })
    if (res && res.result && res.result.errMsg && res.result.errMsg.indexOf('ok') === -1 && res.result.success === false) {
      wx.showToast({ title: (res.result.error && res.result.error.message) || '保存失败', icon: 'none' })
      return
    }
    const app = getApp()
    if (app && app.globalData) {
      app.globalData.currentMember = {
        ...(app.globalData.currentMember || {}),
        name, phone, avatarUrl, playStyle: playStyle || null, playStyleNote: playStyleNote || null
      }
    }
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
  },

  // existing handlers (onChooseAvatar / uploadAvatar / onNameInput / onPhoneInput / onCancel) unchanged
})
```

- [ ] **Step 2:** In `index.wxml`, after the existing phone input row, add:

```xml
<view class="form-row">
  <text class="form-label">打法</text>
  <radio-group bindchange="onPlayStyleChange">
    <label class="ps-radio" wx:for="{{playStyleOptions}}" wx:key="value">
      <radio value="{{item.value}}" checked="{{formData.playStyle === item.value}}"/>
      <text class="ps-radio-label">{{item.label}}</text>
    </label>
  </radio-group>
</view>

<view class="form-row">
  <text class="form-label">打法备注</text>
  <textarea
    class="form-textarea"
    placeholder="例：贝克汉心理 / 喜欢正手暴扣 / 接发抢攻"
    maxlength="{{noteMax}}"
    value="{{formData.playStyleNote}}"
    bindinput="onPlayStyleNoteInput"
  />
  <text class="form-counter">{{formData.playStyleNote.length || 0}}/{{noteMax}}</text>
</view>
```

- [ ] **Step 3:** Update `index.wxss` to style `.form-row`, `.form-label`, `.ps-radio`, `.ps-radio-label`, `.form-textarea`, `.form-counter`. Mirror the visual tokens used elsewhere in the project (`var(--color-ink)`, `var(--color-bg-2)`, etc.).

- [ ] **Step 4:** Smoke test in DevTools: open Mine → Edit Profile, change playStyle radio, type 50 chars in textarea, hit save. Then navigate to your own player-detail and verify the playStyle pill displays.

- [ ] **Step 5:** Commit.

```bash
git add miniprogram/pages/edit-profile/index.js miniprogram/pages/edit-profile/index.wxml miniprogram/pages/edit-profile/index.wxss
git commit -- miniprogram/pages/edit-profile/index.js miniprogram/pages/edit-profile/index.wxml miniprogram/pages/edit-profile/index.wxss -m "feat(edit-profile): playStyle picker + 50-char playStyleNote textarea"
```

---

## Task 20: Full regression + manual E2E checklist + PROGRESS entry

**Files:**
- Modify: `docs/superpowers/plans/PROGRESS.md`

- [ ] **Step 1:** Run the full cloud-function test suite from the repo root:

```bash
for d in cloudfunctions/*/; do
  if [ -f "$d/package.json" ] && grep -q '"test"' "$d/package.json"; then
    echo "=== $d ==="
    (cd "$d" && npm test --silent) || { echo "FAILED $d"; exit 1; }
  fi
done
```

Expected: all green. Cross-check existing 191 cloud tests still pass; new Phase 10-1 tests added on top.

- [ ] **Step 2:** Run miniprogram tests (if any exist for the touched pages/components):

```bash
cd /Users/liaoxiaole/FOPEN-PURE && npm test --silent 2>/dev/null || echo "(no top-level mp tests)"
```

- [ ] **Step 3:** Run manual E2E (these need WeChat DevTools — write findings into PROGRESS.md as you go):

| # | Scenario | Pass Criteria |
|---|---|---|
| E2E-1 | Login → Mine → Edit Profile → pick `baseliner` + type 30 chars → Save | playStyle pill shows on player-detail; about section shows note |
| E2E-2 | Admin runs `weekly-star.recomputeRankSnapshots({ baseline:true })` → wait → record a match where two members swap rank → reload rank page | trend column shows ▲N / ▼N for the affected rows |
| E2E-3 | rank → tap weekly star card | navigates to player-detail of the starred member |
| E2E-5 | (Local fixture) clear all confirmed matches this week → reload rank | hero label `PREV WEEK · 上周冠军`, subtitle `等本周首场` |

(E2E-4 and E2E-6 belong to Phase 10-2.)

- [ ] **Step 4:** Create/verify the 4 required `rank_snapshots` indexes in the target cloud environment before running E2E:

| Index | Fields |
|---|---|
| `rank_snapshots_week_rank` | `seasonId ASC`, `type ASC`, `weekStart DESC`, `rank ASC` |
| `rank_snapshots_member_history` | `seasonId ASC`, `type ASC`, `memberId ASC`, `weekStart ASC` |
| `rank_snapshots_latest` | `seasonId ASC`, `type ASC`, `memberId ASC`, `effectiveAt DESC`, `computedAt DESC` |
| `rank_snapshots_unique_week_member` | `seasonId ASC`, `type ASC`, `weekId ASC`, `memberId ASC` (unique) |

Record the cloud env id and index names in `PROGRESS.md`. If index creation is pending/async, wait until the console shows them active before E2E-2.

- [ ] **Step 5:** Run the W0 backfill once against the test cloud env:

```bash
WX_CLOUD_ENV=<env-id> SEASON_ID=s2026 node scripts/backfill-rank-snapshots-W0.js
```

Expected stdout: `[backfill] wrote N baseline rows for seasonId=s2026` where N = ranked singles entries + ranked doubles entries.

- [ ] **Step 6:** Append a new entry to `docs/superpowers/plans/PROGRESS.md`:

```markdown
### 2026-MM-DD · Phase 10-1 complete

| Task | Description | Commit | Status |
|---|---|---|---|
| 1 | DATABASE_SCHEMA rank_snapshots + 50-char note | <sha> | ✅ |
| 2-4 | aggregateRanks asOf + tiebreaker | <sha> | ✅ |
| 5-6 | aggregateWeeklyPlayerDelta | <sha> | ✅ |
| 7 | getCurrentNaturalWeek helper | <sha> | ✅ |
| 8-9 | weekly-star.current (3 modes) | <sha> | ✅ |
| 10 | snapshot-writer helper | <sha> | ✅ |
| 11 | weekly-star current action | <sha> | ✅ |
| 12 | weekly-star cron double-write | <sha> | ✅ |
| 13 | weekly-star recomputeRankSnapshots | <sha> | ✅ |
| 14 | rankList winRate + trendDelta | <sha> | ✅ |
| 15 | members validate 50-char cap | <sha> | ✅ |
| 16 | W0 backfill script | <sha> | ✅ |
| 17 | rank-row 5-col layout | <sha> | ✅ |
| 18 | rank page hero + 5-col | <sha> | ✅ |
| 19 | edit-profile playStyle inputs | <sha> | ✅ |

Cloud tests: 191 + N new = M total, all green.
Manual E2E-1/2/3/5 verified in DevTools.
rank_snapshots indexes active in env <env-id>: rank_snapshots_week_rank, rank_snapshots_member_history, rank_snapshots_latest, rank_snapshots_unique_week_member.
W0 backfill run against test env: <N> rows written.

Awaiting Phase 10-2 plan kickoff.
```

- [ ] **Step 7:** Commit.

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -- docs/superpowers/plans/PROGRESS.md -m "docs(plans): Phase 10-1 complete — code + regression + E2E verified"
```

---

## Spec Coverage Self-Check

| Spec section | Plan task(s) | Status |
|---|---|---|
| §1.2 scope — `rank_snapshots` collection | T1 (schema), T10 (writer), T12 (cron), T16 (backfill) | ✅ |
| §1.2 scope — `aggregateRanks(asOf)` | T2, T3 | ✅ |
| §1.2 scope — `aggregateWeeklyPlayerDelta` | T5, T6 | ✅ |
| §1.2 scope — `weekly-star.current` 3 modes | T8, T9, T11 | ✅ |
| §1.2 scope — `weekly-star` cron double-write | T12 | ✅ |
| §1.2 scope — `recomputeRankSnapshots` | T13 | ✅ |
| §1.2 scope — `rankList.trendDelta` + `winRate` | T14 | ✅ |
| §1.2 scope — `members.update` playStyle / playStyleNote | T15, T19 | ✅ |
| §1.2 scope — rank-row 5-col reform | T17 | ✅ |
| §1.2 scope — rank page reform | T18 | ✅ |
| §1.2 scope — edit-profile playStyle UI | T19 | ✅ |
| §1.4 acceptance #1–3, #6, #7, #8 (10-1 portion) | T17, T18, T19, T20 | ✅ |
| §1.4 acceptance #4, #5, #8 (10-2 portion) | Phase 10-2 plan | ⏭️ |
| §4.1 rank_snapshots schema + 4 indexes + effectiveAt | T1 | ✅ (indexes must be created in cloud console after deploy — call out in T20 manual checklist) |
| §4.2 playStyleNote ≤ 50 cap fix | T15 | ✅ |
| §5.2 rankList trendDelta logic (effectiveAt DESC, computedAt DESC) | T14 | ✅ |
| §5.3 aggregateRanks asOf + tiebreaker | T3, T4 | ✅ |
| §5.6 aggregateWeeklyPlayerDelta | T5, T6 | ✅ |
| §5.7.1 weekly-star.current | T8, T9, T11 | ✅ |
| §5.7.2 cron double-write | T12 | ✅ |
| §5.8 members.update self-only path | T15 (validate) + T19 (UI) | ✅ |
| §5.9 W0 backfill | T13 (admin action) + T16 (script) | ✅ |
| §8.4 perf basis (manual smoke / not blocking) | T20 | ⚠️ Note in PROGRESS |

**Open follow-ups for Phase 10-2:**
- `points-engine.playerStats` extension (winRate / currentRank / rankHistory / weeklySnapshot)
- `points-engine.playerH2H` new action
- `rank-chart` + `h2h-row` new components
- `player-detail` page rebuild (hero + 3-card × 2 + chart + H2H + recent without status badges)

These deserve their own Phase 10-2 plan once Phase 10-1 is verified in production.

---

**END OF PLAN**
