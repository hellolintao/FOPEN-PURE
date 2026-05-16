# FOPEN 小程序 · 排行榜 + 玩家详情 + 资料编辑 · 设计 spec

- 日期：2026-05-16
- 范围版本：Phase 10（拆为 Phase 10-1 / Phase 10-2）
- 状态：设计已审定（用户 + Codex 双方），等待写实施 plan
- 上游文档：
  - v1 总规范：`docs/superpowers/specs/2026-05-11-tennis-club-miniprogram-design.md`（本 spec 兑现其 §12 Phase 2 待办）
  - v2.1 质量迭代：`docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design.md`（Phase 9，已完成代码）
  - 沟通日志：`docs/communication/2026-05-16-claude-codex-v2-1-log.md`（含 Codex "Rank / Profile / Player Detail 分期口径" 节，是本 spec 的最终数据/分期口径来源）
- 维护：本文档是 Phase 10 唯一设计来源；任何后续 plan / 实现 / review 都以本 spec 为准。

---

## 1. 范围与成功标准

### 1.1 目标

兑现 v1 spec §12 Phase 2 中尚未落地的 4 项缺口，并叠加用户在 2026-05-16 提出的新需求——把"排行榜 + 玩家详情 + 资料编辑"三处串成一个独立可发版的小段落，让会员既能在排行榜上看到当周变化，也能在个人页看清楚累积表现，并能自己设置打法标签。

- **会员**：进 player-detail 1 屏内能看到「胜场/总场次 · 胜率 · 积分」三张卡（单 + 双），名次在 hero 副标显示
- **会员**：在 edit-profile 能自己选 playStyle 与填 playStyleNote，提交后 player-detail 立刻看到
- **所有人**：rank 页能看出"上周到本周谁升降了"，每周之星 hero 可点跳玩家页
- **新数据基建**：`rank_snapshots` 集合作为历史排名快照来源，supports 趋势箭头 + 折线 + 后续衍生分析

### 1.2 范围内（Phase 10 必须做）

| 类别 | 项目 |
|---|---|
| 页面改造 | `pages/rank/index`、`pages/player-detail/index`、`pages/edit-profile/index` |
| 现有组件 | `components/rank-row`（API 扩展 + 三列布局重做）、`components/skeleton-loader`（沿用，无改） |
| 新组件 | `components/rank-chart`（纯 SVG 排名折线，不引第三方库）、`components/h2h-row`（H2H 一行 + tap 跳玩家页） |
| 新集合 | `rank_snapshots`（per-player-per-week 行式存储，详 §4.1） |
| 后端新增 action | `points-engine.playerH2H` |
| 后端扩展 action | `points-engine.rankList`（加 `trendDelta`）、`points-engine.playerStats`（加 `winRate / currentRank / rankHistory / weeklySnapshot`）、`weekly-star`（新增 current/fallback 读取口径；cron 同时双写 `weekly_stars` + `rank_snapshots`）、`members.update`（接受当前用户自己的 `playStyle / playStyleNote`） |
| 后端新增内部函数 | `aggregateRanks({asOf})` 加 `asOf` 入参、`aggregateWeeklyPlayerDelta({seasonId, type, playerId, week})` |
| 后端脚本 | 一次性 W0 回填脚本（`snapshotKind: 'baseline'`，详 §4.4） |
| 文档 | 更新 `cloudfunctions/DATABASE_SCHEMA.md`（新增 `rank_snapshots`；同步 `playStyleNote` 最大 50 字） |

### 1.3 显式不做（推 Phase 11 或更后）

- 跨赛季历史折线（本期 12 周窗口，跨赛季 punt）
- 实时排名变更通知 / 推送
- 社交（关注、点赞、评论）
- player-detail 的"积分到期日"提示（v1 §13.1 风险项）
- 长连胜指标（用户 2026-05-16 prototype v2 反馈中明确换成"积分"，本期完全不实现）
- rank 页搜索 / 字母索引（俱乐部 < 100 人，列表全展示）
- player-detail 比赛细节（仅展示 score 文本，不解析逐 set / 逐 game）
- weekly snapshot 的服务端 cache（Phase 10-2 走实时扫，先不 cache）

### 1.4 验收门槛（不达不算 Phase 10 完成）

| # | 标准 | 度量 |
|---|---|---|
| 1 | rank 页列表每行显示 5 列：RANK · PLAYER · WIN% · PTS · TREND，无冠军 hero，每周之星是唯一 hero | 视觉 review |
| 2 | 每周之星卡可点击跳对应玩家 player-detail；卡片副文同时显示「本周积分 +N · W-L X-Y」 | E2E |
| 3 | 空周（本周还无比赛）保留上周冠军卡，标签 `PREV WEEK · 上周冠军`，副文 `等本周首场` | 视觉 review |
| 4 | player-detail：单/双打各 3 张卡（胜场/总 · 胜率 · 积分），无 wins+matches 双卡，hero 副标显示 "S{year} · 单打 #X · 双打 #Y" | 视觉 review |
| 5 | player-detail：排名走势折线 12 周可见；H2H 行可点击跳对应玩家页；最近比赛行无状态徽章，显示「轮次 · 比赛名 · 比分 · vs 对手 · +积分」 | 视觉 review + E2E |
| 6 | edit-profile：会员能改自己 playStyle（5 选 1）+ playStyleNote（≤ 50 字），提交后 player-detail 看到 | E2E |
| 7 | `rank_snapshots` cron 每周一 00:30 写入；W0 baseline 脚本一次性写入"现在快照"；trendDelta 无有效快照或持平时 UI 显示 `—` | cron 日志 + 数据校验 |
| 8 | 单测覆盖：`rank_snapshots` schema + cron 双写、`aggregateRanks(asOf)`、`rankList.trendDelta`、`playerStats` 新字段、`playerH2H`、`aggregateWeeklyPlayerDelta` | jest --coverage ≥ 85% / 新函数 ≥ 90% |
| 9 | 兼容：旧 `playerStats.recent` 结构变更不破 my-match / mine 页；旧 `rankList` 调用方（v2.1 三页）不破 | 全量回归 213+ 测试不破 |

### 1.5 已显式接受的风险与代价

- W0 baseline 快照只代表"发版瞬间排名"，不是完整自然周；baseline 之后未发生排名变化时 trendDelta 为 0 或 null，UI 显示 `—`
- weeklySnapshot 实时扫本周 match_results，无 cache；俱乐部场次 < 1000 量级时延迟 < 300ms 可接受
- `aggregateRanks(asOf)` 增加查询过滤条件，对超大数据集（>10000 比赛）有性能影响；俱乐部当前规模无碍
- `rank_snapshots` 按 per-player-per-week 存，文档数 = 会员数 × 周数 × 2 type；100 人 × 52 周 × 2 = 10400 文档/年；可控
- H2H 实时算，每次 player-detail 加载 +1 次本赛季 match_results 扫；可接受

---

## 2. 信息架构

### 2.1 `pages/rank/index`（排行榜）

**布局（从上到下）**：

1. **HEAD**：`SEASON · S2026` tape + `28 位选手 · 实时更新` 副文 + `排行榜 RANKINGS` 双语标题
2. **TABS**：`chip-tab` SINGLES / DOUBLES 切换
3. **每周之星 hero**（唯一 hero · 可点击）
   - 普通态（本周已有 confirmed 比赛）：`★ WEEKLY STAR` tape + 本周范围（`05/11 – 今天`）+ 头像 + 玩家名 + `本周积分 +N · W-L X-Y` 副文 + 右侧 → 跳玩家页
   - 空周态（本周还没有 confirmed 比赛）：标签 `PREV WEEK · 上周冠军`，主体使用上一份 `weekly_stars` 对应 type 的冠军，副文改为 `等本周首场`
   - 无数据态（赛季初无任何 weekly_stars 记录）：隐藏 hero，露出列表
   - tap 行为：`wx.navigateTo({ url: '/pages/player-detail/index?id=' + memberId })`
4. **LIST HEADER**：`RANK | PLAYER | WIN% | PTS | TREND`（5 列）
5. **LIST**：每行 `rank-row` 组件，含
   - `rank`：序号
   - `avatar + name`：玩家信息
   - `winRate`：实时累计胜率（百分号，例 `71%`）
   - `totalPoints`：实时累计积分
   - `trendDelta`：与上一份 weekly snapshot 对比（▲N / ▼N / — / 无数据时也是 —）
   - `highlight`：current member 行底色 + lime 左竖条（沿用现有视觉）
   - tap 行为：跳对应 player-detail
6. **EMPTY**：本赛季无 confirmed 比赛 → 全屏 empty state（沿用现有 wxml）

**数据加载**：

- `onShow` 同时调 `points-engine.rankList` + `weekly-star.current`
- 切 tab 时两个接口都重新调（type 参数不同）
- 不做 lazy load / 分页（俱乐部规模可接受全量返回）

### 2.2 `pages/player-detail/index`（玩家详情）

**入参**：`id`（必填，memberId）

**布局**：

1. **HERO**：
   - `PLAYER · 球员档案` tape
   - 头像 + 玩家名（大字 800 weight）
   - 副标第 1 行：`S2026 · 单打 #2 · 双打 #5`（名次从 `playerStats.currentRank` 来；无数据显示 `单打 未上榜`）
   - 副标第 2 行：playStyle pill（如 `底线型 · Baseliner`）；无 playStyle 时显示 `打法未设置`
2. **ABOUT**（`playStyleNote` 非空时显示）：tape `关于 · ABOUT` + 文本
3. **SINGLES**：tape `SINGLES · 单打` + 3 张 stat card
   - 卡 1（默认底色）：`胜场/总` — 大字 `12<small>/17</small>`
   - 卡 2（lime 底）：`胜率` — `71%`
   - 卡 3（ink 底）：`积分` — `285`
4. **DOUBLES**：tape `DOUBLES · 双打`（ghost 风格）+ 同 3 张卡（默认底色不同，避免视觉与单打混淆）
5. **排名走势 · 单打**（`rank-chart` 新组件）：tape `排名走势 · 单打 · 12周` + SVG 折线 + meta 副文 `越靠上名次越好 · 12 周前 #6 → 当前 #2`
   - 数据来源：`playerStats.rankHistory.singles`（最近 12 周快照；不足 12 周时显示已有的全部）
   - 折线 y 轴：rank（值越小越好，画在 SVG 上半部分）
   - 终点 lime dot + rank 文本
6. **排名走势 · 双打**（`rank-chart` 新组件）：与上一节同结构，数据源 `rankHistory.doubles`；若该玩家无双打比赛则整节隐藏
7. **H2H · 单打**（`h2h-row` 新组件）：tape `交手记录 · H2H · 单打` + 多行
   - 每行：头像 + 对手名 + `胜-负` 胶囊（胜多: lime soft / 负多: 红 soft / 平: 灰）+ 右侧 → 提示
   - 排序：`(wins + losses) DESC`（交手次数多在前）
   - 数量：默认 top 5；超过时底部 footer 行「展开全部 X 人 →」点击展开剩余
   - tap 行为：跳对应玩家 player-detail
   - 数据来源：`points-engine.playerH2H.singles`
8. **H2H · 双打**：同上结构，数据源 `.doubles`；该玩家无双打 H2H 时整节隐藏
9. **最近比赛**：tape `最近比赛 · RECENT` + 多行
   - 每行结构：
     - 顶部：轮次徽章（`R3` ink 底 / `常规赛` 灰底 / `SF/QF` 等淘汰阶段）+ 比赛名 + 日期
     - 底部：比分（大字）+ ` vs 对手` + 右侧 `+积分` 胶囊（胜=lime soft / 负=红 soft，数字是 pointsAwarded for this player）
   - **不**显示 `已确认/待打/已交` 状态徽章（v1 实现里有，本期删除）
   - 只显示 `resultStatus === 'confirmed'` 的比赛
   - 数量：top 10

**数据加载**：

- `onLoad` 并行调 3 个接口：`members.getById` + `points-engine.playerStats` + `points-engine.playerH2H`
- 单打 / 双打**同屏堆叠展示**，无切换 tab（与 rank 页 chip-tab 不同）；如该玩家无双打数据，双打区整体隐藏避免空白
- skeleton-loader 在加载期显示

**关键决策**：

- player-detail 不再展示「长连胜」（v1 spec 草案有，prototype v2 反馈中明确换成「积分」）
- "当前名次"显示在 hero 副标而不是单独卡，节省 1 张卡空间
- H2H 默认 top 5，给俱乐部规模留余地

### 2.3 `pages/edit-profile/index`（个人资料编辑）

**布局变更（增量）**：

在现有姓名 / 头像 / 手机字段之后，新增 2 个字段：

1. **打法 playStyle**（5 选 1 segmented control 或 picker；wxml 用 `radio-group` + `radio` 即可）
   - 选项：`底线型 baseliner` / `发球上网 serve-volleyer` / `全场型 all-court` / `反击型 counter-puncher` / `进攻底线型 aggressive-baseliner`
   - 可空（"未设置"作为第 6 个隐式选项，提交时为 `null`）
2. **打法备注 playStyleNote**（textarea，maxlength=50）
   - placeholder：`例：贝克汉心理 / 喜欢正手暴扣 / 接发抢攻`
   - 实时字符计数

**数据流**：

- `onLoad` 优先使用 `globalData.currentMember`；缺失或需要刷新时调 `members.get` 按当前 OPENID 拉当前用户，不依赖 `_id`
- 提交时调 `members.update`，payload 含 `playStyle / playStyleNote`（沿用现有 update action，后端加 schema 校验）
- 提交成功后更新 globalData.currentMember，`wx.navigateBack`

**权限**：

- 会员只能编辑自己（`members.update` 校验 `currentOpenid === target.openid` 或 admin）
- admin 编辑别人走 `member-edit`（管理员页，本期不动）

---

## 3. 视觉设计

完全沿用 visual-revamp stream 已建立的 token 体系（lime / ink / tape / 大字 / 不对称），**不引入新 token**。具体：

- `--color-lime: #BEE645`（每周之星 hero 底、stat 卡 2 底、win 胶囊）
- `--color-ink: #0A0A0A`（stat 卡 3 底、主文字）
- `--color-bg-2 #FAFAFA / --color-border #E5E7EB` 等沿用
- `--color-danger-soft`（如已存在 / 否则 `#FEE2E2`）：lose 胶囊
- `--color-success-soft`（如已存在 / 否则 `#DDF099`）：win 胶囊（与 lime 区分）
- 字体：display 用现有 PingFang SC 高字重（Codex O1 决策选 (c) 系统字体路线），数字配 `.num` 工具类

新组件视觉规范：

- **`rank-chart`**：SVG 100rpx 高，含 3 条水平虚线网格 + 单条 2.5px ink 折线 + 终点 5px lime 圆点带 ink 描边 + 终点上方 rank 文本（10rpx, 700 weight, 右对齐）
- **`h2h-row`**：高度 ~56rpx，左 28rpx 头像 + 名字 flex 1 + 右侧胜负胶囊 + 极右 → 箭头（10rpx muted）

---

## 4. 数据模型

### 4.1 新增集合 `rank_snapshots`

**存储形态**：per-player-per-week 行式（不是每周一个大文档）。

```js
{
  _id: "rs_s2026_W19_singles_mAaa",  // {seasonId}_{weekId}_{type}_{memberId}
  seasonId: "s2026",
  weekId: "W19",                      // ISO 周编号；W0 baseline 用 "baseline_2026-05-16"
  weekStart: "2026-05-04",            // 周一 yyyy-mm-dd
  weekEnd:   "2026-05-10",            // 周日 yyyy-mm-dd
  effectiveAt: Date,                  // 用于 trend/latest 排序；weekly=weekEnd 23:59:59，baseline=回填时刻
  type: "singles",                    // 'singles' | 'doubles'
  memberId: "m_aaa",
  rank: 2,                            // 截至该周结束时的排名
  totalPoints: 285,                   // 截至该周结束累计积分
  wins: 12,                           // 截至该周结束累计胜场
  losses: 5,                          // 累计负场
  snapshotKind: "weekly",             // 'weekly' | 'baseline'
  computedAt: Date                    // 写入时间
}
```

**说明**：

- `snapshotKind`：weekly = cron 写的自然周快照；baseline = W0 一次性回填写的"发版瞬间快照"
- weekly 文档 `weekId` 是 ISO 周（`W19`）；baseline 文档 `weekId` 用 `baseline_YYYY-MM-DD` 格式
- `effectiveAt` 是 trend 比较的权威排序字段。不要用 `weekStart DESC` 取 latest；否则周中写入的 baseline 会压过随后写入的上一自然周 weekly snapshot。
- "截至该周结束"指通过 `aggregateRanks({ asOf: weekEnd })` 计算，避免回填或重跑历史周时被未来比赛污染（详 §5.3）

**索引**：

| Index | Purpose |
|---|---|
| `(seasonId, type, weekStart DESC, rank ASC)` | rank 折线图按周倒序拉，单周内按 rank 升序 |
| `(seasonId, type, memberId, weekStart ASC)` | 单个玩家 rankHistory 查询（折线图数据源） |
| `(seasonId, type, memberId, effectiveAt DESC)` | `rankList.trendDelta` 查询最近一份有效快照 |
| `(seasonId, type, weekId, memberId)` UNIQUE | cron 写入的幂等 upsert key |

**容量估算**：100 人 × 52 周 × 2 type = 10400 文档/年；可控。

### 4.2 `members` 字段沿用 v1 §5.1

```diff
{
  // 沿用：_id, openid, name, avatarUrl, phone, status, admin, createTime, updateTime
+ playStyle: "baseliner",       // 'baseliner' | 'serve-volleyer' | 'all-court' |
+                                // 'counter-puncher' | 'aggressive-baseliner' | null
+ playStyleNote: "贝克汉心理"    // string ≤ 50 字 | null
}
```

**迁移**：

- 旧文档无该字段时按 `null` 处理（前端 `player.playStyle || '打法未设置'`）
- 不批量回填；用户首次进 edit-profile 提交时写入

**校验**：

- `playStyle` 必须在 5 个枚举内，否则 `INVALID_PAYLOAD`
- `playStyleNote` 字符串长度 ≤ 50，否则 `VALIDATION_FAILED: '备注最多 50 字'`

### 4.3 其余表沿用现状

`match_results` / `tournaments` / `weekly_stars` 不动。

---

## 5. 云函数 / API

### 5.1 输入输出统一约定

沿用 v2.1 §5.1 `utils/cloud.callFunction` wrapper 协议：`{ ok: true, data, requestId } | { ok: false, error }`。

后端 envelope 沿用 v1 §10：`{ success: true, data } | { success: false, error: { code, message } }`。

### 5.2 `points-engine.rankList`（扩展）

**输入**：`{ action: 'rankList', type: 'singles' | 'doubles', currentSeasonId: 's2026' }`

**输出**：

```js
{
  success: true,
  data: {
    rankList: [
      {
        _id: "m_aaa",
        name: "陈思远",
        avatarUrl: "...",
        totalPoints: 340,
        winCount: 17,
        lossCount: 4,
        winRate: 0.82,              // ✨ 新字段，0.0-1.0；前端转 "82%" 显示
        trendDelta: null            // ✨ 新字段：正数=升、负数=降、0=平、null=首周或无快照
      }
    ]
  }
}
```

**`trendDelta` 计算逻辑**：

1. 当前实时 rank（即返回数组下标 + 1）
2. 查询 `rank_snapshots`：`{ seasonId, type, memberId }`，按 `effectiveAt DESC, computedAt DESC` 取第 1 条
3. 若无快照 → `trendDelta = null`（UI 显示 `—`）
4. 若有快照 → `trendDelta = snapshot.rank - currentRank`（正数表示名次进步）

**示例**：上周 `#5` → 本周 `#3` → `trendDelta = 5 - 3 = +2`（升 2 位，UI `▲2`）。

### 5.3 `aggregateRanks` 内部函数（扩展）

**已有签名**：`aggregateRanks({ db, seasonId, type, pageSize })`

**扩展签名**：`aggregateRanks({ db, seasonId, type, pageSize, asOf? })`

**`asOf` 语义**：

- 若提供 `asOf`（Date 或 ISO date 字符串），仅聚合截至该时刻已经生效的积分来源：
  - `match_results`：`(confirmedAt || createTime) <= asOf`
  - `tournament_points`：`(awardedAt || createTime) <= asOf`
- 不提供则同现状（聚合全部 confirmed match_results）

**用途**：

- 实时 rankList 不传 asOf
- weekly-star cron 写 weekly 快照时传 `asOf = weekEnd`
- W0 baseline 脚本不传（写当下状态）

**排序规则**：统一为 `totalPoints DESC, wins DESC, losses ASC, memberId ASC`。当前代码只按 `totalPoints DESC`，Phase 10-1 需要补稳定 tie-breaker，避免同分玩家在不同聚合/快照中抖动。

### 5.4 `points-engine.playerStats`（扩展）

**输入**：`{ action: 'playerStats', playerId, currentSeasonId: 's2026' }`

**输出**：

```js
{
  success: true,
  data: {
    stats: {
      singles: {
        winCount: 12,
        lossCount: 5,
        totalPoints: 285,
        winRate: 0.71              // ✨ 新
      },
      doubles: { /* 同结构 */ }
    },
    currentRank: {                  // ✨ 新
      singles: 2,                   // 当前实时名次（未上榜则 null）
      doubles: 5
    },
    rankHistory: {                  // ✨ 新（最近 12 周快照）
      singles: [
        { weekStart: "2026-02-23", rank: 6 },
        { weekStart: "2026-03-02", rank: 5 },
        // ... 最多 12 条，按 weekStart ASC
      ],
      doubles: [ /* 同结构 */ ]
    },
    weeklySnapshot: {               // ✨ 新（本周到目前为止的增量）
      singles: { pointsDelta: 85, wins: 5, losses: 1 },
      doubles: { pointsDelta: 30, wins: 2, losses: 0 }
    },
    recent: [                       // 沿用结构，前端展示去状态徽章
      {
        _id: "...",
        tournamentId: "...",
        tournamentName: "春季锦标赛",
        tournamentFormat: "knockout", // ✨ 'regular' | 'knockout'（从 tournaments.format join 得到）
        round: 3,
        roundLabel: "SF",            // ✨ 派生字段，规则见下方注
        score: "6-4, 6-2",
        opponentName: "张昊",
        opponentId: "m_xyz",
        won: true,
        pointsAwarded: 20,           // 该玩家这场拿到的积分（从 pointsAwarded.entries 取）
        createTime: Date,
        confirmedAt: Date
      }
    ]
  }
}
```

**实现要点**：

- `winRate` 实时计算：`winCount / (winCount + lossCount)`，0 比赛时 `winRate = 0`
- `currentRank` 复用 `aggregateRanks(无 asOf)` 找该玩家位置
- `rankHistory` 查 `rank_snapshots`：`{ seasonId, type, memberId }`，按 `weekStart DESC` 取 12 条，再反转为 ASC
- `weeklySnapshot` 调用新内部函数 `aggregateWeeklyPlayerDelta`（详 §5.6）

**`roundLabel` 派生规则**：

- `tournamentFormat === 'regular'` → `roundLabel = null`，前端显示「常规赛」徽章（灰底）
- `tournamentFormat === 'knockout'` → 据 `tournament.totalRounds - round` 计算阶段：
  - 决赛 → `"F"`
  - 半决 → `"SF"`
  - 1/4 → `"QF"`
  - 其余 → `"R" + round`（例 R3）
- 前端展示直接用 `roundLabel`；regular 类型用 fallback `"常规赛"` 字串

### 5.5 `points-engine.playerH2H` 🆕

**输入**：`{ action: 'playerH2H', playerId, currentSeasonId: 's2026' }`

**输出**：

```js
{
  success: true,
  data: {
    singles: [
      {
        memberId: "m_opp",
        name: "陈思远",
        avatarUrl: "...",
        wins: 1,                    // 我对他的胜场（本赛季）
        losses: 3,                  // 我对他的负场
        lastPlayedAt: "2026-05-10T..."
      }
    ],
    doubles: []                     // 同结构；空数组表示无双打交手记录
  }
}
```

**算法**：

```
const _ = db.command
matches = await db.collection('match_results')
  .where(_.and([
    { seasonId: currentSeasonId },
    { resultStatus: 'confirmed' },
    { tournamentType: 'singles' /* or 'doubles' */ },
    { playerIds: _.in([playerId]) }
  ])).limit(1000).get()

byOpponent = {}
for m in matches:
  entries = (m.pointsAwarded && m.pointsAwarded.entries) || []
  mine = entries.find(e => e.memberId === playerId)
  if !mine: continue

  opponentIds = resolveOpponentIds(m, playerId, type)
  for opponentId in opponentIds:
    if !byOpponent[opponentId]: byOpponent[opponentId] = { memberId: opponentId, wins: 0, losses: 0, lastPlayedAt: null }
    if mine.role === 'winner': byOpponent[opponentId].wins++
    else if mine.role === 'loser': byOpponent[opponentId].losses++
    byOpponent[opponentId].lastPlayedAt = max(.lastPlayedAt, m.confirmedAt || m.createTime)

# 排序：(wins + losses) DESC
return Object.values(byOpponent).sort((a, b) => (b.wins+b.losses) - (a.wins+a.losses))
```

**`resolveOpponentIds` 规则**：

- 单打：从 `pointsAwarded.entries` 中排除自己，剩下 1 个 memberId 即对手。
- 双打：只有当 `player1/player2` 能明确解析两边队伍（`id + partnerId` 或等价结构）时，取另一边 2 个 memberId 作为对手；不要把搭档算进 H2H。
- 若双打 schema 无法稳定区分搭档与对手，`doubles` 返回空数组并在 `PROGRESS` 标注后续补齐。

**注意**：不要依赖 `loserId`。当前 Phase 8 `match-results/lib/state.confirmOne` 会写 `winnerId`，但不保证写 `loserId`；胜负角色以 `pointsAwarded.entries[].role` 为准。

### 5.6 `aggregateWeeklyPlayerDelta` 内部函数 🆕

**签名**：`aggregateWeeklyPlayerDelta({ db, seasonId, type, playerId, week })`

**`week` 参数**：`{ weekStart, weekEnd }` ISO 日期。

**逻辑**：扫 `match_results` 中 `(playerIds 包含 playerId + tournamentType + seasonId + resultStatus='confirmed' + confirmedAt/createTime 落在 [weekStart, weekEnd])`，从 `pointsAwarded.entries` 找当前 player 的 entry，累加 wins / losses / points 得到 `{ pointsDelta, wins, losses }`。

**用途**：

- `playerStats.weeklySnapshot`（Phase 10-2）
- `weekly-star` 内部计算"本周积分 +N · W-L X-Y"（用于 rank 页每周之星卡副文，Phase 10-1）

**默认 week**：当 weekly-star cron 调用时传上一自然周；当 rank 页 / player-detail 调用时传当前自然周（weekStart = 本周一，weekEnd = 现在）。

### 5.7 `weekly-star`（rank 页 current/fallback + cron 双写）

#### 5.7.1 `weekly-star.current` 🆕

**输入**：`{ action: 'current', seasonId: 's2026', type: 'singles' | 'doubles' }`

**用途**：服务 rank 页每周之星 hero。它必须能区分“本周已有比赛”与“本周空周降级”。

**输出**：

```js
{
  success: true,
  data: {
    mode: "current",                 // 'current' | 'fallback' | 'empty'
    weekStart: "2026-05-11",
    weekEnd: "2026-05-16",
    star: {
      memberId: "m_aaa",
      name: "陈思远",
      avatarUrl: "...",
      pointsDelta: 85,
      wins: 5,
      losses: 1
    },
    subtitle: "本周积分 +85 · W-L 5-1"
  }
}
```

**逻辑**：

1. 扫当前自然周 `match_results` + 当前周 `tournament_points`，按 type 聚合每个 member 的 `{ pointsDelta, wins, losses }`。
2. 若当前周有 confirmed 数据，返回 `mode='current'`，`star` 为当前周积分最高者，subtitle 为 `本周积分 +N · W-L X-Y`。
3. 若当前周无 confirmed 数据，读取最近一条 `weekly_stars`，取当前 type 的 star 返回 `mode='fallback'`，subtitle 固定 `等本周首场`。
4. 若历史 `weekly_stars` 也没有，返回 `mode='empty'`，rank 页隐藏 hero。

保留现有 `weekly-star.latest` 作为历史 weekly star 兼容 action；rank 页 Phase 10-1 改用 `current`。

#### 5.7.2 Cron 双写

**触发**：每周一 00:30（沿用现有 cron 触发器）。

**改动**：

1. 单/双打各调用一次 `aggregateRanks({ asOf: lastWeekEnd })`，遍历时用数组下标派生 `rank = index + 1`
2. **写 `weekly_stars`**：取 top 1 写入（沿用原逻辑）
3. **新写 `rank_snapshots`**：把聚合结果（所有玩家）每人一行写入，`snapshotKind: 'weekly'`，`weekId = ISO week of lastWeekStart`，`effectiveAt = lastWeekEnd`
4. 幂等：使用 `(seasonId, type, weekId, memberId)` 唯一索引做 upsert（同一周重跑不重复）

**手动触发**：保留现有 `compute` action；新增 `recomputeRankSnapshots({ seasonId, weekStart })` 用于补写历史快照，或让 `compute({ includeRankSnapshots: true })` 走同一内部函数。Plan 阶段二选一，但不要引用不存在的旧 `recompute` action。

### 5.8 `members.update`（扩展）

**改动**：

- 接受 `playStyle`（5 选 1 或 null）、`playStyleNote`（string ≤ 50 或 null）
- 校验 playStyle 在枚举内（`['baseliner','serve-volleyer','all-court','counter-puncher','aggressive-baseliner']`）
- 校验 note ≤ 50 字
- 权限：`members.update` 只改当前 OPENID 对应会员；admin 编辑别人继续走 `member-edit` + `members.updateById`，本期不改管理员页。

### 5.9 W0 Baseline 回填脚本

**形态**：一次性脚本（`scripts/backfill-rank-snapshots-W0.js`，本地用 wx-server-sdk 跑或云函数 admin 触发）。

**逻辑**：

```
for type in ['singles', 'doubles']:
  list = aggregateRanks({ seasonId: 's2026', type, pageSize: 1000 })  // 不传 asOf
  now = new Date()
  today = toDateKey(now)
  for (const [index, entry] of list.entries()) {
    upsertRankSnapshot({
      _id: `rs_s2026_baseline_${today}_${type}_${entry.memberId}`,
      seasonId: 's2026',
      weekId: `baseline_${today}`,
      weekStart: today,           // 当前日期作为 weekStart
      weekEnd: today,
      effectiveAt: now,
      type,
      memberId: entry.memberId,
      rank: index + 1,
      totalPoints: entry.totalPoints,
      wins: entry.wins,
      losses: entry.losses,
      snapshotKind: 'baseline',
      computedAt: now
    })
  }
```

**执行时机**：Phase 10-1 部署后立刻跑一次，让首批用户进 rank 页就能看到 trendDelta 计算基础。在没有 weekly 快照时，baseline 作为"上一份快照"被 §5.2 trendDelta 逻辑捡到。后续第一份 weekly snapshot 若 `effectiveAt` 晚于 baseline，会自然替代 baseline 成为最新比较基准。

### 5.10 通用约定

- 权限沿用 v1 §9.2：管理员能编辑别人 / 会员只能编辑自己
- 错误码沿用 v1 §10.2 + v2.1 §4.11：`PERMISSION_DENIED` / `VALIDATION_FAILED` / `INVALID_PAYLOAD` 等
- 所有 action 用现有 `utils/cloud.callFunction` wrapper 调用，前端不裸调 `wx.cloud.callFunction`

---

## 6. 页面与组件

### 6.1 页面清单

| 页面 | 状态 | 备注 |
|---|---|---|
| `pages/rank/index` | ✏️ 改造 | 去冠军 hero / 每周之星可点击 + 副文 / rank-row 5 列 |
| `pages/player-detail/index` | ✏️ 大改 | 三卡 × 2 / 名次 hero 副标 / 折线 / H2H / 最近比赛去状态徽章 |
| `pages/edit-profile/index` | ✏️ 改造 | 加 playStyle 选择 + playStyleNote 输入 |

### 6.2 组件清单

| 组件 | 状态 | 改动 |
|---|---|---|
| `components/rank-row` | ✏️ 改造 | 加 winRate / totalPoints / trendDelta props；wxml 重新布局 5 列 |
| `components/chip-tab` | 沿用 | 无改 |
| `components/skeleton-loader` | 沿用 | 无改 |
| `components/rank-chart` | 🆕 新建 | 纯 SVG 折线；props: `data: [{weekStart, rank}]`、`height`、`color` |
| `components/h2h-row` | 🆕 新建 | props: `playerId / name / avatarUrl / wins / losses`；emit `tap` event 含 playerId |

### 6.3 全局 WXSS

无新增。沿用 visual-revamp stream 已建立的 `tokens.wxss / utilities.wxss / animations.wxss`。

---

## 7. 错误处理

### 7.1 错误信封沿用 v1 §10 + v2.1 §4.11

### 7.2 新增 / 强化错误码

| Code | 场景 | UI 反应 |
|---|---|---|
| `VALIDATION_FAILED` | playStyleNote > 50 字 | toast "备注最多 50 字" |
| `INVALID_PAYLOAD` | playStyle 不在枚举内 | toast "未知打法类型" |
| `NOT_FOUND` | playerId 在 player-detail / playerH2H 找不到 | empty state "球员信息不存在" |
| `NETWORK_ERROR` | 任意接口断网 | toast "网络异常，请重试"（沿用 wrapper） |

### 7.3 数据缺失态

| 场景 | UI 处理 |
|---|---|
| 本赛季无 confirmed 比赛 | rank 页 hero 隐藏；列表全屏 empty state |
| 玩家本赛季未参赛 | player-detail 三卡显示 `0/0` + 胜率 `—` + 积分 `0`；折线 empty；H2H empty |
| 玩家 rank_snapshots 不足 12 周 | 折线显示已有的全部（最少 1 个点）；不足 2 点时 chart 显示"数据不足" |
| 玩家无 playStyle | hero 副标显示 `打法未设置`；不展示 ABOUT 节 |
| 玩家 currentRank null（未上榜） | hero 副标显示 `S2026 · 单打 未上榜 · 双打 未上榜` |

---

## 8. 测试策略

### 8.1 覆盖率目标

- 全局：≥ 85%
- 新函数（`aggregateRanks(asOf)` / `aggregateWeeklyPlayerDelta` / `playerH2H`）：≥ 90%
- 新组件（`rank-chart` / `h2h-row`）：≥ 85% lines / 80% branches

### 8.2 测试层

| 层 | 范围 | 工具 |
|---|---|---|
| 单元 | `aggregateRanks(asOf)` / `aggregateWeeklyPlayerDelta` / `playerH2H` / 各 action 输入校验 | Jest |
| 集成 | `weekly-star` cron 双写 / `members.update` 写入 / W0 回填脚本 | Jest + 云开发模拟器 |
| 组件 | `rank-row` props 渲染 / `rank-chart` SVG 输出 / `h2h-row` tap event | miniprogram-automator |
| E2E | 见 §8.3 | miniprogram-automator |

### 8.3 关键测试用例

**`aggregateRanks(asOf)`**：

- 不传 asOf → 等价旧行为
- 传 asOf = 某历史时点 → 仅聚合该时点前的比赛
- asOf 之后无比赛 → 返回空
- asOf 横跨 confirmedAt / createTime 优先级正确（confirmedAt 优先）
- tournament_points placement 也受 asOf 约束：未来 awardedAt/createTime 的 placement 不进入历史快照
- 同分排序稳定：`totalPoints DESC, wins DESC, losses ASC, memberId ASC`

**`aggregateWeeklyPlayerDelta`**：

- 玩家本周 3 胜 1 负 → `{ pointsDelta: P, wins: 3, losses: 1 }`
- 玩家本周无比赛 → `{ pointsDelta: 0, wins: 0, losses: 0 }`
- 比赛跨周边界（confirmedAt 在周一 00:00） → 归属正确周
- type 过滤正确（singles 不计 doubles 比赛）

**`playerStats` 扩展字段**：

- winRate = winCount / (winCount + lossCount)；分母为 0 时返回 0
- currentRank：未上榜玩家 null；上榜返回数字
- rankHistory：不足 12 周返回已有的全部
- weeklySnapshot：调用 `aggregateWeeklyPlayerDelta` 当前周

**`playerH2H`**：

- 单打 H2H 正确聚合 wins/losses
- 排序按 (wins+losses) DESC
- 同一对手多场聚合到一行
- 无交手记录返回空数组
- type 过滤正确

**`rankList.trendDelta`**：

- 无上周快照 → null
- 上周 #5 → 本周 #3 → +2
- 上周 #3 → 本周 #5 → -2
- 上周 #3 → 本周 #3 → 0
- W0 baseline 作为唯一快照时正确捡到
- baseline 写在周中、随后 weekly snapshot 的 `weekStart` 更早但 `effectiveAt` 更晚时，latest comparison 取 weekly snapshot，不继续卡在 baseline

**`weekly-star` cron 双写**：

- 写入 `weekly_stars` top 1 不变
- 同时写入 `rank_snapshots`：单/双打 × N 人 = 2N 行
- 重复触发同一周（幂等性）：upsert 不重复
- `snapshotKind: 'weekly'`

**`weekly-star.current`**：

- 本周有 confirmed 比赛 → `mode='current'`，返回当前周积分最高者与 `本周积分 +N · W-L X-Y`
- 本周无 confirmed 比赛但有历史 weekly_stars → `mode='fallback'`，返回上周冠军与 `等本周首场`
- 本周和历史都无数据 → `mode='empty'`

**W0 回填脚本**：

- 单跑一次写入所有当前会员的 baseline 行
- `snapshotKind: 'baseline'` 标记正确
- 同一天重跑（误执行）：upsert 幂等，不重复
- 跨日期重跑：产生新的 baseline 行，UI 按 `effectiveAt DESC` 取最近一条作比较基准

**`members.update`（playStyle / playStyleNote）**：

- 5 个枚举值合法
- 第 6 个值 `unknown` → `INVALID_PAYLOAD`
- note > 50 字 → `VALIDATION_FAILED`
- 会员通过 `members.update` 改自己 OK
- admin 编辑别人不走 `members.update`；管理员页继续覆盖 `members.updateById` 既有用例

**组件 `rank-chart`**：

- data 为空 → 显示"数据不足"
- data = 1 点 → 显示单点 + dot
- data = 12 点 → 折线 + 终点 dot + rank 文本
- color prop 控制折线色

**组件 `h2h-row`**：

- tap 触发 event 含 playerId
- wins > losses 时胜率胶囊 lime soft
- losses > wins 时红 soft
- 相等时灰

**E2E 旅程**：

| # | 名称 | 步骤 |
|---|---|---|
| E2E-1 | 会员改打法 → player-detail 立刻看到 | 登录 → mine → edit-profile → 选 baseliner / 填备注 → 提交 → 跳 player-detail → 验证 hero pill 与 ABOUT 节 |
| E2E-2 | 排行榜趋势箭头 | 调用 `recomputeRankSnapshots` 写入 W0 baseline → 录入若干比赛触发实时 rank 变化 → 进 rank 页 → 验证 trendDelta 显示正确（升降数字 + ▲▼ 方向） |
| E2E-3 | 每周之星点击跳转 | rank 页 → tap weekly star hero → 跳对应 player-detail |
| E2E-4 | H2H 点击跳转 | player-detail → tap 某 H2H 行 → 跳对应 player-detail |
| E2E-5 | 空周 hero 降级 | 本周无任何 confirmed 比赛 → rank 页 hero 显示"PREV WEEK · 上周冠军" + 副文"等本周首场" |
| E2E-6 | 全新玩家 | 新创建会员，未打过球 → player-detail 三卡 0/0/0；H2H 空；折线"数据不足"；不崩 |

### 8.4 性能基线

| 接口 | 目标 |
|---|---|
| `points-engine.rankList`（100 人 / 1000 场） | ≤ 400ms |
| `points-engine.playerStats`（含 weeklySnapshot 现算，不含 H2H） | ≤ 600ms |
| `points-engine.playerH2H` 独立 | ≤ 300ms |
| `weekly-star` cron 单次执行（双写 200 行 snapshot） | ≤ 5s |

### 8.5 视觉一致

- rank 页 / player-detail / edit-profile 三页 `grep '#333|#999|linear-gradient(135deg'` = 0
- 三页 `grep 'border-left:\s*[2-9][0-9]*rpx\|border-left:\s*[3-9]px'` = 0（visual-revamp 反 slop 规则）
- 三页全部状态徽章用 `status-tag` 或新 `h2h record` 胶囊；不出现裸 `.tag-confirmed` 等

---

## 9. 实施分期

### 9.1 Phase 10-1（数据基础 + rank 页 + 资料编辑）

**输出**：

1. 新 `rank_snapshots` 集合 + 4 个索引（schema 文档同步）
2. `aggregateRanks` 加 `asOf` 参数（含单测）
3. `aggregateWeeklyPlayerDelta` 新增（含单测）
4. `weekly-star` 改造：新增 `current` action；cron 双写 `weekly_stars` + `rank_snapshots`（含集成测试）
5. W0 回填脚本（`scripts/backfill-rank-snapshots-W0.js`）+ admin 触发 action `recomputeRankSnapshots`
6. `points-engine.rankList` 加 `trendDelta` 字段（含单测）
7. `components/rank-row` 加 winRate / totalPoints / trendDelta props + 5 列 wxml + wxss（含组件测）
8. `pages/rank/index` 改造：去冠军 hero / 每周之星可点击 + 副文显示「本周积分 +N · W-L X-Y」 / 列表 5 列 / 空周规则（含 E2E-2、E2E-3、E2E-5）
9. `members.update` 接受 playStyle / playStyleNote（含单测）
10. `pages/edit-profile/index` 加 playStyle 选择 + playStyleNote 输入（含 E2E-1）
11. `cloudfunctions/DATABASE_SCHEMA.md` 更新

**完成标准**：

- 用户登入即看到 rank 页 5 列布局 + 每周之星可点跳
- W0 回填后即可形成 trend 比较基准；第一次 weekly cron 跑完后，`effectiveAt` 更晚的 weekly snapshot 会接替 baseline 成为比较基准
- 会员能改自己打法

**预估工时**：1.5 周。

### 9.2 Phase 10-2（player-detail 重做 + H2H + 折线）

**输出**：

1. `points-engine.playerStats` 扩展（winRate / currentRank / rankHistory / weeklySnapshot），含单测
2. `points-engine.playerH2H` 新 action（含单测）
3. `components/rank-chart` 新建（SVG 折线，含组件测）
4. `components/h2h-row` 新建（含组件测）
5. `pages/player-detail/index` 大改：
   - hero 加名次副标
   - 单/双打各 3 卡（胜场/总 · 胜率 · 积分）
   - 排名走势区（折线 + tab toggle）
   - H2H 单/双打两 section
   - 最近比赛改造（去状态徽章 + +积分胶囊）
6. 含 E2E-4、E2E-6
7. 兼容性回归：旧 my-match / mine 调用 `playerStats` 不破

**完成标准**：

- 进 player-detail 1 屏内能看到所有核心数据
- 折线 + H2H 都跳转流畅

**预估工时**：1.5 周。

### 9.3 为什么分两期

- Phase 10-1 **独立可发版**：完成后 rank 页和 edit-profile 立刻可用；用户感知到 v2.1 之后的下一步改进
- Phase 10-2 改动集中在 player-detail 一页 + 两个云函数 action，回归面窄；如延后 1 周不阻塞 Phase 10-1 发版
- 数据基建（`rank_snapshots`）在 Phase 10-1 完成后，Phase 10-2 直接复用，**不返工**

---

## 10. 风险与开放问题

### 10.1 已识别风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| W0 baseline 写入后到首次 weekly cron 之间，如果排名未变化则 trendDelta = 0 | UI 看起来"全平"，用户疑惑 | UI 在 trendDelta ∈ {0, null} 时统一显示 `—`；baseline 之后若有比赛导致排名变化，trendDelta 仍可立即体现 |
| 双打 H2H 受 match_results schema 限制（teams 字段如未实施） | 双打 H2H 返回空 | Phase 10-2 实现前先 grep 验证；若不可用，PROGRESS 标注后续补 |
| weeklySnapshot 实时扫每次 +1 次本周比赛查询 | player-detail 加载多一次 IO | 俱乐部规模 < 1000 场/赛季时延迟可接受；Phase 11 如需再 cache |
| `aggregateRanks(asOf)` 改动可能影响 v2.1 已有调用方 | 回归风险 | asOf 为 optional，不传时行为不变；全量 213 测试回归不破即可 |
| edit-profile 当前可能与 visual-revamp stream 改动撞车 | 文件冲突 | 实现前 git log + grep；冲突时合并视觉层，IA 拥有数据流（沿用 Codex Phase 9 P4 边界规则） |

### 10.2 推迟到 Phase 11+ 的事项

- 跨赛季历史折线（>12 周 / 跨年）
- 玩家详情"积分到期日"提示（v1 §13.1 已识别）
- 全员个性化通知 / 推送
- 双打 teams 字段如缺失的补全
- weeklySnapshot 服务端 cache
- rank 页搜索 / 字母索引

### 10.3 开放问题（Plan 阶段或实现时决定）

1. **W0 baseline 多次跑**：同一天重跑 upsert 幂等；跨日期重跑允许产生新的 baseline 行，相当于"重置基准"，UI 按 `effectiveAt DESC` 取最近一条作比较基准。
2. **每周之星 hero 在 tabBar 切换时是否复用数据**：rank/playerDetail 切回时 onShow 重新拉。是否 cache 跨页？建议不 cache，每次新鲜。
3. **playStyle pill 在 player-detail hero 是否可 tap**：本期不做（避免与 H2H 行点击冲突）；如 Phase 11 想做"同打法对比"再说。

---

**END OF SPEC**
