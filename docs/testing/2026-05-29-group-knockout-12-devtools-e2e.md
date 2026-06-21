# 12-Sign Group Knockout DevTools E2E Record

Date: 2026-05-29

Target cloud env: `cloud1-0gthnke69a09f52a`

Tooling: WeChat DevTools Stable `2.01.2510280`

Smoke script: `/Users/liaoxiaole/FOPEN-PURE/scripts/group-knockout-12-devtools-console.js`

Completed tournament: `tournament_gk12_20260529035017` / `GK12_E2E_20260529035017`

## Scope

Verify a real 12-sign singles `group_knockout` tournament from creation to completion in WeChat DevTools, using the current logged-in mini-program cloud context.

This flow covers:

- Create a 12-sign group + knockout tournament.
- Register exactly 12 players.
- Save 4 groups with 3 players each, simulating onsite draw/manual group entry.
- Generate and finish 12 group matches.
- Confirm the top 2 from each group into the 8-player knockout bracket.
- Verify quarterfinal pairings: `A1-B2`, `B1-A2`, `C1-D2`, `D1-C2`.
- Verify source labels appear only at the quarterfinal positions.
- Finish quarterfinals, semifinals, and final.
- Verify the final detail page, bracket page, points, and completion state.

## Test Cases

| ID | Case | Steps | Expected result |
| --- | --- | --- | --- |
| TC-GK12-01 | Create 12-sign group knockout tournament | Create `format: group_knockout`, `type: singles`, `bracketSize: 12`, `groupDrawMode: onsite`, date `2026-06-30`. | Tournament row is created with `groupKnockoutPhase: group_draft` and no `UNSUPPORTED_FORMAT` error during creation flow. |
| TC-GK12-02 | Step 2 completion routes to detail | Finish roster/court selection from the create flow. | Button routes to tournament detail for bracket arranging instead of running regular schedule generation. |
| TC-GK12-03 | Manual group entry | Save A-D groups with 3 players per group. | `tournament_groups` contains 4 complete groups and the detail page bracket status moves past draft. |
| TC-GK12-04 | Generate group matches | Generate group-stage matches after groups are saved. | 12 group `match_results` rows are created, 3 per group. |
| TC-GK12-05 | Finish group stage | Save deterministic group scores so slot 1 beats slot 2 and slot 3, and slot 2 beats slot 3. | All group rows are confirmed and tournament phase becomes `group_completed`. |
| TC-GK12-06 | Confirm knockout seeds | Confirm top 2 in each group. | Seeds A1/A2/B1/B2/C1/C2/D1/D2 are produced and 7 knockout rows are created. |
| TC-GK12-07 | Verify quarterfinal bracket | Open bracket data and bracket page. | Quarterfinal source labels are exactly `A1-B2`, `B1-A2`, `C1-D2`, `D1-C2`. Semifinal/final rows do not show source labels. |
| TC-GK12-08 | Finish knockout | Save QF, SF, and final scores. | Winners propagate through the knockout bracket and final winner is recorded. |
| TC-GK12-09 | Verify completion | Reload tournament detail and result rows. | Tournament has `status: completed`, `groupKnockoutPhase: completed`, and 19/19 confirmed results. |
| TC-GK12-10 | Verify points | Read awarded points from confirmed rows and detail result board. | 12-sign points match rules: champion 250, runner-up 150, semifinalists 100, quarterfinalists 65, group exits 20 in this deterministic all-0-2 slot-3 setup. |
| TC-GK12-11 | Verify bracket page tabs | Open `pages/tournament-brackets/index`. | Page shows only `小组赛` and `淘汰赛`; no `晋级链路` tab is present. |

## Test Data

Groups saved by the smoke:

| Group | Players |
| --- | --- |
| A | 王宜帆, 沈雅婷, 标子 |
| B | 杜导, Ella, 抖抖 |
| C | 小野马, 老板, 剑锋 |
| D | 哲身, 海伦, 许尧 |

Knockout bracket verified after group completion:

| Round | Pairings |
| --- | --- |
| QF | A1 王宜帆 vs C2 老板; B1 杜导 vs D2 海伦; C1 小野马 vs A2 沈雅婷; D1 哲身 vs B2 Ella |
| SF | 王宜帆 vs 杜导; 小野马 vs 哲身 |
| Final | 王宜帆 vs 小野马 |

Final ranking/points seen on tournament detail:

| Rank | Player | Record | Singles points |
| --- | --- | --- | --- |
| 1 | 王宜帆 | 5胜0负 | 250 |
| 2 | 小野马 | 4胜1负 | 150 |
| 3 | 杜导 | 3胜1负 | 100 |
| 4 | 哲身 | 3胜1负 | 100 |
| 5 | Ella | 1胜2负 | 65 |
| 6 | 沈雅婷 | 1胜2负 | 65 |
| 7 | 海伦 | 1胜2负 | 65 |
| 8 | 老板 | 1胜2负 | 65 |
| 9 | 标子 | 0胜2负 | 20 |
| 10 | 剑锋 | 0胜2负 | 20 |
| 11 | 抖抖 | 0胜2负 | 20 |
| 12 | 许尧 | 0胜2负 | 20 |

## Execution Log

1. Started from the create-tournament DevTools page and reproduced the earlier create-flow failure:
   - Console error: `UNSUPPORTED_FORMAT: group_knockout`
   - Root cause: `tournament-edit` step 2 still called the regular default schedule generator for `group_knockout`.

2. Added regression coverage and fixed create-flow routing:
   - `group_knockout` step 2 now saves setup and routes to tournament detail for bracket arranging.
   - `applyDefaultSchedule()` now handles `group_knockout` without throwing.

3. Ran local page tests:
   - Command: `cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm test -- --runInBand pages/tournament-edit/__tests__/index.test.js`
   - Result: 45 tests passed.

4. Ran WeChat DevTools preview and auto compile:
   - Command: `/Applications/wechatwebdevtools.app/Contents/MacOS/cli preview --project /Users/liaoxiaole/FOPEN-PURE --lang zh`
   - Result: preview package built, total size `605.1 KB`.
   - Command: `/Applications/wechatwebdevtools.app/Contents/MacOS/cli auto --project /Users/liaoxiaole/FOPEN-PURE --trust-project --lang zh`
   - Result: compile passed.

5. First real-cloud DevTools smoke failure:
   - Failure point: `generateGroupMatches`
   - Root cause: fresh cloud env did not have `tournament_groups`; `saveGroups` did not create the collection, and the console wrapper did not reject bad `errMsg`.
   - Fix: cloud function creates `tournament_groups` when saving/generating group matches; DevTools smoke wrapper rejects bad `errMsg`.

6. Ran cloud function tests:
   - Command: `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/tournament-brackets && npm test -- --runInBand __tests__/group-knockout-actions.test.js`
   - Result after first fix: 58 tests passed.

7. Deployed `tournament-brackets` to real cloud:
   - Command: `node scripts/deploy-cloud-functions.js --env cloud1-0gthnke69a09f52a tournament-brackets`
   - Result: `tournament-brackets true`, 12 files, pack size `72.2 KB`.

8. Second real-cloud DevTools smoke failure:
   - Failure point: `confirmKnockoutSeeds`
   - Error: `Cannot create field 'groups' in element {groupRankSnapshot: null}`
   - Root cause: cloud update tried to nested-merge into a previously null snapshot field.
   - Fix: replace `groupRankSnapshot` and `knockoutSeedSnapshot` using command `_.set(...)`.

9. Added regression coverage for null snapshot replacement:
   - Command: `cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/tournament-brackets && npm test -- --runInBand __tests__/group-knockout-actions.test.js`
   - Result: 59 tests passed.

10. Redeployed `tournament-brackets` to real cloud:
    - Command: `node scripts/deploy-cloud-functions.js --env cloud1-0gthnke69a09f52a tournament-brackets`
    - Result: `tournament-brackets true`, 12 files, pack size `72.2 KB`.

11. Ran final DevTools login-state smoke from Console:
    - Loader: `wx.request` loaded `/scripts/group-knockout-12-devtools-console.js` from local `http://127.0.0.1:8765`.
    - Console completion marker: `GK12_E2E_DONE`.
    - Tournament: `tournament_gk12_20260529035017`.
    - Result rows: 19 total, 12 group rows, 7 knockout rows.
    - Final champion: 王宜帆.

12. Verified detail page in WeChat DevTools:
    - Page: `pages/tournament-detail/index`.
    - Detail status bar shows `报名 小组赛 淘汰赛 赛果`.
    - Result board shows `已完成 19 / 19 场`.
    - Ranking/points match TC-GK12-10.
    - Footer has `查看签表`.

13. Verified bracket page in WeChat DevTools:
    - Page: `pages/tournament-brackets/index`.
    - The page shows two tabs only: `小组赛` and `淘汰赛`.
    - Group tab shows A-D groups, 3 matches each.
    - Knockout tab shows QF/SF/final.
    - QF shows source labels: `A1`, `C2`, `B1`, `D2`, `C1`, `A2`, `D1`, `B2`.
    - SF/final show only advanced player names, with no source labels.

## Observed Non-Blocking DevTools Noise

- `season_2026` load warning on the detail page: the tournament itself still rendered and completed; this is a season lookup warning in the current cloud data.
- DevTools index suggestion for `tournament_registrations` query on `{ tournamentId, seed }`.
- `WAWorker.js:1 [worker] reportRealtimeAction:fail not support`.

## Cloud Data Left Behind

This smoke intentionally writes real test data. The successful completed tournament is retained for inspection:

- `tournament_gk12_20260529035017`

Earlier failed runs may also remain with ids beginning `tournament_gk12_20260529034347` and `tournament_gk12_20260529034758`. Do not cleanup without explicit confirmation because cleanup would delete real cloud business rows if scoped incorrectly.
