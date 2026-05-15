# FOPEN 小程序 · 实施进度日志

> 每完成一个 Phase 都更新这个文件。新对话第一步必读。

## 总进度

```
[████████████████████████] 6/6 Phase 完成（Phase 5/6 由 Phase 7+8 重做覆盖）
```

## Phase 状态

| # | Phase | 状态 | 开始时间 | 完成时间 | commit hash | 关键备忘 |
|---|---|---|---|---|---|---|
| 01 | Phase 1 · Foundation | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 756682a | 迁移 members 80 / tournaments 2 / match_results 3 条；3 个云函数加 Jest（4×3=12 测试全绿） |
| 02 | Phase 3 · Create Tournament | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 9da74f2 | court-grid 组件 + tournament-edit 重写为 5 步表单；Codex 验证补齐了双打 partnerId/seed 与编辑模式 `_syncRegistrations` 同步 |
| 03 | Phase 4 · Scheduler | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 9941d79 | scheduler-engine 上线（44 单测全绿，Lines 100%/Stmts 95%）；触发策略改为 C（签表页按钮）+ 保存合并 B + 双打 partnerId 入约束；plan 顶部记录 6 处修订 |
| 04 | Phase 2 · Browse UI | ✅ 已完成 | 2026-05-12 | 2026-05-12 | e95fcac | points-engine 云函数（7单测全绿）+ 组件库（stat-block/rank-row/brush-stroke-bg）+ custom tabBar（admin 可见管理 tab）+ home/rank/player-detail/mine 全面重写 |
| 05 | Phase 5 · Result Reconcile | ⏸ 由 Phase 7+8 重做覆盖 | — | — | — | 设计规范阶段废弃；录分/积分/对账由 Phase 8 实现 |
| 06 | Phase 6 · Polish | ⏸ 由 Phase 7+8 重做覆盖 | — | — | — | 设计规范阶段废弃；视觉打磨随 Phase 7/8 落地 |
| 07 | Phase 7 · Create+Schedule | ✅ 已完成 | 2026-05-13 | 2026-05-14 | 63ee6f5 + 2026-05-15 修订 | 4 步 wizard / 20min schedulePlan / 1h court-grid 日程表 / step 3 schedule-board 日程表 / player-picker-sheet / 常规赛自动填满每小时 2 场比赛 + 1 个自由拉球；generator + scheduler 迁入 brackets，scheduler-engine 标 @deprecated；新增 free-plays、courts 云函数；旧 Phase 5/6 暂置后 |
| 08 | Phase 8 · Score Engine | ✅ 完成 | 2026-05-15 | 2026-05-15 | 4df153f | _shared/award.js + sync 脚本（award+score-rule+bracket-generator+scheduler-mirror hash 比对）；match-results state machine（submitResult/confirmAll/reconfirmMatch/clearDownstream/maybeAwardPlacement，含修订 #1 confirmed 硬拦、#10 playerIds 校验、#2 推进同步 R+1）；score-rule 4 局制 + 3:3 抢七（100% 覆盖率，29 测试）；points-engine 重写 rankAggregate/recompute + 兼容 wrapper（rankList/playerStats/recalculateMatch）；aggregate 复合游标分页（2500 条测试通过）；score-row 组件 + tournament-score 页重写（轮次分组 / 内联编辑 / admin 一键确认）；tournament-manage 加待确认比分队列；my-match 加可录分比赛行；DATABASE_SCHEMA 同步 tournament_points 集合 + slotMinutes=20 + winLoss.walkover 字段说明 |

**状态图例**：⬜ 待开始 / 🟦 进行中 / ✅ 已完成 / ⚠️ 阻塞

---

## 当前应该做什么

**👉 全部 Phase 完成**（代码层面）。剩余动作：

1. Phase 8 Task 13 的 E2E 三条旅程已通过（admin 闭环 / player 提交 / 改分回滚）— 见下方「2026-05-15 · Phase 8 E2E 手动验证清单」节
2. Phase 8 全部改动已准备作为一次 commit 提交
3. commit 后回填本表的 commit hash 列
4. Phase 8 云函数已上传：`points-engine` 走 DevTools GUI；`match-results` 因 CLI/GU​​I 对 `lib/` 包处理不稳定，最终用临时 deploy-only bundle + `--paths` 成功部署

后续运维 / v3 演进见 spec §9.2。

---

## 执行日志（按时间倒序）

### 2026-05-15 · Phase 8 完成（Task 1-14 + E2E）

实施方式：superpowers:subagent-driven-development，14 个 Task 分别由 subagent 实施。用户决策：

- 「Phase 7 收尾 PROGRESS.md + bracket-generator.js 改动」先单独 commit（ae8b69f）再开 Phase 8
- 「每 Task 一次 commit」改为「Phase 完成后一次性 commit」
- Task 13 E2E 三条旅程已在 DevTools 自动化/GUI 环境通过
- 云函数上传已完成：points-engine 走 DevTools GUI；match-results 用 deploy-only bundle + `--paths` 避开 `lib/` EISDIR

**后端云函数：**
- `cloudfunctions/_shared/award.js` 新建（22 单测 / 100% lines / 95.87% statements）：`buildAwardEntries / buildPlacementEntries / finalRoundOf / ROLE_WINNER / ROLE_LOSER`；不入云函数包，通过 sync 脚本 vendor 到 match-results + points-engine
- `scripts/sync-shared-libs.sh` 新建：hash 比对 award.js 两份副本 + score-rule / bracket-generator / scheduler-mirror 三对前端 mirror
- `cloudfunctions/match-results/lib/score-rule.js` 新建（29 单测 / 100% 覆盖率）：4 局制 validateScore + computeWinner，3:3 抢七支持
- `cloudfunctions/match-results/lib/state.js` 新建（19 单测 / 99.27% lines / 93.86% statements / 81.69% branches）：状态机 `submitResult / confirmAll / reconfirmMatch / clearDownstream / maybeAwardPlacement`，applied 修订 #1（confirmed 硬拦）+ #10（playerIds 校验）+ #2（confirmOne 同步推进 R+1 match_results 占位 + 当前轮 bracket winner）
- `cloudfunctions/match-results/index.js` 新增 6 个 envelope action：`submit / confirmAll / reconfirmMatch / submittedQueue / listByTournament / listByPlayer`，新增 `resolveSubmitter()`（wxContext → members → `{ _id, isAdmin }`）+ `pagedFetchSubmitted()`（复合游标分页）；原 11 个 legacy action 保留
- `cloudfunctions/match-results/lib/award.js` vendor copy（hash 与 _shared 一致）
- `cloudfunctions/points-engine/lib/aggregate.js` 新建（8 单测 / 96.77% lines）：`aggregateRanks` 复合游标分页（50 / 250 / 2500 测试通过）
- `cloudfunctions/points-engine/index.js` 重写：新 actions `rankAggregate / recompute`；保留 wrapper `rankList / playerStats / recalculateMatch` 维持前端 home/rank/player-detail 契约（winCount / lossCount / totalPoints, 双 singles+doubles 桶, recent 10 场）
- `cloudfunctions/points-engine/lib/award.js` vendor copy（hash 与 _shared 一致）

**前端：**
- `miniprogram/utils/score-rule.js` vendor copy（hash 与 cloud 一致）
- `miniprogram/utils/scheduler-mirror.js` Phase 7 遗留 1 行注释 diff 已补齐（sync 通过）
- `miniprogram/components/score-row/` 新建：折叠 + 展开内联编辑器；stepper 0-4 + 3:3 触发 tiebreak input；双打 2 行 A/B vs C/D 布局（修订 #16）；event 字段统一 `score`（submit）/ `newScore`（reconfirm，二次确认弹窗）— 修订 #5
- `miniprogram/pages/tournament-score/` 完全重写：`onLoad({ tournamentId?, id?, matchId? })`（修订 #13 双参数兼容）；按 round 分组渲染 score-row；progress bar + admin 一键确认 sticky-bottom 按钮
- `miniprogram/pages/tournament-detail/index.js` `onEnterScore` 改用 `?tournamentId=` 协议
- `miniprogram/pages/tournament-manage/` 加「待确认比分」队列块（admin only，插在「我的草稿」之后、公开列表之前 — 修订 #17）
- `miniprogram/pages/my-match/` 加「可录分比赛」块；按 registrationStatus 过滤报名（修订 #18，不再 fallback `status`）；tournaments.list ids 批量拉名

**文档：**
- `cloudfunctions/DATABASE_SCHEMA.md`：补 `tournament_points` 集合（Phase 8 新）；schedulePlan.slotMinutes 改为 20；pointsRules 示例数值更新 + walkover 字段说明；pointsAwarded 结构改为 `{ source, entries: [{ memberId, points, role }] }`；tournament_registrations.partnerId 区分淘汰赛必填 vs 常规赛 nullable

**验证：**
- _shared: 22 tests
- match-results: 55 tests（validate + score-rule + state）
- points-engine: 16 tests（calculate + aggregate）
- tournaments: 19 tests
- tournament-brackets: 44 tests
- **核心 Phase 8 云函数单测全绿：match-results 55/55，points-engine 16/16**
- `scripts/sync-shared-libs.sh` 全过（award.js + 3 个 mirror）
- 全部 .js 文件 `node -c` syntax check 通过
- Phase 8 E2E 三条旅程通过：Admin 完整闭环 / Player 提交 + Admin 确认 / 改分回滚；DevTools Console 已清空且无可见红错

**遗留 / 注意：**
- Task 13 E2E 三条旅程已通过，见下方清单
- 云函数已上传到云端；`match-results` 保留源码 `lib/` 结构，部署时使用临时 bundle 目录规避 DevTools CLI `EISDIR`
- `state.js#maybeAwardPlacement` 假设 `tournament.format === 'knockout'` 时才发 placement，常规赛只走 winLoss entries
- `aggregate.js` 在常规赛仅有 `regularRound` matchKind 时也能正常聚合（不区分 matchKind，所有 confirmed 行的 entries 都进 totalPoints）
- `tournament_points` 表 placement 行的 createTime 是 maybeAwardPlacement 触发当下；改分回滚整体按 tournamentId remove 全部 placement 行
- 排行榜 100/页拉取在 2500+ 行级仍线性，>5000 时建议加 placement 增量索引（推 v3）
- score-row 双打 2 行布局依赖 `match.player1.partnerName / player2.partnerName`，后端 confirmOne 推进时填写
- `match-results.listByPlayer` 用 `playerIds: _.in([memberId]), resultStatus: _.neq('confirmed')` 过滤；BYE 行在前端再次过滤掉

### 2026-05-15 · Phase 8 E2E 手动验证清单（已通过）

**13.1 Admin 完整闭环**

- [x] 登录 admin → tournament-manage → 创建赛事 → 走完 4 步 wizard（draft 落库）→ 提交创建
- [x] tournament-detail 进入新赛事 → 排程页（schedule-board）可看到 R1 比赛 + 自由拉球
- [x] tournament-detail 底部「录入成绩」按钮 → 跳 tournament-score（带 `?tournamentId=`）
- [x] 录 R1 所有场次 → 一键「✓ 确认全部待确认」
- [x] bracket 自动推进 → 半决/决赛 player slot 出现 → 录半决 → 确认 → 录决赛 → 确认
- [x] 数据库 `tournament_points` 集合按 placement 桶入库（{tournamentId}_{memberId}_placement docId）
- [x] `tournaments[T].status = 'completed'`
- [x] 排行榜（rank 页）刷新 → 积分按 winLoss + placement 累加

**13.2 Player 提交流程**

- [x] 登录 player（非 admin）→ my-match「可录分比赛」区块 → 点击 → tournament-score（带 matchId anchor 滚动）
- [x] 内联编辑器 → 提交（resultStatus='submitted'，pointsAwarded=null）
- [x] 切 admin 账号 → tournament-manage 顶部「待确认比分」队列出现 → 点击 → tournament-score
- [x] admin「确认全部待确认」→ 该场 resultStatus='confirmed' + pointsAwarded.entries 写入

**13.3 改分回滚**

- [x] admin 在已 completed 的赛事打开 tournament-score
- [x] 改半决某场 winner（4:0 → 0:4）→ 二次确认弹窗 → 确认
- [x] `tournament_brackets` 决赛 winner / 对应 slot player 清空
- [x] `match_results` 决赛行 `resultStatus='pending'` + score/winner/pointsAwarded 清空
- [x] `tournament_points` 该 tournament 所有 placement 行删除
- [x] `tournaments[T].status='ongoing'`
- [x] reconfirm 内部 confirmOne 再次推进新 winner 到 R+1 slot

**任一旅程失败：** 回 Phase 8 对应 Task 修复后再 commit。三条全过 → commit Phase 8。

### 2026-05-15 · Phase 7 step 2/3 日程表修订 + 云函数上传

本次是在 Phase 7 已完成后的体验修订，目标是对齐俱乐部实际创建常规赛的排程方式。

**已完成：**
- `court-grid` 已从原 30min 多选格修订为「1 小时格日程表」：X 轴为 `availableCourts`，Y 轴为 08:00-21:00；点击 1 小时格后内部仍按 20 分钟写入 `schedulePlan.courts[].slots`（h:00 / h:20 / h:40）。
- `schedulePlan.slotMinutes` 固定为 20；`cloudfunctions/tournaments/lib/validate.js` 与测试已同步。
- `自由拉球`按钮改为免选球员，直接添加 `playerIds=[]` 的占位行，不再弹 picker。
- `commitStep3` 保存排程错误信息改用统一 `_isSuccess/_errMsg` 解包，兼容新 envelope `error.message` 与旧 `errMsg`，失败时 `console.error` 打完整 result 便于 DevTools 查日志。
- `schedule-board` 已从按球场队列列表改成按时间表展示：时间行 + 球场列；可继续长按格子上移/下移/换场地，非 bracket 行可删除。
- 常规赛进入 step 3 或点「重新随机安排」时自动填满所有已选 20min 格：每个 1 小时固定生成 `比赛 / 比赛 / 自由拉球`；自由拉球写 `free_plays` 占位，比赛写入 `matches + queues`。
- 常规赛配对算法改为按参赛者已排场次数平衡，尽量让所有人打相同场次；生成比赛标记 `matchKind: 'regularRound'`，避免被当成淘汰赛 bracket。
- step 3 保存时始终调用 `free-plays.bulkSet`，即使 `freePlays=[]` 也覆盖云端，避免用户删除自由拉球后旧数据残留。
- 单打添加球员弹窗支持按剩余名额多选；单打/双打添加场次仍分别按 2/4 人选择。

**验证：**
- `cloudfunctions/tournament-brackets`：44 tests passed（新增常规赛填满与配对平衡测试；generator regularRound 测试）。
- `cloudfunctions/tournaments`：19 tests passed。
- `cloudfunctions/match-results`：4 tests passed。
- 相关前端/云函数 JS 语法检查：`node -c` 全过。
- 微信开发者工具手动编译：问题面板 0 个问题；Console 仍有一个历史首页 timeout 旧日志，不是本次新增编译错误。

**云函数上传：**
- 已上传到 `cloud1-0gthnke69a09f52a`：`courts / free-plays / tournaments / tournament-brackets`。
- 备注：微信 DevTools CLI 对含子目录的 `tournaments / tournament-brackets` 函数直接 `--names` 上传时报 `EISDIR`；本次用临时 deploy-only 包（平铺运行时依赖文件）+ `--paths` 成功上传，未改仓库源码结构。

### 2026-05-14 · Phase 7 完成（17 Tasks 全部落库）

完成 commit 范围：`3f42b4c`（Task 1）→ `63ee6f5`（Task 16），共 19 个 commit（含两次 Task 2 修复）。

**后端云函数：**
- `tournaments`：新增 `create / updateNew / list / lastPointsRules` envelope actions；写入 `createdBy/createdByOpenid`（通过 OPENID → members 解析）；list 支持 `status / statusNot / createdBy / ids` 过滤；`validateSchedulePlan` + `validatePointsRules` (19 单测全绿，96.4% / 95.5% 覆盖率)；legacy `add` / `update` 保留兼容
- `tournament-registrations`：`bulkSet` 幂等批量设置（先校验后删除）
- `tournament-brackets`：新增 `lib/generator.js`（BYE 自动推进 + 推进公式，17 单测全绿，97.95% 覆盖率）、`lib/scheduler.js`（顺序填满场地，6 单测全绿，100% 覆盖率）；从 scheduler-engine 迁来 `pairing/round-robin` + `pairing/knockout-bracket`（19 单测）；4 个测试套件共 42 测试全过；新增 actions `saveInitialMatches / saveSchedule / regenerateDraft`；放宽 validator 允许 `player1=null` 和 `player2={id:'BYE'}`
- `match-results`：`bulkUpsertScheduledMatches`（写 `position`，预建 R2+ 占位行）
- `free-plays`（新建）：`bulkSet / create / list / remove`，集合 `free_plays`
- `courts`（新建，2026-05-14 review 修订 #3 新增）：`list / create / update`，集合 `courts`
- `scheduler-engine`：标 @deprecated（44 单测保留），README 注明迁移路径

**前端组件 / 页面：**
- `court-grid`：完全重写为 30min 颗粒度 28-slot grid（08:00-22:00），按 `availableCourts` 渲染
- `player-picker-sheet`（新建）：`requiredCount: 1|2|4`（应用 2026-05-14 修订 #7），search + 多选
- `schedule-board`（新建）：按场地分组渲染 R1 matches + freePlays + extra，长按 actionsheet（上/下/换场/删除），点选手 → picker
- `tournament-edit`：完全重写为 4 步 wizard（基本信息 → 球员+球场 → 排程 → 积分），草稿即落库；pickerMode=1 协议通过 `app.globalData.lastSelectedPlayers` 回传
- `tournament-brackets`：按场地维度只读展示 R1 + 灰色 R2+ 占位 + 自由拉球；移除自动排程入口和手动指派 actionSheet
- `tournament-view`：改用 `schedulePlan` 替代 `courtTimeGrid`，按场地分组只读展示
- `tournament-manage`：拉「我的草稿」（status=draft, createdBy=me）+ 公开列表（statusNot=draft）
- `tournament-detail`：draft 显示「继续创建」按钮，upcoming + admin 显示「编辑」按钮
- `tournament-add-player / tournament-add-players-doubles`：补 pickerMode=1 协议（globalData 回传）

**前端 utils（vendored CommonJS 副本，Phase 8 sync 比对）：**
- `miniprogram/utils/bracket-generator.js`：mirror of cloud lib/generator.js
- `miniprogram/utils/scheduler-mirror.js`：mirror of cloud lib/scheduler.js

**应用 2026-05-14 review 修订（10 条全部落地）：**
1. ✅ 统一新 response contract `{ success, data } / { success: false, error }`（新增 actions 全部应用）
2. ✅ draft 必须写 `createdBy/createdByOpenid`，list 支持 `createdBy/statusNot/ids` 过滤
3. ✅ 补 `cloudfunctions/courts`
4. ✅ tournament-view 改用 schedulePlan（Task 15 一并完成）
5. ✅ `bulkSet` 先校验后删除（tournament-registrations）
6. ✅ `match_results` 写 `position` + 预建 R2+ 占位行
7. ✅ `player-picker-sheet` 用 `requiredCount: 1|2|4`
8. ✅ 前端 utils mirror 保留 CommonJS module.exports（不改 ES module）
9. ✅ Task 14 pickerMode=1 接 `app.globalData.lastSelectedPlayers` + `onShow` 回传
10. ✅ DATABASE_SCHEMA.md 同步更新（2026-05-14 复核修正：schedulePlan / pointsRules / free_plays / courts / match_results.position / registrationStatus 已补齐）

**已知遗留 / Phase 8 起步前需注意：**
- `miniprogram/utils/bracket-generator.js` + `scheduler-mirror.js` 是手动 vendored 副本，未接 `sync-shared-libs.sh`（Phase 8 实装该脚本时把它们也纳入 hash 比对）
- `tournament-add-players-doubles` 的 pickerMode=1 多支队伍累积模式已加 WXML 确认按钮，但 UX 较简陋
- `tournaments.list` 兼容 list shape：旧 `{ data: array }`（legacy `tournament-detail` get 仍依赖）共存于新 `{ success, data: { tournaments, total } }`；新页面读 `data.tournaments`，已就位
- legacy `tournament-edit` 旧入口已不存在；老 `add / update` action 保留为兼容 wrapper（无新页面调用）
- 云函数已于 2026-05-14 通过微信开发者工具 GUI 上传到 `cloud1-0gthnke69a09f52a`：`tournaments / tournament-registrations / tournament-brackets / match-results / free-plays / courts / scheduler-engine`

### 2026-05-14 · Phase 7/8 plan 头部 File Structure 与 §3–§7 覆盖 review
- 结论：`07-phase-7-create-schedule.md` / `08-phase-8-score-engine.md` 大方向可执行，但不能按原文直接开工；已在两个 plan 顶部追加「2026-05-14 Review 修订」作为执行前覆盖口径。
- Phase 7 覆盖关系：§3 创建流程与 §4 首轮排程基本完整；§5/§6 只做录分/积分前置；§7 入口覆盖了 `tournament-edit / tournament-brackets / tournament-detail / tournament-manage`，但原 plan 漏了 `tournament-view` 和 `courts`，已补入 File Structure 与 Task 备注。
- Phase 8 覆盖关系：§5 比分录入与 §6 积分引擎基本完整；§7.5 的 `manage / my-match` 覆盖到位；原 File Structure 漏了 Task 12 依赖的 `cloudfunctions/tournaments.index:listByIds`，已补入。
- 关键修订 1：统一新云函数 response contract；旧 actions 可保留，但新页面不能假设旧返回 shape。`tournament-edit / tournament-score / my-match` 要么调新 wrapper，要么写兼容解包。
- 关键修订 2：draft 可见性必须有 `createdBy`。`tournaments.create(status='draft')` 必须通过 `OPENID → members` 写 `createdBy/createdByOpenid`；`list` 支持 `status/statusNot/createdBy/ids`。
- 关键修订 3：`match_results` 新 schema 必须带 `position`；Phase 7 保存初始 bracket 后要预建 R2+ 占位 result 行，Phase 8 推进时同步更新下一轮 result 行，否则“首轮确认 → 半决录分 → 决赛录分”的 E2E 会断。
- 关键修订 4：`player-picker-sheet` 改为 `requiredCount: 1|2|4`，替代旧 `single: Boolean`；否则单打自由拉球/添加场次只能选 1 人。
- 关键修订 5：普通会员不得修改 confirmed 行；`match-results/lib/state.submitResult` 必须硬拦，admin 改 confirmed 走 `reconfirmMatch` + 二次确认。
- 关键修订 6：前端 mirror 要做 hash 比对就必须 CommonJS 原样复制，不允许改 ES module 后再用精确 hash。
- 关键修订 7：`tournament-registrations.bulkSet` 必须先校验全部新 docs，再删除旧报名，避免非法输入导致旧报名被清空。
- 后续执行顺序建议：先做 Phase 7 修订节列出的基础契约（response / createdBy / courts / schema / match_results 占位），再进入原 Task 1；Phase 8 开始前先确认 Phase 7 的 R2+ result 占位行已经存在。

### 2026-05-13 · §8 测试策略 / §9 风险与开放问题评估
- 结论：§8 / §9 结构可继续，但当前版本不能直接判定 OK；需要先修正测试预期与风险描述中的几处自相矛盾，再整合进 `docs/superpowers/specs/2026-05-13-tournament-flow-redesign-design.md`。
- scheduler 测试与算法命名冲突：文案写“轮询填场地”，但 `4 场比赛 / 3 场地（容量 2/2/2）→ court[0]=2, court[1]=2, court[2]=0` 更像“顺序填满场地”。若保留轮询，预期应接近 `2/1/1`；若保留当前预期，应把算法名改为“顺序填场地”。
- BYE 分散测试与 v3 推迟项冲突：§8 要求 `12 人 → 16 槽，4 个 BYE，分散到不同 R1 位置`，但 §9.2 又把“BYE 智能分配”推迟到 v3。第一版需二选一：要么做确定性分散并测试，要么只测 BYE 数量、自动推进和无空 winner。
- 玩家覆盖提交的描述不一致：state machine 写 `submitted → 任意人覆盖 → submitted（旧 submission 直接丢）`，风险缓解又写管理员能看到所有 submitted 内容。若旧提交直接丢，管理员只能确认最新提交；若要看到所有提交，需要保留 `submissionHistory`。
- 0 / 1 / 2 人边界不能写“报错或 noop”：测试策略必须拍死行为。建议默认 `0/1` 抛 `INSUFFICIENT_PLAYERS`，`2` 正常生成 1 场 final 且无 BYE。
- confirmed 改分后的 award 重算需要幂等定义：`winner 不变 → 仅覆盖 entries` 要明确是按 `matchResultId` 删除旧 entries 后重建，还是 upsert。测试需补“重复 confirm 同一结果不会产生重复积分 entries”。
- aggregate 分页测试不宜假设 1000 条单页拉完：更稳的写法是显式传 `pageSize=100`，用 250 / 2500 条验证多页拉取，并指定稳定排序键（例如 `createTime + _id` 或 `_id`）保证无重复无遗漏。
- 开放问题默认值基本可接受：Q1 回退 step 2 后丢弃 bracket 并重生成；Q2 第一版不做真拖，用 actionsheet 改场地 + 上下箭头改顺序；Q4 不改 `tournament-score` 路径；Q5 draft 仅创建者可见。
- Q3 建议微调：已确认行 admin 可以直接点开重编辑，但保存时必须二次确认，尤其 winner 改变会清后续 bracket / placement。
- 建议补测：BYE 自动晋级是否不产生 award entries；final confirmed 后生成 placement，改 semifinal winner 后清掉 final result 和旧 placement；`confirmAll` 重复调用幂等；player 提交权限是否仅限参赛双方。

### 2026-05-13 · §7 路由、页面与入口评估
- 结论：§7 方向可继续，但当前版本不能直接判定 OK，需要先修正以下设计问题后再进入 §8 测试 / §9 风险。
- 页面命名冲突：现有已注册页面是 `pages/tournament-score/index`，§7 新建 `pages/score-entry/index`。需要明确是迁移重命名还是复用旧页；否则 `app.json`、`tournament-detail`、`manage`、`my-match` 的跳转会出现双入口或断链。
- 旧录分页参数不兼容：`tournament-score` 当前 `onLoad` 要求 `tournamentId + round`，但 `tournament-detail.onEnterScore` 传 `id`，§7 的“赛事维度比分录入”需要重做入口协议，支持按赛事聚合后选择/折叠每场。
- `tournament-edit` 步骤与现状冲突：现有是 5 步（基本信息 / 场地时段 / 积分规则 / 选手 / 确认），§7 改成 4 步且把“球员+球场”“首轮排程”前置。需要明确创建过程中的持久化顺序：没有 tournamentId 时不能可靠保存报名、排程和 free play。
- `courtTimeGrid` → `schedulePlan` 是全链路迁移：当前 `tournaments`、`tournament-edit`、`tournament-brackets`、`tournament-view`、`scheduler-engine`、`DATABASE_SCHEMA` 都读写 `courtTimeGrid`。§7 写“删旧 courtTimeGrid 处理”会破坏现有排程，需要兼容读旧字段、迁移脚本或一次性清库策略三选一。
- 30min 颗粒度与现有实现冲突：当前 `court-grid` 和日志记录是 20min 自动切档。若改 30min，需同步说明数据结构、旧数据处理和 UI 文案。
- 删除 `scheduler-engine` 有迁移风险：当前签表页按钮调用 `scheduler-engine:schedule`，且 44 个单测覆盖算法。若删除云函数，必须把 `greedy`、`round-robin`、`knockout-bracket` 逻辑迁入 `tournament-brackets` 或共享 lib，并保留/迁移测试覆盖。
- `tournament-brackets` 新 actions 未落到旧 action 兼容策略：现有 actions 是 `add/update/getByTournament/getByRound/updateMatchScore/updateMatchStatus` 等；§7 新增 `generate/saveSchedule/addFreePlay/addExtraMatch/reorderQueue`，需要定义旧 action 是否保留，前端哪些调用同步替换。
- BYE / TBD / 灰色后续轮需要校验策略：当前 bracket validator 要求 `player1.id/player2.id`，现有占位用 `TBD/BYE` 勉强可过，但 §7 的自动晋级和后续轮灰占位必须明确状态、不可录分约束、推进公式和改分回滚规则。
- `match-results` 直接 `require('../points-engine/lib/award')` 在云函数部署中有风险：微信云函数通常按单函数目录打包，兄弟目录不会天然存在。应把 `award` 放进 `match-results/lib`、复制 vendored lib，或建立明确的共享包/构建步骤。
- `points-engine` action 兼容问题：现有 `home/rank/player-detail` 调用 `rankList/playerStats`。§7 写 index 只剩 `recompute/rankAggregate`，需要保留兼容 wrapper 或同步改所有调用点。
- `manage` 的“待确认比分”不是现有数据源：当前 `manage` 拉 `tournament_brackets` 列表并跳旧录分页。§7 要按 tournament 聚合显示待确认数量，必须定义来源是 `match_results.resultStatus=pending/disputed` 哪些状态，以及是否只管理员可见。
- `my-match` 入口粒度不匹配：当前只列“我参与的赛事”，不列“每场比赛”。§7 的每场“录入比分”快捷入口需要新增用户参与比赛查询，尤其双打要同时匹配 `playerId/partnerId`。
- `free-plays` 新函数/集合缺 schema 与入口边界：需要补 `free_plays` 字段、索引、删除策略、是否参与积分、是否参与待确认队列，以及和 bracket match 的展示顺序。
- `cleanup-test-data.js` 是破坏性脚本：可以保留“仅本地手动跑”，但必须加环境变量确认和目标环境打印，避免误清正式云环境。

### 2026-05-12 · Phase 2 完成
- 新建 `cloudfunctions/points-engine/` 云函数：
  - `lib/calculate.js` 积分计算（calculatePoints / isPointValid，7 单测全绿）
  - `index.js` action=rankList|playerStats|recalculateMatch，全部带 try/catch 错误处理
- 新建组件库：
  - `miniprogram/components/stat-block/` 数字统计展示
  - `miniprogram/components/rank-row/` 排名条目（头像 + 名字 + 积分 + 涨跌趋势）
  - `miniprogram/components/brush-stroke-bg/` SVG 装饰背景
- 新建 `miniprogram/custom-tab-bar/` 自定义 tabBar：管理员可见第 5 个"管理"tab；用 pagePath 作为选中键；图标用图片资源
- 更新 `miniprogram/app.js`：globalData 加 isAdmin / currentMember；refreshIdentity 在 cloud init 后调用
- 重写 `miniprogram/pages/home/`：hero 板块 + quick actions + 个人 stat 三格
- 重写 `miniprogram/pages/rank/`：单/双打 tab + #1 hero 卡 + rank-row 列表 + 空态
- 新建 `miniprogram/pages/player-detail/`：并行拉 members.getById + points-engine.playerStats，单/双打各 3 格 + 近期比赛列表
- 改造 `miniprogram/pages/mine/`：hero card + action 按钮，保留原有登录/积分逻辑
- `cloudfunctions/members/index.js` 新增 getById action（with _id null guard）

### 2026-05-12 · Phase 4 完成
- 新建 `cloudfunctions/scheduler-engine/` 云函数：
  - `lib/constraints.js` 约束（含 collectMatchPlayerIds / isPlayerFree / isMatchFreeOfConflicts / hasRestBetween / matchHasRestBetween），双打把 4 个 playerId 全部计入
  - `lib/greedy.js` 贪心排程，输出对齐 `tournament_brackets.matches[*]` schema（`player1/player2` 对象 + `courtId/scheduledStart/scheduledSlotId/status`）
  - `lib/pairing/round-robin.js` 常规赛配对（单/双打）
  - `lib/pairing/knockout-bracket.js` 单败签表（标准 seeding，1 vs N 在 R1 不同对、补 BYE、R2+ 用 TBD 占位）
  - `index.js` action=schedule|preview，落库走 `tournament-brackets:add/update`（不绕 validator），upsert 时保留旧 winner/score
  - 单测：44 例全绿；Lines 100% / Stmts 95.13% / Branches 81.6%
- 签表页 `tournament-brackets`：
  - 顶部加「自动排程」按钮（策略 C，不在创建赛事流程里触发）
  - 每场比赛卡片用 WXS 展示 `时段 · 场地`，未排程标红
  - 顶部 unscheduled 警告条 + 每条「手动指派」按钮（弹 actionsheet 选 `(slot, court)`）
  - 保存合并（策略 B）：手动改完保存时按 matchId/position 保留 courtId/scheduledStart/scheduledSlotId/winner/score
- 关键 plan 修订（落入 `03-phase-4-scheduler.md` 顶部「2026-05-12 执行决策」节）：
  - 触发 = C：签表页手动按钮（避免创建流程被排程失败拖累）
  - 保存 = B：merge 保留排程字段
  - 双打 partnerId 必须计入冲突 + 休息约束
  - 算法内部数据结构对齐 DB schema（不用扁平 playerIds）
  - 不再 `.catch(()=>{})` 静默吞错；落库改 upsert
  - 修正 Task 5 测试断言（原 plan 自己打自己脸）
- 已知遗留：
  - `cloudfunctions/scheduler-engine/node_modules/` 同 `tournaments/` 一样会随 npm install 入库；如需清理用 `git rm --cached -r`
  - 云函数尚未上传到云端（需 admin 在 WeChat DevTools 里上传或 `FOPEN_CLOUD_ENV=... bash uploadCloudFunction.sh scheduler-engine`）
  - `tournament-brackets:updateMatchStatus` 现有 action 用 `scheduledTime`，scheduler-engine 写的是 `scheduledStart`，未来要统一字段名（暂不影响功能）

### 2026-05-12 · Phase 3 完成
- 新建 `miniprogram/components/court-grid/`（208 行 js）：场地增删 / 时段大块编辑（自动切 20min 档）/ 格子矩阵点选 / 序列化与反序列化
- 重写 `miniprogram/pages/tournament-edit/` 为 5 步表单：基本信息 / 场地时段 / 积分规则 / 选手 / 确认提交
- 用户决策：放弃当前 config UI（maxPlayers / playersPerMatch / eliminationType），云函数默认值兜底；playersPerMatch 仍由 type 自动推导
- 偏离 plan 的修正：
  - `tournaments:update` 用 `id` 而非 `_id`（与现网云函数一致）
  - WXML 用预计算的 `selectedPlayerMap[id]` 替代 `.indexOf/.includes`（兼容旧基础库）
  - `tournament-registrations:listByTournament` 不存在，改用 `list` + `tournamentId` 过滤
- Codex 验证补全（commit `9da74f2`）：
  - 双打报名需 `partnerId/partnerName/teamName/seed`，未传则云函数 validation failed
  - 编辑模式改选手不持久化 → 新增 `_syncRegistrations`：先全删旧报名再批量 add，create / edit 同一路径
  - 新增双打配对预览 UI（按选择顺序两两成 `#N A/B`）
  - 切换 type 时重置选手；编辑模式 hydrate doubles partnerId
  - `_assertRegistrationResult` 显式抛出云函数的 errMsg，避免静默失败
- 顺带修复：`uploadCloudFunction.sh` 已修复（commit `b6936bf`），脚本会在 cli 出错时返回非 0；Phase 1 遗留的"需手动右键上传"问题解除
- 已知遗留：`cloudfunctions/tournaments/node_modules/` drift 在 commit `3dd507c` 里被一并提交（不影响功能）；`_syncRegistrations` 删-再-加不是事务，中途失败会留下部分报名，可重试修复

### 2026-05-12 · Phase 1 完成
- 全部 12 个 Task 完成，最终 commit `756682a`
- 数据库迁移：members 80 条、tournaments 2 条、match_results 3 条
- 3 个云函数（members / tournaments / match-results）接入 Jest，共 12 个测试全绿
- 设计 token / base / utilities 三个 wxss 上线，app.wxss 切换浅底主题
- 顺手清理：`project.private.config.json` 加入 .gitignore 并停止跟踪（commit `59f5d5e`）
- 已知遗留：`cloudfunctions/tournaments/node_modules/` 历史上被入库，本期未处理（npm install 会产生 diff 噪声）；建议下个 Phase 用 `git rm --cached -r` 清掉
- `uploadCloudFunction.sh` 文件已损坏（单行无 shebang、变量未定义、不接受函数名参数），云函数上传当前需要在微信开发者工具里手动右键上传

### 2026-05-12
- 文档一致性修复：根 README 改为项目入口；spec / DATABASE_SCHEMA / plans README 对齐字段命名与执行说明
- 明确 `match_results.status` 保留为比赛生命周期；结果确认状态统一使用 `resultStatus`
- 明确赛事结束态使用当前代码里的 `completed`，不再使用 `ended`
- 明确 `tournaments.format` 是现有字段：`regular` / `knockout`

### 2026-05-11
- 设计规范完成（superpowers:brainstorming 流程）
- 6 个 Phase plan 完成（superpowers:writing-plans 流程）
- 等待开始 Phase 1 执行

---

## 跨对话决策档案

> 实施过程中如果做出任何**偏离 spec** 的决定，记到这里，下个对话能看到。

- `match_results.status` 保留为比赛生命周期：`pending` / `ongoing` / `completed` / `cancelled`。
- 结果对账状态统一使用 `match_results.resultStatus`：`pending` / `confirmed` / `disputed`。
- 赛事状态统一使用当前代码中的 `upcoming` / `ongoing` / `completed`，不再使用 `ended`。
- `tournaments.format` 为现有字段，取值 `regular` / `knockout`，后续 points / scheduler 逻辑以它区分常规赛与淘汰赛。
- Phase 7/8 新增 actions 统一返回 `{ success, data }` / `{ success:false, error }`；旧 actions 可以兼容保留，但新页面优先调 wrapper 或做兼容解包。
- `status='draft'` 赛事必须写 `createdBy/createdByOpenid`，且只允许创建者本人从草稿入口恢复；公开列表全部过滤 draft。
- `schedulePlan` 不兼容 `courtTimeGrid`，Phase 7 走清库策略，同时更新 `DATABASE_SCHEMA.md`；所有新视图读取 `schedulePlan`。
- `match_results` 从 Phase 7 起写 `round/position/sourceMatchId/player1/player2/playerIds`；R2+ bracket 占位也要有对应 result 占位行。
- `player-picker-sheet` 选择数量统一用 `requiredCount`，不要再用 `single` 布尔值表达 1/4 人选择。
- 普通会员只能提交 pending/submitted；confirmed 行只能由 admin 走二次确认改分。
- 淘汰赛 / legacy 首轮排程仍采用「顺序填满场地」（court[0] 满了到 court[1]），不做轮询。常规赛从 2026-05-15 修订起改为按日程表填满：每个已选 1 小时生成 2 场 `regularRound` + 1 个自由拉球占位，并按参赛者场次数平衡配对。
- `schedulePlan.slotMinutes` 固定为 20；Step 2 UI 可用 1 小时格选择，但入库必须展开成 3 个 20min slot。
- Step 3 保存自由拉球必须整体覆盖：即使 `freePlays=[]` 也调用 `free-plays.bulkSet`，避免云端残留旧自由拉球。
- BYE 第一版不做智能分散，仅测 BYE 数 + 自动推进 + 无空 winner（与 spec §8 / §9.2 一致）。
- `scheduler-engine` 不删，标 @deprecated；pairing 副本迁到 `cloudfunctions/tournament-brackets/lib/pairing/`，44 单测仍保留为回归基准。
- `miniprogram/utils/bracket-generator.js` 与云函数 `lib/generator.js` 是 vendored 副本（CommonJS module.exports），Phase 8 `sync-shared-libs.sh` 同步比对；`miniprogram/utils/scheduler-mirror.js` 同理对应 `lib/scheduler.js`。

---

## 阻塞 / 待办

> 实施中遇到的需要用户决策、但当时没法立即解决的事项。

- §7 需要先定 4 个口径：`score-entry` 是否替换 `tournament-score`；`schedulePlan` 是否兼容 `courtTimeGrid`；删除 `scheduler-engine` 后算法代码放哪里；`points-engine` 是否保留 `rankList/playerStats` 兼容 action。
- §8 / §9 需要先定 4 个口径：scheduler 是轮询还是顺序填满；BYE 第一版是否做分散分配；submitted 覆盖是否保留历史；award entries 重算用删除重建还是 upsert。
- 2026-05-14 更新：上述 §7 / §8 / §9 阻塞项已被 `07-phase-7-create-schedule.md` 与 `08-phase-8-score-engine.md` 顶部 Review 修订吸收。后续执行以两个 plan 的「2026-05-14 Review 修订」为准；本节保留历史记录。

---

## 关键命令速查

```bash
# 上传单个云函数（朋友写的脚本）
bash uploadCloudFunction.sh <函数名>

# 跑云函数本地测试
cd cloudfunctions/<函数名> && npm test

# 查看当前 git 状态
git status && git log --oneline -10
```
