# 数据库集合文档

本文档详细说明了 Fuopen 小程序使用的 6 个数据库集合及其字段说明。

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
| `playStyleNote` | String | 否 | 打法备注，最多 100 字 |
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

存储赛事的完整信息，包括配置和积分规则。

### 字段说明

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `_id` | String | 否 | 主键，系统自动生成或自定义，格式：tournament_{year}_{timestamp}_{random} |
| `seasonId` | String | 否 | 所属赛季ID |
| `name` | String | 是 | 赛事名称 |
| `type` | String | 是 | 赛事类型，'singles'（单打）或 'doubles'（双打） |
| `startDate` | String | 是 | 开始日期，格式：YYYY-MM-DD |
| `endDate` | String | 是 | 结束日期，格式：YYYY-MM-DD |
| `location` | String | 是 | 场地名称 |
| `format` | String | 否 | 赛制，'regular'（常规赛）或 'knockout'（淘汰赛），默认为 'regular' |
| `status` | String | 否 | 赛事状态，'upcoming'（待开始）、'ongoing'（进行中）、'completed'（已结束） |
| `description` | String | 否 | 赛事描述 |
| `config.maxPlayers` | Number | 是 | 最大参赛人数，范围：2-64 |
| `config.currentRound` | Number | 是 | 当前轮次 |
| `config.totalRounds` | Number | 是 | 总轮数，范围：1-8 |
| `config.playersPerMatch` | Number | 是 | 每场比赛人数，2（单打）或 4（双打） |
| `config.eliminationType` | String | 是 | 淘汰类型，'single'（单败）或 'double'（双败） |
| `config.seedPlayers` | Array | 否 | 种子选手ID列表 |
| `pointsRules.win` | Number | 是 | 胜利积分 |
| `pointsRules.loss` | Number | 是 | 失败积分 |
| `pointsRules.walkover` | Number | 是 | 弃权积分 |
| `pointsRules.bonusByRound` | Object | 是 | 轮次奖励积分，键为轮次，值为积分 |
| `courtTimeGrid` | Object | 否 | 场地×时段矩阵，结构见下面"courtTimeGrid 结构"小节 |
| `createTime` | Date | 是 | 创建时间 |
| `updateTime` | Date | 是 | 更新时间 |

### courtTimeGrid 结构

```json
{
  "matchDuration": 20,
  "courts": [
    { "courtId": "c1", "name": "1号场" }
  ],
  "slots": [
    {
      "slotId": "s_20260525_0800",
      "start": "2026-05-25T08:00:00+08:00",
      "end":   "2026-05-25T08:20:00+08:00",
      "availableCourtIds": ["c1"]
    }
  ]
}
```

- `matchDuration` 固定为 20 分钟
- `slots` 粒度为 20 分钟一档
- 未被任何比赛排到的 `(slot, court)` 在前端显示为"自由拉球"

### 数据示例

```json
{
  "_id": "tournament_2024_1704067200_123",
  "seasonId": "season_2024",
  "name": "第一届公开赛",
  "type": "singles",
  "format": "regular",
  "startDate": "2024-01-15",
  "endDate": "2024-01-20",
  "location": "体育中心1号场",
  "status": "upcoming",
  "description": "欢迎参加第一届公开赛",
  "config": {
    "maxPlayers": 16,
    "currentRound": 1,
    "totalRounds": 4,
    "playersPerMatch": 2,
    "eliminationType": "single",
    "seedPlayers": []
  },
  "pointsRules": {
    "win": 100,
    "loss": 20,
    "walkover": 50,
    "bonusByRound": {
      "1": 0,
      "2": 50,
      "3": 100,
      "4": 200,
      "5": 300
    }
  },
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

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
| `partnerId` | String | 否 | 双打时的搭档ID |
| `partnerName` | String | 否 | 双打时的搭档姓名 |
| `teamName` | String | 否 | 双打时的队伍名称 |
| `seed` | Number | 否 | 种子排名，范围：1-64 |
| `status` | String | 否 | 报名状态，'registered'（已报名）、'confirmed'（已确认）、'withdrew'（已退赛） |
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
  "status": "registered",
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
  "status": "registered",
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
| `matches[].player1` | Object | 是 | 选手1信息 |
| `matches[].player1.id` | String | 是 | 选手1的ID或报名ID |
| `matches[].player1.name` | String | 是 | 选手1的姓名 |
| `matches[].player1.registrationId` | String | 否 | 选手1的报名ID |
| `matches[].player2` | Object | 是 | 选手2信息 |
| `matches[].player2.id` | String | 是 | 选手2的ID或报名ID |
| `matches[].player2.name` | String | 是 | 选手2的姓名 |
| `matches[].player2.registrationId` | String | 否 | 选手2的报名ID |
| `matches[].winner` | Number | 否 | 获胜方，1（选手1获胜）或 2（选手2获胜） |
| `matches[].status` | String | 否 | 比赛状态，'pending'（待开始）、'ongoing'（进行中）、'completed'（已完成） |
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
| `_id` | String | 否 | 主键，系统自动生成，格式：match_{timestamp}_r{round}_m{index} |
| `tournamentId` | String | 是 | 所属赛事ID |
| `round` | Number | 是 | 轮次 |
| `type` | String | 是 | 比赛类型，'singles'（单打）或 'doubles'（双打） |
| `players` | Array | 是 | 选手列表，固定2个元素 |
| `players[].id` | String | 是 | 选手ID |
| `players[].name` | String | 是 | 选手姓名 |
| `status` | String | 是 | 比赛状态，'pending'（待开始）、'ongoing'（进行中）、'completed'（已完成）、'cancelled'（已取消） |
| `winnerId` | String | 否 | 获胜者ID |
| `loserId` | String | 否 | 失败者ID |
| `score` | String | 否 | 比分，格式如 "6-4, 6-3" |
| `points` | Number | 否 | 获得积分 |
| `resultStatus` | String | 是 | 'pending' \| 'confirmed' \| 'disputed'，结果对账状态 |
| `submissions` | Array | 否 | 提交记录列表，结构见下"submissions 子结构"小节 |
| `confirmedAt` | Date | 否 | 自动/仲裁 confirmed 时间 |
| `confirmedBy` | String | 否 | 管理员仲裁时填 admin._id；双方一致 auto-confirm 时为 null |
| `disputeReason` | String | 否 | disputed 状态时的描述 |
| `courtId` | String | 否 | 排程后填 |
| `scheduledStart` | Date | 否 | 排程后填 |
| `scheduledSlotId` | String | 否 | 排程后填 |
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
  "_id": "match_1704067200_123_r1_m001",
  "tournamentId": "tournament_2024_1704067200_123",
  "round": 1,
  "type": "singles",
  "players": [
    {
      "id": "member_xxxxx",
      "name": "张三"
    },
    {
      "id": "member_yyyyy",
      "name": "李四"
    }
  ],
  "status": "completed",
  "winnerId": "member_xxxxx",
  "loserId": "member_yyyyy",
  "score": "6-4, 6-3",
  "points": 100,
  "createTime": "2024-01-01T00:00:00.000Z",
  "updateTime": "2024-01-01T00:00:00.000Z"
}
```

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
    └─→ match_results (比赛结果)
```

## 注意事项

1. **ID 生成规则**：所有 ID 都有固定的生成规则，便于识别和关联
2. **时间格式**：所有时间字段使用 ISO 8601 标准格式
3. **状态枚举**：状态字段有明确的枚举值，不要使用其他值
4. **数据验证**：每个集合都在云函数层面进行了数据验证
5. **级联删除**：删除赛事时需要注意级联删除相关数据
6. **索引建议**：建议为常用查询字段建立索引，如 `tournamentId`、`round`、`playerId` 等
