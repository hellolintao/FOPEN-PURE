# FOPEN 小程序 · 实施进度日志

> 每完成一个 Phase 都更新这个文件。新对话第一步必读。

## 总进度

```
[████████████████░░░░░░░░] 4/6 Phase 完成
```

## Phase 状态

| # | Phase | 状态 | 开始时间 | 完成时间 | commit hash | 关键备忘 |
|---|---|---|---|---|---|---|
| 01 | Phase 1 · Foundation | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 756682a | 迁移 members 80 / tournaments 2 / match_results 3 条；3 个云函数加 Jest（4×3=12 测试全绿） |
| 02 | Phase 3 · Create Tournament | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 9da74f2 | court-grid 组件 + tournament-edit 重写为 5 步表单；Codex 验证补齐了双打 partnerId/seed 与编辑模式 `_syncRegistrations` 同步 |
| 03 | Phase 4 · Scheduler | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 9941d79 | scheduler-engine 上线（44 单测全绿，Lines 100%/Stmts 95%）；触发策略改为 C（签表页按钮）+ 保存合并 B + 双打 partnerId 入约束；plan 顶部记录 6 处修订 |
| 04 | Phase 2 · Browse UI | ✅ 已完成 | 2026-05-12 | 2026-05-12 | e95fcac | points-engine 云函数（7单测全绿）+ 组件库（stat-block/rank-row/brush-stroke-bg）+ custom tabBar（admin 可见管理 tab）+ home/rank/player-detail/mine 全面重写 |
| 05 | Phase 5 · Result Reconcile | ⬜ 待开始 | — | — | — | — |
| 06 | Phase 6 · Polish | ⬜ 待开始 | — | — | — | — |

**状态图例**：⬜ 待开始 / 🟦 进行中 / ✅ 已完成 / ⚠️ 阻塞

---

## 当前应该做什么

**👉 下一个 Phase**：`05-phase-5-result-reconcile.md`

打开该文件，从 "Task 1" 开始按步骤执行。

---

## 执行日志（按时间倒序）

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
