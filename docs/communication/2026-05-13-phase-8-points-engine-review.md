# Phase 8 积分引擎设计 Review

日期：2026-05-13

用途：用于和 Claude 沟通 Phase 8 积分引擎设计中的风险点和建议调整。

## 2026-05-14 处理状态

本 review 的关键建议已吸收到以下文档：

- `docs/superpowers/specs/2026-05-13-tournament-flow-redesign-design.md`
- `docs/superpowers/plans/07-phase-7-create-schedule.md`
- `docs/superpowers/plans/08-phase-8-score-engine.md`
- `docs/superpowers/plans/PROGRESS.md`

额外补充的执行口径：

- Phase 7 保存初始 bracket 时预建 R2+ `match_results` 占位行。
- Phase 8 bracket 推进时同步更新下一轮 `match_results`。
- 普通会员不得覆盖 confirmed 比分。
- `match_results` 必须写 `round/position/sourceMatchId`，供推进和回滚使用。

## 背景

Phase 8 计划重写 `points-engine`，在 `match_results.resultStatus` 转为 `confirmed` 时结算积分。

设计分两类：

- 常规赛 `winLoss`：每场 confirmed 后增量写入 `match_results.pointsAwarded`
- 单淘汰 `placement`：决赛 confirmed 后按最终名次写入新集合 `tournament_points`

## 需要修正的关键点

1. 不要跨云函数假设同事务

`match-results` confirm 时如果要保证事务一致性，积分结算核心应抽成 lib，由 `match-results` 在同一事务内直接调用。`points-engine` 云函数可以保留为入口、重算和排行榜聚合，但不要依赖跨云函数事务。

2. 统一 `pointsAwarded` 数据结构

当前旧代码读 `pointsAwarded.winner.total / loser.total`，新 spec 写 `{ [memberId]: points }` 会不兼容。

建议改成：

```js
pointsAwarded: {
  source: 'match',
  entries: [
    { memberId, points, role: 'winner' },
    { memberId, points, role: 'loser' }
  ]
}
```

双打时 `entries` 按每个 member 展开。

3. 补双打积分规则

需要明确双打胜方两人是否各得 `win`，负方两人是否各得 `loss`。排行榜按会员聚合，不能只依赖逗号拼接的 `winnerId / loserId`。

4. 淘汰赛推进映射要明确

当前签表不一定生成 `nextRoundMatches`。可以改为公式推进：

```js
nextPosition = Math.ceil(position / 2)
nextSlot = position % 2 === 1 ? 'player1' : 'player2'
```

或者要求 scheduler 固定生成 `nextRoundMatches`。

5. 处理 BYE 自动晋级

淘汰赛补 BYE 后，BYE 场不会自然 confirmed。需要在签表生成或 bracket 推进逻辑里自动把真实选手推进下一轮。

6. `tournament_points` 必须幂等

placement 是赛事级积分，使用新集合没问题，但必须固定唯一键，例如：

```js
_id = `${tournamentId}_${memberId}_placement`
```

决赛重复 confirm 或重算时 upsert 覆盖，不能 add 重复记录。

7. “回滚”应定义为覆盖或删除结算记录

如果排行榜实时从 `match_results + tournament_points` 汇总，不需要扣减余额。

- 常规赛：覆盖本场 `pointsAwarded`
- 淘汰赛：改 winner 时删除该赛事 placement 记录

8. 修改已确认淘汰赛结果要先读旧 winner

判断 winner 是否翻盘必须基于更新前快照。`match-results` 应统一编排：先读旧 match/bracket，再更新结果、清空后续节点、删除 placement 积分。

9. 最终名次规则要补边界

尤其是 6 人补到 8 人签表时，首轮真实败者算 `quarterfinal` 还是 `participation`？`N >= 8` 的 N 是真实参赛人数还是补 BYE 后签表人数，必须明确。

10. 排行榜聚合要分页

不能直接 `.get()` 全量 confirmed matches；云数据库默认有限制。Phase 8 重写时 `match_results` 和 `tournament_points` 都要分页拉取。

## Schema 需要同步升级

当前 `pointsRules` 只有：

```js
{
  win,
  loss,
  walkover,
  bonusByRound
}
```

Phase 8 需要明确新结构和兼容策略，例如：

```js
pointsRules: {
  winLoss: {
    win: 100,
    loss: 20,
    walkover: 0
  },
  placement: {
    champion: 500,
    runnerUp: 300,
    semifinal: 150,
    quarterfinal: 80,
    participation: 20
  }
}
```

## 建议结论

方向可以保留：

- 常规赛：每场积分继续落在 `match_results.pointsAwarded`
- 淘汰赛：赛事级 placement 积分落在 `tournament_points`
- 排行榜：聚合 `match_results.pointsAwarded.entries` 和 `tournament_points`

但实现前必须先补齐：

- 事务边界
- 幂等键
- 双打展开规则
- BYE 自动晋级
- 淘汰赛改分后的后续节点清理
- 名次边界定义
- 分页聚合
