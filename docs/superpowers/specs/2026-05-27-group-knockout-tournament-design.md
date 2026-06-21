# 小组赛 + 淘汰赛赛制设计

日期：2026-05-27

## 背景

FOPEN 需要新增一个独立赛制：小组赛 + 淘汰赛。赛事规模支持 12 签和 16 签，统一分为 A/B/C/D 四组。小组赛结束后每组前 2 名晋级 8 强，再按固定对位进入单败淘汰赛。

分组签表有两种实际组织方式：

- 赛前提前设计好分组。
- 比赛当天现场抽签，抽签后管理员再录入系统。

这两种方式在系统内应汇入同一套分组、对阵、排名、晋级、签表展示和积分结算逻辑。

## 用户确认

- 新赛制采用独立 `format: 'group_knockout'`，不拆成两个赛事，也不复用现有 `regular` 或 `knockout` 语义。
- 12 签和 16 签都分 4 组，每组前 2 晋级。
- 12 签：每组 3 人，组内单循环，每组 3 场。
- 16 签：每组 4 人，组内单循环，每组 6 场。
- 16 签暂不做 GSL 或简化瑞士赛，先使用组内单循环。
- 小组排名规则：胜场数；两人同胜场看相互胜负；多人同胜场看净胜局；再看总胜局；仍相同由管理员手动排序。
- 淘汰赛 8 强固定对位：A1 vs B2、B1 vs A2、C1 vs D2、D1 vs C2。
- 8 强来源标签只在 8 强首轮位置展示，半决赛和决赛不重复显示来源标签。
- 需要能查看比赛签表，签表分小组赛和淘汰赛，录入比分后更新，最终能看到完整晋级链路。
- 签表页只需要“小组赛”和“淘汰赛”两个 Tab，不需要单独的“晋级链路” Tab。
- 赛事详情页顶部沿用现有流程状态，不新增重复流程条。
- “录入比分”等赛事操作继续放在现有底部固定操作栏。
- 需要有“安排签表”按钮，用于现场抽签后手动录入小组赛分组。

## 推荐方案

新增独立赛制 `group_knockout`。

理由：

- 小组赛不是普通常规赛，淘汰赛也不是独立赛事；独立格式能表达完整生命周期。
- 小组排名、晋级快照、8 强对位、淘汰赛推进、积分结算都有独立规则，放在一个赛事内更符合用户理解。
- 现有 `tournament_brackets`、`match_results`、底部操作栏、录分页和详情页都能复用，但需要增加 `stage` 和 `matchKind` 区分小组赛与淘汰赛。

备选方案一：拆成两个赛事。改动较少，但详情、冠军、积分、历史记录和签表链路会割裂。

备选方案二：把小组赛塞进现有淘汰赛 round。能复用部分 bracket 逻辑，但 round 语义混乱，小组排名和晋级规则难以维护。

## 赛制规则

### 12 签

- 4 组：A、B、C、D。
- 每组 3 人。
- 组内单循环：1 vs 2、1 vs 3、2 vs 3。
- 小组赛共 12 场。
- 每组前 2 晋级，合计 8 人进入淘汰赛。
- 淘汰赛 7 场。
- 全赛事共 19 场。

### 16 签

- 4 组：A、B、C、D。
- 每组 4 人。
- 组内单循环建议生成顺序：
  - 1 vs 4
  - 2 vs 3
  - 1 vs 3
  - 2 vs 4
  - 1 vs 2
  - 3 vs 4
- 小组赛共 24 场。
- 每组前 2 晋级，合计 8 人进入淘汰赛。
- 淘汰赛 7 场。
- 全赛事共 31 场。

这里的 1/2/3/4 是组内签位，不是种子排名。

### 淘汰赛对位

8 强：

| 位置 | 对阵 |
|---|---|
| QF1 | A1 vs B2 |
| QF2 | B1 vs A2 |
| QF3 | C1 vs D2 |
| QF4 | D1 vs C2 |

半决赛：

| 位置 | 对阵 |
|---|---|
| SF1 | QF1 胜者 vs QF2 胜者 |
| SF2 | QF3 胜者 vs QF4 胜者 |

决赛：

| 位置 | 对阵 |
|---|---|
| Final | SF1 胜者 vs SF2 胜者 |

## 积分规则

`group_knockout` 先按单打专属设计。

### 12 签固定名次积分

| 结果 | 积分 |
|---|---:|
| 冠军 | 250 |
| 亚军 | 150 |
| 四强 | 100 |
| 八强 | 65 |

止步小组赛的选手只按小组赛胜负计分：

| 小组赛结果 | 积分 |
|---|---:|
| 胜一场 | 20 |
| 输一场 | 10 |

### 16 签固定名次积分

| 结果 | 积分 |
|---|---:|
| 冠军 | 500 |
| 亚军 | 350 |
| 四强 | 250 |
| 八强 | 180 |

止步小组赛的选手只按小组赛胜负计分：

| 小组赛结果 | 积分 |
|---|---:|
| 胜一场 | 50 |
| 输一场 | 25 |

### 结算原则

- 晋级 8 强的选手只拿淘汰赛最终名次积分，不叠加小组赛胜负积分。
- 未晋级 8 强、止步小组赛的选手只拿小组赛胜负累计积分。
- 小组赛结束后只计算排名和晋级，不发最终积分。
- 淘汰赛结束后统一结算。
- 每位选手在本赛事最终只写一条积分结果。
- 管理员手动调整小组排名后，晋级名单和最终积分按冻结后的排名快照计算。

### 结算触发

- **触发点**：决赛 `match_results.resultStatus` 从 `pending` 更新为 `confirmed` 时，由确认录分的云函数同步调用 `points-engine` 入口。前端无独立"结算"按钮。
- **入口分支**：`points-engine` 在赛事维度结算时按 `tournament.format` 分发。`format === 'group_knockout'` 走新分支，**不复用**现有 winLoss 路径——[points-engine/index.js:50](cloudfunctions/points-engine/index.js:50) 默认按 `pointsRules.winLoss` 对所有 confirmed 比赛累加胜负分，新赛制必须在该路径之前显式判断 format 并提前 return，避免给晋级者多算小组赛胜负分。
- **幂等**：结算前按 `tournamentId + playerId` 查既有积分记录，若存在则 update 覆盖、不存在则 insert，保证"每位选手只一条结果"，支持失败重试。
- **失败回滚**：结算失败时 `groupKnockoutPhase` 不更新为 `completed`，决赛比分保留 confirmed，下次手动触发（重新确认决赛 / 后台重跑）可重试。
- **降级**：`pointsRules.groupKnockout` 缺失时按 `bracketSize` 取默认配置（见 L237-247），不阻断结算，但写入告警日志。

## 状态流转

赛事顶部仍沿用现有详情页流程状态，但 `group_knockout` 内部需要更细的阶段字段。

建议 `tournaments.groupKnockoutPhase`：

| 阶段 | 含义 |
|---|---|
| `group_draft` | 赛事已创建，尚未完成分组签表 |
| `group_published` | 小组赛已发布，可录入比分 |
| `group_completed` | 小组赛全部确认，待确认 8 强 |
| `knockout_published` | 8 强签表已生成，可录入淘汰赛比分 |
| `completed` | 决赛确认，赛事结算完成 |

对应详情页顶部流程可显示为：报名、签表/小组赛、淘汰赛、赛果。具体文案按当前页面已有 `phaseSteps` 模型适配，不新增第二套流程条。

允许的状态迁移（未列出的迁移在云函数层直接拒绝）：

| from | to | 触发条件 |
|---|---|---|
| `group_draft` | `group_published` | 管理员保存分组并发布小组赛 |
| `group_published` | `group_draft` | 管理员撤回，前提是尚无任何小组赛已录分（详见"修改与重建规则"） |
| `group_published` | `group_completed` | 全部小组赛比分确认，且无 `manualTiebreakRequired` 未解决 |
| `group_completed` | `group_published` | 管理员修改任一已确认小组赛成绩，系统自动回退（清空 `groupRankSnapshot`） |
| `group_completed` | `knockout_published` | 管理员点击"确认 8 强"，冻结 `groupRankSnapshot` 和 `knockoutSeedSnapshot` |
| `knockout_published` | `group_completed` | 淘汰赛尚无任何比分确认时，管理员撤回 8 强重排 |
| `knockout_published` | `completed` | 决赛 `match_results.resultStatus === 'confirmed'` 且结算成功 |

进度细分（如"小组赛已录 7/12 场"）不进 enum，按需从 `match_results` 的 `resultStatus === 'confirmed'` 计数派生，避免状态机和数据双写。

## 创建与安排签表流程

### 创建赛事

赛事创建页新增赛制选项：

- 常规赛
- 单淘汰
- 小组赛 + 淘汰赛

选择“小组赛 + 淘汰赛”后：

- 类型锁定为单打。
- 显示签位规模：12 签 / 16 签。
- 显示分组方式：提前设计 / 现场抽签后录入。
- 积分规则按签位规模自动带出，不要求管理员手填。

### 分组方式

两种分组方式最终都保存为 A/B/C/D 四组、组内签位。

提前设计：

- 管理员在赛前添加参赛选手。
- 进入“安排签表”。
- 把选手放入 A/B/C/D 组，并指定组内签位。
- 系统校验每组人数和重复选手。
- 确认后生成小组赛。

现场抽签后录入：

- 创建赛事时可先只建赛事和报名。
- 现场抽签完成后，管理员从赛事详情底部操作栏点击“安排签表”。
- 手动录入 A/B/C/D 组和组内签位。
- 系统校验人数、缺位、重复选手。
- 确认后生成小组赛。

### 详情页操作入口

底部固定操作栏按阶段变化：

| 阶段 | 主操作 |
|---|---|
| 报名未截止 | 报名 / 分享 |
| 报名已截止且未分组 | 安排签表 |
| 分组完成但未发布 | 发布小组赛 |
| 小组赛进行中 | 录入比分 |
| 小组赛完成 | 确认 8 强 |
| 淘汰赛进行中 | 录入比分 |
| 已完成 | 查看赛果 |

“安排签表”和“录入比分”都在现有底部固定操作栏，不在页面中部新增重复主按钮。

## 数据模型

### tournaments

新增或扩展字段：

```js
{
  format: 'group_knockout',
  type: 'singles',
  bracketSize: 12 | 16,
  groupDrawMode: 'preset' | 'onsite',
  groupKnockoutPhase: 'group_draft' | 'group_published' | 'group_completed' | 'knockout_published' | 'completed',
  groupRankSnapshot: null | { groups, confirmedBy, confirmedAt },
  knockoutSeedSnapshot: null | { seeds, bracket, confirmedBy, confirmedAt }
}
```

`pointsRules` 增加 `groupKnockout` 配置，默认由签位规模生成：

```js
{
  groupKnockout: {
    '12': {
      placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 },
      group: { win: 20, loss: 10 }
    },
    '16': {
      placement: { champion: 500, runnerUp: 350, semifinal: 250, quarterfinal: 180 },
      group: { win: 50, loss: 25 }
    }
  }
}
```

### tournament_groups

新增集合，保存分组和组内签位：

```js
{
  _id,
  tournamentId,
  groupCode: 'A' | 'B' | 'C' | 'D',
  slots: [
    { slotNo: 1, playerId, playerName, registrationId },
    { slotNo: 2, playerId, playerName, registrationId }
  ],
  createTime,
  updateTime
}
```

排名快照统一存放在 `tournaments.groupRankSnapshot`，作为单一真相，避免双写不一致。`tournament_groups` 不保存排名结果；查询时由 `getGroupKnockoutBracket` 从 `match_results` 按需实时计算。`groupRankSnapshot` 仅在管理员点击"确认 8 强"时一次性冻结。

### tournament_brackets

继续使用 `tournament_brackets`，但 `group_knockout` 需要 `stage` 区分小组赛和淘汰赛，避免与现有淘汰赛 round 1 文档冲突。

小组赛文档建议 ID：

```js
`bracket_${shortTournamentId}_group_${groupCode}`
```

结构：

```js
{
  _id: 'bracket_xxx_group_A',
  tournamentId,
  format: 'group_knockout',
  stage: 'group',
  groupCode: 'A',
  type: 'singles',
  matches: [
    {
      matchId,
      matchKind: 'group',
      stage: 'group',
      groupCode: 'A',
      groupSlot1: 1,
      groupSlot2: 2,
      round: 1,
      position,
      player1,
      player2,
      status: 'pending',
      resultStatus: 'pending',
      winner: null
    }
  ],
  createTime,
  updateTime
}
```

淘汰赛文档建议 ID：

```js
`bracket_${shortTournamentId}_knockout_round_${round}`
```

结构：

```js
{
  _id: 'bracket_xxx_knockout_round_1',
  tournamentId,
  format: 'group_knockout',
  stage: 'knockout',
  round: 1,
  type: 'singles',
  matches: [
    {
      matchId,
      matchKind: 'bracket',
      stage: 'knockout',
      position: 1,
      player1,
      player2,
      player1Source: 'A1',
      player2Source: 'C2',
      status: 'pending',
      resultStatus: 'pending',
      winner: null
    }
  ],
  createTime,
  updateTime
}
```

`player1Source` 和 `player2Source` 只写在 8 强首轮。半决赛和决赛不带来源标签。

### match_results

录分表继续作为比分和积分的来源，增加阶段字段：

```js
{
  tournamentId,
  format: 'group_knockout',
  tournamentType: 'singles',
  matchKind: 'group' | 'bracket',
  stage: 'group' | 'knockout',
  groupCode: 'A', // 小组赛有
  sourceMatchId,
  round,
  position,
  player1,
  player2,
  playerIds,
  resultStatus,
  score,
  winner
}
```

## 小组排名

每组排名由已确认的小组赛 `match_results` 计算。

排名字段：

- 胜场
- 负场
- 净胜局
- 总胜局
- 相互胜负说明
- 是否晋级
- 是否需要管理员手动排序

小组赛不允许平局，所有比赛必须分出胜负。

排序规则按下列顺序依次判定：

1. 胜场数（`wins`）多者排前。
2. 仍并列且并列人数 N=2：看两人之间的相互胜负（`headToHead`），胜者排前。
3. 仍并列且并列人数 N≥3：跳过相互胜负（避免 A>B>C>A 循环时的递归歧义），直接进入下一项。
4. 净胜局（`gameDiff` = 组内全部比赛 winGames − lostGames，统计范围是组内所有比赛，不只是同分人之间）多者排前。
5. 总胜局（`totalGamesWon` = 组内全部比赛累计赢的局数）多者排前。
6. 仍无法判定，标记 `manualTiebreakRequired = true`，必须由管理员手动指定 1/2/3/4 名次后才能确认 8 强。

字段命名约定：

- `wins` / `losses`：胜场、负场数
- `gameDiff`：净胜局
- `totalGamesWon`：总胜局
- `headToHead`：仅在 N=2 并列时记录
- `manualTiebreakRequired`：是否阻断"确认 8 强"

管理员手动排序后，需要记录覆盖快照：

```js
{
  groupCode: 'C',
  reason: 'manual_tiebreak',
  previousRows: [],
  finalRows: [],
  overrideBy,
  overrideAt
}
```

## 晋级确认

小组赛全部可计分比赛确认后，系统生成建议晋级名单：

- A1、A2
- B1、B2
- C1、C2
- D1、D2

如果任一组存在未解决并列，管理员必须先手动排序，不能确认 8 强。

管理员点击“确认 8 强”后：

- 冻结 `groupRankSnapshot`。
- 冻结 `knockoutSeedSnapshot`。
- 生成 8 强、半决赛、决赛占位。
- 将 `groupKnockoutPhase` 更新为 `knockout_published`。

## 签表展示

赛事详情新增“签表”入口。签表页只包含两个 Tab：

- 小组赛
- 淘汰赛

### 小组赛 Tab

未生成小组赛前：

- 展示 A/B/C/D 四组录入状态。
- 每组展示组内签位。
- 支持添加、换人、补位。
- 展示校验结果：每组人数、重复选手、缺位。
- 管理员可点击“确认分组并生成小组赛”。

小组赛生成后：

- 按 A/B/C/D 组展示。
- 每组展示选手列表、组内对阵、比分、胜者、比赛状态。
- 展示实时排名。
- 晋级位标记为 A1/A2 等。
- 录入比分后，比分和排名自动更新。
- 小组赛全部确认后，显示建议 8 强名单和“确认 8 强”入口。

### 淘汰赛 Tab

确认 8 强前：

- 显示“待小组赛结束并确认 8 强”。

确认 8 强后：

- 展示 8 强、半决赛、决赛。
- 8 强首轮展示来源标签：A1、C2、B1、D2、C1、A2、D1、B2。
- 半决赛和决赛只展示具体选手和比分。
- 淘汰赛比分确认后，胜者自动进入下一轮。
- 冠军产生后，用户可以从淘汰赛签表看完整晋级链路。

## 修改与重建规则

### 小组赛发布前

- 可以调整分组。
- 可以重新生成小组赛。

### 小组赛发布后但无成绩

- 管理员可以撤回并重新安排签表。
- 重新生成后覆盖原小组赛对阵和排程草稿。

### 小组赛已有成绩

- 不允许直接改分组。
- 如果必须重排，管理员需要先清空或作废相关成绩，再重新安排签表。

### 8 强已确认但淘汰赛未录分

- 如果小组赛成绩被管理员修改，允许重新计算排名并重新生成 8 强。
- 触发前置校验：所有 `stage: 'knockout'` 的 `match_results` 必须为 `pending`；任一为 `confirmed` 即阻断，提示先清空该淘汰赛成绩。
- 重新生成时的具体动作：
  1. 删除 `bracket_${shortId}_knockout_round_1/2/3` 三份 `tournament_brackets` 文档。
  2. 删除所有 `stage: 'knockout'` 的 pending `match_results`。
  3. 将旧 `knockoutSeedSnapshot` 归档到 `tournament_history.knockoutSeedSnapshots[]` 子文档（或独立 `tournament_snapshots` 集合），保留 `seeds`、`confirmedBy`、`confirmedAt`，并写入 `overwrittenBy`、`overwrittenAt`，便于纠纷追溯。
  4. 清空 `tournaments.knockoutSeedSnapshot` 和 `tournaments.groupRankSnapshot`。
  5. 将 `groupKnockoutPhase` 回退到 `group_completed`，等待管理员重新点击"确认 8 强"。
- 重新生成前 UI 必须明确提示："此操作将清空当前淘汰赛签表，旧 8 强种子会归档保留。"

### 淘汰赛已有成绩

- 不允许直接修改影响晋级的小组赛成绩。
- 需要先清空淘汰赛成绩，再重新确认 8 强。

## 页面改动

### 创建赛事页

- 新增赛制 chip：小组赛 + 淘汰赛。
- 选择后类型锁定为单打。
- 显示签位规模选择：12 签 / 16 签。
- 显示分组方式选择：提前设计 / 现场抽签后录入。
- 积分规则展示改为该赛制的 12/16 签固定规则。

### 赛事详情页

- 顶部沿用现有 `phaseSteps`。
- Hero 和 meta 区显示：小组 + 淘汰、12/16 签、当前进度。
- 新增“签表 · BRACKET”区块，展示分组签表、小组赛签表、淘汰赛签表的当前状态。
- 底部固定操作栏按阶段显示“安排签表”“录入比分”“确认 8 强”等操作。
- 不在中部新增“录入比分”主按钮。

### 签表页

- 两个 Tab：小组赛、淘汰赛。
- 小组赛 Tab 兼容两种状态：安排签表状态、已生成小组赛状态。
- 淘汰赛 Tab 在确认 8 强后展示完整单败签表。
- 不新增“晋级链路” Tab。

### 录分页

- 识别 `group_knockout`。
- 小组赛比赛按 groupCode 分组展示。
- 淘汰赛比赛按 8 强、半决赛、决赛展示。
- 小组赛全部确认后提示管理员确认 8 强。

## 云函数与模块影响

### tournaments

- `cloudfunctions/tournaments/lib/validate.js` 当前 format 白名单 `['regular', 'knockout']` 扩为 `['regular', 'knockout', 'group_knockout']`。
- `group_knockout` 必须显式拒绝 `type: 'doubles'` 和 `type: 'mixed'`，只允许 `'singles'`（现有 `knockout` 只 reject `mixed`，新赛制要单独加一条 doubles 拒绝规则，不要复用 knockout 的判断）。
- 校验 `bracketSize`：`group_knockout` 时必须是 12 或 16，其他赛制忽略该字段。
- `maxPlayers` 与 `bracketSize` 的关系：保存 `group_knockout` 时同步写入 `maxPlayers = bracketSize`，保持现有 `maxPlayers` 校验路径不变；新代码不再单独读 `maxPlayers`，避免双字段失同步。
- 保存和返回 `groupKnockoutPhase`、`groupDrawMode`、`groupRankSnapshot`、`knockoutSeedSnapshot`。
- 管理后台和赛事详情查询需要返回新阶段摘要。

### tournament-registrations

- 沿用单打报名结构。
- 12 签最多 12 人，16 签最多 16 人。
- 如果报名开放阶段允许自助报名，需要按 `bracketSize` 限制容量。

### tournament-brackets

新增动作建议：

- `saveGroups`：保存 A/B/C/D 组和组内签位。
- `generateGroupMatches`：根据分组生成小组赛。
- `getGroupKnockoutBracket`：返回小组赛分组、对阵、排名、淘汰赛签表。
- `confirmKnockoutSeeds`：确认 8 强并生成淘汰赛。
- `regenerateKnockoutFromGroups`：淘汰赛未开始时根据最新小组排名重建 8 强。

现有 `saveInitialMatches` 继续服务普通 `regular` 和 `knockout`，新赛制使用带 `stage` 的新动作，减少对旧路径的影响。

### match-results

- `cloudfunctions/match-results/index.js` 当前 matchKind 白名单 `_.in(['bracket', 'regularRound', 'extra'])` 扩为 `_.in(['bracket', 'regularRound', 'extra', 'group'])`，否则 `bulkUpsertScheduledMatches` 写入 `matchKind: 'group'` 时会被现有校验直接拒掉。
- `bulkUpsertScheduledMatches` 支持 `matchKind: 'group'` 和 `stage: 'group'`，写入时强制带 `groupCode`。
- 确认小组赛比分后，让排名按需在查询时实时计算（不冻结、不写回 `tournament_groups`），避免单场录分都触发全组排名重写。
- 确认淘汰赛比分后复用现有 `matchKind: 'bracket'` 推进逻辑，但 bracket doc id 需要按 `stage: 'knockout'` 解析（旧解析按 `bracket_xxx_round_${r}` 直接 lookup，新解析要先看 `stage`）。
- 结算入口新增 `group_knockout` 分支，详见"结算触发"。

### points-engine

- 新增 `group_knockout` 最终积分计算。
- 晋级者按淘汰赛名次给固定积分。
- 未晋级者按小组赛胜负累计积分。
- 确保同一赛事同一选手最终只保留一条积分结果。

## 测试设计

### 后端单元测试

- `validateTournament` 接受合法 `group_knockout` 单打赛事。
- `validateTournament` 拒绝 `group_knockout` 双打（`doubles`）和混合（`mixed`）。
- `validateTournament` 拒绝非 12/16 的 `bracketSize`。
- `saveGroups` 校验每组人数、缺位、重复选手。
- `saveGroups` 在报名人数 ≠ `bracketSize` 时阻断保存并返回明确错误。
- 12 签生成 4 组 × 3 场小组赛。
- 16 签生成 4 组 × 6 场小组赛。
- 小组排名覆盖：胜场、两人相互胜负、多人净胜局、总胜局、手动排序。
- 三人循环并列（A>B>C>A 全部 2-1）走净胜局分支，不递归看相互胜负。
- `gameDiff` 统计范围是组内所有比赛，不只是同分人之间的比赛。
- 任一组 `manualTiebreakRequired === true` 时 `confirmKnockoutSeeds` 阻断并返回需要手动排序的组列表。
- 8 强对位固定为 A1-B2、B1-A2、C1-D2、D1-C2。
- 确认 8 强后生成 3 轮淘汰赛。
- 8 强首轮带来源标签，半决赛和决赛不带来源标签。
- 淘汰赛胜者推进到下一轮。
- 小组赛成绩变更时，淘汰赛未开始允许重建；任一淘汰赛 `match_results.resultStatus === 'confirmed'` 时阻止重建。
- 重建 8 强会删除旧的 3 份淘汰赛 bracket 文档和全部 pending `stage: 'knockout'` 的 `match_results`，并把旧 `knockoutSeedSnapshot` 归档保留。
- 状态机：未列出的迁移（如 `group_draft` → `knockout_published`）被云函数直接拒绝。
- `pointsRules.groupKnockout` 缺失时按 `bracketSize` 回填默认配置并写告警，不阻断结算。
- 12 签积分：晋级者只拿名次分，未晋级者只拿 20/10 胜负分。
- 16 签积分：晋级者只拿名次分，未晋级者只拿 50/25 胜负分。
- 结算幂等：同一赛事重复触发结算，每位选手只保留一条积分记录。
- 结算入口：`format === 'group_knockout'` 不走 `pointsRules.winLoss` 默认路径，晋级者不会被多算小组赛胜负分。

### 前端测试

- 创建页选择 `group_knockout` 后锁定单打并显示签位规模。
- 赛事详情在未分组阶段底部显示“安排签表”。
- 赛事详情在小组赛和淘汰赛阶段底部显示“录入比分”。
- 签表页只有“小组赛 / 淘汰赛”两个 Tab。
- 小组赛 Tab 在未生成前展示组内签位录入和校验。
- 小组赛 Tab 在生成后展示对阵、比分、排名、晋级标记。
- 淘汰赛 Tab 在 8 强确认前展示等待态。
- 淘汰赛 Tab 在 8 强确认后展示完整签表。
- 8 强来源标签只出现在首轮。

## 视觉原型

本轮讨论生成了可视化伴侣原型，用于说明方向，不作为产品代码：

- `.superpowers/brainstorm/group-knockout-visual-1779895453/content/group-knockout-pages-v2.html`

原型确认点：

- 详情页顶部沿用现有流程状态。
- 底部固定操作栏承载“安排签表”和“录入比分”。
- 签表页只有“小组赛”和“淘汰赛”两个 Tab。
- 现场抽签后，管理员通过“安排签表”手动录入 A-D 小组和组内签位。

## 非目标

- 不支持双打或混合 `group_knockout`。
- 不新增 GSL 小组赛。
- 不新增简化瑞士小组赛。
- 不把小组赛和淘汰赛拆成两个赛事。
- 不新增单独“晋级链路” Tab。
- 不把小组赛胜负积分叠加给 8 强晋级者。

## 实现拆分建议

1. 数据校验和创建流程：新增 `group_knockout`、`bracketSize`、`groupDrawMode`、`groupKnockoutPhase`。
2. 分组与小组赛生成：新增保存分组、校验、生成小组赛对阵。
3. 小组排名与晋级确认：实现排名算法、手动排序、8 强确认和淘汰赛生成。
4. 录分与推进：支持小组赛录分刷新排名，淘汰赛复用 bracket 推进。
5. 积分结算：实现 12/16 签的晋级者名次分和未晋级者小组胜负分。
6. 页面：创建页、详情页、签表页、录分页。
7. 回归测试：覆盖现有 `regular`、`knockout`、`mixed regular` 不受影响。
