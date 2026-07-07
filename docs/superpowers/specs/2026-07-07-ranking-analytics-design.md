# 排行榜与个人数据分析增强设计

日期：2026-07-07

## 背景

当前排行榜和个人页已经具备基础能力：单/双打排行榜、`rank_snapshots` 趋势数据、个人统计、H2H、近期比赛。但现有体验有几个明显缺口：

- 排行榜趋势在无快照或持平时都显示 `—`，用户无法判断是没有历史、持平，还是功能未生效。
- 排行榜缓存按 2 小时刷新，管理员刚确认比分后，用户希望榜单马上反映新结算。
- 双打 H2H 以“自己 vs 单个对手”展示，不能表达真实双打关系：`我 / 搭档 vs 对手1 / 对手2`。
- 个人页缺少更有解释力的数据，如近 5 场状态、最佳搭档、苦主/优势对手、比赛后影响。

本设计将这些增强收敛为一次现有页面增强版本，不新增独立“数据中心”入口。

## 已确认决策

- 交付方式：增强现有排行榜和个人页，不新增大入口。
- 趋势口径：排行榜主列表对比上一份有效 `rank_snapshots`。
- 趋势展示：显示 `▲N`、`▼N`、`持平`、`新上榜`、`暂无历史`。
- 双打 H2H 展示：左右队伍布局，左侧我方组合，右侧对手组合，中间显示战绩。
- 排行榜刷新：管理员确认比分后立即刷新云端榜单缓存，前端清本地排行榜缓存。
- 数据方案：新增 analytics 缓存集合，而不是只在前端临时聚合。
- 新增功能范围：近 5 场状态、最佳搭档、苦主/优势对手、比赛后影响提示。

## 目标

1. 让排行榜趋势可解释，避免所有状态都显示 `—`。
2. 让比分确认后的排行榜在下一次打开时就是新结果。
3. 让双打交手记录按组合对组合展示。
4. 让个人页从“数据列表”升级为“战绩分析”。
5. 通过缓存集合为后续扩展统计分析打基础，同时控制本次页面范围。

## 非目标

- 不新增独立“数据中心”Tab 或页面。
- 不重做赛事、录分、赛程等主流程。
- 不改变现有积分规则和排名排序规则。
- 不把统计缓存失败作为比分确认失败处理。

## 架构

新增一个统计缓存层，由结算流程触发、由页面读取：

1. 管理员确认比分。
2. `match-results` 完成比分确认和积分写入。
3. 调用 `points-engine.refreshRankCache` 刷新排行榜缓存。
4. 调用新增 `analytics-engine.refreshAfterSettlement` 重算受影响成员和组合。
5. 前端清除本地 `rank:`、`player-detail:` 相关缓存。
6. 排行榜和个人页优先读取缓存结果，失败时回退到现有实时接口。

新增云函数：

- `analytics-engine.refreshAfterSettlement({ seasonId, affectedMemberIds, matchIds })`
- `analytics-engine.rebuildSeason({ seasonId })`
- `analytics-engine.getPlayerAnalytics({ seasonId, memberId })`
- `analytics-engine.getPairAnalytics({ seasonId, memberId })`

## 数据模型

### player_analytics

每个赛季、每个成员一条文档。

主键：`pa_<seasonId>_<memberId>`

字段：

- `seasonId`
- `memberId`
- `updatedAt`
- `sourceVersion`
- `singles`
  - `winCount`
  - `lossCount`
  - `totalPoints`
  - `winRate`
  - `lastFive`
  - `strongAgainst`
  - `strugglesAgainst`
- `doubles`
  - `winCount`
  - `lossCount`
  - `totalPoints`
  - `winRate`
  - `lastFive`
  - `bestPartners`
  - `strongAgainst`
  - `strugglesAgainst`
- `recentMatches`
  - 已格式化的近期比赛展示数据
  - 双打必须包含完整组合：`subjectTeam`、`opponentTeam`
- `lastSettlementImpact`
  - 最近一次结算带来的积分变化、排名变化、涉及比赛

### pair_analytics

每个赛季、每个双打组合一条文档。

主键：`pair_<seasonId>_<memberA>_<memberB>`，其中 `memberA/memberB` 按 ID 排序，避免重复。

字段：

- `seasonId`
- `memberIds`
- `memberNames`
- `matches`
- `wins`
- `losses`
- `winRate`
- `recentMatches`
- `matchups`
  - 对手组合维度聚合
  - 结构：`opponentPairId`、`opponentMemberIds`、`wins`、`losses`、`lastPlayedAt`

### analytics_jobs

必建集合，用于记录异步刷新和失败重试。

字段：

- `jobType`
- `seasonId`
- `status`
- `affectedMemberIds`
- `matchIds`
- `error`
- `createTime`
- `updateTime`

## 页面设计

### 排行榜

列表列保持现有结构，调整 `TREND` 展示逻辑：

- `trendDelta > 0`：显示 `▲N`
- `trendDelta < 0`：显示 `▼N`
- `trendDelta === 0`：显示 `持平`
- 当前上榜、上一快照不存在：显示 `新上榜`
- 没有任何快照历史：显示 `暂无历史`

排行榜副文可根据刷新状态显示：

- `刚刚结算后已更新`
- `每 2 小时自动校准`
- `数据刷新失败，可稍后重试`

比赛后影响展示在受影响行内或结算完成 toast 中：

- `赛后 +20 分`
- `上升 2 名`
- `首次进入榜单`

### 个人页

现有单/双打 Tab 保留。

新增模块：

- 近 5 场状态：如 `4W-1L`，按当前 Tab 切换。
- 最佳搭档：双打下展示搭档名、场次、胜率。
- 苦主/优势对手：单打按个人，双打按组合。
- 双打 H2H：左右队伍布局。
- 最近比赛：双打显示完整组合名，不再只显示一个对手。

双打 H2H 行布局：

- 左侧：我方组合 `我 / 搭档`
- 中间：战绩 `2-1`
- 右侧：对手组合 `对手1 / 对手2`
- 点击行在当前个人页内展开最近 3 场该组合交手，不跳转到单个球员详情。

## 数据流

### 比分确认后

1. `match-results` 确认比分并写入积分。
2. 收集受影响成员：
   - 单打：双方成员
   - 双打：四名成员
3. 刷新 `rank_cache`。
4. 重算相关 `player_analytics`。
5. 重算相关 `pair_analytics`。
6. 返回结算影响摘要给前端。
7. 前端清除本地缓存，并展示结算影响提示。

### 页面读取

排行榜：

1. 先读 `points-engine.rankList`。
2. 使用增强后的趋势状态。
3. 本地缓存仍可保留，但结算后必须清理。

个人页：

1. 先读 `analytics-engine.getPlayerAnalytics`。
2. 如果失败或无数据，回退到现有 `points-engine.playerStats` 和 `playerH2H`。
3. 回退状态下只展示可计算的基础模块。

## 回填策略

上线前运行一次：

```text
analytics-engine.rebuildSeason({ seasonId: 'season_2026' })
```

回填来源：

- `match_results`
- `tournament_points`
- `baseline_standings`
- `members`
- `rank_snapshots`

回填要求：

- 可重复执行，结果幂等。
- 先写缓存集合，再在前端启用增强展示。
- 回填失败不能破坏现有排行榜和个人页。

## 失败处理

比分确认是主流程，统计刷新是增强流程。

- 比分确认成功、统计刷新成功：提示“结算完成，排行榜已更新”。
- 比分确认成功、统计刷新失败：提示“比分已确认，数据分析稍后重算”。
- 统计刷新失败时记录日志或 `analytics_jobs`。
- 管理员入口提供“重算本赛季数据”能力。
- 普通用户页面读取缓存失败时 fallback 到现有实时接口。

## 测试计划

后端测试：

- `refreshAfterSettlement` 只重算受影响成员和组合。
- `rebuildSeason` 幂等。
- 单打近 5 场状态正确。
- 双打最佳搭档按组合胜率和场次计算正确。
- 苦主/优势对手按胜负口径正确。
- 双打 H2H 聚合为组合对组合。
- 统计刷新失败不影响比分确认。
- `rank_cache` 在确认比分后刷新。

前端测试：

- 排行榜趋势状态覆盖 `▲N`、`▼N`、`持平`、`新上榜`、`暂无历史`。
- 排行榜本地缓存可被结算流程清除。
- 个人页展示近 5 场、最佳搭档、苦主/优势对手。
- 双打 H2H 使用左右队伍布局。
- 最近比赛双打展示完整组合。
- analytics 读取失败时展示基础数据，不白屏。

验收：

- 管理员确认一场单打比分后，排行榜积分和排名立即更新。
- 管理员确认一场双打比分后，四名成员的个人页和相关组合数据更新。
- 双打 H2H 不再出现“自己 vs 单个用户”的表达。
- 无趋势历史时，用户能看到明确状态，而不是统一 `—`。
