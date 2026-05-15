# FOPEN 小程序 Phase 9 · v2.1 质量迭代 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把比赛日两条主路径（admin 一键确认 / 会员提交比分）做到生产级；三页 IA 重构 + 新组件 + 6 个新云函数 action + 乐观锁 + 部分失败 sheet UI。

**Architecture:** 后端 `match-results` 拆 handlers/ 模块化；新增批量 action 含 `expectedUpdateTime` 乐观锁 + `_request_log` 幂等；前端新增统一 cloud wrapper（永不抛 + 区分 trace id 与 batch group id）+ 三个标准组件（`status-tag` / `empty-state` / `batch-result-sheet`）；`tournament-manage` / `my-match` / `tournament-score` 三页按角色重构 IA；`score-row` 仅视觉债清理（用现有项目 token）。

**Tech Stack:**
- 后端：微信云函数 + `wx-server-sdk` ~2.6.3 + Jest 29（cloud function 单测）
- 前端：微信小程序 WXML/WXSS + Phase 6 设计 token + Phase 8 score state machine
- 上游 spec：`docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design.md`
- 沟通日志：`docs/communication/2026-05-16-claude-codex-v2-1-log.md`

**Phase 划分**（5 sub-phase, 31 tasks total）：

| Phase | 范围 | Tasks |
|---|---|---|
| P1 · 后端基础 | `_request_log` schema、`match-results` 拆 handlers、4 个新 action 单测+实装 | 1–11 |
| P2 · 工作台接口 | `tournaments.adminConsoleSnapshot`、`tournaments.finishedRecent` | 12–15 |
| P3 · 前端基础 | `utils/cloud.call` v2 wrapper + 3 个新组件 | 16–20 |
| P4 · 三页重构 | tournament-manage / my-match / tournament-score IA + score-row 视觉 | 21–27 |
| P5 · 验收 | 单测全绿 + E2E 10 条 + 性能 + DB schema 同步 + 部署 | 28–31 |

**前置约束**：
- 不删任何旧 action / 旧页面（兼容保留）；旧测试基线 `_shared 22 / match-results 55 / points-engine 16 / tournaments 19 / tournament-brackets 44 / weekly-star 4` 不破。
- v2.1 三页 + sheet 内禁用 `wx.showLoading` / `wx.showToast({title:'加载失败'})`。
- 视觉只用 `miniprogram/styles/tokens.wxss` 现有 token，不引入新 token。

---

## 文件结构（File Layout）

### 新增

```
cloudfunctions/match-results/lib/handlers/
├── batch.js              # batchConfirm + batchSubmit
├── submit.js             # submit / confirmAll / reconfirmMatch（迁旧）
├── query.js              # submittedQueue / listByTournament / listByPlayer / pendingReviewItems
└── my-summary.js         # mySummary

cloudfunctions/match-results/lib/__tests__/handlers/
├── batch.test.js
├── query.test.js
└── my-summary.test.js

cloudfunctions/tournaments/lib/handlers/
├── admin-console.js      # adminConsoleSnapshot
└── finished-recent.js    # finishedRecent

cloudfunctions/tournaments/lib/__tests__/
├── admin-console.test.js
└── finished-recent.test.js

miniprogram/components/status-tag/
├── index.js
├── index.json
├── index.wxml
└── index.wxss

miniprogram/components/empty-state/
├── index.js
├── index.json
├── index.wxml
└── index.wxss

miniprogram/components/batch-result-sheet/
├── index.js
├── index.json
├── index.wxml
└── index.wxss

miniprogram/utils/__tests__/cloud.test.js
miniprogram/components/__tests__/                 # 仅新组件 snapshot 测试

docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design/qa-screenshots/   # P5 截图
```

### 修改

```
cloudfunctions/match-results/index.js                  # 重构为路由分发
cloudfunctions/tournaments/index.js                    # 加 adminConsoleSnapshot / finishedRecent 路由
cloudfunctions/DATABASE_SCHEMA.md                      # 加 _request_log 集合 + updateTime 乐观锁说明
miniprogram/utils/cloud.js                             # 新增 call(name, payload, options) v2 wrapper
miniprogram/pages/tournament-manage/index.{js,wxml,wxss,json}     # IA 重构
miniprogram/pages/my-match/index.{js,wxml,wxss,json}              # IA 重构
miniprogram/pages/tournament-score/index.{js,wxml,wxss,json}      # sticky CTA 改 + 接 sheet
miniprogram/components/score-row/index.wxss            # 视觉债清理
miniprogram/components/score-row/index.wxml            # WXS 时段标改 status-tag
miniprogram/app.json                                   # 注册新组件路径
```

### 不动

```
cloudfunctions/match-results/lib/state.js              # Phase 8 状态机
cloudfunctions/match-results/lib/score-rule.js         # Phase 8 规则
cloudfunctions/match-results/lib/award.js              # vendored from _shared
cloudfunctions/points-engine/                          # 排行榜逻辑
cloudfunctions/weekly-star/                            # 每周之星
miniprogram/pages/{manage, home, rank, tournament-edit, ...}     # 不在 v2.1 范围
```

---

## Phase 1 · 后端基础（Tasks 1–11）

### Task 1: 文档新增 `_request_log` 集合 schema

**Files:**
- Modify: `cloudfunctions/DATABASE_SCHEMA.md`（在合适位置追加新集合段落）

- [ ] **Step 1：在 `DATABASE_SCHEMA.md` 末尾追加 `_request_log` 集合段落**

将以下 markdown 追加到文件末尾（保留现有内容）：

```markdown

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
```

- [ ] **Step 2：验证 markdown 渲染无破坏**

```bash
grep -c "^## " /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/DATABASE_SCHEMA.md
```
Expected：返回比修改前 +2 的数字（多了两个 `##` 段）。

- [ ] **Step 3：commit**

```bash
git add cloudfunctions/DATABASE_SCHEMA.md
git commit -m "docs(schema): add _request_log + updateTime optimistic lock for v2.1"
```

---

### Task 2: 创建 `cloudfunctions/match-results/lib/handlers/` 目录骨架

**Files:**
- Create: `cloudfunctions/match-results/lib/handlers/batch.js`
- Create: `cloudfunctions/match-results/lib/handlers/submit.js`
- Create: `cloudfunctions/match-results/lib/handlers/query.js`
- Create: `cloudfunctions/match-results/lib/handlers/my-summary.js`

- [ ] **Step 1：创建 4 个 handler 文件（仅导出占位 stub）**

```bash
mkdir -p cloudfunctions/match-results/lib/handlers
```

`cloudfunctions/match-results/lib/handlers/batch.js`:
```js
// v2.1 batch handlers — batchConfirm + batchSubmit
async function batchConfirm(ctx, payload) {
  throw new Error('NOT_IMPLEMENTED')
}
async function batchSubmit(ctx, payload) {
  throw new Error('NOT_IMPLEMENTED')
}
module.exports = { batchConfirm, batchSubmit }
```

`cloudfunctions/match-results/lib/handlers/submit.js`:
```js
// migrated legacy: submit / confirmAll / reconfirmMatch
async function submit(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
async function confirmAll(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
async function reconfirmMatch(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
module.exports = { submit, confirmAll, reconfirmMatch }
```

`cloudfunctions/match-results/lib/handlers/query.js`:
```js
// query handlers: submittedQueue / listByTournament / listByPlayer / pendingReviewItems
async function submittedQueue(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
async function listByTournament(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
async function listByPlayer(ctx, event) {
  throw new Error('NOT_IMPLEMENTED')
}
async function pendingReviewItems(ctx, payload) {
  throw new Error('NOT_IMPLEMENTED')
}
module.exports = { submittedQueue, listByTournament, listByPlayer, pendingReviewItems }
```

`cloudfunctions/match-results/lib/handlers/my-summary.js`:
```js
// my-summary handler: mySummary action
async function mySummary(ctx, payload) {
  throw new Error('NOT_IMPLEMENTED')
}
module.exports = { mySummary }
```

- [ ] **Step 2：node syntax check**

```bash
node -c cloudfunctions/match-results/lib/handlers/batch.js && \
node -c cloudfunctions/match-results/lib/handlers/submit.js && \
node -c cloudfunctions/match-results/lib/handlers/query.js && \
node -c cloudfunctions/match-results/lib/handlers/my-summary.js && \
echo "OK"
```
Expected：`OK`

- [ ] **Step 3：commit**

```bash
git add cloudfunctions/match-results/lib/handlers/
git commit -m "feat(match-results): scaffold handlers/ subdirectory for v2.1 split"
```

---

### Task 3: 写 `batchConfirm` happy + STALE_VERSION 单测

**Files:**
- Create: `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`

- [ ] **Step 1：创建测试目录 + 写 happy 测试**

```bash
mkdir -p cloudfunctions/match-results/lib/__tests__/handlers
```

`cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`:
```js
const { batchConfirm } = require('../../handlers/batch')

function makeCtx({ matches = [], requestLog = {}, isAdmin = true, openid = 'oA', memberId = 'mA' } = {}) {
  const matchesById = Object.fromEntries(matches.map(m => [m._id, { ...m }]))
  const requestLogById = { ...requestLog }
  return {
    callerOpenid: openid,
    callerMemberId: memberId,
    isAdmin,
    confirmedAtNow: new Date('2026-05-16T10:00:00.000Z'),
    db: {
      getMatch: async (id) => matchesById[id] || null,
      updateMatch: async (id, patch) => {
        matchesById[id] = { ...matchesById[id], ...patch }
      },
      getRequestLog: async (id) => requestLogById[id] || null,
      upsertRequestLog: async (id, doc) => { requestLogById[id] = doc },
    },
    _state: { matchesById, requestLogById },
    confirmOne: async function (match) {
      matchesById[match._id] = { ...matchesById[match._id], resultStatus: 'confirmed', updateTime: this.confirmedAtNow }
      return { ok: true }
    },
  }
}

test('batchConfirm happy: all matches confirmed', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'submitted', updateTime, score: { sets: [{ a: 4, b: 2 }] } },
      { _id: 'mr_b', resultStatus: 'submitted', updateTime, score: { sets: [{ a: 4, b: 1 }] } },
    ],
  })
  const result = await batchConfirm(ctx, {
    matches: [
      { matchId: 'mr_a', expectedUpdateTime: updateTime.toISOString() },
      { matchId: 'mr_b', expectedUpdateTime: updateTime.toISOString() },
    ],
    requestId: 'req_1',
  })

  expect(result).toEqual({
    requestId: 'req_1',
    successIds: ['mr_a', 'mr_b'],
    failures: [],
  })
  expect(ctx._state.matchesById.mr_a.resultStatus).toBe('confirmed')
  expect(ctx._state.matchesById.mr_b.resultStatus).toBe('confirmed')
})

test('batchConfirm STALE_VERSION: expectedUpdateTime mismatch returns failure', async () => {
  const currentTime = new Date('2026-05-16T09:30:00.000Z')
  const staleTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'submitted', updateTime: currentTime, score: { sets: [{ a: 4, b: 2 }] } },
    ],
  })
  const result = await batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a', expectedUpdateTime: staleTime.toISOString() }],
    requestId: 'req_2',
  })

  expect(result.successIds).toEqual([])
  expect(result.failures).toHaveLength(1)
  expect(result.failures[0]).toMatchObject({
    matchId: 'mr_a',
    code: 'STALE_VERSION',
    retryable: false,
    requestId: 'req_2',
  })
  expect(ctx._state.matchesById.mr_a.resultStatus).toBe('submitted')  // 未变更
})
```

- [ ] **Step 2：跑测试确认 fail（实现还是 stub）**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/batch.test.js
```
Expected：2 failed，错误信息含 `NOT_IMPLEMENTED`。

- [ ] **Step 3：commit 测试占位**

```bash
git add cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js
git commit -m "test(match-results): batchConfirm happy + STALE_VERSION (red)"
```

---

### Task 4: 实装 `batchConfirm` 含 expectedUpdateTime 校验

**Files:**
- Modify: `cloudfunctions/match-results/lib/handlers/batch.js`

- [ ] **Step 1：实装 batchConfirm**

替换 `batch.js` 的 batchConfirm stub 为完整实现：

```js
// v2.1 batch handlers — batchConfirm + batchSubmit

const STALE_MESSAGE = '该比分已被其他管理员处理（数据已更新）'

function isoToTime(iso) {
  if (!iso) return NaN
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : NaN
}

async function batchConfirm(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const { matches, requestId } = payload || {}
  if (!Array.isArray(matches) || matches.length === 0 || !requestId) {
    const err = new Error('INVALID_PAYLOAD')
    err.code = 'INVALID_PAYLOAD'
    throw err
  }
  for (const m of matches) {
    if (!m || !m.matchId || !m.expectedUpdateTime) {
      const err = new Error('INVALID_PAYLOAD')
      err.code = 'INVALID_PAYLOAD'
      throw err
    }
  }

  const now = ctx.confirmedAtNow || new Date()
  const existingLog = await ctx.db.getRequestLog(requestId)
  const baseResults = (existingLog && existingLog.results) || {}
  const mergedResults = { ...baseResults }

  const successIds = []
  const failures = []

  for (const item of matches) {
    const { matchId, expectedUpdateTime } = item
    const prior = mergedResults[matchId]
    if (prior && prior.state === 'success') {
      successIds.push(matchId)
      continue
    }
    const current = await ctx.db.getMatch(matchId)
    if (!current) {
      const failure = { matchId, code: 'INVALID_STATE', message: '比赛不存在', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    if (current.resultStatus !== 'submitted') {
      const failure = { matchId, code: 'INVALID_STATE', message: '状态不是 submitted', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const expected = isoToTime(expectedUpdateTime)
    const actual = current.updateTime instanceof Date ? current.updateTime.getTime() : isoToTime(current.updateTime)
    if (!Number.isFinite(expected) || expected !== actual) {
      const failure = { matchId, code: 'STALE_VERSION', message: STALE_MESSAGE, retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'STALE_VERSION', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    try {
      await ctx.confirmOne(current)
      successIds.push(matchId)
      mergedResults[matchId] = { state: 'success', confirmedAt: now, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    } catch (e) {
      const code = e.code || 'DB_CONFLICT'
      const retryable = ['CLOUD_TIMEOUT', 'DB_CONFLICT'].includes(code)
      const failure = { matchId, code, message: e.message || code, retryable, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code, message: failure.message, retryable, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    }
  }

  await ctx.db.upsertRequestLog(requestId, {
    _id: requestId,
    action: 'batchConfirm',
    callerOpenid: ctx.callerOpenid,
    callerMemberId: ctx.callerMemberId,
    firstSeenAt: existingLog ? existingLog.firstSeenAt : now,
    lastSeenAt: now,
    results: mergedResults,
    closedAt: existingLog ? existingLog.closedAt : null,
  })

  return { requestId, successIds, failures }
}

async function batchSubmit(ctx, payload) {
  throw new Error('NOT_IMPLEMENTED')
}

module.exports = { batchConfirm, batchSubmit }
```

- [ ] **Step 2：跑测试确认 happy + STALE 通过**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/batch.test.js
```
Expected：2 passed。

- [ ] **Step 3：commit**

```bash
git add cloudfunctions/match-results/lib/handlers/batch.js
git commit -m "feat(match-results): batchConfirm with expectedUpdateTime optimistic lock"
```

---

### Task 5: 补 batchConfirm 的 retry merge / INVALID_PAYLOAD / FORBIDDEN 测试

**Files:**
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`

- [ ] **Step 1：在 batch.test.js 末尾追加测试**

```js
test('batchConfirm retry merge: same requestId skips already-success match', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'submitted', updateTime },
      { _id: 'mr_b', resultStatus: 'submitted', updateTime },
    ],
    requestLog: {
      req_3: {
        _id: 'req_3', action: 'batchConfirm',
        callerOpenid: 'oA', callerMemberId: 'mA',
        firstSeenAt: new Date(), lastSeenAt: new Date(),
        results: { mr_a: { state: 'success', confirmedAt: new Date(), attemptCount: 1 } },
        closedAt: null,
      },
    },
  })
  // simulate state: mr_a already confirmed in DB
  ctx._state.matchesById.mr_a.resultStatus = 'confirmed'

  const result = await batchConfirm(ctx, {
    matches: [
      { matchId: 'mr_a', expectedUpdateTime: updateTime.toISOString() },  // already success in log
      { matchId: 'mr_b', expectedUpdateTime: updateTime.toISOString() },
    ],
    requestId: 'req_3',
  })

  expect(result.successIds).toEqual(['mr_a', 'mr_b'])  // mr_a skipped via log, mr_b newly confirmed
  expect(result.failures).toEqual([])
})

test('batchConfirm INVALID_PAYLOAD: missing matches', async () => {
  const ctx = makeCtx({ matches: [] })
  await expect(batchConfirm(ctx, { matches: [], requestId: 'req_x' })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
})

test('batchConfirm INVALID_PAYLOAD: missing expectedUpdateTime in one entry', async () => {
  const ctx = makeCtx({ matches: [] })
  await expect(batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a' }],
    requestId: 'req_x',
  })).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' })
})

test('batchConfirm FORBIDDEN: non-admin caller', async () => {
  const ctx = makeCtx({ matches: [], isAdmin: false })
  await expect(batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a', expectedUpdateTime: new Date().toISOString() }],
    requestId: 'req_x',
  })).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('batchConfirm writes _request_log with merged results', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'submitted', updateTime }],
  })
  await batchConfirm(ctx, {
    matches: [{ matchId: 'mr_a', expectedUpdateTime: updateTime.toISOString() }],
    requestId: 'req_4',
  })
  const log = ctx._state.requestLogById.req_4
  expect(log).toBeTruthy()
  expect(log.action).toBe('batchConfirm')
  expect(log.results.mr_a.state).toBe('success')
  expect(log.results.mr_a.attemptCount).toBe(1)
})
```

- [ ] **Step 2：跑测试**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/batch.test.js
```
Expected：7 passed（含 Task 3 的 2 个）。

- [ ] **Step 3：commit**

```bash
git add cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js
git commit -m "test(match-results): batchConfirm retry merge + invalid payload + FORBIDDEN"
```

---

### Task 6: 写 + 实装 `batchSubmit`

**Files:**
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`
- Modify: `cloudfunctions/match-results/lib/handlers/batch.js`

- [ ] **Step 1：在测试文件末尾追加 batchSubmit 测试**

```js
const { batchSubmit } = require('../../handlers/batch')

function makeSubmitCtx({ matches = [], openid = 'oA', memberId = 'mA' } = {}) {
  const matchesById = Object.fromEntries(matches.map(m => [m._id, { ...m }]))
  const requestLogById = {}
  return {
    callerOpenid: openid,
    callerMemberId: memberId,
    isAdmin: false,
    nowDate: new Date('2026-05-16T11:00:00.000Z'),
    db: {
      getMatch: async (id) => matchesById[id] || null,
      updateMatch: async (id, patch) => {
        matchesById[id] = { ...matchesById[id], ...patch }
      },
      getRequestLog: async (id) => requestLogById[id] || null,
      upsertRequestLog: async (id, doc) => { requestLogById[id] = doc },
    },
    _state: { matchesById, requestLogById },
    validateScore: () => ({ valid: true }),
  }
}

test('batchSubmit happy: member submits multiple scores', async () => {
  const ctx = makeSubmitCtx({
    matches: [
      { _id: 'mr_a', resultStatus: 'pending', playerIds: ['mA', 'mB'] },
      { _id: 'mr_b', resultStatus: 'pending', playerIds: ['mA', 'mC'] },
    ],
  })
  const result = await batchSubmit(ctx, {
    submissions: [
      { matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } },
      { matchId: 'mr_b', score: { sets: [{ a: 4, b: 1 }], tiebreak: null } },
    ],
    requestId: 'req_s1',
  })
  expect(result.successIds).toEqual(['mr_a', 'mr_b'])
  expect(result.failures).toEqual([])
  expect(ctx._state.matchesById.mr_a.resultStatus).toBe('submitted')
  expect(ctx._state.matchesById.mr_a.score).toEqual({ sets: [{ a: 4, b: 2 }], tiebreak: null })
})

test('batchSubmit FORBIDDEN: caller not in playerIds', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'pending', playerIds: ['mX', 'mY'] }],
  })
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_s2',
  })
  expect(result.successIds).toEqual([])
  expect(result.failures[0]).toMatchObject({ matchId: 'mr_a', code: 'FORBIDDEN', retryable: false })
})

test('batchSubmit CANNOT_OVERWRITE_CONFIRMED: member cannot overwrite confirmed match', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'confirmed', playerIds: ['mA'] }],
  })
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_a', score: { sets: [{ a: 4, b: 2 }], tiebreak: null } }],
    requestId: 'req_s3',
  })
  expect(result.failures[0].code).toBe('CANNOT_OVERWRITE_CONFIRMED')
})

test('batchSubmit INVALID_SCORE: bad score structure', async () => {
  const ctx = makeSubmitCtx({
    matches: [{ _id: 'mr_a', resultStatus: 'pending', playerIds: ['mA'] }],
  })
  ctx.validateScore = () => ({ valid: false, error: 'INVALID_SCORE' })
  const result = await batchSubmit(ctx, {
    submissions: [{ matchId: 'mr_a', score: { sets: [{ a: 9, b: 9 }], tiebreak: null } }],
    requestId: 'req_s4',
  })
  expect(result.failures[0].code).toBe('INVALID_SCORE')
})
```

- [ ] **Step 2：跑测试确认 batchSubmit 失败**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/batch.test.js -t batchSubmit
```
Expected：4 failed（NOT_IMPLEMENTED）。

- [ ] **Step 3：实装 batchSubmit（替换 batch.js 中 stub）**

在 `batch.js` 内，把 `batchSubmit` 替换为：

```js
async function batchSubmit(ctx, payload) {
  const { submissions, requestId } = payload || {}
  if (!Array.isArray(submissions) || submissions.length === 0 || !requestId) {
    const err = new Error('INVALID_PAYLOAD')
    err.code = 'INVALID_PAYLOAD'
    throw err
  }
  for (const s of submissions) {
    if (!s || !s.matchId || !s.score) {
      const err = new Error('INVALID_PAYLOAD')
      err.code = 'INVALID_PAYLOAD'
      throw err
    }
  }

  const now = ctx.nowDate || new Date()
  const existingLog = await ctx.db.getRequestLog(requestId)
  const baseResults = (existingLog && existingLog.results) || {}
  const mergedResults = { ...baseResults }
  const successIds = []
  const failures = []

  for (const item of submissions) {
    const { matchId, score } = item
    const prior = mergedResults[matchId]
    if (prior && prior.state === 'success') {
      successIds.push(matchId)
      continue
    }
    const current = await ctx.db.getMatch(matchId)
    if (!current) {
      const failure = { matchId, code: 'INVALID_STATE', message: '比赛不存在', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_STATE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const playerIds = current.playerIds || []
    if (!playerIds.includes(ctx.callerMemberId)) {
      const failure = { matchId, code: 'FORBIDDEN', message: '非参赛方', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'FORBIDDEN', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    if (current.resultStatus === 'confirmed') {
      const failure = { matchId, code: 'CANNOT_OVERWRITE_CONFIRMED', message: '已确认比分不能再修改', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'CANNOT_OVERWRITE_CONFIRMED', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    const sets0 = score.sets && score.sets[0]
    const validation = ctx.validateScore(sets0 ? sets0.a : null, sets0 ? sets0.b : null, score.tiebreak || null)
    if (!validation || !validation.valid) {
      const failure = { matchId, code: 'INVALID_SCORE', message: validation && validation.error || 'INVALID_SCORE', retryable: false, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'INVALID_SCORE', message: failure.message, retryable: false, attemptCount: (prior && prior.attemptCount || 0) + 1 }
      continue
    }
    try {
      await ctx.db.updateMatch(matchId, { resultStatus: 'submitted', score, submittedBy: ctx.callerMemberId, submittedAt: now, updateTime: now })
      successIds.push(matchId)
      mergedResults[matchId] = { state: 'success', confirmedAt: now, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    } catch (e) {
      const failure = { matchId, code: 'DB_CONFLICT', message: e.message || 'DB_CONFLICT', retryable: true, requestId }
      failures.push(failure)
      mergedResults[matchId] = { state: 'failure', code: 'DB_CONFLICT', message: failure.message, retryable: true, attemptCount: (prior && prior.attemptCount || 0) + 1 }
    }
  }

  await ctx.db.upsertRequestLog(requestId, {
    _id: requestId,
    action: 'batchSubmit',
    callerOpenid: ctx.callerOpenid,
    callerMemberId: ctx.callerMemberId,
    firstSeenAt: existingLog ? existingLog.firstSeenAt : now,
    lastSeenAt: now,
    results: mergedResults,
    closedAt: existingLog ? existingLog.closedAt : null,
  })

  return { requestId, successIds, failures }
}
```

- [ ] **Step 4：跑测试**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/batch.test.js
```
Expected：11 passed（7 + 4 新）。

- [ ] **Step 5：commit**

```bash
git add cloudfunctions/match-results/lib/handlers/batch.js cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js
git commit -m "feat(match-results): batchSubmit member submission with score validation"
```

---

### Task 7: 写 `pendingReviewItems` 测试 + 实装

**Files:**
- Create: `cloudfunctions/match-results/lib/__tests__/handlers/query.test.js`
- Modify: `cloudfunctions/match-results/lib/handlers/query.js`

- [ ] **Step 1：创建 query.test.js**

```js
const { pendingReviewItems } = require('../../handlers/query')

function makeQueryCtx({ rows = [], tournaments = {}, members = {}, isAdmin = true } = {}) {
  const queries = []
  return {
    isAdmin,
    queries,
    db: {
      queryMatchResults: async ({ resultStatus, tournamentId, limit }) => {
        queries.push({ resultStatus, tournamentId, limit })
        return rows.filter(r =>
          (!tournamentId || r.tournamentId === tournamentId) &&
          (!resultStatus || r.resultStatus === resultStatus)
        ).slice(0, limit)
      },
      countMatchResults: async ({ resultStatus, tournamentId }) =>
        rows.filter(r =>
          (!tournamentId || r.tournamentId === tournamentId) &&
          (!resultStatus || r.resultStatus === resultStatus)
        ).length,
      getTournamentsByIds: async (ids) => ids.map(id => tournaments[id]).filter(Boolean),
      getMembersByIds: async (ids) => ids.map(id => members[id]).filter(Boolean),
    },
  }
}

test('pendingReviewItems FORBIDDEN: non-admin', async () => {
  const ctx = makeQueryCtx({ isAdmin: false })
  await expect(pendingReviewItems(ctx, { tournamentId: null, limit: 50 }))
    .rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('pendingReviewItems returns items with updateTime field', async () => {
  const updateTime = new Date('2026-05-16T09:00:00.000Z')
  const ctx = makeQueryCtx({
    rows: [
      {
        _id: 'mr_a', tournamentId: 't1', resultStatus: 'submitted',
        round: 'R1', position: 3, courtName: '1号场', scheduledStart: new Date(),
        player1: { name: '王明', partnerName: '李强' },
        player2: { name: '张明', partnerName: '赵亮' },
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        submittedBy: 'mA', submittedAt: new Date(), updateTime,
      },
    ],
    tournaments: { t1: { _id: 't1', name: 'XXX 杯', format: 'regular' } },
    members: { mA: { _id: 'mA', name: '王明' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: null, limit: 50 })
  expect(result.items).toHaveLength(1)
  expect(result.items[0]).toMatchObject({
    matchId: 'mr_a',
    tournamentId: 't1',
    tournamentName: 'XXX 杯',
    updateTime: updateTime,
  })
  expect(result.truncated).toBe(false)
})

test('pendingReviewItems filters by tournamentId', async () => {
  const ctx = makeQueryCtx({
    rows: [
      { _id: 'mr_a', tournamentId: 't1', resultStatus: 'submitted', round: 'R1', position: 1, score: {}, updateTime: new Date(), player1: {}, player2: {} },
      { _id: 'mr_b', tournamentId: 't2', resultStatus: 'submitted', round: 'R1', position: 1, score: {}, updateTime: new Date(), player1: {}, player2: {} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' }, t2: { _id: 't2', name: 'B' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: 't1', limit: 50 })
  expect(result.items).toHaveLength(1)
  expect(result.items[0].tournamentId).toBe('t1')
})

test('pendingReviewItems truncated when over limit', async () => {
  const rows = Array.from({ length: 80 }).map((_, i) => ({
    _id: `mr_${i}`, tournamentId: 't1', resultStatus: 'submitted',
    round: 'R1', position: i, score: {}, updateTime: new Date(),
    player1: {}, player2: {},
  }))
  const ctx = makeQueryCtx({
    rows,
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await pendingReviewItems(ctx, { tournamentId: null, limit: 50 })
  expect(result.items).toHaveLength(50)
  expect(result.truncated).toBe(true)
})
```

- [ ] **Step 2：跑测试确认 fail**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/query.test.js
```
Expected：4 failed（NOT_IMPLEMENTED）。

- [ ] **Step 3：实装 pendingReviewItems**

替换 `query.js` 中 `pendingReviewItems` stub：

```js
async function pendingReviewItems(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const tournamentId = (payload && payload.tournamentId) || null
  const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 50, 1), 100)

  const total = await ctx.db.countMatchResults({ resultStatus: 'submitted', tournamentId })
  const rows = await ctx.db.queryMatchResults({ resultStatus: 'submitted', tournamentId, limit })

  const tournamentIds = [...new Set(rows.map(r => r.tournamentId))]
  const tournamentDocs = await ctx.db.getTournamentsByIds(tournamentIds)
  const tMap = Object.fromEntries(tournamentDocs.map(t => [t._id, t]))

  const submitterIds = [...new Set(rows.map(r => r.submittedBy).filter(Boolean))]
  const memberDocs = submitterIds.length ? await ctx.db.getMembersByIds(submitterIds) : []
  const mMap = Object.fromEntries(memberDocs.map(m => [m._id, m]))

  const items = rows.map(r => ({
    matchId: r._id,
    tournamentId: r.tournamentId,
    tournamentName: tMap[r.tournamentId] && tMap[r.tournamentId].name || r.tournamentId,
    round: r.round,
    position: r.position,
    scheduledStartLabel: r.scheduledStart ? formatTime(r.scheduledStart) : '',
    courtName: r.courtName || '',
    p1: r.player1 || {},
    p2: r.player2 || {},
    score: r.score || null,
    isDoubles: !!(r.player1 && r.player1.partnerName),
    submitter: r.submittedBy && mMap[r.submittedBy]
      ? { memberId: r.submittedBy, name: mMap[r.submittedBy].name }
      : null,
    submittedAt: r.submittedAt || null,
    updateTime: r.updateTime,
  }))

  return { items, truncated: total > limit }
}

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
```

- [ ] **Step 4：跑测试**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/query.test.js
```
Expected：4 passed。

- [ ] **Step 5：commit**

```bash
git add cloudfunctions/match-results/lib/handlers/query.js cloudfunctions/match-results/lib/__tests__/handlers/query.test.js
git commit -m "feat(match-results): pendingReviewItems for sheet second-fetch"
```

---

### Task 8: 写 `mySummary` 测试 + 实装

**Files:**
- Create: `cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js`
- Modify: `cloudfunctions/match-results/lib/handlers/my-summary.js`

- [ ] **Step 1：创建 my-summary.test.js**

```js
const { mySummary } = require('../../handlers/my-summary')

function makeCtx({ memberId = 'mA', allMatches = [], tournaments = {} } = {}) {
  return {
    callerMemberId: memberId,
    db: {
      queryMyPending: async (mid) => allMatches.filter(m =>
        m.resultStatus === 'pending' &&
        (m.playerIds || []).includes(mid)
      ),
      queryMySubmitted: async (mid) => allMatches.filter(m =>
        m.resultStatus === 'submitted' &&
        (m.playerIds || []).includes(mid)
      ),
      queryMyConfirmed: async (mid, limit) => allMatches.filter(m =>
        m.resultStatus === 'confirmed' &&
        (m.playerIds || []).includes(mid)
      ).slice(0, limit),
      getTournamentsByIds: async (ids) => ids.map(id => tournaments[id]).filter(Boolean),
    },
  }
}

test('mySummary returns three buckets', async () => {
  const ctx = makeCtx({
    allMatches: [
      { _id: 'mr_p', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mA', 'mB'], round: 'R1', position: 1, player1: { name: '我' }, player2: { name: '对手' } },
      { _id: 'mr_s', tournamentId: 't1', resultStatus: 'submitted', playerIds: ['mA', 'mB'], round: 'R1', position: 2, score: { sets: [{ a: 4, b: 2 }] }, submittedAt: new Date() },
      { _id: 'mr_c', tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'], round: 'R2', position: 1, score: { sets: [{ a: 4, b: 0 }] },
        pointsAwarded: { entries: [{ memberId: 'mA', points: 15, role: 'winner' }] }, confirmedAt: new Date() },
    ],
    tournaments: { t1: { _id: 't1', name: 'XXX 杯' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending).toHaveLength(1)
  expect(result.submitted).toHaveLength(1)
  expect(result.confirmed).toHaveLength(1)
  expect(result.confirmed[0].pointsEarned).toBe(15)
})

test('mySummary pending matches partnerId', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      { _id: 'mr_p', tournamentId: 't1', resultStatus: 'pending', playerIds: ['mX', 'mY', 'mA'], round: 'R1', position: 1, player1: {}, player2: {} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.pending).toHaveLength(1)
})

test('mySummary confirmed pointsEarned aggregates only my entries', async () => {
  const ctx = makeCtx({
    memberId: 'mA',
    allMatches: [
      { _id: 'mr_c', tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'], round: 'F', position: 1, score: {},
        pointsAwarded: { entries: [
          { memberId: 'mA', points: 15, role: 'winner' },
          { memberId: 'mA', points: 5, role: 'placement' },
          { memberId: 'mB', points: 8, role: 'loser' },
        ]} },
    ],
    tournaments: { t1: { _id: 't1', name: 'A' } },
  })
  const result = await mySummary(ctx, { historyLimit: 10 })
  expect(result.confirmed[0].pointsEarned).toBe(20)  // 15 + 5
})

test('mySummary respects historyLimit', async () => {
  const matches = Array.from({ length: 15 }).map((_, i) => ({
    _id: `mr_${i}`, tournamentId: 't1', resultStatus: 'confirmed', playerIds: ['mA'],
    round: 'R1', position: i, score: {}, pointsAwarded: { entries: [] }, confirmedAt: new Date(),
  }))
  const ctx = makeCtx({ allMatches: matches, tournaments: { t1: { _id: 't1', name: 'A' } } })
  const result = await mySummary(ctx, { historyLimit: 5 })
  expect(result.confirmed).toHaveLength(5)
})
```

- [ ] **Step 2：跑测试确认 fail**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/my-summary.test.js
```
Expected：4 failed。

- [ ] **Step 3：实装 mySummary**

替换 `my-summary.js`：

```js
async function mySummary(ctx, payload) {
  const memberId = ctx.callerMemberId
  if (!memberId) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const historyLimit = Math.min(Math.max(parseInt(payload && payload.historyLimit, 10) || 10, 1), 50)

  const [pendingRows, submittedRows, confirmedRows] = await Promise.all([
    ctx.db.queryMyPending(memberId),
    ctx.db.queryMySubmitted(memberId),
    ctx.db.queryMyConfirmed(memberId, historyLimit),
  ])

  const tIds = [...new Set([...pendingRows, ...submittedRows, ...confirmedRows].map(r => r.tournamentId))]
  const tournamentDocs = tIds.length ? await ctx.db.getTournamentsByIds(tIds) : []
  const tMap = Object.fromEntries(tournamentDocs.map(t => [t._id, t]))

  function opponentLabel(m) {
    if (!m.player2) return ''
    if (m.player2.partnerName) return `${m.player2.name || '?'} / ${m.player2.partnerName}`
    return m.player2.name || ''
  }
  function partnerLabel(m) {
    if (m.player1 && m.player1.partnerName) return `${m.player1.name || '?'} / ${m.player1.partnerName}`
    return ''
  }
  function sumPoints(awarded) {
    if (!awarded || !Array.isArray(awarded.entries)) return 0
    return awarded.entries
      .filter(e => e.memberId === memberId)
      .reduce((s, e) => s + (e.points || 0), 0)
  }
  function isWinner(m) {
    return m.winner === memberId || (m.winnerIds && m.winnerIds.includes(memberId))
  }

  return {
    pending: pendingRows.map(m => ({
      matchId: m._id,
      tournamentId: m.tournamentId,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      position: m.position,
      scheduledStart: m.scheduledStart || null,
      courtName: m.courtName || '',
      p1: m.player1 || {},
      p2: m.player2 || {},
      partnerLabel: partnerLabel(m),
      isDoubles: !!(m.player1 && m.player1.partnerName),
    })),
    submitted: submittedRows.map(m => ({
      matchId: m._id,
      tournamentId: m.tournamentId,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      score: m.score,
      submittedAt: m.submittedAt,
      opponentLabel: opponentLabel(m),
    })),
    confirmed: confirmedRows.map(m => ({
      matchId: m._id,
      tournamentName: (tMap[m.tournamentId] && tMap[m.tournamentId].name) || m.tournamentId,
      round: m.round,
      score: m.score,
      isWinner: isWinner(m),
      pointsEarned: sumPoints(m.pointsAwarded),
      confirmedAt: m.confirmedAt,
    })),
  }
}

module.exports = { mySummary }
```

- [ ] **Step 4：跑测试**

```bash
cd cloudfunctions/match-results && npx jest lib/__tests__/handlers/my-summary.test.js
```
Expected：4 passed。

- [ ] **Step 5：commit**

```bash
git add cloudfunctions/match-results/lib/handlers/my-summary.js cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js
git commit -m "feat(match-results): mySummary three-bucket member view"
```

---

### Task 9: 把 batch.js / query.js / my-summary.js 接到 `match-results/index.js` 路由

**Files:**
- Modify: `cloudfunctions/match-results/index.js`

- [ ] **Step 1：读取当前 index.js 末尾的 action switch**

确认结构后，在 `switch(action) { ... }` 块**新增** v2.1 case（不删旧的，仅新增）。在 `case 'submittedQueue':` 之前插入：

```js
    case 'batchConfirm': {
      const { batchConfirm } = require('./lib/handlers/batch')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) {
          return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限', requestId: event && event.requestId } }
        }
        const ctx = buildBatchCtx(submitter, /* isAdmin */ true)
        const data = await batchConfirm(ctx, event)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message, requestId: event && event.requestId } }
        return { success: false, error: { code: 'INTERNAL', message: e.message, requestId: event && event.requestId } }
      }
    }
    case 'batchSubmit': {
      const { batchSubmit } = require('./lib/handlers/batch')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter) return { success: false, error: { code: 'FORBIDDEN', message: '请登录', requestId: event && event.requestId } }
        const ctx = buildBatchCtx(submitter, /* isAdmin */ false)
        const data = await batchSubmit(ctx, event)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message, requestId: event && event.requestId } }
        return { success: false, error: { code: 'INTERNAL', message: e.message, requestId: event && event.requestId } }
      }
    }
    case 'pendingReviewItems': {
      const { pendingReviewItems } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } }
        const ctx = buildQueryCtx(submitter)
        const data = await pendingReviewItems(ctx, event)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message } }
        return { success: false, error: { code: 'INTERNAL', message: e.message } }
      }
    }
    case 'mySummary': {
      const { mySummary } = require('./lib/handlers/my-summary')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter) return { success: false, error: { code: 'FORBIDDEN', message: '请登录' } }
        const ctx = buildSummaryCtx(submitter)
        const data = await mySummary(ctx, event)
        return { success: true, data }
      } catch (e) {
        if (e && e.code) return { success: false, error: { code: e.code, message: e.message } }
        return { success: false, error: { code: 'INTERNAL', message: e.message } }
      }
    }
```

- [ ] **Step 2：在 `index.js` 顶部（require 区或函数定义区）添加 ctx builder 函数**

在文件靠近其他 helper 函数处添加：

```js
function buildBatchCtx(submitter, isAdminFlag) {
  const scoreRule = require('./lib/score-rule')
  const stateLib = require('./lib/state')
  return {
    callerOpenid: submitter.openid,
    callerMemberId: submitter._id,
    isAdmin: isAdminFlag,
    confirmedAtNow: new Date(),
    nowDate: new Date(),
    db: {
      getMatch: async (id) => {
        const r = await db.collection('match_results').doc(id).get().catch(() => null)
        return r ? r.data : null
      },
      updateMatch: async (id, patch) => {
        await db.collection('match_results').doc(id).update({ data: patch })
      },
      getRequestLog: async (id) => {
        const r = await db.collection('_request_log').doc(id).get().catch(() => null)
        return r ? r.data : null
      },
      upsertRequestLog: async (id, doc) => {
        const exists = await db.collection('_request_log').doc(id).get().catch(() => null)
        if (exists) {
          await db.collection('_request_log').doc(id).update({ data: doc })
        } else {
          await db.collection('_request_log').add({ data: doc })
        }
      },
    },
    confirmOne: async (current) => stateLib.confirmOne({ matchId: current._id, db }),
    validateScore: scoreRule.validateScore,
  }
}

function buildQueryCtx(submitter) {
  return {
    isAdmin: submitter.isAdmin,
    db: {
      queryMatchResults: async ({ resultStatus, tournamentId, limit }) => {
        const where = { resultStatus }
        if (tournamentId) where.tournamentId = tournamentId
        return (await db.collection('match_results').where(where).orderBy('updateTime', 'desc').limit(limit).get()).data
      },
      countMatchResults: async ({ resultStatus, tournamentId }) => {
        const where = { resultStatus }
        if (tournamentId) where.tournamentId = tournamentId
        const r = await db.collection('match_results').where(where).count()
        return r.total
      },
      getTournamentsByIds: async (ids) => {
        if (!ids.length) return []
        return (await db.collection('tournaments').where({ _id: _.in(ids) }).get()).data
      },
      getMembersByIds: async (ids) => {
        if (!ids.length) return []
        return (await db.collection('members').where({ _id: _.in(ids) }).get()).data
      },
    },
  }
}

function buildSummaryCtx(submitter) {
  return {
    callerMemberId: submitter._id,
    db: {
      queryMyPending: async (mid) => (await db.collection('match_results').where({
        playerIds: _.in([mid]),
        resultStatus: 'pending',
      }).orderBy('scheduledStart', 'asc').limit(50).get()).data,
      queryMySubmitted: async (mid) => (await db.collection('match_results').where({
        playerIds: _.in([mid]),
        resultStatus: 'submitted',
      }).orderBy('submittedAt', 'desc').limit(50).get()).data,
      queryMyConfirmed: async (mid, limit) => (await db.collection('match_results').where({
        playerIds: _.in([mid]),
        resultStatus: 'confirmed',
      }).orderBy('confirmedAt', 'desc').limit(limit).get()).data,
      getTournamentsByIds: async (ids) => {
        if (!ids.length) return []
        return (await db.collection('tournaments').where({ _id: _.in(ids) }).get()).data
      },
    },
  }
}
```

- [ ] **Step 3：syntax check + 跑所有 match-results 测试**

```bash
node -c cloudfunctions/match-results/index.js
cd cloudfunctions/match-results && npx jest
```
Expected：`node -c` OK；jest 全绿（原 55 + 新 batch 11 + query 4 + my-summary 4 = 74 通过）。

- [ ] **Step 4：commit**

```bash
git add cloudfunctions/match-results/index.js
git commit -m "feat(match-results): route v2.1 actions via lib/handlers"
```

---

### Task 10: 迁移现有 `submittedQueue / listByTournament / listByPlayer` 到 `query.js`

**Files:**
- Modify: `cloudfunctions/match-results/lib/handlers/query.js`
- Modify: `cloudfunctions/match-results/index.js`

- [ ] **Step 1：把 index.js 中现有 `submittedQueue / listByTournament / listByPlayer` 三个 case 内的实现迁到 query.js**

读取 index.js 现有 case 内代码后，把对应实现写入 query.js（替换原 stub）：

```js
async function submittedQueue(ctx, event) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const rows = await ctx.db.pagedFetchSubmitted()
  if (rows.length === 0) return { items: [] }
  const grouped = {}
  for (const r of rows) grouped[r.tournamentId] = (grouped[r.tournamentId] || 0) + 1
  const tournamentIds = Object.keys(grouped)
  const tournaments = await ctx.db.getTournamentsByIds(tournamentIds)
  const tMap = Object.fromEntries(tournaments.map(t => [t._id, t]))
  return {
    items: tournamentIds.map(tid => ({
      tournamentId: tid,
      tournamentName: (tMap[tid] && tMap[tid].name) || tid,
      submittedCount: grouped[tid],
    })),
  }
}

async function listByTournament(ctx, event) {
  if (!event.tournamentId) {
    const err = new Error('INVALID_ARG')
    err.code = 'INVALID_ARG'
    throw err
  }
  const results = await ctx.db.listByTournament(event.tournamentId)
  return { results }
}

async function listByPlayer(ctx, event) {
  if (!event.memberId) {
    const err = new Error('INVALID_ARG')
    err.code = 'INVALID_ARG'
    throw err
  }
  const matches = await ctx.db.listByPlayerNotConfirmed(event.memberId)
  return { matches }
}
```

- [ ] **Step 2：在 index.js 内的 buildQueryCtx 补 `pagedFetchSubmitted / listByTournament / listByPlayerNotConfirmed` 方法**

```js
// 在 buildQueryCtx 的 db 对象内补 3 个方法（与上面 pendingReviewItems ctx 共用）
pagedFetchSubmitted: async () => {
  // 复用 index.js 顶部已有的 pagedFetchSubmitted 函数（Phase 8 实装）
  return await pagedFetchSubmitted()
},
listByTournament: async (tournamentId) => (await db.collection('match_results')
  .where({ tournamentId })
  .orderBy('round', 'asc')
  .orderBy('position', 'asc')
  .orderBy('createTime', 'asc')
  .limit(500).get()).data,
listByPlayerNotConfirmed: async (memberId) => (await db.collection('match_results').where({
  playerIds: _.in([memberId]),
  resultStatus: _.neq('confirmed'),
}).orderBy('round', 'asc').limit(200).get()).data,
```

- [ ] **Step 3：把 index.js 内的 `case 'submittedQueue'` / `case 'listByTournament'` / `case 'listByPlayer'` 三块替换为路由调用**

```js
    case 'submittedQueue': {
      const { submittedQueue } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return fail('UNAUTHORIZED', '需要管理员权限')
        const ctx = buildQueryCtx(submitter)
        const data = await submittedQueue(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
    case 'listByTournament': {
      const { listByTournament } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        const ctx = buildQueryCtx(submitter || { isAdmin: false })
        const data = await listByTournament(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
    case 'listByPlayer': {
      const { listByPlayer } = require('./lib/handlers/query')
      try {
        const submitter = await resolveSubmitter()
        const ctx = buildQueryCtx(submitter || { isAdmin: false })
        const data = await listByPlayer(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
```

- [ ] **Step 4：跑全套 match-results 测试**

```bash
cd cloudfunctions/match-results && npx jest
```
Expected：全绿，包括原有的 55 + 新增。

- [ ] **Step 5：commit**

```bash
git add cloudfunctions/match-results/index.js cloudfunctions/match-results/lib/handlers/query.js
git commit -m "refactor(match-results): migrate query handlers to lib/handlers/query.js"
```

---

### Task 11: 把现有 `submit / confirmAll / reconfirmMatch` 迁移到 `submit.js`

**Files:**
- Modify: `cloudfunctions/match-results/lib/handlers/submit.js`
- Modify: `cloudfunctions/match-results/index.js`

- [ ] **Step 1：读 index.js 中现有 `case 'submit'` / `case 'confirmAll'` / `case 'reconfirmMatch'` 完整实现，迁到 submit.js**

`submit.js` 完整实现把这三个 action 的逻辑提取出来；保持函数签名 `async function fn(ctx, event)`。

由于这些函数依赖 `db / _ / stateLib / scoreRule / resolveSubmitter / ok / fail / pagedFetchSubmitted` 等闭包变量，迁移时 ctx 需提供这些依赖（参考 Task 9 buildBatchCtx 风格）。

实装目标：
- `submit(ctx, event)`：完全复刻原 case 内行为，返回 envelope `data`
- `confirmAll(ctx, event)`：同上
- `reconfirmMatch(ctx, event)`：同上

由于代码量大（每个函数 50-100 行），请逐函数复制粘贴后**仅做必要 ctx 替换**（`db` → `ctx.db`、`scoreRule.X` → `ctx.scoreRule.X` 等）。

- [ ] **Step 2：在 index.js 把 3 个 case 改为路由调用**

```js
    case 'submit': {
      const { submit } = require('./lib/handlers/submit')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter) return fail('UNAUTHORIZED', '请登录')
        const ctx = buildSubmitCtx(submitter)
        const data = await submit(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
    case 'confirmAll': {
      const { confirmAll } = require('./lib/handlers/submit')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return fail('UNAUTHORIZED', '需要管理员权限')
        const ctx = buildSubmitCtx(submitter)
        const data = await confirmAll(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
    case 'reconfirmMatch': {
      const { reconfirmMatch } = require('./lib/handlers/submit')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return fail('UNAUTHORIZED', '需要管理员权限')
        const ctx = buildSubmitCtx(submitter)
        const data = await reconfirmMatch(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
```

- [ ] **Step 3：实装 `buildSubmitCtx`（与 batch ctx 类似）**

```js
function buildSubmitCtx(submitter) {
  return {
    ...buildBatchCtx(submitter, submitter.isAdmin),
    // submit.js 内部需要的其它依赖
    db: {
      ...buildBatchCtx(submitter, submitter.isAdmin).db,
      collection: (name) => db.collection(name),
      command: _,
    },
    stateLib: require('./lib/state'),
    scoreRule: require('./lib/score-rule'),
  }
}
```

- [ ] **Step 4：跑所有 match-results 单测确认现状 55 全绿**

```bash
cd cloudfunctions/match-results && npx jest
```
Expected：全绿。Phase 8 现有的 state.test.js / validate.test.js / score-rule.test.js 全过；新增的 batch / query / my-summary 测试全过。

- [ ] **Step 5：commit**

```bash
git add cloudfunctions/match-results/index.js cloudfunctions/match-results/lib/handlers/submit.js
git commit -m "refactor(match-results): migrate submit/confirmAll/reconfirmMatch to handlers/submit.js"
```

---

## Phase 2 · 工作台接口（Tasks 12–15）

### Task 12: 写 `adminConsoleSnapshot` 测试

**Files:**
- Create: `cloudfunctions/tournaments/lib/__tests__/admin-console.test.js`

- [ ] **Step 1：创建测试目录 + 文件**

```bash
mkdir -p cloudfunctions/tournaments/lib/__tests__
```

`cloudfunctions/tournaments/lib/__tests__/admin-console.test.js`:
```js
const { adminConsoleSnapshot } = require('../handlers/admin-console')

function makeCtx({ isAdmin = true, openid = 'oA', memberId = 'mA', pending = [], drafts = [], ongoing = [], throws = {} } = {}) {
  return {
    isAdmin, callerOpenid: openid, callerMemberId: memberId,
    db: {
      aggregateSubmitted: async () => {
        if (throws.pending) throw new Error('PENDING_FAILED')
        return pending
      },
      listDrafts: async () => {
        if (throws.drafts) throw new Error('DRAFTS_FAILED')
        return drafts
      },
      listOngoing: async () => {
        if (throws.ongoing) throw new Error('ONGOING_FAILED')
        return ongoing
      },
    },
  }
}

test('snapshot FORBIDDEN: non-admin', async () => {
  const ctx = makeCtx({ isAdmin: false })
  await expect(adminConsoleSnapshot(ctx, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('snapshot happy: returns 3 sections', async () => {
  const ctx = makeCtx({
    pending: [
      { tournamentId: 't1', tournamentName: 'A', format: 'regular', count: 2, mostRecentSubmitAt: new Date() },
    ],
    drafts: [{ _id: 't2', name: 'Draft', playerCount: 5, scheduleReady: false, updatedAt: new Date() }],
    ongoing: [{ _id: 't3', name: 'Live', format: 'knockout', round: 'R2/3', remainingMatches: 6 }],
  })
  const result = await adminConsoleSnapshot(ctx, {})
  expect(result.pendingConfirm.total).toBe(2)
  expect(result.pendingConfirm.byTournament).toHaveLength(1)
  expect(result.myDrafts).toHaveLength(1)
  expect(result.ongoing).toHaveLength(1)
})

test('snapshot pending sub-query fails → integral SNAPSHOT_FAILED', async () => {
  const ctx = makeCtx({ throws: { pending: true } })
  await expect(adminConsoleSnapshot(ctx, {})).rejects.toMatchObject({ code: 'SNAPSHOT_FAILED' })
})

test('snapshot any of 3 sub-queries fails → integral error (no single-block degrade)', async () => {
  const ctx = makeCtx({ throws: { drafts: true } })
  await expect(adminConsoleSnapshot(ctx, {})).rejects.toMatchObject({ code: 'SNAPSHOT_FAILED' })
})

test('snapshot pendingConfirm.total aggregates byTournament counts', async () => {
  const ctx = makeCtx({
    pending: [
      { tournamentId: 't1', tournamentName: 'A', format: 'regular', count: 2, mostRecentSubmitAt: new Date() },
      { tournamentId: 't2', tournamentName: 'B', format: 'knockout', count: 3, mostRecentSubmitAt: new Date() },
    ],
  })
  const result = await adminConsoleSnapshot(ctx, {})
  expect(result.pendingConfirm.total).toBe(5)
  expect(result.pendingConfirm.byTournament).toHaveLength(2)
})

test('snapshot empty input returns all-zero structure', async () => {
  const ctx = makeCtx({})
  const result = await adminConsoleSnapshot(ctx, {})
  expect(result.pendingConfirm.total).toBe(0)
  expect(result.pendingConfirm.byTournament).toEqual([])
  expect(result.myDrafts).toEqual([])
  expect(result.ongoing).toEqual([])
})
```

- [ ] **Step 2：跑测试确认 fail**

```bash
cd cloudfunctions/tournaments && npx jest lib/__tests__/admin-console.test.js
```
Expected：`Cannot find module '../handlers/admin-console'` 或 6 failed。

- [ ] **Step 3：commit**

```bash
git add cloudfunctions/tournaments/lib/__tests__/admin-console.test.js
git commit -m "test(tournaments): adminConsoleSnapshot (red)"
```

---

### Task 13: 实装 `adminConsoleSnapshot`

**Files:**
- Create: `cloudfunctions/tournaments/lib/handlers/admin-console.js`
- Modify: `cloudfunctions/tournaments/index.js`

- [ ] **Step 1：创建 handlers 目录 + 实装**

```bash
mkdir -p cloudfunctions/tournaments/lib/handlers
```

`cloudfunctions/tournaments/lib/handlers/admin-console.js`:
```js
async function adminConsoleSnapshot(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  try {
    const [pending, drafts, ongoing] = await Promise.all([
      ctx.db.aggregateSubmitted(),
      ctx.db.listDrafts(ctx.callerMemberId),
      ctx.db.listOngoing(),
    ])
    const total = pending.reduce((s, p) => s + (p.count || 0), 0)
    return {
      pendingConfirm: { total, byTournament: pending },
      myDrafts: drafts,
      ongoing,
    }
  } catch (e) {
    const err = new Error('SNAPSHOT_FAILED')
    err.code = 'SNAPSHOT_FAILED'
    err.cause = e.message
    throw err
  }
}

module.exports = { adminConsoleSnapshot }
```

- [ ] **Step 2：跑测试**

```bash
cd cloudfunctions/tournaments && npx jest lib/__tests__/admin-console.test.js
```
Expected：6 passed。

- [ ] **Step 3：在 `tournaments/index.js` switch 内添加路由**

在合适的 case 位置追加：

```js
    case 'adminConsoleSnapshot': {
      const { adminConsoleSnapshot } = require('./lib/handlers/admin-console')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
        const ctx = buildAdminConsoleCtx(submitter)
        const data = await Promise.race([
          adminConsoleSnapshot(ctx, event),
          new Promise((_, rej) => setTimeout(() => {
            const err = new Error('SNAPSHOT_TIMEOUT'); err.code = 'SNAPSHOT_TIMEOUT'; rej(err)
          }, 8000)),
        ])
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
```

并在文件 helper 区添加 `buildAdminConsoleCtx`：

```js
function buildAdminConsoleCtx(submitter) {
  return {
    isAdmin: submitter.isAdmin,
    callerOpenid: submitter.openid,
    callerMemberId: submitter._id,
    db: {
      aggregateSubmitted: async () => {
        const rows = (await db.collection('match_results')
          .where({ resultStatus: 'submitted' })
          .orderBy('updateTime', 'desc')
          .limit(200).get()).data
        const tIds = [...new Set(rows.map(r => r.tournamentId))]
        const tournaments = tIds.length
          ? (await db.collection('tournaments').where({ _id: _.in(tIds) }).get()).data
          : []
        const tMap = Object.fromEntries(tournaments.map(t => [t._id, t]))
        const grouped = {}
        for (const r of rows) {
          const k = r.tournamentId
          if (!grouped[k]) {
            grouped[k] = {
              tournamentId: k,
              tournamentName: (tMap[k] && tMap[k].name) || k,
              format: (tMap[k] && tMap[k].format) || 'regular',
              count: 0,
              mostRecentSubmitAt: r.submittedAt || r.updateTime || null,
            }
          }
          grouped[k].count += 1
          const cur = grouped[k].mostRecentSubmitAt
          const cmp = r.submittedAt || r.updateTime
          if (cmp && (!cur || new Date(cmp) > new Date(cur))) grouped[k].mostRecentSubmitAt = cmp
        }
        return Object.values(grouped)
      },
      listDrafts: async (memberId) => (await db.collection('tournaments').where({
        status: 'draft',
        createdBy: memberId,
      }).orderBy('updateTime', 'desc').limit(20).get()).data.map(t => ({
        tournamentId: t._id,
        name: t.name,
        playerCount: t.playerCount || 0,
        scheduleReady: !!(t.schedulePlan && t.schedulePlan.courts && t.schedulePlan.courts.length),
        updatedAt: t.updateTime,
      })),
      listOngoing: async () => {
        const rows = (await db.collection('tournaments').where({ status: 'ongoing' })
          .orderBy('updateTime', 'desc').limit(50).get()).data
        return rows.map(t => ({
          tournamentId: t._id,
          name: t.name,
          format: t.format,
          round: t.currentRoundLabel || '',
          remainingMatches: t.remainingMatches || 0,
        }))
      },
    },
  }
}
```

- [ ] **Step 4：跑全部 tournaments 测试**

```bash
cd cloudfunctions/tournaments && npx jest
```
Expected：现有 19 + 新 6 = 25 passed。

- [ ] **Step 5：commit**

```bash
git add cloudfunctions/tournaments/index.js cloudfunctions/tournaments/lib/handlers/admin-console.js
git commit -m "feat(tournaments): adminConsoleSnapshot for v2.1 workstation"
```

---

### Task 14: 写 + 实装 `finishedRecent`

**Files:**
- Create: `cloudfunctions/tournaments/lib/__tests__/finished-recent.test.js`
- Create: `cloudfunctions/tournaments/lib/handlers/finished-recent.js`
- Modify: `cloudfunctions/tournaments/index.js`

- [ ] **Step 1：写测试**

`cloudfunctions/tournaments/lib/__tests__/finished-recent.test.js`:
```js
const { finishedRecent } = require('../handlers/finished-recent')

function makeCtx({ isAdmin = true, list = [] } = {}) {
  return {
    isAdmin,
    db: {
      listFinished: async (limit) => list.slice(0, limit),
    },
  }
}

test('finishedRecent FORBIDDEN: non-admin', async () => {
  const ctx = makeCtx({ isAdmin: false })
  await expect(finishedRecent(ctx, {})).rejects.toMatchObject({ code: 'FORBIDDEN' })
})

test('finishedRecent default limit 5', async () => {
  const list = Array.from({ length: 10 }).map((_, i) => ({
    _id: `t${i}`, name: `T${i}`, format: 'regular', completedAt: new Date(), winnerLabel: `W${i}`,
  }))
  const ctx = makeCtx({ list })
  const result = await finishedRecent(ctx, {})
  expect(result.items).toHaveLength(5)
})

test('finishedRecent custom limit clamps to 20', async () => {
  const list = Array.from({ length: 30 }).map((_, i) => ({ _id: `t${i}`, name: `T${i}`, completedAt: new Date() }))
  const ctx = makeCtx({ list })
  const result = await finishedRecent(ctx, { limit: 100 })
  expect(result.items).toHaveLength(20)
})

test('finishedRecent items shape', async () => {
  const ctx = makeCtx({ list: [{ _id: 't1', name: 'X', format: 'knockout', completedAt: new Date(), winnerLabel: 'W' }] })
  const result = await finishedRecent(ctx, {})
  expect(result.items[0]).toMatchObject({
    tournamentId: 't1', name: 'X', format: 'knockout', winnerLabel: 'W',
  })
  expect(result.items[0].completedAt).toBeDefined()
})

test('finishedRecent empty', async () => {
  const ctx = makeCtx({ list: [] })
  const result = await finishedRecent(ctx, {})
  expect(result.items).toEqual([])
})
```

- [ ] **Step 2：跑测试确认 fail（找不到模块）**

```bash
cd cloudfunctions/tournaments && npx jest lib/__tests__/finished-recent.test.js
```
Expected：模块不存在错误。

- [ ] **Step 3：实装 `finished-recent.js`**

`cloudfunctions/tournaments/lib/handlers/finished-recent.js`:
```js
async function finishedRecent(ctx, payload) {
  if (!ctx.isAdmin) {
    const err = new Error('FORBIDDEN')
    err.code = 'FORBIDDEN'
    throw err
  }
  const limit = Math.min(Math.max(parseInt(payload && payload.limit, 10) || 5, 1), 20)
  const rows = await ctx.db.listFinished(limit)
  return {
    items: rows.map(t => ({
      tournamentId: t._id,
      name: t.name,
      format: t.format,
      completedAt: t.completedAt,
      winnerLabel: t.winnerLabel || '',
    })),
  }
}

module.exports = { finishedRecent }
```

- [ ] **Step 4：在 tournaments/index.js 加路由**

```js
    case 'finishedRecent': {
      const { finishedRecent } = require('./lib/handlers/finished-recent')
      try {
        const submitter = await resolveSubmitter()
        if (!submitter || !submitter.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
        const ctx = {
          isAdmin: true,
          db: {
            listFinished: async (limit) => (await db.collection('tournaments').where({ status: 'completed' })
              .orderBy('completedAt', 'desc').limit(limit).get()).data,
          },
        }
        const data = await finishedRecent(ctx, event)
        return ok(data)
      } catch (e) {
        return fail(e.code || 'INTERNAL', e.message)
      }
    }
```

- [ ] **Step 5：跑测试 + commit**

```bash
cd cloudfunctions/tournaments && npx jest
```
Expected：现有 19 + admin-console 6 + finished-recent 5 = 30 passed。

```bash
git add cloudfunctions/tournaments/
git commit -m "feat(tournaments): finishedRecent lazy-load for workstation"
```

---

### Task 15: 跑全套云函数单测，校验基线不破

**Files:** N/A

- [ ] **Step 1：跑全部 cloud function 单测**

```bash
cd cloudfunctions/match-results && npx jest && \
cd ../tournaments && npx jest && \
cd ../tournament-brackets && npx jest && \
cd ../points-engine && npx jest && \
cd ../weekly-star && npx jest && \
cd ../_shared && npx jest
```

Expected：
- match-results: ≥ 74 passed（55 现状 + 11 batch + 4 query + 4 my-summary）
- tournaments: 30 passed（19 现状 + 6 admin-console + 5 finished-recent）
- tournament-brackets: 44 passed（不变）
- points-engine: 16 passed（不变）
- weekly-star: 4 passed（不变）
- _shared: 22 passed（不变）

- [ ] **Step 2：commit 跑测结果（无代码变动，仅记录 Phase 1+2 完成）**

```bash
git commit --allow-empty -m "test(v2.1): phase 1+2 backend baseline green (cloud function tests passing)"
```

---

## Phase 3 · 前端基础（Tasks 16–20）

### Task 16: 写 `utils/cloud.call` v2 wrapper 测试

**Files:**
- Create: `miniprogram/utils/__tests__/cloud.test.js`

- [ ] **Step 1：检查 miniprogram 是否有 jest 配置；若无，复用 _shared 模式（在仓库根写 jest）**

```bash
ls /Users/liaoxiaole/FOPEN-PURE/miniprogram/package.json 2>&1
```

如果不存在，由根目录的 `scripts/test-miniprogram-mock.js` 承担测试角色。本任务在 cloudfunctions/_shared 风格下用 jest 单测 cloud wrapper 逻辑。

实际放置：`miniprogram/utils/__tests__/cloud.test.js`，由根 `scripts/sync-shared-libs.sh` 同期 lint，但为单测需要单独跑：

如果项目根没有 jest，在 `miniprogram` 下创建一份 minimal jest 配置：

```bash
cat > /Users/liaoxiaole/FOPEN-PURE/miniprogram/package.json <<'EOF'
{
  "name": "miniprogram-tests",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "test": "jest"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.js"]
  }
}
EOF
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npm install
```

- [ ] **Step 2：写 cloud wrapper 测试**

`miniprogram/utils/__tests__/cloud.test.js`:
```js
// Mock global wx before requiring cloud.js
const callMock = jest.fn()
global.wx = { cloud: { callFunction: callMock } }

// Mock dependent modules required by cloud.js
jest.mock('../../config', () => ({ USE_MOCK: false, MOCK_SCENARIO: 'success' }))
jest.mock('../../mock/index', () => ({ callMockFunction: jest.fn() }))

const { call } = require('../cloud')

beforeEach(() => { callMock.mockReset() })

test('call returns ok=true with data on success envelope', async () => {
  callMock.mockResolvedValueOnce({ result: { success: true, data: { foo: 1 } } })
  const res = await call('match-results', { action: 'mySummary', payload: {} })
  expect(res.ok).toBe(true)
  expect(res.data).toEqual({ foo: 1 })
  expect(res.traceId).toBeDefined()
})

test('call returns ok=false when envelope success:false', async () => {
  callMock.mockResolvedValueOnce({ result: { success: false, error: { code: 'FORBIDDEN', message: '需要管理员权限' } } })
  const res = await call('tournaments', { action: 'adminConsoleSnapshot', payload: {} })
  expect(res.ok).toBe(false)
  expect(res.error.code).toBe('FORBIDDEN')
  expect(res.error.message).toBe('需要管理员权限')
})

test('call returns ok=false with INVALID_ENVELOPE when cloud returns non-envelope', async () => {
  callMock.mockResolvedValueOnce({ result: { foo: 'bar' } })
  const res = await call('x', {})
  expect(res.ok).toBe(false)
  expect(res.error.code).toBe('INVALID_ENVELOPE')
})

test('call never throws on wx.cloud.callFunction error', async () => {
  callMock.mockRejectedValueOnce({ errMsg: 'cloud.callFunction:fail timeout' })
  const res = await call('x', {})
  expect(res.ok).toBe(false)
  expect(res.error.code).toBe('TIMEOUT')
  expect(res.error.retryable).toBe(true)
})

test('call classifies network errors', async () => {
  callMock.mockRejectedValueOnce({ errMsg: 'cloud.callFunction:fail network error' })
  const res = await call('x', {})
  expect(res.error.code).toBe('NETWORK')
  expect(res.error.retryable).toBe(true)
})

test('call calls onLoading(true) before request and onLoading(false) after', async () => {
  callMock.mockResolvedValueOnce({ result: { success: true, data: {} } })
  const loading = jest.fn()
  await call('x', {}, { onLoading: loading })
  expect(loading).toHaveBeenNthCalledWith(1, true)
  expect(loading).toHaveBeenNthCalledWith(2, false)
})

test('call generates unique traceId per call', async () => {
  callMock.mockResolvedValue({ result: { success: true, data: {} } })
  const a = await call('x', {})
  const b = await call('x', {})
  expect(a.traceId).not.toBe(b.traceId)
})

test('call passes payload through to wx.cloud.callFunction', async () => {
  callMock.mockResolvedValueOnce({ result: { success: true, data: {} } })
  await call('match-results', { action: 'batchConfirm', payload: { matches: [], requestId: 'req_x' } })
  expect(callMock).toHaveBeenCalledWith(expect.objectContaining({
    name: 'match-results',
    data: { action: 'batchConfirm', payload: { matches: [], requestId: 'req_x' } },
  }))
})
```

- [ ] **Step 3：跑测试确认 fail（`call` 未导出）**

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npx jest utils/__tests__/cloud.test.js
```
Expected：失败（`call is not a function`）。

- [ ] **Step 4：commit 测试**

```bash
git add miniprogram/package.json miniprogram/utils/__tests__/cloud.test.js
git commit -m "test(miniprogram): cloud wrapper v2 (red)"
```

---

### Task 17: 实装 `utils/cloud.call` v2 wrapper

**Files:**
- Modify: `miniprogram/utils/cloud.js`

- [ ] **Step 1：在 `cloud.js` 末尾追加 v2 wrapper（不动现有 `callFunction`）**

```js
function generateTraceId() {
  return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function classifyClientError(e) {
  const msg = (e && (e.errMsg || e.message) || '').toLowerCase()
  if (msg.includes('timeout')) return 'TIMEOUT'
  if (msg.includes('network')) return 'NETWORK'
  return 'UNKNOWN'
}

async function call(name, payload, options = {}) {
  const traceId = options.traceId || generateTraceId()
  const timeout = options.timeout || 8000
  const onLoading = options.onLoading

  if (onLoading) onLoading(true)
  try {
    const res = await callFunction({ name, data: payload, config: { timeout } })
    const env = res && res.result
    if (!env || typeof env.success !== 'boolean') {
      return { ok: false, error: { code: 'INVALID_ENVELOPE', message: 'cloud function 返回非 envelope', retryable: false }, traceId }
    }
    if (env.success === false) {
      return { ok: false, error: { ...(env.error || {}) }, traceId }
    }
    return { ok: true, data: env.data, traceId }
  } catch (e) {
    const code = classifyClientError(e)
    return {
      ok: false,
      error: { code, message: (e && (e.errMsg || e.message)) || '请求失败', retryable: ['NETWORK', 'TIMEOUT'].includes(code) },
      traceId,
    }
  } finally {
    if (onLoading) onLoading(false)
  }
}

module.exports = {
  callFunction,
  call,
}
```

(注意：保留 `module.exports = { callFunction }` 之前的导出；只是把它扩展为 `{ callFunction, call }`。)

- [ ] **Step 2：跑测试**

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npx jest utils/__tests__/cloud.test.js
```
Expected：8 passed。

- [ ] **Step 3：commit**

```bash
git add miniprogram/utils/cloud.js
git commit -m "feat(miniprogram): cloud.call v2 wrapper with ok/data/error/traceId"
```

---

### Task 18: 实装 `status-tag` 组件

**Files:**
- Create: `miniprogram/components/status-tag/index.js`
- Create: `miniprogram/components/status-tag/index.json`
- Create: `miniprogram/components/status-tag/index.wxml`
- Create: `miniprogram/components/status-tag/index.wxss`

- [ ] **Step 1：创建组件 4 文件**

`miniprogram/components/status-tag/index.json`:
```json
{ "component": true, "usingComponents": {} }
```

`miniprogram/components/status-tag/index.js`:
```js
Component({
  options: { multipleSlots: false },
  properties: {
    type: { type: String, value: 'muted' },
    text: { type: String, value: '' },
    count: { type: null, value: null },
    size: { type: String, value: 'md' },
  },
})
```

`miniprogram/components/status-tag/index.wxml`:
```xml
<view class="status-tag status-tag--{{type}} status-tag--{{size}}">
  <text class="status-tag__text">{{text}}</text>
  <text wx:if="{{count !== null && count !== undefined}}" class="status-tag__count">{{count}}</text>
</view>
```

`miniprogram/components/status-tag/index.wxss`:
```css
.status-tag {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-pill);
  font-weight: 500;
  white-space: nowrap;
  vertical-align: middle;
}
.status-tag--sm { font-size: 20rpx; padding: 2rpx 14rpx; }
.status-tag--md { font-size: 22rpx; padding: 4rpx 18rpx; }
.status-tag__count {
  margin-left: 8rpx;
  padding: 0 8rpx;
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.25);
  font-size: 18rpx;
}
.status-tag--warn { background: rgba(220, 38, 38, 0.12); color: #991B1B; }
.status-tag--warn-solid { background: var(--color-danger); color: #FFF; }
.status-tag--warn-solid .status-tag__count { background: rgba(255, 255, 255, 0.3); }
.status-tag--ok { background: rgba(132, 204, 22, 0.18); color: #3F6212; }
.status-tag--amber { background: rgba(245, 158, 11, 0.18); color: #92400E; }
.status-tag--muted { background: var(--color-bg-3); color: var(--color-muted); }
.status-tag--info { background: var(--color-ink); color: #FFF; }
```

- [ ] **Step 2：node syntax check**

```bash
node -c miniprogram/components/status-tag/index.js && echo "OK"
```
Expected：`OK`

- [ ] **Step 3：commit**

```bash
git add miniprogram/components/status-tag
git commit -m "feat(miniprogram): status-tag component for v2.1 unified state badges"
```

---

### Task 19: 实装 `empty-state` 组件 + 单测

**Files:**
- Create: `miniprogram/components/empty-state/index.{js,json,wxml,wxss}`
- Create: `miniprogram/components/empty-state/__tests__/index.test.js`

- [ ] **Step 1：写测试**

`miniprogram/components/empty-state/__tests__/index.test.js`:
```js
// Lightweight component logic test (without WeChat runtime)
let definition
global.Component = (def) => { definition = def }

require('../index')

beforeEach(() => {
  // 重置 console.error spy
})

test('empty-state defines required props', () => {
  expect(definition.properties).toBeDefined()
  expect(definition.properties.title).toBeDefined()
  expect(definition.properties.action).toBeDefined()
  expect(definition.properties.icon).toBeDefined()
  expect(definition.properties.subtitle).toBeDefined()
})

test('onActionTap triggers event "action"', () => {
  const ctx = { triggerEvent: jest.fn(), properties: { action: '查看' } }
  definition.methods.onActionTap.call(ctx)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('action')
})

test('attached lifecycle logs error when action prop missing', () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const ctx = { properties: { action: '' } }
  definition.lifetimes.attached.call(ctx)
  expect(errSpy).toHaveBeenCalled()
  errSpy.mockRestore()
})

test('attached does not log error when action present', () => {
  const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const ctx = { properties: { action: '重试' } }
  definition.lifetimes.attached.call(ctx)
  expect(errSpy).not.toHaveBeenCalled()
  errSpy.mockRestore()
})
```

- [ ] **Step 2：实装组件文件**

`miniprogram/components/empty-state/index.json`:
```json
{ "component": true, "usingComponents": {} }
```

`miniprogram/components/empty-state/index.js`:
```js
Component({
  properties: {
    icon: { type: String, value: '' },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    action: { type: String, value: '' },
  },
  lifetimes: {
    attached() {
      if (!this.properties.action) {
        console.error('[empty-state] missing required prop "action". v2.1 rule: empty state must offer a next step.')
      }
    },
  },
  methods: {
    onActionTap() {
      this.triggerEvent('action')
    },
  },
})
```

`miniprogram/components/empty-state/index.wxml`:
```xml
<view class="empty-state">
  <view wx:if="{{icon}}" class="empty-state__icon empty-state__icon--{{icon}}"></view>
  <view class="empty-state__title">{{title}}</view>
  <view wx:if="{{subtitle}}" class="empty-state__subtitle">{{subtitle}}</view>
  <view wx:if="{{action}}" class="empty-state__cta" bindtap="onActionTap">{{action}}</view>
</view>
```

`miniprogram/components/empty-state/index.wxss`:
```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80rpx 40rpx;
  text-align: center;
}
.empty-state__icon {
  width: 96rpx;
  height: 96rpx;
  margin-bottom: 24rpx;
  border-radius: 50%;
  background: var(--color-bg-3);
}
.empty-state__icon--sprout { background: rgba(132, 204, 22, 0.18); }
.empty-state__icon--check { background: rgba(132, 204, 22, 0.18); }
.empty-state__icon--warn { background: rgba(220, 38, 38, 0.12); }
.empty-state__icon--plus { background: var(--color-bg-3); }
.empty-state__title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--color-ink);
  margin-bottom: 8rpx;
}
.empty-state__subtitle {
  font-size: 24rpx;
  color: var(--color-muted);
  margin-bottom: 32rpx;
  line-height: 1.5;
}
.empty-state__cta {
  background: var(--color-ink);
  color: #FFF;
  font-size: 26rpx;
  padding: 16rpx 36rpx;
  border-radius: var(--radius-sm);
}
.empty-state__cta:active { opacity: 0.85; }
```

- [ ] **Step 3：跑测试**

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npx jest components/empty-state/__tests__/index.test.js
```
Expected：4 passed。

- [ ] **Step 4：commit**

```bash
git add miniprogram/components/empty-state
git commit -m "feat(miniprogram): empty-state component (action required, runtime check)"
```

---

### Task 20: 实装 `batch-result-sheet` 组件 + 单测

**Files:**
- Create: `miniprogram/components/batch-result-sheet/index.{js,json,wxml,wxss}`
- Create: `miniprogram/components/batch-result-sheet/__tests__/index.test.js`

- [ ] **Step 1：先写测试**

`miniprogram/components/batch-result-sheet/__tests__/index.test.js`:
```js
let def
global.Component = (d) => { def = d }
require('../index')

function makeCtx(initialData = {}) {
  const ctx = {
    properties: { visible: false, title: '', mode: 'confirm', items: [], result: null },
    data: { stateName: 'closed', autoCloseTimer: null, ...initialData },
    triggerEvent: jest.fn(),
    setData: jest.fn(function (d) { Object.assign(this.data, d) }),
  }
  return ctx
}

test('observer "visible:false → state closed"', () => {
  const ctx = makeCtx()
  def.observers['visible'].call(ctx, false)
  expect(ctx.data.stateName).toBe('closed')
})

test('observer "visible:true with items → state previewing"', () => {
  const ctx = makeCtx()
  ctx.properties.items = [{ matchId: 'm1' }]
  ctx.properties.result = null
  def.observers['visible'].call(ctx, true)
  expect(ctx.data.stateName).toBe('previewing')
})

test('observer "result has failures → state result"', () => {
  const ctx = makeCtx({ stateName: 'submitting' })
  ctx.properties.visible = true
  ctx.properties.result = { successIds: ['a'], failures: [{ matchId: 'b', code: 'CLOUD_TIMEOUT', retryable: true }] }
  def.observers['result'].call(ctx, ctx.properties.result)
  expect(ctx.data.stateName).toBe('result')
})

test('observer "result all-ok schedules auto-close timer"', () => {
  jest.useFakeTimers()
  const ctx = makeCtx({ stateName: 'submitting' })
  ctx.properties.visible = true
  ctx.properties.result = { successIds: ['a', 'b'], failures: [] }
  def.observers['result'].call(ctx, ctx.properties.result)
  expect(ctx.data.stateName).toBe('result')
  expect(ctx.data.autoCloseTimer).toBeTruthy()
  jest.advanceTimersByTime(3000)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('close', { reason: 'all-ok' })
  jest.useRealTimers()
})

test('onCommit emits commit with matchIds', () => {
  const ctx = makeCtx()
  ctx.properties.items = [{ matchId: 'a' }, { matchId: 'b' }]
  def.methods.onCommit.call(ctx)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('commit', { matchIds: ['a', 'b'] })
  expect(ctx.data.stateName).toBe('submitting')
})

test('onCommit blocked when stateName=submitting (avoid duplicate)', () => {
  const ctx = makeCtx({ stateName: 'submitting' })
  ctx.properties.items = [{ matchId: 'a' }]
  def.methods.onCommit.call(ctx)
  expect(ctx.triggerEvent).not.toHaveBeenCalled()
})

test('onRetry emits retry with retryable failureIds only', () => {
  const ctx = makeCtx({ stateName: 'result' })
  ctx.properties.result = { successIds: [], failures: [
    { matchId: 'a', retryable: true }, { matchId: 'b', retryable: false },
  ] }
  def.methods.onRetry.call(ctx)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('retry', { failureIds: ['a'] })
})

test('onClose clears auto-close timer', () => {
  jest.useFakeTimers()
  const ctx = makeCtx({ stateName: 'result', autoCloseTimer: setTimeout(() => {}, 5000) })
  def.methods.onClose.call(ctx)
  expect(ctx.data.autoCloseTimer).toBe(null)
  expect(ctx.triggerEvent).toHaveBeenCalledWith('close', { reason: 'manual' })
  jest.useRealTimers()
})

test('detached lifecycle clears timer', () => {
  jest.useFakeTimers()
  const ctx = makeCtx({ stateName: 'result', autoCloseTimer: setTimeout(() => {}, 5000) })
  def.lifetimes.detached.call(ctx)
  expect(ctx.data.autoCloseTimer).toBe(null)
  jest.useRealTimers()
})

test('onEditRow emits editrow with matchId', () => {
  const ctx = makeCtx({ stateName: 'previewing' })
  def.methods.onEditRow.call(ctx, { currentTarget: { dataset: { matchid: 'm1' } } })
  expect(ctx.triggerEvent).toHaveBeenCalledWith('editrow', { matchId: 'm1' })
})
```

- [ ] **Step 2：跑测试确认 fail（模块未实装）**

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npx jest components/batch-result-sheet/__tests__/index.test.js
```
Expected：失败。

- [ ] **Step 3：实装组件**

`miniprogram/components/batch-result-sheet/index.json`:
```json
{ "component": true, "usingComponents": { "status-tag": "../status-tag/index" } }
```

`miniprogram/components/batch-result-sheet/index.js`:
```js
Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    mode: { type: String, value: 'confirm' },  // confirm | submit | reconfirm
    items: { type: Array, value: [] },
    result: { type: null, value: null },
  },
  data: {
    stateName: 'closed',   // closed | previewing | submitting | result
    autoCloseTimer: null,
  },
  observers: {
    'visible'(visible) {
      if (!visible) {
        this._clearTimer()
        this.setData({ stateName: 'closed' })
        return
      }
      // open: decide previewing vs loading
      if (this.properties.items && this.properties.items.length > 0) {
        this.setData({ stateName: 'previewing' })
      } else {
        this.setData({ stateName: 'loading' })
      }
    },
    'items'(items) {
      if (!this.properties.visible) return
      if (this.data.stateName === 'loading' && items && items.length > 0) {
        this.setData({ stateName: 'previewing' })
      }
    },
    'result'(result) {
      if (!result) return
      this.setData({ stateName: 'result' })
      const allOk = (!result.failures || result.failures.length === 0)
      if (allOk) {
        this._clearTimer()
        const timer = setTimeout(() => {
          this.triggerEvent('close', { reason: 'all-ok' })
        }, 3000)
        this.setData({ autoCloseTimer: timer })
      }
    },
  },
  lifetimes: {
    detached() {
      this._clearTimer()
    },
  },
  methods: {
    _clearTimer() {
      if (this.data.autoCloseTimer) {
        clearTimeout(this.data.autoCloseTimer)
        this.setData({ autoCloseTimer: null })
      }
    },
    onCommit() {
      if (this.data.stateName === 'submitting') return
      const items = this.properties.items || []
      const matchIds = items.map(it => it.matchId)
      this.setData({ stateName: 'submitting' })
      this.triggerEvent('commit', { matchIds })
    },
    onRetry() {
      if (this.data.stateName === 'submitting') return
      const result = this.properties.result || {}
      const failureIds = (result.failures || []).filter(f => f.retryable).map(f => f.matchId)
      if (failureIds.length === 0) return
      this.setData({ stateName: 'submitting' })
      this.triggerEvent('retry', { failureIds })
    },
    onEditRow(e) {
      const matchId = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.matchid
      if (!matchId) return
      this.triggerEvent('editrow', { matchId })
    },
    onClose() {
      this._clearTimer()
      this.triggerEvent('close', { reason: 'manual' })
    },
  },
})
```

`miniprogram/components/batch-result-sheet/index.wxml`:
```xml
<view wx:if="{{visible}}" class="brs-mask" bindtap="onClose">
  <view class="brs-sheet" catchtap="">
    <view class="brs-grab"></view>
    <view class="brs-title">
      <text>{{title}}</text>
      <text wx:if="{{stateName === 'result'}}" class="brs-title-meta">
        ✓ {{result.successIds.length}} / ✗ {{result.failures.length}}
      </text>
    </view>

    <view wx:if="{{stateName === 'loading'}}" class="brs-loading">
      <view class="brs-skel" wx:for="{{[1,2,3]}}" wx:key="*this"></view>
    </view>

    <view wx:elif="{{stateName === 'previewing'}}" class="brs-list">
      <view wx:for="{{items}}" wx:key="matchId" class="brs-card" bindtap="onEditRow" data-matchid="{{item.matchId}}">
        <view class="brs-card-head">
          <text>{{item.tournamentName}} · {{item.round}}-{{item.position}} · {{item.scheduledStartLabel}}</text>
        </view>
        <view class="brs-card-body">
          <text class="brs-player">{{item.p1.name}}{{item.p1.partnerName ? ' / ' + item.p1.partnerName : ''}}</text>
          <text class="brs-score">{{item.score.sets[0].a}} : {{item.score.sets[0].b}}</text>
          <text class="brs-player">{{item.p2.name}}{{item.p2.partnerName ? ' / ' + item.p2.partnerName : ''}}</text>
        </view>
      </view>
    </view>

    <view wx:elif="{{stateName === 'submitting'}}" class="brs-list brs-list--dim">
      <view class="brs-overlay">
        <view class="brs-spinner"></view>
      </view>
    </view>

    <view wx:elif="{{stateName === 'result'}}" class="brs-list">
      <view wx:for="{{items}}" wx:key="matchId" class="brs-card {{result.successIds.indexOf(item.matchId) >= 0 ? 'brs-card--ok' : 'brs-card--err'}}">
        <view class="brs-card-head">
          <text>{{item.tournamentName}} · {{item.round}}-{{item.position}}</text>
          <status-tag wx:if="{{result.successIds.indexOf(item.matchId) >= 0}}" type="ok" text="✓ 已确认" />
        </view>
        <view class="brs-card-body">
          <text class="brs-player">{{item.p1.name}}</text>
          <text class="brs-score">{{item.score.sets[0].a}} : {{item.score.sets[0].b}}</text>
          <text class="brs-player">{{item.p2.name}}</text>
        </view>
      </view>
    </view>

    <view class="brs-footer">
      <view wx:if="{{stateName === 'previewing'}}" class="brs-actions">
        <view class="brs-btn brs-btn--sec" bindtap="onClose">取消</view>
        <view class="brs-btn brs-btn--prim" bindtap="onCommit">
          {{mode === 'submit' ? '提交' : '确认'}} {{items.length}} 场
        </view>
      </view>
      <view wx:elif="{{stateName === 'result'}}" class="brs-actions">
        <view class="brs-btn brs-btn--sec" bindtap="onClose">完成</view>
        <view wx:if="{{result.failures.length > 0}}" class="brs-btn brs-btn--prim" bindtap="onRetry">
          重试失败 {{result.failures.length}} 条
        </view>
      </view>
    </view>
  </view>
</view>
```

`miniprogram/components/batch-result-sheet/index.wxss`:
```css
.brs-mask { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.4); z-index: 999; display: flex; align-items: flex-end; }
.brs-sheet { width: 100%; background: var(--color-bg); border-radius: 32rpx 32rpx 0 0; padding: 24rpx; max-height: 80vh; overflow-y: auto; }
.brs-grab { width: 72rpx; height: 8rpx; background: var(--color-bg-3); border-radius: 4rpx; margin: 0 auto 16rpx; }
.brs-title { font-size: 28rpx; font-weight: 600; color: var(--color-ink); margin-bottom: 16rpx; display: flex; justify-content: space-between; align-items: center; }
.brs-title-meta { font-size: 22rpx; color: var(--color-muted); }
.brs-loading .brs-skel { height: 80rpx; background: var(--color-bg-3); border-radius: var(--radius-sm); margin-bottom: 12rpx; }
.brs-list { display: flex; flex-direction: column; gap: 12rpx; position: relative; }
.brs-list--dim { opacity: 0.6; }
.brs-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.brs-spinner { width: 64rpx; height: 64rpx; border: 4rpx solid var(--color-border); border-top-color: var(--color-lime); border-radius: 50%; animation: brs-spin 0.8s linear infinite; }
@keyframes brs-spin { to { transform: rotate(360deg); } }
.brs-card { background: var(--color-bg-2); border-radius: var(--radius-md); padding: 16rpx 20rpx; }
.brs-card--ok { background: rgba(132, 204, 22, 0.10); }
.brs-card--err { background: rgba(220, 38, 38, 0.10); }
.brs-card-head { font-size: 22rpx; color: var(--color-muted); margin-bottom: 8rpx; display: flex; justify-content: space-between; }
.brs-card-body { display: flex; align-items: center; justify-content: space-between; }
.brs-player { font-size: 24rpx; color: var(--color-ink); max-width: 38%; }
.brs-score { font-size: 32rpx; font-weight: 700; color: var(--color-ink); }
.brs-footer { padding-top: 16rpx; border-top: 1rpx solid var(--color-border); margin-top: 16rpx; }
.brs-actions { display: flex; gap: 12rpx; }
.brs-btn { flex: 1; text-align: center; padding: 20rpx; border-radius: var(--radius-md); font-size: 26rpx; font-weight: 600; }
.brs-btn--prim { background: var(--color-lime); color: var(--color-ink); }
.brs-btn--sec { background: var(--color-bg-3); color: var(--color-muted); }
```

- [ ] **Step 4：跑测试**

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npx jest components/batch-result-sheet/__tests__/index.test.js
```
Expected：10 passed。

- [ ] **Step 5：commit**

```bash
git add miniprogram/components/batch-result-sheet
git commit -m "feat(miniprogram): batch-result-sheet 4-state component for v2.1"
```

---

## Phase 4 · 三页重构（Tasks 21–27）

### Task 21: `tournament-manage` 接入 snapshot + 重构 IA（hero + 3 块）

**Files:**
- Modify: `miniprogram/pages/tournament-manage/index.{js,wxml,wxss,json}`
- Modify: `miniprogram/app.json`（如需注册新组件路径）

- [ ] **Step 1：注册组件依赖到 `tournament-manage/index.json`**

读取现有 json，在 `usingComponents` 加：
```json
{
  "usingComponents": {
    "status-tag": "/components/status-tag/index",
    "empty-state": "/components/empty-state/index",
    "batch-result-sheet": "/components/batch-result-sheet/index",
    "skeleton-loader": "/components/skeleton-loader/index"
  }
}
```

- [ ] **Step 2：完全重写 `index.js`（保留原文件作 backup 注释）**

`miniprogram/pages/tournament-manage/index.js`:
```js
const { call } = require('../../utils/cloud')

Page({
  data: {
    loadState: 'idle',   // idle | loading | loaded | refreshing | error
    error: null,
    snapshot: null,
    finishedExpanded: false,
    finishedState: 'idle',
    finishedError: null,
    finishedItems: [],
    sheet: {
      visible: false,
      title: '',
      mode: 'confirm',
      items: [],
      result: null,
      requestId: null,
      loading: false,
      tournamentIdScope: null,
    },
    _refreshTimer: null,
  },

  onShow() {
    this._refreshSnapshotDebounced()
  },

  _refreshSnapshotDebounced() {
    if (this.data._refreshTimer) clearTimeout(this.data._refreshTimer)
    const timer = setTimeout(() => this._loadSnapshot('refreshing'), 300)
    this.setData({ _refreshTimer: timer })
  },

  async _loadSnapshot(mode = 'loading') {
    this.setData({ loadState: mode, error: null })
    const res = await call('tournaments', { action: 'adminConsoleSnapshot', payload: {} })
    if (!res.ok) {
      this.setData({ loadState: 'error', error: res.error || { code: 'UNKNOWN', message: '加载失败' } })
      return
    }
    this.setData({ loadState: 'loaded', snapshot: res.data })
  },

  onRetry() { this._loadSnapshot('loading') },

  onCreateTournament() {
    wx.navigateTo({ url: '/pages/tournament-edit/index' })
  },

  async _openSheetForTournament(tournamentId) {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    this.setData({
      sheet: {
        ...this.data.sheet, visible: true, title: '待确认比分', mode: 'confirm',
        items: [], result: null, requestId, loading: true, tournamentIdScope: tournamentId,
      },
    })
    const res = await call('match-results', { action: 'pendingReviewItems', payload: { tournamentId, limit: 50 } })
    if (!res.ok) {
      this.setData({ 'sheet.loading': false, 'sheet.items': [] })
      wx.showModal({ title: '加载失败', content: res.error.message || '', showCancel: false })
      this.onSheetClose()
      return
    }
    this.setData({ 'sheet.loading': false, 'sheet.items': res.data.items })
  },

  onHeroCta() {
    this._openSheetForTournament(null)
  },

  onPendingRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    this._openSheetForTournament(tid)
  },

  onDraftRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${tid}` })
  },

  onOngoingRow(e) {
    const tid = e.currentTarget.dataset.tournamentid
    wx.navigateTo({ url: `/pages/tournament-detail/index?id=${tid}` })
  },

  async onSheetCommit(e) {
    const { matchIds } = e.detail
    const items = this.data.sheet.items.filter(it => matchIds.includes(it.matchId))
    const matches = items.map(it => ({ matchId: it.matchId, expectedUpdateTime: it.updateTime }))
    const res = await call('match-results', {
      action: 'batchConfirm',
      payload: { matches, requestId: this.data.sheet.requestId },
    })
    if (!res.ok) {
      // batch-level failure (BATCH_TIMEOUT / NETWORK)
      this.setData({
        'sheet.result': {
          requestId: this.data.sheet.requestId,
          successIds: [],
          failures: matchIds.map(mid => ({
            matchId: mid, code: res.error.code, message: res.error.message,
            retryable: !!res.error.retryable, requestId: this.data.sheet.requestId,
          })),
        },
      })
      return
    }
    this.setData({ 'sheet.result': res.data })
  },

  async onSheetRetry(e) {
    const { failureIds } = e.detail
    const lastFailures = (this.data.sheet.result && this.data.sheet.result.failures) || []
    const isBatchLevelFailure = lastFailures.every(f => ['BATCH_TIMEOUT', 'NETWORK', 'TIMEOUT'].includes(f.code))

    if (isBatchLevelFailure) {
      // §4.13 路径 2：不重拉，复用 requestId 重发原 matches 全集
      const items = this.data.sheet.items
      const matches = items.map(it => ({ matchId: it.matchId, expectedUpdateTime: it.updateTime }))
      const res = await call('match-results', {
        action: 'batchConfirm',
        payload: { matches, requestId: this.data.sheet.requestId },
      })
      if (!res.ok) {
        this.setData({ 'sheet.result': { ...this.data.sheet.result, failures: items.map(it => ({
          matchId: it.matchId, code: res.error.code, message: res.error.message,
          retryable: !!res.error.retryable, requestId: this.data.sheet.requestId,
        })) } })
        return
      }
      this.setData({ 'sheet.result': res.data })
      return
    }

    // §4.13 路径 1：result(partial) per-row retry — 必须重拉 review item
    const refetch = await call('match-results', { action: 'pendingReviewItems', payload: { tournamentId: this.data.sheet.tournamentIdScope, limit: 50 } })
    if (!refetch.ok) {
      wx.showModal({ title: '重拉失败', content: refetch.error.message || '', showCancel: false })
      return
    }
    const fresh = refetch.data.items
    const refreshedItems = this.data.sheet.items.map(it => {
      const f = fresh.find(x => x.matchId === it.matchId)
      return f || it
    })
    this.setData({ 'sheet.items': refreshedItems })
    const matches = refreshedItems.filter(it => failureIds.includes(it.matchId)).map(it => ({ matchId: it.matchId, expectedUpdateTime: it.updateTime }))
    const res = await call('match-results', {
      action: 'batchConfirm',
      payload: { matches, requestId: this.data.sheet.requestId },
    })
    if (!res.ok) {
      this.setData({ 'sheet.result': { ...this.data.sheet.result, failures: matches.map(m => ({
        matchId: m.matchId, code: res.error.code, message: res.error.message,
        retryable: !!res.error.retryable, requestId: this.data.sheet.requestId,
      })) } })
      return
    }
    const mergedSuccessIds = [...new Set([...(this.data.sheet.result.successIds || []), ...res.data.successIds])]
    this.setData({ 'sheet.result': { ...res.data, successIds: mergedSuccessIds } })
  },

  onSheetEditRow(e) {
    const { matchId } = e.detail
    const item = this.data.sheet.items.find(it => it.matchId === matchId)
    if (!item) return
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${item.tournamentId}&matchId=${matchId}` })
  },

  onSheetClose() {
    this.setData({ 'sheet.visible': false })
    this._refreshSnapshotDebounced()
  },

  async onToggleFinished() {
    const next = !this.data.finishedExpanded
    this.setData({ finishedExpanded: next })
    if (next && this.data.finishedState !== 'loaded') {
      this._loadFinished()
    }
  },

  async _loadFinished() {
    this.setData({ finishedState: 'loading', finishedError: null })
    const res = await call('tournaments', { action: 'finishedRecent', payload: { limit: 5 } })
    if (!res.ok) {
      this.setData({ finishedState: 'error', finishedError: res.error })
      return
    }
    this.setData({ finishedState: 'loaded', finishedItems: res.data.items })
  },

  onRetryFinished() { this._loadFinished() },
})
```

- [ ] **Step 3：写 `index.wxml`**

```xml
<view class="page">
  <view class="nav-bar">
    <text class="nav-title">工作台</text>
    <view class="nav-cta" bindtap="onCreateTournament">+ 创建</view>
  </view>

  <skeleton-loader wx:if="{{loadState === 'loading'}}" rows="6" />

  <view wx:elif="{{loadState === 'error'}}" class="page-error">
    <empty-state icon="warn" title="加载失败" subtitle="{{error.message || ''}}" action="重新加载" bindaction="onRetry" />
  </view>

  <block wx:elif="{{loadState === 'loaded' || loadState === 'refreshing'}}">
    <view wx:if="{{snapshot.pendingConfirm.total === 0 && snapshot.myDrafts.length === 0 && snapshot.ongoing.length === 0}}" class="page-empty">
      <empty-state icon="check" title="没有任务" subtitle="新建赛事或等待会员提交比分" action="+ 创建赛事" bindaction="onCreateTournament" />
    </view>

    <block wx:else>
      <view class="hero">
        <text class="hero-eyebrow">今日待办</text>
        <text class="hero-big">{{snapshot.pendingConfirm.total}} 场待确认 · {{snapshot.myDrafts.length}} 个草稿</text>
        <view wx:if="{{snapshot.pendingConfirm.total > 0}}" class="hero-cta" bindtap="onHeroCta">→ 审核并确认 {{snapshot.pendingConfirm.total}} 场</view>
        <view wx:elif="{{snapshot.myDrafts.length > 0}}" class="hero-cta" bindtap="onCreateTournament">→ 继续编辑</view>
        <view wx:else class="hero-cta" bindtap="onCreateTournament">+ 创建赛事</view>
      </view>

      <view wx:if="{{snapshot.pendingConfirm.total > 0}}" class="block">
        <view class="block-title">
          <text>待确认比分</text>
          <status-tag type="warn-solid" text="{{snapshot.pendingConfirm.total}}" />
        </view>
        <view class="row" wx:for="{{snapshot.pendingConfirm.byTournament}}" wx:key="tournamentId" data-tournamentid="{{item.tournamentId}}" bindtap="onPendingRow">
          <view class="row-l">
            <text class="row-t">{{item.tournamentName}}</text>
            <text class="row-s">{{item.count}} 场提交中</text>
          </view>
          <status-tag type="warn-solid" text="{{item.count}}" />
        </view>
      </view>

      <view wx:if="{{snapshot.myDrafts.length > 0}}" class="block">
        <view class="block-title"><text>我的草稿</text></view>
        <view class="row" wx:for="{{snapshot.myDrafts}}" wx:key="tournamentId" data-tournamentid="{{item.tournamentId}}" bindtap="onDraftRow">
          <view class="row-l">
            <text class="row-t">{{item.name}}</text>
            <text class="row-s">{{item.playerCount}} 球员 · {{item.scheduleReady ? '已排程' : '未排程'}}</text>
          </view>
          <status-tag type="muted" text="draft" />
        </view>
      </view>

      <view wx:if="{{snapshot.ongoing.length > 0}}" class="block">
        <view class="block-title"><text>进行中赛事</text></view>
        <view class="row" wx:for="{{snapshot.ongoing}}" wx:key="tournamentId" data-tournamentid="{{item.tournamentId}}" bindtap="onOngoingRow">
          <view class="row-l">
            <text class="row-t">{{item.name}}</text>
            <text class="row-s">{{item.round}} · {{item.remainingMatches}} 场剩余</text>
          </view>
          <status-tag type="muted" text="查看" />
        </view>
      </view>

      <view class="block block--collapsible">
        <view class="block-title" bindtap="onToggleFinished">
          <text>已结束</text>
          <text class="block-toggle">{{finishedExpanded ? '收起' : '展开'}}</text>
        </view>
        <block wx:if="{{finishedExpanded}}">
          <skeleton-loader wx:if="{{finishedState === 'loading'}}" rows="3" />
          <view wx:elif="{{finishedState === 'error'}}" class="finished-error">
            <text>已结束 · 暂时无法加载</text>
            <view class="finished-retry" bindtap="onRetryFinished">重试</view>
          </view>
          <view wx:elif="{{finishedState === 'loaded'}}">
            <view class="row" wx:for="{{finishedItems}}" wx:key="tournamentId">
              <view class="row-l">
                <text class="row-t">{{item.name}}</text>
                <text class="row-s">{{item.winnerLabel}}</text>
              </view>
            </view>
          </view>
        </block>
      </view>
    </block>
  </block>

  <batch-result-sheet
    visible="{{sheet.visible}}"
    title="{{sheet.title}}"
    mode="{{sheet.mode}}"
    items="{{sheet.items}}"
    result="{{sheet.result}}"
    bindcommit="onSheetCommit"
    bindretry="onSheetRetry"
    bindeditrow="onSheetEditRow"
    bindclose="onSheetClose"
  />
</view>
```

- [ ] **Step 4：写 `index.wxss`（全部用 token，0 硬编码）**

```css
.page { padding: 24rpx; background: var(--color-bg); min-height: 100vh; }
.nav-bar { display: flex; justify-content: space-between; align-items: center; padding-bottom: 24rpx; border-bottom: 1rpx solid var(--color-border); margin-bottom: 24rpx; }
.nav-title { font-size: 32rpx; font-weight: 700; color: var(--color-ink); }
.nav-cta { font-size: 26rpx; color: var(--color-lime); font-weight: 600; }

.hero { background: var(--color-ink); color: #FFF; border-radius: var(--radius-lg); padding: 32rpx; margin-bottom: 24rpx; }
.hero-eyebrow { font-size: 22rpx; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
.hero-big { display: block; font-size: 36rpx; font-weight: 800; margin: 12rpx 0; }
.hero-cta { display: inline-block; background: var(--color-lime); color: var(--color-ink); font-size: 26rpx; font-weight: 700; padding: 16rpx 32rpx; border-radius: var(--radius-sm); margin-top: 16rpx; }

.block { background: var(--color-bg-2); border-radius: var(--radius-md); padding: 24rpx; margin-bottom: 16rpx; }
.block--collapsible { background: var(--color-bg); border: 1rpx dashed var(--color-border); }
.block-title { font-size: 26rpx; font-weight: 600; color: var(--color-ink); margin-bottom: 12rpx; display: flex; justify-content: space-between; align-items: center; }
.block-toggle { font-size: 22rpx; color: var(--color-muted); font-weight: 400; }
.row { display: flex; justify-content: space-between; align-items: center; padding: 16rpx 0; border-top: 1rpx dashed var(--color-border); }
.row:first-child { border-top: 0; }
.row-l { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.row-t { font-size: 26rpx; color: var(--color-ink); font-weight: 500; }
.row-s { font-size: 22rpx; color: var(--color-muted); margin-top: 4rpx; }
.finished-error { display: flex; justify-content: space-between; align-items: center; padding: 16rpx 0; font-size: 24rpx; color: var(--color-muted); }
.finished-retry { color: var(--color-lime); font-weight: 600; }

.page-empty, .page-error { padding-top: 80rpx; }
```

- [ ] **Step 5：在微信开发者工具手动编译；运行 grep 视觉验收**

```bash
grep -E '#333|#999|#667eea|#f5f5f5|linear-gradient\(135deg' miniprogram/pages/tournament-manage/index.wxss
```
Expected：no output（0 命中）

```bash
grep -E 'wx\.showLoading|加载失败' miniprogram/pages/tournament-manage/index.js
```
Expected：no output

- [ ] **Step 6：commit**

```bash
git add miniprogram/pages/tournament-manage
git commit -m "feat(tournament-manage): IA rebuild with workstation hero + 4 blocks + sheet"
```

---

### Task 22: `my-match` 接入 `mySummary` + 重构 IA

**Files:**
- Modify: `miniprogram/pages/my-match/index.{js,wxml,wxss,json}`

- [ ] **Step 1：注册组件依赖**

`index.json`:
```json
{
  "usingComponents": {
    "status-tag": "/components/status-tag/index",
    "empty-state": "/components/empty-state/index",
    "skeleton-loader": "/components/skeleton-loader/index"
  }
}
```

- [ ] **Step 2：重写 `index.js`**

```js
const { call } = require('../../utils/cloud')

Page({
  data: {
    loadState: 'idle',
    error: null,
    summary: null,
  },

  onShow() { this._load() },

  async _load() {
    this.setData({ loadState: 'loading', error: null })
    const res = await call('match-results', { action: 'mySummary', payload: { historyLimit: 10 } })
    if (!res.ok) {
      this.setData({ loadState: 'error', error: res.error })
      return
    }
    this.setData({ loadState: 'loaded', summary: res.data })
  },

  onRetry() { this._load() },

  onRecordNow() {
    const first = (this.data.summary.pending || [])[0]
    if (!first) return
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${first.tournamentId}&matchId=${first.matchId}` })
  },

  onPendingRow(e) {
    const { tournamentid, matchid } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${tournamentid}&matchId=${matchid}` })
  },

  onSubmittedRow(e) {
    const { tournamentid, matchid } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${tournamentid}&matchId=${matchid}` })
  },

  onViewSchedule() {
    wx.switchTab({ url: '/pages/match/index' })
  },
})
```

- [ ] **Step 3：写 `index.wxml`**

```xml
<view class="page">
  <view class="nav-bar"><text class="nav-back">‹ </text><text class="nav-title">我的比赛</text></view>

  <skeleton-loader wx:if="{{loadState === 'loading'}}" rows="6" />

  <view wx:elif="{{loadState === 'error'}}" class="page-error">
    <empty-state icon="warn" title="加载失败" subtitle="{{error.message || ''}}" action="重新加载" bindaction="onRetry" />
  </view>

  <block wx:elif="{{loadState === 'loaded'}}">
    <view wx:if="{{summary.pending.length === 0 && summary.submitted.length === 0 && summary.confirmed.length === 0}}" class="page-empty">
      <empty-state icon="sprout" title="本周没有比赛" subtitle="加入下一场赛事或查看历史" action="查看赛程" bindaction="onViewSchedule" />
    </view>

    <block wx:else>
      <view class="hero">
        <text class="hero-eyebrow">本周</text>
        <text class="hero-big">
          {{summary.pending.length > 0 ? ('你有 ' + summary.pending.length + ' 场待录分') : (summary.submitted.length > 0 ? (summary.submitted.length + ' 场等管理员确认') : '本周没有比赛')}}
        </text>
        <view wx:if="{{summary.pending.length > 0}}" class="hero-cta" bindtap="onRecordNow">→ 现在录</view>
        <view wx:else class="hero-cta" bindtap="onViewSchedule">查看赛程</view>
      </view>

      <view wx:if="{{summary.pending.length > 0}}" class="block">
        <view class="block-title"><text>待录分</text><status-tag type="amber" text="{{summary.pending.length}}" /></view>
        <view class="row" wx:for="{{summary.pending}}" wx:key="matchId" data-matchid="{{item.matchId}}" data-tournamentid="{{item.tournamentId}}" bindtap="onPendingRow">
          <view class="row-l">
            <text class="row-t">{{item.tournamentName}} {{item.round}}-{{item.position}}</text>
            <text class="row-s">{{item.courtName}} · vs {{item.p2.name}}</text>
          </view>
          <status-tag type="amber" text="录分" />
        </view>
      </view>

      <view wx:if="{{summary.submitted.length > 0}}" class="block">
        <view class="block-title"><text>确认中</text><status-tag type="amber" text="{{summary.submitted.length}}" /></view>
        <view class="row" wx:for="{{summary.submitted}}" wx:key="matchId" data-matchid="{{item.matchId}}" data-tournamentid="{{item.tournamentId}}" bindtap="onSubmittedRow">
          <view class="row-l">
            <text class="row-t">{{item.tournamentName}} {{item.round}} · {{item.score.sets[0].a}}:{{item.score.sets[0].b}}</text>
            <text class="row-s">等管理员确认 · vs {{item.opponentLabel}}</text>
          </view>
          <status-tag type="amber" text="确认中" />
        </view>
      </view>

      <view wx:if="{{summary.confirmed.length > 0}}" class="block">
        <view class="block-title"><text>已确认</text><text class="block-meta">最近 10 场</text></view>
        <view class="row" wx:for="{{summary.confirmed}}" wx:key="matchId">
          <view class="row-l">
            <text class="row-t">{{item.tournamentName}} {{item.round}} · {{item.score.sets[0].a}}:{{item.score.sets[0].b}} {{item.isWinner ? '胜' : '负'}}</text>
            <text class="row-s">+{{item.pointsEarned}} 积分</text>
          </view>
          <status-tag type="ok" text="已确认" />
        </view>
      </view>
    </block>
  </block>
</view>
```

- [ ] **Step 4：写 `index.wxss`（复用 tournament-manage 同款 token）**

```css
.page { padding: 24rpx; background: var(--color-bg); min-height: 100vh; }
.nav-bar { display: flex; align-items: center; padding-bottom: 24rpx; border-bottom: 1rpx solid var(--color-border); margin-bottom: 24rpx; }
.nav-back { font-size: 28rpx; color: var(--color-muted); margin-right: 8rpx; }
.nav-title { font-size: 32rpx; font-weight: 700; color: var(--color-ink); }

.hero { background: var(--color-ink); color: #FFF; border-radius: var(--radius-lg); padding: 32rpx; margin-bottom: 24rpx; }
.hero-eyebrow { font-size: 22rpx; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.04em; }
.hero-big { display: block; font-size: 36rpx; font-weight: 800; margin: 12rpx 0; }
.hero-cta { display: inline-block; background: var(--color-lime); color: var(--color-ink); font-size: 26rpx; font-weight: 700; padding: 16rpx 32rpx; border-radius: var(--radius-sm); margin-top: 16rpx; }

.block { background: var(--color-bg-2); border-radius: var(--radius-md); padding: 24rpx; margin-bottom: 16rpx; }
.block-title { font-size: 26rpx; font-weight: 600; color: var(--color-ink); margin-bottom: 12rpx; display: flex; justify-content: space-between; align-items: center; }
.block-meta { font-size: 22rpx; color: var(--color-muted); font-weight: 400; }
.row { display: flex; justify-content: space-between; align-items: center; padding: 16rpx 0; border-top: 1rpx dashed var(--color-border); }
.row:first-child { border-top: 0; }
.row-l { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.row-t { font-size: 26rpx; color: var(--color-ink); font-weight: 500; }
.row-s { font-size: 22rpx; color: var(--color-muted); margin-top: 4rpx; }

.page-empty, .page-error { padding-top: 80rpx; }
```

- [ ] **Step 5：grep + commit**

```bash
grep -E '#333|#999|#667eea|#f5f5f5|linear-gradient\(135deg|\.tag-(confirmed|pending|warn|ok)' miniprogram/pages/my-match/index.wxss
```
Expected：no output

```bash
git add miniprogram/pages/my-match
git commit -m "feat(my-match): IA rebuild — 3 blocks pending/submitted/confirmed via mySummary"
```

---

### Task 23: `tournament-score` 接入 sheet + 改 sticky CTA + 兼容旧入口

**Files:**
- Modify: `miniprogram/pages/tournament-score/index.{js,wxml,wxss,json}`

- [ ] **Step 1：在 `index.json` 注册 sheet 与 status-tag**

```json
{
  "usingComponents": {
    "score-row": "/components/score-row/index",
    "skeleton-loader": "/components/skeleton-loader/index",
    "status-tag": "/components/status-tag/index",
    "empty-state": "/components/empty-state/index",
    "batch-result-sheet": "/components/batch-result-sheet/index"
  }
}
```

- [ ] **Step 2：在 `index.js` 顶部 require call wrapper（不动现有逻辑，仅追加 sticky + sheet 路径）**

```js
const { call } = require('../../utils/cloud')
// ... 现有 Phase 8 实现保留
```

在 Page 的 `data` 中加：
```js
sheet: { visible: false, title: '', mode: 'confirm', items: [], result: null, requestId: null },
```

在 methods 区追加（紧接现有 onConfirmAll 之后）：

```js
async onAdminBatchSheet() {
  // admin 一键确认走 sheet（不再串行调用 submit/reconfirm）
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  this.setData({
    sheet: { visible: true, title: '待确认比分', mode: 'confirm', items: [], result: null, requestId },
  })
  const res = await call('match-results', { action: 'pendingReviewItems', payload: { tournamentId: this.data.tournamentId, limit: 50 } })
  if (!res.ok) {
    this.setData({ 'sheet.visible': false })
    wx.showModal({ title: '加载失败', content: res.error.message || '', showCancel: false })
    return
  }
  this.setData({ 'sheet.items': res.data.items })
},

async onMemberBatchSheet() {
  // 会员一键提交本人 dirty drafts（实装时需要从本地 drafts 构造 items）
  const drafts = (this.data.drafts || []).filter(d => d && d.dirty)
  if (drafts.length === 0) return
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const items = drafts.map(d => ({
    matchId: d.matchId, tournamentId: this.data.tournamentId, tournamentName: this.data.tournamentName || '',
    round: d.round, position: d.position, scheduledStartLabel: d.scheduledStartLabel || '',
    courtName: d.courtName || '', p1: d.p1, p2: d.p2, score: d.score, isDoubles: !!d.isDoubles,
    updateTime: d.updateTime,
  }))
  this.setData({
    sheet: { visible: true, title: '提交比分', mode: 'submit', items, result: null, requestId },
  })
},

async onSheetCommit(e) {
  const { matchIds } = e.detail
  const items = this.data.sheet.items.filter(it => matchIds.includes(it.matchId))
  if (this.data.sheet.mode === 'confirm') {
    const matches = items.map(it => ({ matchId: it.matchId, expectedUpdateTime: it.updateTime }))
    const res = await call('match-results', { action: 'batchConfirm', payload: { matches, requestId: this.data.sheet.requestId } })
    this._applySheetResult(res, items)
  } else {
    const submissions = items.map(it => ({ matchId: it.matchId, score: it.score }))
    const res = await call('match-results', { action: 'batchSubmit', payload: { submissions, requestId: this.data.sheet.requestId } })
    this._applySheetResult(res, items)
  }
},

_applySheetResult(res, items) {
  if (!res.ok) {
    this.setData({
      'sheet.result': {
        requestId: this.data.sheet.requestId,
        successIds: [],
        failures: items.map(it => ({ matchId: it.matchId, code: res.error.code, message: res.error.message, retryable: !!res.error.retryable, requestId: this.data.sheet.requestId })),
      },
    })
    return
  }
  this.setData({ 'sheet.result': res.data })
},

async onSheetRetry(e) {
  // 同 tournament-manage 的 retry 双路径逻辑
  const { failureIds } = e.detail
  const lastFailures = (this.data.sheet.result && this.data.sheet.result.failures) || []
  const isBatchLevel = lastFailures.every(f => ['BATCH_TIMEOUT', 'NETWORK', 'TIMEOUT'].includes(f.code))
  // ... 复用 tournament-manage 同款实现（为简洁，参考 Task 21 onSheetRetry）
  // 此处保留 stub，实施时复制 Task 21 onSheetRetry 主体并替换 sheet.tournamentIdScope 为 this.data.tournamentId
},

onSheetClose() {
  this.setData({ 'sheet.visible': false })
  // tournament-score 刷新现有的 matches 列表（复用 Phase 8 的 reload 函数）
  if (typeof this._reloadMatches === 'function') this._reloadMatches()
},

onSheetEditRow() {/* tournament-score 内点击逐条改 = 关 sheet，scroll 到该行 */
  this.setData({ 'sheet.visible': false })
},
```

- [ ] **Step 3：在 `index.wxml` sticky 底部替换原「✓ 确认全部待确认」按钮**

把原有 sticky 区域改为：
```xml
<view class="sticky" wx:if="{{isAdmin && submittedCount > 0}}">
  <view class="btn-prim" bindtap="onAdminBatchSheet">→ 审核并确认 {{submittedCount}} 场</view>
</view>
<view class="sticky" wx:elif="{{!isAdmin && dirtyDraftCount > 0}}">
  <view class="btn-prim" bindtap="onMemberBatchSheet">→ 提交比分 {{dirtyDraftCount}} 场</view>
</view>

<batch-result-sheet
  visible="{{sheet.visible}}"
  title="{{sheet.title}}"
  mode="{{sheet.mode}}"
  items="{{sheet.items}}"
  result="{{sheet.result}}"
  bindcommit="onSheetCommit"
  bindretry="onSheetRetry"
  bindeditrow="onSheetEditRow"
  bindclose="onSheetClose"
/>
```

- [ ] **Step 4：在 `index.js` 内补 `submittedCount` 与 `dirtyDraftCount` 计算属性（observers 或 onLoad 时计算）**

在 page data 加：`submittedCount: 0, dirtyDraftCount: 0`

在 `_reloadMatches` 函数末尾计算：
```js
const submittedCount = this.data.matches.filter(m => m.resultStatus === 'submitted').length
const dirtyDraftCount = (this.data.drafts || []).filter(d => d.dirty).length
this.setData({ submittedCount, dirtyDraftCount })
```

- [ ] **Step 5：grep + commit**

```bash
grep -E '#333|#999|#667eea|#f5f5f5|linear-gradient\(135deg' miniprogram/pages/tournament-score/index.wxss
```
Expected：no output（如有，直接 token 替换）

```bash
git add miniprogram/pages/tournament-score
git commit -m "feat(tournament-score): sticky CTA + batch sheet for admin confirm & member submit"
```

---

### Task 24: `score-row` 视觉债清理（硬编码 → token，时段标 → status-tag）

**Files:**
- Modify: `miniprogram/components/score-row/index.wxss`
- Modify: `miniprogram/components/score-row/index.wxml`
- Modify: `miniprogram/components/score-row/index.json`

- [ ] **Step 1：`index.json` 注册 status-tag**

```json
{ "component": true, "usingComponents": { "status-tag": "/components/status-tag/index" } }
```

- [ ] **Step 2：在 `index.wxss` 内做 token 替换**

执行如下替换（grep 出所有硬编码并改）：

```bash
sed -i.bak \
  -e 's/#333\b/var(--color-ink)/g' \
  -e 's/#999\b/var(--color-muted)/g' \
  -e 's/#f5f5f5\b/var(--color-bg-2)/g' \
  -e 's/#4F46E5\b/var(--color-lime)/g' \
  miniprogram/components/score-row/index.wxss
```

然后用 grep 复查残留：
```bash
grep -E '#[0-9a-fA-F]{3,8}' miniprogram/components/score-row/index.wxss
```
Expected：no output（如有零散硬编码，逐个换 token；保留 `#FFF/#FFFFFF` 等白色或确认在 token 里）。

- [ ] **Step 3：把 WXS 拼接的"14:00 · 1号场"灰底改为 `<status-tag type="muted">`**

打开 `index.wxml`，搜索现有时段拼接（约形如 `<view class="row-time-court">{{formatTime(scheduledStart)}} · {{courtName}}</view>`），替换为：

```xml
<status-tag type="muted" text="{{scheduledTimeLabel}} · {{courtName}}" />
```

在 `index.js` Component data observers 中确保 `scheduledTimeLabel` 是 propagated string（用现有 WXS / setData 已有的 formatTime）。

- [ ] **Step 4：删除 `.tag-confirmed / .tag-pending` 等自定义 CSS 类**

```bash
grep -n '\.tag-' miniprogram/components/score-row/index.wxss
```
逐行 review，凡是 .tag-confirmed / .tag-pending / .tag-warn 等专为状态做的样式，从 wxml 改为 `<status-tag type="ok|warn-solid|amber">`，wxss 行删除。

- [ ] **Step 5：在微信开发者工具编译；不动 js（无功能行为变化）**

```bash
node -c miniprogram/components/score-row/index.js
```
Expected：OK（应该 js 几乎不动；仅 props/observer 加 scheduledTimeLabel 这一类小变更）。

- [ ] **Step 6：grep 视觉验收**

```bash
grep -E '#333|#999|#667eea|#f5f5f5|linear-gradient\(135deg' miniprogram/components/score-row
grep -E '\.tag-(confirmed|pending|warn|ok)' miniprogram/components/score-row
```
Expected：双 0 命中

- [ ] **Step 7：commit**

```bash
git add miniprogram/components/score-row
git commit -m "refactor(score-row): visual debt cleanup — tokens + status-tag (no logic change)"
```

---

### Task 25: 三页接 mock / 联调（手动 smoke）

**Files:** N/A（手动验证）

- [ ] **Step 1：DevTools 打开项目，编译普通模式**

确认问题面板 0 个；Console 0 红错。

- [ ] **Step 2：admin 账号验证**
- 打开 `tournament-manage` → 见 hero「N 场待确认」+ 4 块
- 点 hero CTA → sheet 弹起 + skeleton → 加载完显示 review cards
- 点 "确认 N 场" → result(all-ok) → 3s 自动关 → 数字归 0

- [ ] **Step 3：会员账号验证**
- 打开 `my-match` → 见三区块 + hero
- 点条目 → 跳 tournament-score
- 在 score-row 编辑 → 点 sticky「→ 提交比分 N 场」→ sheet 弹起 → 提交 → 成功

- [ ] **Step 4：如果发现 bug，回到相关 Task 修；否则 commit 一个空提交记录**

```bash
git commit --allow-empty -m "chore(v2.1): manual smoke pass on three pages"
```

---

### Task 26: `tournament-score` 兼容旧入口 `?id=` 测试

**Files:** N/A（手动 + grep）

- [ ] **Step 1：grep 旧调用点**

```bash
grep -rn "tournament-score/index?id=\|tournament-score/index\?id=" miniprogram/
```

- [ ] **Step 2：手动验证**

DevTools 用 `tournament-score/index?id=<mr_xxx>` 这种旧链接打开，确认页面正常加载（Phase 8 已实装 `onLoad({ id?, tournamentId?, matchId? })` 多参数兼容，无需新代码）。

- [ ] **Step 3：commit empty marker（可选）**

```bash
git commit --allow-empty -m "chore(v2.1): legacy ?id= entry still works"
```

---

### Task 27: 微信开发者工具问题面板清零

**Files:** （视检查结果而定，多为 wxml lint 警告）

- [ ] **Step 1：在 DevTools 普通编译后查"问题"面板**

- [ ] **Step 2：把面板里所有 v2.1 三页 + 3 个新组件的警告（unused properties、缺 wx:key 等）一一修掉**

- [ ] **Step 3：Console 清空，操作三页确认 0 红错**

- [ ] **Step 4：commit（如有改动）**

```bash
git add miniprogram/
git commit -m "fix(v2.1): clear DevTools issues panel + console errors on three pages"
```

---

## Phase 5 · 验收（Tasks 28–31）

### Task 28: 单测全量回归

**Files:** N/A

- [ ] **Step 1：跑所有云函数单测**

```bash
cd cloudfunctions/_shared && npx jest && \
cd ../match-results && npx jest && \
cd ../tournaments && npx jest && \
cd ../tournament-brackets && npx jest && \
cd ../points-engine && npx jest && \
cd ../weekly-star && npx jest
```

Expected：
- _shared: 22 passed
- match-results: ≥ 74 passed
- tournaments: ≥ 30 passed
- tournament-brackets: 44 passed
- points-engine: 16 passed
- weekly-star: 4 passed

- [ ] **Step 2：跑前端单测**

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram && npx jest
```
Expected：cloud.test.js 8 passed + empty-state 4 passed + batch-result-sheet 10 passed = 22 passed

- [ ] **Step 3：跑同步 lib hash 校验**

```bash
bash /Users/liaoxiaole/FOPEN-PURE/scripts/sync-shared-libs.sh
```
Expected：全过

- [ ] **Step 4：commit 跑测结果记录（无代码变动）**

```bash
git commit --allow-empty -m "test(v2.1): full unit test suite green"
```

---

### Task 29: E2E 手动验证 10 条

**Files:** N/A（手动）

按 spec §6.2 E2E-1 ~ E2E-10 在 DevTools 逐条执行。每条通过后在 PROGRESS.md 或本 plan 顶部勾选。

- [ ] **Step 1：E2E-1 Admin batch happy**（详 spec §6.2 E2E-1）
- [ ] **Step 2：E2E-2 Admin batch partial-STALE**
- [ ] **Step 3：E2E-3 Admin batch network failure + retry**
- [ ] **Step 4：E2E-4 会员 batchSubmit happy**
- [ ] **Step 5：E2E-5 会员 batchSubmit FORBIDDEN**
- [ ] **Step 6：E2E-6 工作台 snapshot 完全失败 → retry**
- [ ] **Step 7：E2E-7 已结束块 lazy load 独立降级**
- [ ] **Step 8：E2E-8 视觉一致性 grep**
- [ ] **Step 9：E2E-9 旧入口兼容**
- [ ] **Step 10：E2E-10 状态语义勘对**

每条通过后：

```bash
git commit --allow-empty -m "test(v2.1): E2E-<N> passed"
```

或者一次性：

```bash
git commit --allow-empty -m "test(v2.1): all 10 E2E journeys passed (spec §6.2)"
```

---

### Task 30: 性能基线 + QA 截图

**Files:**
- Create: `docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design/qa-screenshots/`（目录 + 截图）

- [ ] **Step 1：埋点验证**

DevTools 打开 v2.1 三页，操作主要路径，Console 应看到 `[v2.1] adminConsoleSnapshot 850ms` 之类输出（前端简单 `console.info`）。

- [ ] **Step 2：性能基线手测**

按 spec §6.3 验证：
- `adminConsoleSnapshot(50 待确认)` ≤ 1.2s
- `pendingReviewItems(50)` ≤ 800ms
- `finishedRecent(5)` ≤ 500ms
- `mySummary(100 历史)` ≤ 800ms
- `batchConfirm(5)` ≤ 3s
- `batchSubmit(5)` ≤ 3s

如不达标，回到对应 handler 排查；通常瓶颈是 N+1 query。

- [ ] **Step 3：截图收集**

```bash
mkdir -p docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design/qa-screenshots
```

在 DevTools 截 spec §6.4 列出的 12 张图，保存到该目录（PNG，建议 750×1334 模拟 iPhone）。

- [ ] **Step 4：commit**

```bash
git add docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design/qa-screenshots
git commit -m "docs(qa): v2.1 acceptance screenshots — 12 states"
```

---

### Task 31: 部署云函数 + 更新 PROGRESS.md + 最终 commit

**Files:**
- Modify: `docs/superpowers/plans/PROGRESS.md`

- [ ] **Step 1：上传云函数（match-results / tournaments）**

在微信开发者工具 GUI 上传：
- `cloudfunctions/match-results`（含新 batch / query / my-summary handlers）
- `cloudfunctions/tournaments`（含 admin-console / finished-recent handlers）

若遇到 `EISDIR` 错误（Phase 8 同款问题），用临时 deploy bundle + `--paths` 命令上传：

```bash
# 参考 Phase 7/8 PROGRESS.md 中云函数上传备注
```

- [ ] **Step 2：更新 `PROGRESS.md`**

把以下行添加到 `## Phase 状态` 表格末尾（在 Phase 8 行下方）：

```markdown
| 09 | Phase 9 · v2.1 Quality Iteration | ✅ 已完成 | 2026-05-16 | YYYY-MM-DD | <commit_hash> | tournament-manage / my-match / tournament-score IA 重构；3 个新组件 (status-tag / empty-state / batch-result-sheet)；6 个新云函数 action (adminConsoleSnapshot / finishedRecent / batchConfirm / batchSubmit / pendingReviewItems / mySummary)；expectedUpdateTime 乐观锁 + _request_log 幂等；score-row 视觉债清理 |
```

将顶部 ASCII bar 与计数从 6/6 改为 7/7（或参照原格式调整）。

- [ ] **Step 3：最终 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(plans): Phase 9 · v2.1 quality iteration complete"
```

---

## Self-Review 清单（写完此 plan 后执行）

按 writing-plans skill 要求自检：

1. **Spec coverage**
   - §1 scope → Task 1（schema doc）+ Task 31（PROGRESS）
   - §2 IA → Tasks 21–23
   - §3 组件 → Tasks 18–20、Task 24
   - §4 后端契约（含 §4.13 两路径 retry）→ Tasks 3–14、Task 21/23 onSheetRetry
   - §5 数据流 → Tasks 16–17 cloud wrapper、Task 21 sheet sequence
   - §6 测试与验收 → Tasks 28–30
   - §7 切片建议 → 本 plan 5 sub-phase 对齐
   - §8 词汇 → 散布于各 Task 实施

2. **Placeholder scan**：grep 本 plan 文档查 `TBD / TODO / 占位 / 暂略`，应仅出现在 Task 2/9/11 中明确标注的"stub"或"占位 stub"（这是 TDD 流程明示的 RED 阶段产物，非未填项）。

3. **Type consistency**：
   - `expectedUpdateTime`（payload）/ `updateTime`（item / DB 字段）命名稳定
   - `requestId`（batch group id）始终由 parent 在开 sheet 时生成
   - sheet 4 状态 `closed / loading / previewing / submitting / result` 名字稳定
   - 错误码 `STALE_VERSION / FORBIDDEN / INVALID_PAYLOAD / BATCH_TIMEOUT / NETWORK / CLOUD_TIMEOUT / INVALID_SCORE / CANNOT_OVERWRITE_CONFIRMED` 与 spec §4.11 一致

---

## 备注

- 本 plan 全程不动 `state.js` / `score-rule.js` / `award.js` / `points-engine` / `weekly-star` 业务逻辑。
- 任何与 Phase 8 score state machine 行为不一致的 batch action 实装请回顾 spec §4.4 / §4.13 / 沟通日志 §Spec Review 修订 v2 / v3。
- 上线前确认沟通日志中所有"待 Codex 验收"事项均已确认。
- 部署完成后通知 Codex 做一次实际数据下的 review，把发现写回沟通日志「后续执行日志」节。
