# Task 4 Report: Rank Trend States

## What I implemented

- Added `cloudfunctions/points-engine/lib/settlement-impact.js` and a focused helper test to compute settlement impact from previous cached ranks vs refreshed ranks.
- Extended `points-engine.refreshRankCache` to:
  - accept `affectedMemberIds`, `writeSnapshot`, and `snapshotKind`
  - return `data.settlementImpact`
  - write `rank_snapshots` rows from refreshed rank lists when requested
- Added `points-engine.rebuildRankSnapshots({ seasonId, snapshotKind })` for baseline/backfill snapshot generation.
- Extended live rank aggregation to emit:
  - `trendDelta`
  - `trendState`
  - `trendLabel`
  with correct `flat`, `new`, and `no_history` handling.
- Updated rank page sanitization and `rank-row` rendering to preserve backend trend labels, derive fallback labels for old cached rows, and display explicit trend text.

## Test commands and results

- `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test -- lib/__tests__/settlement-impact.test.js`
  - PASS
- `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test -- __tests__/index.test.js -t "rankList marks|refreshRankCache returns settlementImpact|rebuildRankSnapshots writes baseline"`
  - PASS
- `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test -- lib/__tests__/settlement-impact.test.js __tests__/index.test.js`
  - PASS, 33 tests
- `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- components/rank-row/__tests__/index.test.js pages/rank/__tests__/index.test.js`
  - PASS, 19 tests

## TDD Evidence

### RED

- `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test -- lib/__tests__/settlement-impact.test.js`
  - FAILED with `Cannot find module '../settlement-impact'`
  - Expected because the helper module did not exist yet.
- `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test -- __tests__/index.test.js -t "trend|refreshRankCache returns settlementImpact|rebuildRankSnapshots writes baseline"`
  - FAILED because:
    - `trendState` / `trendLabel` were missing from `rankList`
    - `settlementImpact` was missing from `refreshRankCache`
    - `rebuildRankSnapshots` was not implemented
- `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- components/rank-row/__tests__/index.test.js pages/rank/__tests__/index.test.js`
  - FAILED because:
    - `rank-row` did not expose `trendState` / `trendLabel`
    - `rank-row` still rendered arrow-only trend markup
    - rank page did not derive fallback trend metadata
    - rank page did not pass `trend-state` / `trend-label` into `rank-row`

### GREEN

- Re-ran the same helper/backend/frontend commands after the minimal implementation.
- Final focused verification:
  - backend: 33/33 passing
  - miniprogram: 19/19 passing

## Files changed

- `cloudfunctions/points-engine/index.js`
- `cloudfunctions/points-engine/lib/settlement-impact.js`
- `cloudfunctions/points-engine/lib/__tests__/settlement-impact.test.js`
- `cloudfunctions/points-engine/__tests__/index.test.js`
- `miniprogram/pages/rank/index.js`
- `miniprogram/pages/rank/index.wxml`
- `miniprogram/pages/rank/__tests__/index.test.js`
- `miniprogram/components/rank-row/index.js`
- `miniprogram/components/rank-row/index.wxml`
- `miniprogram/components/rank-row/index.wxss`
- `miniprogram/components/rank-row/__tests__/index.test.js`

## Self-review findings

- Ranking privacy stays intact: rank rows still flow through `toRankingIdentity`, so no public avatar exposure was reintroduced.
- Old cached/public rows without backend `trendState` / `trendLabel` still render correctly because the rank page derives fallback labels from `trendDelta`.
- Snapshot writing is scoped to rank-cache refresh/rebuild only; it does not create a second scoring source of truth.

## Concerns, if any

- None.

---

## Review Fix Follow-up (2026-07-08)

### Findings addressed

1. Cached `rankList` responses could still return rows with `trendDelta` only and no `trendState` / `trendLabel`.
2. `refreshRankCache().data.settlementImpact` flattened singles and doubles impacts without a ladder discriminator, and the result sheet keyed repeated same-member impacts by `memberId`.

### What changed

- Updated cached-rank refresh flow in `cloudfunctions/points-engine/index.js` so cached rows are backfilled with the same trend contract as live rows:
  - positive `trendDelta` => `up` / `▲N`
  - negative `trendDelta` => `down` / `▼N`
  - zero => `flat` / `持平`
  - null/undefined => `no_history` when the ladder has no snapshots, otherwise `new`
- Refactored live trend derivation to share the same `trendMetaFromDelta(...)` helper used by cached rows.
- Extended `buildSettlementImpact(...)` to include:
  - `impactKey`
  - `type`
  - `typeLabel`
  while preserving existing fields `memberId`, `name`, `pointsDelta`, `rankDelta`, and `trendLabel`.
- Updated `refreshRankCache(...)` to pass ladder `type` into impact generation.
- Updated `miniprogram/components/batch-result-sheet/index.wxml` to key impacts by `impactKey` and render the ladder label so same-member singles/doubles impacts no longer collide visually.

### Review-fix TDD evidence

#### RED

- `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test -- lib/__tests__/settlement-impact.test.js __tests__/index.test.js`
  - FAILED with the expected review regressions:
    - cached `rankList` rows were missing `trendState` / `trendLabel`
    - cached rows with `trendDelta: 2` did not backfill `up` / `▲2`
    - cached rows with `trendDelta: null` and existing ladder history did not backfill `new`
    - `settlementImpact` entries were missing `impactKey`, `type`, and `typeLabel`
    - same-member singles/doubles impacts were still ambiguous in the backend payload
- `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- components/batch-result-sheet/__tests__/index.test.js`
  - PASS after the minimal template adjustment; this check served as focused regression coverage for the result-sheet key/display path.

#### GREEN

- `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine && npm test -- lib/__tests__/settlement-impact.test.js __tests__/index.test.js`
  - PASS, 36 tests
- `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- components/batch-result-sheet/__tests__/index.test.js`
  - PASS, 11 tests

### Files changed for review fix

- `cloudfunctions/points-engine/lib/settlement-impact.js`
- `cloudfunctions/points-engine/lib/__tests__/settlement-impact.test.js`
- `cloudfunctions/points-engine/index.js`
- `cloudfunctions/points-engine/__tests__/index.test.js`
- `miniprogram/components/batch-result-sheet/index.wxml`
- `miniprogram/components/batch-result-sheet/__tests__/index.test.js`

### Self-review

- Cached rows still do not recompute live points; only identity fields and trend-contract backfill are applied.
- Result-sheet display remains backward-compatible with older impact entries because it falls back from `typeLabel` to `type`.
- Ranking privacy remains unchanged; no player-detail or H2H surfaces were touched.
