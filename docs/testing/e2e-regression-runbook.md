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

For seed modes, `SEASON_ID` must match an existing row in `seasons` by `_id` or `id`. The script aborts before cleanup if the requested season is missing.

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

This cloud smoke intentionally seeds deterministic fixture documents directly, then checks read-only aggregation. It does not call login-state write actions such as `batchSubmit` or `batchAdminSave`; those write paths are covered by the cloud handler tests, page tests, and the DevTools login-state smoke below.

Credential note: local runs of `@cloudbase/node-sdk` require Tencent Cloud credentials. If the shell does not already have `TENCENTCLOUD_SECRETID` / `TENCENTCLOUD_SECRETKEY` / `TENCENTCLOUD_SESSIONTOKEN`, refresh them from an existing CloudBase CLI login with `cloudbase secrets get --json` and inject them into only the smoke child process. Do not print secrets in logs.

The command prints generated fixture ids and an actor mapping. Keep those ids for manual verification and retain the fixture after smoke unless manual verification is complete and cleanup is explicitly requested.

Use the printed `actors.admin` member id/name/openid for admin DevTools login-state checks. Use printed `actors.players` labels A-E for member role checks: player A is the primary rank/player-detail smoke subject, players A-D are tournament participants, and player E is the non-participant for E2E-08. Seed modes require the selected admin and five selected players to have login ids in `members.openid` or legacy `members.openId`; the write cloud functions now resolve both fields from `cloud.getWXContext().OPENID`.

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

When validating against deployed cloud functions, deploy this branch's `match-results` and `tournaments` functions to the target env before running login-state write checks. This branch includes identity fallback for both `members.openid` and legacy `members.openId`; older deployed functions may only resolve one field.

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

## Ranking Analytics Smoke

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

## Last Verified

Verified on 2026-05-17 against `cloud1-0gthnke69a09f52a` / `season_2026`.

Local checks passed:

- `scripts`: 4 suites / 38 tests
- `cloudfunctions/_shared`: 1 suite / 22 tests
- `cloudfunctions/match-results`: 7 suites / 82 tests
- `cloudfunctions/points-engine`: 6 suites / 73 tests
- `cloudfunctions/tournament-brackets`: 4 suites / 44 tests
- `cloudfunctions/tournaments`: 4 suites / 32 tests
- `cloudfunctions/weekly-star`: 5 suites / 19 tests
- `miniprogram`: 9 suites / 39 tests
- `bash scripts/sync-shared-libs.sh`: all mirrors ok

Safe failure passed: running `node scripts/e2e-regression-smoke.js` without safety env exited non-zero before cloud writes with `FOPEN_CLEANUP_CONFIRM must be set and equal to FOPEN_CLOUD_ENV`.

Cloud cleanup, seed, and read-only smoke passed after loading temporary credentials from the local CloudBase CLI session and injecting them only into the child process. Cleanup removed the pre-existing rows from the 8 business collections, then seeded:

- `tournaments`: 4
- `tournament_brackets`: 5
- `tournament_registrations`: 16
- `match_results`: 8
- `tournament_points`: 4
- `free_plays`: 0
- `rank_snapshots`: 0
- `weekly_stars`: 0

Smoke checks passed:

- `rankList.singles`
- `playerStats.A`
- `playerH2H.A`

Seeded fixture ids:

- `e2e_regular_singles_20260516_1947`
- `e2e_knockout_singles_20260516_1947`
- `e2e_regular_doubles_20260516_1947`
- `e2e_interactive_20260516_1947`

Seeded actors:

- admin: `user_002` / `李四888888` / `wx_openid_002`
- A: `user_001` / `张三` / `wx_openid_001`
- B: `user_005` / `刘洋` / `wx_openid_005`
- C: `user_006` / `赵敏` / `wx_openid_006`
- D: `user_007` / `孙伟` / `wx_openid_007`
- E: `user_008` / `周杰` / `wx_openid_008`

Automated write-path coverage in this branch:

- cloud handler tests cover member `batchSubmit`, admin `batchAdminSave`, admin confirm/reconfirm, stale version handling, invalid score handling, score schema, point awards, and participant/permission checks
- miniprogram page/component tests cover score draft entry, member submit sheet, admin save sheet, close-refresh behavior, rank display, my-match rows, and player-detail recent records

DevTools display smoke passed in WeChat DevTools Stable v2.01.2510280:

- Admin home showed the admin role and create-tournament entry.
- Rank page showed the seeded singles table: `张三 160`, `赵敏 100`, `孙伟 60`, `刘洋 50`.
- Player detail for `张三` showed singles `3/3`, `160` points, and recent regular/knockout/doubles match records.

The DevTools login-state write smoke in the previous section remains the manual end-to-end check for a real member submit followed by admin confirmation. Keep the fixture in place until that pass is done or rerun `cleanup-seed-smoke` immediately before executing it.

Observed DevTools noise not blocking the smoke result:

- remote avatar image loads from `avatar.example.com` failed in the simulator network layer
- WeChat DevTools warns that `__tests__` folders are reserved and ignored by the simulator
- `components/rank-chart/index` warned once that property `data` received a non-array value before rendering an empty chart state
