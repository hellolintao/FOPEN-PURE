# 数据库集合文档

本文档详细说明了 Fuopen 小程序使用的数据库集合及其字段说明。

---

## 1. members（会员表）

存储小程序用户/会员的基本信息。

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，系统自动生成 |
| `openid` | String | 是 | 微信用户唯一标识 |
| `name` | String | 是 | 会员姓名 |
| `avatarUrl` | String | 否 | 头像 URL |
| `phone` | String | 否 | 联系电话 |
| `status` | String | 否 | 会员状态，默认为 'active' |
| `admin` | Boolean | 否 | 是否为管理员，默认为 false |
| `playStyle` | String | 否 | 打法风格枚举：baseliner/serve-volleyer/all-court/counter-puncher/aggressive-baseliner |
| `playStyleNote` | String | 否 | 打法备注，最多 50 字 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

### 数据示例

```json
{
  "_id": "member_xxxxx",
  "openid": "oxxxxxxxxxxxxxxxxxxx",
  "name": "张三",
  "avatarUrl": "https://example.com/avatar.jpg",
  "phone": "13800138000",
  "status": "active",
  "admin": false,
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

---

## rank_snapshots

每位上榜选手每周一行的历史排名快照。用于 trendDelta（与 latest 快照比对）和 rankHistory（折线图）；未产生积分来源、尚未上榜的成员不写合成 0 分快照。

| Field | Type | Description |
|---|---|---|
| `_id` | string | 推荐格式 `rs_<seasonId>_<weekId>_<type>_<memberId>`；唯一索引由 `(seasonId, type, weekId, memberId)` 兜底 |
| `seasonId` | string | 赛季，例 `s2026` |
| `weekId` | string | weekly = `ws_YYYY-MM-DD`（Monday key，沿用 `getWeekId`）；baseline = `baseline_YYYY-MM-DD` |
| `weekStart` | string | yyyy-mm-dd（周一）；baseline 行使用当天日期 |
| `weekEnd` | string | yyyy-mm-dd（周日）；baseline 行使用当天日期 |
| `effectiveAt` | Date | trend/latest 排序的权威字段。weekly=weekEnd 23:59:59；baseline=回填时刻 |
| `type` | string | `singles` \| `doubles` |
| `memberId` | string | 选手 ID |
| `rank` | number | 截至该周结束时的排名（数组下标 + 1） |
| `totalPoints` | number | 截至该周结束累计积分 |
| `wins` | number | 累计胜场 |
| `losses` | number | 累计负场 |
| `snapshotKind` | string | `weekly` \| `baseline` |
| `computedAt` | Date | 写入时间 |

**索引（必建）：**

1. `(seasonId, type, weekStart DESC, rank ASC)` — rank 折线图按周倒序、单周内按 rank 升序
2. `(seasonId, type, memberId, weekStart ASC)` — 单玩家 rankHistory（折线图数据源）
3. `(seasonId, type, memberId, effectiveAt DESC, computedAt DESC)` — `rankList.trendDelta` 查最近一份有效快照
4. `(seasonId, type, weekId, memberId)` UNIQUE — cron / backfill 幂等 upsert

**容量估算：** 100 人 × 52 周 × 2 type = 10400 文档/年。

---

## 2. seasons（赛季表）

存储赛季的基本信息和关联的赛事。

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 是 | 主键，自定义赛季ID |
| `name` | String | 是 | 赛季名称 |
| `startDate` | String | 是 | 赛季开始日期，格式：YYYY-MM-DD |
| `endDate` | String | 是 | 赛季结束日期，格式：YYYY-MM-DD |
| `status` | String | 否 | 赛季状态，默认为 'active' |
| `tournaments` | Array | 否 | 关联的赛事ID列表 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

### 数据示例

```json
{
  "_id": "season_2024",
  "name": "2024年春季赛",
  "startDate": "2024-01-01",
  "endDate": "2024-06-30",
  "status": "active",
  "tournaments": ["tournament_2024_xxxxxx", "tournament_2024_yyyyyy"],
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

---

## 3. tournaments（赛事表）

存储赛事的基本信息、草稿归属、排程计划和积分规则。Phase 7 新创建流程使用 `schedulePlan`，旧 `courtTimeGrid` 仅作为历史兼容字段保留。

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，格式：tournament_{year}_{timestamp}_{random} |
| `seasonId` | String | 是 | 所属赛季ID |
| `name` | String | 是 | 赛事名称 |
| `type` | String | 是 | 赛事类型：`singles` / `doubles` |
| `format` | String | 是 | 赛制：`regular` / `knockout` |
| `startDate` | String | 是 | 开始日期，格式：YYYY-MM-DD |
| `endDate` | String | 否 | 结束日期，格式：YYYY-MM-DD |
| `location` | String | 否 | 地点说明 |
| `status` | String | 是 | `draft` / `upcoming` / `ongoing` / `completed` |
| `description` | String | 否 | 赛事描述 |
| `maxPlayers` | Number | 否 | 淘汰赛最大参赛人数 |
| `schedulePlan` | Object | 非 draft 必填 | 20 分钟粒度场地排程（Phase 7 2026-05-15 起固定 slotMinutes=20，UI 用 1 小时格但入库展开 3 个 slot），结构见下 |
| `pointsRules` | Object | 非 draft 必填 | Phase 7 积分规则，结构见下 |
| `createdBy` | String | draft 必填 | 创建者 member._id，用于“我的草稿”过滤 |
| `createdByOpenid` | String | 否 | 创建者 OPENID，仅后端使用 |
| `courtTimeGrid` | Object | 否 | 旧 20 分钟排程字段，仅历史兼容 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

### schedulePlan 结构

```json
{
  "slotMinutes": 20,
  "courts": [
    {
      "courtId": "court_001",
      "name": "1号场",
      "location": "A区",
      "slots": ["2026-05-25T08:00", "2026-05-25T08:30"]
    }
  ],
  "queues": [
    {
      "courtId": "court_001",
      "items": [
        { "kind": "match", "matchId": "match_r1_p1_x", "sourceMatchId": "match_r1_p1_x", "order": 0 },
        { "kind": "freePlay", "matchId": "fp_001", "freePlayId": "fp_001", "order": 1 }
      ]
    }
  ]
}
```

### pointsRules 结构

```json
{
  "winLoss": { "win": 20, "loss": 10, "walkover": 0 },
  "placement": {
    "champion": 100,
    "runnerUp": 70,
    "semifinal": 50,
    "quarterfinal": 30,
    "participation": 10
  }
}
```

- `winLoss.walkover`: Phase 8 字段已存在但未实现弃赛流程，默认 0，留给后续 phase 接入。
- 淘汰赛玩家可同时获得 `winLoss` + `placement`（叠加，非互斥）。BYE 行 `entries: []`，不进积分。

---

## 4. tournament_registrations（赛事报名表）

存储会员参加赛事的报名信息。

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，系统自动生成，格式：reg_{tournamentId}_{index} |
| `tournamentId` | String | 是 | 所属赛事ID |
| `seasonId` | String | 是 | 所属赛季ID |
| `type` | String | 是 | 参赛类型，'singles'（单打）或 'doubles'（双打） |
| `playerId` | String | 是 | 参赛选手ID（会员ID） |
| `playerName` | String | 是 | 参赛选手姓名 |
| `partnerId` | String | 双打+淘汰赛 必填 | 双打搭档 member._id。常规赛双打报名按个人，`partnerId=null`，搭档由 step 3 排程随机配对（Phase 7 2026-05-15 修订） |
| `partnerName` | String | 双打+淘汰赛 必填 | 双打搭档姓名（常规赛双打可空） |
| `teamName` | String | 否 | 双打时的队伍名称（淘汰赛常用） |
| `seed` | Number | 否 | 种子排名，范围：1-64 |
| `registrationStatus` | String | 否 | Phase 7 报名状态：`confirmed` / `withdrew`，bulkSet 默认 `confirmed` |
| `status` | String | 否 | 旧报名状态字段，历史兼容 |
| `registerTime` | String | 是 | 报名时间 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 否 | 更新时间 |

### 数据示例

```json
{
  "_id": "reg_2024_1704067200_001",
  "tournamentId": "tournament_2024_1704067200_123",
  "seasonId": "season_2024",
  "type": "singles",
  "playerId": "member_xxxxx",
  "playerName": "张三",
  "partnerId": "",
  "partnerName": "",
  "teamName": "",
  "seed": 1,
  "registrationStatus": "confirmed",
  "registerTime": "2024-01-01T00:00:00.000Z",
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

### 双打示例

```json
{
  "_id": "reg_2024_1704067200_002",
  "tournamentId": "tournament_2024_1704067200_123",
  "seasonId": "season_2024",
  "type": "doubles",
  "playerId": "member_xxxxx",
  "playerName": "张三",
  "partnerId": "member_yyyyy",
  "partnerName": "李四",
  "teamName": "飞跃队",
  "seed": 2,
  "registrationStatus": "confirmed",
  "registerTime": "2024-01-01T00:00:00.000Z",
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

---

## 5. tournament_brackets（对位表）

存储赛事各轮次的对位信息和比赛安排。

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，系统自动生成，格式：bracket_{tournamentId}_round_{round} |
| `tournamentId` | String | 是 | 所属赛事ID |
| `round` | Number | 是 | 轮次 |
| `type` | String | 是 | 赛事类型，'singles'（单打）或 'doubles'（双打） |
| `matches` | Array | 是 | 比赛列表 |
| `matches[].matchId` | String | 是 | 比赛ID，格式：match_{tournamentId}_r{round}_m{position} |
| `matches[].position` | Number | 是 | 场次位置 |
| `matches[].player1` | Object | 否 | 选手1信息；R2+ 占位可为 null |
| `matches[].player1.id` | String | 是 | 选手1的ID或报名ID |
| `matches[].player1.name` | String | 是 | 选手1的姓名 |
| `matches[].player1.registrationId` | String | 否 | 选手1的报名ID |
| `matches[].player2` | Object | 否 | 选手2信息；R2+ 占位可为 null，BYE 为 `{ id: "BYE", name: "BYE" }` |
| `matches[].player2.id` | String | 是 | 选手2的ID或报名ID |
| `matches[].player2.name` | String | 是 | 选手2的姓名 |
| `matches[].player2.registrationId` | String | 否 | 选手2的报名ID |
| `matches[].bye` | Boolean | 否 | 是否轮空 |
| `matches[].winner` | Object | 否 | Phase 7 后为获胜方对象；旧数据可能为 1 / 2 |
| `matches[].status` | String | 否 | 比赛状态，'pending'（待开始）、'ongoing'（进行中）、'completed'（已完成） |
| `matches[].resultStatus` | String | 否 | 结果状态：`pending` / `confirmed` / `disputed` |
| `matches[].courtId` | String | 否 | 首轮排程场地 |
| `matches[].queueOrder` | Number | 否 | 首轮场地队列顺序 |
| `nextRoundMatches` | Array | 否 | 下一轮对位映射 |
| `nextRoundMatches[].nextMatchPosition` | Number | 是 | 下一轮比赛的场次位置 |
| `nextRoundMatches[].fromMatchPositions` | Array | 是 | 来源比赛的场次位置列表 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

### 数据示例

```json
{
  "_id": "bracket_2024_1704067200_123_round_1",
  "tournamentId": "tournament_2024_1704067200_123",
  "round": 1,
  "type": "singles",
  "matches": [
    {
      "matchId": "match_2024_1704067200_r1_m1",
      "position": 1,
      "player1": {
        "id": "member_xxxxx",
        "name": "张三",
        "registrationId": "reg_2024_1704067200_001"
      },
      "player2": {
        "id": "member_yyyyy",
        "name": "李四",
        "registrationId": "reg_2024_1704067200_002"
      },
      "winner": 1,
      "status": "completed"
    }
  ],
  "nextRoundMatches": [
    {
      "nextMatchPosition": 1,
      "fromMatchPositions": [1, 2]
    }
  ],
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

---

## 6. match_results（比赛结果表）

存储比赛的具体结果和比分信息。

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，Phase 7 格式：result_{tournamentIdWithoutPrefix}_{sourceMatchId} |
| `tournamentId` | String | 是 | 所属赛事ID |
| `seasonId` | String | 是 | 所属赛季ID |
| `tournamentType` | String | 是 | 赛事类型：`singles` / `doubles` |
| `matchKind` | String | 是 | `bracket` / `regularRound` / `extra` |
| `sourceMatchId` | String | 是 | 对应 tournament_brackets.matches[].matchId |
| `round` | Number | 是 | 轮次 |
| `position` | Number | 是 | 轮内场次位置 |
| `player1` | Object | 否 | 选手/队伍 1；R2+ 占位可为 null |
| `player2` | Object | 否 | 选手/队伍 2；R2+ 占位可为 null |
| `playerIds` | Array | 是 | 参赛 member._id 列表，双打包含 4 人，BYE 跳过 |
| `courtId` | String | 否 | 首轮排程场地 |
| `queueOrder` | Number | 否 | 首轮场地队列顺序 |
| `resultStatus` | String | 是 | `pending` / `confirmed` / `disputed` |
| `winner` | Object | 否 | 获胜方对象 |
| `winnerId` | String | 否 | 获胜者ID |
| `loserId` | String | 否 | 失败者ID |
| `score` | String | 否 | 比分，格式如 "6-4, 6-3" |
| `pointsAwarded` | Object | 否 | 积分发放快照 `{ source: 'match', entries: [{ memberId, points, role }] }`；role: 'winner'/'loser'；BYE 行 entries 为空。Phase 8 起统一此结构 |
| `submissions` | Array | 否 | 提交记录列表，结构见下"submissions 子结构"小节 |
| `confirmedAt` | Date | 否 | 自动/仲裁 confirmed 时间 |
| `confirmedBy` | String | 否 | 管理员仲裁时填 admin._id；双方一致 auto-confirm 时为 null |
| `disputeReason` | String | 否 | disputed 状态时的描述 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

### submissions 子结构

```json
[
  {
    "submittedBy": "member_xxx",
    "role": "admin",
    "winnerIds": "member_xxx",
    "score": "6-3, 6-4",
    "submittedAt": "2026-05-25T10:30:00.000Z"
  }
]
```
- `role`: 'admin' (管理员录入，立即 confirmed) / 'player' (玩家提交，等对账)
- `winnerIds`: 单人 id，双打用逗号分隔多 id
- `score`: 纯文本存档，不解析

### 数据示例

```json
{
  "_id": "result_2026_123456_001_match_r1_p1_1700000000000_0",
  "tournamentId": "tournament_2026_123456_001",
  "seasonId": "season_2026",
  "tournamentType": "singles",
  "matchKind": "bracket",
  "sourceMatchId": "match_r1_p1_1700000000000_0",
  "round": 1,
  "position": 1,
  "player1": { "id": "member_xxxxx", "name": "张三" },
  "player2": { "id": "member_yyyyy", "name": "李四" },
  "playerIds": ["member_xxxxx", "member_yyyyy"],
  "courtId": "court_001",
  "queueOrder": 0,
  "resultStatus": "confirmed",
  "winner": { "id": "member_xxxxx", "name": "张三" },
  "winnerId": "member_xxxxx",
  "loserId": "member_yyyyy",
  "score": "6-4, 6-3",
  "pointsAwarded": { "source": "match", "entries": [] },
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

---

## 7. courts（球场字典）

存储俱乐部可选球场。创建赛事时 `court-grid` 从该集合读取 enabled 球场。

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，格式：court_{timestamp}_{random} |
| `courtId` | String | 是 | 与 `_id` 一致，用于前端排程引用 |
| `name` | String | 是 | 球场名称 |
| `location` | String | 否 | 场地位置说明 |
| `enabled` | Boolean | 是 | 是否可选 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

---

## 8. free_plays（自由拉球）

存储创建排程时手动插入的自由拉球队列项，不参与 bracket 晋级；是否参与积分由 Phase 8 决定。

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，格式：fp_{tournament}_{court}_{order}_{timestamp} |
| `tournamentId` | String | 是 | 所属赛事ID |
| `courtId` | String | 是 | 所属球场 |
| `queueOrder` | Number | 是 | 在该球场队列中的顺序 |
| `playerIds` | Array | 是 | 参与球员 member._id 列表，单打 2 人，双打 4 人 |
| `createdBy` | String | 否 | 创建者 member._id |
| `createTime` | Date | 是 | 创建时间 |

---

## 9. tournament_points（赛事 placement 积分快照）

Phase 8 起，淘汰赛决赛 confirmed 后由 `match-results/lib/state.maybeAwardPlacement` 写入。每个 (tournamentId, memberId) 一行，承载 `placement` 桶积分（champion / runnerUp / semifinal / quarterfinal / participation）。`winLoss` 积分通过 `match_results.pointsAwarded.entries` 表达，不写本表。改分回滚（winner 翻盘）会按 tournamentId 整体删除该表对应行。

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 是 | 主键，固定格式：`{tournamentId}_{memberId}_placement` |
| `tournamentId` | String | 是 | 赛事ID |
| `memberId` | String | 是 | 选手 member._id |
| `seasonId` | String | 是 | 赛季ID（用于排行榜聚合过滤） |
| `tournamentType` | String | 是 | `singles` / `doubles` |
| `rank` | String | 是 | `champion` / `runnerUp` / `semifinal` / `quarterfinal` / `participation` |
| `points` | Number | 是 | 桶对应分值（来自 tournament.pointsRules.placement） |
| `awardedAt` | Date | 是 | 发放时间 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

排行榜聚合（`points-engine.rankAggregate / rankList`）按 `(createTime asc, _id asc)` 复合游标分页拉取本表 + `match_results` 已 confirmed 行，累加每位选手的 `totalPoints / wins / losses`。

---

## 集合关系图

```
seasons (赛季)
    ↓ 1:N
tournaments (赛事)
    ↓ 1:N
    ├─→ tournament_registrations (报名)
    │       ↓ N:1
    │       └─→ members (会员)
    ↓ 1:N
    ├─→ tournament_brackets (对位表)
    │       ↓ 1:N
    │       └─→ match_results (比赛结果)
    ├─→ match_results (比赛结果)
    └─→ free_plays (自由拉球)

courts (球场字典)
    └─→ tournaments.schedulePlan.courts[].courtId
```

## 注意事项

1. **ID 生成规则**：所有 ID 都有固定的生成规则，便于识别和关联
2. **时间格式**：所有时间字段使用 ISO 8601 标准格式
3. **状态枚举**：状态字段有明确的枚举值，不要使用其他值
4. **数据验证**：每个集合都在云函数层面进行了数据验证
5. **级联删除**：删除赛事时需要注意级联删除相关数据
6. **索引建议**：建议为常用查询字段建立索引，如 `tournamentId`、`round`、`playerId` 等

## `_request_log` 集合（v2.1 新增）

用于 batchConfirm / batchSubmit 的幂等合并与失败行复盘。**TTL 30 天**自动清理（lastSeenAt + 30d）。

### 文档结构

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | String | 是 | requestId（batch group id），前端 parent 在开 sheet 时生成 |
| `action` | String | 是 | `batchConfirm` \| `batchSubmit` |
| `callerOpenid` | String | 是 | 调用方 OPENID |
| `callerMemberId` | String | 是 | 调用方 member._id |
| `firstSeenAt` | ServerDate | 是 | 首次写入时间 |
| `lastSeenAt` | ServerDate | 是 | 最近一次重试时间，TTL 索引基准 |
| `results` | Object | 是 | map<matchId, perMatchResult> |
| `closedAt` | ServerDate \| null | 否 | 整批 all-ok 或 admin 显式关闭 sheet 时打戳 |

### perMatchResult 形态

成功：`{ state: 'success', confirmedAt: ServerDate, attemptCount: 1 }`
失败：`{ state: 'failure', code: 'CLOUD_TIMEOUT', message: '...', retryable: true, attemptCount: 2 }`

### 索引

- TTL：`lastSeenAt` + 30 天
- 复合：`(callerOpenid, lastSeenAt desc)` 便于按用户审计

## `match_results.updateTime` 作为乐观锁键（v2.1 新增说明）

v2.1 `batchConfirm` 使用 `match_results.updateTime` 作为乐观锁键，API payload 字段名 `expectedUpdateTime`。
后端确认前精确匹配 `current.updateTime.getTime() === new Date(payload.expectedUpdateTime).getTime()`；不匹配返 STALE_VERSION。
后续若需要严格 version，再新增 `version: Number` 字段，向后兼容。
