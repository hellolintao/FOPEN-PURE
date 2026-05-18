# 2026 基线积分与待认领会员设计

- 日期：2026-05-18
- 范围：一次性录入 2026 FUOPEN 单打/双打累计积分表，并让未注册选手出现在排行榜
- 状态：设计已确认，待用户复核后写实施计划

## 1. 背景与目标

俱乐部此前用手工表格维护 2026 FUOPEN 单打、双打积分。小程序后续会直接录入比赛成绩，不再继续使用图片或表格导入，因此本期只需要把现有手工累计数据作为 2026 赛季的起始基线导入系统。

目标：

- 排行榜立即展示截图表里的全部选手，包括尚未注册的选手。
- 球员详情页展示可直接对应的累计字段：积分、胜负、胜率、参赛场次。
- 新会员注册时，根据用户填写的姓名做精确匹配，自动认领对应的历史基线成绩。
- 管理员会员列表能看出哪些会员仍是“待认领”。
- 后续新增积分仍只通过小程序现有录分链路产生。

## 2. 范围

### 范围内

- 新增一次性基线成绩数据源，覆盖 `season_2026` 的 `singles` 与 `doubles`。
- 为截图中的所有选手创建或复用 `members` 记录。
- 未注册选手以“待认领会员”形式存入后端，并在排行榜、球员详情页正常展示。
- 用户注册时按姓名精确匹配待认领会员，匹配成功则绑定 `openid` 并转为已认领。
- `points-engine.rankList`、`points-engine.playerStats` 将基线积分与后续真实比赛积分相加。
- 管理员会员列表展示认领状态。
- 更新数据库文档和测试。

### 范围外

- 不开发长期导入后台。
- 不保存图片 OCR 结果或原始截图。
- 不录入截图中的官方排名、最佳排名、升降、参赛站数、春季大满贯轮次、搭档、分数。
- 不伪造 `match_results` 逐场比赛。
- 不从基线数据生成 H2H 或最近比赛。
- 不做模糊匹配、昵称匹配、手机号匹配。

## 3. 字段映射

只录入当前小程序能直接使用的字段。

| 截图字段 | 入库字段 | 使用位置 |
| --- | --- | --- |
| 选手 | `members.name`、`baseline_standings.playerName` | 排行榜、球员详情、注册匹配 |
| 总积分 | `baseline_standings.totalPoints` | 排行榜 `PTS`、球员详情积分 |
| 胜 W | `baseline_standings.wins` | 球员详情胜场、胜率计算 |
| 负 L | `baseline_standings.losses` | 球员详情总场次、胜率计算 |
| 胜率 | 不入库；展示时由 `wins / (wins + losses)` 计算 | 排行榜、球员详情 |
| 参赛数量（场） | `wins + losses` 派生；如截图场次与胜负和不一致，以胜负和为系统统计口径 | 球员详情“胜场/总” |
| 单打/双打 | `baseline_standings.type` | 单打、双打排行榜和详情分桶 |

新截图中双打表有周期累计 W/L，单打表只露出 2026 FUOPEN 春季大满贯 W/L。本次导入以新截图可见的 W/L 列为准；没有填写 W/L 的行按 `0/0` 录入。小程序当前统计口径是 `winCount + lossCount`，因此系统展示以胜负和为准，原表场次不单独展示。

## 4. 数据模型

### 4.1 `members` 待认领字段

基线导入时，每个截图选手都应该在 `members` 中有一条记录。

已注册会员：

```js
{
  _id: "member_xxx",
  openid: "openid_xxx",
  name: "标子",
  avatarUrl: "cloud://avatar-file-id",
  status: "active",
  claimStatus: "claimed",
  createTime: Date,
  updateTime: Date
}
```

待认领会员：

```js
{
  _id: "unclaimed_标子",
  name: "标子",
  avatarUrl: "/images/icons/usercenter.png",
  status: "active",
  claimStatus: "unclaimed",
  source: "baseline_import",
  createdBy: "baseline_import",
  createTime: Date,
  updateTime: Date
}
```

规则：

- 待认领会员没有 `openid` / `openId`。
- 普通前端页面不展示“待认领”标签。
- 管理员会员列表展示 `claimStatus === 'unclaimed'` 的状态。
- 注册认领成功后保留同一个 `_id`，只补 `openid`、头像、打法、手机号等用户资料。

### 4.2 新集合 `baseline_standings`

每个选手每个类型一行。

```js
{
  _id: "baseline_season_2026_singles_标子",
  seasonId: "season_2026",
  type: "singles",
  memberId: "unclaimed_标子",
  playerName: "标子",
  rank: 5,
  totalPoints: 1560,
  wins: 1,
  losses: 1,
  source: "baseline_import",
  baseline: true,
  createTime: Date,
  updateTime: Date,
  createdAt: Date,
  updatedAt: Date
}
```

索引建议：

- `(seasonId, type, memberId)` 唯一，用于重复导入幂等。
- `(seasonId, type, totalPoints DESC)`，用于聚合与审计。
- `(seasonId, playerName)`，用于人工核查。

## 5. 注册认领流程

`members.add` 当前用于新用户自助注册。本期调整为：

1. 用户提交注册资料，后端取 `data.name.trim()`。
2. 查找 `members` 中 `name` 完全一致、`claimStatus === 'unclaimed'`、无 `openid` 的记录。
3. 如果找到且只有一条：
   - 更新这条会员记录，写入当前 `openid`、头像、手机号、打法等资料。
   - 设置 `claimStatus: 'claimed'`。
   - 条件更新仍要求 `_id`、`claimStatus: 'unclaimed'` 且无 `openid/openId`，防止并发重复认领。
   - 返回该会员记录给前端。
4. 如果找不到：
   - 按现有逻辑新建正式会员，`claimStatus: 'claimed'`。
5. 如果找到多条：
   - 不自动认领，返回 `CLAIM_CONFLICT`。
   - 前端提示联系管理员处理。

同一 `openid` 已注册时，保持现有幂等逻辑：返回已存在会员，不重复创建。

## 6. 排行榜与球员详情

### 6.1 排行榜

`points-engine.rankList` 聚合结果改为：

```
baseline_standings 累计
+ confirmed match_results.pointsAwarded.entries
+ tournament_points
```

输出仍保持现有前端契约：

- `_id`
- `name`
- `avatarUrl`
- `totalPoints`
- `winCount`
- `lossCount`
- `winRate`
- `trendDelta`

未注册待认领会员也有 `memberId`，所以排行榜行可以复用现有 `rank-row`。

### 6.2 球员详情

`points-engine.playerStats` 同样把基线数据并入单打、双打桶：

- `winCount = baseline.wins + 后续真实比赛 wins`
- `lossCount = baseline.losses + 后续真实比赛 losses`
- `totalPoints = baseline.totalPoints + 后续真实比赛 points`
- `winRate = winCount / (winCount + lossCount)`

待认领会员详情页正常展示累计统计。H2H、最近比赛、排名走势只来自现有真实比赛与 `rank_snapshots`，不会由基线数据伪造。

### 6.3 排名快照

本次一次性导入不写 `rank_snapshots`。`trendDelta` 沿用现有快照逻辑；若没有历史快照，排行榜返回 `trendDelta: null`。基线数据不使用截图里的“升降”字段。

## 7. 管理员会员列表

`member-manage` 列表增加一个轻量状态显示：

- `claimStatus === 'unclaimed'`：显示“待认领”。
- 其他：显示现有状态或不额外强调。

搜索仍按姓名、手机号工作。待认领会员没有手机号，因此主要通过姓名搜索。

## 8. 数据录入口径

基线数据以代码内置 seed 文件或脚本常量录入，不从前端上传。原因：

- 这是一次性数据。
- 当前只有两张截图，字段范围固定。
- 使用脚本可测试、可重复运行、可审计。

脚本要求：

- 幂等：重复运行不会创建重复会员或重复基线行。
- 若同名正式会员已存在，直接把基线行关联到该会员。
- 若同名待认领会员已存在，复用该会员。
- 若姓名重复导致无法确定会员，脚本报错并停止。

## 9. 错误处理

| 场景 | 处理 |
| --- | --- |
| 注册姓名匹配不到待认领会员 | 新建正式会员 |
| 注册姓名匹配到 1 个待认领会员 | 自动认领 |
| 注册姓名匹配到多个待认领会员 | 返回 `CLAIM_CONFLICT`，前端提示联系管理员 |
| 已注册 openid 再次注册 | 返回已有会员 |
| 导入脚本发现重复姓名 | 停止导入，输出重复姓名 |
| 导入脚本重复运行 | 更新已有 baseline 行，不重复创建 |

## 10. 测试策略

### 云函数测试

- `members.add` 精确匹配待认领会员后绑定 `openid`。
- `members.add` 匹配不到时创建新会员。
- `members.add` 匹配多条待认领会员时返回 `CLAIM_CONFLICT`。
- `members.get` 不误返回无 `openid` 的待认领会员给当前登录用户。
- `points-engine.rankList` 合并基线积分、胜负与后续真实比赛积分。
- `points-engine.playerStats` 合并基线单打、双打桶。
- 基线数据不生成 `recent` 和 H2H。

### 脚本测试

- 首次导入创建待认领会员与 `baseline_standings`。
- 重复导入保持幂等。
- 已有同名正式会员时复用正式会员。
- 重名时停止并报告。

### 小程序测试

- 排行榜显示未注册选手。
- 点击未注册选手进入详情页，展示积分、胜负、胜率，最近比赛为空。
- 管理员会员列表显示“待认领”。
- 注册填写完全一致姓名后，排行榜仍是同一行，会员变为已认领。

## 11. 验收清单

- [ ] 单打排行榜包含截图单打表中的全部选手。
- [ ] 双打排行榜包含截图双打表中的全部选手。
- [ ] 未注册选手在排行榜和详情页正常展示。
- [ ] 管理员会员列表能识别待认领会员。
- [ ] 姓名完全一致的新注册用户能自动认领历史成绩。
- [ ] 后续小程序录分后，积分在基线基础上继续累加。
- [ ] H2H 与最近比赛不会出现基线伪造记录。

## 12. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 截图人工录入出错 | seed 文件用测试断言总人数、关键选手总分、胜负合计 |
| 重名导致错绑 | 精确匹配只允许唯一待认领记录，多条直接失败 |
| 待认领会员被普通用户误感知 | 普通页面不展示认领状态，仅管理员列表显示 |
| 基线与后续真实比赛重复计分 | 基线只代表导入前累计，后续只录新比赛；不把基线写入 `match_results` |
| 趋势箭头初始值不直观 | 本次导入不写 baseline 快照；没有历史快照时 `trendDelta` 为 `null`，前端按现有样式显示 `—`，后续周快照自然变化 |
