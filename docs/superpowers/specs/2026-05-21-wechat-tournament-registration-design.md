# 微信报名与赛后排程流程 — 设计文档

- 日期：2026-05-21
- 范围：赛事创建、微信分享报名、赛事详情阶段态、报名退出、管理员排程、赛程/赛果维护、列表与工作台状态入口
- 状态：待用户 review，review 后进入实施计划
- 原型参考：`.superpowers/brainstorm/manual-1779329455/content/prototypes-existing-aligned-v1.html`

## 1. 背景与目标

当前赛事创建流程默认在创建时选好人员、场地并安排对局。新需求是让管理员创建赛事后可先发布到微信，成员从微信打开赛事详情并报名；报名期结束后，管理员再基于最终名单安排对局。

目标：

- 管理员在现有 `tournament-edit` 第 2 步即可设置报名截止、选择预置球员、选择场地时间，并发布/分享到微信。
- 成员从微信打开现有 `tournament-detail`，查看赛事基础信息并报名。
- 报名截止后，成员等待赛程；管理员从详情页进入排程页安排对局。
- 成员报名后在退赛截止前可自行退出报名。退赛截止为比赛日前一天 24:00，例如 5 月 24 日比赛，则 5 月 23 日 24:00 前可退出。
- 赛程发布后进入比赛内容；录入成绩后仍支持管理员调整成绩。
- 保持现有页面结构和视觉风格，不做大改版。

## 2. 硬性 UI 约束

本需求的实施必须是增量改造，不允许把原型样式直接照搬成新的视觉系统。

必须遵守：

- `tournament-edit` 沿用现有 3 步 wizard、`step-bar`、`card`、`field`、`footer`、`court-grid`、`schedule-board` 等结构。
- `tournament-detail` 沿用现有 hero、`td-section`、结果区、赛程区、参赛人员区、积分规则区、`td-footer` 等结构。
- `match`、`tournament-manage`、`my-match` 沿用现有卡片和 block，不重做页面布局。
- 原型中的阶段条、标签、按钮布局只表达信息架构；实现时应优先复用现有 class、组件和页面块。
- 不引入新的大面积背景、卡片嵌套、全新配色、全新按钮体系或大幅间距变化。
- 不为了报名功能重建独立报名页；使用现有 `tournament-detail` 做阶段化详情。
- 所有新增样式必须局部、最小，且不能影响现有赛事详情、创建、列表、工作台的旧状态展示。

验收时需要人工对照现有页面，确认未出现明显风格漂移。

## 3. 范围

### 范围内

- `miniprogram/pages/tournament-edit/index.{js,wxml,wxss}`：
  - 第 2 步增加报名设置、发布/分享入口。
  - 第 3 步支持保存排程草稿、发布赛程。
  - 编辑入口可回到第 1 步，安排对局入口可直接进入第 3 步。
- `miniprogram/pages/tournament-detail/index.{js,wxml,wxss}`：
  - 根据阶段展示报名期、待排程、赛程模式、赛果模式。
  - 成员报名、退出报名、管理员分享/编辑/安排对局、编辑赛程、录入/调整成绩入口。
- `miniprogram/pages/match/index.{js,wxml,wxss}`：
  - 列表状态标签补充报名中、可报名、已报名、待排程、赛程待发布等状态。
- `miniprogram/pages/tournament-manage/index.{js,wxml,wxss}`：
  - 工作台补充报名中赛事、待排程赛事、赛程草稿待发布等任务块。
- `miniprogram/pages/my-match/index.{js,wxml,wxss}`：
  - 我的报名块展示已报名、可退出、等待赛程、待录分等状态。
- `miniprogram/pages/tournament-brackets`、`miniprogram/pages/tournament-score`：
  - 赛程未发布时门禁。
  - 成绩录入后支持调整入口与权限提示。
- 云函数和数据层：
  - 发布报名、成员报名、退出报名、发布赛程、编辑赛程、调整成绩所需字段与校验。
- 对应单元测试与关键页面测试。

### 范围外

- 不新增独立 `tournament-register` 页面。
- 不重写 `schedule-board` 交互模型，只扩展状态和入口。
- 不重写 `score-row` 的比分录入体验。
- 不做 fixed-partner doubles 的微信自助报名。固定搭档双打仍由管理员维护或后续单独设计。
- 不支持淘汰赛混合类别。淘汰赛 mixed 仍不可选。
- 不新增 mixed 独立排行榜。
- 不做支付、审核、费用、备注、报名表扩展字段。

## 4. 关键决策

| 决策 | 取值 |
| --- | --- |
| 微信报名入口 | 复用 `/pages/tournament-detail/index?id=<id>&entry=register` |
| 是否新增报名页 | 不新增 |
| 创建流程 | 保留 3 步：基本信息、球员/球场、排程 |
| 第 2 步能力 | 可继续下一步排程，也可发布并分享到微信 |
| 第 2 步发布含义 | 发布报名入口和基础赛事信息，不生成对局、不生成录分行 |
| 常规赛报名名额 | 不限制名额 |
| 淘汰赛单打名额 | 沿用 `maxPlayers`，满员后不能报名 |
| 微信报名 v1 | 个人报名 |
| regular doubles/mixed | 可个人报名，排程时再组合 |
| knockout doubles 微信自助报名 | v1 不做 |
| 场地时间 | 创建时可先选，但报名期不排程 |
| 报名退出 | 退赛截止前可退出；退赛截止默认比赛日前一天 24:00 |
| 赛程发布 | 发布后成员详情切换为赛程模式，录分入口开放 |
| 成绩调整 | 录分后不是只读终态，管理员可调整成绩并重算排名 |

## 5. 阶段模型

赛事详情使用同一个页面入口，但按阶段切换主内容。

| 阶段 | 进入条件 | 成员看到 | 管理员看到 |
| --- | --- | --- | --- |
| `draft` | 未发布报名且未发布赛程 | 不可分享 | 继续创建 |
| `registration_open` | 已发布报名且未到报名截止 | 基础信息、参赛人员；未报名显示我要报名，已报名显示退出报名 | 分享、管理报名、编辑、安排对局 |
| `pending_schedule` | 报名截止后且赛程未发布 | 参赛人员、下一阶段提示、退赛截止前可退出 | 分享、编辑、安排对局 |
| `schedule_draft` | 管理员已排程但未发布 | 成员仍看待排程 | 管理员看排程草稿、保存草稿、发布赛程 |
| `schedule_published` | 赛程已发布 | 赛程、参赛人员、录入成绩入口 | 编辑赛程、录入成绩、分享 |
| `results` | 有成绩或已完成 | 赛果摘要、已完成赛程、查看成绩 | 调整成绩、查看成绩、分享 |

`tournament.status` 继续服务现有粗粒度生命周期，但页面展示通过派生 phase 判断，避免把报名期错误显示成已有赛程的 `upcoming`。

派生 phase 由 `tournament.status` 与新增字段联合决定，按以下优先级匹配（自上而下，命中即停）：

| 优先级 | 条件 | 派生 phase |
| --- | --- | --- |
| 1 | `status === 'draft'` | `draft` |
| 2 | `scheduleStatus === 'published'` 且存在已结算成绩或 `status === 'completed'` | `results` |
| 3 | `scheduleStatus === 'published'` | `schedule_published` |
| 4 | `scheduleStatus === 'draft'` | `schedule_draft` |
| 5 | `registrationPublishedAt` 存在 且 `now < registrationDeadlineAt` | `registration_open` |
| 6 | `registrationPublishedAt` 存在 且 `now >= registrationDeadlineAt` | `pending_schedule` |
| 7 | 兜底（遗留赛事：无 `registrationPublishedAt`、无 `scheduleStatus`） | 沿用旧路径，按 `status` 直接展示 `upcoming / ongoing / completed`，不进入新阶段视图 |

规则要点：

- schedule 状态优先于 registration 状态：一旦有排程草稿/已发布，即使 `registrationDeadlineAt` 改回未来也保持 schedule 视图。详见 8.1。
- 遗留赛事（仅有 `status` 字段、缺新字段）走旧展示路径，确保 backward compat。

建议新增或派生字段：

- `registrationDeadlineAt`：报名截止时间。
- `registrationPublishedAt`：报名发布/分享时间。
- `scheduleStatus`：`none | draft | published`。
- `schedulePublishedAt`：赛程发布时间。
- `scheduleNeedsRevision`：成员退赛或管理员改动导致赛程需要重新调整的标记，详见 7.3 / 8.2。
- `withdrawDeadlineAt`：退赛截止时间；默认由比赛日期派生，除非后续支持自定义退赛截止，否则不落库。

退赛截止派生规则：

```text
withdrawDeadlineAt = 比赛开始日期当天 00:00
展示文案 = 比赛日前一天 24:00
例：比赛日 5月24日，展示 5月23日 24:00 前可退出
```

## 6. 赛事创建与发布

### 6.1 第 1 步：基本信息

保持现状，重点约束：

- 常规赛不展示人数上限。
- 淘汰赛单打继续展示 `maxPlayers`。
- 淘汰赛 mixed 仍不可选。
- 不调整已有字段样式、chip 样式、积分规则输入结构。

### 6.2 第 2 步：球员、球场、报名设置

新增报名设置：

- `报名截止` 必填，用于控制新增报名入口。
- 管理员可预选球员。
- 管理员可先选择场地和时间，例如 `2号场：18:00-20:00`。
- 这里保存名单和场地时间，不生成对局，不生成录分行。

底部动作：

- `上一步`
- `下一步排程`
- `发布并分享到微信`

这三条路径不互斥：

- 点 `下一步排程`：直接进入第 3 步排程，可跳过微信报名。
- 点 `发布并分享到微信`：发布报名入口，成员从微信详情页报名，仍可后续进入排程。

`发布并分享到微信` 的语义拆解为两个独立动作的组合，不要混用为单一原子操作：

1. **发布报名**（数据动作）：云函数写 `registrationPublishedAt = now`、`scheduleStatus = 'none'`，校验 `registrationDeadlineAt` 必填且在未来。失败时返回错误，不弹起分享面板。
2. **唤起分享**（前端动作）：发布成功后调用 `wx.showShareMenu` 并配置 `onShareAppMessage`：
   - `path` 固定为 `/pages/tournament-detail/index?id=<id>&entry=register`
   - `title` 取赛事名称
   - `imageUrl` 复用现有 hero 视觉，无需新增物料

`entry=register` 参数语义：成员从分享链路打开详情时，详情页应自动滚动到报名区并高亮 `我要报名` 按钮；不自动触发报名 RPC，需用户主动点击，避免误报名。

### 6.3 第 2 步已发布态

发布后仍停留在现有创建页形态，不跳到新页面。显示：

- 发布状态：报名中。
- 微信入口：可分享。
- 报名名单：预选人数 + 微信报名人数。
- 球场与时间：可编辑。

底部保留：

- `管理报名`
- `分享到微信`

### 6.4 第 3 步：排程

第 3 步仍使用现有 `schedule-board`。

- 草稿仅管理员可见。
- 保存草稿不进入成员赛程。
- 发布前不开放录分。
- 发布赛程时才生成成员可见的对局和录分行。

底部动作：

- `保存草稿`
- `发布赛程`

## 7. 成员详情页

### 7.1 报名期，未报名成员

页面结构：

- 顶部阶段提示：成员视角，阶段高亮 `报名`。
- hero 基础信息：
  - 日期
  - 赛制/类别
  - 场地时间
  - 报名截止
- 参赛人员。
- 下一阶段说明。
- 底部：`分享`、`我要报名`。

不展示：

- 完整赛程表。
- 赛果。
- 重复的报名状态信息卡。

报名按钮规则：

- 未登录/未认领会员：进入 `edit-profile` 认领或注册，完成后返回详情继续报名。
- 已报名：按钮变为退出报名或根据阶段隐藏。
- 常规赛：不做名额限制。
- 淘汰赛单打：超过 `maxPlayers` 后禁用报名，提示名额已满。

### 7.2 已报名，待排程成员

页面结构：

- 顶部阶段提示：成员视角，阶段高亮 `排程`。
- hero 基础信息：
  - 日期
  - 场地时间
  - 退赛截止 `WITHDRAW BY`
- 参赛人员。
- 下一阶段说明：不展示管理员排程草稿，发布后切换为赛程模式。
- 底部：`分享`、`退出报名`（仅退赛截止前）。

不展示：

- `报名状态 / 已锁定` 这类重复卡。
- 无效的 `等待赛程` 按钮。

超过退赛截止后：

- 隐藏 `退出报名`。
- 底部只保留可操作项，例如 `分享`。
- 等待赛程只作为状态说明，不作为按钮。

### 7.3 退出报名

成员可退出条件：

- 当前会员存在有效报名记录。
- 当前时间早于 `withdrawDeadlineAt`。
- 赛事未开始。
- 若已有成绩记录，不能自助退出。

退出后的处理：

- `tournament_registrations.status` 置为 `cancelled`。
- 记录 `cancelledAt`、`cancelledBy`、`cancelReason`（可为空）。
- 参赛人员数量更新。
- `my-match` 不再把该赛事显示为有效报名。

如果赛程已经发布但还未到退赛截止：

- 允许退出，但不能静默忽略影响。
- 退赛云函数在事务中：
  1. 写 `tournament_registrations.registrationStatus = 'withdrew'` 并记录 `cancelledAt / cancelledBy`。
  2. 扫描 `tournament_brackets`，找出包含该 `playerId` 且 `match_results` 仍为待录入或无比分的对局，写 `match.needsRevision = true`。
  3. 在 `tournaments` 上置 `scheduleNeedsRevision = true`，触发管理员工作台"赛程需调整"任务块（详见 9.2）。
- 已有比分的场次不允许成员自助退出，前端弹 Toast：`该场次已有成绩，请联系管理员处理` 并阻止本次退赛；不修改 `tournament_registrations`。
- 管理员在工作台/详情页处理完调整后，手动点击 `已确认赛程` 把 `scheduleNeedsRevision` 清零；无自动清除路径，避免遗漏影响范围。

## 8. 管理员详情页

### 8.1 待排程

页面结构：

- 顶部阶段提示：管理员视角，阶段高亮 `排程`。
- hero 基础信息：
  - 参赛人数。
  - 场地时间。
- 报名管理：
  - 名单可调整。
  - 场地时间可改。
- 赛程区：尚未排程。
- 底部：`分享`、`编辑`、`安排对局`。

按钮含义：

- `分享`：分享当前详情，不改变状态。
- `编辑`：进入 `tournament-edit` 第 1 步，可改基本信息、报名截止、人员、场地时间。
- `安排对局`：直接进入第 3 步排程页。

流程约束：

- phase 优先级：**schedule 状态严格高于 registration 状态**。即一旦 `scheduleStatus` 进入 `draft / published`，无论 `registrationDeadlineAt` 是否被改回未来，都保持在 schedule 阶段（详见 Section 5 派生表）。
- 如果还没有排程草稿（`scheduleStatus === 'none'`）且管理员把报名截止改到未来，展示 phase 才回到 `registration_open`。
- 如果已有排程草稿，编辑页应隐藏"改报名截止"输入并提示 `已开始排程，如需重新开放报名请先清空草稿`，避免出现 phase 矛盾。
- 如果赛程已发布，不再使用待排程页的编辑路径修改核心报名数据；改为进入赛程编辑（8.2）或成绩调整（8.3）逻辑。

### 8.2 赛程模式

赛程发布后：

- 详情页主内容变为赛程。
- 报名模块退场。
- 参赛人员保留在赛程下方。
- 管理员有 `编辑赛程`。
- 管理员或参赛成员可进入 `录入成绩`。

编辑赛程规则：

- 未有比分：可调整场地、时间、对局，无确认弹窗。
- 已有比分：进入下述确认流程。
- 不允许无提示地删除已有成绩。

带比分场次编辑的标准流程：

1. 管理员在赛程编辑页提交改动，前端做"影响范围预检"：本地遍历当前 `schedulePlan` diff，找出被改动或被删除的场次，匹配 `match_results.status` 是否已有 `submitted / confirmed / settled` 比分。
2. 如果存在受影响的已录分场次，弹出确认 modal，列出每场比分概要（`球员A vs 球员B  21:18 / 21:12`）和处置选项：
   - `保留比分，仅改场地/时间`：仅允许场地、时间字段变更，不允许换人；后端二次校验仍是同一对球员。
   - `清空比分并重新录入`：在事务中把对应 `match_results` 软删除（写 `status = 'invalidated'`、`invalidatedAt`、`invalidatedBy`），并触发 `points-engine.recompute`。
   - `取消编辑`：放弃改动。
3. 后端接收提交后，必须重新做服务端校验，前端选择不可信。
4. 已结算 (`tournament.status === 'completed'`) 的赛程：本期不开放 `编辑赛程`，按钮禁用并提示 `赛事已结算，如需修改请联系超级管理员`；走单独的"调整成绩"路径（8.3）。
5. 任何成功的编辑都同时清零 `tournament.scheduleNeedsRevision`，因为这一编辑已经覆盖了之前积压的"需调整"信号。

### 8.3 赛果模式

有成绩后：

- 详情页主内容切到赛果摘要和已完成赛程。
- 报名入口和报名说明不再出现。
- 管理员可 `调整成绩`。
- 参赛成员只可处理自己提交或待确认的场次。

成绩调整规则：

- 管理员可调整任意场次比分。
- 调整后重新计算排名、积分和结果摘要。
- 成员只能修改自己提交或待确认的场次。
- 已结算状态下如仍允许调整，需要管理员确认并重新结算；如本期不支持已结算调整，则按钮应禁用并提示。

## 9. 列表、工作台和我的比赛

### 9.1 赛事列表 `match`

沿用现有 `match-card`，只增加标签和状态文案：

- `可报名`
- `已报名`
- `待排程`
- `赛程待发布`
- `可录分`
- `已完赛`

点击仍进入 `tournament-detail`。

### 9.2 管理员工作台 `tournament-manage`

沿用现有 hero 与 block，新增任务块：

- 报名中赛事：显示报名人数和截止时间，入口为分享或管理。
  - 软警告规则：常规赛报名人数 > `场地数 × 时段数 × 2`（粗略 1 小时 1 局 / 场地的容量估算）时，在该卡片右上角加一个低强度提示徽标 `人数偏多`，并在管理报名时展示一行说明 `当前报名人数已超出可排场次的建议容量，建议在排程前与组织者确认`，但不阻断报名。淘汰赛单打已有 `maxPlayers` 硬限，不再叠加软警告。
- 待排程赛事：显示参赛人数和场地时间，入口为安排对局。
- 赛程草稿待发布：显示已排场次数，入口为继续排程或发布。
- 赛程需调整：仅在 `tournaments.scheduleNeedsRevision === true` 时出现；卡片展示触发原因（退赛 / 赛程编辑）、影响场次数和 `处理` 入口；处理完毕后管理员手动 `已确认赛程`，置 false。

### 9.3 我的比赛 `my-match`

新增或扩展 `我的报名` 块：

- 已报名且退赛截止前：显示 `可退出`，文案 `可退至 <日期> 24:00`。
- 已报名且退赛截止后：显示等待赛程或赛程已发布，不显示退出入口。
- 待录分：沿用现有待录分块。

## 10. 二级页面门禁

### 10.1 `edit-profile`

微信报名进入时，未注册或未认领会员不能直接报名。会员身份通过 `openid → members` 查找派生（沿用 `cloudfunctions/members.add` 现有认领逻辑）。

完整流程：

1. 成员从微信分享打开 `tournament-detail?id=<id>&entry=register`。
2. 详情页 `onLoad` 调用 `members.getByOpenid`（或现有等价接口），按当前 `openid` 查会员：
   - **A. 命中且 `claimStatus === 'claimed'`**：直接展示报名按钮；走 10.1 步骤 6 之后的报名路径。
   - **B. 未命中**：判定为新用户，按下文步骤 3 进入 `edit-profile`，传 `from=tournament-register` 和 `tournamentId`。
   - **C. 命中但 `claimStatus === 'unclaimed'`** 或返回 `CLAIM_CONFLICT`：仍进入 `edit-profile`，由用户在资料页完成认领（手动选择待认领名单或填写新会员资料）；冲突解决遵循 `members.add` 既有规则，不在本期变更。
3. `edit-profile` 完成保存后，若 query 中含 `from=tournament-register`，使用 `wx.redirectTo` 回到 `tournament-detail?id=<id>&entry=register`，避免在导航栈中留下资料页。
4. 详情页 `onShow` 重新执行步骤 2 的 openid 查询；如果此时为 `claimed`，自动滚动到报名区并**高亮但不自动点击** `我要报名`（避免误报名风险）。
5. 用户主动点击 `我要报名` 时再发起报名 RPC（`tournament-registrations` add）。
6. 报名云函数侧需校验：`openid` 与 `playerId` 对应的 `members.openid` 一致，防止前端注入 `playerId` 替他人报名。
7. 报名成功后，详情页 phase 内容不变（仍是 `registration_open`），但底部 CTA 从 `我要报名` 切换为 `退出报名`（受退赛截止判断）。

### 10.2 `tournament-brackets`

赛程未发布时不展示草稿排程。

- 成员看到：管理员正在排程，发布后显示完整对局。
- 管理员如需看草稿，应从排程页进入，不从成员签表页查看。

### 10.3 `tournament-score`

只在赛程发布并生成可录分行后开放。

- 非参赛成员不可录分。
- 管理员可录入和调整。
- 已有成绩时进入调整或查看模式。

## 11. 数据模型建议

### 11.1 `tournaments`

新增或规范字段：

```js
{
  registrationDeadlineAt: Date | string,
  registrationPublishedAt: Date | string,
  scheduleStatus: 'none' | 'draft' | 'published',
  schedulePublishedAt: Date | string | null,
  scheduleNeedsRevision: boolean,
  schedulePlan: { courts: [...] } // 沿用现有 Phase 7 结构，draft / published 共用
}
```

说明：

- `registrationDeadlineAt` 控制新增报名。
- `withdrawDeadlineAt` 默认从比赛日期派生，不存入 `tournaments`；只有未来支持自定义退赛截止时再落库。
- `scheduleStatus: 'none'` 表示只有报名和场地时间，没有排程。
- `scheduleStatus: 'draft'` 表示管理员有草稿，成员不可见。
- `scheduleStatus: 'published'` 表示成员可见，录分行可用。
- `scheduleNeedsRevision` 由 7.3（成员退赛影响已排对局）触发置 `true`，由 8.2（管理员完成赛程编辑）或工作台 `已确认赛程` 操作置 `false`；遗留赛事缺省视为 `false`。
- 旧 `courtTimeGrid` 字段不再被新流程写入，仅保留历史只读兼容；新代码读写一律走 `schedulePlan`。

遗留赛事迁移策略：

- 不做强制 backfill。已有 `status: 'upcoming' / 'ongoing' / 'completed'` 的赛事，缺 `registrationPublishedAt` 与 `scheduleStatus` 时，按 Section 5 派生表第 7 行走旧展示路径（沿用现有 `match-card`、`tournament-detail` 旧 layout）。
- 新代码不允许只写部分新字段（如只写 `registrationPublishedAt` 不写 `scheduleStatus`），创建/编辑流程必须保证字段成对。
- 若后续需要把历史赛事并入新阶段视图，使用一次性脚本统一回填 `scheduleStatus = 'published'`、`schedulePublishedAt = createTime`，本期不做。

### 11.2 `tournament_registrations`

沿用现有集合，不重命名状态字段。完整字段表（✓ 已存在 / ✦ 本期新增 / ◐ 沿用 + 扩展枚举）：

| 字段 | 类型 | 状态 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | ✓ | 格式 `reg_<tournamentId>_<index>`，沿用现有生成规则 |
| `tournamentId` | string | ✓ | 所属赛事 |
| `seasonId` | string | ✓ | 由赛事派生 |
| `type` | `'singles' \| 'doubles' \| 'mixed'` | ✓ | 由赛事派生 |
| `playerId` | string | ✓ | `members._id` |
| `playerName` | string | ✓ | 报名时快照，避免会员改名导致名单错乱 |
| `partnerId` | string \| null | ✓ | 仅 `knockout doubles` 必填；regular doubles 报名按个人，组队在第 3 步排程随机配对（沿用 Phase 7 现状） |
| `partnerName` | string \| null | ✓ | 同上 |
| `teamName` | string \| null | ✓ | 仅 knockout doubles 使用 |
| `seed` | number | ✓ | 1-64，淘汰赛用 |
| `registrationStatus` | `'confirmed' \| 'withdrew'` | ✓ | **本期统一使用此字段**，不再引入 `active / cancelled` 新词，避免破坏现有 `bulkSet`、`points-engine`、`tournament-brackets` 的过滤逻辑 |
| `status` | string | ✓ | 旧字段保持兼容只读；新代码不写 |
| `source` | `'admin' \| 'wechat'` | ✦ | `admin` 表示来自管理员 `bulkSet` 或后台手动添加；`wechat` 表示微信自助报名 |
| `registerTime` | string | ✓ | 已存在 |
| `cancelledAt` | Date \| null | ✦ | 退赛时间戳；`registrationStatus === 'withdrew'` 时必填 |
| `cancelledBy` | string \| null | ✦ | 退赛操作者 `members._id`，区分自助退赛 vs 管理员代退 |
| `cancelReason` | string \| null | ✦ | 可空；本期不强制收集 |
| `reregisteredAt` | Date \| null | ✦ | 退赛后再次报名的时间戳，用于审计 |
| `createTime` | Date | ✓ | 已存在 |
| `updateTime` | Date | ✓ | 已存在 |

行为规则：

- 微信报名 v1 只创建个人报名记录。
- regular doubles / mixed 也按个人报名。
- knockout doubles 自助报名不做：v1 由管理员通过 `bulkSet` 维护，前端 `我要报名` 按钮在 `type === 'doubles' && format === 'knockout'` 时不展示。
- "取消报名"语义 = 更新现有记录 `registrationStatus = 'withdrew'` + 写 `cancelledAt / cancelledBy`；**不物理删除**，便于审计。
- 退赛后再次报名：直接复用同行，更新为 `registrationStatus = 'confirmed'`、清空 `cancelledAt / cancelledBy / cancelReason`、写 `reregisteredAt = now`；不新增重复行。
- 重复报名检测：唯一性约束 `(tournamentId, playerId, registrationStatus = 'confirmed')`，前端 Toast `你已报名` 由后端读现状返回，不重复写记录。
- 并发保护：见 Section 12。

### 11.3 `tournament_brackets` / `match_results`

- 报名发布时不生成。
- 排程草稿保存时只给管理员可见，不生成成员录分入口。
- 发布赛程时生成或标记成员可见的对局。
- 发布赛程时才生成可录分的 `match_results` 行。
- 编辑赛程时需要处理已有关联成绩的场次：提示、标记、重算或阻止。

## 12. 权限与错误处理

| 场景 | 处理 |
| --- | --- |
| 非会员点击报名 | 跳转资料认领/注册，完成后回详情，详见 10.1 |
| 重复报名 | Toast：`你已报名`，不重复写记录 |
| 常规赛报名人数很多 | 允许报名，不做名额限制；超出建议容量时工作台展示软警告（9.2） |
| 淘汰赛单打满员 | 禁止报名，Toast：`名额已满` |
| 报名截止后点击报名 | Toast：`报名已截止` |
| 退赛截止后点击退出 | Toast：`已过退赛截止时间` |
| 赛程已发布后退出且影响对局 | 允许前需确认，并标记赛程需调整；已有比分则阻止自助退出 |
| 成员查看待排程 | 不展示排程草稿 |
| 非参赛成员录分 | Toast：`仅参赛者可录入` |
| 成绩调整后 | 重新计算结果摘要、排名和积分 |
| 前端注入伪造 `playerId` | 报名/退赛云函数比对 `wxContext.OPENID` 与 `members.openid`，不一致返回 `PERMISSION_DENIED` |

并发保护（淘汰赛单打满员场景）：

`tournament-registrations.add` 在写入前必须按以下顺序确保原子：

1. 在 `tournaments` 上维护 `confirmedCount` 字段（`registrationStatus === 'confirmed'` 的报名数），每次报名/退赛/重新报名时通过 `db.runTransaction` 同步更新。
2. 报名事务伪代码：

   ```
   runTransaction:
     t = read tournaments(tournamentId)
     if t.format === 'knockout' && t.type === 'singles' && t.confirmedCount >= t.maxPlayers:
       abort with CAPACITY_FULL
     write tournament_registrations(new doc, registrationStatus='confirmed')
     update tournaments.confirmedCount = confirmedCount + 1
   ```

3. 退赛事务同样在内部把 `confirmedCount` 减 1；重新报名（withdrew → confirmed）走原子 `+1`。
4. 客户端收到 `CAPACITY_FULL` 时统一展示 `名额已满`。
5. 常规赛不做容量检查，但 `confirmedCount` 仍维护以供 9.2 软警告判定使用。

## 13. 测试策略

### 13.1 工具和状态 helper

集中实现，前后端共用，避免逻辑双份漂移：

- 前端：`miniprogram/utils/tournament-phase.js`（新增），导出 `derivePhase(tournament)`、`getWithdrawDeadline(tournament)`、`canWithdraw(tournament, now)`、`canRegister(tournament, now)`。
- 后端：`cloudfunctions/_shared/tournament-phase.js`（新增），与前端 helper 同源，由 `tournaments` / `tournament-registrations` / `tournament-brackets` 云函数共用。
- 同一份 spec 测试集放在 `cloudfunctions/_shared/__tests__/tournament-phase.test.js`，前后端各自再补一份薄壳测试覆盖各自调用点。

helper 行为约束：

- 派生 phase：
  - 报名中。
  - 报名截止后待排程。
  - 赛程草稿管理员可见。
  - 赛程发布后。
  - 赛果已出。
  - 遗留赛事：返回 `legacy`，调用方走旧展示路径。
- 退赛截止：
  - 5 月 24 日比赛，截止展示为 5 月 23 日 24:00。
  - 截止前 `canWithdraw === true`。
  - 截止后 `canWithdraw === false`。

### 13.2 赛事创建

- 常规赛不展示 `maxPlayers`。
- 淘汰赛单打展示 `maxPlayers`。
- 第 2 步可发布报名并分享。
- 第 2 步可直接进入第 3 步排程。
- 发布报名不会生成 `tournament_brackets` 或 `match_results`。
- 第 3 步保存草稿后成员不可见。
- 发布赛程后成员可见，录分入口开放。

### 13.3 成员详情

- 未报名成员在报名期可报名。
- 已报名成员在退赛截止前可退出。
- 退赛截止后不展示退出入口。
- 待排程成员不展示报名状态重复卡，不展示无效等待按钮。
- 成员看不到管理员排程草稿。

### 13.4 管理员详情

- 待排程管理员底部显示 `分享 / 编辑 / 安排对局`。
- `编辑` 跳转创建流程第 1 步。
- `安排对局` 跳转第 3 步。
- 有草稿时入口文案变为继续排程或发布赛程。
- 赛程发布后可编辑赛程。

### 13.5 列表与工作台

- `match` 列表显示可报名、已报名、待排程等标签。
- `my-match` 显示可退赛截止时间。
- `tournament-manage` 显示报名中、待排程、草稿待发布、赛程需调整任务。

### 13.6 录分与赛果

- 赛程未发布不能进入录分。
- 赛程发布后管理员和参赛成员可录分。
- 非参赛成员不可录分。
- 成绩录入后详情进入赛果模式。
- 管理员调整成绩后排名和积分重新计算。

建议验证命令：

```bash
cd miniprogram
npm test -- --runInBand
```

并补充相关云函数测试。

## 14. 实施顺序建议

0. **字段对齐与迁移评估**：基于 11.1 / 11.2 写一份 `tournament` 与 `tournament_registrations` 的字段对齐表，对比 `cloudfunctions/DATABASE_SCHEMA.md` 现状，更新该文档；不做强制 backfill 但落地一段说明（遗留赛事走旧路径）。本步不写代码，仅文档与 schema doc 更新，作为后续步骤的基线。
1. 新增 phase/registration/withdraw helper（13.1 指定的两份文件 + 共享测试）。
2. 扩展数据模型与云函数：发布报名、报名、退出报名、`confirmedCount` 事务维护（Section 12）、`scheduleNeedsRevision` 置位/清零。
3. 改 `tournament-edit` 第 2 步发布报名和第 3 步发布赛程。
4. 改 `tournament-detail` 阶段化展示与底部 CTA，包含 10.1 微信报名链路。
5. 改 `match`、`my-match`、`tournament-manage` 的状态标签和任务块（含 9.2 软警告与赛程需调整）。
6. 加赛程未发布门禁。
7. 加编辑赛程、调整成绩入口和权限保护（8.2 带比分场次编辑流程）。
8. 跑目标测试、全量测试，并人工检查现有页面视觉未大改。

## 15. 验收清单

- [ ] 第 2 步可选择报名截止、球员、场地时间。
- [ ] 第 2 步可发布并分享到微信，也可进入下一步排程。
- [ ] 成员从微信详情页可报名。
- [ ] 常规赛不限制报名名额。
- [ ] 淘汰赛单打满员后不能报名。
- [ ] 报名发布不生成对局和录分行。
- [ ] 成员报名后，退赛截止前可退出报名。
- [ ] 退赛截止按比赛日前一天 24:00 展示。
- [ ] 报名截止后，成员看不到排程草稿。
- [ ] 管理员待排程详情有分享、编辑、安排对局。
- [ ] 编辑进入创建流程第 1 步。
- [ ] 安排对局进入第 3 步排程。
- [ ] 赛程发布后成员看到赛程，报名模块退场。
- [ ] 赛程发布后管理员可编辑赛程。
- [ ] 录入成绩后可调整成绩。
- [ ] 列表、工作台、我的比赛状态一致。
- [ ] 实现后现有页面样式没有明显漂移。
- [ ] 遗留赛事（无 `registrationPublishedAt` / `scheduleStatus`）在 `match` 列表、`tournament-detail`、`my-match`、`tournament-manage` 上展示与改造前一致（提供改造前后截图对比，按 Section 5 派生表第 7 行兜底走旧路径）。
- [ ] `step-bar`、`schedule-board`、`court-grid`、`td-section`、`match-card` 等现有组件无新增的大面积样式 override；新增样式仅作用于本期阶段化新区块，使用局部 class 或 BEM 修饰符隔离。
- [ ] 与原型 `prototypes-existing-aligned-v1.html` 对照仅作为信息架构参考；实际产物不出现原型独有的全新配色、阴影或卡片嵌套（人工对照确认）。
