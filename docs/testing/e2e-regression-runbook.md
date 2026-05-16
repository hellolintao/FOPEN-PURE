# FOPEN E2E Regression Runbook

## Local Regression

Run each package from the listed directory.

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/scripts
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/cloudfunctions/_shared
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/cloudfunctions/match-results
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/cloudfunctions/points-engine
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/cloudfunctions/tournament-brackets
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/cloudfunctions/tournaments
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/cloudfunctions/weekly-star
npm test -- --runInBand
```

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing/miniprogram
npm test -- --runInBand
```

## Guarded Cloud Cleanup, Seed, and Smoke

Target env: `cloud1-0gthnke69a09f52a`

Season: `season_2026`

The implemented CLI env var is `SMOKE_MODE`, not `FOPEN_E2E_MODE`.

In cleanup modes, the command clears all rows in these business collections in the target env:

- `tournaments`
- `tournament_brackets`
- `tournament_registrations`
- `match_results`
- `tournament_points`
- `free_plays`
- `rank_snapshots`
- `weekly_stars`

It keeps `members`, `courts`, `seasons`, and `_request_log`.

Run cleanup, seed, and read-only smoke:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing
FOPEN_CLOUD_ENV=cloud1-0gthnke69a09f52a \
FOPEN_CLEANUP_CONFIRM=cloud1-0gthnke69a09f52a \
FOPEN_RESET_BUSINESS_DATA=YES \
SMOKE_MODE=cleanup-seed-smoke \
SEASON_ID=season_2026 \
node scripts/e2e-regression-smoke.js
```

Expected smoke checks:

- `rankList.singles`
- `playerStats.A`
- `playerH2H.A`

The command prints generated fixture ids and an actor mapping. Keep those ids for manual verification and retain the fixture after smoke unless manual verification is complete and cleanup is explicitly requested.

Use the printed `actors.admin` member id/name/openid for admin DevTools login-state checks. Use printed `actors.players` labels A-E for member role checks: player A is the primary rank/player-detail smoke subject, players A-D are tournament participants, and player E is the non-participant for E2E-08. When an `openid` is present, use it for DevTools login-state switching; otherwise use the printed member id/name to identify the member row.

Cleanup only after manual verification:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing
FOPEN_CLOUD_ENV=cloud1-0gthnke69a09f52a \
FOPEN_CLEANUP_CONFIRM=cloud1-0gthnke69a09f52a \
FOPEN_RESET_BUSINESS_DATA=YES \
SMOKE_MODE=cleanup-only \
SEASON_ID=season_2026 \
node scripts/e2e-regression-smoke.js
```

## Safe Failure Check

This command has no safety env and should fail before touching cloud data:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/.worktrees/codex-e2e-regression-testing
node scripts/e2e-regression-smoke.js
```

Expected result: non-zero exit with a safety error requiring `FOPEN_CLOUD_ENV`, matching `FOPEN_CLEANUP_CONFIRM`, and `FOPEN_RESET_BUSINESS_DATA=YES`.

## DevTools Login-state Smoke

Keep the seeded fixture data in place for role switching. Do not run cleanup between these checks unless reseeding immediately afterward.

Use the fixture ids and actor mapping printed by `SMOKE_MODE=cleanup-seed-smoke`. The important interactive tournament id starts with `e2e_interactive_`.

1. Run E2E-02 from the checklist as a normal member participant.
   - Switch DevTools login state to the seeded participant for `int_pending`.
   - Submit `score = { sets: [{ a: 4, b: 2 }], tiebreak: null }`.
   - Confirm page state changes to submitted/waiting for admin confirmation.

2. Run E2E-03 from the checklist as admin.
   - Switch DevTools login state to admin.
   - Confirm the submitted row from E2E-02 or the seeded `int_submitted` row.
   - Confirm the row becomes `confirmed` and points are awarded.

3. Run E2E-09 from the checklist as admin mixed role.
   - Reseed first if `int_pending` was already consumed and no fresh pending admin-participant row remains.
   - Switch DevTools login state to admin.
   - Verify admin sees participant context and admin review/save controls.
   - Save or confirm a score and verify points are awarded once.
