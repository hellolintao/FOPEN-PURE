# FOPEN E2E Regression Checklist

## Scope

Use this checklist after running `scripts/e2e-regression-smoke.js` against target env `cloud1-0gthnke69a09f52a` and season `season_2026`. The smoke fixture keeps confirmed rows for rank/player-detail smoke and interactive rows for login-state submit/confirm smoke.

Keep the fixture retained after cloud smoke unless manual verification is complete and cleanup is explicitly requested. Several cases mutate the interactive rows; reseed with the runbook `cleanup-seed-smoke` command before any case that needs a fresh `pending` or `submitted` row.

Seeded fixture names and rows use these prefixes:

- Regular singles: tournament id starts with `e2e_regular_singles_`; confirmed rows include `rs_m1` and `rs_m2`.
- Knockout singles: tournament id starts with `e2e_knockout_singles_`; confirmed rows include `ko_r1_m1`, `ko_r1_m2`, and `ko_f_m1`.
- Regular doubles: tournament id starts with `e2e_regular_doubles_`; confirmed row includes `db_m1`.
- Interactive singles: tournament id starts with `e2e_interactive_`; rows include `int_pending` and `int_submitted`.

Use the current score schema whenever entering or checking scores:

```js
score = { sets: [{ a: 4, b: 2 }], tiebreak: null }
score = { sets: [{ a: 3, b: 3 }], tiebreak: '5-7' }
```

## Prerequisites

- Target cloud env is `cloud1-0gthnke69a09f52a`.
- Active season is `season_2026`.
- At least one admin member, five normal members, and two enabled courts exist before seeding.
- Manual verifier can switch DevTools login state between the seeded admin, seeded players A/B/C/D, and non-participant player E using the actor mapping printed by smoke output.
- Database checks are performed against `tournaments`, `tournament_brackets`, `tournament_registrations`, `match_results`, `tournament_points`, and points/rank surfaces as applicable.

## E2E-01 Admin Creates Regular Singles Tournament

Role: Admin.

Steps:

1. Open the tournament creation flow.
2. Create a regular singles tournament for `season_2026`.
3. Add at least four normal members.
4. Assign two enabled courts and generate the schedule.
5. Save the tournament.

Expected page state:

- Tournament detail opens without an error banner.
- Schedule board shows regular singles rows with player names, court assignment, and `pending` result state.
- Admin controls for score management are visible.

Expected database state:

- `tournaments` has a new row with `type: 'singles'`, `format: 'regular'`, `seasonId: 'season_2026'`, and a populated `schedulePlan`.
- `tournament_registrations` has one confirmed row per selected player.
- `tournament_brackets` has generated match rows for round 1.
- `match_results` rows are created with `resultStatus: 'pending'`, `score: null`, `winner: null`, and `playerIds` containing both participants.

## E2E-02 Member Submits Score

Role: Member participant. Use player A on fixture row `result_<e2e_interactive_*>_int_pending` or a fresh pending row from E2E-01.

Steps:

1. Switch login state to the member participant.
2. Open My Match and select the pending match.
3. Enter `4:2` with no tiebreak.
4. Submit the score.

Expected page state:

- My Match shows the row moving from pending entry to submitted/waiting for admin confirmation.
- Tournament score page renders the submitted score as `4:2`.
- Confirmed-only styling is not shown yet.

Expected database state:

- `match_results.resultStatus` is `submitted`.
- `score` equals `{ sets: [{ a: 4, b: 2 }], tiebreak: null }`.
- `submittedAt` and `submittedBy` are set.
- `confirmedAt`, `confirmedBy`, `winner`, and `pointsAwarded` remain unset/null until admin confirmation.

## E2E-03 Admin Confirms Submitted Score

Role: Admin. Use fixture row `result_<e2e_interactive_*>_int_submitted` or the row submitted in E2E-02.

Steps:

1. Switch login state to admin.
2. Open the admin workbench or the interactive tournament detail.
3. Open pending review items.
4. Confirm the submitted score.

Expected page state:

- The review item disappears from the pending confirmation list.
- The match row shows confirmed state and the score summary `4:2`.
- Rank/player-detail surfaces update after reload.

Expected database state:

- `match_results.resultStatus` is `confirmed`.
- `score` equals `{ sets: [{ a: 4, b: 2 }], tiebreak: null }`.
- `winner`, `winnerId`, `confirmedAt`, and `confirmedBy` are set.
- `pointsAwarded.entries` includes winner and loser rows.
- `_request_log` may record the confirm request result and is retained by cleanup.

## E2E-04 Admin Saves Pending Score Directly

Role: Admin. Use a fresh pending match, either fixture row `int_pending` after reseed or a row created in E2E-01.

Steps:

1. Switch login state to admin.
2. Open the pending match in tournament score management.
3. Enter `4:2` with no tiebreak.
4. Save/confirm directly as admin.

Expected page state:

- The row immediately shows confirmed state.
- No member-submitted waiting state remains.

Expected database state:

- `match_results.resultStatus` is `confirmed`.
- `score` equals `{ sets: [{ a: 4, b: 2 }], tiebreak: null }`.
- `submittedAt`/`submittedBy` are not required for this direct admin path.
- `confirmedAt`, `confirmedBy`, `winner`, `winnerId`, and `pointsAwarded.entries` are set.

## E2E-05 Knockout Complete Flow

Role: Admin.

Steps:

1. Open fixture tournament `e2e_knockout_singles_*`.
2. Review round 1 rows `ko_r1_m1` and `ko_r1_m2`.
3. Review final row `ko_f_m1`.
4. Open player detail for the champion and runner-up.

Expected page state:

- Bracket shows round 1 winners advancing into the final.
- Final row is confirmed with score `4:2`.
- Player detail shows recent knockout match rows.

Expected database state:

- `match_results` has confirmed rows for `ko_r1_m1`, `ko_r1_m2`, and `ko_f_m1`.
- `tournament_brackets` round 2 contains the final with the champion as winner.
- `tournament_points` includes placement rows for champion, runner-up, and semifinalists.
- Points aggregation includes both match points and placement points.

## E2E-06 Reconfirm Rollback

Role: Admin. Use a confirmed row that can be safely changed during manual verification, preferably from a freshly created test tournament.

Steps:

1. Open a confirmed match.
2. Start reconfirm/edit score.
3. Enter tiebreak score `3:3` with tiebreak `5-7`.
4. Cancel at the confirmation prompt.
5. Reopen the row.
6. Repeat the edit and confirm it.

Expected page state:

- After cancel, the original score and winner remain visible.
- After confirm, the score renders as `3:3 (5-7)` or the equivalent tiebreak display.

Expected database state:

- After cancel, the row is unchanged.
- After confirm, `score` equals `{ sets: [{ a: 3, b: 3 }], tiebreak: '5-7' }`.
- `winner`, `winnerId`, and `pointsAwarded.entries` match the tiebreak winner.
- No duplicate `match_results` row is created for the same match.

## E2E-07 Doubles Points

Role: Admin or any member who can view rankings/player detail.

Steps:

1. Open fixture tournament `e2e_regular_doubles_*`.
2. Review row `db_m1`.
3. Open player detail for each of the four doubles participants.
4. Open doubles rank list.

Expected page state:

- Schedule row displays two players per side.
- Score is shown as `4:2`.
- Doubles rank/detail surfaces show points for all four participants.

Expected database state:

- `match_results.playerIds` contains all four member ids.
- `pointsAwarded.entries` has two `winner` entries with 20 points each and two `loser` entries with 10 points each.
- Doubles aggregation includes the row for all four participants.

## E2E-08 Non-participant Cannot Submit

Role: Non-participant member. Use seeded player E against fixture tournament `e2e_interactive_*`.

Steps:

1. Switch login state to seeded player E.
2. Open the interactive tournament or My Match.
3. Attempt to open `int_pending` or submit a score through any available route.

Expected page state:

- My Match does not list the interactive pending row for player E.
- Tournament detail does not expose editable score controls for player E.
- If a direct route is forced, the UI shows a forbidden/error state and no success toast.

Expected database state:

- `match_results` row remains unchanged.
- No new submission is written.
- No `pointsAwarded` entry is created.

## E2E-09 Admin Mixed Role

Role: Admin who is also a match participant. Use fixture row `int_pending`, where admin is one side of the match.

Steps:

1. Reseed if `int_pending` has already been consumed by another case.
2. Switch login state to admin.
3. Open My Match and confirm the admin sees the row as a participant.
4. Open the admin workbench and confirm admin review controls are also available.
5. Submit or save the score using `4:2`.

Expected page state:

- Admin can see participant-facing match context.
- Admin-specific confirmation/save controls remain available.
- The final row renders confirmed score state.

Expected database state:

- The row transitions to either `submitted` then `confirmed`, or directly to `confirmed`, depending on the path used.
- Final confirmed score equals `{ sets: [{ a: 4, b: 2 }], tiebreak: null }`.
- `confirmedBy` is the admin identity and points are awarded once.

## E2E-10 Member Cannot Overwrite Confirmed

Role: Member participant. Use a confirmed fixture row such as `result_<e2e_regular_singles_*>_rs_m1`.

Steps:

1. Switch login state to one participant in the confirmed match.
2. Open the confirmed match from tournament detail or player detail.
3. Attempt to edit or submit a different score, including `3:3` with tiebreak `5-7`.

Expected page state:

- Score controls are read-only or submission is rejected.
- Existing confirmed score remains visible.
- User receives an error or no editable affordance is shown.

Expected database state:

- `match_results.resultStatus` remains `confirmed`.
- Existing `score`, `winner`, `winnerId`, `confirmedAt`, and `pointsAwarded` remain unchanged.
- If the backend is invoked directly, the response uses `CANNOT_OVERWRITE_CONFIRMED` or an equivalent non-success state.
