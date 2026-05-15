# Phase 8 · 录分 + 积分引擎 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现赛事维度的比分录入页（一页搞定整赛事，任意会员可录、admin 一键确认）+ 完整的积分引擎（常规赛 winLoss、单淘汰 placement、改分回滚、排行榜分页聚合）。

**Architecture:** 算法集中在 `cloudfunctions/_shared/award.js` 源文件（不入云函数包），通过 `scripts/sync-shared-libs.sh` 在 pre-commit + CI hash 比对，vendor 复制到 `match-results/lib/award.js` 与 `points-engine/lib/award.js`。状态机集中在 `match-results/lib/state.js`，confirm / reconfirm 编排都在云函数事务里跑。排行榜走"实时聚合 + 复合游标分页"，不维护积分余额表。

**Tech Stack:** Node.js + Jest（lib 覆盖率 90%+，score-rule 100%）+ 微信小程序原生

**Spec 引用:** §5 比分录入 / §6 积分引擎 / §7.5 manage 与 my-match 数据源 / §8 测试策略 / §9 风险

**前置条件:**
- Phase 7 完成（PROGRESS.md 5/6）：`match_results` 是按 Phase 7 的新 schema 落库的；`pointsRules` 双子树存在；BYE 行 `resultStatus='confirmed'` 已就位
- 上一阶段遗留：前端 `utils/bracket-generator.js / scheduler-mirror.js` 也要纳入 sync hash 比对（本 Phase Task 1 一起做）
- 2026-05-15 Phase 7 收尾后的若干实际改动（双打报名按个人 / `_.set()` 包嵌套 / list shape / 跳转参数 / 双打 cell 2 行）必须按下方「2026-05-15 同步修订」节再覆盖一次

**推荐执行方式:** Subagent-driven。Task 1–6（lib + sync 脚本）独立度高，可并行；Task 7+ 是前端 / 落库编排，建议串行盯。Task 4（state machine）最复杂，单独派一个 fresh subagent 跑完整 TDD 循环。

---

## 2026-05-14 Review 修订（执行前按此覆盖原文）

本节是对本 plan 的结构性修订。执行时以这里为准；下方原 Task 中若有冲突，按本节修正后实施。

1. **confirmed 权限硬拦。** `match-results/lib/state.js#submitResult` 必须先判断：`result.resultStatus === 'confirmed' && !submitter.isAdmin` 时抛 `UNAUTHORIZED`（或 `ALREADY_CONFIRMED`），普通会员不得把 confirmed 行覆盖回 submitted。
2. **推进时同步更新下一轮 `match_results`。** Phase 7 已要求预建 R2+ 占位 result 行。本 Phase `confirmOne` 推进 bracket slot 后，必须同步更新下一轮 `match_results` 对应行的 `player1/player2/playerIds/resultStatus='pending'`。当下一轮两边都齐时，录分页自然可提交；不要依赖临时 docId 猜测。
3. **回滚必须靠真实 `position`。** `clearDownstream` 不允许使用 `sourcePositionFromMatchId() return 1` 这种兜底。`match_results` 必须有 `round/position/sourceMatchId`；如果缺失，应从 `tournament_brackets` 反查并写回。
4. **`tournament-score` 拉数据要兼容旧 action 返回。** 当前 `match-results.list` 是旧协议；执行时要么新增 `listByTournament({ tournamentId }) → { success, data:{ results } }`，要么在页面写解包兼容。推荐新增 wrapper，避免页面到处判断。
5. **`score-row` 事件字段统一。** 组件协议写 `submit({ matchId, score })`，示例代码发的是 `{ matchId, newScore }`。执行时统一为 `score`，`reconfirm` 仍用 `{ matchId, newScore }` 或也统一为 `score`，但页面和云函数必须一致。
6. **`scripts/sync-shared-libs.sh` 精确 hash 前提。** Phase 7 的 `bracket-generator.js / scheduler-mirror.js` 必须是 CommonJS 原样复制；本 Phase 不再接受“改 ES module 后仍 hash 比对”的做法。
7. **`tournaments.listByIds` 是本 Phase 明确依赖。** Task 12 的 my-match 会调用它；如果 Phase 7 未实现，Task 12 必须补 `cloudfunctions/tournaments/index.js`，并在 File Structure/commit 中包含该文件。
8. **E2E 前必须确认后续轮 result 行存在。** Task 13 的 Admin 闭环里，首轮确认后半决能否录分是硬门槛：既要 bracket player slot 推进，也要 `match_results` 半决行可在 `tournament-score` 页面显示。

## 2026-05-15 同步修订（Phase 7 收尾后追加，执行前按此再覆盖一次）

Phase 7 在 plan 草案落笔后又做了若干实际改动，本节把这些差异压进 Phase 8 启动口径。下方原 Task 与「2026-05-14 Review 修订」中若与本节冲突，按本节为准。

9. **常规赛双打报名是个人，不是队伍。** Phase 7 实际改成：`tournament-registrations.bulkSet` 对 `tournament.type==='doubles' && tournament.format==='regular'` 不再要求 `partnerId`；reg 行 `partnerId=null`；搭档在 step 3 排程时随机配对，写入 `match.player1.partnerId/partnerName`（同一人在不同场次可与不同搭档组队）。

    - 对 `award.js` 的影响：**无须改算法**。`collectIds(obj, type)` 已经把 `obj.id + obj.partnerId` 都算进 entries，winLoss 双方各自 +rule.win/+rule.loss 即可。
    - 对 state.js `submitResult` 的影响：**权限校验靠 `result.playerIds`**（Phase 7 已写 4 个 id），不能再用 `result.player1.id || result.player2.id` 的简化判断。
    - 对 `tournament-score` UI 的影响：每场 4 名玩家任一可提交。
    - 对 `score-row` 的影响：判断 `match.player1.partnerId` 渲染 2 行布局（A/B vs C/D），与 Phase 7 `schedule-board` / `tournament-detail` 赛程表 cell 一致。

10. **submitter 权限必须用 `playerIds` 校验。** `state.js#submitResult` 在分数校验之后、写 DB 之前补：
    ```js
    if (!submitter.isAdmin && !(result.playerIds || []).includes(submitter._id)) {
      throw new Error('UNAUTHORIZED')
    }
    ```
    spec §6.4 要求"普通会员只能提交自己参与的比赛"，Phase 8 必须落地。原 Task 4 plan 没写这条，**执行时务必补**。

11. **嵌套对象 update 全用 `_.set()`。** Phase 7 踩过坑：TCB SDK 把 `update({ data: { schedulePlan: {...} } })` 内部展开成 dot-path 写入，遇到旧 doc 字段为 `null` 时报 `Cannot create field 'X' in element {schedulePlan: null}`。Phase 8 写 `match_results` 的嵌套对象同样有风险。在 state.js confirmOne / reconfirmMatch / clearDownstream 里：
    ```js
    const _ = db.command
    await db.collection('match_results').doc(id).update({
      data: {
        score: _.set(score),                 // score 是嵌套对象
        pointsAwarded: _.set({ source: 'match', entries }),
        winner: _.set(winner),               // {id, name} 嵌套
        ...
      }
    })
    ```
    清空时用 `_.remove()` 或显式 `_.set(null)`。同理 `tournament_brackets.matches` 用 `_.set(updated)` 整体替换 matches 数组。

12. **`match-results.list` 旧返回 shape 是 raw cloud SDK 结果。** Phase 7 没改 list 协议。`listByTournament({ tournamentId }) → { success, data: { results: [...] } }` **必须新建**而不是覆盖旧 list，page 与 cloud 函数都按这个新 action 来。原 Task 10 代码示例里仍写 `action: 'list', tournamentId`，执行时改成 `action: 'listByTournament', tournamentId`。

13. **录分页 `onLoad` 参数命名。** Phase 7 `tournament-detail` 底部「录入成绩」实际跳的是 `?id=${tournamentId}`（不是 `?tournamentId=`）。Phase 8 Task 10 `onLoad` 必须兼容两者：
    ```js
    onLoad({ tournamentId, id, matchId }) {
      const tid = tournamentId || id
      if (!tid) return wx.showToast({ title: '缺少 tournamentId', icon: 'none' })
      this.setData({ tournamentId: tid, anchorMatchId: matchId || '' })
    }
    ```
    Phase 8 Task 10 顺手把 `tournament-detail.onEnterScore` 改成传 `tournamentId`（也接受两个）。

14. **`matchKind` 三类决定积分边界。** Phase 7 实际产生：
    - `bracket` — 淘汰赛 R1+R2+ 占位（含 BYE walkover）
    - `regularRound` — 常规赛 buildRegularSchedule 生成
    - `extra` — step 3 用户手动加场（regular only）

    state.js 行为：
    - `confirmOne` 推进下一轮**仅** `result.matchKind === 'bracket'`
    - `maybeAwardPlacement` 仅扫 `matchKind === 'bracket'` 行
    - `buildAwardEntries` 不区分 matchKind，所有非 BYE / 非 walkover 的 confirmed match 都给 `winLoss` 积分（regularRound / extra / bracket 一视同仁）
    - `freePlay` 不入 `match_results` 集合（在 `free_plays`），积分忽略

    **拍板**：淘汰赛玩家同时拿 `winLoss` 与 `placement`（不是替代关系）。R1 输家拿 `winLoss.loss + placement.participation`（或 quarterfinal / semifinal，按轮次）。买 plan 的 buildAwardEntries + buildPlacementEntries 双路径同时叠加。如果俱乐部规则不接受叠加，再加一处 toggle。

15. **walkover 字段名义存在但 Phase 8 不实现弃赛入口。** `winLoss.walkover` 是 schema 一部分，commitStep4 normalize 时默认 `0`。但 Phase 8 没有「弃赛」UI 入口，award.js 也不会主动赋 walkover。**保留字段、不实现流程**，留给后续 phase。BYE 行 award `entries: []`（不给 walkover），符合"轮空不进积分"的口径。

16. **`score-row` 双打 2 行布局。** 与 Phase 7 `schedule-board` cell 风格保持一致：组件接收的 `match` 若含 `player1.partnerId`，渲染 2 行 `A/B` vs `C/D`；4 个名字位都不可点（只展示，不在录分页换人）；分数输入只显示一格 4 局比分。

17. **Phase 7 `tournament-manage` 已经分了「我的草稿」+「公开列表」。** Phase 8 Task 11 加「待确认比分队列」时，**插在「我的草稿」之后、公开列表之前**，并复用 `tournaments.list` 已有的过滤。不要破坏现有两块的渲染。

18. **`tournament_registrations.registrationStatus`。** Phase 7 已统一写入 `registrationStatus: 'confirmed'`（旧 `status` 字段废弃）。Phase 8 Task 12 my-match 拉报名时按 `registrationStatus` 过滤，**不要再 fallback 到 `status`**。

19. **`score-rule` 4 局制 + 3:3 抢七是俱乐部规则，写死即可。** Phase 7 没在 wizard 提供规则切换。Phase 8 Task 2 `score-rule.js` 按此规则实现，不要试图从 `tournament.config` 读规则参数（Phase 7 config 已基本废弃）。如果未来要支持 6 局制，再加 config 字段。

20. **执行 Phase 8 前要顺手更新 `cloudfunctions/DATABASE_SCHEMA.md`。** 加：
    - `match_results.matchKind`（bracket / regularRound / extra）
    - `match_results.position / round / sourceMatchId / playerIds`（Phase 7 已写但 schema 未同步）
    - `tournaments.schedulePlan.slotMinutes = 20`（不是 30）
    - `tournaments.createdBy / createdByOpenid` （draft 可见性依赖）
    - `tournament_registrations.registrationStatus`（取代 `status`）
    - `free_plays.{tournamentId, courtId, queueOrder, playerIds}`
    - `courts.{courtId, name, location, enabled}`
    - 写明 regular doubles 报名是个人（`partnerId=null`），knockout doubles 报名是队伍（`partnerId/partnerName/teamName` 必填）

21. **Phase 8 启动前回归验证清单。** 在做 Task 1 之前，跑一遍这几条确保 Phase 7 收尾干净：
    - 创建一个常规赛单打（4 人 / 2 球场） → 走完 step 4 「创建赛事」 → tournament 状态 `upcoming`，`schedulePlan.slotMinutes === 20`
    - 创建一个常规赛双打（4 个人，不组队） → tournament-registrations 4 行 `partnerId=null` → step 3 排程一场 doubles match `player1.partnerId / partnerName` 由前端 random 填好
    - 创建一个淘汰赛单打（6 人 / 2 球场） → bracket R1 4 场（2 BYE 推进到 R2）+ R2/R3 占位 + `match_results` 8 行（BYE 行 `resultStatus='confirmed'`，非 BYE `pending`）
    - tournament-detail 进入：草稿态显示「继续创建」；upcoming 态显示「编辑 + 录入成绩」；赛程区按场地分组渲染对（双打 2 行）
    - 若任一条不通过，先回 Phase 7 修，再进 Phase 8

## 文档纪律

- 每个 Task 结束前 `git status` 干净 + 该 Task 测试全过
- PROGRESS.md 在最后一个 Task 一次性更新
- 实施偏离 plan 时，在文档顶部追加「YYYY-MM-DD 执行决策」节

---

## File Structure

```
cloudfunctions/_shared/                              (新建)
└── award.js                                         - 源 lib（不进云函数包）

cloudfunctions/match-results/                        (大改)
├── index.js                                         - 改 confirm 编排 / 加 submit / confirmAll / reconfirmMatch / submittedQueue / listByTournament / listByPlayer
└── lib/
    ├── award.js                                     - vendored ← _shared/award.js
    ├── score-rule.js                                - 新：4 局 + 3:3 抢七（TDD 100%）
    ├── state.js                                     - 新：状态机 + clearDownstream + placement 触发（TDD 90%+）
    └── __tests__/
        ├── score-rule.test.js
        ├── state.test.js
        └── award.test.js

cloudfunctions/points-engine/                        (重写 + 兼容 wrapper)
├── index.js                                         - actions: recompute / rankAggregate；保留 rankList / playerStats / recalculateMatch wrapper
└── lib/
    ├── award.js                                     - vendored ← _shared/award.js
    ├── aggregate.js                                 - 复合游标分页聚合
    └── __tests__/
        └── aggregate.test.js

scripts/                                             (改/补)
└── sync-shared-libs.sh                              - hash 比对，覆盖云函数 lib + 前端 utils

miniprogram/utils/                                   (改)
└── score-rule.js                                    - 前端 mirror（与 match-results/lib/score-rule.js hash 一致）

miniprogram/components/                              (新)
└── score-row/                                       - 折叠 → 展开内联编辑器
    └── index.{js,json,wxml,wxss}

miniprogram/pages/tournament-score/                  (内容重写)
└── index.{js,wxml,wxss}

miniprogram/pages/tournament-detail/                 (微改)
└── index.js                                         - onEnterScore 协议改 { tournamentId }
miniprogram/pages/manage/                            (微改)
└── index.{js,wxml,wxss}                             - 加待确认比分队列
miniprogram/pages/my-match/                          (微改)
└── index.{js,wxml,wxss}                             - 加可录分比赛行

cloudfunctions/tournaments/                          (补改，如 Phase 7 未做)
└── index.js                                         - listByIds wrapper，供 my-match 拼 tournament name

docs/superpowers/plans/PROGRESS.md                   - 改：Phase 8 完成（最终 6/6）
```

---

## Task 1 · `_shared/award.js` + sync 脚本

**Files:**
- Create: `cloudfunctions/_shared/award.js`
- Create: `cloudfunctions/_shared/__tests__/award.test.js`
- Create: `cloudfunctions/_shared/package.json`
- Create: `scripts/sync-shared-libs.sh`

### Step 1.1 创建 `_shared/` 目录与 jest

- [ ] **Step 1.1**

```bash
mkdir -p cloudfunctions/_shared/__tests__
```

`cloudfunctions/_shared/package.json`:

```json
{
  "name": "_shared",
  "private": true,
  "scripts": { "test": "jest" },
  "devDependencies": { "jest": "^29.7.0" },
  "jest": { "testEnvironment": "node", "testMatch": ["**/__tests__/**/*.test.js"] }
}
```

```bash
cd cloudfunctions/_shared && npm install
```

### Step 1.2 写失败测试

`cloudfunctions/_shared/__tests__/award.test.js`：

```js
const { buildAwardEntries, buildPlacementEntries, ROLE_WINNER, ROLE_LOSER, finalRoundOf } = require('../award')

function singlesMatch(winnerId, loserId) {
  return {
    matchKind: 'bracket', // or regularRound
    player1: { id: winnerId, name: winnerId },
    player2: { id: loserId, name: loserId },
    winner: { id: winnerId, name: winnerId }
  }
}

function doublesMatch(winnerIds, loserIds) {
  return {
    matchKind: 'regularRound',
    player1: { id: winnerIds[0], partnerId: winnerIds[1] },
    player2: { id: loserIds[0], partnerId: loserIds[1] },
    winner: { id: winnerIds[0], partnerId: winnerIds[1] }
  }
}

describe('buildAwardEntries · winLoss', () => {
  const rule = { win: 20, loss: 10, walkover: 0 }

  test('单打胜场 → 2 条 entries', () => {
    const m = singlesMatch('A', 'B')
    const entries = buildAwardEntries(m, rule, 'singles')
    expect(entries).toEqual([
      { memberId: 'A', points: 20, role: ROLE_WINNER },
      { memberId: 'B', points: 10, role: ROLE_LOSER }
    ])
  })

  test('双打胜场 → 4 条 entries（2 win + 2 loss）', () => {
    const m = doublesMatch(['A1', 'A2'], ['B1', 'B2'])
    const entries = buildAwardEntries(m, rule, 'doubles')
    expect(entries).toHaveLength(4)
    expect(entries.filter(e => e.role === ROLE_WINNER).map(e => e.memberId).sort()).toEqual(['A1', 'A2'])
    expect(entries.filter(e => e.role === ROLE_LOSER).map(e => e.memberId).sort()).toEqual(['B1', 'B2'])
    expect(entries.every(e => e.role === ROLE_WINNER ? e.points === 20 : e.points === 10)).toBe(true)
  })

  test('BYE walkover → entries 为空', () => {
    const m = { ...singlesMatch('A', 'BYE'), bye: true, status: 'walkover' }
    expect(buildAwardEntries(m, rule, 'singles')).toEqual([])
  })
})

describe('finalRoundOf', () => {
  test('4 槽 → 2', () => expect(finalRoundOf(4)).toBe(2))
  test('8 槽 → 3', () => expect(finalRoundOf(8)).toBe(3))
  test('16 槽 → 4', () => expect(finalRoundOf(16)).toBe(4))
})

describe('buildPlacementEntries', () => {
  // 入参：所有轮次 brackets（R1..final）+ pointsRules.placement
  const placement = { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 }

  test('4 人 / 4 槽 / final=2 → 无 QF / 无 participation', () => {
    const brackets = [
      { round: 1, matches: [
        { matchId: 'r1m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'B' } },
        { matchId: 'r1m2', winner: { id: 'C' }, player1: { id: 'C' }, player2: { id: 'D' } }
      ]},
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A' }, player1: { id: 'A' }, player2: { id: 'C' } }
      ]}
    ]
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const byId = Object.fromEntries(entries.map(e => [e.memberId, e]))
    expect(byId['A']).toEqual(expect.objectContaining({ rank: 'champion', points: 100 }))
    expect(byId['C']).toEqual(expect.objectContaining({ rank: 'runnerUp', points: 70 }))
    expect(byId['B']).toEqual(expect.objectContaining({ rank: 'semifinal', points: 50 }))
    expect(byId['D']).toEqual(expect.objectContaining({ rank: 'semifinal', points: 50 }))
  })

  test('12 人 / 16 槽 / final=4 → R1 败者 = participation / R2 败者 = QF / R3 败者 = SF', () => {
    const brackets = makeBracketsForCount(12) // 4 BYE 自动晋级，下面手算
    const entries = buildPlacementEntries(brackets, placement, 'singles')
    const champion = entries.find(e => e.rank === 'champion')
    const qfBucket = entries.filter(e => e.rank === 'quarterfinal')
    const sfBucket = entries.filter(e => e.rank === 'semifinal')
    const r1Bucket = entries.filter(e => e.rank === 'participation')
    expect(champion).toBeDefined()
    expect(qfBucket.length).toBeGreaterThan(0)
    expect(sfBucket.length).toBe(2)
    expect(r1Bucket.length).toBeGreaterThan(0)
  })

  test('双打 placement → 队伍内 2 人各拿同一个桶的积分', () => {
    const brackets = [
      { round: 1, matches: [
        { matchId: 'r1m1', winner: { id: 'A1', partnerId: 'A2' }, player1: { id: 'A1', partnerId: 'A2' }, player2: { id: 'B1', partnerId: 'B2' } },
        { matchId: 'r1m2', winner: { id: 'C1', partnerId: 'C2' }, player1: { id: 'C1', partnerId: 'C2' }, player2: { id: 'D1', partnerId: 'D2' } }
      ]},
      { round: 2, matches: [
        { matchId: 'r2m1', winner: { id: 'A1', partnerId: 'A2' }, player1: { id: 'A1', partnerId: 'A2' }, player2: { id: 'C1', partnerId: 'C2' } }
      ]}
    ]
    const entries = buildPlacementEntries(brackets, placement, 'doubles')
    expect(entries.filter(e => e.rank === 'champion').map(e => e.memberId).sort()).toEqual(['A1', 'A2'])
    expect(entries.filter(e => e.rank === 'runnerUp').map(e => e.memberId).sort()).toEqual(['C1', 'C2'])
    expect(entries.filter(e => e.rank === 'semifinal').map(e => e.memberId).sort()).toEqual(['B1', 'B2', 'D1', 'D2'])
  })
})

// helper：生成 12 人完整 bracket（手工固定，方便断言）
function makeBracketsForCount(N) {
  // 简化：直接构造 4 / 8 / 12 / 16 的 brackets。完整版按 §6.4 测试用例展开。
  // 实施时按真实数据展开即可，本测试块在 Task 1 实现完后跑通。
  // 12 人 → 16 槽：4 BYE 直接晋 R2；R2 8 场打完出 4；R3 4 场打完出 2；R4 决赛。
  // 这里仅返回一个可以让 buildPlacementEntries 不崩溃的最小骨架。
  return [/* 见 Task 1.3 提供完整 fixture */]
}
```

> Task 1.3 实现时把 `makeBracketsForCount(12)` 用真实 16 槽 brackets 写出来（参考 cloudfunctions/tournament-brackets/lib/generator.js 的输出）。本 plan 不在文档里全展开，但 fixture 必须写实，不能用空数组。

### Step 1.3 跑测试 — 应失败

```bash
cd cloudfunctions/_shared && npx jest award
```

### Step 1.4 实现 `award.js`

```js
const ROLE_WINNER = 'winner'
const ROLE_LOSER  = 'loser'

function buildAwardEntries(match, rule, type) {
  if (match.bye || match.status === 'walkover') return []
  if (!match.winner || !match.winner.id) return []

  const winnerIds = collectIds(match.winner, type)
  const loserSide = matchSideOpposite(match)
  const loserIds  = collectIds(loserSide, type)

  const entries = []
  for (const id of winnerIds) entries.push({ memberId: id, points: rule.win,  role: ROLE_WINNER })
  for (const id of loserIds)  entries.push({ memberId: id, points: rule.loss, role: ROLE_LOSER })
  return entries
}

function collectIds(obj, type) {
  if (!obj || !obj.id) return []
  const out = [obj.id]
  if (type === 'doubles' && obj.partnerId) out.push(obj.partnerId)
  return out
}

function matchSideOpposite(m) {
  if (!m.winner) return null
  const p1Id = m.player1?.id, p2Id = m.player2?.id
  if (p1Id && p1Id === m.winner.id) return m.player2
  if (p2Id && p2Id === m.winner.id) return m.player1
  // 双打：winner 用 player1.partnerId 也算 player1 阵营
  if (m.player1?.partnerId === m.winner.id) return m.player2
  if (m.player2?.partnerId === m.winner.id) return m.player1
  return null
}

function finalRoundOf(slots) {
  if (slots < 2) return 1
  return Math.log2(slots) | 0
}

function buildPlacementEntries(brackets, placement, type) {
  if (!brackets || brackets.length === 0) return []
  const sorted = [...brackets].sort((a, b) => a.round - b.round)
  const r1 = sorted[0]
  const slots = (r1.matches || []).length * 2
  const finalRound = finalRoundOf(slots)
  const final = sorted.find(b => b.round === finalRound)
  if (!final || !final.matches[0] || !final.matches[0].winner) return []

  const buckets = new Map()  // memberId → { rank, points }
  const setBucket = (id, rank) => {
    if (!id) return
    if (buckets.has(id)) return  // 已有更高桶（外层先设的） → 不覆盖
    buckets.set(id, { memberId: id, rank, points: placement[rank] })
  }

  // 冠军 = final winner（含 partnerId）
  const championSide = final.matches[0].winner
  collectIds(championSide, type).forEach(id => setBucket(id, 'champion'))

  // 亚军 = final loser side
  const finalLoser = matchSideOpposite(final.matches[0])
  collectIds(finalLoser, type).forEach(id => setBucket(id, 'runnerUp'))

  // semifinal = finalRound - 1 的所有 loser
  const sfRound = finalRound - 1
  if (sfRound >= 1) {
    const sf = sorted.find(b => b.round === sfRound)
    for (const m of (sf?.matches || [])) {
      const loser = matchSideOpposite(m)
      collectIds(loser, type).forEach(id => setBucket(id, 'semifinal'))
    }
  }

  // quarterfinal = finalRound - 2 的所有 loser（仅 slots >= 8）
  const qfRound = finalRound - 2
  if (qfRound >= 1 && slots >= 8) {
    const qf = sorted.find(b => b.round === qfRound)
    for (const m of (qf?.matches || [])) {
      const loser = matchSideOpposite(m)
      collectIds(loser, type).forEach(id => setBucket(id, 'quarterfinal'))
    }
  }

  // participation = R1..(finalRound-3) 的所有 loser
  for (let r = 1; r < finalRound - 2; r++) {
    if (slots < 8) continue  // 4 槽时 finalRound-3 < 1
    const round = sorted.find(b => b.round === r)
    for (const m of (round?.matches || [])) {
      if (m.bye) continue
      const loser = matchSideOpposite(m)
      collectIds(loser, type).forEach(id => setBucket(id, 'participation'))
    }
  }

  return [...buckets.values()]
}

module.exports = { buildAwardEntries, buildPlacementEntries, finalRoundOf, ROLE_WINNER, ROLE_LOSER }
```

### Step 1.5 跑测试 — 全过 + 覆盖率 ≥ 95%

```bash
cd cloudfunctions/_shared && npx jest -- --coverage
```

### Step 1.6 写 sync 脚本

`scripts/sync-shared-libs.sh`：

```bash
#!/usr/bin/env bash
# 比对 _shared/award.js 与各 vendored 副本的 hash；不一致 fail。
# 在 pre-commit + CI 跑。
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/cloudfunctions/_shared/award.js"
COPIES=(
  "$ROOT/cloudfunctions/match-results/lib/award.js"
  "$ROOT/cloudfunctions/points-engine/lib/award.js"
)

# 算法 mirror（前端用）
FE_MIRRORS=(
  # score-rule 是单独算法，单独算 hash
  "src=$ROOT/cloudfunctions/match-results/lib/score-rule.js;copy=$ROOT/miniprogram/utils/score-rule.js"
  # bracket-generator / scheduler-mirror 来自 Phase 7
  "src=$ROOT/cloudfunctions/tournament-brackets/lib/generator.js;copy=$ROOT/miniprogram/utils/bracket-generator.js"
  "src=$ROOT/cloudfunctions/tournament-brackets/lib/scheduler.js;copy=$ROOT/miniprogram/utils/scheduler-mirror.js"
)

shasum256() { shasum -a 256 "$1" | awk '{print $1}'; }

# 1. award.js
src_hash=$(shasum256 "$SRC")
for copy in "${COPIES[@]}"; do
  if [ ! -f "$copy" ]; then echo "[sync] missing: $copy"; exit 1; fi
  cp_hash=$(shasum256 "$copy")
  if [ "$src_hash" != "$cp_hash" ]; then
    echo "[sync] hash mismatch: $copy"
    diff "$SRC" "$copy" || true
    exit 1
  fi
done
echo "[sync] award.js ok"

# 2. 算法 mirror（两两比较）
for pair in "${FE_MIRRORS[@]}"; do
  eval "$pair"
  if [ ! -f "$src" ] || [ ! -f "$copy" ]; then
    echo "[sync] missing pair: $pair"; exit 1
  fi
  if [ "$(shasum256 "$src")" != "$(shasum256 "$copy")" ]; then
    echo "[sync] mirror mismatch: $src ↔ $copy"
    diff "$src" "$copy" || true
    exit 1
  fi
done
echo "[sync] mirrors ok"
```

```bash
chmod +x scripts/sync-shared-libs.sh
```

### Step 1.7 接入 pre-commit hook

`.git/hooks/pre-commit`（不入版控；项目README记录）；或者用 husky。最简方式：

`package.json`（项目根）加 npm script：

```json
{ "scripts": { "sync:check": "bash scripts/sync-shared-libs.sh" } }
```

> **决策点：** 如果项目根没有 package.json，本步骤跳过 husky，仅在 commit 时手动跑 `npm run sync:check`（或加到 PROGRESS.md 检查清单）。

### Step 1.8 commit

```bash
git add cloudfunctions/_shared/ scripts/sync-shared-libs.sh
git commit -m "feat(_shared): award.js + sync 脚本 · Phase 8 Task 1"
```

> 注：本 Task **不**把 award.js 复制到 match-results / points-engine，那两步在 Task 3 / Task 6 各自做。

---

## Task 2 · `match-results/lib/score-rule.js`（TDD，目标 100%）

**Files:**
- Create: `cloudfunctions/match-results/lib/__tests__/score-rule.test.js`
- Create: `cloudfunctions/match-results/lib/score-rule.js`

### Step 2.1 写失败测试

```js
const { validateScore, computeWinner } = require('../score-rule')

describe('validateScore', () => {
  test('4:0 → valid，winner=a', () => {
    expect(validateScore(4, 0, null)).toEqual({ valid: true, winner: 'a' })
  })
  test('4:1 → valid，winner=a', () => {
    expect(validateScore(4, 1, null)).toEqual({ valid: true, winner: 'a' })
  })
  test('4:2 → valid，winner=a', () => {
    expect(validateScore(4, 2, null)).toEqual({ valid: true, winner: 'a' })
  })
  test('2:4 → valid，winner=b', () => {
    expect(validateScore(2, 4, null)).toEqual({ valid: true, winner: 'b' })
  })
  test('3:3 没抢七 → invalid', () => {
    const r = validateScore(3, 3, null)
    expect(r.valid).toBe(false)
    expect(r.error).toBeDefined()
  })
  test('3:3 + tb 7-5 → valid，winner=a', () => {
    expect(validateScore(3, 3, '7-5')).toEqual({ valid: true, winner: 'a' })
  })
  test('3:3 + tb 5-7 → valid，winner=b', () => {
    expect(validateScore(3, 3, '5-7')).toEqual({ valid: true, winner: 'b' })
  })
  test('3:3 + tb 6-4 → invalid（max<7）', () => {
    expect(validateScore(3, 3, '6-4').valid).toBe(false)
  })
  test('3:3 + tb 8-7 → invalid（差<2）', () => {
    expect(validateScore(3, 3, '8-7').valid).toBe(false)
  })
  test('3:3 + tb 格式错 → invalid', () => {
    expect(validateScore(3, 3, '七比五').valid).toBe(false)
    expect(validateScore(3, 3, '7,5').valid).toBe(false)
    expect(validateScore(3, 3, '').valid).toBe(false)
  })
  test('4:3 直接录 → invalid', () => {
    expect(validateScore(4, 3, null).valid).toBe(false)
  })
  test('4:4 → invalid', () => {
    expect(validateScore(4, 4, null).valid).toBe(false)
  })
  test('3:2 → invalid（max<4）', () => {
    expect(validateScore(3, 2, null).valid).toBe(false)
  })
  test('-1:4 → invalid（负数）', () => {
    expect(validateScore(-1, 4, null).valid).toBe(false)
  })
  test('5:0 → invalid（max>4）', () => {
    expect(validateScore(5, 0, null).valid).toBe(false)
  })
})

describe('computeWinner', () => {
  test('valid + winner=a → 返回 player1 引用', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    const w = computeWinner(m, { a: 4, b: 2, tiebreak: null })
    expect(w).toEqual({ id: 'p1' })
  })
  test('invalid → null', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    expect(computeWinner(m, { a: 4, b: 3, tiebreak: null })).toBeNull()
  })
  test('3:3 + tb 7-5 → winner=player1', () => {
    const m = { player1: { id: 'p1' }, player2: { id: 'p2' } }
    expect(computeWinner(m, { a: 3, b: 3, tiebreak: '7-5' })).toEqual({ id: 'p1' })
  })
})
```

### Step 2.2 跑测试，应失败

```bash
cd cloudfunctions/match-results && npx jest score-rule
```

### Step 2.3 实现 `score-rule.js`

```js
function validateScore(a, b, tiebreak) {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return { valid: false, error: 'NEG' }
  const max = Math.max(a, b)
  if (max < 4) return { valid: false, error: 'UNDER_4' }
  if (max > 4) return { valid: false, error: 'OVER_4' }
  if (a === 3 && b === 3) {
    if (!tiebreak || typeof tiebreak !== 'string') return { valid: false, error: 'TB_REQUIRED' }
    const m = /^(\d+)-(\d+)$/.exec(tiebreak)
    if (!m) return { valid: false, error: 'TB_FORMAT' }
    const x = Number(m[1]), y = Number(m[2])
    if (x < 0 || y < 0) return { valid: false, error: 'TB_NEG' }
    if (Math.max(x, y) < 7) return { valid: false, error: 'TB_UNDER_7' }
    if (Math.abs(x - y) < 2) return { valid: false, error: 'TB_DIFF' }
    return { valid: true, winner: x > y ? 'a' : 'b' }
  }
  // 已知 max === 4
  if (a === 4 && b < 4) return { valid: true, winner: 'a' }
  if (b === 4 && a < 4) return { valid: true, winner: 'b' }
  // 4:3 不允许直接录
  if ((a === 4 && b === 3) || (a === 3 && b === 4)) return { valid: false, error: 'NEED_TB' }
  if (a === 4 && b === 4) return { valid: false, error: '4_4' }
  return { valid: false, error: 'OTHER' }
}

function computeWinner(match, { a, b, tiebreak }) {
  const r = validateScore(a, b, tiebreak)
  if (!r.valid) return null
  return r.winner === 'a' ? match.player1 : match.player2
}

module.exports = { validateScore, computeWinner }
```

### Step 2.4 跑测试 — 100% pass + 覆盖率 ≥ 100%

```bash
cd cloudfunctions/match-results && npx jest score-rule -- --coverage
```

### Step 2.5 commit

```bash
git add cloudfunctions/match-results/lib/score-rule.js cloudfunctions/match-results/lib/__tests__/score-rule.test.js
git commit -m "feat(match-results): score-rule · 4 局制 + 3:3 抢七 · Phase 8 Task 2"
```

---

## Task 3 · vendor award.js 到 match-results 与 points-engine

**Files:**
- Copy: `cloudfunctions/_shared/award.js` → `cloudfunctions/match-results/lib/award.js`
- Copy: `cloudfunctions/_shared/award.js` → `cloudfunctions/points-engine/lib/award.js`

- [ ] **Step 3.1** 物理复制

```bash
cp cloudfunctions/_shared/award.js cloudfunctions/match-results/lib/award.js
cp cloudfunctions/_shared/award.js cloudfunctions/points-engine/lib/award.js
```

- [ ] **Step 3.2** 跑 sync 脚本验证 hash 一致

```bash
bash scripts/sync-shared-libs.sh
```

期望输出 `[sync] award.js ok` 等。

- [ ] **Step 3.3** 各自跑测试（仅 import 测试，award 实测在 _shared 里跑过；此处只看不破坏旧测试）

```bash
cd cloudfunctions/match-results && npx jest
cd cloudfunctions/points-engine && npx jest
```

- [ ] **Step 3.4 commit**

```bash
git add cloudfunctions/match-results/lib/award.js cloudfunctions/points-engine/lib/award.js
git commit -m "chore: vendor _shared/award.js → match-results/points-engine · Phase 8 Task 3"
```

---

## Task 4 · `match-results/lib/state.js`（状态机 + 改分回滚 + placement 触发，TDD 90%+）

**Files:**
- Create: `cloudfunctions/match-results/lib/__tests__/state.test.js`
- Create: `cloudfunctions/match-results/lib/state.js`

> **职责（spec §5.3 / §6.5）：**
> - `submitResult(matchId, score, submitter)` → 单条提交（pending/submitted → submitted）；管理员提交直接 confirmed
> - `confirmAll(tournamentId, admin)` → 所有 `submitted` 一次性 confirm；幂等
> - `reconfirmMatch(matchId, newScore, admin)` → 改分；winner 翻盘则清后续 bracket + placement、tournament.status='ongoing'
> - `clearDownstream(tournamentId, oldMatch)` → 把 R+1 的对应 slot 重置为 null（仅 bracket）
> - `awardPlacementIfFinal(tournamentId)` → 决赛 confirmed 且所有 bracket confirm → 写 `tournament_points`
>
> 本 lib 是**纯函数 + 注入 db 句柄**，方便单测 mock。

> **2026-05-14 修订：** `submitResult` 必须拒绝普通会员修改 confirmed 行；`confirmOne` 推进 bracket 后必须同步更新下一轮已预建的 `match_results` 占位行；`clearDownstream` 必须依赖真实 `round/position` 或从 bracket 反查，不允许默认 position=1。

### Step 4.1 设计 lib 接口

```js
// state.js exports：
//   createMatchStateService(deps)
//     deps: { db, awardLib, scoreRule }
//   返回 { submitResult, confirmAll, reconfirmMatch, awardPlacementIfFinal, clearDownstream }
```

### Step 4.2 写失败测试（用 in-memory fake db）

```js
const { createMatchStateService } = require('../state')
const award = require('../award')
const scoreRule = require('../score-rule')

function makeDb(seed) {
  const collections = JSON.parse(JSON.stringify(seed))
  return {
    collection(name) {
      const rows = collections[name] = collections[name] || []
      return {
        doc(id) {
          return {
            async get() {
              const r = rows.find(x => x._id === id)
              return { data: r }
            },
            async update({ data }) {
              const r = rows.find(x => x._id === id)
              if (!r) throw new Error('not found')
              Object.assign(r, data)
            },
            async set({ data }) {
              const idx = rows.findIndex(x => x._id === id)
              if (idx < 0) rows.push({ ...data, _id: id })
              else rows[idx] = { ...data, _id: id }
            },
            async remove() {
              const idx = rows.findIndex(x => x._id === id)
              if (idx >= 0) rows.splice(idx, 1)
            }
          }
        },
        where(filter) {
          const matchFn = row => Object.entries(filter).every(([k, v]) => row[k] === v)
          return {
            async get() { return { data: rows.filter(matchFn) } },
            async remove() {
              const before = rows.length
              for (let i = rows.length - 1; i >= 0; i--) if (matchFn(rows[i])) rows.splice(i, 1)
              return { deleted: before - rows.length }
            }
          }
        }
      }
    },
    __all: () => collections
  }
}

// 用 seed 构造一个 4 人 single 单淘汰：R1 2 场 + R2 1 场（占位）
function seed4Knockout() {
  return {
    tournaments: [{
      _id: 'T1', seasonId: 'S1', type: 'singles', format: 'knockout',
      pointsRules: { winLoss: { win: 20, loss: 10, walkover: 0 }, placement: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 } },
      status: 'ongoing'
    }],
    tournament_brackets: [
      { _id: 'bracket_T1_round_1', tournamentId: 'T1', round: 1, type: 'singles', matches: [
        { matchId: 'r1m1', round: 1, position: 1, player1: { id: 'A' }, player2: { id: 'B' }, bye: false, status: 'pending', resultStatus: 'pending', winner: null },
        { matchId: 'r1m2', round: 1, position: 2, player1: { id: 'C' }, player2: { id: 'D' }, bye: false, status: 'pending', resultStatus: 'pending', winner: null }
      ]},
      { _id: 'bracket_T1_round_2', tournamentId: 'T1', round: 2, type: 'singles', matches: [
        { matchId: 'r2m1', round: 2, position: 1, player1: null, player2: null, bye: false, status: 'pending', resultStatus: 'pending', winner: null }
      ]}
    ],
    match_results: [
      { _id: 'result_T1_r1m1', tournamentId: 'T1', sourceMatchId: 'r1m1', matchKind: 'bracket', round: 1,
        player1: { id: 'A' }, player2: { id: 'B' }, playerIds: ['A','B'],
        resultStatus: 'pending', winner: null, pointsAwarded: null,
        tournamentType: 'singles', seasonId: 'S1', confirmedBy: null, confirmedAt: null },
      { _id: 'result_T1_r1m2', tournamentId: 'T1', sourceMatchId: 'r1m2', matchKind: 'bracket', round: 1,
        player1: { id: 'C' }, player2: { id: 'D' }, playerIds: ['C','D'],
        resultStatus: 'pending', winner: null, pointsAwarded: null,
        tournamentType: 'singles', seasonId: 'S1', confirmedBy: null, confirmedAt: null }
    ],
    tournament_points: []
  }
}

describe('submitResult', () => {
  test('pending → admin submit → confirmed + award', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const rows = db.__all().match_results
    const r = rows.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('confirmed')
    expect(r.pointsAwarded.entries.length).toBe(2)
    expect(r.pointsAwarded.entries.find(e => e.memberId === 'A').role).toBe('winner')
  })

  test('pending → player submit → submitted（无 award）', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'm_player', isAdmin: false } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('submitted')
    expect(r.pointsAwarded).toBeNull()
  })

  test('submitted → 任意会员覆盖 → submitted（旧丢）', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'p1', isAdmin: false } })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'p2', isAdmin: false } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('submitted')
    expect(r.score.sets[0]).toEqual({ a: 4, b: 0 })
  })

  test('invalid score（4:3 直接录） → 抛 INVALID_SCORE', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 3 }], tiebreak: null }, submitter: { _id: 'a', isAdmin: true } }))
      .rejects.toThrow('INVALID_SCORE')
  })
})

describe('confirmAll', () => {
  test('admin confirmAll → 所有 submitted 变 confirmed + award', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'p', isAdmin: false } })
    await svc.submitResult({ matchId: 'r1m2', score: { sets: [{ a: 4, b: 1 }], tiebreak: null }, submitter: { _id: 'p', isAdmin: false } })
    const r = await svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'admin1', isAdmin: true } })
    expect(r.confirmedCount).toBe(2)
    const rows = db.__all().match_results.filter(x => x.tournamentId === 'T1')
    expect(rows.every(x => x.resultStatus === 'confirmed')).toBe(true)
  })

  test('幂等：再次 confirmAll → confirmedCount=0', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'p', isAdmin: false } })
    await svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'admin1', isAdmin: true } })
    const r = await svc.confirmAll({ tournamentId: 'T1', admin: { _id: 'admin1', isAdmin: true } })
    expect(r.confirmedCount).toBe(0)
  })
})

describe('reconfirmMatch · winner 翻盘', () => {
  test('清后续 bracket + placement + tournament.status=ongoing', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    // R1 全确认
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'a', isAdmin: true } })
    await svc.submitResult({ matchId: 'r1m2', score: { sets: [{ a: 4, b: 1 }], tiebreak: null }, submitter: { _id: 'a', isAdmin: true } })
    // R2 = A vs C，confirm A 胜 → 应触发 placement 入库
    // 推进：r1m1 winner = A 应该被推到 r2m1.player1；r1m2 winner = C 应该被推到 r2m1.player2
    // 这里手动模拟推进（spec §6.3 在云函数事务里做，本 lib 不一定负责推进）
    const r2 = db.__all().tournament_brackets.find(b => b.round === 2)
    r2.matches[0].player1 = { id: 'A' }
    r2.matches[0].player2 = { id: 'C' }
    db.__all().match_results.push({
      _id: 'result_T1_r2m1', tournamentId: 'T1', sourceMatchId: 'r2m1', matchKind: 'bracket', round: 2,
      player1: { id: 'A' }, player2: { id: 'C' }, playerIds: ['A','C'],
      resultStatus: 'pending', winner: null, pointsAwarded: null,
      tournamentType: 'singles', seasonId: 'S1', confirmedBy: null, confirmedAt: null
    })
    await svc.submitResult({ matchId: 'r2m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    expect(db.__all().tournament_points.length).toBeGreaterThan(0)
    const t = db.__all().tournaments[0]
    expect(t.status).toBe('completed')

    // 现在改 r1m1 让 B 赢，winner 翻盘
    await svc.reconfirmMatch({ matchId: 'r1m1', newScore: { sets: [{ a: 1, b: 4 }], tiebreak: null }, admin: { _id: 'admin1', isAdmin: true } })

    // 校验：r2m1.player1 被清成 null（旧 A 已不在）；r2m1 结果清空；tournament_points 清空；tournament.status='ongoing'
    const r2After = db.__all().tournament_brackets.find(b => b.round === 2)
    expect(r2After.matches[0].player1).toBeNull()
    expect(r2After.matches[0].winner).toBeNull()
    const r2Result = db.__all().match_results.find(x => x._id === 'result_T1_r2m1')
    expect(r2Result.resultStatus).toBe('pending')
    expect(db.__all().tournament_points.length).toBe(0)
    expect(db.__all().tournaments[0].status).toBe('ongoing')
  })

  test('reconfirm winner 不变 → 仅覆盖 entries，不清后续', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 0 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await svc.reconfirmMatch({ matchId: 'r1m1', newScore: { sets: [{ a: 4, b: 2 }], tiebreak: null }, admin: { _id: 'admin1', isAdmin: true } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.score.sets[0]).toEqual({ a: 4, b: 2 })
    expect(r.pointsAwarded.entries.length).toBe(2)
    // R2 未受影响
    const r2 = db.__all().tournament_brackets.find(b => b.round === 2)
    expect(r2.matches[0]).toBeDefined()
  })

  test('重复 confirm 同一场 → 不产生重复 entries（update 覆盖）', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'admin1', isAdmin: true } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.pointsAwarded.entries.length).toBe(2)
  })
})

describe('权限', () => {
  test('未登录提交 → 抛 UNAUTHORIZED', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await expect(svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: null }))
      .rejects.toThrow('UNAUTHORIZED')
  })

  test('任意已登录会员可提交任意场次（不限参赛双方）', async () => {
    const db = makeDb(seed4Knockout())
    const svc = createMatchStateService({ db, awardLib: award, scoreRule })
    await svc.submitResult({ matchId: 'r1m1', score: { sets: [{ a: 4, b: 2 }], tiebreak: null }, submitter: { _id: 'm_stranger', isAdmin: false } })
    const r = db.__all().match_results.find(x => x._id === 'result_T1_r1m1')
    expect(r.resultStatus).toBe('submitted')
  })
})
```

### Step 4.3 跑测试 — 应失败

```bash
cd cloudfunctions/match-results && npx jest state
```

### Step 4.4 实现 `state.js`

```js
function createMatchStateService({ db, awardLib, scoreRule }) {
  async function submitResult({ matchId, score, submitter }) {
    if (!submitter || !submitter._id) throw new Error('UNAUTHORIZED')
    const sets0 = score?.sets?.[0]
    if (!sets0) throw new Error('INVALID_SCORE')
    const v = scoreRule.validateScore(sets0.a, sets0.b, score.tiebreak || null)
    if (!v.valid) throw new Error('INVALID_SCORE')

    const result = await findResultByMatchId(matchId)
    if (!result) throw new Error('NOT_FOUND')
    const tournament = await getTournament(result.tournamentId)
    const winner = scoreRule.computeWinner({ player1: result.player1, player2: result.player2 }, { a: sets0.a, b: sets0.b, tiebreak: score.tiebreak || null })

    if (submitter.isAdmin) {
      await confirmOne(result, tournament, score, winner, submitter)
      await maybeAwardPlacement(tournament._id)
    } else {
      await db.collection('match_results').doc(result._id).update({
        data: {
          score, resultStatus: 'submitted',
          // 注意：不写 winner 字段（避免误以为已确认）
        }
      })
    }
  }

  async function confirmAll({ tournamentId, admin }) {
    if (!admin?.isAdmin) throw new Error('UNAUTHORIZED')
    const submitted = (await db.collection('match_results').where({ tournamentId, resultStatus: 'submitted' }).get()).data
    let count = 0
    for (const r of submitted) {
      const sets0 = r.score?.sets?.[0]
      if (!sets0) continue
      const winner = scoreRule.computeWinner({ player1: r.player1, player2: r.player2 }, { a: sets0.a, b: sets0.b, tiebreak: r.score.tiebreak || null })
      const tournament = await getTournament(tournamentId)
      await confirmOne(r, tournament, r.score, winner, admin)
      count++
    }
    await maybeAwardPlacement(tournamentId)
    return { confirmedCount: count }
  }

  async function reconfirmMatch({ matchId, newScore, admin }) {
    if (!admin?.isAdmin) throw new Error('UNAUTHORIZED')
    const result = await findResultByMatchId(matchId)
    if (!result) throw new Error('NOT_FOUND')
    const tournament = await getTournament(result.tournamentId)
    const sets0 = newScore?.sets?.[0]
    if (!sets0) throw new Error('INVALID_SCORE')
    const v = scoreRule.validateScore(sets0.a, sets0.b, newScore.tiebreak || null)
    if (!v.valid) throw new Error('INVALID_SCORE')

    const oldWinnerId = result.winner?.id
    const newWinner   = scoreRule.computeWinner({ player1: result.player1, player2: result.player2 }, { a: sets0.a, b: sets0.b, tiebreak: newScore.tiebreak || null })

    if (result.matchKind === 'bracket' && oldWinnerId && newWinner && oldWinnerId !== newWinner.id) {
      // winner 翻盘 → 清后续 bracket / placement / status
      await clearDownstream(result.tournamentId, result)
      await db.collection('tournament_points').where({ tournamentId: result.tournamentId }).remove()
      await db.collection('tournaments').doc(result.tournamentId).update({ data: { status: 'ongoing' } })
    }

    await confirmOne(result, tournament, newScore, newWinner, admin)
    await maybeAwardPlacement(result.tournamentId)
  }

  async function clearDownstream(tournamentId, oldMatch) {
    // 找到 R+1 对应 slot 清成 null；同时把该 R+1 match 的 winner / score / pointsAwarded 清空
    if (!oldMatch || !oldMatch.round) return
    const nextRound = oldMatch.round + 1
    const docId = `bracket_${tournamentId}_round_${nextRound}`
    const doc = (await db.collection('tournament_brackets').doc(docId).get()).data
    if (!doc) return
    const nextPosition = Math.ceil((oldMatch.position || 1) / 2)
    const slot = ((oldMatch.position || 1) % 2 === 1) ? 'player1' : 'player2'
    const idx = doc.matches.findIndex(m => m.position === nextPosition)
    if (idx < 0) return
    const updated = [...doc.matches]
    updated[idx] = {
      ...updated[idx],
      [slot]: null,
      winner: null,
      status: 'pending',
      resultStatus: 'pending'
    }
    await db.collection('tournament_brackets').doc(docId).update({ data: { matches: updated } })

    // 把下一轮对应的 match_results 行也清空
    const nextMatchId = updated[idx].matchId
    const nextResultId = `result_${tournamentId.replace('tournament_', '')}_${nextMatchId}`
    const nextResult = (await db.collection('match_results').doc(nextResultId).get()).data
    if (nextResult) {
      await db.collection('match_results').doc(nextResultId).update({
        data: { score: null, resultStatus: 'pending', winner: null, pointsAwarded: null, confirmedBy: null, confirmedAt: null,
                [slot]: null }
      })
      // 继续递归往后清
      await clearDownstream(tournamentId, nextResult)
    }
  }

  async function awardPlacementIfFinal(tournamentId) {
    return maybeAwardPlacement(tournamentId)
  }

  // —— 内部 ——

  async function confirmOne(result, tournament, score, winner, admin) {
    const entries = awardLib.buildAwardEntries(
      { ...result, score, winner: winner || result.winner },
      tournament.pointsRules.winLoss,
      tournament.type
    )
    await db.collection('match_results').doc(result._id).update({
      data: {
        score,
        resultStatus: 'confirmed',
        winner: winner || result.winner,
        winnerId: (winner || result.winner)?.id || null,
        confirmedBy: admin._id,
        confirmedAt: new Date(),
        pointsAwarded: { source: 'match', entries }
      }
    })
    // bracket：推进下一轮
    if (result.matchKind === 'bracket' && winner) {
      const docId = `bracket_${result.tournamentId}_round_${(result.round || 1) + 1}`
      const nextDoc = (await db.collection('tournament_brackets').doc(docId).get()).data
      if (nextDoc) {
        const nextPosition = Math.ceil((result.position || sourcePositionFromMatchId(result)) / 2)
        const slot = (((result.position || sourcePositionFromMatchId(result)) % 2 === 1)) ? 'player1' : 'player2'
        const idx = nextDoc.matches.findIndex(m => m.position === nextPosition)
        if (idx >= 0) {
          const updated = [...nextDoc.matches]
          updated[idx] = { ...updated[idx], [slot]: winner }
          await db.collection('tournament_brackets').doc(docId).update({ data: { matches: updated } })
        }
      }
    }
  }

  async function maybeAwardPlacement(tournamentId) {
    const t = await getTournament(tournamentId)
    if (!t || t.format !== 'knockout') return
    const brackets = (await db.collection('tournament_brackets').where({ tournamentId }).get()).data
    const finalRound = awardLib.finalRoundOf((brackets.find(b => b.round === 1)?.matches || []).length * 2)
    const final = brackets.find(b => b.round === finalRound)
    if (!final || !final.matches[0]?.winner) return
    // 所有 bracket match_results 都 confirmed？
    const all = (await db.collection('match_results').where({ tournamentId, matchKind: 'bracket' }).get()).data
    if (all.some(r => !r.bye && r.resultStatus !== 'confirmed')) return

    const entries = awardLib.buildPlacementEntries(brackets, t.pointsRules.placement, t.type)
    const now = new Date()
    for (const e of entries) {
      const _id = `${tournamentId}_${e.memberId}_placement`
      await db.collection('tournament_points').doc(_id).set({
        data: {
          _id,
          tournamentId,
          memberId: e.memberId,
          seasonId: t.seasonId,
          tournamentType: t.type,
          points: e.points,
          rank: e.rank,
          awardedAt: now,
          createTime: now,
          updateTime: now
        }
      })
    }
    await db.collection('tournaments').doc(tournamentId).update({ data: { status: 'completed' } })
  }

  async function findResultByMatchId(matchId) {
    const rows = (await db.collection('match_results').where({ sourceMatchId: matchId }).get()).data
    return rows[0] || null
  }

  async function getTournament(tournamentId) {
    return (await db.collection('tournaments').doc(tournamentId).get()).data
  }

  function sourcePositionFromMatchId(result) {
    // result.position 不一定存在，从 matches 里反查
    return 1 // 简化：调用方负责保证 result.position 存在；如缺则按 1 处理（本 Phase 范围内 bracket 始终有 position）
  }

  return { submitResult, confirmAll, reconfirmMatch, clearDownstream, awardPlacementIfFinal }
}

module.exports = { createMatchStateService }
```

### Step 4.5 跑测试 — 全过 + 覆盖率 ≥ 90%

```bash
cd cloudfunctions/match-results && npx jest state -- --coverage
```

> 如果 `reconfirmMatch · winner 翻盘` 测试中递归 `clearDownstream` 出问题，确认 fake db 对 `result.position` 的传递；若 result 不带 position 字段，需要在 state 里读 bracket 反查 position。落库实测中 `match-results` 表都带 `round` 但不一定带 `position`；实现里可从 `tournament_brackets` 查回。

### Step 4.6 commit

```bash
git add cloudfunctions/match-results/lib/state.js cloudfunctions/match-results/lib/__tests__/state.test.js
git commit -m "feat(match-results): state machine + 改分回滚 + placement 触发 · Phase 8 Task 4"
```

---

## Task 5 · `match-results/index.js` 新 actions

**Files:**
- Modify: `cloudfunctions/match-results/index.js`

新增 actions：
- `submit({ matchId, score })` — 录入比分（pending/submitted → submitted；admin 直接 confirmed）
- `confirmAll({ tournamentId })` — admin 一键确认全部 submitted
- `reconfirmMatch({ matchId, newScore })` — admin 改分
- `submittedQueue()` — 拉所有 submitted 按 tournament 分组（spec §7.5）
- `listByTournament({ tournamentId })` — 按赛事返回 `match_results`，统一新协议 `{ success, data:{ results } }`
- `listByPlayer({ memberId })` — my-match 可录分行使用
- 保留旧 actions：`add / update / list / get / updateResult / updateStatus`（前端兼容）

- [ ] **Step 5.1 顶部 import**

```js
const { createMatchStateService } = require('./lib/state')
const award = require('./lib/award')
const scoreRule = require('./lib/score-rule')
const stateSvc = createMatchStateService({ db, awardLib: award, scoreRule })
```

- [ ] **Step 5.2 action 分发追加**

```js
const submitter = await resolveSubmitter(wxContext)
try {
  if (action === 'submit')          return ok(await stateSvc.submitResult({ matchId: event.matchId, score: event.score, submitter }))
  if (action === 'confirmAll')      return ok(await stateSvc.confirmAll({ tournamentId: event.tournamentId, admin: submitter }))
  if (action === 'reconfirmMatch')  return ok(await stateSvc.reconfirmMatch({ matchId: event.matchId, newScore: event.newScore, admin: submitter }))
  if (action === 'submittedQueue')  return ok(await submittedQueue(submitter))
  // ...旧 actions
} catch (e) {
  return { success: false, error: { code: e.message || 'INTERNAL', message: e.message } }
}

function ok(data) { return { success: true, data } }
```

- [ ] **Step 5.3 resolveSubmitter：从 wx cloud context 拿 openid，再查 member**

```js
async function resolveSubmitter(wxContext) {
  if (!wxContext?.OPENID) return null
  const m = (await db.collection('members').where({ openid: wxContext.OPENID }).get()).data[0]
  if (!m) return null
  return { _id: m._id, isAdmin: !!m.isAdmin }
}
```

> 注：`wxContext` 来自 `cloud.getWXContext()`，本云函数若没用过需要在 `exports.main` 顶部调用：`const wxContext = cloud.getWXContext()`。

- [ ] **Step 5.4 submittedQueue 实现**

```js
async function submittedQueue(admin) {
  if (!admin?.isAdmin) throw new Error('UNAUTHORIZED')
  // 分页拉所有 submitted（最多预期 < 200）
  const rows = await pagedFetch({ resultStatus: 'submitted' }, 100)
  const grouped = {}
  for (const r of rows) {
    grouped[r.tournamentId] = (grouped[r.tournamentId] || 0) + 1
  }
  const entries = Object.entries(grouped)
  if (entries.length === 0) return { items: [] }
  const tournamentIds = entries.map(([tid]) => tid)
  const tournaments = (await db.collection('tournaments').where({ _id: db.command.in(tournamentIds) }).get()).data
  const tMap = Object.fromEntries(tournaments.map(t => [t._id, t]))
  return {
    items: entries.map(([tid, count]) => ({
      tournamentId: tid,
      tournamentName: tMap[tid]?.name || tid,
      submittedCount: count
    }))
  }
}

async function pagedFetch(filter, pageSize) {
  const out = []
  let last = null
  while (true) {
    let q = collection.where(filter).orderBy('createTime', 'asc').orderBy('_id', 'asc').limit(pageSize)
    if (last) {
      q = collection.where({
        ...filter,
        ...db.command.or([
          { createTime: db.command.gt(last.createTime) },
          { createTime: last.createTime, _id: db.command.gt(last._id) }
        ])
      }).orderBy('createTime', 'asc').orderBy('_id', 'asc').limit(pageSize)
    }
    const res = await q.get()
    out.push(...res.data)
    if (res.data.length < pageSize) break
    last = { createTime: res.data[res.data.length - 1].createTime, _id: res.data[res.data.length - 1]._id }
  }
  return out
}
```

- [ ] **Step 5.5 上传云函数 + 手动验证**

```bash
bash uploadCloudFunction.sh match-results
```

在小程序里登录 admin / player 分别走 submit / confirmAll，看数据库变化。

- [ ] **Step 5.6 commit**

```bash
git add cloudfunctions/match-results/index.js
git commit -m "feat(match-results): submit/confirmAll/reconfirmMatch/submittedQueue · Phase 8 Task 5"
```

---

## Task 6 · `points-engine/lib/aggregate.js` · 复合游标分页聚合（TDD）

**Files:**
- Create: `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`
- Create: `cloudfunctions/points-engine/lib/aggregate.js`

### Step 6.1 写失败测试

```js
const { aggregateRanks } = require('../aggregate')

function makeFakeDb({ matchResults, tournamentPoints }) {
  // 提供 .collection(name).where(filter).orderBy(...).limit(N).get()
  // 这里把 filter 解释成属性匹配 + `_command.or` / `_command.gt` / `_command.in`
  // 见 Task 4 fake db；本 Task 复用之
  // ...（实现略，与 state.test.js 复用即可）
  return {/* impl ... */}
}

describe('aggregateRanks', () => {
  test('单页：50 条 → 累加正确', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 50)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    expect(list.length).toBeGreaterThan(0)
    expect(list[0].totalPoints).toBeGreaterThanOrEqual(list[list.length - 1].totalPoints)
  })

  test('多页：250 条 / pageSize=100 → 全部累加，无重复无遗漏', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 250)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const totalPoints = list.reduce((s, x) => s + x.totalPoints, 0)
    const expected = matches.reduce((s, m) => s + m.pointsAwarded.entries.reduce((p, e) => p + e.points, 0), 0)
    expect(totalPoints).toBe(expected)
  })

  test('大数据：2500 条 / pageSize=100 → 25 页拉完，结果稳定', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 2500)
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const totalPoints = list.reduce((s, x) => s + x.totalPoints, 0)
    const expected = matches.reduce((s, m) => s + m.pointsAwarded.entries.reduce((p, e) => p + e.points, 0), 0)
    expect(totalPoints).toBe(expected)
  })

  test('按 seasonId / type 过滤', async () => {
    const matches = [
      ...generateConfirmedMatches('S1', 'singles', 10),
      ...generateConfirmedMatches('S2', 'singles', 10),
      ...generateConfirmedMatches('S1', 'doubles', 10)
    ]
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: [] })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    // 总和应等于第一组数据
    const expected = generateConfirmedMatches('S1', 'singles', 10).reduce((s, m) => s + m.pointsAwarded.entries.reduce((p, e) => p + e.points, 0), 0)
    const total = list.reduce((s, x) => s + x.totalPoints, 0)
    expect(total).toBe(expected)
  })

  test('结合 tournament_points placement', async () => {
    const matches = generateConfirmedMatches('S1', 'singles', 10)
    const placement = [
      { _id: 'T1_M_placement', tournamentId: 'T1', memberId: 'M', seasonId: 'S1', tournamentType: 'singles', points: 100, rank: 'champion', createTime: new Date() }
    ]
    const db = makeFakeDb({ matchResults: matches, tournamentPoints: placement })
    const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
    const M = list.find(x => x.memberId === 'M')
    expect(M.totalPoints).toBeGreaterThanOrEqual(100)
  })
})

function generateConfirmedMatches(seasonId, type, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      _id: `r_${seasonId}_${i}`,
      tournamentId: `T_${seasonId}`,
      seasonId,
      tournamentType: type,
      matchKind: 'bracket',
      resultStatus: 'confirmed',
      createTime: new Date(2026, 0, 1, 0, 0, i),
      pointsAwarded: { source: 'match', entries: [
        { memberId: `M_${i % 5}`, points: 20, role: 'winner' },
        { memberId: `M_${(i % 5) + 5}`, points: 10, role: 'loser' }
      ] }
    })
  }
  return out
}
```

### Step 6.2 跑测试 — 失败

### Step 6.3 实现 `aggregate.js`

```js
async function aggregateRanks({ db, seasonId, type, pageSize = 100 }) {
  const acc = new Map()  // memberId → { totalPoints, wins, losses, breakdown }

  // 1) 实时聚合 match_results.pointsAwarded.entries
  let last = null
  while (true) {
    const filter = { seasonId, resultStatus: 'confirmed', tournamentType: type }
    const cursorClause = last
      ? db.command.or([
          { createTime: db.command.gt(last.createTime) },
          { createTime: last.createTime, _id: db.command.gt(last._id) }
        ])
      : null
    let q = db.collection('match_results').where(cursorClause ? { ...filter, _cursor: cursorClause } : filter)
    q = q.orderBy('createTime', 'asc').orderBy('_id', 'asc').limit(pageSize)
    const res = await q.get()
    const page = res.data
    for (const m of page) {
      for (const e of (m.pointsAwarded?.entries || [])) {
        accumulate(acc, e.memberId, e.points, e.role)
      }
    }
    if (page.length < pageSize) break
    last = { createTime: page[page.length - 1].createTime, _id: page[page.length - 1]._id }
  }

  // 2) 再分页拉 tournament_points 同样累加
  let last2 = null
  while (true) {
    const filter = { seasonId, tournamentType: type }
    const cursorClause = last2
      ? db.command.or([
          { createTime: db.command.gt(last2.createTime) },
          { createTime: last2.createTime, _id: db.command.gt(last2._id) }
        ])
      : null
    let q = db.collection('tournament_points').where(cursorClause ? { ...filter, _cursor: cursorClause } : filter)
    q = q.orderBy('createTime', 'asc').orderBy('_id', 'asc').limit(pageSize)
    const res = await q.get()
    const page = res.data
    for (const p of page) {
      accumulate(acc, p.memberId, p.points, p.rank)
    }
    if (page.length < pageSize) break
    last2 = { createTime: page[page.length - 1].createTime, _id: page[page.length - 1]._id }
  }

  return [...acc.entries()]
    .map(([memberId, v]) => ({ memberId, ...v }))
    .sort((a, b) => b.totalPoints - a.totalPoints)
}

function accumulate(acc, memberId, points, role) {
  const cur = acc.get(memberId) || { totalPoints: 0, wins: 0, losses: 0 }
  cur.totalPoints += points
  if (role === 'winner') cur.wins += 1
  if (role === 'loser') cur.losses += 1
  acc.set(memberId, cur)
}

module.exports = { aggregateRanks }
```

> 注：上面 fake db 的 `_cursor` 用法是简化示例。真实云数据库需要把 `db.command.or(...)` 直接和 filter 合并：

```js
const filter = last
  ? db.command.and([
      { seasonId, resultStatus: 'confirmed', tournamentType: type },
      db.command.or([{ createTime: db.command.gt(last.createTime) }, { createTime: last.createTime, _id: db.command.gt(last._id) }])
    ])
  : { seasonId, resultStatus: 'confirmed', tournamentType: type }
```

实现时按真实云函数 SDK 语法落地，测试用 fake db 时让其能识别 `db.command.or / .gt / .and` 结构（在 makeFakeDb 中模拟）。

### Step 6.4 跑测试 — 全过 + 覆盖率 ≥ 90%

### Step 6.5 commit

```bash
git add cloudfunctions/points-engine/lib/aggregate.js cloudfunctions/points-engine/lib/__tests__/aggregate.test.js
git commit -m "feat(points-engine): aggregate · 复合游标分页聚合 · Phase 8 Task 6"
```

---

## Task 7 · `points-engine/index.js` 重写 + 兼容 wrapper

**Files:**
- Modify: `cloudfunctions/points-engine/index.js`

新 actions：
- `rankAggregate({ seasonId, type, pageSize? })` — 调 `aggregate.aggregateRanks`，再拼上 member 元数据返回
- `recompute({ tournamentId })` — 给运维用：扫该赛事所有 confirmed match_results，重建 pointsAwarded entries（按当前 pointsRules.winLoss）。**注意：不动 tournament_points**

兼容 wrapper（不改前端 home/rank/player-detail）：
- `rankList({ type, currentSeasonId })` → 内部 `rankAggregate({ seasonId: currentSeasonId, type })`，再 map 旧 schema 返回
- `playerStats({ memberId, type, currentSeasonId })` → 内部 aggregate 之后取该 member 的 total/wins/losses
- `recalculateMatch({ matchId })` → 内部跑 `recompute` 单条逻辑

- [ ] **Step 7.1 改 index.js**

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const award = require('./lib/award')
const { aggregateRanks } = require('./lib/aggregate')

exports.main = async (event) => {
  const { action } = event
  try {
    if (action === 'rankAggregate')    return ok(await rankAggregate(event))
    if (action === 'recompute')        return ok(await recompute(event))

    // 兼容 wrapper
    if (action === 'rankList')         return ok(await rankListCompat(event))
    if (action === 'playerStats')      return ok(await playerStatsCompat(event))
    if (action === 'recalculateMatch') return ok(await recalculateMatchCompat(event))

    return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } }
  } catch (e) {
    return { success: false, error: { code: 'INTERNAL', message: e.message } }
  }
}

function ok(data) { return { success: true, data } }

async function rankAggregate({ seasonId, type = 'singles', pageSize = 100 }) {
  const list = await aggregateRanks({ db, seasonId, type, pageSize })
  if (list.length === 0) return { rankList: [] }
  const memberIds = list.map(x => x.memberId)
  const members = (await db.collection('members').where({ _id: db.command.in(memberIds) }).get()).data
  const memberMap = Object.fromEntries(members.map(m => [m._id, m]))
  const rankList = list.map(x => ({
    _id: x.memberId,
    name: memberMap[x.memberId]?.name || x.memberId,
    avatarUrl: memberMap[x.memberId]?.avatarUrl || '',
    totalPoints: x.totalPoints,
    wins: x.wins || 0,
    losses: x.losses || 0
  }))
  return { rankList }
}

async function recompute({ tournamentId }) {
  if (!tournamentId) throw new Error('tournamentId 必填')
  const t = (await db.collection('tournaments').doc(tournamentId).get()).data
  if (!t) throw new Error('NOT_FOUND')
  const rows = (await db.collection('match_results').where({ tournamentId, resultStatus: 'confirmed' }).get()).data
  let count = 0
  for (const r of rows) {
    if (r.bye) continue
    const entries = award.buildAwardEntries(r, t.pointsRules.winLoss, t.type)
    await db.collection('match_results').doc(r._id).update({ data: { pointsAwarded: { source: 'match', entries } } })
    count++
  }
  return { count }
}

async function rankListCompat({ type = 'singles', currentSeasonId }) {
  const r = await rankAggregate({ seasonId: currentSeasonId, type })
  return r
}

async function playerStatsCompat({ memberId, type = 'singles', currentSeasonId }) {
  const r = await rankAggregate({ seasonId: currentSeasonId, type })
  const me = r.rankList.find(x => x._id === memberId)
  return { stats: me || { _id: memberId, totalPoints: 0, wins: 0, losses: 0 } }
}

async function recalculateMatchCompat({ matchId }) {
  const r = (await db.collection('match_results').where({ sourceMatchId: matchId }).get()).data[0]
  if (!r) throw new Error('NOT_FOUND')
  const t = (await db.collection('tournaments').doc(r.tournamentId).get()).data
  const entries = award.buildAwardEntries(r, t.pointsRules.winLoss, t.type)
  await db.collection('match_results').doc(r._id).update({ data: { pointsAwarded: { source: 'match', entries } } })
  return { count: 1 }
}
```

- [ ] **Step 7.2 删除 / 替换原 lib/calculate.js 中的 `calculatePoints / isPointValid`**

旧的 `home / rank / player-detail` 是直连 `points-engine.rankList / playerStats`，本 Task 通过 wrapper 兼容。把 `lib/calculate.js` 改成只 re-export `award.js` 必要 API；或保留但不再被 `index.js` 使用。

> **决策点：** 旧的 `pointsRules.bonusByRound` 在 Phase 7 schema 已弃用。如果有线上数据仍带 `bonusByRound`，需要在 wrapper 里忽略它。本 Phase 走清库策略（Phase 7 Task 1 已跑），无遗留数据，可安全删除 calculate.js 旧逻辑。

- [ ] **Step 7.3 上传 + 跑前端联调**

```bash
bash uploadCloudFunction.sh points-engine
```

在小程序：home / rank / player-detail 走一遍，确认旧 UI 仍能拉到数据。

- [ ] **Step 7.4 commit**

```bash
git add cloudfunctions/points-engine/
git commit -m "feat(points-engine): rankAggregate/recompute + 兼容 wrapper · Phase 8 Task 7"
```

---

## Task 8 · 前端 score-rule mirror

**Files:**
- Create: `miniprogram/utils/score-rule.js`

- [ ] **Step 8.1** 物理复制 `cloudfunctions/match-results/lib/score-rule.js` → `miniprogram/utils/score-rule.js`，不改任何内容：

```bash
cp cloudfunctions/match-results/lib/score-rule.js miniprogram/utils/score-rule.js
```

- [ ] **Step 8.2** 跑 sync 脚本

```bash
bash scripts/sync-shared-libs.sh
```

期望 `[sync] mirrors ok`。

- [ ] **Step 8.3 commit**

```bash
git add miniprogram/utils/score-rule.js
git commit -m "chore(utils): vendor score-rule · Phase 8 Task 8"
```

---

## Task 9 · `<score-row>` 组件

**Files:**
- Create: `miniprogram/components/score-row/index.{js,json,wxml,wxss}`

> **接口契约：**
> ```js
> properties: {
>   match: Object,           // match_results 行：{ matchId, player1, player2, score, resultStatus, bye, matchKind }
>   isAdmin: Boolean
> },
> data: { expanded: Boolean, draftA: 0, draftB: 0, draftTb: '' },
> // events:
> //   submit({ matchId, score })
> //   reconfirm({ matchId, newScore })
> ```

> **2026-05-14 修订：** 示例代码里 `onSubmit` 发了 `{ matchId, newScore }`，与上面的协议不一致。执行时统一字段：普通提交用 `submit({ matchId, score })`；admin 改 confirmed 用 `reconfirm({ matchId, newScore })`。页面 `onSubmit` 必须从 `e.detail.score` 读取。

- [ ] **Step 9.1 index.json**

```json
{ "component": true }
```

- [ ] **Step 9.2 index.js**

```js
const { validateScore } = require('../../utils/score-rule.js')

Component({
  properties: {
    match: Object,
    isAdmin: { type: Boolean, value: false }
  },
  data: {
    expanded: false,
    draftA: 0,
    draftB: 0,
    draftTb: '',
    validationError: ''
  },
  observers: {
    'match'(m) {
      if (m && m.score && m.score.sets && m.score.sets[0]) {
        this.setData({ draftA: m.score.sets[0].a, draftB: m.score.sets[0].b, draftTb: m.score.tiebreak || '' })
      }
    }
  },
  methods: {
    onToggle() {
      if (this.disabled()) return
      this.setData({ expanded: !this.data.expanded })
    },
    disabled() {
      const m = this.data.match
      if (!m) return true
      if (m.bye) return true
      if (!m.player1 || !m.player2) return true
      return false
    },
    onIncA() { this.setData({ draftA: Math.min(4, this.data.draftA + 1) }); this.revalidate() },
    onDecA() { this.setData({ draftA: Math.max(0, this.data.draftA - 1) }); this.revalidate() },
    onIncB() { this.setData({ draftB: Math.min(4, this.data.draftB + 1) }); this.revalidate() },
    onDecB() { this.setData({ draftB: Math.max(0, this.data.draftB - 1) }); this.revalidate() },
    onTbInput(e) { this.setData({ draftTb: e.detail.value }); this.revalidate() },
    revalidate() {
      const r = validateScore(this.data.draftA, this.data.draftB, this.data.draftTb || null)
      this.setData({ validationError: r.valid ? '' : r.error || '不合法' })
    },
    onSubmit() {
      const r = validateScore(this.data.draftA, this.data.draftB, this.data.draftTb || null)
      if (!r.valid) {
        wx.showToast({ title: '比分不合法：' + (r.error || ''), icon: 'none' })
        return
      }
      const m = this.data.match
      const newScore = { sets: [{ a: this.data.draftA, b: this.data.draftB }], tiebreak: (this.data.draftA === 3 && this.data.draftB === 3) ? this.data.draftTb : null }
      if (m.resultStatus === 'confirmed' && this.data.isAdmin) {
        // 二次确认
        wx.showModal({ title: '修改已确认的比分？', content: '若 winner 变化，将清空后续轮次结果与名次积分', success: ({ confirm }) => { if (confirm) this.triggerEvent('reconfirm', { matchId: m.sourceMatchId, newScore }) } })
      } else {
        this.triggerEvent('submit', { matchId: m.sourceMatchId, newScore })
      }
    }
  }
})
```

- [ ] **Step 9.3 index.wxml**

```xml
<view class="row {{disabled ? 'disabled' : ''}}">
  <view class="row-head" bindtap="onToggle">
    <text class="round-tag">R{{match.round}}</text>
    <text class="players">{{match.player1.name || '—'}} VS {{match.player2 ? match.player2.name : '—'}}</text>
    <text class="score-summary" wx:if="{{match.score && match.score.sets[0]}}">{{match.score.sets[0].a}} : {{match.score.sets[0].b}}{{match.score.tiebreak ? ' (' + match.score.tiebreak + ')' : ''}}</text>
    <text class="status-chip status-{{match.resultStatus}}">{{match.bye ? '轮空' : (!match.player1 || !match.player2 ? '未开打' : match.resultStatus === 'confirmed' ? '已确认' : match.resultStatus === 'submitted' ? '待确认' : '待录入')}}</text>
  </view>
  <view wx:if="{{expanded && !match.bye && match.player1 && match.player2}}" class="row-editor">
    <view class="stepper">
      <text>{{match.player1.name}}</text>
      <button size="mini" bindtap="onDecA">-</button>
      <text class="stepper-val">{{draftA}}</text>
      <button size="mini" bindtap="onIncA">+</button>
    </view>
    <view class="stepper">
      <text>{{match.player2.name}}</text>
      <button size="mini" bindtap="onDecB">-</button>
      <text class="stepper-val">{{draftB}}</text>
      <button size="mini" bindtap="onIncB">+</button>
    </view>
    <view wx:if="{{draftA === 3 && draftB === 3}}" class="tiebreak">
      <text>抢七比分</text>
      <input placeholder="如 7-5" bindinput="onTbInput" value="{{draftTb}}" />
    </view>
    <view wx:if="{{validationError}}" class="err">{{validationError}}</view>
    <button class="submit" bindtap="onSubmit" disabled="{{!!validationError}}">{{match.resultStatus === 'confirmed' ? '保存（admin）' : '提交'}}</button>
  </view>
</view>
```

- [ ] **Step 9.4 index.wxss**

```css
.row { border-bottom: 1rpx solid var(--color-border); padding: var(--space-2) 0; }
.row.disabled { opacity: 0.5; }
.row-head { display: flex; align-items: center; gap: var(--space-2); }
.round-tag { padding: 4rpx 8rpx; background: var(--color-bg-soft); border-radius: 6rpx; font-size: 22rpx; }
.players { flex: 1; }
.score-summary { color: var(--color-text-muted); }
.status-chip { padding: 4rpx 10rpx; border-radius: 999rpx; font-size: 22rpx; }
.status-confirmed { background: rgba(34, 197, 94, 0.1); color: #16a34a; }
.status-submitted { background: rgba(234, 179, 8, 0.1); color: #ca8a04; }
.status-pending   { background: rgba(0, 0, 0, 0.06); color: var(--color-text-muted); }
.row-editor { padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
.stepper { display: flex; align-items: center; gap: var(--space-2); }
.stepper-val { min-width: 40rpx; text-align: center; }
.tiebreak { display: flex; align-items: center; gap: var(--space-2); }
.tiebreak input { flex: 1; background: var(--color-bg-soft); padding: var(--space-1) var(--space-2); border-radius: var(--radius-md); }
.err { color: var(--color-danger); font-size: 24rpx; }
.submit { background: var(--color-primary); color: #fff; }
```

- [ ] **Step 9.5 commit**

```bash
git add miniprogram/components/score-row/
git commit -m "feat(score-row): 比分行组件 · Phase 8 Task 9"
```

---

## Task 10 · `pages/tournament-score` 内容重写（赛事维度）

**Files:**
- Modify: `miniprogram/pages/tournament-score/index.{js,json,wxml,wxss}`

> **协议（spec §5.1）：** `onLoad({ tournamentId })` 必填；`matchId` 选填（用于滚动到指定行）。**移除旧 `round` 参数**。
>
> **2026-05-14 修订：** 拉比赛列表优先调用 `match-results.listByTournament({ tournamentId })`，不要直接依赖旧 `list` 返回 shape。BYE 行和 `player1/player2=null` 的后续轮占位行应显示为 disabled（轮空/未开打），但仍在轮次分组中可见。

- [ ] **Step 10.1 index.json**

```json
{
  "navigationBarTitleText": "比分录入",
  "usingComponents": {
    "score-row": "/components/score-row/index"
  }
}
```

- [ ] **Step 10.2 index.js**

```js
const app = getApp()

Page({
  data: {
    tournamentId: '',
    tournament: null,
    rowsByRound: [],     // [{ round, matches: [] }]
    confirmedCount: 0,
    totalCount: 0,
    submittedCount: 0,
    isAdmin: false,
    anchorMatchId: ''
  },

  onLoad({ tournamentId, matchId }) {
    if (!tournamentId) {
      wx.showToast({ title: '缺少 tournamentId', icon: 'none' })
      return
    }
    this.setData({ tournamentId, anchorMatchId: matchId || '', isAdmin: !!app.globalData.isAdmin })
  },

  async onShow() { if (this.data.tournamentId) await this.refresh() },

  async refresh() {
    const t = (await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'get', id: this.data.tournamentId } })).result?.data?.tournament
    const rowsRes = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'list', tournamentId: this.data.tournamentId } })
    const rows = (rowsRes.result?.data?.results || []).sort((a, b) => (a.round - b.round) || (a.queueOrder || 0) - (b.queueOrder || 0))
    const byRound = {}
    rows.forEach(r => { byRound[r.round] = (byRound[r.round] || []); byRound[r.round].push(r) })
    const rowsByRound = Object.keys(byRound).sort((a, b) => Number(a) - Number(b)).map(r => ({ round: Number(r), matches: byRound[r] }))
    const confirmedCount = rows.filter(r => r.resultStatus === 'confirmed').length
    const submittedCount = rows.filter(r => r.resultStatus === 'submitted').length
    this.setData({ tournament: t, rowsByRound, confirmedCount, submittedCount, totalCount: rows.length })

    if (this.data.anchorMatchId) {
      const sel = `#row-${this.data.anchorMatchId}`
      wx.createSelectorQuery().select(sel).boundingClientRect(rect => {
        if (rect) wx.pageScrollTo({ scrollTop: rect.top - 80, duration: 200 })
      }).exec()
    }
  },

  async onSubmit(e) {
    const { matchId, newScore } = e.detail
    const r = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'submit', matchId, score: newScore } })
    if (!r.result?.success) {
      wx.showToast({ title: r.result?.error?.message || '提交失败', icon: 'none' }); return
    }
    wx.showToast({ title: '已提交', icon: 'success' })
    await this.refresh()
  },

  async onReconfirm(e) {
    const { matchId, newScore } = e.detail
    const r = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'reconfirmMatch', matchId, newScore } })
    if (!r.result?.success) {
      wx.showToast({ title: r.result?.error?.message || '失败', icon: 'none' }); return
    }
    wx.showToast({ title: '已更新', icon: 'success' })
    await this.refresh()
  },

  async onConfirmAll() {
    if (!this.data.isAdmin) return
    if (this.data.submittedCount === 0) return
    const ok = await new Promise(r => wx.showModal({ title: `确认全部 ${this.data.submittedCount} 场？`, content: '确认后将记入积分', success: ({ confirm }) => r(confirm) }))
    if (!ok) return
    const r = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'confirmAll', tournamentId: this.data.tournamentId } })
    if (!r.result?.success) {
      wx.showToast({ title: r.result?.error?.message || '失败', icon: 'none' }); return
    }
    wx.showToast({ title: `已确认 ${r.result.data.confirmedCount} 场`, icon: 'success' })
    await this.refresh()
  }
})
```

- [ ] **Step 10.3 index.wxml**

```xml
<view wx:if="{{tournament}}" class="score-page">
  <view class="head">
    <text class="title">{{tournament.name}}</text>
    <view class="progress">
      <view class="progress-bar"><view class="progress-fill" style="width: {{totalCount ? (confirmedCount * 100 / totalCount) : 0}}%"></view></view>
      <text class="progress-label">已确认 {{confirmedCount}} / {{totalCount}}</text>
    </view>
  </view>
  <view class="rules-hint text-meta">4 局制 · 3:3 抢七 · 4:0 / 4:1 / 4:2 直接结束</view>

  <view wx:for="{{rowsByRound}}" wx:for-item="g" wx:key="round" class="round-group">
    <text class="round-title">第 {{g.round}} 轮</text>
    <view wx:for="{{g.matches}}" wx:for-item="m" wx:key="_id" id="row-{{m.sourceMatchId}}">
      <score-row match="{{m}}" is-admin="{{isAdmin}}" bindsubmit="onSubmit" bindreconfirm="onReconfirm" />
    </view>
  </view>

  <view wx:if="{{isAdmin}}" class="sticky-bottom">
    <button class="confirm-all" bindtap="onConfirmAll" disabled="{{submittedCount === 0}}">✓ 确认全部待确认（{{submittedCount}} 场）</button>
  </view>
</view>
```

- [ ] **Step 10.4 index.wxss**

```css
.score-page { padding: var(--space-3); padding-bottom: 200rpx; }
.head .title { font-size: 32rpx; font-weight: 600; }
.progress { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); }
.progress-bar { flex: 1; height: 8rpx; background: var(--color-bg-soft); border-radius: 4rpx; }
.progress-fill { height: 100%; background: var(--color-primary); border-radius: 4rpx; }
.rules-hint { margin: var(--space-2) 0; }
.round-group { margin-top: var(--space-3); }
.round-title { font-weight: 600; }
.sticky-bottom { position: fixed; bottom: 0; left: 0; right: 0; padding: var(--space-3); background: #fff; border-top: 1rpx solid var(--color-border); }
.confirm-all { background: var(--color-primary); color: #fff; width: 100%; }
```

- [ ] **Step 10.5 改 `tournament-detail.onEnterScore` 协议**

`miniprogram/pages/tournament-detail/index.js`：

```js
onEnterScore() {
  wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournament._id}` })
}
```

去掉旧 `round` 参数；wxml 上"录入比分"按钮文案保持。

- [ ] **Step 10.6 联调**

工具里 admin / player 各提交一遍 + 一键确认。看 placement 是否在最后决赛 confirm 后入 `tournament_points`。

- [ ] **Step 10.7 commit**

```bash
git add miniprogram/pages/tournament-score/ miniprogram/pages/tournament-detail/
git commit -m "feat(tournament-score): 赛事维度比分录入 · Phase 8 Task 10"
```

---

## Task 11 · `manage` 加"待确认比分"队列

**Files:**
- Modify: `miniprogram/pages/manage/index.{js,wxml,wxss}`

- [ ] **Step 11.1 index.js**

```js
async loadSubmittedQueue() {
  if (!getApp().globalData.isAdmin) return
  const r = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'submittedQueue' } })
  this.setData({ submittedQueue: r.result?.data?.items || [] })
}
```

在 onShow 调用。

- [ ] **Step 11.2 wxml 加区块**

```xml
<view wx:if="{{submittedQueue.length > 0}}" class="queue-block">
  <text class="text-label">待确认比分</text>
  <view wx:for="{{submittedQueue}}" wx:key="tournamentId" class="queue-row" bindtap="onOpenScore" data-id="{{item.tournamentId}}">
    <text>{{item.tournamentName}}</text>
    <text class="text-meta">{{item.submittedCount}} 场待确认</text>
  </view>
</view>
```

- [ ] **Step 11.3 onOpenScore**

```js
onOpenScore(e) { wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${e.currentTarget.dataset.id}` }) }
```

- [ ] **Step 11.4 commit**

```bash
git add miniprogram/pages/manage/
git commit -m "feat(manage): 待确认比分队列 · Phase 8 Task 11"
```

---

## Task 12 · `my-match` 加"可录分比赛"行

**Files:**
- Modify: `miniprogram/pages/my-match/index.{js,wxml,wxss}`
- Modify: `cloudfunctions/tournaments/index.js`（如 Phase 7 未实现 `listByIds`）

- [ ] **Step 12.1 在 match-results 加 list-by-player action（如未有）**

`cloudfunctions/match-results/index.js`：

```js
if (action === 'listByPlayer') {
  const { memberId } = event
  if (!memberId) return { success: false, error: { code: 'INVALID_ARG', message: 'memberId 必填' } }
  const rows = (await collection.where({
    playerIds: db.command.in([memberId]),
    resultStatus: db.command.neq('confirmed')
  }).orderBy('round', 'asc').get()).data
  return ok({ matches: rows })
}
```

> playerIds 是 Phase 7 写入的扁平字段，已涵盖双打 partnerId。

- [ ] **Step 12.2 my-match/index.js**

```js
async loadScorable() {
  const me = getApp().globalData.currentMember
  if (!me) return
  const r = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'listByPlayer', memberId: me._id } })
  const matches = r.result?.data?.matches || []
  // 拼上 tournament name
  const tIds = [...new Set(matches.map(m => m.tournamentId))]
  if (tIds.length > 0) {
    const ts = (await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'listByIds', ids: tIds } })).result?.data?.tournaments || []
    const tMap = Object.fromEntries(ts.map(t => [t._id, t]))
    this.setData({
      scorable: matches.map(m => ({
        ...m,
        tournamentName: tMap[m.tournamentId]?.name || m.tournamentId,
        opponentLabel: opponentLabel(m, me._id)
      }))
    })
  } else {
    this.setData({ scorable: [] })
  }
}

function opponentLabel(m, myId) {
  // playerIds 4 人时找另一队；2 人时找另一人
  if (m.player1?.id === myId || m.player1?.partnerId === myId) return m.player2?.name || '?'
  if (m.player2?.id === myId || m.player2?.partnerId === myId) return m.player1?.name || '?'
  return '?'
}
```

`tournaments.listByIds` 是个 light wrapper：`where({ _id: db.command.in(ids) }).get()`；若未有则在本 Task 一起加。

- [ ] **Step 12.3 wxml 加区块**

```xml
<view wx:if="{{scorable.length > 0}}" class="scorable-block">
  <text class="text-label">可录分比赛</text>
  <view wx:for="{{scorable}}" wx:key="_id" class="scorable-row" bindtap="onOpen" data-tid="{{item.tournamentId}}" data-mid="{{item.sourceMatchId}}">
    <text class="t-name">{{item.tournamentName}}</text>
    <text>vs {{item.opponentLabel}}</text>
    <text class="status-chip status-{{item.resultStatus}}">{{item.resultStatus === 'submitted' ? '待确认' : '待录入'}}</text>
  </view>
</view>
```

- [ ] **Step 12.4 onOpen**

```js
onOpen(e) {
  const { tid, mid } = e.currentTarget.dataset
  wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${tid}&matchId=${mid}` })
}
```

- [ ] **Step 12.5 commit**

```bash
git add miniprogram/pages/my-match/ cloudfunctions/match-results/index.js cloudfunctions/tournaments/index.js
git commit -m "feat(my-match): 可录分比赛行 · Phase 8 Task 12"
```

---

## Task 13 · 端到端联调（E2E 关键旅程 · spec §8.3）

> 本 Task 不写代码，只是按 spec §8.3 跑三个旅程。每条旅程通过才能进入 Task 14。

### 13.1 Admin 完整闭环

- [ ] 登录 admin → tournament-manage → 创建 → 走完 4 步 wizard（draft 落库）→ 完成
- [ ] 排程页拖拽换顺序 → 保存
- [ ] tournament-score 页 → 录 4 场首轮 → admin 一键确认全部
- [ ] bracket 自动推进 → 半决出现 → 录半决 → 确认 → 录决赛 → 确认
- [ ] `tournament_points` 集合按 placement 桶入库
- [ ] `tournaments[T].status = 'completed'`
- [ ] 排行榜（rank 页）看到积分更新

### 13.2 Player 提交流程

- [ ] 登录 player → my-match "可录分比赛" → 点击 → tournament-score
- [ ] 内联编辑 → 提交（status='submitted'）
- [ ] 切 admin 账号 → manage "待确认比分队列" → 点击 → tournament-score → "确认全部"

### 13.3 改分回滚

- [ ] admin 在已 completed 的赛事打开 tournament-score
- [ ] 改半决某场 winner → 二次确认弹窗 → 确认
- [ ] `tournament_brackets`：决赛 winner / 该 slot player 清空
- [ ] `match_results` 决赛行 `resultStatus='pending'`
- [ ] `tournament_points` 该 tournament 全删
- [ ] `tournaments[T].status='ongoing'`

> 若任一旅程失败，回退到对应 Task 修复（不要继续 Task 14）。

- [ ] **Step 13.4** 三条旅程通过后追加一条 commit（无代码变更，仅 docs）：

```bash
git commit --allow-empty -m "test(e2e): Phase 8 三条旅程通过 · Task 13"
```

---

## Task 14 · 更新 PROGRESS.md

**Files:**
- Modify: `docs/superpowers/plans/PROGRESS.md`

- [ ] **Step 14.1 改总进度条 + Phase 状态**

```diff
- [████████████████████░░░░] 5/6 Phase 完成
+ [████████████████████████] 6/6 Phase 完成
```

新增 Phase 8 行：

```
| 08 | Phase 8 · Score Engine | ✅ 已完成 | YYYY-MM-DD | YYYY-MM-DD | <hash> | _shared/award.js + sync 脚本；match-results state machine（submit/confirmAll/reconfirmMatch/clearDownstream/placement）；points-engine rankAggregate + 兼容 wrapper；tournament-score 重写；manage 待确认队列；my-match 可录分行 |
```

「当前应该做什么」改为：

```
**👉 全部 Phase 完成**。后续运维 / v3 演进见 spec §9.2。
```

- [ ] **Step 14.2 执行日志追加节**

```md
### YYYY-MM-DD · Phase 8 完成
- _shared/award.js + scripts/sync-shared-libs.sh（覆盖 award + score-rule + bracket-generator + scheduler-mirror）
- match-results/lib/score-rule.js（100% 覆盖）+ state.js（90%+ 覆盖）
- match-results actions: submit / confirmAll / reconfirmMatch / submittedQueue / listByPlayer
- points-engine: rankAggregate / recompute + rankList / playerStats / recalculateMatch 兼容 wrapper
- aggregate.js 复合游标分页（250 / 2500 测试通过）
- tournament-score 重写：赛事维度展示、内联 stepper 编辑器、admin 一键确认
- score-row 组件、manage 待确认队列、my-match 可录分行
- E2E 三条旅程（admin 闭环 / player 提交 / 改分回滚）全部通过
- 已知遗留：
  - scheduler-engine 仍在云端（@deprecated），下个迭代删
  - tournament_points 改分回滚是按 tournament 整体删；如果未来支持多 placement 来源需要按 source 删
  - 排行榜实时聚合在 2500 条以下 ok；> 5000 时建议加 tournament_points 增量索引（推 v3）
```

- [ ] **Step 14.3 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 8 完成 · 全部 Phase 收尾 · Task 14"
```

---

## Self-Review Checklist

- [ ] `cd cloudfunctions/_shared && npx jest` 覆盖率 ≥ 95%
- [ ] `cd cloudfunctions/match-results && npx jest`：
  - `score-rule` 覆盖率 100%
  - `state` 覆盖率 ≥ 90%
- [ ] `cd cloudfunctions/points-engine && npx jest`：`aggregate` 覆盖率 ≥ 90%
- [ ] `bash scripts/sync-shared-libs.sh` 全过（award + score-rule + bracket-generator + scheduler-mirror）
- [ ] Phase 7 旧测试无回归（`tournaments / tournament-brackets / scheduler-engine`）
- [ ] E2E §8.3 三条旅程全过
- [ ] BYE 行 `pointsAwarded.entries === []`，自动 confirmed
- [ ] 重复 confirm 同场 → entries 不重复（update 覆盖）
- [ ] confirmAll 第二次调用 → confirmedCount=0（幂等）
- [ ] 改半决 winner：决赛 result 清空 + tournament_points 全删 + tournament.status='ongoing'
- [ ] aggregate 在 250 条 / 2500 条数据下结果一致（多次跑同一脚本，sum 不变）
- [ ] 旧前端 `home / rank / player-detail` 经 wrapper 仍可用
- [ ] PROGRESS.md 更新到位（6/6 完成）

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/08-phase-8-score-engine.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Task 1–7 派 fresh subagent 跑（lib + 云函数 TDD，独立度高）；Task 8–12 前端组件主上下文盯一手；Task 13 E2E 必须人工跑（agent 不能替）；Task 14 自己写。

**2. Inline Execution** - 在当前会话里按 checkbox 顺序推进，checkpoint 在 Task 4 / Task 7 / Task 10 / Task 13 末尾。

Which approach?
