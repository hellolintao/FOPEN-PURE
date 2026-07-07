## What I implemented

- Wired official settlement flows to trigger best-effort post-settlement refresh:
  - `batchConfirm` and `batchAdminSave` now call `ctx.afterSettlement({ successIds, requestId })`.
  - `reconfirmMatch` now calls `ctx.afterSettlement({ successIds: [matchId], requestId })`.
  - `confirmAll` now calls `ctx.afterSettlementByTournament({ tournamentId, requestId })`.
- Kept settlement best-effort:
  - score confirmation still succeeds if rank-cache or analytics refresh fails.
  - failure returns `analyticsStatus: 'failed'`, `analyticsMessage: '比分已确认，数据分析稍后重算'`, and empty `settlementImpact`.
- Added settlement refresh builders in `cloudfunctions/match-results/index.js`:
  - refresh rank cache first through `points-engine.refreshRankCache`
  - refresh analytics second through `analytics-engine.refreshAfterSettlement`
  - inject dependencies for tests and export `buildBatchCtx` / `buildSubmitCtx` from `__test__`
- Added frontend settlement handling:
  - `miniprogram/pages/tournament-score/index.js` now clears `rank:` and `player-detail:` caches after successful admin settlement / reconfirm analytics handling.
  - settlement analytics toast is shown from a shared `_handleSettlementAnalytics` helper.
- Added result-sheet analytics surface:
  - `batch-result-sheet` now renders `analyticsMessage` and `settlementImpact`.

## Test commands and results

- RED:
  - `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test -- lib/__tests__/handlers/batch.test.js -t "analytics"`
    - failed: `ctx.afterSettlement` not called from `batchAdminSave`
  - `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test -- lib/__tests__/handlers/submit.test.js -t "analytics|reconfirmMatch returns|confirmAll refreshes"`
    - failed: `afterSettlement` / `afterSettlementByTournament` were not called
  - `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test -- __tests__/analytics-integration.test.js`
    - failed: `buildBatchCtx` / `buildSubmitCtx` were not exported yet
  - `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- pages/tournament-score/__tests__/index.test.js -t "analytics"`
    - failed: `removeCachesByPrefix('rank:')` and `removeCachesByPrefix('player-detail:')` had 0 calls
  - `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- components/batch-result-sheet/__tests__/index.test.js -t "template renders analytics message and settlement impact"`
    - failed: WXML did not contain `analyticsMessage` / `settlementImpact`
- GREEN:
  - `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test -- __tests__/analytics-integration.test.js lib/__tests__/handlers/batch.test.js lib/__tests__/handlers/submit.test.js`
    - PASS: 3 suites, 42 tests
  - `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- pages/tournament-score/__tests__/index.test.js components/batch-result-sheet/__tests__/index.test.js`
    - PASS: 2 suites, 35 tests

## TDD Evidence

- RED command/output summary and why expected:
  - The new backend tests failed because no settlement analytics hooks were wired into `batchAdminSave`, `reconfirmMatch`, or `confirmAll`.
  - The integration test failed because `buildBatchCtx` / `buildSubmitCtx` were not exported and had no settlement refresh helpers.
  - The page test failed because settlement success did not clear cached rank/player-detail data.
  - The component test failed because the result sheet had no analytics UI yet.
- GREEN command/output summary:
  - After the minimal wiring and UI updates, the Task 3 cloud-function suites passed (`42/42`).
  - The Task 3 miniprogram suites passed (`35/35`).

## Files changed

- `cloudfunctions/match-results/index.js`
- `cloudfunctions/match-results/lib/handlers/batch.js`
- `cloudfunctions/match-results/lib/handlers/submit.js`
- `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`
- `cloudfunctions/match-results/lib/__tests__/handlers/submit.test.js`
- `cloudfunctions/match-results/__tests__/analytics-integration.test.js`
- `miniprogram/pages/tournament-score/index.js`
- `miniprogram/pages/tournament-score/__tests__/index.test.js`
- `miniprogram/components/batch-result-sheet/index.wxml`
- `miniprogram/components/batch-result-sheet/index.wxss`
- `miniprogram/components/batch-result-sheet/__tests__/index.test.js`

## Self-review findings

- `batchSubmit` remains untouched for settlement refresh, preserving the official-settlement-only boundary.
- Backend settlement refresh is ordered rank cache first, analytics second.
- Refresh failures are contained to metadata and do not block score confirmation success.
- Frontend cache busting is limited to official admin settlement / reconfirm result handling.

## Concerns, if any

- None.

---

## Follow-up Fix: tournament-manage batchConfirm cache invalidation

### What I fixed

- Added settlement analytics cache handling to `miniprogram/pages/tournament-manage/index.js`.
- `batchConfirm` success handling now clears both `rank:` and `player-detail:` caches when official settlement returns `analyticsStatus: 'success'` or `'failed'`.
- Applied the same behavior to:
  - the shared `_applyResult` path used by `onSheetCommit` and batch-level retry
  - the per-row retry success path in `onSheetRetry`
- Preserved failure semantics:
  - no cache clearing when `res.ok === false`
  - analytics toast behavior matches `tournament-score`

### RED evidence

- Command:
  - `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- pages/tournament-manage/__tests__/index.test.js`
- Initial failing summary:
  - `_applyResult clears rank and player-detail caches after successful batchConfirm analytics metadata`
  - `onSheetRetry clears rank and player-detail caches after per-row batchConfirm analytics success`
- Expected failure reason:
  - `removeCachesByPrefix('rank:')` and `removeCachesByPrefix('player-detail:')` had zero calls on successful `batchConfirm` settlement metadata.

### GREEN evidence

- Commands:
  - `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- pages/tournament-manage/__tests__/index.test.js`
  - `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- pages/tournament-score/__tests__/index.test.js components/batch-result-sheet/__tests__/index.test.js`
- Results:
  - `pages/tournament-manage/__tests__/index.test.js`: PASS, 4 tests
  - `pages/tournament-score/__tests__/index.test.js` + `components/batch-result-sheet/__tests__/index.test.js`: PASS, 35 tests

### Files changed for the fix

- `miniprogram/pages/tournament-manage/index.js`
- `miniprogram/pages/tournament-manage/__tests__/index.test.js`

### Concerns

- None.

---

## Follow-up Fix: skipped analytics envelope when settlement hooks are missing

### What I fixed

- Restored the Task 3 brief contract for missing settlement hooks:
  - `cloudfunctions/match-results/lib/handlers/batch.js` `runAfterSettlement(...)`
  - `cloudfunctions/match-results/lib/handlers/submit.js` `runAfterSettlement(...)`
  - `cloudfunctions/match-results/lib/handlers/submit.js` `runAfterSettlementByTournament(...)`
- These helpers now return the skipped envelope when the hook is absent:
  - `analyticsStatus: 'skipped'`
  - `analyticsMessage: ''`
  - `settlementImpact: []`

### RED evidence

- Command:
  - `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test -- lib/__tests__/handlers/batch.test.js lib/__tests__/handlers/submit.test.js`
- Initial failing summary:
  - `batchConfirm returns skipped analytics envelope when ctx.afterSettlement is missing`
  - `reconfirmMatch returns skipped analytics envelope when ctx.afterSettlement is missing`
  - `confirmAll returns skipped analytics envelope when ctx.afterSettlementByTournament is missing`
- Expected failure reason:
  - the handlers returned no analytics fields at all because the missing-hook fallback returned `{}` instead of the skipped envelope.

### GREEN evidence

- Commands:
  - `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test -- lib/__tests__/handlers/batch.test.js lib/__tests__/handlers/submit.test.js`
  - `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/match-results && npm test -- __tests__/analytics-integration.test.js`
- Results:
  - handler suites: PASS, 2 suites / 43 tests
  - analytics integration suite: PASS, 1 suite / 2 tests

### Files changed for the fix

- `cloudfunctions/match-results/lib/handlers/batch.js`
- `cloudfunctions/match-results/lib/handlers/submit.js`
- `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`
- `cloudfunctions/match-results/lib/__tests__/handlers/submit.test.js`

### Concerns

- None.
