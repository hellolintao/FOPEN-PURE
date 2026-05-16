# FOPEN 小程序 · 端到端回归测试设计 spec

- 日期：2026-05-17
- 范围版本：Post Phase 10-2 回归测试体系
- 状态：设计已审定，等待写实施 plan
- 上游文档：
  - 录分与积分引擎：`docs/superpowers/plans/08-phase-8-score-engine.md`
  - v2.1 质量迭代：`docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design.md`
  - 排行榜与玩家详情：`docs/superpowers/specs/2026-05-16-rank-and-player-detail-design.md`
  - 当前进度：`docs/superpowers/plans/PROGRESS.md`
- 维护：本文档是“完整测试一轮”唯一设计来源；后续 plan、脚本、测试用例和手工验收清单都以本 spec 为准。

---

## 1. 范围与成功标准

### 1.1 目标

建立一套可重复执行的闭环回归测试，覆盖用户提出的完整业务链路：

管理员创建比赛 -> 安排对局 -> 生成录分行 -> 会员录入比分 -> 管理员保存/确认比分 -> 比分和比赛结果写入系统 -> 排行榜更新 -> 用户详情页出现积分和比赛记录更新。

同时覆盖管理员与会员混合使用场景：

- 管理员自己也是参赛会员时，`my-match` 只展示参赛者视角，管理页展示管理员视角。
- 非参赛会员不能提交比分。
- 普通会员不能覆盖已确认比分。
- 管理员能改分，并触发下游签表、积分、赛事状态回滚。

### 1.2 范围内

| 类别 | 内容 |
|---|---|
| 本地自动化 | 新增/完善 Jest 回归用例，覆盖云函数状态机、批处理、积分聚合、会员摘要、页面 orchestration |
| 云端 smoke | 清空业务测试集合，重建固定 fixture，验证真实数据库聚合与真实云函数查询结果 |
| 开发者工具 smoke | 使用微信开发者工具登录态跑管理员/会员关键路径，验证真实 `wxContext.OPENID` 权限链路 |
| 手工 E2E 清单 | 写出可逐条执行的测试用例，包含前置数据、步骤、期望结果、失败排查点 |
| 数据脚本 | 扩展测试数据清理/重建脚本，输出可读报告，默认保留 fixture 给手工验证 |
| 文档 | 新增测试执行说明，记录危险操作保护、命令、验收门槛、清理方式 |

### 1.3 显式不做

- 不改业务规则：4 局制、3:3 抢七、win/loss/placement 积分口径沿用 Phase 8/10。
- 不新增测试专用云函数后门。
- 不在测试脚本里伪造 `wxContext.OPENID`。依赖登录态的权限链路放到开发者工具 smoke 或手工 E2E 验证。
- 不清空 `members`、`courts`、`seasons`。这些是基础主数据，清空会破坏登录身份、场地和赛季判断。
- 不把真实云端 smoke 绑定到单个硬编码会员姓名；脚本按现有 `members` 数据选择 1 个 admin 和若干普通会员。
- 不要求每条手工 E2E 都自动化。页面视觉、真实账号切换、开发者工具交互仍保留人工验收项。

### 1.4 验收门槛

| # | 标准 | 度量 |
|---|---|---|
| 1 | 本地云函数回归全绿 | 可运行云函数 Jest 全部通过，新增闭环用例通过 |
| 2 | 小程序页面逻辑回归全绿 | `cd miniprogram && npm test` 全部通过，新增 tournament-score/my-match/rank/player-detail 逻辑用例通过 |
| 3 | 数据清理保护有效 | 未设置确认变量时，清理脚本拒绝执行并输出目标环境 |
| 4 | 云端 fixture 可重建 | 清空 8 个业务集合后，脚本能写入固定赛事、报名、签表、录分行、确认结果和积分数据 |
| 5 | 云端聚合正确 | `points-engine.rankList/playerStats/playerH2H` 返回的积分、胜负、recent 与 fixture 预期一致 |
| 6 | 会员摘要正确 | 登录态验证下，`my-match` 的 pending/submitted/confirmed 三段与 fixture 状态一致 |
| 7 | 管理员确认正确 | 登录态验证下，管理员保存/确认后，`match_results.resultStatus`、`pointsAwarded.entries`、`rankList`、`playerStats.recent` 同步更新 |
| 8 | 混合角色正确 | admin 作为参赛者在 `my-match` 看到会员视图，在管理入口看到待确认视图 |
| 9 | 负向权限正确 | 非参赛会员提交失败；普通会员覆盖 confirmed 失败；非 admin 调管理员接口失败 |
| 10 | 手工清单可执行 | 每条用例包含前置数据、操作步骤、预期结果、可查询的数据断言 |

---

## 2. 测试分层

### 2.1 Layer A · 本地 Jest 回归

目的：快速发现业务不变量回归，适合每次代码变更后执行。

覆盖点：

- `match-results/lib/state.test.js`
  - pending -> member submitted -> admin confirmed。
  - pending -> admin save -> confirmed + award。
  - knockout R1 确认后推进下一轮 `tournament_brackets` 和 `match_results`。
  - 决赛确认后写 placement `tournament_points` 并完成赛事。
  - reconfirm winner 翻盘后清下游、清 placement、赛事回 ongoing。
  - 非参赛会员提交失败。
  - 普通会员覆盖 confirmed 失败。
- `match-results/lib/__tests__/handlers/batch.test.js`
  - `batchSubmit` 多场提交。
  - `batchAdminSave` 带比分直接确认 pending/submitted 行。
  - `batchConfirm` 乐观锁、幂等、局部失败、非 admin 禁止。
- `match-results/lib/__tests__/handlers/my-summary.test.js`
  - 会员能看到 pending/submitted/confirmed 三段。
  - confirmed 行 `pointsEarned` 从 `pointsAwarded.entries` 中按当前会员求和。
  - admin 调用时仍按参赛会员视图返回，不混入管理待办。
- `points-engine/lib/__tests__/aggregate.test.js`
  - 确认比分和 placement 积分同时参与 rank 聚合。
  - 胜负、积分、排序、tie-breaker 正确。
- `points-engine/lib/__tests__/player-stats.test.js`
  - recent 比分格式、对手、积分、胜负标记正确。
- 小程序 Jest
  - `pages/tournament-score/__tests__/index.test.js` 覆盖 admin save sheet、member submit sheet、sheet retry 和 close refresh。
  - 新增 `pages/my-match/__tests__/index.test.js` 覆盖 pending/submitted row 跳转。
  - 新增 `pages/rank/__tests__/index.test.js` 覆盖 rankList + weekly-star 并发加载、切 tab、player tap。
  - 新增 `pages/player-detail/__tests__/index.test.js` 覆盖 stats/H2H/recent 数据映射和 H2H tap。

### 2.2 Layer B · 数据库级云端 smoke

目的：验证真实云数据库数据形态、真实 `points-engine` 聚合、真实 `playerStats/playerH2H` 查询。

执行方式：

1. 要求显式环境变量：
   - `FOPEN_CLOUD_ENV=<envId>`
   - `FOPEN_CLEANUP_CONFIRM=<same envId>`
   - `FOPEN_RESET_BUSINESS_DATA=YES`
2. 清空业务集合：
   - `tournaments`
   - `tournament_brackets`
   - `tournament_registrations`
   - `match_results`
   - `tournament_points`
   - `free_plays`
   - `rank_snapshots`
   - `weekly_stars`
3. 保留基础集合：
   - `members`
   - `courts`
   - `seasons`
4. 从 `members` 中选择：
   - 第一个 `admin === true` 或 `isAdmin === true` 的会员作为 `adminMember`
   - 至少 5 个普通会员作为 `memberA` 至 `memberE`
5. 从 `courts` 中选择至少 2 个可用场地；不足则脚本中止。
6. 从 `seasons` 中选择当前赛季；若缺失则中止并提示人工补齐，不静默创建赛季。

数据库级 smoke 不调用 `match-results.batchSubmit/batchAdminSave`，因为这些接口依赖 `cloud.getWXContext().OPENID`。脚本直接写入 fixture，其中 confirmed 子集用于验证真实 `points-engine` 查询与聚合，pending/submitted 子集保留给开发者工具登录态 smoke。

### 2.3 Layer C · 开发者工具登录态 smoke

目的：验证依赖 `wxContext.OPENID` 的真实权限链路。

覆盖点：

- 会员登录态：
  - 打开 `my-match`，看到待录分。
  - 进入 `tournament-score`，提交比分。
  - 返回 `my-match`，该场进入“确认中”。
- 管理员登录态：
  - 打开管理入口或录分页，看到待确认比分。
  - 使用 “确认和保存比赛”。
  - 返回排行榜和用户详情，看到积分与 recent 更新。
- 混合角色：
  - admin 同时作为参赛者时，`my-match` 不出现管理操作，管理页出现确认入口。

这层可以先用手工执行；若开发者工具 automator 稳定，再把关键路径脚本化。

### 2.4 Layer D · 手工 E2E 清单

目的：覆盖真实 UI、真实账号切换、视觉状态、操作路径和回归验收。

形式：新增文档 `docs/testing/e2e-regression-checklist.md`，每条用例包含：

- 用例编号
- 目标
- 前置数据
- 账号角色
- 操作步骤
- 页面期望
- 数据库期望
- 失败排查点

---

## 3. Fixture 设计

### 3.1 命名

所有重建数据使用可搜索前缀：

- 赛事名：`E2E_常规赛单打_YYYYMMDD_HHmm`
- 赛事名：`E2E_淘汰赛单打_YYYYMMDD_HHmm`
- 赛事名：`E2E_常规赛双打_YYYYMMDD_HHmm`
- requestId：`e2e_<timestamp>_<caseId>`

虽然执行前会清空业务集合，仍保留前缀，便于开发者工具和云数据库界面识别。

fixture 分两组：

- `confirmed` 子集：用于数据库级 cloud smoke，直接写入 confirmed 行和积分，验证排行榜、用户详情、H2H 聚合。
- `interactive` 子集：用于开发者工具登录态 smoke，保留 pending/submitted 行，让会员提交和管理员确认能真实走权限链路。

### 3.2 常规赛单打

目标：验证会员提交、管理员确认、排行榜和用户详情更新。

数据：

- 4 名会员：A/B/C/D。
- 2 个场地。
- 2 场 regularRound：
  - M1：A vs B，A 胜 4-2。
  - M2：C vs D，D 胜 3-3，抢七 7-5。
- pointsRules：
  - win = 20
  - loss = 10
  - walkover = 0
  - placement 保持默认，但常规赛不发 placement。

断言：

- A、D 胜场 +1，积分 +20。
- B、C 负场 +1，积分 +10。
- `rankList(singles)` 中 A/D 排在 B/C 前。
- A 的 `playerStats.recent[0]` 包含赛事名、比分、对手 B、`pointsAwarded=20`。

### 3.3 淘汰赛单打

目标：验证签表推进、决赛、placement、赛事 completed。

数据：

- 4 名会员：A/B/C/D。
- R1:
  - SF1：A vs B，A 胜 4-0。
  - SF2：C vs D，C 胜 4-1。
- Final：
  - A vs C，A 胜 4-2。
- pointsRules：
  - win = 20
  - loss = 10
  - champion = 100
  - runnerUp = 60
  - semifinal = 30
  - quarterfinal = 10
  - participation = 5

断言：

- R1 确认后 Final 的 `player1/player2/playerIds` 被推进。
- Final 确认后 tournament status = `completed`。
- `tournament_points` 有 champion/runnerUp/semifinal placement 行。
- A 总积分包含 winLoss + champion placement。
- B/D 至少包含 loss + semifinal placement。

### 3.4 常规赛双打

目标：验证 4 人 `playerIds`、双打积分、对手展示和权限边界。

数据：

- 4 名会员：A/B/C/D。
- M1：A+B vs C+D，A+B 胜 4-2。
- `playerIds = [A, B, C, D]`。

断言：

- A/B 各获得 win 分。
- C/D 各获得 loss 分。
- `rankList(doubles)` 出现 A/B/C/D。
- A 的 `playerStats.recent` 对手不是搭档 B，而是对方阵营 C 或 D。
- 非参赛会员 E 提交该场失败。

### 3.5 混合角色

目标：验证 admin 作为参赛者的双视角。

数据：

- adminMember 参与一场 pending 比赛。

断言：

- 登录 admin 的 `my-match` 里该场按会员待录分展示。
- 登录 admin 的管理入口里可见待确认/确认操作。
- admin 录入本人的比赛时，最终结果仍通过管理员保存进入 confirmed 并发积分。

---

## 4. 云端清理与重建策略

### 4.1 清理边界

清空：

- `tournaments`
- `tournament_brackets`
- `tournament_registrations`
- `match_results`
- `tournament_points`
- `free_plays`
- `rank_snapshots`
- `weekly_stars`

保留：

- `members`
- `courts`
- `seasons`
- `_request_log`

`_request_log` 默认保留，避免清理历史诊断记录。若后续确认需要清空，可单独加 `FOPEN_CLEAR_REQUEST_LOG=YES`，不能和普通业务清理混在一起。

### 4.2 安全保护

脚本必须在以下任一条件不满足时拒绝执行：

- `FOPEN_CLOUD_ENV` 非空。
- `FOPEN_CLEANUP_CONFIRM` 与 `FOPEN_CLOUD_ENV` 完全一致。
- `FOPEN_RESET_BUSINESS_DATA=YES`。
- 当前目标环境打印到终端并等待短暂停顿。
- `members` 至少存在 1 个 admin 和 5 个普通会员。
- `courts` 至少存在 2 个可用场地。

### 4.3 成功后是否清理

默认行为：成功后保留 fixture，供开发者工具手工 E2E 继续使用。

额外提供清理命令：手工验收完成后，可再次运行 cleanup-only 模式清空业务集合。

---

## 5. 自动化测试用例矩阵

| 编号 | 层级 | 场景 | 关键断言 |
|---|---|---|---|
| A-01 | Jest cloud | member batchSubmit pending 比赛 | resultStatus=submitted，score 写入，无 pointsAwarded |
| A-02 | Jest cloud | admin batchAdminSave pending 比赛 | resultStatus=confirmed，pointsAwarded.entries 写入 |
| A-03 | Jest cloud | admin batchConfirm submitted 比赛 | 乐观锁匹配后 confirmed，重复 requestId 幂等 |
| A-04 | Jest cloud | 非 admin 调 batchConfirm | FORBIDDEN |
| A-05 | Jest cloud | 非参赛会员 batchSubmit | 单场 failure code=FORBIDDEN |
| A-06 | Jest cloud | 普通会员覆盖 confirmed | CANNOT_OVERWRITE_CONFIRMED 或 UNAUTHORIZED |
| A-07 | Jest cloud | knockout R1 确认推进下一轮 | bracket 和 match_results 下一轮 player slot 同步 |
| A-08 | Jest cloud | knockout 决赛确认 | tournament_points placement 写入，tournament completed |
| A-09 | Jest cloud | reconfirm winner 翻盘 | 下游 match_results 重置，placement 清空，tournament ongoing |
| A-10 | Jest cloud | rankList 聚合 | win/loss/placement 积分合计和排序正确 |
| A-11 | Jest cloud | playerStats recent | score 文本、对手、pointsAwarded、won 正确 |
| A-12 | Jest page | tournament-score member sheet | dirty draft -> submit sheet -> batchSubmit payload 正确 |
| A-13 | Jest page | tournament-score admin sheet | dirty draft -> adminSave sheet -> batchAdminSave payload 正确 |
| A-14 | Jest page | sheet retry | batch-level retry 全量重试，row-level retry 只重试失败行 |
| A-15 | Jest page | my-match row navigation | pending/submitted 行跳 tournament-score 且带 tournamentId/matchId |
| A-16 | Jest page | rank data loading | rankList + weekly-star 加载、切 tab、player tap |
| A-17 | Jest page | player-detail mapping | stats/H2H/recent 映射、H2H tap |
| B-01 | Cloud smoke | 清空并重建 fixture | 8 个业务集合先清零，再写入 E2E 数据 |
| B-02 | Cloud smoke | rankList singles | A/D 等积分与胜负符合 fixture |
| B-03 | Cloud smoke | playerStats A | recent 含常规赛/淘汰赛记录和积分 |
| B-04 | Cloud smoke | playerH2H | A 与 B/C 的交手记录符合 fixture |
| C-01 | DevTools | 会员提交比分 | 页面状态从待录分变确认中 |
| C-02 | DevTools | 管理员确认比分 | 管理入口待确认数归零，排行榜更新 |
| C-03 | DevTools | admin 混合角色 | my-match 会员视图与管理页管理员视图分离 |

---

## 6. 手工 E2E 清单

### E2E-01 管理员创建常规赛单打并生成录分行

- 账号：admin。
- 前置：业务集合已清空或已使用 E2E fixture。
- 步骤：
  1. 进入管理入口。
  2. 新建常规赛单打。
  3. 选择 4 名会员、2 个场地。
  4. 保存排程并完成创建。
  5. 进入赛事详情，再进入录分页。
- 页面期望：
  - 赛事状态为 upcoming 或 ongoing。
  - 录分页按轮次展示至少 2 场比赛。
- 数据期望：
  - `tournaments` 有 1 条 `E2E_常规赛单打`。
  - `tournament_registrations` 有 4 条 confirmed。
  - `match_results` 有对应 pending 行。

### E2E-02 会员提交比分后进入确认中

- 账号：普通会员 A。
- 步骤：
  1. 进入 `my-match`。
  2. 点击第一条待录分。
  3. 在 `tournament-score` 填 4-2。
  4. 提交比分。
  5. 返回 `my-match`。
- 页面期望：
  - 原比赛从“待录分”移动到“确认中”。
  - 录分页该行只读或显示已提交状态。
- 数据期望：
  - 对应 `match_results.resultStatus=submitted`。
  - `score={ sets:[{a:4,b:2}], tiebreak:null }`。
  - `pointsAwarded=null`。

### E2E-03 管理员确认会员提交比分

- 账号：admin。
- 步骤：
  1. 进入管理入口。
  2. 点击待确认比分。
  3. 打开 review sheet。
  4. 确认比分。
  5. 进入排行榜和 A 的用户详情页。
- 页面期望：
  - 待确认数量减少。
  - 排行榜 A 积分增加。
  - A 用户详情 recent 出现该比赛和 +20。
- 数据期望：
  - `match_results.resultStatus=confirmed`。
  - `pointsAwarded.entries` 包含 A winner +20、B loser +10。

### E2E-04 管理员直接保存比分

- 账号：admin。
- 步骤：
  1. 进入一场 pending 比赛的录分页。
  2. 直接填写比分。
  3. 点击“确认和保存比赛”。
- 页面期望：
  - sheet mode 为 admin save。
  - 成功后该场变 confirmed。
- 数据期望：
  - 无 submitted 中间态要求。
  - `pointsAwarded.entries` 已写入。

### E2E-05 淘汰赛完整闭环

- 账号：admin。
- 步骤：
  1. 打开 `E2E_淘汰赛单打`。
  2. 确认两场 R1。
  3. 确认 Final。
  4. 打开排行榜和冠军用户详情。
- 页面期望：
  - Final 选手由 R1 胜者自动推进。
  - 冠军用户详情 recent 有决赛记录。
- 数据期望：
  - `tournaments.status=completed`。
  - `tournament_points` 有 champion/runnerUp/semifinal。
  - 冠军总积分包含 winLoss + placement。

### E2E-06 改分回滚

- 账号：admin。
- 步骤：
  1. 找到已完成淘汰赛的 R1 比赛。
  2. 将比分改为另一方获胜。
  3. 保存。
- 页面期望：
  - 下游 Final 回到待打或待录状态。
  - 排行榜冠军/亚军积分回退。
- 数据期望：
  - 下游 `match_results` 清空 winner/score/pointsAwarded。
  - `tournament_points` placement 被清空或重算。
  - `tournaments.status=ongoing`。

### E2E-07 双打积分

- 账号：admin 或参赛会员。
- 步骤：
  1. 打开 `E2E_常规赛双打`。
  2. 确认 A+B vs C+D 的比分。
  3. 打开双打排行榜和 A 的用户详情。
- 页面期望：
  - 双打排行榜 A/B 积分增加。
  - A recent 对手显示对方阵营，不显示搭档作为对手。
- 数据期望：
  - A/B entries role=winner。
  - C/D entries role=loser。

### E2E-08 非参赛会员禁止提交

- 账号：普通会员 E。
- 步骤：
  1. 尝试进入不属于自己的比赛录分页。
  2. 尝试提交比分。
- 页面期望：
  - 不能编辑，或提交失败提示。
- 数据期望：
  - `match_results` 不变。

### E2E-09 admin 混合角色

- 账号：admin 且 admin 是某场参赛者。
- 步骤：
  1. 打开 `my-match`。
  2. 打开管理入口。
- 页面期望：
  - `my-match` 只显示参赛视图，不出现管理确认入口。
  - 管理入口显示待确认或创建/管理入口。
- 数据期望：
  - 权限不因 admin 身份破坏会员摘要。

### E2E-10 普通会员不能覆盖 confirmed

- 账号：普通会员 A。
- 步骤：
  1. 打开已 confirmed 的比赛。
  2. 尝试修改比分并提交。
- 页面期望：
  - 页面不可编辑或提交失败。
- 数据期望：
  - `match_results.score/resultStatus/pointsAwarded` 不变。

---

## 7. 执行顺序

1. 写本地 Jest 回归用例，先看失败，再补测试辅助或最小修复。
2. 跑本地云函数和小程序测试。
3. 扩展云端 cleanup/seed/smoke 脚本。
4. 在目标环境 `cloud1-0gthnke69a09f52a` 执行受保护清理和 fixture 重建。
5. 跑数据库级 cloud smoke。
6. 用开发者工具登录态执行 C 层 smoke。
7. 按手工 E2E 清单抽查关键路径。
8. 输出测试报告，记录命令、环境、通过/失败、残留 fixture 状态。

---

## 8. 风险与处理

- **真实云端清理风险**：用三重环境变量保护，并明确只清业务集合。执行前打印环境和集合列表。
- **服务端脚本无法模拟 `wxContext.OPENID`**：不在数据库级 smoke 里调用权限接口；权限链路由开发者工具登录态验证。
- **基础数据不足**：若 admin、普通会员、场地不足，脚本中止并输出缺口，不自动创建成员或场地。
- **清理后手工验证找不到数据**：默认保留 fixture；只有 cleanup-only 模式才再次清空。
- **排行榜趋势依赖快照**：本轮主要验证实时积分、胜负、recent；trendDelta 只在 `rank_snapshots` fixture 存在时验证。
- **真实 UI 自动化不稳定**：先把 DevTools smoke 作为手工或半自动步骤，稳定后再纳入强制 CI。
