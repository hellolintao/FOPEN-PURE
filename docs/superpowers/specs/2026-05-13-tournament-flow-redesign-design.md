# Phase 7+8 · 赛事创建/排程/录分流程重做 · 设计规范

**日期**：2026-05-13
**作者**：xiaole.liao + AI 协作（superpowers:brainstorming）
**状态**：草案 v1.1 → 已按 2026-05-14 plan review 修订
**前置文件**：
- `docs/superpowers/specs/2026-05-11-tennis-club-miniprogram-design.md`（v1 总规范）
- `docs/superpowers/plans/PROGRESS.md`（执行日志，含本规范审查记录）

---

## 1. 摘要

现有的 5 步创建（基本信息 → 20min 时段格子 → 积分胜负 → 选手 → 确认）+ 按轮次展示的对阵页，与俱乐部实际使用习惯有偏差。本规范定义两期改造（**Phase 7 创建+排程** / **Phase 8 录分+积分引擎**）以对齐用户提供的截图设计。

### 1.1 业务目标

- 管理员在 4 步以内（含排程）完成赛事创建
- 排程页按场地维度展示，支持手动调整顺序、添加场次、自由拉球
- 比分录入一页搞定整个赛事，任意会员可录、管理员一键确认
- 积分按"名次"（单淘汰）或"胜负"（常规赛）结算，含完整改分回滚

### 1.2 非目标

- 不做后续轮次自动排程（半决/决赛在第一版只显灰色占位）
- 不做最大场次封顶展示（截图里的"2/3 场"舍弃）
- 不做时段级精确开始时间（每场比赛只维护场地内顺序）
- 不做混双 / 双淘汰 / 循环赛 / 小组+淘汰
- 不做拖拽"真拖"交互（第一版用 actionsheet 改场地 + 上下箭头改顺序）
- 不做提交历史 / 撤回 / 双方对账状态机

---

## 2. 数据模型变更

### 2.1 `tournaments`（替换 `courtTimeGrid`，新 `pointsRules`）

```js
{
  // 不变：_id, seasonId, name, location, startDate, endDate,
  //       status, description, createTime, updateTime
  createdBy, createdByOpenid,             // draft 恢复入口权限；status='draft' 必填

  type: 'singles' | 'doubles',          // 精简，只剩两种
  format: 'knockout' | 'regular',        // 精简，只剩两种
  maxPlayers: 8 | null,                  // 单淘汰必填；常规赛 null

  // 弃用：courtTimeGrid: { matchDuration, courts, slots }
  schedulePlan: {
    slotMinutes: 30,                     // 固定 30
    courts: [
      { courtId, name, location,
        slots: ['2026-05-25T19:00', '2026-05-25T19:30', ...]  // 30min 锚点列表
      }
    ],
    queues: [                            // 排程结果：每场地一队
      {
        courtId: 'c1',
        items: [
          { kind: 'match',    matchId: 'm_xxx', order: 0 },
          { kind: 'match',    matchId: 'm_yyy', order: 1 },
          { kind: 'freePlay', freePlayId: 'fp_zzz', order: 2 }
        ]
      }
    ]
  },

  pointsRules: {
    // 两套并存，落库时按 format 取用其中之一
    winLoss:   { win: 20, loss: 10, walkover: 0 },
    placement: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 }
  }
}
```

### 2.2 `match_results`（由 `match-results` 云函数维护，统一 `pointsAwarded` 结构）

```js
{
  // 不变：tournamentId, winnerId, loserId, winnerName, loserName,
  //       playerIds, createTime

  // 新增冗余字段（写入时由 match-results 云函数从 tournament 读取拷贝）：
  seasonId,                 // tournament.seasonId 的冗余，供排行榜按赛季过滤
  tournamentType,           // tournament.type ('singles' | 'doubles')，供排行榜按类别过滤

  matchKind: 'bracket' | 'regularRound' | 'extra',  // 自由拉球不进此表
  sourceMatchId,             // bracket matchId / regular matchId / extra matchId，用于和排程队列对齐
  round, position,            // bracket 推进 / 改分回滚必须依赖真实 position
  courtId, queueOrder,       // 来自 schedulePlan.queues，后续轮未排程时可为 null
  player1, player2,          // 对阵双方；双打时一方是一支 team（含 partnerId/partnerName/teamName）
  score: { sets: [{ a: 4, b: 2 }], tiebreak: '7-5' | null },
  resultStatus: 'pending' | 'submitted' | 'confirmed',  // 简化掉 disputed
  confirmedBy: 'memberId' | null,
  confirmedAt: Date | null,
  pointsAwarded: {
    source: 'match',
    entries: [
      { memberId: 'm_xxx', points: 20, role: 'winner' },
      { memberId: 'm_yyy', points: 10, role: 'loser' }
    ]
  }
  // 不留 submissionHistory / submittedBy（删旧字段）
}
```

数据库集合名固定使用 `match_results`（下划线）；云函数目录 / action 调用名仍是 `match-results`（短横线）。双打时 `pointsAwarded.entries` 包含 4 条（胜方 2 人 × win，负方 2 人 × loss）。

双打对阵中的 `player1/player2` 表示两支队伍（来自 `tournament_registrations` 的一条 registration），结构沿用：
```js
{ id, name, partnerId, partnerName, teamName, registrationId }
```
同时冗余扁平 `playerIds`：
```js
playerIds: ['m_a', 'm_b', 'm_c', 'm_d']
```
用于 `my-match` 查询、录分权限判断和积分 entries 展开。单打 `playerIds` 为 2 人。

单淘汰保存 R1 时，必须同步为 R2+ skeleton bracket 创建 `match_results` 占位行：`player1/player2=null`、`courtId/queueOrder=null`、`resultStatus='pending'`。确认首轮并推进 bracket slot 时，同步更新下一轮占位 result 行的 `player1/player2/playerIds`，否则半决/决赛无法进入录分页。

### 2.3 `tournament_brackets`（BYE 字段 + 排程引用）

```js
matches: [
  {
    matchId, position, status, resultStatus, winner,
    player1: { id, name } | null,                          // null = TBD（后续轮未填）
    player2: { id, name } | { id: 'BYE', name: 'BYE' } | null,
    bye: false | true,
    courtId, queueOrder       // 替代旧 scheduledStart/scheduledSlotId
  }
]
```

### 2.4 新增集合

#### `free_plays`

```js
{
  _id, tournamentId, courtId, queueOrder,
  playerIds: [...],          // 单打 2 / 双打 4；不限定是 tournament 报名者
  createdBy, createTime
}
```

索引：`(tournamentId, courtId, queueOrder)`。不参与积分；不进待确认队列；级联删除（赛事 status='cancelled' 时）。

#### `courts`

```js
{
  _id,
  courtId,                  // 可与 _id 相同；前端 schedulePlan.courts 引用它
  name,
  location,
  enabled: true,
  createTime,
  updateTime
}
```

云函数 `courts` 至少支持 `list / create / update`。`+ 新增场地` 写入本集合，后续赛事复用。

#### `tournament_points`（赛事级 placement 积分）

```js
{
  _id: `${tournamentId}_${memberId}_placement`,    // 幂等键
  tournamentId, memberId,
  seasonId,                 // 冗余，供排行榜按赛季过滤
  tournamentType,           // 冗余，供按类别过滤
  points: 100,
  rank: 'champion' | 'runnerUp' | 'semifinal' | 'quarterfinal' | 'participation',
  awardedAt: Date,
  createTime: Date,          // 用于分页聚合游标
  updateTime: Date
}
```

`set` 写入（upsert 覆盖），重算安全。

### 2.5 字段切换 / 旧数据

**采用清库策略**（旧数据是测试数据）。不保留兼容读路径。

`scripts/cleanup-test-data.js`（手动跑，双重确认）：
```js
if (process.env.FOPEN_CLEANUP_CONFIRM !== process.env.FOPEN_CLOUD_ENV) {
  console.error('请设置 FOPEN_CLEANUP_CONFIRM=<envId> 且必须等于 FOPEN_CLOUD_ENV')
  process.exit(1)
}
console.log(`>>> 即将清空 cloud env: ${process.env.FOPEN_CLOUD_ENV}`)
console.log(`>>> 集合：tournaments / tournament_brackets / tournament_registrations / match_results / tournament_points / free_plays`)
console.log(`>>> 5 秒后开始，Ctrl-C 取消...`)
await sleep(5000)
```

清库同时需要同步更新 `cloudfunctions/DATABASE_SCHEMA.md`：删除 `courtTimeGrid` 作为新流程依赖，新增 `schedulePlan / free_plays / tournament_points / courts / match_results.position` 描述。

---

## 3. 创建流程（Phase 7, step 1–4 wizard）

页面：`pages/tournament-edit/index`（重写）。顶部固定步条 `①—②—③—④`，底部固定 `上一步 / 下一步`。

### 3.1 Step 1 · 基本信息

| 字段 | 类型 | 说明 |
|---|---|---|
| 赛事名称 * | input | |
| 地点 * | input | "球场名称" |
| 比赛日期 * | date picker | 单日 |
| 赛制 * | 2-chip 单选 | 单淘汰 / 常规赛 |
| 类别 * | 2-chip 单选 | 单打 / 双打 |
| 最大参赛人数 | number | 仅单淘汰显示，默认 8 |
| 描述 | textarea | 选填 |

校验：必填项缺时下一步置灰。赛季自动归当年自然年（隐式，不让用户选）。

### 3.2 Step 2 · 球员与球场

两块卡片同屏：

**球员**：右上 `0/{{maxPlayers}}`（单淘汰）或 `已选 X 人`（常规赛无上限）。空态 "尚未选择球员"。`+ 添加球员` 跳 `tournament-add-player` / `tournament-add-players-doubles`（沿用现有页，套新视觉）。已选玩家以横向胶囊列出（点 ✕ 移除）。

**球场与时间**：列表展示俱乐部全部球场（`name + location`），多选。选中后该行下方展开 30min 锚点格子 — 默认当天 08:00–22:00（28 格，4 列 × 7 行），点格切换可用。底部 `+ 新增场地` 弹层 `球场名 / 场馆地点`，落到新增 `courts` 集合（备复用）。右上"已选 X"指已选场地数。

进度阀：≥ 1 球员 + ≥ 1 球场（含 ≥ 1 slot）→ 可继续。

### 3.3 Step 3 · 排程

详见 §4。

### 3.4 Step 4 · 积分设置

按 format 切换面板：

| 单淘汰（placement） | 默认 | 常规赛（winLoss） | 默认 |
|---|---|---|---|
| 冠军 | 100 | 胜场 | 20 |
| 亚军 | 70  | 负场 | 10 |
| 四强 | 50  |  |  |
| 八强 | 30  |  |  |
| 参赛 | 10  |  |  |

右上 `使用历史设置` → 拉同 format + 同 type 最近一场的 `pointsRules` 填入。

下方 **赛事概览**（只读卡）：名称 / 日期 / 类别 / 参赛人数 / 球场数 / 赛制。最底 `创建赛事` CTA → 提交 step 4 数据，状态 `draft → upcoming`。

### 3.5 持久化顺序（草稿即落库）

```
Step 1 「下一步」 → tournaments.create({ status: 'draft', ...step1 }) → 写 createdBy → 拿到 tournamentId
Step 2 「下一步」 → tournaments.update(tournamentId, { schedulePlan.courts/slots })
                  + tournament-registrations.bulkSet(tournamentId, playerIds)
Step 3 「下一步」 → tournament-brackets.saveInitialMatches({ tournamentId, matches })
                  + tournament-brackets.saveSchedule({ tournamentId, queues })
                  + match-results.bulkUpsertScheduledMatches({ tournamentId, matches, queues })
                  + free-plays.bulkSet({ tournamentId, items })  // 如果有；整体覆盖该赛事自由拉球
Step 4 「创建赛事」 → tournaments.update(tournamentId, { pointsRules, status: 'upcoming' })
```

`status='draft'` 赛事不进任何列表（home/rank/manage/my-match/tournament-manage 全过滤），仅 `createdBy` 对应的创建者本人可见草稿入口（继续 wizard）。回退 step 2 改选手时弹警告"已生成的对阵将重置"，确认后清空本赛事 `tournament_brackets / match_results / free_plays` 草稿排程数据，再回到 step 3 重新生成。

---

## 4. 首轮排程页（Phase 7 step 3，核心）

页面：嵌在 wizard step 3，复用 `pages/tournament-edit` 容器。组件化为新 `<schedule-board>`。

### 4.1 进入页面时

1. 从 step 1+2 拿到 `format / type / playerIds / schedulePlan.courts`
2. 前端跑 `generateFirstRound(format, type, playerIds)`：
   - 单淘汰：补齐到 ≥ N 的最近 2 的幂；按选手添加顺序随机洗牌；两两配对；多出位置打 `bye: true`（BYE 玩家不进排程）
   - 常规赛：奇数加 1 个虚位 → 随机两两配对（首轮每人一场）
3. 跑 `assignToCourts(matches, courts)`：**顺序填满场地**（court[0] 填满到容量再到 court[1]...），每 30min slot = 1 场比赛
4. setData 渲染，不写后端
5. 用户在 step 3 内编辑（拖顺序/换场地/换人/加自由拉球/加场次），点"下一步"时一次性 `saveSchedule` 落库

> 关键约束：Step 3 保存时以后端校验 + 落库为主，不再二次随机生成对阵。前端传入最终 `matches + queues`；后端只校验参赛者、BYE、场地容量、重复选手和 matchId 一致性，避免保存阶段生成出与用户看到的排程不同的签表。

### 4.2 视觉结构

```
┌─ 场地日程表排程（首轮） ─────────────────┐
│ [ 重新随机安排 ]                        │
│ 每 30min = 1 场比赛。选手名可点切换；    │
│ 长按 ⋮⋮ 调顺序或换场地。                │
│                                          │
│ 3号场 · 19:00–21:00                     │
│   ┌────────────────────────────────┐    │
│   │ ⋮⋮ 明远  VS  思琪          ✕ │    │
│   │ ⋮⋮ 伟哥  VS  海涛          ✕ │    │
│   │ ⋮⋮ 子轩  VS  小婷          ✕ │    │
│   │ ⋮⋮ 刘洋  VS  天明          ✕ │    │
│   └────────────────────────────────┘    │
│   [ + 自由拉球 ]    [ + 添加场次 ]      │  ← 两按钮同排各 50%
│                                          │
│ 2号场 · 19:30–20:30                     │
│   …                                      │
└──────────────────────────────────────────┘
```

后续轮次不展示（与截图差异，按用户决策"不需要安排后续轮次"）。

### 4.3 交互行为

| 交互 | 实现 |
|---|---|
| 调顺序 | 长按 ⋮⋮ → actionsheet `上移 / 下移 / 移到其他场地`（第一版不做真拖） |
| 换场地 | actionsheet 选目标 court → 落到该 court 队列末尾 |
| 换人 | 点选手名 → 弹 `<player-picker-sheet>` 选另一玩家 |
| 删除 | ✕ → bracket 场次不可删（按钮置灰）；自由拉球/添加场次可删 |
| 重新随机 | 顶部 `重新随机安排` 按钮 → 弹确认 → 重跑 §4.1，丢弃手动调整 |
| `+ 自由拉球` | 弹层选 2/4 人（不限俱乐部任何会员） → 插当前 court 队列末尾，只写 `free_plays` |
| `+ 添加场次` | 仅常规赛可点；弹层选 2/4 人（须在 playerIds 内）→ 插当前 court 队列末尾，保存时写 `match_results.matchKind='extra'` |
| 保存 | step 3 → step 4 切换时落库 |

选择器统一使用 `requiredCount` 表达选择数量：换人 `requiredCount=1`；单打自由拉球/添加场次 `requiredCount=2`；双打自由拉球/添加场次 `requiredCount=4`。双打对阵存储按“队伍 vs 队伍”，但弹层交互仍按 4 位会员选人；保存前组装成 `player1/player2` 两个 team 对象，并冗余 flattened `playerIds`。

### 4.4 选手切换范围

| 场景 | 可选范围 |
|---|---|
| 单淘汰 bracket 场次 | 该赛事另一已选玩家（互换位置，保持 bracket 完整） |
| 常规赛场次 | 任意参赛玩家 |
| 自由拉球 / 添加场次 | 任意俱乐部会员 |

### 4.5 单淘汰后续轮次

不进入排程。决赛结果回填后由管理员手动在 `tournament-brackets` 页排（不在本 phase 范围）。Phase 7 仅交付首轮闭环。

### 4.6 边界

- 球员奇数 / BYE → 内联提示但不阻断；无可用 court slot 时停留在 step 2，继续按钮置灰
- 一个场地连续 slot 头部展示 `19:00–21:00`（首尾合并），不连续段以"+"拼

---

## 5. 比分录入（Phase 8，赛事维度）

页面：`pages/tournament-score/index`（**复用现有路径，内容重写**）。

### 5.1 入口与协议

| 入口 | 来源 |
|---|---|
| `tournament-detail` "录入比分" | 协议 `{ tournamentId }`（去掉旧 `round` 参数） |
| `manage` "待确认比分"队列 | 同上 |
| `my-match` "可录分比赛" | 同上（含 matchId 锚点） |

`tournament-score` 拉场次优先调用 `match-results.listByTournament({ tournamentId })`，统一返回 `{ success, data: { results } }`；旧 `list` action 保留兼容但不作为新页面主协议。

### 5.2 权限模型

| 角色 | 录分（pending → submitted） | 修改 submitted | 一键确认 | 修改 confirmed |
|---|---|---|---|---|
| 已登录会员 | ✅ 任意场次 | ✅ 任意（覆盖上次） | ❌ | ❌ |
| 管理员 | ✅ | ✅ | ✅ 一次确认全部 submitted | ✅ 立即生效（含二次确认） |

未登录用户禁入。

普通会员只能提交 `pending/submitted` 行；`confirmed` 行只能由管理员通过二次确认改分入口处理，不能被普通提交覆盖回 `submitted`。

### 5.3 状态机

```
pending  ──任何已登录会员录入──▶  submitted
submitted ──任何会员覆盖──▶  submitted （旧 submission 直接丢，无 history）
submitted ──admin "确认全部"──▶  confirmed  +  写 pointsAwarded
confirmed ──admin 修改并保存(含二次确认)──▶  confirmed（覆盖 entries；winner 翻盘时清后续 bracket + placement）
```

### 5.4 页面结构

- 头部：赛事名 + `已确认 X / 全部 Y` 进度条
- 规则提示：`4 局制 · 3:3 抢七 · 4:0/4:1/4:2 直接结束`
- 场次列表（按 round 分组）：
  - 行折叠态：`轮次标签 · 选手A VS 选手B · 当前比分 · 状态 chip`
  - 点行 → 内联展开 stepper + 抢七输入 + 提交按钮
  - 状态 chip：`待录入 / 待确认 / 已确认 / 未开打`
- 管理员底栏 sticky：`✓ 确认全部待确认（N 场）`；N=0 时置灰

### 5.5 规则引擎

`validateScore(a, b, tiebreak)` → `{ valid, winner, error }`：

```
max(a, b) < 4                                  → invalid（场未结束）
max(a, b) === 4 && |a - b| >= 2                → valid，winner = 局数高方        # 4:0 / 4:1 / 4:2
a === 3 && b === 3:
    tiebreak 解析 "x-y"，要求 x,y ≥ 0, |x-y| ≥ 2, max(x,y) ≥ 7
        valid，winner = tiebreak 赢家；赢家局数补成 4（即 4:3）
    否则 invalid
其他（4:3 / 4:4 直接录入等）                    → invalid
```

UI 约束：
- stepper 0–4，超界置灰
- 仅 3:3 时抢七输入框激活
- 不允许直接录 4:3（必须经 3:3 抢七）

### 5.6 数据落库

```js
score: { sets: [{ a: 4, b: 2 }], tiebreak: null }
score: { sets: [{ a: 4, b: 3 }], tiebreak: '7-5' }    // 3:3 抢七后
```

### 5.7 特殊场次

- `matchKind === 'extra'`（常规赛额外场次）：同常规赛同等对待
- `matchKind === 'freePlay'`：不进录分页（自由拉球无结果）
- `bracket && bye === true`：自动 `confirmed`，winner=player1，不调录分；`pointsAwarded.entries = []`

---

## 6. 积分引擎（Phase 8）

### 6.1 架构边界

```
cloudfunctions/
├── _shared/
│   └── award.js              // 源 lib（不入云函数包）
├── points-engine/
│   ├── lib/award.js          // ← vendored copy of _shared/award.js
│   ├── lib/aggregate.js      // 分页聚合
│   └── index.js              // actions: recompute / rankAggregate
│                              // 兼容 wrapper：rankList / playerStats / recalculateMatch
├── match-results/
│   ├── lib/
│   │   ├── award.js          // ← vendored copy of _shared/award.js
│   │   ├── state.js          // 状态机 + 改分回滚编排
│   │   └── score-rule.js     // 4 局 + 3:3 抢七（前端组件也复制一份）
│   └── index.js              // 在 confirm 事务内直接 require('./lib/...')
└── tournament-brackets/
    └── lib/
        ├── generator.js        // 含 BYE + 推进公式
        ├── scheduler.js        // 顺序填满场地
        └── pairing/
            ├── round-robin.js  // 从 scheduler-engine 迁过来
            └── knockout-bracket.js
```

`scripts/sync-shared-libs.sh` 在 pre-commit + CI 跑 hash 比对，保证 `_shared/award.js` 与 vendored 副本一致。

### 6.2 常规赛结算（增量）

```js
async function onConfirm(match, ruleWinLoss):
  const entries = buildAwardEntries(match, ruleWinLoss, tournament.type)  // 双打展开为 4 条
  await db.collection('match_results').doc(matchId).update({
    pointsAwarded: { source: 'match', entries },           // 先清空（update 直接覆盖整对象）
    resultStatus: 'confirmed', confirmedBy, confirmedAt
  })
```

幂等：再次 confirm（管理员改分）→ `update` 直接覆盖整个 `pointsAwarded` 对象，不会累积。

### 6.3 单淘汰 bracket 推进

**推进公式**（不依赖 `nextRoundMatches`）：

```js
function advance(match):
  if (match.round === finalRound) return
  const nextPosition = Math.ceil(match.position / 2)
  const nextSlot = match.position % 2 === 1 ? 'player1' : 'player2'
  await db.collection('tournament_brackets')
    .where({ tournamentId, round: match.round + 1 })
    .doc(...).update({ [`matches.${idx}.${nextSlot}`]: match.winner })
```

**BYE 自动晋级**（保存初始 bracket 时立即处理）：

```js
function saveInitialMatches(matches):
  for (match of round1Matches where player2.id === 'BYE'):
    match.winner = match.player1
    match.status = 'walkover'
    match.resultStatus = 'confirmed'
    advance(match)
```

BYE 场次不进排程、不进录分页、`pointsAwarded.entries === []`。

### 6.4 单淘汰 placement 结算

```js
// 决赛 confirm 时触发
if (match.isFinal && match.resultStatus === 'confirmed'):
  const entries = buildPlacementEntries(brackets, tournament.pointsRules.placement)
  await Promise.all(entries.map(e =>
    db.collection('tournament_points')
      .doc(`${tournamentId}_${e.memberId}_placement`)
      .set({
        tournamentId,
        memberId: e.memberId,
        seasonId: tournament.seasonId,
        tournamentType: tournament.type,
        points: e.points,
        rank: e.rank,
        awardedAt,
        createTime: awardedAt,
        updateTime: awardedAt
      })
  ))
```

**名次桶规则**（由 bracket 实际深度决定）：

| Round | 桶 |
|---|---|
| finalRound 胜者 | `champion` |
| finalRound 败者 | `runnerUp` |
| finalRound - 1 败者 | `semifinal` |
| finalRound - 2 败者（仅 bracket ≥ 8 槽） | `quarterfinal` |
| 更早出局 | `participation` |

例：
- 4 人 → 4 槽 / finalRound=2 / 无 QF 桶
- 6 人 → 8 槽 / finalRound=3 / 真实 R1 败者 = quarterfinal、R2 败者 = semifinal、无 participation
- 12 人 → 16 槽 / finalRound=4 / R1 败者 = participation、R2 败者 = quarterfinal、R3 败者 = semifinal

### 6.5 改分回滚

```js
async function reconfirmMatch(matchId, newScore):
  const oldMatch = await get(matchId)           // 读旧快照
  const oldWinner = oldMatch.winner
  
  if (oldMatch.matchKind === 'bracket'):
    const newWinner = computeWinner(newScore)
    if (oldWinner?.id !== newWinner?.id):
      await clearDownstream(tournamentId, oldMatch)              // 清后续轮 winner / pointsAwarded
      await db.collection('tournament_points')
        .where({ tournamentId }).remove()                         // 整赛事 placement 全删
      await db.collection('tournaments').doc(tournamentId).update({ status: 'ongoing' })
  
  await writeNewResult(matchId, newScore)                          // 覆盖 entries
  if (match.isFinal && allBracketConfirmed):
    await awardPlacement(tournamentId)
```

排行榜实时聚合 `pointsAwarded.entries + tournament_points` → 不维护余额表，删除/覆盖结算记录就够。

### 6.6 排行榜分页聚合

`points-engine.rankAggregate({ seasonId, type, pageSize = 100 })`：

```js
async function rankAggregate({ seasonId, type, pageSize = 100 }):
  const acc = new Map()
  let last = null
  while (true):
    // 微信云数据库无原生 cursor，用 where + orderBy 模拟（createTime, _id 复合游标）
    const cursorFilter = last
      ? db.command.or(
          { createTime: db.command.gt(last.createTime) },
          { createTime: last.createTime, _id: db.command.gt(last._id) }
        )
      : {}
    const page = await db.collection('match_results')
      .where({ seasonId, resultStatus: 'confirmed', tournamentType: type, ...cursorFilter })
      .orderBy('createTime', 'asc').orderBy('_id', 'asc')
      .limit(pageSize).get()
    for (m of page) for (e of m.pointsAwarded.entries):
      acc.set(e.memberId, (acc.get(e.memberId) || 0) + e.points)
    if (page.length < pageSize) break
    last = { createTime: page[page.length-1].createTime, _id: page[page.length-1]._id }
  
  // 再分页拉 tournament_points 同样累加
  
  return [...acc.entries()].sort((a,b) => b[1] - a[1])
```

稳定排序键 `(createTime ASC, _id ASC)` 保证翻页无重复无遗漏。

### 6.7 兼容包装

`points-engine` 旧 actions `rankList / playerStats / recalculateMatch` 保留为 wrapper，内部转调新 lib。`home / rank / player-detail` 不需要立即改调用点；逐步迁移后 deprecate。

---

## 7. 路由、页面与入口

### 7.1 页面变化

| 路径 | 操作 |
|---|---|
| `pages/tournament-edit/index` | 重写为 4 步 wizard |
| `pages/tournament-brackets/index` | 重写为按场地维度展示首轮 + 灰色后续轮占位 |
| `pages/tournament-score/index` | **内容重写**（路径不变），按赛事维度展示所有场次；`onLoad` 协议改为 `{ tournamentId }` |
| `pages/tournament-detail/index` | 微改：`onEnterScore` 改传 `tournamentId` |
| `pages/tournament-view/index` | 微改：按场地视图（只读） |
| `pages/manage/index` | 微改：新增"待确认比分"队列（来源见 §7.5） |
| `pages/my-match/index` | 微改：下半部分新增"可录分比赛"行（来源见 §7.5） |

不新建 `pages/score-entry/index`（避免与 `tournament-score` 双入口）。

### 7.2 组件

| 组件 | 操作 |
|---|---|
| `components/court-grid/` | 重写为 30min 颗粒度多选格 |
| `components/schedule-board/` | 🆕 排程页主体 |
| `components/score-row/` | 🆕 比分行（折叠态 + 内联编辑器） |
| `components/player-picker-sheet/` | 🆕 选手切换 sheet |

### 7.3 云函数

| 函数 | 操作 |
|---|---|
| `tournaments` | 改 `create` 支持 `status: 'draft'`；改字段 `schedulePlan` 替换 `courtTimeGrid`；新 `pointsRules` 双子树结构 |
| `courts` | 🆕 `list / create / update`，供 Step 2 选择与新增场地 |
| `tournament-registrations` | 新增 `bulkSet(tournamentId, playerIds)` |
| `tournament-brackets` | 新 `saveInitialMatches`（保存前端最终 matches，不再二次随机）/ `saveSchedule / regenerateDraft`；改 `generate` 为兼容 wrapper；旧 actions（`add/update/getByTournament/getByRound/updateMatchScore/updateMatchStatus`）保留兼容老前端调用 |
| `match-results` | 新 `bulkUpsertScheduledMatches / listByTournament / listByPlayer`；改 confirm 编排：读旧 → 比对 winner → 推进 bracket + 下一轮 result 占位行 → require 本地 `lib/award` 写 entries；新 `confirmAll(tournamentId)` |
| `points-engine` | 新增 `recompute / rankAggregate`；保留 `rankList / playerStats / recalculateMatch` 兼容 wrapper |
| `scheduler-engine` | **不删，标 @deprecated**；保留 44 单测；其中算法迁到 `tournament-brackets/lib/pairing/` |
| `free-plays` | 🆕 `bulkSet / create / list({ tournamentId }) / remove(id)` |

`match-results.bulkUpsertScheduledMatches` 落库规则：
- 输入为 Step 3 最终 `matches + queues`，先按 `sourceMatchId` 幂等 upsert。
- 为 bracket / regularRound / extra 创建或更新 `match_results` 行，写入 `seasonId / tournamentType / matchKind / sourceMatchId / round / position / player1 / player2 / playerIds / courtId / queueOrder / resultStatus='pending'`。
- R2+ skeleton bracket 也要创建占位 `match_results` 行，`player1/player2/courtId/queueOrder` 可为 null，用于录分页显示“未开打”和后续推进更新。
- BYE 场次写 `resultStatus='confirmed'`、`winner=player1`、`pointsAwarded.entries=[]`，但不进入排程队列和录分页。
- 对本赛事 draft 中已存在但本次 payload 不再出现的 `match_results` 行做删除，避免回退 step 2 后残留旧场次。
- 不处理 `free_plays`；自由拉球由 `free-plays.bulkSet` 整体覆盖。

### 7.4 跨云函数代码共享

微信云函数按单目录打包 → 兄弟目录不可见。

采用 **vendored 复制**：
- 源：`cloudfunctions/_shared/award.js`（不入任何云函数包）
- 副本：`cloudfunctions/match-results/lib/award.js` + `cloudfunctions/points-engine/lib/award.js`
- 同步：`scripts/sync-shared-libs.sh` 在 pre-commit + CI 跑 hash 比对，不一致就 fail。前端 mirror（`bracket-generator.js / scheduler-mirror.js / score-rule.js`）若参与 hash 比对，必须 CommonJS 原样复制，不做 ES module 改写。

不引入 npm workspaces / link。

### 7.5 manage 与 my-match 数据源

**manage "待确认比分"**（仅 admin），新 `match-results` action `submittedQueue`：
```js
// 云函数内分页拉 + JS 端 reduce（微信云数据库无 groupBy）
async function submittedQueue():
  const rows = await pagedFetch('match_results', { resultStatus: 'submitted' }, pageSize=100)
  const grouped = rows.reduce((acc, m) => {
    acc[m.tournamentId] = (acc[m.tournamentId] || 0) + 1
    return acc
  }, {})
  return Object.entries(grouped).map(([tid, count]) => ({ tournamentId: tid, submittedCount: count }))
// 前端再批量 fetch tournament name 拼显示
```

**my-match "可录分比赛"**：
- 数据源：`match_results.where({ playerIds: db.command.in([myId]), resultStatus: db.command.neq('confirmed') })`
- 双打因 playerIds 是数组形式，自然涵盖 partnerId
- 每行：赛事名 · 对手 · 状态 chip · 跳转

### 7.6 BYE / TBD 状态约束

```js
{
  status: 'walkover' | 'pending' | 'ongoing' | 'completed',
  resultStatus: 'confirmed' (walkover) | 'pending' | 'submitted' | 'confirmed',
  player1: { id, name } | null,
  player2: { id, name } | { id: 'BYE', name: 'BYE' } | null,
  bye: false | true,
  winner: { id, name } | null,
  pointsAwarded: { source, entries: [] }
}
```

bracket validator 放宽：允许 `player2.id === 'BYE'` 与 `null`。录分页约束：
- `player1 === null || player2 === null` → 整行 disabled "未开打"
- `bye === true` → 整行 disabled "轮空 · 自动晋级"
- 其余按 §5 流程

### 7.7 跳转图

```
[tournament-manage 列表]
   │  + 创建
   ▼
[tournament-edit 4 步 wizard]
   │  每步 → 草稿落库（tournamentId 即取即用）
   ▼
[tournament-detail]
   ├─ 编辑 ─────────▶ [tournament-edit 续 draft]
   ├─ 排程调整 ─────▶ [tournament-brackets 重写]
   ├─ 录入比分 ─────▶ [tournament-score 重写] ◀── [manage 待确认队列]
   └─ 只读查看 ─────▶ [tournament-view]      ◀── [my-match 可录分行]
```

---

## 8. 测试策略

### 8.1 覆盖目标

| 模块 | 目标 | 工具 |
|---|---|---|
| `tournament-brackets/lib/generator.js`（BYE + 推进公式） | 95% | Jest |
| `tournament-brackets/lib/scheduler.js`（顺序填满场地） | 95% | Jest |
| `match-results/lib/score-rule.js`（4 局 + 3:3 抢七） | 100% | Jest |
| `_shared/award.js`（积分计算 + entries 展开） | 95% | Jest |
| `match-results/lib/state.js`（状态机 + 改分回滚） | 90% | Jest |
| `points-engine/lib/aggregate.js`（分页聚合） | 90% | Jest |
| 其余 lib / 前端组件 | 80%（项目基线） | Jest / miniprogram-automator |

### 8.2 关键单元用例

**bracket 生成**：
- 4 / 8 / 16 人 → BYE 数 = 0
- 6 人 → 8 槽 / 2 BYE / 2 场 walkover 自动 confirmed，winner=player1，已推进
- 12 人 → 16 槽 / 4 BYE，**只测**：BYE 数、自动推进、无空 winner（不测分散，与 §9.2 一致）
- **0 / 1 人** → 抛 `INSUFFICIENT_PLAYERS`
- **2 人** → 1 场决赛，无 BYE，finalRound=1

**推进公式**：
- R1 位置 1 → R2 位置 1 player1
- R1 位置 2 → R2 位置 1 player2
- R1 位置 3 → R2 位置 2 player1
- R1 位置 8 → R2 位置 4 player2
- 决赛 → 不推进

**scheduler（顺序填满）**：
- 4 场 / 3 场地容量 2/2/2 → court[0]=2, court[1]=2, court[2]=0
- 4 场 / 3 场地容量 1/2/3 → court[0]=1, court[1]=2, court[2]=1
- 5 场 / 3 场地容量 1/1/1 → 2 场溢出 + 警告
- 0 场地 → 全部溢出
- 0 场比赛 → 全部空 queue

**score-rule**：
- 4:0 / 4:1 / 4:2 valid
- 4:3 直接录 → invalid
- 3:3 + tb "7-5" → valid，winner=a，落库 `{sets:[{a:4,b:3}], tiebreak:'7-5'}`
- 3:3 + tb "6-4" → invalid（max<7）
- 3:3 + tb "8-7" → invalid（差<2）
- 3:3 无 tb → invalid

**award.js**：
- 单打常规赛胜 → entries 2 条
- 双打常规赛胜 → entries 4 条（2 win + 2 loss）
- placement champion → entries 1 条 points = champion 分
- N=4 placement 无 quarterfinal 桶
- N=12 R1 败者 = participation 桶
- **重复 confirm 同一场不产生重复 entries**（实现：`update` 整对象覆盖）
- BYE 场次 `pointsAwarded.entries === []`

**state machine**：
- pending → admin 录 → confirmed + award
- pending → player 录 → submitted（无 award）
- submitted → 任意会员覆盖 → submitted（旧丢）
- submitted → admin confirmAll → confirmed + award
- **confirmAll 幂等**：第二次调用 confirmed=0
- confirmed → admin 改 winner 翻盘 → 二次确认弹窗 → 确认后清后续 bracket / placement / status='ongoing'
- confirmed → admin 改 winner 不变 → 仅覆盖 entries，不触发 bracket 清理
- **改半决 winner → final result 清空 + placement 集合按 tournamentId 全删**
- **任意已登录会员可提交任意场次**（不限参赛双方）

**aggregate 分页**：
- 显式 `pageSize=100`
- 250 条（3 页）+ 2500 条（25 页）两个数据集
- 稳定排序 `(createTime ASC, _id ASC)`
- 第 100 / 200 / 1000 / 1001 条边界命中

### 8.3 E2E 关键旅程

**Admin 完整闭环**：
```
登录 admin → 创建 4 步 wizard（draft 落库）→ 完成
  → 排程页拖拽换顺序 → 保存
  → 比分录入页 → 录 4 场首轮 → 确认全部
  → bracket 推进 → 半决出现 → 录半决 → 确认 → 录决赛 → 确认 → placement 入库
  → 排行榜看到积分更新
```

**Player 提交流程**：
```
登录 player → my-match "可录分比赛" → 点击 → tournament-score
  → 内联编辑 → 提交（submitted）→ 切 admin 账号 → manage 待确认队列 → 确认全部
```

**Wizard 草稿恢复**：
```
admin 进入 wizard step 3 → 退出 → 再次进入 tournament-manage 看到 draft
  → 点击恢复 → 续接 step 3
```

### 8.4 不做（YAGNI）

- 性能压测（< 200 会员 / < 50 赛事）
- 模糊测试 / property-based
- 并发提交（同场次几乎不可能多人同时提交） → optimistic version 即可

---

## 9. 风险与开放问题

### 9.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| Draft 残留 tournaments 占空间 | 体验混乱 | 列表过滤 + 7 天定时任务清理 status='draft' && createTime < now - 7d |
| `_shared/` 与各云函数 `lib/` 不一致 | 部署 bug | `scripts/sync-shared-libs.sh` 在 pre-commit + CI 跑 hash 比对 |
| 玩家可以覆盖其他玩家的提交 | 数据扰乱 | 不保留 history；admin 在"确认全部"前能看到所有 submitted 场次的当前最新内容，confirm 即为最终 |
| 同一比赛多人同时点"确认全部" | 重复结算 | 云函数事务 + `confirmedAt is null` 乐观锁；二次调用直接 noop |
| 改分后旧 placement 已被排行榜消费 | 排行榜短期抖动 | 实时聚合（不缓存）+ 改分时 toast"排行榜数据已更新" |
| 30min slot UI 在小手机上挤 | 视觉差 | court-grid 用 4 列响应式 + 横向滚动备用 |

### 9.2 推迟到 v3

- 后续轮次自动排程（半决/决赛进入 §4 排程页）
- BYE 智能分配（避免同半区集中）
- 种子排位（按 UTR / 上轮积分）
- 玩家撤回自己的 submitted 提交（admin confirm 前）
- placement 桶可配置（用户自定义"前 N 名各得多少"）
- 拖拽真拖交互（第一版用 actionsheet）
- 双淘汰 / 循环赛 / 小组+淘汰 / 混双

### 9.3 决策已拍板（用户在 brainstorming 阶段确认）

| # | 问题 | 决策 |
|---|---|---|
| 1 | wizard 回退 step 2 改选手 → bracket 重置 | **是**。弹警告，确认后清空草稿排程并回 step 3 重新生成 |
| 2 | 拖拽第一版做不做真拖 | **不做**，actionsheet 改场地 + 上下箭头改顺序 |
| 3 | confirmed 行 admin 改分要不要二次确认 | **要**。保存时弹二次确认；winner 翻盘时显警告"将清空后续轮次结果与名次积分" |
| 4 | `tournament-score` 路径名要不要改 | **不改**，复用现有路径 |
| 5 | draft 列表入口给谁看 | **仅创建者本人** |

---

## 10. 实施分期

### Phase 7 · 创建+排程

**输出**：
- `cleanup-test-data.js` 脚本 + 一次执行清库
- `tournaments` 云函数支持 draft 模型 + 新字段
- `tournament-registrations.bulkSet`
- `tournament-brackets.saveInitialMatches / saveSchedule / regenerateDraft`（BYE + 推进公式）+ 兼容旧 actions
- `match-results.bulkUpsertScheduledMatches`，从排程生成 `match_results` 可录分行
- `scheduler-engine` 标 @deprecated，pairing lib 迁到 `tournament-brackets/lib/pairing/`
- `free-plays` 云函数（含 `bulkSet`）
- `<court-grid>` 重写为 30min 多选格
- `<schedule-board>` 新建
- `<player-picker-sheet>` 新建
- `pages/tournament-edit` 4 步 wizard 重写
- `pages/tournament-brackets` 按场地维度重写

**完成标准**：管理员能完整建一场赛事，bracket+排程落库正确，回退草稿可续。`pointsRules` 落库但不消费。

### Phase 8 · 录分+积分引擎

**输出**：
- `_shared/award.js` + vendored 同步脚本
- `match-results.confirmAll` + 改分回滚编排
- `points-engine` 重写 + 兼容 wrapper
- `pages/tournament-score` 内容重写（赛事维度）
- `<score-row>` 新建
- `manage` "待确认比分"队列
- `my-match` "可录分比赛"行

**完成标准**：完整闭环——比赛打完 → 任意会员提交 → admin 确认 → 积分入库 → 排行榜更新。改分支持完整回滚。

---

**END OF SPEC**
