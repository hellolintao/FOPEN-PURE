# Final Review Fixes Report

Status: complete.

Code fix commit: `94f346670492062c501592e37d88e023ca1a7275` (`fix: address final ranking analytics review`).
Report commit: created after this report file is staged.

## Changed Files

- `cloudfunctions/points-engine/index.js`
- `cloudfunctions/points-engine/__tests__/index.test.js`
- `cloudfunctions/match-results/index.js`
- `cloudfunctions/match-results/__tests__/analytics-integration.test.js`
- `cloudfunctions/analytics-engine/index.js`
- `cloudfunctions/analytics-engine/__tests__/index.test.js`
- `miniprogram/pages/player-detail/index.js`
- `miniprogram/pages/player-detail/__tests__/index.test.js`
- `cloudfunctions/DATABASE_SCHEMA.md`

## Fix Summary

- `points-engine` now treats missing `rank_snapshots` as no history for latest-snapshot and rank-history reads.
- Player detail keeps enriched points-engine recent rows for the main recent list, overlaying analytics team labels only when matching rows exist.
- Match-results settlement refresh now groups successful rows by `seasonId` and runs rank refresh then analytics refresh per season.
- Analytics refresh now reads cached singles/doubles rank rows from `rank_cache` per affected player and relies on existing rankSnapshot sanitization to avoid name/avatar leakage.
- Schema docs now include `snapshotKind: settlement` and `settlement_YYYY-MM-DD` week IDs.

## RED Evidence

Command: `cd cloudfunctions/points-engine && npm test -- __tests__/index.test.js`

Failure snippets:

```text
FAIL __tests__/index.test.js
✕ rankList keeps live rank rows usable when rank_snapshots collection is missing
Expected: true
Received: false
console.error [points-engine] rankList Error: collection rank_snapshots not exists

✕ playerStats returns empty rank history when rank_snapshots collection is missing
Expected: true
Received: false
console.error [points-engine] playerStats Error: collection rank_snapshots not exists
```

Command: `cd cloudfunctions/match-results && npm test -- __tests__/analytics-integration.test.js`

Failure snippet:

```text
FAIL __tests__/analytics-integration.test.js
✕ buildBatchCtx.afterSettlement refreshes each season when successful rows span seasons
Expected: "success"
Received: "skipped"
```

Command: `cd cloudfunctions/analytics-engine && npm test -- __tests__/index.test.js`

Failure snippet:

```text
FAIL __tests__/index.test.js
✕ refreshAfterSettlement populates rankSnapshot from rank_cache without display identity fields
- Expected rankSnapshot singles/doubles rank rows
+ Received singles: [], doubles: []
```

Command: `cd miniprogram && npm test -- pages/player-detail/__tests__/index.test.js`

Failure snippet:

```text
FAIL pages/player-detail/__tests__/index.test.js
✕ setStateFromResponses preserves enriched stats recent rows and merges analytics team labels
- Expected tournamentName, score, opponent from stats row
+ Received sparse analytics recent row with only matchId/team labels
```

## GREEN Evidence

Command: `cd cloudfunctions/points-engine && npm test -- __tests__/index.test.js`

```text
PASS __tests__/index.test.js
Test Suites: 1 passed, 1 total
Tests: 37 passed, 37 total
```

Command: `cd cloudfunctions/match-results && npm test -- __tests__/analytics-integration.test.js`

```text
PASS __tests__/analytics-integration.test.js
Test Suites: 1 passed, 1 total
Tests: 3 passed, 3 total
```

Command: `cd cloudfunctions/analytics-engine && npm test -- __tests__/index.test.js`

```text
PASS __tests__/index.test.js
Test Suites: 1 passed, 1 total
Tests: 9 passed, 9 total
```

Command: `cd miniprogram && npm test -- pages/player-detail/__tests__/index.test.js`

```text
PASS pages/player-detail/__tests__/index.test.js
Test Suites: 1 passed, 1 total
Tests: 11 passed, 11 total
```

## Concerns

- Only focused suites requested in the review were run; broader package suites were not run.
- Git reported existing line-ending normalization warnings (`LF will be replaced by CRLF the next time Git touches it`) while staging the touched files.
