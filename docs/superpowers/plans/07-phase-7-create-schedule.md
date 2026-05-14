# Phase 7 · 创建+排程（4 步 wizard + 首轮排程页）· Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重写赛事创建为 4 步 wizard（基本信息 → 球员+球场 → 排程 → 积分规则），把排程做成"按场地维度展示、可手动调整顺序"的核心页面，并把数据模型从 `courtTimeGrid` 切到 `schedulePlan` + `pointsRules`。

**Architecture:** 草稿即落库（`status='draft'`），每步切换都 update tournament。把签表生成 + BYE 推进 + 顺序填场地排程从 `scheduler-engine` 迁到 `tournament-brackets/lib/`（generator + scheduler + pairing）；旧 `scheduler-engine` 标 `@deprecated` 保留单测，等 Phase 8 完成后再删。新增 `free_plays` 集合与云函数。前端新建 `<schedule-board>` / `<player-picker-sheet>` 组件，重写 `<court-grid>`、`tournament-edit`、`tournament-brackets`。

**Tech Stack:** Node.js + Jest（lib 95% 覆盖率）+ 微信小程序原生组件 / WXS

**Spec 引用:** §3 创建流程 / §4 首轮排程页 / §7 路由、页面与入口（与 §6.4/§6.5 重叠的部分由 Phase 8 实现，本 Phase 不做录分/结算）

**前置条件:**
- Phase 1–4 完成（PROGRESS.md：4/6）
- 用户已在阻塞清单确认四点口径（spec §10 / PROGRESS.md 阻塞节）：
  - `score-entry` 不新建，复用 `tournament-score`（Phase 8 才动）
  - `schedulePlan` 不兼容 `courtTimeGrid`，走清库策略
  - `scheduler-engine` 不删，pairing 迁出，引擎标 `@deprecated`
  - `points-engine` 保留 `rankList / playerStats / recalculateMatch` 兼容 wrapper（Phase 8 改）

**推荐执行方式:** Subagent-driven。Task 4 / 5 / 6 / 8 算法独立，可并行派出 fresh subagent。Task 11+ 是前端组件，建议串行（schedule-board 复用 court-grid + player-picker-sheet）。

---

## 2026-05-14 Review 修订（执行前按此覆盖原文）

本节是对本 plan 的结构性修订。执行时以这里的口径为准；下方原 Task 中若有冲突，按本节修正后实施。

1. **统一云函数 response contract。** 新增/重写 actions 必须返回 `{ success: true, data: ... }` 或 `{ success: false, error: { code, message, errors? } }`。`tournaments.get/list` 等旧 actions 可以保留原返回，但 `tournament-edit` 新代码不得假设旧 action 已经返回 `{ data: { tournament } }`；要么在云函数加新 wrapper（推荐），要么在前端写兼容解包函数。
2. **draft 必须写 `createdBy`。** `tournaments.create({ status:'draft' })` 必须通过 `cloud.getWXContext().OPENID → members` 解析当前会员，并写入 `createdBy` / `createdByOpenid`。`tournaments.list` 必须支持 `status / statusNot / createdBy / ids` 过滤；否则 Task 16 的“仅创建者可见草稿”无法成立。
3. **补 `cloudfunctions/courts`。** spec §3.2 要展示俱乐部全部球场并支持 `+ 新增场地`。本 plan 原 File Structure 漏了它；执行时新增 `cloudfunctions/courts/index.js + package.json`，至少支持 `list / create / update`，集合名 `courts`，字段 `{ _id, courtId, name, location, enabled, createTime, updateTime }`。
4. **补 `pages/tournament-view`。** spec §7.1 要只读按场地视图，本 plan 原任务漏掉。执行时在 Task 15 或 Task 16 加入 `miniprogram/pages/tournament-view/index.{js,wxml,wxss}`，改为读取 `schedulePlan`，不得再依赖 `courtTimeGrid`。
5. **`bulkSet` 先校验后删除。** `tournament-registrations.bulkSet` 原示例先删旧报名再校验新数据，存在数据损坏风险。实现时必须先完整校验并组装 docs，全部通过后再删除旧数据并写入新数据。
6. **`match_results` 必须带 `position`，并预建后续轮占位行。** Task 9 的 `bulkUpsertScheduledMatches` 除 R1 payload 外，还要读取 `tournament_brackets` 中 R2+ skeleton，为所有 bracket match upsert `match_results` 占位行：`player1/player2=null`、`position`、`round`、`resultStatus='pending'`、`courtId=null`。这样 Phase 8 录分页能显示“未开打”，推进后也能更新下一轮 result 行。
7. **选择器协议改为 `requiredCount`。** `<player-picker-sheet>` 不再用 `single: Boolean` 表达选择数量，改为 `requiredCount: 1 | 2 | 4`。换人用 1；单打自由拉球/添加场次用 2；双打自由拉球/添加场次用 4。
8. **前端 mirror 必须可 hash 比对。** `miniprogram/utils/bracket-generator.js` 与 `scheduler-mirror.js` 如果要被 Phase 8 的 `sync-shared-libs.sh` 精确 hash 比对，就必须从云函数 lib 原样复制并保留 CommonJS `module.exports`。不要“删掉 module.exports / 改 ES module”。小程序端使用 CommonJS `require`。
9. **Task 14 需补 pickerMode 回传细节。** `tournament-add-player(s)` 的 `pickerMode=1` 不能只写一句“globalData 回传”；必须明确 `onShow` 从 `app.globalData.lastSelectedPlayers` 取回并清空，避免返回 wizard 后选手不更新。
10. **清库策略同步数据库文档。** 因本 Phase 明确不兼容 `courtTimeGrid`，执行时必须更新 `cloudfunctions/DATABASE_SCHEMA.md` 中 tournaments / match_results / free_plays / courts 的 schema，避免后续开发继续按旧字段写。

## 文档纪律

每次完成 Task 后：
1. `git status` 确认 working tree 干净
2. 该 Task 的所有断言通过（无 skip）
3. PROGRESS.md 在最后一个 Task 一次性更新（不是每 Task 都改）

如果实施中偏离本 plan，按 plan 03 模式在文档顶部加一个「YYYY-MM-DD 执行决策」节，下个上下文能看到。

---

## File Structure

```
scripts/                                            (新建)
└── cleanup-test-data.js                            - 双重确认 + 清库脚本
└── sync-shared-libs.sh                             - 占位，Phase 8 实装；本 phase 不创建

cloudfunctions/tournaments/                         (改)
├── index.js                                        - create 支持 status='draft' + createdBy；validate schedulePlan / pointsRules；list/listByIds/lastPointsRules
└── lib/
    └── validate.js                                 - 改：validateCourtTimeGrid → validateSchedulePlan

cloudfunctions/courts/                              (新建)
├── index.js                                        - actions: list / create / update
└── package.json

cloudfunctions/tournament-registrations/            (改)
└── index.js                                        - 新 action: bulkSet

cloudfunctions/tournament-brackets/                 (大改)
├── index.js                                        - 新 actions: saveInitialMatches / saveSchedule / regenerateDraft；旧 actions 保留
└── lib/
    ├── generator.js                                - 新：generateFirstRound（BYE） + advanceWinner（推进公式）
    ├── scheduler.js                                - 新：assignToCourts（顺序填满）
    ├── pairing/                                    - 从 scheduler-engine 迁过来
    │   ├── round-robin.js
    │   └── knockout-bracket.js
    └── __tests__/
        ├── generator.test.js
        ├── scheduler.test.js
        ├── round-robin.test.js                     - 同迁
        └── knockout-bracket.test.js                - 同迁

cloudfunctions/free-plays/                          (新建)
├── index.js                                        - actions: bulkSet / create / list / remove
└── package.json

cloudfunctions/match-results/                       (小改 — 仅 bulkUpsertScheduledMatches；其余 Phase 8)
└── index.js                                        - 新 action: bulkUpsertScheduledMatches；写 position；预建 R2+ 占位 result 行

cloudfunctions/scheduler-engine/                    (保留)
├── README.md                                       - 改：标 @deprecated，引用新位置
└── index.js                                        - 改：开头加 console.warn

miniprogram/components/court-grid/                  (重写)
└── index.js / .wxml / .wxss                        - 30min 颗粒度 + 多场地

miniprogram/components/schedule-board/              (新建)
├── index.js / .json / .wxml / .wxss

miniprogram/components/player-picker-sheet/         (新建)
├── index.js / .json / .wxml / .wxss

miniprogram/utils/                                  (新建)
├── bracket-generator.js                            - vendored copy of tournament-brackets/lib/generator.js
└── scheduler-mirror.js                             - vendored copy of tournament-brackets/lib/scheduler.js

miniprogram/pages/tournament-edit/                  (重写)
└── index.js / .wxml / .wxss

miniprogram/pages/tournament-brackets/              (大改)
└── index.js / .wxml / .wxss                        - 按场地维度展示首轮

miniprogram/pages/tournament-view/                  (微改)
└── index.js / .wxml / .wxss                        - 只读按场地视图，读取 schedulePlan

miniprogram/pages/tournament-detail/                (微改)
└── index.js                                        - 编辑入口判断 status='draft' 跳 wizard
miniprogram/pages/tournament-manage/                (微改)
└── index.js                                        - draft 仅创建者可见

cloudfunctions/DATABASE_SCHEMA.md                   - 改：schedulePlan / pointsRules / free_plays / courts / match_results.position

docs/superpowers/plans/PROGRESS.md                  - 改：Phase 7 完成
```

---

## Task 1 · 清库脚本（破坏性，本地手动跑）

**Files:**
- Create: `scripts/cleanup-test-data.js`

- [ ] **Step 1.1 创建 scripts/ 目录**

```bash
mkdir -p scripts
```

- [ ] **Step 1.2 写脚本**

```js
// scripts/cleanup-test-data.js
// 用法：FOPEN_CLOUD_ENV=<envId> FOPEN_CLEANUP_CONFIRM=<envId> node scripts/cleanup-test-data.js
// 两环境变量必须相等，避免误清正式环境。

const tcb = require('@cloudbase/node-sdk')

const TARGETS = [
  'tournaments',
  'tournament_brackets',
  'tournament_registrations',
  'match_results',
  'tournament_points',
  'free_plays',
]

async function main() {
  const env = process.env.FOPEN_CLOUD_ENV
  const confirm = process.env.FOPEN_CLEANUP_CONFIRM
  if (!env || env !== confirm) {
    console.error('[abort] FOPEN_CLEANUP_CONFIRM 必须设置且等于 FOPEN_CLOUD_ENV')
    console.error(`  FOPEN_CLOUD_ENV = ${env || '(unset)'}`)
    console.error(`  FOPEN_CLEANUP_CONFIRM = ${confirm || '(unset)'}`)
    process.exit(1)
  }
  console.log(`>>> 即将清空 cloud env: ${env}`)
  console.log(`>>> 集合: ${TARGETS.join(' / ')}`)
  console.log('>>> 5 秒后开始，Ctrl-C 取消...')
  await new Promise(r => setTimeout(r, 5000))

  const app = tcb.init({ env })
  const db = app.database()
  for (const name of TARGETS) {
    const total = (await db.collection(name).count()).total
    console.log(`>>> ${name}: ${total} 条`)
    if (total === 0) continue
    // 微信云数据库单次最多删 1000 条，循环到清空
    let removed = 0
    while (removed < total) {
      const res = await db.collection(name).limit(1000).remove()
      removed += res.deleted || 0
      if (!res.deleted) break
    }
    console.log(`<<< ${name}: removed ${removed}`)
  }
  console.log('done.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 1.3 安装 SDK（已装则跳过）**

```bash
cd scripts && [ -f package.json ] || npm init -y
npm install @cloudbase/node-sdk
```

> **不要在 CI 自动跑，不要 commit `node_modules`。**

- [ ] **Step 1.4 加 .gitignore**

把 `scripts/node_modules` 追加到根 `.gitignore`（若已存在则跳过）。

- [ ] **Step 1.5 在本地实际执行一次清库**

> **决策点：** 本步骤必须由本人执行，agent 不要替用户跑。如果本步骤未执行，后续 Task 写入新结构的数据可能与旧数据共存，bracket validator 会失败。

```bash
FOPEN_CLOUD_ENV=<your-env> FOPEN_CLEANUP_CONFIRM=<your-env> node scripts/cleanup-test-data.js
```

预期：6 个集合全部 0 条。

- [ ] **Step 1.6 commit**

```bash
git add scripts/cleanup-test-data.js scripts/package.json scripts/package-lock.json .gitignore
git commit -m "chore(scripts): 清库脚本（双重确认） · Phase 7 Task 1"
```

---

## Task 2 · `tournaments` 云函数：draft + schedulePlan + pointsRules

**Files:**
- Modify: `cloudfunctions/tournaments/index.js`
- Modify: `cloudfunctions/tournaments/lib/validate.js`
- Modify: `cloudfunctions/tournaments/lib/__tests__/validate.test.js`

### Step 2.1 改 `lib/validate.js`：把 `validateCourtTimeGrid` 改成 `validateSchedulePlan` + 增加 `validatePointsRules`

- [ ] 写失败测试（追加到 `__tests__/validate.test.js`）

```js
const { validateSchedulePlan, validatePointsRules } = require('../validate')

describe('validateSchedulePlan', () => {
  test('合法：30min slotMinutes，1 场地 2 slot', () => {
    const sp = {
      slotMinutes: 30,
      courts: [
        { courtId: 'c1', name: '1号场', location: '主馆',
          slots: ['2026-05-25T19:00', '2026-05-25T19:30'] }
      ],
      queues: []
    }
    expect(validateSchedulePlan(sp)).toEqual([])
  })

  test('非法：slotMinutes ≠ 30', () => {
    const errors = validateSchedulePlan({ slotMinutes: 20, courts: [], queues: [] })
    expect(errors).toContain('schedulePlan.slotMinutes 必须固定为 30')
  })

  test('非法：courts 为空', () => {
    const errors = validateSchedulePlan({ slotMinutes: 30, courts: [], queues: [] })
    expect(errors).toContain('schedulePlan.courts 不能为空')
  })

  test('非法：某 court.slots 为空', () => {
    const errors = validateSchedulePlan({
      slotMinutes: 30,
      courts: [{ courtId: 'c1', name: '1号', location: '主馆', slots: [] }],
      queues: []
    })
    expect(errors.some(e => /slots 不能为空/.test(e))).toBe(true)
  })

  test('非法：courtId 重复', () => {
    const errors = validateSchedulePlan({
      slotMinutes: 30,
      courts: [
        { courtId: 'c1', name: '1号', location: '主馆', slots: ['2026-05-25T19:00'] },
        { courtId: 'c1', name: '1号', location: '主馆', slots: ['2026-05-25T19:30'] }
      ],
      queues: []
    })
    expect(errors).toContain('schedulePlan.courts.courtId 重复')
  })
})

describe('validatePointsRules', () => {
  test('合法：winLoss + placement 双子树都在', () => {
    expect(validatePointsRules({
      winLoss: { win: 20, loss: 10, walkover: 0 },
      placement: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 }
    })).toEqual([])
  })

  test('非法：缺 winLoss', () => {
    expect(validatePointsRules({
      placement: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 }
    })).toContain('pointsRules.winLoss 必填')
  })

  test('非法：placement 缺字段', () => {
    const errors = validatePointsRules({
      winLoss: { win: 20, loss: 10, walkover: 0 },
      placement: { champion: 100, runnerUp: 70 }
    })
    expect(errors.some(e => /placement.semifinal/.test(e))).toBe(true)
  })
})
```

- [ ] 跑测试，应失败

```bash
cd cloudfunctions/tournaments && npx jest validate
```

- [ ] 实现 `lib/validate.js`（完整覆盖；如已有 `validateCourtTimeGrid`，可删除或保留为 noop 兼容）

```js
function validateSchedulePlan(sp) {
  const errors = []
  if (!sp || typeof sp !== 'object') return ['schedulePlan 必填']
  if (sp.slotMinutes !== 30) errors.push('schedulePlan.slotMinutes 必须固定为 30')
  if (!Array.isArray(sp.courts) || sp.courts.length === 0) {
    errors.push('schedulePlan.courts 不能为空')
  } else {
    const seen = new Set()
    sp.courts.forEach((c, i) => {
      if (!c.courtId) errors.push(`schedulePlan.courts[${i}].courtId 必填`)
      else if (seen.has(c.courtId)) errors.push('schedulePlan.courts.courtId 重复')
      else seen.add(c.courtId)
      if (!c.name) errors.push(`schedulePlan.courts[${i}].name 必填`)
      if (!Array.isArray(c.slots) || c.slots.length === 0) {
        errors.push(`schedulePlan.courts[${i}].slots 不能为空`)
      }
    })
  }
  return errors
}

function validatePointsRules(pr) {
  const errors = []
  if (!pr || typeof pr !== 'object') return ['pointsRules 必填']
  if (!pr.winLoss) errors.push('pointsRules.winLoss 必填')
  else {
    ;['win', 'loss', 'walkover'].forEach(k => {
      if (typeof pr.winLoss[k] !== 'number') errors.push(`pointsRules.winLoss.${k} 必须是数字`)
    })
  }
  if (!pr.placement) errors.push('pointsRules.placement 必填')
  else {
    ;['champion','runnerUp','semifinal','quarterfinal','participation'].forEach(k => {
      if (typeof pr.placement[k] !== 'number') errors.push(`pointsRules.placement.${k} 必须是数字`)
    })
  }
  return errors
}

module.exports = { validateSchedulePlan, validatePointsRules }
```

- [ ] 跑测试，应全过

### Step 2.2 改 `cloudfunctions/tournaments/index.js`：create 支持 draft，update 校验新字段

- [ ] 顶部 import 改为：

```js
const { validateSchedulePlan, validatePointsRules } = require('./lib/validate')
```

- [ ] `validateTournament(data, { isDraft })`：当 `isDraft=true`：
  - 只要求 `name / type / format / startDate / seasonId`
  - 不校验 `schedulePlan / pointsRules / maxPlayers`
- [ ] `validateTournament(data, { isDraft: false })` 全量：
  - 走 `validateSchedulePlan(data.schedulePlan)`
  - 走 `validatePointsRules(data.pointsRules)`
  - `format='knockout'` 时要求 `maxPlayers >= 2`
- [ ] action `create`：accept `status: 'draft' | 'upcoming'`，默认 `upcoming`；`status='draft'` 走 isDraft 校验
- [ ] action `update`：根据当前 doc 的 status 推断校验模式；若客户端在 update 时传 `status: 'upcoming'`（结束 wizard），按全量校验

完整代码片段（核心改动节选）：

```js
async function handleCreate(data) {
  const isDraft = data.status === 'draft'
  const errors = validateTournament(data, { isDraft })
  if (errors.length) return { success: false, error: { code: 'VALIDATION_FAILED', message: errors.join('; '), errors } }

  const _id = data._id || generateTournamentId()
  const now = db.serverDate()
  const doc = {
    _id,
    seasonId: data.seasonId,
    name: data.name,
    location: data.location || '',
    startDate: data.startDate,
    endDate: data.endDate || data.startDate,
    type: data.type,
    format: data.format,
    maxPlayers: data.format === 'knockout' ? (data.maxPlayers || 8) : null,
    status: data.status || 'upcoming',
    description: data.description || '',
    schedulePlan: data.schedulePlan || { slotMinutes: 30, courts: [], queues: [] },
    pointsRules: data.pointsRules || null,
    createTime: now,
    updateTime: now
  }
  await collection.add({ data: doc })
  return { success: true, data: { id: _id, tournament: doc } }
}

async function handleUpdate({ id, data }) {
  if (!id) return { success: false, error: { code: 'INVALID_ARG', message: 'id 必填' } }
  const cur = await collection.doc(id).get().catch(() => null)
  if (!cur || !cur.data) return { success: false, error: { code: 'NOT_FOUND', message: id } }

  const merged = { ...cur.data, ...data }
  const isDraft = (data.status || merged.status) === 'draft'
  const errors = validateTournament(merged, { isDraft })
  if (errors.length) return { success: false, error: { code: 'VALIDATION_FAILED', message: errors.join('; '), errors } }

  const patch = { ...data, updateTime: db.serverDate() }
  await collection.doc(id).update({ data: patch })
  return { success: true, data: { id, tournament: merged } }
}
```

- [ ] Step 2.3 写 / 跑测试

```bash
cd cloudfunctions/tournaments && npx jest
```

要求：旧测试全过，新测试全过。如果旧测试断言 `courtTimeGrid` 必填，调整为断言 `schedulePlan`。

- [ ] Step 2.4 commit

```bash
git add cloudfunctions/tournaments/
git commit -m "feat(tournaments): draft status + schedulePlan + pointsRules · Phase 7 Task 2"
```

---

## Task 3 · `tournament-registrations.bulkSet`

幂等设置整批参赛者：先删本赛事所有报名，再批量 add。

> **2026-05-14 修订：** 原示例的“先删旧再校验新数据”会在非法输入时清空旧报名。实现必须先校验并组装全部 docs，确认无 errors 后再执行删除和写入。

**Files:**
- Modify: `cloudfunctions/tournament-registrations/index.js`

- [ ] **Step 3.1** 在 `exports.main` 的 action 分发处增加 `bulkSet`：

```js
if (action === 'bulkSet') return await handleBulkSet(event)
```

- [ ] **Step 3.2** 实现：

```js
async function handleBulkSet({ tournamentId, registrations }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  if (!Array.isArray(registrations)) return { success: false, error: { code: 'INVALID_ARG', message: 'registrations 必须是数组' } }

  // 拿赛事拷贝 type / seasonId（写入冗余字段）
  const tournament = (await db.collection('tournaments').doc(tournamentId).get().catch(() => ({ data: null }))).data
  if (!tournament) return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }

  // 删旧
  await db.collection('tournament_registrations')
    .where({ tournamentId })
    .remove()

  // 校验 + 加新
  const errors = []
  const docs = registrations.map((r, i) => {
    if (!r.playerId) errors.push(`第 ${i+1} 条缺 playerId`)
    if (!r.playerName) errors.push(`第 ${i+1} 条缺 playerName`)
    if (tournament.type === 'doubles' && !r.partnerId) errors.push(`第 ${i+1} 条双打缺 partnerId`)
    return {
      _id: generateRegistrationId(tournamentId, i),
      tournamentId,
      seasonId: tournament.seasonId,
      type: tournament.type,
      playerId: r.playerId,
      playerName: r.playerName,
      partnerId: r.partnerId || null,
      partnerName: r.partnerName || null,
      teamName: r.teamName || null,
      seed: r.seed || (i + 1),
      registrationStatus: 'confirmed',
      createTime: db.serverDate()
    }
  })
  if (errors.length) return { success: false, error: { code: 'VALIDATION_FAILED', message: errors.join('; '), errors } }

  for (const d of docs) {
    await db.collection('tournament_registrations').add({ data: d })
  }
  return { success: true, data: { count: docs.length } }
}
```

- [ ] **Step 3.3** 测试（手动）：在云开发控制台直接 invoke：

```json
{ "action": "bulkSet", "tournamentId": "tournament_xxx",
  "registrations": [
    { "playerId": "m_a", "playerName": "A" },
    { "playerId": "m_b", "playerName": "B" }
  ]
}
```

预期：返回 `{ success: true, data: { count: 2 } }`，`tournament_registrations` 集合该 tournament 下 2 条。

- [ ] **Step 3.4 commit**

```bash
git add cloudfunctions/tournament-registrations/
git commit -m "feat(tournament-registrations): bulkSet 幂等批量设置 · Phase 7 Task 3"
```

---

## Task 4 · `tournament-brackets/lib/generator.js` · BYE + 推进公式（TDD）

**Files:**
- Create: `cloudfunctions/tournament-brackets/lib/__tests__/generator.test.js`
- Create: `cloudfunctions/tournament-brackets/lib/generator.js`

### Step 4.1 准备 lib/ 目录

```bash
mkdir -p cloudfunctions/tournament-brackets/lib/__tests__
mkdir -p cloudfunctions/tournament-brackets/lib/pairing
```

### Step 4.2 创建/调整 jest 配置

`cloudfunctions/tournament-brackets/package.json` 加（已有 jest 则只补 testMatch）：

```json
{
  "scripts": { "test": "jest" },
  "devDependencies": { "jest": "^29.7.0" },
  "jest": { "testEnvironment": "node", "testMatch": ["**/__tests__/**/*.test.js"] }
}
```

`cd cloudfunctions/tournament-brackets && npm install`

### Step 4.3 写失败测试

`cloudfunctions/tournament-brackets/lib/__tests__/generator.test.js`：

```js
const { generateFirstRound, advanceWinner, finalRoundOf, INSUFFICIENT_PLAYERS } = require('../generator')

function reg(ids) {
  return ids.map((id, i) => ({ playerId: id, playerName: id, registrationId: `reg_${id}`, seed: i + 1 }))
}

describe('finalRoundOf', () => {
  test('4 槽 → finalRound=2', () => expect(finalRoundOf(4)).toBe(2))
  test('8 槽 → finalRound=3', () => expect(finalRoundOf(8)).toBe(3))
  test('16 槽 → finalRound=4', () => expect(finalRoundOf(16)).toBe(4))
})

describe('generateFirstRound · knockout', () => {
  test('4 人 → 2 场 / 无 BYE', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b','c','d']) })
    expect(ms).toHaveLength(2)
    expect(ms.every(m => m.bye === false)).toBe(true)
    expect(ms.every(m => m.round === 1)).toBe(true)
    expect(ms[0].position).toBe(1)
    expect(ms[1].position).toBe(2)
  })

  test('6 人 → 8 槽 → 4 场 / 2 BYE（player2.id === "BYE"）', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b','c','d','e','f']) })
    expect(ms).toHaveLength(4)
    const byeMatches = ms.filter(m => m.bye === true)
    expect(byeMatches).toHaveLength(2)
    byeMatches.forEach(m => {
      expect(m.player2).toEqual({ id: 'BYE', name: 'BYE' })
      expect(m.status).toBe('walkover')
      expect(m.resultStatus).toBe('confirmed')
      expect(m.winner).toEqual({ id: m.player1.id, name: m.player1.name })
    })
  })

  test('12 人 → 16 槽 → 8 场 / 4 BYE', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['p1','p2','p3','p4','p5','p6','p7','p8','p9','p10','p11','p12']) })
    expect(ms).toHaveLength(8)
    const byeMatches = ms.filter(m => m.bye === true)
    expect(byeMatches).toHaveLength(4)
    expect(byeMatches.every(m => m.winner && m.winner.id)).toBe(true)
  })

  test('matchId 唯一', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b','c','d','e','f','g','h']) })
    expect(new Set(ms.map(m => m.matchId)).size).toBe(ms.length)
  })

  test('0 人 → 抛 INSUFFICIENT_PLAYERS', () => {
    expect(() => generateFirstRound({ format: 'knockout', type: 'singles', registrations: [] })).toThrow(INSUFFICIENT_PLAYERS)
  })

  test('1 人 → 抛 INSUFFICIENT_PLAYERS', () => {
    expect(() => generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a']) })).toThrow(INSUFFICIENT_PLAYERS)
  })

  test('2 人 → 1 场决赛 / 无 BYE / finalRound=1', () => {
    const ms = generateFirstRound({ format: 'knockout', type: 'singles', registrations: reg(['a','b']) })
    expect(ms).toHaveLength(1)
    expect(ms[0].bye).toBe(false)
  })
})

describe('generateFirstRound · regular', () => {
  test('4 人 → 2 场（每人一场）', () => {
    const ms = generateFirstRound({ format: 'regular', type: 'singles', registrations: reg(['a','b','c','d']) })
    expect(ms).toHaveLength(2)
    const players = ms.flatMap(m => [m.player1.id, m.player2.id])
    expect(new Set(players).size).toBe(4)
  })

  test('奇数 5 人 → 2 场（1 人轮空，不进 matches）', () => {
    const ms = generateFirstRound({ format: 'regular', type: 'singles', registrations: reg(['a','b','c','d','e']) })
    expect(ms).toHaveLength(2)
    expect(ms.every(m => m.bye === false)).toBe(true)
  })
})

describe('advanceWinner', () => {
  test('R1 position 1, winner=W → R2 position 1 player1=W', () => {
    const patch = advanceWinner({ round: 1, position: 1, winner: { id: 'W', name: 'W' } })
    expect(patch).toEqual({ nextRound: 2, nextPosition: 1, slot: 'player1', winner: { id: 'W', name: 'W' } })
  })
  test('R1 position 2 → R2 position 1 player2', () => {
    const patch = advanceWinner({ round: 1, position: 2, winner: { id: 'X', name: 'X' } })
    expect(patch.nextPosition).toBe(1)
    expect(patch.slot).toBe('player2')
  })
  test('R1 position 3 → R2 position 2 player1', () => {
    const patch = advanceWinner({ round: 1, position: 3, winner: { id: 'X', name: 'X' } })
    expect(patch.nextPosition).toBe(2)
    expect(patch.slot).toBe('player1')
  })
  test('R1 position 8 → R2 position 4 player2', () => {
    const patch = advanceWinner({ round: 1, position: 8, winner: { id: 'X', name: 'X' } })
    expect(patch.nextPosition).toBe(4)
    expect(patch.slot).toBe('player2')
  })
  test('isFinal=true → 返回 null（不推进）', () => {
    const patch = advanceWinner({ round: 3, position: 1, winner: { id: 'X', name: 'X' }, isFinal: true })
    expect(patch).toBeNull()
  })
})
```

### Step 4.4 跑测试 — 应失败

```bash
cd cloudfunctions/tournament-brackets && npx jest generator
```

### Step 4.5 实现 `lib/generator.js`

```js
const INSUFFICIENT_PLAYERS = 'INSUFFICIENT_PLAYERS'

function finalRoundOf(slots) {
  if (slots < 2) throw new Error(INSUFFICIENT_PLAYERS)
  return Math.log2(slots) | 0
}

function nextPowerOf2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function generateFirstRound({ format, type, registrations }) {
  const N = registrations.length
  if (N < 2) throw new Error(INSUFFICIENT_PLAYERS)

  if (format === 'knockout') return generateKnockoutR1(registrations)
  if (format === 'regular') return generateRegularR1(registrations)
  throw new Error(`UNSUPPORTED_FORMAT: ${format}`)
}

function generateKnockoutR1(registrations) {
  const slots = nextPowerOf2(registrations.length)
  const shuffled = shuffle(registrations)
  // 补 BYE 到 slots（不进排程，自动推进）
  const padded = [...shuffled]
  while (padded.length < slots) padded.push({ playerId: 'BYE', playerName: 'BYE', registrationId: null })

  const matches = []
  for (let i = 0; i < slots / 2; i++) {
    const a = padded[i * 2]
    const b = padded[i * 2 + 1]
    const isBye = a.playerId === 'BYE' || b.playerId === 'BYE'
    // 让真玩家始终在 player1，BYE 在 player2（方便晋级推进）
    let p1 = a, p2 = b
    if (a.playerId === 'BYE' && b.playerId !== 'BYE') { p1 = b; p2 = a }

    const m = {
      matchId: `match_r1_p${i + 1}_${Date.now()}_${i}`,
      round: 1,
      position: i + 1,
      player1: p1.playerId === 'BYE' ? null : { id: p1.playerId, name: p1.playerName, registrationId: p1.registrationId },
      player2: p2.playerId === 'BYE' ? { id: 'BYE', name: 'BYE' } : { id: p2.playerId, name: p2.playerName, registrationId: p2.registrationId },
      bye: isBye,
      status: isBye ? 'walkover' : 'pending',
      resultStatus: isBye ? 'confirmed' : 'pending',
      winner: isBye && p1.playerId !== 'BYE' ? { id: p1.playerId, name: p1.playerName } : null,
      courtId: null,
      queueOrder: null
    }
    matches.push(m)
  }
  return matches
}

function generateRegularR1(registrations) {
  const shuffled = shuffle(registrations)
  // 奇数最后 1 人轮空（这一轮）
  const pairCount = Math.floor(shuffled.length / 2)
  const matches = []
  for (let i = 0; i < pairCount; i++) {
    const p1 = shuffled[i * 2]
    const p2 = shuffled[i * 2 + 1]
    matches.push({
      matchId: `match_r1_p${i + 1}_${Date.now()}_${i}`,
      round: 1,
      position: i + 1,
      player1: { id: p1.playerId, name: p1.playerName, registrationId: p1.registrationId },
      player2: { id: p2.playerId, name: p2.playerName, registrationId: p2.registrationId },
      bye: false,
      status: 'pending',
      resultStatus: 'pending',
      winner: null,
      courtId: null,
      queueOrder: null
    })
  }
  return matches
}

function advanceWinner({ round, position, winner, isFinal }) {
  if (isFinal) return null
  const nextPosition = Math.ceil(position / 2)
  const slot = position % 2 === 1 ? 'player1' : 'player2'
  return { nextRound: round + 1, nextPosition, slot, winner }
}

module.exports = { generateFirstRound, advanceWinner, finalRoundOf, INSUFFICIENT_PLAYERS }
```

### Step 4.6 跑测试，应全过

```bash
cd cloudfunctions/tournament-brackets && npx jest generator -- --coverage
```

要求：`lib/generator.js` 行/语句覆盖率 ≥ 95%。

### Step 4.7 commit

```bash
git add cloudfunctions/tournament-brackets/lib/generator.js cloudfunctions/tournament-brackets/lib/__tests__/generator.test.js cloudfunctions/tournament-brackets/package.json cloudfunctions/tournament-brackets/package-lock.json
git commit -m "feat(brackets): generator · BYE 自动推进 + 推进公式 · Phase 7 Task 4"
```

---

## Task 5 · `tournament-brackets/lib/scheduler.js` · 顺序填满场地（TDD）

**Files:**
- Create: `cloudfunctions/tournament-brackets/lib/__tests__/scheduler.test.js`
- Create: `cloudfunctions/tournament-brackets/lib/scheduler.js`

> **算法决策（解决 PROGRESS.md 阻塞 §2）：** 顺序填满场地 — court[0] 容量满了再到 court[1]，以此类推。

- [ ] **Step 5.1 写失败测试**

```js
const { assignToCourts } = require('../scheduler')

function court(id, slotCount) {
  return { courtId: id, name: id, location: '主馆', slots: Array.from({ length: slotCount }, (_, i) => `2026-05-25T19:${(i * 30).toString().padStart(2, '0')}`) }
}

function match(id) {
  return { matchId: id, kind: 'match', sourceMatchId: id }
}

describe('assignToCourts · 顺序填满', () => {
  test('4 场 / 3 场地容量 2/2/2 → court[0]=2, court[1]=2, court[2]=0', () => {
    const matches = ['m1', 'm2', 'm3', 'm4'].map(match)
    const courts = [court('c1', 2), court('c2', 2), court('c3', 2)]
    const queues = assignToCourts(matches, courts)
    expect(queues).toHaveLength(3)
    expect(queues[0].items).toHaveLength(2)
    expect(queues[1].items).toHaveLength(2)
    expect(queues[2].items).toHaveLength(0)
  })

  test('4 场 / 3 场地容量 1/2/3 → court[0]=1, court[1]=2, court[2]=1', () => {
    const matches = ['m1', 'm2', 'm3', 'm4'].map(match)
    const courts = [court('c1', 1), court('c2', 2), court('c3', 3)]
    const queues = assignToCourts(matches, courts)
    expect(queues[0].items).toHaveLength(1)
    expect(queues[1].items).toHaveLength(2)
    expect(queues[2].items).toHaveLength(1)
  })

  test('5 场 / 3 场地容量 1/1/1 → 2 场溢出（返回 unscheduled）', () => {
    const matches = ['m1', 'm2', 'm3', 'm4', 'm5'].map(match)
    const courts = [court('c1', 1), court('c2', 1), court('c3', 1)]
    const { queues, unscheduled } = assignToCourtsWithOverflow(matches, courts)
    expect(unscheduled.map(m => m.matchId)).toEqual(['m4', 'm5'])
    expect(queues[0].items).toHaveLength(1)
    expect(queues[1].items).toHaveLength(1)
    expect(queues[2].items).toHaveLength(1)
  })

  test('0 场地 → 全部 unscheduled', () => {
    const matches = ['m1', 'm2'].map(match)
    const { queues, unscheduled } = assignToCourtsWithOverflow(matches, [])
    expect(unscheduled).toHaveLength(2)
    expect(queues).toEqual([])
  })

  test('0 场比赛 → 全部空 queue', () => {
    const courts = [court('c1', 2), court('c2', 2)]
    const queues = assignToCourts([], courts)
    expect(queues).toHaveLength(2)
    queues.forEach(q => expect(q.items).toEqual([]))
  })

  test('保留 order 字段 0-based 局内', () => {
    const matches = ['m1', 'm2', 'm3'].map(match)
    const courts = [court('c1', 2), court('c2', 2)]
    const queues = assignToCourts(matches, courts)
    expect(queues[0].items[0]).toEqual(expect.objectContaining({ kind: 'match', matchId: 'm1', order: 0 }))
    expect(queues[0].items[1]).toEqual(expect.objectContaining({ kind: 'match', matchId: 'm2', order: 1 }))
    expect(queues[1].items[0]).toEqual(expect.objectContaining({ matchId: 'm3', order: 0 }))
  })
})

const { assignToCourtsWithOverflow } = require('../scheduler')
```

- [ ] **Step 5.2 跑测试，应失败**

- [ ] **Step 5.3 实现 `scheduler.js`**

```js
function assignToCourts(matches, courts) {
  return assignToCourtsWithOverflow(matches, courts).queues
}

function assignToCourtsWithOverflow(matches, courts) {
  if (!courts || courts.length === 0) {
    return { queues: [], unscheduled: [...matches] }
  }
  const queues = courts.map(c => ({ courtId: c.courtId, items: [] }))
  const unscheduled = []
  let cursor = 0
  for (const m of matches) {
    // 跳到容量未满的 court
    while (cursor < courts.length && queues[cursor].items.length >= courts[cursor].slots.length) cursor++
    if (cursor >= courts.length) {
      unscheduled.push(m)
      continue
    }
    const q = queues[cursor]
    q.items.push({
      kind: m.kind || 'match',
      matchId: m.matchId,
      sourceMatchId: m.sourceMatchId || m.matchId,
      order: q.items.length
    })
  }
  return { queues, unscheduled }
}

module.exports = { assignToCourts, assignToCourtsWithOverflow }
```

- [ ] **Step 5.4 跑测试，应全过 + 覆盖率 ≥ 95%**

```bash
cd cloudfunctions/tournament-brackets && npx jest scheduler -- --coverage
```

- [ ] **Step 5.5 commit**

```bash
git add cloudfunctions/tournament-brackets/lib/scheduler.js cloudfunctions/tournament-brackets/lib/__tests__/scheduler.test.js
git commit -m "feat(brackets): scheduler · 顺序填满场地 · Phase 7 Task 5"
```

---

## Task 6 · 把 pairing/* 从 scheduler-engine 迁过来（保持测试）

**Files:**
- Copy: `cloudfunctions/scheduler-engine/lib/pairing/round-robin.js` → `cloudfunctions/tournament-brackets/lib/pairing/round-robin.js`
- Copy: `cloudfunctions/scheduler-engine/lib/pairing/knockout-bracket.js` → `cloudfunctions/tournament-brackets/lib/pairing/knockout-bracket.js`
- Copy 对应单测到 `cloudfunctions/tournament-brackets/lib/__tests__/`

- [ ] **Step 6.1 物理复制**

```bash
cp cloudfunctions/scheduler-engine/lib/pairing/round-robin.js cloudfunctions/tournament-brackets/lib/pairing/round-robin.js
cp cloudfunctions/scheduler-engine/lib/pairing/knockout-bracket.js cloudfunctions/tournament-brackets/lib/pairing/knockout-bracket.js
cp cloudfunctions/scheduler-engine/lib/__tests__/round-robin.test.js cloudfunctions/tournament-brackets/lib/__tests__/round-robin.test.js
cp cloudfunctions/scheduler-engine/lib/__tests__/knockout-bracket.test.js cloudfunctions/tournament-brackets/lib/__tests__/knockout-bracket.test.js
```

- [ ] **Step 6.2 修测试中的相对路径**

迁过来后 `require('../pairing/round-robin')` 仍正确（结构一致），不用改。

- [ ] **Step 6.3 跑全部测试**

```bash
cd cloudfunctions/tournament-brackets && npx jest
```

要求：generator + scheduler + round-robin + knockout-bracket 全过。

- [ ] **Step 6.4 commit**

```bash
git add cloudfunctions/tournament-brackets/lib/pairing/ cloudfunctions/tournament-brackets/lib/__tests__/round-robin.test.js cloudfunctions/tournament-brackets/lib/__tests__/knockout-bracket.test.js
git commit -m "chore(brackets): 把 pairing 从 scheduler-engine 迁过来 · Phase 7 Task 6"
```

---

## Task 7 · `tournament-brackets` 新 actions：saveInitialMatches / saveSchedule / regenerateDraft

**Files:**
- Modify: `cloudfunctions/tournament-brackets/index.js`

> **设计要点（解决 spec §7.3 风险）：**
> - `saveInitialMatches` 直接保存前端传入的最终 `matches`（不再二次随机），后端只做校验
> - 写入时即时跑 BYE 推进，把 R1 的 walkover winner 填入 R2 占位场
> - 保存初始时同步写空骨架（R2、R3 ... finalRound）的占位 matches，结构 `{ player1:null, player2:null, ... }`
> - 旧 actions `add / update / getByTournament / getByRound / updateMatchScore / updateMatchStatus` **全部保留**（不删，前端继续可用）

- [ ] **Step 7.1 在 action 分发处增加 3 个 case：**

```js
if (action === 'saveInitialMatches') return await handleSaveInitialMatches(event)
if (action === 'saveSchedule')       return await handleSaveSchedule(event)
if (action === 'regenerateDraft')    return await handleRegenerateDraft(event)
```

- [ ] **Step 7.2 实现 saveInitialMatches**

```js
const { advanceWinner, finalRoundOf } = require('./lib/generator')

async function handleSaveInitialMatches({ tournamentId, matches }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  if (!Array.isArray(matches) || matches.length === 0) return { success: false, error: { code: 'INVALID_ARG', message: 'matches 不能为空' } }
  const tournament = (await db.collection('tournaments').doc(tournamentId).get().catch(() => ({ data: null }))).data
  if (!tournament) return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }

  // 校验：matches 全部 round=1
  const errs = []
  matches.forEach((m, i) => {
    if (m.round !== 1) errs.push(`第 ${i+1} 场 round 必须 = 1`)
    if (!m.matchId) errs.push(`第 ${i+1} 场缺 matchId`)
    if (m.position === undefined) errs.push(`第 ${i+1} 场缺 position`)
    // 允许 player2 = { id: 'BYE', name: 'BYE' } 或 null
  })
  if (errs.length) return { success: false, error: { code: 'VALIDATION_FAILED', message: errs.join('; '), errors: errs } }

  // 清掉本赛事旧 brackets
  await db.collection('tournament_brackets').where({ tournamentId }).remove().catch(() => null)

  // 写 R1
  const r1Id = `bracket_${tournamentId}_round_1`
  await db.collection('tournament_brackets').add({
    data: {
      _id: r1Id,
      tournamentId,
      round: 1,
      type: tournament.type,
      matches,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  })

  // 仅 knockout：写 R2..finalRound 占位（player 全 null）；BYE 推进时填入
  if (tournament.format === 'knockout') {
    const slots = matches.length * 2
    const finalRound = finalRoundOf(slots)
    for (let r = 2; r <= finalRound; r++) {
      const count = matches.length / Math.pow(2, r - 1)
      const placeholderMatches = Array.from({ length: count }, (_, i) => ({
        matchId: `match_r${r}_p${i + 1}_${Date.now()}_${i}`,
        round: r,
        position: i + 1,
        player1: null,
        player2: null,
        bye: false,
        status: 'pending',
        resultStatus: 'pending',
        winner: null,
        courtId: null,
        queueOrder: null
      }))
      await db.collection('tournament_brackets').add({
        data: {
          _id: `bracket_${tournamentId}_round_${r}`,
          tournamentId,
          round: r,
          type: tournament.type,
          matches: placeholderMatches,
          createTime: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
    }

    // BYE 推进：把 R1 walkover 的 winner 填到 R2
    for (const m of matches) {
      if (m.bye === true && m.winner) {
        const patch = advanceWinner({ round: 1, position: m.position, winner: m.winner, isFinal: finalRound === 1 })
        if (patch) await fillNextSlot(tournamentId, patch)
      }
    }
  }

  return { success: true, data: { count: matches.length } }
}

async function fillNextSlot(tournamentId, { nextRound, nextPosition, slot, winner }) {
  const docId = `bracket_${tournamentId}_round_${nextRound}`
  const doc = (await db.collection('tournament_brackets').doc(docId).get().catch(() => ({ data: null }))).data
  if (!doc) return
  const ms = [...doc.matches]
  const idx = ms.findIndex(x => x.position === nextPosition)
  if (idx < 0) return
  ms[idx] = { ...ms[idx], [slot]: winner }
  await db.collection('tournament_brackets').doc(docId).update({ data: { matches: ms, updateTime: db.serverDate() } })
}
```

- [ ] **Step 7.3 实现 saveSchedule**

> 接收 `{ tournamentId, queues }`。把 `queues[*].items[*]` 里 `kind === 'match'` 的项的 `(courtId, queueOrder)` 落到对应 R1 match。同时把 `schedulePlan.queues` 落到 tournament（用于后续 my-match / 录分页查找）。

```js
async function handleSaveSchedule({ tournamentId, queues }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  if (!Array.isArray(queues)) return { success: false, error: { code: 'INVALID_ARG', message: 'queues 必须是数组' } }

  // 把 (courtId, order) 投射到 matchId
  const matchAssignments = new Map()
  for (const q of queues) {
    for (const item of q.items) {
      if (item.kind === 'match') {
        matchAssignments.set(item.matchId, { courtId: q.courtId, queueOrder: item.order })
      }
    }
  }

  // 改 R1
  const r1Id = `bracket_${tournamentId}_round_1`
  const r1 = (await db.collection('tournament_brackets').doc(r1Id).get().catch(() => ({ data: null }))).data
  if (!r1) return { success: false, error: { code: 'NOT_FOUND', message: r1Id } }

  const updated = r1.matches.map(m => {
    const a = matchAssignments.get(m.matchId)
    if (!a) return m
    return { ...m, courtId: a.courtId, queueOrder: a.queueOrder }
  })
  await db.collection('tournament_brackets').doc(r1Id).update({ data: { matches: updated, updateTime: db.serverDate() } })

  // 同步把 queues 落到 tournament.schedulePlan.queues
  await db.collection('tournaments').doc(tournamentId).update({ data: { 'schedulePlan.queues': queues, updateTime: db.serverDate() } })

  return { success: true, data: { count: updated.filter(m => m.courtId).length } }
}
```

- [ ] **Step 7.4 实现 regenerateDraft（回退 step 2 改选手后清重生）**

```js
async function handleRegenerateDraft({ tournamentId }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  // 删本赛事 brackets / match_results / free_plays（仅草稿）
  await db.collection('tournament_brackets').where({ tournamentId }).remove().catch(() => null)
  await db.collection('match_results').where({ tournamentId }).remove().catch(() => null)
  await db.collection('free_plays').where({ tournamentId }).remove().catch(() => null)
  // tournament.schedulePlan.queues 清空
  await db.collection('tournaments').doc(tournamentId).update({ data: { 'schedulePlan.queues': [], updateTime: db.serverDate() } })
  return { success: true }
}
```

- [ ] **Step 7.5 旧 actions 保留不动**（`add / update / getByTournament / getByRound / updateMatchScore / updateMatchStatus`）。validator 放宽允许 `player2.id === 'BYE'` 与 `player1 === null`：

`validateBracket` 中：

```js
// 旧：
// if (!match.player1 || !match.player1.id) errors.push(...)
// 改成：
if (match.player1 && match.player1.id === undefined) {
  errors.push(`第${index + 1}场比赛 player1 缺 id`)
}
if (match.player2 && match.player2.id === undefined) {
  errors.push(`第${index + 1}场比赛 player2 缺 id`)
}
// 允许 player1 / player2 为 null（占位）或 { id: 'BYE', name: 'BYE' }
```

- [ ] **Step 7.6 手动测**：在云开发控制台 invoke `saveInitialMatches`，准备一个 6 人的 knockout，看 R2 / R3 占位 + R1 的 2 个 BYE 是否自动推进到 R2 player1。

- [ ] **Step 7.7 commit**

```bash
git add cloudfunctions/tournament-brackets/index.js
git commit -m "feat(brackets): saveInitialMatches/saveSchedule/regenerateDraft + 放宽 BYE validator · Phase 7 Task 7"
```

---

## Task 8 · `free-plays` 云函数

**Files:**
- Create: `cloudfunctions/free-plays/package.json`
- Create: `cloudfunctions/free-plays/index.js`

- [ ] **Step 8.1 创建骨架**

```bash
mkdir -p cloudfunctions/free-plays
```

`package.json`:

```json
{
  "name": "free-plays",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": { "wx-server-sdk": "~3.0.4" }
}
```

- [ ] **Step 8.2 实现 index.js**

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const collection = db.collection('free_plays')

function generateId(tournamentId, courtId, order) {
  return `fp_${tournamentId.replace('tournament_', '')}_${courtId}_${order}_${Date.now()}`
}

exports.main = async (event) => {
  const { action } = event
  try {
    if (action === 'bulkSet') return await handleBulkSet(event)
    if (action === 'create')  return await handleCreate(event)
    if (action === 'list')    return await handleList(event)
    if (action === 'remove')  return await handleRemove(event)
    return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } }
  } catch (e) {
    return { success: false, error: { code: 'INTERNAL', message: e.message } }
  }
}

async function handleBulkSet({ tournamentId, items }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  if (!Array.isArray(items)) return { success: false, error: { code: 'INVALID_ARG', message: 'items 必须是数组' } }
  // 整体覆盖：先删本赛事所有 free_plays
  await collection.where({ tournamentId }).remove().catch(() => null)
  const docs = items.map((it, i) => ({
    _id: it._id || generateId(tournamentId, it.courtId, it.queueOrder),
    tournamentId,
    courtId: it.courtId,
    queueOrder: it.queueOrder,
    playerIds: it.playerIds || [],
    createdBy: it.createdBy || null,
    createTime: db.serverDate()
  }))
  for (const d of docs) await collection.add({ data: d })
  return { success: true, data: { count: docs.length } }
}

async function handleCreate({ tournamentId, courtId, queueOrder, playerIds, createdBy }) {
  const _id = generateId(tournamentId, courtId, queueOrder)
  await collection.add({ data: { _id, tournamentId, courtId, queueOrder, playerIds, createdBy, createTime: db.serverDate() } })
  return { success: true, data: { id: _id } }
}

async function handleList({ tournamentId }) {
  const res = await collection.where({ tournamentId }).orderBy('courtId', 'asc').orderBy('queueOrder', 'asc').get()
  return { success: true, data: { items: res.data } }
}

async function handleRemove({ id }) {
  await collection.doc(id).remove()
  return { success: true }
}
```

- [ ] **Step 8.3 上传云函数**

```bash
bash uploadCloudFunction.sh free-plays
```

- [ ] **Step 8.4 commit**

```bash
git add cloudfunctions/free-plays/
git commit -m "feat(free-plays): 自由拉球云函数 + 集合 · Phase 7 Task 8"
```

---

## Task 9 · `match-results.bulkUpsertScheduledMatches`

**Files:**
- Modify: `cloudfunctions/match-results/index.js`

> **数据契约（spec §7.3）：** 输入 `{ tournamentId, matches, queues }`，按 `sourceMatchId` 幂等 upsert；写 `seasonId / tournamentType / matchKind / player1 / player2 / playerIds / courtId / queueOrder / resultStatus`；BYE 写 `resultStatus='confirmed'`、`winner=player1`、`pointsAwarded.entries=[]`，且 BYE 行 `courtId=null / queueOrder=null`；payload 中没出现但 DB 里已有的本赛事行删除。
>
> **2026-05-14 修订：** 还必须写 `position`。保存 R1 后，要读取 `tournament_brackets` 的 R2+ skeleton，并为每个后续轮占位 match upsert `match_results` 行（`player1/player2=null`、`courtId=null`、`queueOrder=null`、`resultStatus='pending'`）。Phase 8 推进时只更新这些占位行的 player slot 和状态，不再临时猜 docId。

- [ ] **Step 9.1 在 action 分发处增加：**

```js
if (action === 'bulkUpsertScheduledMatches') return await handleBulkUpsert(event)
```

- [ ] **Step 9.2 实现**

```js
async function handleBulkUpsert({ tournamentId, matches, queues }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }

  const tournament = (await db.collection('tournaments').doc(tournamentId).get().catch(() => ({ data: null }))).data
  if (!tournament) return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }

  // 把 (courtId, order) 投射到 matchId
  const queueMap = new Map()
  for (const q of (queues || [])) {
    for (const item of q.items) {
      if (item.kind === 'match') queueMap.set(item.matchId, { courtId: q.courtId, queueOrder: item.order })
    }
  }

  const seen = new Set()
  for (const m of matches) {
    const q = queueMap.get(m.matchId)
    const isBye = m.bye === true
    const playerIds = collectPlayerIds(m, tournament.type)
    const docId = `result_${tournamentId.replace('tournament_', '')}_${m.matchId}`
    seen.add(docId)
    const doc = {
      _id: docId,
      tournamentId,
      seasonId: tournament.seasonId,
      tournamentType: tournament.type,
      matchKind: m.matchKind || 'bracket',
      sourceMatchId: m.matchId,
      round: m.round,
      player1: m.player1,
      player2: m.player2,
      playerIds,
      courtId: isBye ? null : (q ? q.courtId : null),
      queueOrder: isBye ? null : (q ? q.queueOrder : null),
      score: null,
      resultStatus: isBye ? 'confirmed' : 'pending',
      winner: isBye ? m.winner : null,
      winnerId: isBye && m.winner ? m.winner.id : null,
      loserId: null,
      confirmedBy: null,
      confirmedAt: null,
      pointsAwarded: isBye ? { source: 'match', entries: [] } : null,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
    const existing = await collection.doc(docId).get().catch(() => null)
    if (existing && existing.data) {
      await collection.doc(docId).update({ data: { ...doc, createTime: existing.data.createTime } })
    } else {
      await collection.add({ data: doc })
    }
  }

  // 删除 payload 之外、属于本赛事的旧行
  const existing = (await collection.where({ tournamentId, matchKind: db.command.in(['bracket','regularRound','extra']) }).get()).data
  for (const e of existing) {
    if (!seen.has(e._id)) await collection.doc(e._id).remove().catch(() => null)
  }

  return { success: true, data: { count: seen.size } }
}

function collectPlayerIds(m, type) {
  const ids = []
  if (m.player1 && m.player1.id && m.player1.id !== 'BYE') {
    ids.push(m.player1.id)
    if (type === 'doubles' && m.player1.partnerId) ids.push(m.player1.partnerId)
  }
  if (m.player2 && m.player2.id && m.player2.id !== 'BYE') {
    ids.push(m.player2.id)
    if (type === 'doubles' && m.player2.partnerId) ids.push(m.player2.partnerId)
  }
  return ids
}
```

- [ ] **Step 9.3 验证（手动）**：上传云函数后用云开发面板 invoke 一次，看 `match_results` 集合是否按 schema 落库。

- [ ] **Step 9.4 commit**

```bash
git add cloudfunctions/match-results/index.js
git commit -m "feat(match-results): bulkUpsertScheduledMatches · Phase 7 Task 9"
```

---

## Task 10 · `scheduler-engine` 标 @deprecated（不删）

**Files:**
- Modify: `cloudfunctions/scheduler-engine/index.js`
- Create/Modify: `cloudfunctions/scheduler-engine/README.md`

- [ ] **Step 10.1 在 index.js 顶部添加注释 + 启动 warn**

```js
// @deprecated since Phase 7
// 算法已迁移到 cloudfunctions/tournament-brackets/lib/{generator,scheduler,pairing}
// 当前文件保留是为了让 Phase 1-4 单测继续可跑（44 例）。Phase 8 完成后再下线。
console.warn('[scheduler-engine] @deprecated — 请使用 tournament-brackets/lib')
```

- [ ] **Step 10.2 README.md：**

```md
# scheduler-engine (@deprecated since Phase 7)

算法已经迁到 `cloudfunctions/tournament-brackets/lib/`：
- `generator.js` — BYE 自动推进 + 推进公式（原来不在这里，本 Phase 新加）
- `scheduler.js` — 顺序填满场地（替代原来的 greedy 贪心排程）
- `pairing/round-robin.js` — 常规赛配对
- `pairing/knockout-bracket.js` — 单败签表

本目录的 44 例单测保留，Phase 8 完成后再整体下线（含云端云函数）。
```

- [ ] **Step 10.3 跑现有 44 单测，确认无回归**

```bash
cd cloudfunctions/scheduler-engine && npx jest
```

- [ ] **Step 10.4 commit**

```bash
git add cloudfunctions/scheduler-engine/
git commit -m "chore(scheduler-engine): 标 @deprecated · Phase 7 Task 10"
```

---

## Task 11 · `<court-grid>` 重写为 30min 颗粒度多选

**Files:**
- Modify: `miniprogram/components/court-grid/index.js`
- Modify: `miniprogram/components/court-grid/index.wxml`
- Modify: `miniprogram/components/court-grid/index.wxss`
- Modify: `miniprogram/components/court-grid/index.json`

> **接口契约：**
> ```js
> properties: {
>   value: { type: Object, value: { slotMinutes: 30, courts: [] } }, // schedulePlan 的 courts 子结构
>   tournamentDate: { type: String, value: '' },  // YYYY-MM-DD
>   availableCourts: { type: Array, value: [] }   // 俱乐部 courts 全集 [{ courtId, name, location }]
> },
> // 触发 change 事件，detail = { courts: [...] }
> ```
> 默认日程 08:00 – 22:00 共 28 格（4 列 × 7 行），每格 = 30min。

- [ ] **Step 11.1 写 index.js**

```js
Component({
  properties: {
    value: { type: Object, value: { slotMinutes: 30, courts: [] } },
    tournamentDate: { type: String, value: '' },
    availableCourts: { type: Array, value: [] }
  },
  data: {
    selectedCourtIds: [],   // 已勾选的 courtId
    slotTimes: [],          // 'HH:mm' 列表（28 项）
    pickedByCourt: {}       // { [courtId]: Set<'HH:mm'> }
  },
  observers: {
    'value, tournamentDate'(value, date) {
      const slotTimes = buildSlotTimes()
      const pickedByCourt = {}
      const selectedCourtIds = []
      ;(value.courts || []).forEach(c => {
        selectedCourtIds.push(c.courtId)
        pickedByCourt[c.courtId] = new Set((c.slots || []).map(s => formatHHmm(s)))
      })
      this.setData({ slotTimes, selectedCourtIds, pickedByCourt: serializeMap(pickedByCourt) })
    }
  },
  methods: {
    onToggleCourt(e) {
      const courtId = e.currentTarget.dataset.courtId
      const sel = new Set(this.data.selectedCourtIds)
      if (sel.has(courtId)) sel.delete(courtId)
      else sel.add(courtId)
      this.setData({ selectedCourtIds: [...sel] })
      this.emit()
    },
    onToggleSlot(e) {
      const { courtId, time } = e.currentTarget.dataset
      const map = { ...this.data.pickedByCourt }
      const set = new Set(map[courtId] || [])
      if (set.has(time)) set.delete(time); else set.add(time)
      map[courtId] = [...set].sort()
      this.setData({ pickedByCourt: map })
      this.emit()
    },
    emit() {
      const courts = this.data.selectedCourtIds.map(cid => {
        const meta = this.data.availableCourts.find(c => c.courtId === cid) || { name: cid, location: '' }
        const slots = (this.data.pickedByCourt[cid] || []).map(hhmm => `${this.data.tournamentDate}T${hhmm}`)
        return { courtId: cid, name: meta.name, location: meta.location, slots }
      })
      this.triggerEvent('change', { courts })
    }
  }
})

function buildSlotTimes() {
  const out = []
  for (let h = 8; h < 22; h++) {
    out.push(`${pad(h)}:00`)
    out.push(`${pad(h)}:30`)
  }
  return out
}
function pad(n) { return n.toString().padStart(2, '0') }
function formatHHmm(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[1]}:${m[2]}` : ''
}
function serializeMap(map) {
  const out = {}
  for (const k of Object.keys(map)) out[k] = [...(map[k] || [])].sort()
  return out
}
```

- [ ] **Step 11.2 写 index.wxml**

```xml
<view class="court-grid">
  <view wx:for="{{availableCourts}}" wx:key="courtId" class="court-row">
    <view class="court-head" bindtap="onToggleCourt" data-court-id="{{item.courtId}}">
      <checkbox checked="{{selectedCourtIds.indexOf(item.courtId) >= 0}}" disabled="true" />
      <text class="court-name">{{item.name}}</text>
      <text class="court-loc text-meta">{{item.location}}</text>
    </view>
    <view wx:if="{{selectedCourtIds.indexOf(item.courtId) >= 0}}" class="slot-grid">
      <view
        wx:for="{{slotTimes}}"
        wx:for-item="t"
        wx:key="*this"
        class="slot-cell {{(pickedByCourt[item.courtId] || []).indexOf(t) >= 0 ? 'picked' : ''}}"
        bindtap="onToggleSlot"
        data-court-id="{{item.courtId}}"
        data-time="{{t}}"
      >{{t}}</view>
    </view>
  </view>
</view>
```

- [ ] **Step 11.3 写 index.wxss**（4 列网格 + picked 高亮）

```css
.court-grid { display: flex; flex-direction: column; gap: var(--space-3); }
.court-row { border: 1rpx solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); }
.court-head { display: flex; align-items: center; gap: var(--space-2); }
.court-name { font-weight: 600; }
.slot-grid { margin-top: var(--space-2); display: grid; grid-template-columns: repeat(4, 1fr); gap: 6rpx; }
.slot-cell { padding: 12rpx 0; text-align: center; border-radius: 8rpx; background: var(--color-bg-soft); font-size: 24rpx; }
.slot-cell.picked { background: var(--color-primary); color: #fff; }
```

- [ ] **Step 11.4 在 `tournament-edit` 里联调（先粗用一下）**

临时在 `pages/tournament-edit/index.json` 的 `usingComponents` 保留 `court-grid`，Task 14 整体重写时再正式接入。

- [ ] **Step 11.5 commit**

```bash
git add miniprogram/components/court-grid/
git commit -m "feat(court-grid): 30min 颗粒度多选格 · Phase 7 Task 11"
```

---

## Task 12 · `<player-picker-sheet>` 新建

**Files:**
- Create: `miniprogram/components/player-picker-sheet/index.{js,json,wxml,wxss}`

> **接口契约：**
> ```js
> properties: {
>   show: Boolean,
>   title: { type: String, value: '选择球员' },
>   members: { type: Array, value: [] },     // [{ _id, name, avatarUrl }]
>   excludeIds: { type: Array, value: [] },  // 不可选的 memberId（含当前对阵其他位置）
>   requiredCount: { type: Number, value: 1 } // 1=换人；2=单打加场/自由拉球；4=双打加场/自由拉球
> }
> // events:
> //   confirm({ memberIds: ['m_x', ...] })  长度必须等于 requiredCount
> //   cancel()
> ```

> **2026-05-14 修订：** 下方示例代码仍是旧 `single` 写法，执行时必须改成 `requiredCount`，否则单打 `+ 添加场次` / `+ 自由拉球` 会只选 1 人，无法组装 `player1/player2`。

- [ ] **Step 12.1 index.json**

```json
{ "component": true, "usingComponents": {} }
```

- [ ] **Step 12.2 index.js**

```js
Component({
  properties: {
    show: Boolean,
    title: { type: String, value: '选择球员' },
    members: { type: Array, value: [] },
    excludeIds: { type: Array, value: [] },
    single: { type: Boolean, value: true }
  },
  data: { selected: [], keyword: '' },
  methods: {
    onSearch(e) { this.setData({ keyword: e.detail.value }) },
    onTap(e) {
      const id = e.currentTarget.dataset.id
      if (this.data.excludeIds.indexOf(id) >= 0) return
      let next
      if (this.data.single) next = [id]
      else {
        const cur = [...this.data.selected]
        const idx = cur.indexOf(id)
        if (idx >= 0) cur.splice(idx, 1)
        else if (cur.length < 4) cur.push(id)
        next = cur
      }
      this.setData({ selected: next })
    },
    onConfirm() {
      const need = this.data.single ? 1 : 4
      if (this.data.selected.length !== need) {
        wx.showToast({ title: this.data.single ? '请选 1 人' : '请选 4 人', icon: 'none' }); return
      }
      this.triggerEvent('confirm', { memberIds: this.data.selected })
      this.setData({ selected: [], keyword: '' })
    },
    onCancel() { this.triggerEvent('cancel'); this.setData({ selected: [], keyword: '' }) }
  }
})
```

- [ ] **Step 12.3 index.wxml**

```xml
<view wx:if="{{show}}" class="picker-mask" bindtap="onCancel">
  <view class="picker-sheet" catchtap="">
    <view class="picker-head">
      <text class="picker-title">{{title}}</text>
      <text class="picker-cancel" bindtap="onCancel">取消</text>
    </view>
    <input class="picker-search" placeholder="搜索姓名" bindinput="onSearch" value="{{keyword}}" />
    <scroll-view scroll-y class="picker-list">
      <view
        wx:for="{{members}}"
        wx:key="_id"
        wx:if="{{!keyword || item.name.indexOf(keyword) >= 0}}"
        class="picker-row {{selected.indexOf(item._id) >= 0 ? 'sel' : ''}} {{excludeIds.indexOf(item._id) >= 0 ? 'disabled' : ''}}"
        data-id="{{item._id}}"
        bindtap="onTap"
      >
        <image class="picker-avatar" src="{{item.avatarUrl}}" />
        <text class="picker-name">{{item.name}}</text>
      </view>
    </scroll-view>
    <button class="picker-confirm" bindtap="onConfirm">确认（{{selected.length}}{{single ? '' : '/4'}}）</button>
  </view>
</view>
```

- [ ] **Step 12.4 index.wxss**（基础 sheet 样式，约束在屏幕底部 80% 高度）

```css
.picker-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 999; display: flex; align-items: flex-end; }
.picker-sheet { background: #fff; width: 100%; max-height: 80vh; border-top-left-radius: var(--radius-lg); border-top-right-radius: var(--radius-lg); padding: var(--space-4); display: flex; flex-direction: column; }
.picker-head { display: flex; justify-content: space-between; align-items: center; }
.picker-title { font-weight: 600; }
.picker-cancel { color: var(--color-text-muted); }
.picker-search { margin: var(--space-3) 0; background: var(--color-bg-soft); padding: var(--space-2) var(--space-3); border-radius: var(--radius-md); }
.picker-list { flex: 1; overflow-y: auto; }
.picker-row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; }
.picker-row.sel { background: rgba(0, 0, 0, 0.04); }
.picker-row.disabled { opacity: 0.4; }
.picker-avatar { width: 64rpx; height: 64rpx; border-radius: 50%; background: var(--color-bg-soft); }
.picker-confirm { margin-top: var(--space-3); }
```

- [ ] **Step 12.5 commit**

```bash
git add miniprogram/components/player-picker-sheet/
git commit -m "feat(player-picker-sheet): 选手切换 sheet · Phase 7 Task 12"
```

---

## Task 13 · `<schedule-board>` 新建（首轮排程页主体）

**Files:**
- Create: `miniprogram/components/schedule-board/index.{js,json,wxml,wxss}`

> **接口契约：**
> ```js
> properties: {
>   tournament: Object,        // { type, format }
>   registrations: Array,      // 当前赛事报名 [{ playerId, playerName, partnerId, ... }]
>   schedulePlan: Object,      // { courts: [{ courtId, name, slots: [...] }] }
>   matches: Array,            // 当前首轮 matches（前端 §4.1 generate 后或 hydrate 后）
>   freePlays: Array,          // 当前自由拉球 items
>   queues: Array,             // schedulePlan.queues 状态
>   members: Array             // 俱乐部全集（给 player-picker 用）
> },
> // events:
> //   change({ matches, queues, freePlays })  任一编辑后触发
> //   regenerate()                            "重新随机安排"按钮
> ```

> **交互（spec §4.3）：**
> - ⋮⋮ 长按 → actionsheet：上移 / 下移 / 移到其他场地
> - 点选手名 → 弹 player-picker-sheet
> - ✕ → bracket 不可删（置灰）；freePlay / extra 可删
> - `+ 自由拉球` → picker（任意俱乐部会员）→ 落 freePlay 行到当前 court 队列末尾
> - `+ 添加场次` 仅 `tournament.format === 'regular'` 可点
> - 顶部 `重新随机安排` 按钮 → triggerEvent('regenerate')

- [ ] **Step 13.1 index.json**

```json
{
  "component": true,
  "usingComponents": {
    "player-picker-sheet": "../player-picker-sheet/index"
  }
}
```

- [ ] **Step 13.2 index.js**（核心方法）

```js
Component({
  properties: {
    tournament: Object,
    registrations: { type: Array, value: [] },
    schedulePlan: Object,
    matches: { type: Array, value: [] },
    freePlays: { type: Array, value: [] },
    queues: { type: Array, value: [] },
    members: { type: Array, value: [] }
  },
  data: {
    pickerShow: false,
    pickerCtx: null,        // { kind: 'switchPlayer'|'addFreePlay'|'addExtra', courtId, matchId?, slot? }
    pickerSingle: true,
    pickerExclude: []
  },
  methods: {
    onRegenerate() {
      wx.showModal({
        title: '重新随机安排？',
        content: '会丢弃当前所有手动调整',
        success: ({ confirm }) => { if (confirm) this.triggerEvent('regenerate') }
      })
    },

    onTapItem(e) {
      // 长按 → actionsheet
      const { courtId, matchId, kind } = e.currentTarget.dataset
      const itemList = ['上移', '下移', '移到其他场地']
      if (kind !== 'bracket') itemList.push('删除')
      wx.showActionSheet({
        itemList,
        success: ({ tapIndex }) => {
          if (tapIndex === 0) this.move(courtId, matchId, -1)
          else if (tapIndex === 1) this.move(courtId, matchId, +1)
          else if (tapIndex === 2) this.moveCourt(courtId, matchId)
          else if (tapIndex === 3) this.removeItem(courtId, matchId, kind)
        }
      })
    },

    onTapPlayer(e) {
      const { matchId, slot } = e.currentTarget.dataset    // slot: 'player1' | 'player2'
      const m = this.data.matches.find(x => x.matchId === matchId)
      if (!m) return
      // 不允许改 BYE 行
      if (m.bye) return
      const exclude = this.collectMatchPlayerIds(m, slot)
      const pool = this.allowedPoolForSwitch(m)  // 单淘汰 = 报名者 / 常规赛 = 报名者
      this.setData({
        pickerShow: true,
        pickerCtx: { kind: 'switchPlayer', matchId, slot },
        pickerSingle: true,
        pickerExclude: exclude,
        members: pool
      })
    },

    onAddFreePlay(e) {
      const courtId = e.currentTarget.dataset.courtId
      this.setData({
        pickerShow: true,
        pickerCtx: { kind: 'addFreePlay', courtId },
        pickerSingle: this.properties.tournament.type === 'singles',
        pickerExclude: []
      })
    },

    onAddExtra(e) {
      if (this.properties.tournament.format !== 'regular') {
        wx.showToast({ title: '仅常规赛可加场次', icon: 'none' }); return
      }
      const courtId = e.currentTarget.dataset.courtId
      this.setData({
        pickerShow: true,
        pickerCtx: { kind: 'addExtra', courtId },
        pickerSingle: this.properties.tournament.type === 'singles',
        pickerExclude: []
      })
    },

    onPickerConfirm(e) {
      const { memberIds } = e.detail
      const ctx = this.data.pickerCtx
      if (!ctx) return
      if (ctx.kind === 'switchPlayer') this.applySwitch(ctx, memberIds[0])
      if (ctx.kind === 'addFreePlay')  this.applyAddFreePlay(ctx, memberIds)
      if (ctx.kind === 'addExtra')     this.applyAddExtra(ctx, memberIds)
      this.setData({ pickerShow: false, pickerCtx: null })
    },

    onPickerCancel() { this.setData({ pickerShow: false, pickerCtx: null }) },

    // —— 数据变更工具 ——
    move(courtId, matchId, delta) {
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      const idx = q.items.findIndex(it => it.matchId === matchId); if (idx < 0) return
      const target = idx + delta
      if (target < 0 || target >= q.items.length) return
      ;[q.items[idx], q.items[target]] = [q.items[target], q.items[idx]]
      q.items.forEach((it, i) => it.order = i)
      this.emitChange({ queues })
    },

    moveCourt(fromCourtId, matchId) {
      const otherCourts = this.properties.schedulePlan.courts
        .filter(c => c.courtId !== fromCourtId)
        .map(c => c.name)
      const ids = this.properties.schedulePlan.courts
        .filter(c => c.courtId !== fromCourtId)
        .map(c => c.courtId)
      wx.showActionSheet({
        itemList: otherCourts,
        success: ({ tapIndex }) => {
          const toCourtId = ids[tapIndex]
          const queues = JSON.parse(JSON.stringify(this.data.queues))
          const from = queues.find(x => x.courtId === fromCourtId)
          const to = queues.find(x => x.courtId === toCourtId)
          if (!from || !to) return
          const idx = from.items.findIndex(it => it.matchId === matchId)
          if (idx < 0) return
          const [item] = from.items.splice(idx, 1)
          item.order = to.items.length
          to.items.push(item)
          from.items.forEach((it, i) => it.order = i)
          this.emitChange({ queues })
        }
      })
    },

    removeItem(courtId, matchId, kind) {
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      q.items = q.items.filter(it => it.matchId !== matchId)
      q.items.forEach((it, i) => it.order = i)
      const patch = { queues }
      if (kind === 'freePlay') patch.freePlays = this.data.freePlays.filter(fp => fp._id !== matchId)
      if (kind === 'extra')    patch.matches   = this.data.matches.filter(m => m.matchId !== matchId)
      this.emitChange(patch)
    },

    applySwitch({ matchId, slot }, newMemberId) {
      const member = this.properties.members.find(x => x._id === newMemberId)
      if (!member) return
      // 单淘汰：互换；常规赛：覆盖
      const matches = JSON.parse(JSON.stringify(this.data.matches))
      const m = matches.find(x => x.matchId === matchId); if (!m) return
      if (this.properties.tournament.format === 'knockout') {
        // 找到 newMemberId 当前所在的 match + slot，与本 (matchId, slot) 互换
        for (const other of matches) {
          if (other.matchId === matchId) continue
          for (const s of ['player1', 'player2']) {
            if (other[s] && other[s].id === newMemberId) {
              const tmp = m[slot]; m[slot] = other[s]; other[s] = tmp
              this.emitChange({ matches })
              return
            }
          }
        }
        // newMemberId 不在 bracket 内（不应该发生，pool 已过滤）→ 直接覆盖
      }
      m[slot] = { id: member._id, name: member.name }
      this.emitChange({ matches })
    },

    applyAddFreePlay({ courtId }, memberIds) {
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      const fpId = `fp_${courtId}_${Date.now()}`
      q.items.push({ kind: 'freePlay', matchId: fpId, freePlayId: fpId, order: q.items.length })
      const freePlays = [...this.data.freePlays, { _id: fpId, courtId, queueOrder: q.items.length - 1, playerIds: memberIds }]
      this.emitChange({ queues, freePlays })
    },

    applyAddExtra({ courtId }, memberIds) {
      const queues = JSON.parse(JSON.stringify(this.data.queues))
      const q = queues.find(x => x.courtId === courtId); if (!q) return
      const newId = `match_extra_${Date.now()}`
      q.items.push({ kind: 'match', matchId: newId, sourceMatchId: newId, order: q.items.length })
      const matches = [...this.data.matches, this.assemblePlayerObjects(memberIds, newId)]
      this.emitChange({ queues, matches })
    },

    assemblePlayerObjects(memberIds, matchId) {
      const ms = memberIds.map(id => this.properties.members.find(x => x._id === id)).filter(Boolean)
      const isDoubles = this.properties.tournament.type === 'doubles'
      const player1 = isDoubles
        ? { id: ms[0]._id, name: ms[0].name, partnerId: ms[1]._id, partnerName: ms[1].name }
        : { id: ms[0]._id, name: ms[0].name }
      const player2 = isDoubles
        ? { id: ms[2]._id, name: ms[2].name, partnerId: ms[3]._id, partnerName: ms[3].name }
        : { id: ms[1]._id, name: ms[1].name }
      return { matchId, round: 1, position: 999, player1, player2, bye: false, status: 'pending', resultStatus: 'pending', winner: null, courtId: null, queueOrder: null, matchKind: 'extra' }
    },

    collectMatchPlayerIds(m, excludeSlot) {
      const ids = []
      const push = obj => { if (obj && obj.id && obj.id !== 'BYE') { ids.push(obj.id); if (obj.partnerId) ids.push(obj.partnerId) } }
      if (excludeSlot !== 'player1') push(m.player1)
      if (excludeSlot !== 'player2') push(m.player2)
      return ids
    },

    allowedPoolForSwitch(m) {
      // 单淘汰 / 常规赛：可选范围 = 报名者
      return this.properties.registrations.map(r => ({ _id: r.playerId, name: r.playerName, avatarUrl: r.avatarUrl }))
    },

    emitChange(patch) {
      const detail = {
        matches:   patch.matches   || this.data.matches,
        queues:    patch.queues    || this.data.queues,
        freePlays: patch.freePlays || this.data.freePlays
      }
      this.setData(patch)
      this.triggerEvent('change', detail)
    }
  }
})
```

- [ ] **Step 13.3 index.wxml** （按场地分组渲染）

```xml
<view class="board">
  <button class="board-regen" size="mini" bindtap="onRegenerate">重新随机安排</button>
  <view class="board-help text-meta">每 30min = 1 场比赛。点选手名切换；长按 ⋮⋮ 调顺序或换场地。</view>

  <block wx:for="{{schedulePlan.courts}}" wx:for-item="court" wx:key="courtId">
    <view class="court-block">
      <view class="court-head">
        <text class="court-title">{{court.name}}</text>
        <text class="court-time text-meta">{{court.slotsLabel}}</text>
      </view>
      <view class="court-queue">
        <block wx:for="{{queues}}" wx:for-item="q" wx:key="courtId">
          <block wx:if="{{q.courtId === court.courtId}}">
            <view
              wx:for="{{q.items}}"
              wx:for-item="it"
              wx:key="matchId"
              class="row row-{{it.kind}}"
            >
              <view class="row-handle"
                    bindlongpress="onTapItem"
                    data-court-id="{{q.courtId}}"
                    data-match-id="{{it.matchId}}"
                    data-kind="{{it.__rowKind}}">⋮⋮</view>
              <view class="row-body">
                <block wx:if="{{it.kind === 'match'}}">
                  <text class="player" bindtap="onTapPlayer" data-match-id="{{it.matchId}}" data-slot="player1">{{it.__player1Label}}</text>
                  <text class="vs">VS</text>
                  <text class="player" bindtap="onTapPlayer" data-match-id="{{it.matchId}}" data-slot="player2">{{it.__player2Label}}</text>
                </block>
                <block wx:if="{{it.kind === 'freePlay'}}">
                  <text class="player">自由拉球</text>
                  <text class="vs">·</text>
                  <text class="player">{{it.__playersLabel}}</text>
                </block>
              </view>
              <text class="row-del {{it.__rowKind === 'bracket' ? 'disabled' : ''}}"
                    catchtap="onTapItem"
                    data-court-id="{{q.courtId}}"
                    data-match-id="{{it.matchId}}"
                    data-kind="{{it.__rowKind}}">✕</text>
            </view>
          </block>
        </block>
      </view>
      <view class="court-actions">
        <button size="mini" bindtap="onAddFreePlay" data-court-id="{{court.courtId}}">+ 自由拉球</button>
        <button size="mini" bindtap="onAddExtra" data-court-id="{{court.courtId}}" disabled="{{tournament.format !== 'regular'}}">+ 添加场次</button>
      </view>
    </view>
  </block>

  <player-picker-sheet
    show="{{pickerShow}}"
    members="{{members}}"
    single="{{pickerSingle}}"
    exclude-ids="{{pickerExclude}}"
    bindconfirm="onPickerConfirm"
    bindcancel="onPickerCancel"
  />
</view>
```

> 注：模板里出现的 `it.__player1Label / __rowKind / __playersLabel / court.slotsLabel` 是父页（Task 14）在 setData 前组装出的展示字段，避免 wxs 复杂度。如果决定走 wxs，记得同步在 wxs 模块里加 `formatPlayer / formatSlots`。

- [ ] **Step 13.4 index.wxss**

```css
.board { display: flex; flex-direction: column; gap: var(--space-4); }
.board-regen { align-self: flex-end; }
.board-help { margin-bottom: var(--space-2); }
.court-block { background: var(--color-bg-soft); border-radius: var(--radius-lg); padding: var(--space-3); }
.court-head { display: flex; justify-content: space-between; margin-bottom: var(--space-2); }
.court-title { font-weight: 600; }
.row { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0; border-bottom: 1rpx dashed var(--color-border); }
.row-handle { color: var(--color-text-muted); }
.row-body { flex: 1; display: flex; align-items: center; gap: var(--space-2); }
.player { padding: 4rpx 8rpx; border-radius: 6rpx; background: #fff; }
.vs { color: var(--color-text-muted); }
.row-del { color: var(--color-danger); }
.row-del.disabled { color: var(--color-text-muted); opacity: 0.4; }
.court-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
.court-actions button { flex: 1; }
```

- [ ] **Step 13.5 commit**

```bash
git add miniprogram/components/schedule-board/
git commit -m "feat(schedule-board): 首轮排程页主体组件 · Phase 7 Task 13"
```

---

## Task 14 · `pages/tournament-edit` 重写为 4 步 wizard

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.{js,json,wxml,wxss}`

> **持久化（spec §3.5）：** 每点「下一步」就 update tournament，外加触发对应的 bulkSet / saveInitialMatches / saveSchedule / bulkUpsert。如果在 step 2 选手变更，先调 `tournament-brackets.regenerateDraft` 再回 step 3 重新本地 generate。
>
> **2026-05-14 修订：** 本 Task 还要接入 `cloudfunctions/courts.list/create`；`onAddPlayer` 的 `pickerMode=1` 必须实现返回协议（`app.globalData.lastSelectedPlayers` 或页面 event 二选一，但要写完整）；前端解包云函数返回时要兼容旧 `{ data: ... }` 和新 `{ success, data }`。

- [ ] **Step 14.1 index.json**

```json
{
  "navigationBarTitleText": "创建赛事",
  "usingComponents": {
    "court-grid": "/components/court-grid/index",
    "schedule-board": "/components/schedule-board/index"
  }
}
```

- [ ] **Step 14.2 index.js**（核心：state machine + 草稿落库）

```js
const app = getApp()
const { generateFirstRound } = require('../../utils/bracket-generator')  // 仅前端用的简化 mirror，见下
const { assignToCourts } = require('../../utils/scheduler-mirror')        // 同上

Page({
  data: {
    step: 1,
    tournamentId: null,        // draft 落库后拿到
    form: {
      name: '',
      location: '',
      startDate: '',
      type: 'singles',
      format: 'knockout',
      maxPlayers: 8,
      description: ''
    },
    schedulePlanCourts: [],    // [{ courtId, name, location, slots }]
    selectedPlayers: [],       // [{ playerId, playerName, partnerId? }]
    matches: [],
    queues: [],
    freePlays: [],
    pointsRules: {
      winLoss:   { win: 20, loss: 10, walkover: 0 },
      placement: { champion: 100, runnerUp: 70, semifinal: 50, quarterfinal: 30, participation: 10 }
    },
    members: [],
    availableCourts: []
  },

  async onLoad({ id }) {
    await this.loadMembersAndCourts()
    if (id) await this.hydrateDraft(id)
  },

  async loadMembersAndCourts() {
    const m = await wx.cloud.callFunction({ name: 'members', data: { action: 'list' } })
    const c = await wx.cloud.callFunction({ name: 'courts', data: { action: 'list' } }).catch(() => ({ result: { data: { courts: [] } } }))
    this.setData({ members: m.result?.data?.members || [], availableCourts: c.result?.data?.courts || [] })
  },

  async hydrateDraft(id) {
    const r = await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'get', id } })
    const t = r.result?.data?.tournament; if (!t) return
    this.setData({
      tournamentId: id,
      form: { name: t.name, location: t.location, startDate: t.startDate, type: t.type, format: t.format, maxPlayers: t.maxPlayers, description: t.description },
      schedulePlanCourts: (t.schedulePlan && t.schedulePlan.courts) || [],
      queues: (t.schedulePlan && t.schedulePlan.queues) || [],
      pointsRules: t.pointsRules || this.data.pointsRules
    })
    // hydrate registrations
    const regs = await wx.cloud.callFunction({ name: 'tournament-registrations', data: { action: 'list', tournamentId: id } })
    this.setData({ selectedPlayers: (regs.result?.data?.registrations || []).map(r => ({ playerId: r.playerId, playerName: r.playerName, partnerId: r.partnerId, partnerName: r.partnerName, teamName: r.teamName })) })
    // hydrate matches
    const r1 = await wx.cloud.callFunction({ name: 'tournament-brackets', data: { action: 'getByRound', tournamentId: id, round: 1 } })
    this.setData({ matches: r1.result?.data?.bracket?.matches || [] })
    // hydrate freePlays
    const fp = await wx.cloud.callFunction({ name: 'free-plays', data: { action: 'list', tournamentId: id } })
    this.setData({ freePlays: fp.result?.data?.items || [] })
  },

  onFieldChange(e) {
    const k = e.currentTarget.dataset.k
    this.setData({ [`form.${k}`]: e.detail.value })
  },

  async onNext() {
    if (this.data.step === 1) return this.commitStep1()
    if (this.data.step === 2) return this.commitStep2()
    if (this.data.step === 3) return this.commitStep3()
    if (this.data.step === 4) return this.commitStep4()
  },

  onBack() {
    if (this.data.step > 1) this.setData({ step: this.data.step - 1 })
    else wx.navigateBack()
  },

  async commitStep1() {
    if (!this.data.form.name || !this.data.form.location || !this.data.form.startDate) {
      wx.showToast({ title: '请补齐必填项', icon: 'none' }); return
    }
    const seasonId = await this.resolveSeasonId(this.data.form.startDate)
    const payload = { ...this.data.form, seasonId, status: 'draft' }
    let r
    if (this.data.tournamentId) {
      r = await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'update', id: this.data.tournamentId, data: payload } })
    } else {
      r = await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'create', data: payload } })
      if (r.result?.success) this.setData({ tournamentId: r.result.data.id })
    }
    if (!r.result?.success) return wx.showToast({ title: r.result?.error?.message || '失败', icon: 'none' })
    this.setData({ step: 2 })
  },

  async commitStep2() {
    if (this.data.selectedPlayers.length < 2) return wx.showToast({ title: '至少选 2 位球员', icon: 'none' })
    if (this.data.schedulePlanCourts.length === 0) return wx.showToast({ title: '至少选 1 个场地', icon: 'none' })
    if (this.data.schedulePlanCourts.some(c => !c.slots || c.slots.length === 0)) return wx.showToast({ title: '每个场地至少选 1 个 slot', icon: 'none' })

    // 如果之前已生成过 brackets（hydrate 时拿到），且本次选手集合变化 → regenerateDraft
    const playerChanged = await this.checkPlayerChange()
    if (playerChanged && this.data.matches.length > 0) {
      const ok = await new Promise(r => wx.showModal({ title: '注意', content: '已生成的对阵将重置', success: ({ confirm }) => r(confirm) }))
      if (!ok) return
      await wx.cloud.callFunction({ name: 'tournament-brackets', data: { action: 'regenerateDraft', tournamentId: this.data.tournamentId } })
      this.setData({ matches: [], queues: [], freePlays: [] })
    }

    // 把 schedulePlanCourts 落到 tournament
    const schedulePlan = { slotMinutes: 30, courts: this.data.schedulePlanCourts, queues: this.data.queues || [] }
    await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'update', id: this.data.tournamentId, data: { schedulePlan } } })

    // bulkSet 报名
    await wx.cloud.callFunction({ name: 'tournament-registrations', data: { action: 'bulkSet', tournamentId: this.data.tournamentId, registrations: this.data.selectedPlayers } })

    // 进入 step 3 前本地 generate（如果还没 hydrate 出 matches）
    if (this.data.matches.length === 0) {
      const matches = generateFirstRound({ format: this.data.form.format, type: this.data.form.type, registrations: this.data.selectedPlayers })
      const { queues } = assignToCourts(
        matches.filter(m => !m.bye).map(m => ({ matchId: m.matchId, kind: 'match', sourceMatchId: m.matchId })),
        this.data.schedulePlanCourts
      )
      this.setData({ matches, queues })
    }
    this.setData({ step: 3 })
  },

  async commitStep3() {
    // 保存 bracket + schedule + match_results 行
    const r1 = await wx.cloud.callFunction({ name: 'tournament-brackets', data: { action: 'saveInitialMatches', tournamentId: this.data.tournamentId, matches: this.data.matches } })
    if (!r1.result?.success) return wx.showToast({ title: r1.result?.error?.message || '保存对阵失败', icon: 'none' })

    const r2 = await wx.cloud.callFunction({ name: 'tournament-brackets', data: { action: 'saveSchedule', tournamentId: this.data.tournamentId, queues: this.data.queues } })
    if (!r2.result?.success) return wx.showToast({ title: r2.result?.error?.message || '保存排程失败', icon: 'none' })

    const r3 = await wx.cloud.callFunction({ name: 'match-results', data: { action: 'bulkUpsertScheduledMatches', tournamentId: this.data.tournamentId, matches: this.data.matches, queues: this.data.queues } })
    if (!r3.result?.success) return wx.showToast({ title: r3.result?.error?.message || '生成录分行失败', icon: 'none' })

    if (this.data.freePlays.length > 0) {
      await wx.cloud.callFunction({ name: 'free-plays', data: { action: 'bulkSet', tournamentId: this.data.tournamentId, items: this.data.freePlays } })
    }
    this.setData({ step: 4 })
  },

  async commitStep4() {
    const r = await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'update', id: this.data.tournamentId, data: { pointsRules: this.data.pointsRules, status: 'upcoming' } } })
    if (!r.result?.success) return wx.showToast({ title: r.result?.error?.message || '失败', icon: 'none' })
    wx.showToast({ title: '已创建', icon: 'success' })
    wx.redirectTo({ url: `/pages/tournament-detail/index?id=${this.data.tournamentId}` })
  },

  // —— 子组件事件 ——
  onCourtsChange(e) { this.setData({ schedulePlanCourts: e.detail.courts }) },
  onScheduleChange(e) { this.setData({ matches: e.detail.matches, queues: e.detail.queues, freePlays: e.detail.freePlays }) },
  async onRegenerate() {
    const matches = generateFirstRound({ format: this.data.form.format, type: this.data.form.type, registrations: this.data.selectedPlayers })
    const { queues } = assignToCourts(matches.filter(m => !m.bye).map(m => ({ matchId: m.matchId, kind: 'match', sourceMatchId: m.matchId })), this.data.schedulePlanCourts)
    this.setData({ matches, queues, freePlays: [] })
  },

  async checkPlayerChange() {
    if (!this.data.tournamentId) return false
    const r = await wx.cloud.callFunction({ name: 'tournament-registrations', data: { action: 'list', tournamentId: this.data.tournamentId } })
    const old = (r.result?.data?.registrations || []).map(x => x.playerId).sort().join(',')
    const cur = this.data.selectedPlayers.map(x => x.playerId).sort().join(',')
    return old && old !== cur
  },

  async resolveSeasonId(startDate) {
    // 取当年自然年 season（隐式）
    const year = String(new Date(startDate).getFullYear())
    const r = await wx.cloud.callFunction({ name: 'seasons', data: { action: 'getCurrent' } }).catch(() => null)
    return r?.result?.data?.seasonId || `season_${year}`
  }
})
```

- [ ] **Step 14.3 创建前端 mirror utils**

`miniprogram/utils/bracket-generator.js`：从 `cloudfunctions/tournament-brackets/lib/generator.js` 复制 `generateFirstRound / nextPowerOf2 / shuffle`（仅删掉 Node-only 的 module.exports，改为 ES module 或 CommonJS 等小程序支持的语法）。`miniprogram/utils/scheduler-mirror.js` 同理复制 `assignToCourts`。

> **理由：** 前端在 step 3 进入时本地 generate 一次，避免每次刷新都打云函数。落库时再调云函数。后端有完整测试覆盖；前端 mirror 只是 §4.1 描述的"前端跑 generate"步骤。注意保持算法一致，Phase 8 加 `scripts/sync-shared-libs.sh` 时把这两个文件也纳入 hash 比对。

- [ ] **Step 14.4 index.wxml**（4 步条 + 各步表单）

```xml
<view class="wizard">
  <view class="step-bar">
    <text class="step {{step >= 1 ? 'active' : ''}}">①基本</text>
    <text class="step {{step >= 2 ? 'active' : ''}}">②球员+球场</text>
    <text class="step {{step >= 3 ? 'active' : ''}}">③排程</text>
    <text class="step {{step >= 4 ? 'active' : ''}}">④积分</text>
  </view>

  <view wx:if="{{step === 1}}" class="step-body">
    <view class="field"><text class="label">赛事名称*</text><input bindinput="onFieldChange" data-k="name" value="{{form.name}}" /></view>
    <view class="field"><text class="label">地点*</text><input bindinput="onFieldChange" data-k="location" value="{{form.location}}" /></view>
    <view class="field"><text class="label">比赛日期*</text><picker mode="date" bindchange="onFieldChange" data-k="startDate" value="{{form.startDate}}"><text>{{form.startDate || '选择日期'}}</text></picker></view>
    <view class="field"><text class="label">赛制*</text>
      <view class="chip-row">
        <text class="chip {{form.format === 'knockout' ? 'active' : ''}}" bindtap="onFieldChange" data-k="format" data-v="knockout">单淘汰</text>
        <text class="chip {{form.format === 'regular' ? 'active' : ''}}" bindtap="onFieldChange" data-k="format" data-v="regular">常规赛</text>
      </view>
    </view>
    <view class="field"><text class="label">类别*</text>
      <view class="chip-row">
        <text class="chip {{form.type === 'singles' ? 'active' : ''}}" bindtap="onFieldChange" data-k="type" data-v="singles">单打</text>
        <text class="chip {{form.type === 'doubles' ? 'active' : ''}}" bindtap="onFieldChange" data-k="type" data-v="doubles">双打</text>
      </view>
    </view>
    <view wx:if="{{form.format === 'knockout'}}" class="field"><text class="label">最大参赛人数</text><input type="number" bindinput="onFieldChange" data-k="maxPlayers" value="{{form.maxPlayers}}" /></view>
    <view class="field"><text class="label">描述</text><textarea bindinput="onFieldChange" data-k="description" value="{{form.description}}" /></view>
  </view>

  <view wx:if="{{step === 2}}" class="step-body">
    <view class="card">
      <view class="card-head"><text class="card-title">球员</text><text class="text-meta">{{form.format === 'knockout' ? selectedPlayers.length + '/' + form.maxPlayers : '已选 ' + selectedPlayers.length}}</text></view>
      <view wx:if="{{selectedPlayers.length === 0}}" class="empty">尚未选择球员</view>
      <view wx:else class="chips">
        <text wx:for="{{selectedPlayers}}" wx:key="playerId" class="chip">{{item.playerName}}<text class="x" bindtap="onRemovePlayer" data-id="{{item.playerId}}">✕</text></text>
      </view>
      <button size="mini" bindtap="onAddPlayer">+ 添加球员</button>
    </view>
    <view class="card">
      <view class="card-head"><text class="card-title">球场与时间</text></view>
      <court-grid value="{{ { slotMinutes: 30, courts: schedulePlanCourts } }}" tournament-date="{{form.startDate}}" available-courts="{{availableCourts}}" bindchange="onCourtsChange" />
    </view>
  </view>

  <view wx:if="{{step === 3}}" class="step-body">
    <schedule-board
      tournament="{{form}}"
      registrations="{{selectedPlayers}}"
      schedule-plan="{{ { courts: schedulePlanCourts } }}"
      matches="{{matches}}"
      queues="{{queues}}"
      free-plays="{{freePlays}}"
      members="{{members}}"
      bindchange="onScheduleChange"
      bindregenerate="onRegenerate"
    />
  </view>

  <view wx:if="{{step === 4}}" class="step-body">
    <view class="card" wx:if="{{form.format === 'knockout'}}">
      <view class="card-head"><text class="card-title">积分（按名次）</text><button size="mini" bindtap="onUseHistory">使用历史设置</button></view>
      <view class="row"><text>冠军</text><input type="number" data-k="pointsRules.placement.champion" bindinput="onFieldChange" value="{{pointsRules.placement.champion}}" /></view>
      <view class="row"><text>亚军</text><input type="number" data-k="pointsRules.placement.runnerUp" bindinput="onFieldChange" value="{{pointsRules.placement.runnerUp}}" /></view>
      <view class="row"><text>四强</text><input type="number" data-k="pointsRules.placement.semifinal" bindinput="onFieldChange" value="{{pointsRules.placement.semifinal}}" /></view>
      <view class="row"><text>八强</text><input type="number" data-k="pointsRules.placement.quarterfinal" bindinput="onFieldChange" value="{{pointsRules.placement.quarterfinal}}" /></view>
      <view class="row"><text>参赛</text><input type="number" data-k="pointsRules.placement.participation" bindinput="onFieldChange" value="{{pointsRules.placement.participation}}" /></view>
    </view>
    <view class="card" wx:else>
      <view class="card-head"><text class="card-title">积分（按胜负）</text></view>
      <view class="row"><text>胜场</text><input type="number" data-k="pointsRules.winLoss.win" bindinput="onFieldChange" value="{{pointsRules.winLoss.win}}" /></view>
      <view class="row"><text>负场</text><input type="number" data-k="pointsRules.winLoss.loss" bindinput="onFieldChange" value="{{pointsRules.winLoss.loss}}" /></view>
    </view>
    <view class="card">
      <view class="card-head"><text class="card-title">赛事概览</text></view>
      <view class="row"><text>名称</text><text>{{form.name}}</text></view>
      <view class="row"><text>日期</text><text>{{form.startDate}}</text></view>
      <view class="row"><text>类别</text><text>{{form.type === 'singles' ? '单打' : '双打'}}</text></view>
      <view class="row"><text>参赛人数</text><text>{{selectedPlayers.length}}</text></view>
      <view class="row"><text>球场数</text><text>{{schedulePlanCourts.length}}</text></view>
      <view class="row"><text>赛制</text><text>{{form.format === 'knockout' ? '单淘汰' : '常规赛'}}</text></view>
    </view>
  </view>

  <view class="footer">
    <button class="back" bindtap="onBack">{{step === 1 ? '取消' : '上一步'}}</button>
    <button class="next" bindtap="onNext">{{step < 4 ? '下一步' : '创建赛事'}}</button>
  </view>
</view>
```

- [ ] **Step 14.5 onFieldChange 处理 chip 点击**

```js
// 在 onFieldChange 顶部加：
const v = e.currentTarget.dataset.v
if (v !== undefined) { this.setData({ [`form.${e.currentTarget.dataset.k}`]: v }); return }
```

并支持嵌套 key（`pointsRules.placement.champion`）：

```js
const k = e.currentTarget.dataset.k
const val = v !== undefined ? v : e.detail.value
this.setData({ [k.startsWith('pointsRules.') || k.startsWith('form.') ? k : `form.${k}`]: val })
```

- [ ] **Step 14.6 onAddPlayer / onRemovePlayer**

```js
onAddPlayer() {
  const url = this.data.form.type === 'doubles'
    ? `/pages/tournament-add-players-doubles/index?tournamentId=${this.data.tournamentId}&pickerMode=1`
    : `/pages/tournament-add-player/index?tournamentId=${this.data.tournamentId}&pickerMode=1`
  wx.navigateTo({ url })
},
onRemovePlayer(e) {
  const id = e.currentTarget.dataset.id
  this.setData({ selectedPlayers: this.data.selectedPlayers.filter(p => p.playerId !== id) })
}
```

> 注：让 `tournament-add-player(s)` 在 `pickerMode=1` 时通过 `globalData.lastSelectedPlayers` 回传（或用页面回调），不直接落库。本 Task 复用现有页，只补这段 pickerMode 协议。

- [ ] **Step 14.7 onUseHistory**

```js
async onUseHistory() {
  const r = await wx.cloud.callFunction({
    name: 'tournaments',
    data: { action: 'lastPointsRules', format: this.data.form.format, type: this.data.form.type }
  }).catch(() => null)
  const pr = r?.result?.data?.pointsRules
  if (pr) this.setData({ pointsRules: pr })
  else wx.showToast({ title: '暂无历史', icon: 'none' })
}
```

> `tournaments.lastPointsRules` 是个简单 wrapper：按 `format + type + status='completed'` 倒序拉一条返回其 `pointsRules`。本 Task 在 `cloudfunctions/tournaments/index.js` 加这个 action。

- [ ] **Step 14.8 index.wxss**（步条 + 卡片 + 底部按钮）

```css
.wizard { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-3) 160rpx; }
.step-bar { display: flex; justify-content: space-between; padding: var(--space-2) 0; }
.step { color: var(--color-text-muted); }
.step.active { color: var(--color-primary); font-weight: 600; }
.step-body { display: flex; flex-direction: column; gap: var(--space-3); }
.card { background: var(--color-bg-soft); padding: var(--space-3); border-radius: var(--radius-lg); }
.card-head { display: flex; justify-content: space-between; margin-bottom: var(--space-2); }
.field { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) 0; }
.chip-row { display: flex; gap: var(--space-2); }
.chip { padding: 8rpx 18rpx; border-radius: 999rpx; background: var(--color-bg-soft); border: 1rpx solid var(--color-border); }
.chip.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.row { display: flex; justify-content: space-between; padding: var(--space-1) 0; }
.empty { color: var(--color-text-muted); padding: var(--space-2); }
.footer { position: fixed; bottom: 0; left: 0; right: 0; background: #fff; padding: var(--space-3); display: flex; gap: var(--space-2); border-top: 1rpx solid var(--color-border); }
.footer .back { flex: 1; }
.footer .next { flex: 2; background: var(--color-primary); color: #fff; }
```

- [ ] **Step 14.9 联调一次完整流程**

工具里：登录 admin → tournament-manage → 创建 → 走完 4 步 → 看 `tournaments / tournament_registrations / tournament_brackets / match_results / free_plays` 落库正确。

- [ ] **Step 14.10 commit**

```bash
git add miniprogram/pages/tournament-edit/ miniprogram/utils/bracket-generator.js miniprogram/utils/scheduler-mirror.js cloudfunctions/tournaments/
git commit -m "feat(tournament-edit): 4 步 wizard 重写 · Phase 7 Task 14"
```

---

## Task 15 · `pages/tournament-brackets` 按场地维度重写

**Files:**
- Modify: `miniprogram/pages/tournament-brackets/index.{js,wxml,wxss}`
- Modify: `miniprogram/pages/tournament-view/index.{js,wxml,wxss}`

> 不再用按轮次的旧 UI；首轮按场地分组只读展示；R2+ 用灰色卡列出占位（player1/player2 = null 时显 "—"）。"自动排程"按钮去掉（旧入口走 scheduler-engine，已 deprecated）。"编辑排程"按钮 → 跳回 `tournament-edit?id=...` 续 draft。
>
> **2026-05-14 修订：** 同步改 `tournament-view` 为只读按场地视图，读取 `tournament.schedulePlan.courts/queues` 和 `tournament_brackets`，不得再读取 `courtTimeGrid`。

- [ ] **Step 15.1 index.js**

```js
Page({
  data: { tournamentId: '', tournament: null, schedulePlan: null, r1Matches: [], laterRounds: [], freePlays: [] },

  async onLoad({ id }) {
    this.setData({ tournamentId: id })
    await this.refresh()
  },

  async refresh() {
    const t = (await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'get', id: this.data.tournamentId } })).result?.data?.tournament
    const all = (await wx.cloud.callFunction({ name: 'tournament-brackets', data: { action: 'getByTournament', tournamentId: this.data.tournamentId } })).result?.data?.brackets || []
    const r1 = all.find(b => b.round === 1)
    const later = all.filter(b => b.round > 1).sort((a,b) => a.round - b.round)
    const fp = (await wx.cloud.callFunction({ name: 'free-plays', data: { action: 'list', tournamentId: this.data.tournamentId } })).result?.data?.items || []
    this.setData({
      tournament: t,
      schedulePlan: t?.schedulePlan,
      r1Matches: r1?.matches || [],
      laterRounds: later,
      freePlays: fp
    })
  },

  onEditSchedule() {
    wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}` })
  }
})
```

- [ ] **Step 15.2 index.wxml**（按场地分组 + 灰色后续轮）

```xml
<view wx:if="{{tournament}}" class="brackets">
  <view class="head">
    <text class="title">{{tournament.name}} · 首轮排程</text>
    <button size="mini" bindtap="onEditSchedule" wx:if="{{tournament.status === 'draft' || tournament.status === 'upcoming'}}">编辑排程</button>
  </view>

  <view wx:for="{{schedulePlan.courts}}" wx:for-item="court" wx:key="courtId" class="court-block">
    <text class="court-title">{{court.name}}</text>
    <view wx:for="{{r1Matches}}" wx:for-item="m" wx:key="matchId" wx:if="{{m.courtId === court.courtId}}" class="match-row">
      <text>{{m.player1.name}} VS {{m.player2.name}}</text>
      <text class="status-chip {{m.resultStatus}}">{{m.bye ? '轮空' : m.resultStatus}}</text>
    </view>
    <view wx:for="{{freePlays}}" wx:for-item="fp" wx:key="_id" wx:if="{{fp.courtId === court.courtId}}" class="match-row freeplay">
      <text>自由拉球</text>
    </view>
  </view>

  <view wx:for="{{laterRounds}}" wx:for-item="b" wx:key="_id" class="later-block">
    <text class="later-title">第 {{b.round}} 轮（待半决/决赛安排）</text>
    <view wx:for="{{b.matches}}" wx:for-item="m" wx:key="matchId" class="match-row gray">
      <text>{{m.player1 ? m.player1.name : '—'}} VS {{m.player2 ? m.player2.name : '—'}}</text>
    </view>
  </view>
</view>
```

- [ ] **Step 15.3 index.wxss** 复用 schedule-board 的同主题样式即可，新增 `.gray { opacity: 0.5; }` 和 `.status-chip` 样式。

- [ ] **Step 15.4 commit**

```bash
git add miniprogram/pages/tournament-brackets/
git commit -m "feat(tournament-brackets): 按场地维度重写 · Phase 7 Task 15"
```

---

## Task 16 · `tournament-detail` / `tournament-manage` 微改：draft 入口

**Files:**
- Modify: `miniprogram/pages/tournament-manage/index.js`
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-detail/index.wxml`

> **2026-05-14 修订：** 此 Task 依赖 Task 2 已写 `tournaments.createdBy`。如果云函数仍未支持 `createdBy/statusNot/listByIds`，不得只在前端过滤；必须先补云函数过滤，否则 draft 会泄漏到非创建者列表。

- [ ] **Step 16.1 tournament-manage list 过滤 draft（除非是创建者本人）**

```js
// 假设 listMyDrafts 拉 status='draft' 且 createdBy === currentMember._id
// 公开列表只显示非 draft：
async loadList() {
  const my = await this.fetchMyDrafts()
  const pub = await this.fetchPublic()
  this.setData({ drafts: my, list: pub })
},
async fetchMyDrafts() {
  const me = getApp().globalData.currentMember
  if (!me) return []
  const r = await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'list', status: 'draft', createdBy: me._id } })
  return r.result?.data?.tournaments || []
},
async fetchPublic() {
  const r = await wx.cloud.callFunction({ name: 'tournaments', data: { action: 'list', statusNot: 'draft' } })
  return r.result?.data?.tournaments || []
}
```

> `tournaments` 云函数 list action 支持 `status / statusNot / createdBy` 过滤；本 Task 视情况补该过滤逻辑。

- [ ] **Step 16.2 tournament-manage wxml 加 "我的草稿" 区块**

```xml
<view wx:if="{{drafts.length > 0}}" class="drafts-block">
  <text class="text-label">我的草稿</text>
  <view wx:for="{{drafts}}" wx:key="_id" class="draft-row" bindtap="onResumeDraft" data-id="{{item._id}}">
    <text>{{item.name || '未命名'}}</text>
    <text class="text-meta">{{item.startDate}}</text>
  </view>
</view>
```

```js
onResumeDraft(e) { wx.navigateTo({ url: `/pages/tournament-edit/index?id=${e.currentTarget.dataset.id}` }) }
```

- [ ] **Step 16.3 tournament-detail：编辑按钮**

```xml
<button wx:if="{{tournament.status === 'draft'}}" bindtap="onResumeDraft">继续创建</button>
<button wx:elif="{{tournament.status === 'upcoming' && isAdmin}}" bindtap="onEditTournament">编辑</button>
```

```js
onResumeDraft() { wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournament._id}` }) },
onEditTournament() { wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournament._id}` }) }
```

- [ ] **Step 16.4 home / rank / my-match draft 过滤**

`home / rank / my-match` 拉 `tournaments` 时全部加 `statusNot='draft'`（或前端 `.filter(t => t.status !== 'draft')`，二选一）。改最少代码量的入口。

- [ ] **Step 16.5 commit**

```bash
git add miniprogram/pages/tournament-manage/ miniprogram/pages/tournament-detail/ miniprogram/pages/home/ miniprogram/pages/rank/ miniprogram/pages/my-match/ cloudfunctions/tournaments/
git commit -m "feat(draft): 仅创建者可见草稿入口 · Phase 7 Task 16"
```

---

## Task 17 · 更新 PROGRESS.md

**Files:**
- Modify: `docs/superpowers/plans/PROGRESS.md`

- [ ] **Step 17.1 改总进度条 + Phase 状态表**

```diff
- [████████████████░░░░░░░░] 4/6 Phase 完成
+ [████████████████████░░░░] 5/6 Phase 完成
```

新增 Phase 7 行（如果旧表里没有就追加，老 5/6 行不动）：

```
| 07 | Phase 7 · Create+Schedule | ✅ 已完成 | 2026-05-13 | YYYY-MM-DD | <hash> | 4 步 wizard / 30min court-grid / schedule-board / generator + scheduler 迁入 brackets，scheduler-engine 标 @deprecated；旧 Phase 5/6 暂置后 |
```

「当前应该做什么」改：

```
**👉 下一个 Phase**：`08-phase-8-score-engine.md`
```

- [ ] **Step 17.2 执行日志追加节**（按 plan 03 模式）

```md
### YYYY-MM-DD · Phase 7 完成
- tournaments：draft 模型 / schedulePlan / pointsRules 双子树
- tournament-registrations.bulkSet
- tournament-brackets 加 generator（BYE 推进） / scheduler（顺序填满） + saveInitialMatches / saveSchedule / regenerateDraft
- free-plays 云函数 + 集合
- match-results.bulkUpsertScheduledMatches
- scheduler-engine 标 @deprecated（保留 44 单测）
- court-grid 重写 30min 颗粒度
- schedule-board / player-picker-sheet 新建
- tournament-edit 4 步 wizard 重写
- tournament-brackets 按场地维度展示
- draft 仅创建者可见
- 已知遗留：
  - 前端 utils/bracket-generator.js + utils/scheduler-mirror.js 与云函数 lib 是手动复制，未接入 sync 脚本（Phase 8 补 sync-shared-libs.sh 时把它们也纳入）
  - tournament-add-player(s) 的 pickerMode 协议是简化版（globalData 回传），后续可改为页面 events
  - `tournaments.list` 的 `status / statusNot / createdBy` 过滤参数若未实现，需要在 Phase 8 起步前补齐
```

- [ ] **Step 17.3 跨对话决策档案补充**

```md
- 排程算法第一版采用「顺序填满场地」（court[0] 满了到 court[1]），不做轮询。理由：Phase 7 spec 拍板。
- BYE 第一版不做智能分散，只测 BYE 数 + 自动推进 + 无空 winner（spec §8 / §9.2 一致）。
- scheduler-engine 不删，标 @deprecated；pairing 迁到 tournament-brackets/lib/pairing。
- 前端 utils/bracket-generator.js 与云函数 lib/generator.js 是 vendored 副本，Phase 8 sync-shared-libs.sh 同步比对。
```

- [ ] **Step 17.4 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 7 完成 · Task 17"
```

---

## Self-Review Checklist

完成所有 Task 后，按顺序核对：

- [ ] `scripts/cleanup-test-data.js` 仅在本地双重确认后跑过一次（不是 CI）
- [ ] `cloudfunctions/tournaments` jest 全过；新增 `validateSchedulePlan / validatePointsRules` 单测覆盖率 100%
- [ ] `cloudfunctions/tournament-brackets` jest 全过；`generator.js / scheduler.js` 行覆盖 ≥ 95%；`pairing/*` 与旧覆盖率一致
- [ ] `cloudfunctions/scheduler-engine` 44 单测仍全过（无回归）
- [ ] 创建一个 6 人 single 单淘汰赛：
  - bracket 落库后 R1 有 4 场（2 BYE walkover 自动推进到 R2）、R2 + R3 占位行存在
  - `match_results` 落库 6 行（2 BYE 行 `resultStatus='confirmed'`、`courtId=null`；4 非 BYE 行 `resultStatus='pending'` + `courtId/queueOrder`）
- [ ] 创建一个 5 人 regular 常规赛：
  - R1 有 2 场，1 人轮空（不在 matches 内）
  - 在 step 3 加一个「+ 自由拉球」+ 一个「+ 添加场次」，落库后 `free_plays` / `match_results.matchKind='extra'` 各 1 条
- [ ] 回退 step 2 改选手：弹警告 → 确认后 `tournament_brackets / match_results / free_plays` 该 tournament 数据全清空 → 回 step 3 重新随机
- [ ] `home / rank / my-match` 列表无 draft 赛事；创建者本人在 `tournament-manage` 顶部能看到自己的 draft
- [ ] `tournament-brackets` 页面按场地分组展示首轮 + 灰色后续轮占位
- [ ] PROGRESS.md 更新到位

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/07-phase-7-create-schedule.md`. Two execution options:

**1. Subagent-Driven (recommended)** - 派 fresh subagent 跑 Task 1–10（云函数+测试，独立度高），主上下文 review；Task 11–16 前端组件建议串行盯一手 UI；Task 17 自己写。

**2. Inline Execution** — 在当前会话里按 checkbox 顺序推进，checkpoint 在 Task 6 / Task 9 / Task 14 末尾。

Which approach?
