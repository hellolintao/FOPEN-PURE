# 常规赛混合类别设计

日期：2026-05-17

## 背景

创建赛事页需要在常规赛下新增“混合（单打 + 双打）”类别。混合赛事每小时自动安排一场单打、一场双打、一场自由拉球；淘汰赛不可选择混合。赛事详情参赛人员改为按人展示，双打赛事也不再按队伍分组展示。

## 用户确认

- 常规赛默认类别为“混合”。
- 混合赛事中，单打场计入单打积分，双打场计入双打积分。
- 不新增 mixed 排名维度。

## 方案选择

推荐方案：赛事级 `type` 增加 `mixed`，同时每场比赛显式写入 `type: 'singles' | 'doubles'`。

理由：

- 创建页和赛事列表能准确表达这是混合赛事。
- 排程、录分、积分可以按单场类型处理，避免把混合赛事误归入单打或双打。
- 现有单打/双打积分和排行榜体系可以复用。

备选方案一：赛事仍保存为 `singles`，仅排程中混入双打。这个方案会让赛事详情和积分归属含糊，容易把双打场记成单打。

备选方案二：新增完整 mixed 积分体系。这个方案范围过大，需要改排行榜、个人详情、周明星和历史统计，不符合当前需求。

## 功能设计

### 创建赛事

- 默认表单：`format: 'regular'`，`type: 'mixed'`。
- 类别 chips：单打、双打、混合。
- 当 `format === 'regular'` 时，混合可选。
- 当 `format === 'knockout'` 时，混合禁用；如果当前类别是混合，自动切回单打。
- 切换类别或赛制后，如已有排程，仍沿用现有“已生成对阵将重置”的行为。

### 报名人员

- mixed 与 regular doubles 一样按个人报名，不要求固定搭档。
- 最低人数：混合至少 4 人，因为每小时需要一场双打。
- knockout doubles 仍按固定搭档报名。

### 默认排程

- regular singles：保持现有每小时两场单打 + 一场自由拉球。
- regular doubles：保持现有每小时两场双打 + 一场自由拉球。
- regular mixed：每个小时按 slot 顺序安排：
  - 第 1 个 slot：单打
  - 第 2 个 slot：双打
  - 第 3 个 slot：自由拉球
- 如果某小时不足 3 个 slot，仅按已有 slot 顺序填入：第 1 个单打、第 2 个双打。
- 单打从报名人中平衡选 2 人。
- 双打从报名人中平衡选 4 人并随机拆成两队。
- 每场 match 写入单场 `type` 和 `matchKind: 'regularRound'`。

### 手动添加

- 排程空格点击 `+ 添加` 时，弹框项改为：单打、双打、自由拉球。
- 单打选择 2 人，生成 `type: 'singles'` 的 extra match。
- 双打选择 4 人，生成 `type: 'doubles'` 的 extra match。
- 自由拉球仍直接生成占位。
- 只有常规赛能手动添加比赛；淘汰赛不允许添加 extra match。

### 详情页参赛人员

- 详情页 roster 改为按人去重展示。
- 单打、常规赛双打、混合：展示报名中的 `playerId/playerName`。
- 淘汰赛双打：把每条报名拆为 `playerId/playerName` 和 `partnerId/partnerName` 两个人。
- 展示计数为去重后的参赛人数。

### 录分和积分

- `match_results.tournamentType` 优先使用单场 `match.type`。
- 若历史 match 没有 `type`，回退到赛事 `tournament.type`。
- `playerIds`、胜负积分 entries、晋级逻辑都按单场类型判断双打 partner。
- 淘汰赛仍只支持 singles/doubles，不支持 mixed。

## 数据模型影响

- `tournaments.type`: 允许 `singles | doubles | mixed`。
- `tournament_registrations.type`: 允许保存 `mixed`，但 mixed 报名按个人记录，`partnerId` 可为空。
- `tournament_brackets.type`: 对混合赛事 R1 文档可保存 `mixed`，单场 match 自带 `type`。
- `match_results.tournamentType`: 对混合赛事的具体结果保存为单场 `singles` 或 `doubles`，用于积分和排行榜聚合。

## 测试设计

- 云端 scheduler 测试：regular mixed 的 1 小时生成单打、双打、自由拉球各一项。
- 云端 scheduler 测试：mixed 每场携带正确 `type`，双打场 `playerIds` 覆盖 4 人。
- tournaments validate 测试：regular mixed 合法，knockout mixed 不合法。
- match-results 测试：mixed 赛事中单打场按 2 人计分，双打场按 4 人计分，并分别写入 `tournamentType`。
- 前端 schedule-board 逻辑测试或可测 helper：手动添加单打/双打生成正确类型和 requiredCount。

## 非目标

- 不做 mixed 独立排行榜。
- 不改 score-row 双打展示结构。
- 不改淘汰赛签表生成规则。
