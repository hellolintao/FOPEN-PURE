# Task 1 Report: Analytics Engine Pure Aggregators

## Scope

- Implemented only `cloudfunctions/analytics-engine/**`
- Wrote the required Task 1 report to `.superpowers/sdd/task-1-report.md`
- Did not modify `points-engine`, `match-results`, `miniprogram`, docs, or the `.superpowers` ledger

## Files Added

- `cloudfunctions/analytics-engine/package.json`
- `cloudfunctions/analytics-engine/package-lock.json`
- `cloudfunctions/analytics-engine/config.json`
- `cloudfunctions/analytics-engine/lib/ids.js`
- `cloudfunctions/analytics-engine/lib/teams.js`
- `cloudfunctions/analytics-engine/lib/player-analytics.js`
- `cloudfunctions/analytics-engine/lib/pair-analytics.js`
- `cloudfunctions/analytics-engine/lib/identity.js`
- `cloudfunctions/analytics-engine/lib/__tests__/ids.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/teams.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/player-analytics.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/pair-analytics.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/identity.test.js`

## TDD Evidence

### 1. IDs helpers

Test written first:
- `cloudfunctions/analytics-engine/lib/__tests__/ids.test.js`

RED command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js
```

Observed RED:
- `FAIL lib/__tests__/ids.test.js`
- `Cannot find module '../ids' from 'lib/__tests__/ids.test.js'`

Implementation added after RED:
- `cloudfunctions/analytics-engine/lib/ids.js`

GREEN command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js
```

Observed GREEN:
- `PASS lib/__tests__/ids.test.js`
- `Tests: 3 passed, 3 total`

### 2. Team helpers

Test written first:
- `cloudfunctions/analytics-engine/lib/__tests__/teams.test.js`

RED command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/teams.test.js
```

Observed RED:
- `FAIL lib/__tests__/teams.test.js`
- `Cannot find module '../teams' from 'lib/__tests__/teams.test.js'`

Implementation added after RED:
- `cloudfunctions/analytics-engine/lib/teams.js`

GREEN command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/teams.test.js
```

Observed GREEN:
- `PASS lib/__tests__/teams.test.js`
- `Tests: 4 passed, 4 total`

### 3. Player analytics

Test written first:
- `cloudfunctions/analytics-engine/lib/__tests__/player-analytics.test.js`

RED command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js
```

Observed RED:
- `FAIL lib/__tests__/player-analytics.test.js`
- `Cannot find module '../player-analytics' from 'lib/__tests__/player-analytics.test.js'`

Implementation added after RED:
- `cloudfunctions/analytics-engine/lib/player-analytics.js`

GREEN command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js
```

Observed GREEN:
- `PASS lib/__tests__/player-analytics.test.js`
- `Tests: 1 passed, 1 total`

### 4. Pair analytics

Test written first:
- `cloudfunctions/analytics-engine/lib/__tests__/pair-analytics.test.js`

RED command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/pair-analytics.test.js
```

Observed RED:
- `FAIL lib/__tests__/pair-analytics.test.js`
- `Cannot find module '../pair-analytics' from 'lib/__tests__/pair-analytics.test.js'`

Implementation added after RED:
- `cloudfunctions/analytics-engine/lib/pair-analytics.js`

GREEN command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/pair-analytics.test.js
```

Observed GREEN:
- `PASS lib/__tests__/pair-analytics.test.js`
- `Tests: 1 passed, 1 total`

### 5. Identity resolution

Test written first:
- `cloudfunctions/analytics-engine/lib/__tests__/identity.test.js`

RED command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/identity.test.js
```

Observed RED:
- `FAIL lib/__tests__/identity.test.js`
- `Cannot find module '../identity' from 'lib/__tests__/identity.test.js'`

Implementation added after RED:
- `cloudfunctions/analytics-engine/lib/identity.js`

GREEN command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/identity.test.js
```

Observed GREEN:
- `PASS lib/__tests__/identity.test.js`
- `Tests: 1 passed, 1 total`

## Final Task 1 Verification

Command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js lib/__tests__/teams.test.js lib/__tests__/player-analytics.test.js lib/__tests__/pair-analytics.test.js lib/__tests__/identity.test.js
```

Observed result:
- `PASS lib/__tests__/teams.test.js`
- `PASS lib/__tests__/player-analytics.test.js`
- `PASS lib/__tests__/pair-analytics.test.js`
- `PASS lib/__tests__/identity.test.js`
- `PASS lib/__tests__/ids.test.js`
- `Test Suites: 5 passed, 5 total`
- `Tests: 10 passed, 10 total`

## Implementation Notes

- `analyticsPlayerId`, `pairKey`, and `pairAnalyticsId` were added as pure ID helpers
- `teams.js` provides pure side/team parsing helpers used by both aggregators
- `buildPlayerAnalytics` keeps doubles `teamH2H` in team-vs-team form with `subjectTeam` and `opponentTeam`
- `buildPairAnalytics` aggregates doubles rows strictly as normalized pair-vs-pair matchups
- `resolveAnalyticsIdentities` resolves cached member IDs against current member consent and applies anonymized names/avatar defaults at read time
- No changes were made to points/ranking engines, preserving existing totals ownership boundaries

## Commit

- Commit created after final verification:
  - `feat(analytics): add pure ranking analytics aggregators`

## Review Fix Round 1

### Findings Addressed

1. Critical: removed cached display names from analytics aggregate outputs
2. Critical: expanded `resolveAnalyticsIdentities` to sanitize/resolve all analytics display surfaces
3. Important: added regression coverage for stale cached names and nested recent matches
4. Minor: removed unused `membersById` parameter from `buildPairAnalytics`

### TDD Evidence For Fix

Tests changed first:
- `cloudfunctions/analytics-engine/lib/__tests__/player-analytics.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/identity.test.js`

Focused RED command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js lib/__tests__/identity.test.js
```

Observed RED:
- `FAIL lib/__tests__/player-analytics.test.js`
- `expect(received).toBeUndefined()`
- `Received: "标子"`
- `FAIL lib/__tests__/identity.test.js`
- stale cached identity remained in `singles.strongAgainst[0]`
- received stale values like `name: "旧名字C"` and `avatarUrl: "stale://c"` instead of current member identity

Implementation changes after RED:
- `cloudfunctions/analytics-engine/lib/player-analytics.js`
  - cache rows now store IDs plus metrics only
  - cached `subjectTeam`/`opponentTeam` arrays now store `{ memberId }` only
  - nested `teamH2H[*].recentMatches` also store ID-only teams
- `cloudfunctions/analytics-engine/lib/identity.js`
  - now resolves `singles.strongAgainst`
  - now resolves `singles.strugglesAgainst`
  - now resolves `doubles.bestPartners`
  - now resolves `doubles.strongAgainst`
  - now resolves `doubles.strugglesAgainst`
  - now resolves `doubles.teamH2H[*].recentMatches`
  - continues resolving top-level identity, `doubles.teamH2H`, and top-level `recentMatches`
  - stale cached `name`/`avatarUrl` values are overwritten from current member consent state or anonymized defaults
- `cloudfunctions/analytics-engine/lib/pair-analytics.js`
  - removed unused `membersById` parameter from the function signature

Focused GREEN command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js lib/__tests__/identity.test.js
```

Observed GREEN:
- `PASS lib/__tests__/player-analytics.test.js`
- `PASS lib/__tests__/identity.test.js`
- `Test Suites: 2 passed, 2 total`
- `Tests: 2 passed, 2 total`

### Final Verification After Fix

Command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js lib/__tests__/teams.test.js lib/__tests__/player-analytics.test.js lib/__tests__/pair-analytics.test.js lib/__tests__/identity.test.js
```

Observed result:
- `PASS lib/__tests__/player-analytics.test.js`
- `PASS lib/__tests__/teams.test.js`
- `PASS lib/__tests__/identity.test.js`
- `PASS lib/__tests__/pair-analytics.test.js`
- `PASS lib/__tests__/ids.test.js`
- `Test Suites: 5 passed, 5 total`
- `Tests: 10 passed, 10 total`

## Review Fix Round 2

### Findings Addressed

1. Important: doubles identity resolution now runs even when `teamH2H` is missing
2. Defensive privacy hardening: `rankSnapshot` is now sanitized to safe ranking fields only

### TDD Evidence For Fix

Tests changed first:
- `cloudfunctions/analytics-engine/lib/__tests__/identity.test.js`
- `cloudfunctions/analytics-engine/lib/__tests__/player-analytics.test.js`

Focused RED command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js lib/__tests__/identity.test.js
```

Observed RED:
- `FAIL lib/__tests__/player-analytics.test.js`
- `buildPlayerAnalytics sanitizes rankSnapshot to safe ranking fields only`
- received leaked display fields in `rankSnapshot`, including `name`, `avatarUrl`, `displayName`, and `publicProfileVisible`
- `FAIL lib/__tests__/identity.test.js`
- `resolveAnalyticsIdentities resolves doubles rows even when teamH2H is missing`
- stale cached doubles values like `name: "旧搭档"` and `avatarUrl: "stale://b"` survived when `teamH2H` was absent

Implementation changes after RED:
- `cloudfunctions/analytics-engine/lib/identity.js`
  - `resolveAnalyticsIdentities` now resolves `out.doubles` whenever the doubles bucket exists, regardless of `teamH2H`
- `cloudfunctions/analytics-engine/lib/player-analytics.js`
  - added `sanitizeRankSnapshot`
  - rank snapshot now whitelists only `_id`, `memberId`, `rank`, `totalPoints`, `winCount`, `lossCount`, `winRate`, `trendDelta`, `trendState`, and `trendLabel`

Focused GREEN command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/player-analytics.test.js lib/__tests__/identity.test.js
```

Observed GREEN:
- `PASS lib/__tests__/player-analytics.test.js`
- `PASS lib/__tests__/identity.test.js`
- `Test Suites: 2 passed, 2 total`
- `Tests: 4 passed, 4 total`

### Final Verification After Review Fix Round 2

Command:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/analytics-engine
npm test -- lib/__tests__/ids.test.js lib/__tests__/teams.test.js lib/__tests__/player-analytics.test.js lib/__tests__/pair-analytics.test.js lib/__tests__/identity.test.js
```

Observed result:
- `PASS lib/__tests__/player-analytics.test.js`
- `PASS lib/__tests__/teams.test.js`
- `PASS lib/__tests__/pair-analytics.test.js`
- `PASS lib/__tests__/identity.test.js`
- `PASS lib/__tests__/ids.test.js`
- `Test Suites: 5 passed, 5 total`
- `Tests: 12 passed, 12 total`
