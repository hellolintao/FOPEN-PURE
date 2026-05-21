# WeChat Tournament Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WeChat-shareable tournament registration, member self-registration/withdrawal, post-deadline scheduling, and role-aware tournament detail states without visually rebuilding the existing pages.

**Architecture:** Keep the current mini program surfaces: `tournament-edit` remains the 3-step wizard, `tournament-detail` remains the single member/admin detail page, and list/workbench pages keep their existing card structure. Add a shared phase helper, explicit registration/schedule cloud actions, and small page decorators so legacy tournaments still follow the old status path while new tournaments use the phase model.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JS, Tencent Cloud Functions, cloud database transactions, Jest unit tests.

**Rollback boundaries:** Each task commits as an independent revert unit. Safe rollback groups:

- Task 0 (docs only) — always reversible.
- Task 1 (shared helpers) — can be reverted before Task 2-4 ship; reverting after Tasks 2-4 breaks them.
- Task 2-4 (cloud actions, registrations service, schedule gates) — should be reverted together; partial revert leaves backend in inconsistent state.
- Task 5-7 (frontend wizard / detail / list) — can be reverted together without touching backend.
- Task 8 (score gates + edit-schedule modal) — independent from Task 5-7 once Task 4 is in place.
- Task 9 (verification only) — reverting only drops screenshots.

---

## Resolved Spec Notes

- Section 7.3 still contains one stale line saying `tournament_registrations.status` becomes `cancelled`; implement Section 11.2 instead: update `registrationStatus` to `withdrew`, keep old `status` read-only, and never write `cancelled`.
- Registration sharing has two separate actions: publish data first, then open the WeChat share path. A failed publish must not open the share panel.
- Schedule status has higher priority than registration dates. Once `scheduleStatus` is `draft` or `published`, editing `registrationDeadlineAt` cannot move the detail page back into registration mode.
- Existing page structure and class systems are constraints. New WXML should use current blocks such as `step-bar`, `card`, `field`, `td-hero`, `td-section`, `td-footer`, `match-card`, `block`, and `mm-block`; WXSS additions must be local modifiers.

## File Structure

- Create `cloudfunctions/_shared/tournament-phase.js`: pure backend phase/date helper used by cloud functions.
- Create `cloudfunctions/_shared/__tests__/tournament-phase.test.js`: canonical phase and withdrawal deadline tests.
- Create `miniprogram/utils/tournament-phase.js`: frontend copy of the same pure helper for page decoration.
- Create `miniprogram/utils/__tests__/tournament-phase.test.js`: frontend helper parity tests.
- Modify `miniprogram/utils/tournament-status.js`: keep old status metadata for legacy tournaments and delegate new phase-aware labels.
- Modify `cloudfunctions/DATABASE_SCHEMA.md`: document new tournament and registration fields plus legacy fallback.
- Create `cloudfunctions/tournaments/lib/handlers/registration-phase.js`: pure handlers for publish registration, save draft, publish schedule, and clear revision flags.
- Create `cloudfunctions/tournaments/lib/__tests__/registration-phase.test.js`: handler tests with dependency-injected database calls.
- Modify `cloudfunctions/tournaments/index.js`: route new actions to the handler.
- Create `cloudfunctions/tournament-registrations/lib/service.js`: pure self-registration and withdrawal service with capacity, identity, count, and revision handling.
- Create `cloudfunctions/tournament-registrations/__tests__/self-service.test.js`: service tests.
- Modify `cloudfunctions/tournament-registrations/index.js`: route `selfRegister`, `withdraw`, and update list/stats filters to `registrationStatus`.
- Modify `cloudfunctions/tournament-registrations/package.json`: add a Jest script/dev dependency so the existing tests are runnable.
- Modify `cloudfunctions/tournament-brackets/index.js`: support draft/published schedule states and `needsRevision` match markers.
- Create `cloudfunctions/tournament-brackets/__tests__/schedule-revision.test.js`: regression tests for schedule publishing and revision flags.
- Modify `cloudfunctions/match-results/lib/handlers/query.js` and `cloudfunctions/match-results/index.js`: keep score rows hidden until `scheduleStatus === 'published'`.
- Modify `miniprogram/pages/tournament-edit/index.{js,wxml,wxss}` and `__tests__/index.test.js`: add registration deadline, publish/share actions, direct scheduling path, and schedule publish.
- Modify `miniprogram/pages/tournament-detail/index.{js,wxml,wxss}` and `__tests__/index.test.js`: add phase/role display, member registration/withdrawal, admin actions, schedule/results modes.
- Modify `miniprogram/pages/match/index.{js,wxml,wxss}` and `__tests__/index.test.js`: decorate list labels for registration and schedule phases.
- Modify `cloudfunctions/tournaments/lib/handlers/admin-console.js` and tests: include registration, pending schedule, draft schedule, and revision tasks.
- Modify `miniprogram/pages/tournament-manage/index.{js,wxml,wxss}`: render the new admin task groups in existing `block` rows.
- Modify `cloudfunctions/match-results/lib/handlers/my-summary.js`, tests, and `miniprogram/pages/my-match/index.{js,wxml,wxss}`: add "我的报名" states and withdrawal deadline text.
- Modify `miniprogram/pages/tournament-brackets/index.js` and `miniprogram/pages/tournament-score/index.js`: add unpublished-schedule gates.
- Modify `miniprogram/pages/edit-profile/index.js` and tests: return to tournament detail after registration identity completion.

### Task 0: Schema And Baseline Guardrails

**Files:**
- Modify: `cloudfunctions/DATABASE_SCHEMA.md`
- Modify: `docs/superpowers/specs/2026-05-21-wechat-tournament-registration-design.md` only if the stale Section 7.3 line is still present when execution starts.

- [ ] **Step 1: Record current worktree state**

Run: `git status --short`

Expected: existing unrelated modified files may be present. Do not stage or revert unrelated files.

- [ ] **Step 2: Update tournament schema documentation**

In `cloudfunctions/DATABASE_SCHEMA.md`, extend the `tournaments` field table with these rows:

```markdown
| `registrationDeadlineAt` | Date/String | 报名发布后必填 | 微信报名截止时间；报名发布时必须晚于当前时间 |
| `registrationPublishedAt` | Date/String | 否 | 报名入口发布时间；存在时进入新阶段模型 |
| `scheduleStatus` | String | 新流程必填 | `none` / `draft` / `published`；缺失时按遗留赛事展示 |
| `schedulePublishedAt` | Date/String | 否 | 赛程发布时间 |
| `scheduleNeedsRevision` | Boolean | 否 | 成员退赛或赛程编辑导致管理员需确认，缺省为 `false` |
| `confirmedCount` | Number | 否 | `registrationStatus === "confirmed"` 的计数，用于淘汰赛单打容量事务和工作台软警告 |
```

Expected: the schema doc explains that `courtTimeGrid` remains historical read-only compatibility and new code writes `schedulePlan`.

- [ ] **Step 3: Update registration schema documentation**

In the `tournament_registrations` section, document these rows:

```markdown
| `registrationStatus` | String | 是 | `confirmed` / `withdrew`；新代码统一读写此字段 |
| `status` | String | 否 | 旧字段，保留兼容只读，新代码不写 |
| `source` | String | 否 | `admin` / `wechat` |
| `cancelledAt` | Date | 否 | 自助退赛或管理员代退时间 |
| `cancelledBy` | String | 否 | 操作者 `members._id` |
| `cancelReason` | String | 否 | 退赛原因，本期可空 |
| `reregisteredAt` | Date | 否 | 退赛后重新报名时间 |
```

Expected: the doc explicitly says cancelled rows are not physically deleted.

- [ ] **Step 4: Verify the spec does not reintroduce the cancelled wording**

Run:

```bash
grep -nE "status\\s*置为\\s*\`?cancelled\`?|status:\\s*'cancelled'" docs/superpowers/specs/2026-05-21-wechat-tournament-registration-design.md || echo "OK: spec aligned"
```

Expected: prints `OK: spec aligned` (the previous edit pass already replaced the `cancelled` wording with `registrationStatus = 'withdrew'`).

If the grep finds a match, replace that line with:

```markdown
- `tournament_registrations.registrationStatus` 置为 `withdrew`。
```

Expected: the spec no longer contradicts Section 11.2.

- [ ] **Step 5: Commit schema/spec alignment**

Run:

```bash
git add cloudfunctions/DATABASE_SCHEMA.md docs/superpowers/specs/2026-05-21-wechat-tournament-registration-design.md
git commit -m "docs: align tournament registration schema"
```

Expected: commit succeeds. If the spec file contains user edits beyond the stale line, review `git diff --cached` and include only intended documentation changes.

### Task 1: Shared Phase And Deadline Helpers

**Files:**
- Create: `cloudfunctions/_shared/tournament-phase.js`
- Create: `cloudfunctions/_shared/__tests__/tournament-phase.test.js`
- Create: `miniprogram/utils/tournament-phase.js`
- Create: `miniprogram/utils/__tests__/tournament-phase.test.js`
- Modify: `miniprogram/utils/tournament-status.js`
- Modify: `miniprogram/utils/__tests__/tournament-status.test.js`

- [ ] **Step 1: Write backend phase tests**

Create `cloudfunctions/_shared/__tests__/tournament-phase.test.js`:

```js
const {
  PHASE,
  derivePhase,
  getWithdrawDeadline,
  canRegister,
  canWithdraw,
  isActiveRegistration
} = require('../tournament-phase')

describe('derivePhase', () => {
  test('legacy tournament keeps old status path', () => {
    expect(derivePhase({ status: 'upcoming' }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.LEGACY)
  })

  test('registration open when published and deadline is in the future', () => {
    expect(derivePhase({
      status: 'draft',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.REGISTRATION_OPEN)
  })

  test('pending schedule after registration deadline', () => {
    expect(derivePhase({
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.PENDING_SCHEDULE)
  })

  test('schedule draft outranks future registration deadline', () => {
    expect(derivePhase({
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'draft'
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.SCHEDULE_DRAFT)
  })

  test('published schedule with all results confirmed becomes results phase', () => {
    expect(derivePhase({
      scheduleStatus: 'published',
      resultSummary: { playableCount: 2, confirmedCount: 2 }
    }, { now: '2026-05-21T12:00:00+08:00' })).toBe(PHASE.RESULTS)
  })
})

describe('withdraw deadline', () => {
  test('May 24 match is withdrawable before May 24 00:00 local time', () => {
    const tournament = { startDate: '2026-05-24' }
    expect(getWithdrawDeadline(tournament).label).toBe('5月23日 24:00')
    expect(canWithdraw(tournament, { now: '2026-05-23T23:59:59+08:00' })).toBe(true)
    expect(canWithdraw(tournament, { now: '2026-05-24T00:00:00+08:00' })).toBe(false)
  })
})

describe('registration guards', () => {
  test('regular tournament has no hard capacity', () => {
    expect(canRegister({
      format: 'regular',
      type: 'singles',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00', confirmedCount: 999 })).toEqual({ ok: true })
  })

  test('knockout singles is blocked at maxPlayers', () => {
    expect(canRegister({
      format: 'knockout',
      type: 'singles',
      maxPlayers: 8,
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }, { now: '2026-05-21T12:00:00+08:00', confirmedCount: 8 })).toEqual({ ok: false, code: 'CAPACITY_FULL' })
  })

  test('withdrew is inactive and confirmed is active', () => {
    expect(isActiveRegistration({ registrationStatus: 'confirmed' })).toBe(true)
    expect(isActiveRegistration({ registrationStatus: 'withdrew' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run backend phase tests and verify failure**

Run: `cd cloudfunctions/_shared && npm test -- __tests__/tournament-phase.test.js --runInBand`

Expected: fail because `tournament-phase.js` does not exist.

- [ ] **Step 3: Implement backend helper**

Create `cloudfunctions/_shared/tournament-phase.js` with these exports and semantics:

```js
const PHASE = {
  DRAFT: 'draft',
  REGISTRATION_OPEN: 'registration_open',
  PENDING_SCHEDULE: 'pending_schedule',
  SCHEDULE_DRAFT: 'schedule_draft',
  SCHEDULE_PUBLISHED: 'schedule_published',
  RESULTS: 'results',
  LEGACY: 'legacy'
}

function derivePhase(tournament = {}, options = {}) {
  if (tournament.status === 'draft' && !tournament.registrationPublishedAt && !tournament.scheduleStatus) return PHASE.DRAFT
  if (tournament.scheduleStatus === 'published' && hasSettledResults(tournament, options)) return PHASE.RESULTS
  if (tournament.status === 'completed' || tournament.status === 'settled') return PHASE.RESULTS
  if (tournament.scheduleStatus === 'published') return PHASE.SCHEDULE_PUBLISHED
  if (tournament.scheduleStatus === 'draft') return PHASE.SCHEDULE_DRAFT
  if (tournament.registrationPublishedAt && tournament.registrationDeadlineAt) {
    return toTime(options.now || new Date()) < toTime(tournament.registrationDeadlineAt)
      ? PHASE.REGISTRATION_OPEN
      : PHASE.PENDING_SCHEDULE
  }
  if (tournament.status === 'draft') return PHASE.DRAFT
  return PHASE.LEGACY
}

function hasSettledResults(tournament = {}, options = {}) {
  const summary = options.resultSummary || tournament.resultSummary || {}
  const playable = Number(summary.playableCount || summary.totalPlayable || summary.total || 0)
  const confirmed = Number(summary.confirmedCount || summary.confirmed || 0)
  return playable > 0 && confirmed >= playable
}

function getWithdrawDeadline(tournament = {}) {
  const date = String(tournament.startDate || '').slice(0, 10)
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!parts) return { timestamp: NaN, label: '' }
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const timestamp = new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
  const previous = new Date(timestamp - 24 * 60 * 60 * 1000)
  return { timestamp, label: `${previous.getMonth() + 1}月${previous.getDate()}日 24:00` }
}

function canWithdraw(tournament, options = {}) {
  const deadline = getWithdrawDeadline(tournament)
  if (!Number.isFinite(deadline.timestamp)) return false
  return toTime(options.now || new Date()) < deadline.timestamp
}

function canRegister(tournament = {}, options = {}) {
  if (derivePhase(tournament, options) !== PHASE.REGISTRATION_OPEN) return { ok: false, code: 'REGISTRATION_CLOSED' }
  if (tournament.format === 'knockout' && tournament.type === 'singles') {
    const max = Number(tournament.maxPlayers || 0)
    const confirmed = Number(options.confirmedCount === undefined ? tournament.confirmedCount : options.confirmedCount)
    if (max > 0 && confirmed >= max) return { ok: false, code: 'CAPACITY_FULL' }
  }
  if (tournament.format === 'knockout' && tournament.type === 'doubles') return { ok: false, code: 'SELF_REGISTRATION_UNSUPPORTED' }
  return { ok: true }
}

function isActiveRegistration(registration = {}) {
  const status = registration.registrationStatus || registration.status || 'confirmed'
  return status !== 'withdrew' && status !== 'cancelled'
}

function toTime(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return new Date(value).getTime()
}

module.exports = {
  PHASE,
  derivePhase,
  getWithdrawDeadline,
  canWithdraw,
  canRegister,
  isActiveRegistration
}
```

Expected: helper uses local midnight for `YYYY-MM-DD` withdrawal deadlines and treats legacy tournaments as `legacy`.

- [ ] **Step 4: Copy helper to frontend and add parity tests**

Create `miniprogram/utils/tournament-phase.js` with the same pure helper code. Prepend a sync header to BOTH files so future edits are forced to mirror:

```js
// SOURCE OF TRUTH: cloudfunctions/_shared/tournament-phase.js
// MIRROR:          miniprogram/utils/tournament-phase.js
// Any edit must be applied to both files in the same commit; CI parity check
// (`scripts/check-tournament-phase-parity.sh`) diffs them and fails on drift.
```

Create `scripts/check-tournament-phase-parity.sh`:

```bash
#!/usr/bin/env bash
set -e
diff -u cloudfunctions/_shared/tournament-phase.js miniprogram/utils/tournament-phase.js \
  || { echo "tournament-phase.js drift detected"; exit 1; }
```

Mark it executable (`chmod +x`) and reference it from the existing test entry script (or document the manual run in `cloudfunctions/_shared/__tests__/tournament-phase.test.js` as a `beforeAll` invocation via `child_process.execSync` if there is no shared CI).

Create `miniprogram/utils/__tests__/tournament-phase.test.js` by requiring `../tournament-phase` and covering the same five phase cases plus the May 24 withdrawal case.

Run:

```bash
bash scripts/check-tournament-phase-parity.sh
cd miniprogram && npm test -- utils/__tests__/tournament-phase.test.js --runInBand
```

Expected: parity check exits 0; frontend helper tests pass.

- [ ] **Step 5: Extend status decoration without breaking legacy**

In `miniprogram/utils/tournament-status.js`, import `derivePhase` and map new phases to labels:

```js
const { PHASE, derivePhase } = require('./tournament-phase')

const PHASE_META = {
  [PHASE.REGISTRATION_OPEN]: { kind: 'registration', label: '报名中', hint: '可报名', scoreActionLabel: '我要报名', canShare: true },
  [PHASE.PENDING_SCHEDULE]: { kind: 'pendingSchedule', label: '待排程', hint: '报名已截止', scoreActionLabel: '等待赛程', canShare: true },
  [PHASE.SCHEDULE_DRAFT]: { kind: 'scheduleDraft', label: '赛程待发布', hint: '草稿仅管理员可见', scoreActionLabel: '发布赛程', canShare: true },
  [PHASE.SCHEDULE_PUBLISHED]: { kind: 'upcoming', label: '赛程已发布', hint: '可录分', scoreActionLabel: '录入成绩', canShare: true },
  [PHASE.RESULTS]: { kind: 'settled', label: '已结算', hint: '比分已确认并结算', scoreActionLabel: '查看成绩', canShare: true }
}
```

Update `getTournamentStatusMeta` so `PHASE.LEGACY` continues through the existing `STATUS_META` and date-window logic.

Run: `cd miniprogram && npm test -- utils/__tests__/tournament-status.test.js --runInBand`

Expected: existing status tests pass and new phase label tests pass.

- [ ] **Step 6: Commit helper work**

Run:

```bash
git add cloudfunctions/_shared/tournament-phase.js cloudfunctions/_shared/__tests__/tournament-phase.test.js miniprogram/utils/tournament-phase.js miniprogram/utils/__tests__/tournament-phase.test.js miniprogram/utils/tournament-status.js miniprogram/utils/__tests__/tournament-status.test.js
git commit -m "feat: add tournament phase helpers"
```

Expected: only helper and status files are staged.

### Task 2: Tournament Publish And Schedule State Actions

**Files:**
- Create: `cloudfunctions/tournaments/lib/handlers/registration-phase.js`
- Create: `cloudfunctions/tournaments/lib/__tests__/registration-phase.test.js`
- Modify: `cloudfunctions/tournaments/index.js`
- Modify: `cloudfunctions/tournaments/lib/validate.js`
- Modify: `cloudfunctions/tournaments/lib/__tests__/validate.test.js`

- [ ] **Step 1: Write handler tests**

Create `cloudfunctions/tournaments/lib/__tests__/registration-phase.test.js` with dependency-injected context tests:

```js
const {
  publishRegistration,
  saveScheduleDraft,
  publishSchedule,
  confirmScheduleRevision
} = require('../handlers/registration-phase')

function makeCtx(tournament = {}) {
  const updates = []
  return {
    now: () => '2026-05-21T12:00:00.000Z',
    isAdmin: true,
    db: {
      getTournament: jest.fn().mockResolvedValue({ _id: 't1', startDate: '2026-05-25', ...tournament }),
      countConfirmedRegistrations: jest.fn().mockResolvedValue(3),
      updateTournament: jest.fn(async (id, data) => { updates.push({ id, data }) })
    },
    updates
  }
}

test('publishRegistration writes deadline, published timestamp, none schedule status and confirmedCount', async () => {
  const ctx = makeCtx()
  const res = await publishRegistration(ctx, {
    id: 't1',
    registrationDeadlineAt: '2026-05-24T18:00:00+08:00'
  })
  expect(res).toEqual({ success: true, data: { id: 't1', confirmedCount: 3 } })
  expect(ctx.updates[0]).toMatchObject({
    id: 't1',
    data: {
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      registrationPublishedAt: '2026-05-21T12:00:00.000Z',
      scheduleStatus: 'none',
      scheduleNeedsRevision: false,
      confirmedCount: 3
    }
  })
})

test('publishRegistration rejects past deadline before opening share', async () => {
  const ctx = makeCtx()
  const res = await publishRegistration(ctx, {
    id: 't1',
    registrationDeadlineAt: '2026-05-20T18:00:00+08:00'
  })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('INVALID_DEADLINE')
  expect(ctx.db.updateTournament).not.toHaveBeenCalled()
})

test('saveScheduleDraft writes draft status and keeps schedule hidden from members', async () => {
  const ctx = makeCtx()
  const res = await saveScheduleDraft(ctx, { id: 't1', schedulePlan: { courts: [] } })
  expect(res.success).toBe(true)
  expect(ctx.updates[0].data).toMatchObject({ scheduleStatus: 'draft' })
})

test('publishSchedule writes published status, clears revision signal, and generates member score rows', async () => {
  const ctx = makeCtx({ scheduleNeedsRevision: true, schedulePlan: { courts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }] } })
  ctx.db.bulkUpsertScheduledMatches = jest.fn().mockResolvedValue({ success: true, data: { count: 4 } })
  const res = await publishSchedule(ctx, { id: 't1' })
  expect(res.success).toBe(true)
  expect(ctx.updates[0].data).toMatchObject({
    scheduleStatus: 'published',
    schedulePublishedAt: '2026-05-21T12:00:00.000Z',
    status: 'upcoming',
    scheduleNeedsRevision: false
  })
  expect(ctx.db.bulkUpsertScheduledMatches).toHaveBeenCalledWith('t1', expect.any(Object))
})

test('confirmScheduleRevision clears the flag only for admins', async () => {
  const ctx = makeCtx({ scheduleNeedsRevision: true })
  const res = await confirmScheduleRevision(ctx, { id: 't1' })
  expect(res.success).toBe(true)
  expect(ctx.updates[0].data).toMatchObject({ scheduleNeedsRevision: false })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd cloudfunctions/tournaments && npm test -- lib/__tests__/registration-phase.test.js --runInBand`

Expected: fail because the handler module does not exist.

- [ ] **Step 3: Implement pure handler module**

Create `cloudfunctions/tournaments/lib/handlers/registration-phase.js` with handlers returning the same envelope shape as existing new actions:

```js
function ok(data) { return { success: true, data } }
function fail(code, message) { return { success: false, error: { code, message } } }

async function publishRegistration(ctx, event) {
  if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
  const id = event.id || event.tournamentId
  if (!id) return fail('MISSING_ID', 'id 不能为空')
  const deadline = event.registrationDeadlineAt
  if (!deadline) return fail('INVALID_DEADLINE', '报名截止不能为空')
  if (new Date(deadline).getTime() <= new Date(ctx.now()).getTime()) {
    return fail('INVALID_DEADLINE', '报名截止必须晚于当前时间')
  }
  const tournament = await ctx.db.getTournament(id)
  if (!tournament) return fail('NOT_FOUND', '赛事不存在')
  const confirmedCount = await ctx.db.countConfirmedRegistrations(id)
  await ctx.db.updateTournament(id, {
    registrationDeadlineAt: deadline,
    registrationPublishedAt: ctx.now(),
    scheduleStatus: 'none',
    schedulePublishedAt: null,
    scheduleNeedsRevision: false,
    confirmedCount,
    updateTime: ctx.serverDate ? ctx.serverDate() : ctx.now()
  })
  return ok({ id, confirmedCount })
}

async function saveScheduleDraft(ctx, event) {
  if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
  const id = event.id || event.tournamentId
  if (!id) return fail('MISSING_ID', 'id 不能为空')
  await ctx.db.updateTournament(id, {
    scheduleStatus: 'draft',
    schedulePlan: event.schedulePlan,
    updateTime: ctx.serverDate ? ctx.serverDate() : ctx.now()
  })
  return ok({ id })
}

async function publishSchedule(ctx, event) {
  if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
  const id = event.id || event.tournamentId
  if (!id) return fail('MISSING_ID', 'id 不能为空')
  const tournament = await ctx.db.getTournament(id)
  if (!tournament) return fail('NOT_FOUND', '赛事不存在')
  if (!tournament.schedulePlan || !Array.isArray(tournament.schedulePlan.courts) || tournament.schedulePlan.courts.length === 0) {
    return fail('EMPTY_SCHEDULE', '排程为空，请先在第 3 步排好场次')
  }
  // Generate member-visible match_results rows; spec §11.3 forbids exposing rows before publish.
  const bulk = await ctx.db.bulkUpsertScheduledMatches(id, tournament.schedulePlan)
  if (!bulk || bulk.success === false) {
    return fail('BULK_UPSERT_FAILED', (bulk && bulk.error && bulk.error.message) || '生成录分行失败')
  }
  await ctx.db.updateTournament(id, {
    scheduleStatus: 'published',
    schedulePublishedAt: ctx.now(),
    status: 'upcoming',
    scheduleNeedsRevision: false,
    updateTime: ctx.serverDate ? ctx.serverDate() : ctx.now()
  })
  return ok({ id })
}

async function confirmScheduleRevision(ctx, event) {
  if (!ctx.isAdmin) return fail('FORBIDDEN', '需要管理员权限')
  const id = event.id || event.tournamentId
  if (!id) return fail('MISSING_ID', 'id 不能为空')
  await ctx.db.updateTournament(id, {
    scheduleNeedsRevision: false,
    updateTime: ctx.serverDate ? ctx.serverDate() : ctx.now()
  })
  return ok({ id })
}

module.exports = {
  publishRegistration,
  saveScheduleDraft,
  publishSchedule,
  confirmScheduleRevision
}
```

- [ ] **Step 4: Wire cloud actions in `cloudfunctions/tournaments/index.js`**

Add a context builder near the existing action switch:

```js
function buildRegistrationPhaseCtx(member) {
  return {
    isAdmin: isAdminMember(member),
    now: () => new Date().toISOString(),
    serverDate: () => db.serverDate(),
    db: {
      getTournament: async id => {
        const res = await collection.doc(id).get().catch(() => null)
        return res && res.data
      },
      countConfirmedRegistrations: async tournamentId => {
        const res = await db.collection('tournament_registrations')
          .where({ tournamentId, registrationStatus: 'confirmed' })
          .count()
        return res.total || 0
      },
      updateTournament: async (id, data) => collection.doc(id).update({ data }),
      bulkUpsertScheduledMatches: async (tournamentId, schedulePlan) => {
        // Reuse the existing match-results cloud action so publishSchedule
        // generates the same rows as commitStep3() did historically.
        return cloud.callFunction({
          name: 'match-results',
          data: { action: 'bulkUpsertScheduledMatches', tournamentId, schedulePlan }
        }).then(r => r.result)
      }
    }
  }
}
```

In the switch, add actions:

```js
case 'publishRegistration':
case 'saveScheduleDraft':
case 'publishSchedule':
case 'confirmScheduleRevision': {
  const wxContext = cloud.getWXContext()
  const member = await resolveMemberByOpenid(wxContext.OPENID || null)
  if (!member) return fail('FORBIDDEN', '成员不存在')
  const handlers = require('./lib/handlers/registration-phase')
  return handlers[action](buildRegistrationPhaseCtx(member), event)
}
```

Expected: non-admin users receive `FORBIDDEN`; admin actions use existing envelope shape.

- [ ] **Step 5: Extend validation for new fields**

In `cloudfunctions/tournaments/lib/validate.js`:

- Allow `scheduleStatus` values `none`, `draft`, `published`.
- Allow `scheduleNeedsRevision` boolean.
- Preserve the current `schedulePlan` validation when non-draft tournaments publish a schedule.
- Re-verify that the existing `format === 'knockout' && type === 'mixed'` rejection remains in place (spec §3 / §6.1). If absent, add it:

  ```js
  if (data.format === 'knockout' && data.type === 'mixed') {
    errors.push('淘汰赛 mixed 暂不支持')
  }
  ```

Add a validate test that explicitly asserts the rejection so future refactors do not silently re-enable it.

Run: `cd cloudfunctions/tournaments && npm test -- lib/__tests__/validate.test.js lib/__tests__/registration-phase.test.js --runInBand`

Expected: validation tests and new handler tests pass.

- [ ] **Step 6: Commit tournament cloud actions**

Run:

```bash
git add cloudfunctions/tournaments/index.js cloudfunctions/tournaments/lib/validate.js cloudfunctions/tournaments/lib/handlers/registration-phase.js cloudfunctions/tournaments/lib/__tests__/registration-phase.test.js cloudfunctions/tournaments/lib/__tests__/validate.test.js
git commit -m "feat: add tournament registration phase actions"
```

Expected: commit includes only tournament cloud files.

### Task 3: Self-Service Registration And Withdrawal

**Files:**
- Create: `cloudfunctions/tournament-registrations/lib/service.js`
- Create: `cloudfunctions/tournament-registrations/__tests__/self-service.test.js`
- Modify: `cloudfunctions/tournament-registrations/index.js`
- Modify: `cloudfunctions/tournament-registrations/package.json`
- Create/Modify: `cloudfunctions/tournament-registrations/package-lock.json`
- Modify: `cloudfunctions/scheduler-engine/index.js` — filter must read `registrationStatus`, not legacy `status`.
- Modify: `cloudfunctions/scheduler-engine/__tests__/*.test.js` (or create one) — assert withdrew rows are excluded.
- Modify: `miniprogram/utils/scheduler-mirror.js` — grep for any `status === 'withdrew'`-style filter and switch to `registrationStatus !== 'withdrew'`; keep legacy `status` as fallback only.

- [ ] **Step 1: Enable Jest for this cloud function**

Update `cloudfunctions/tournament-registrations/package.json`:

```json
{
  "name": "tournament-registrations",
  "version": "1.0.0",
  "description": "赛事报名管理云函数",
  "main": "index.js",
  "scripts": { "test": "jest" },
  "dependencies": {
    "wx-server-sdk": "~2.6.3"
  },
  "devDependencies": {
    "jest": "^29.7.0"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/__tests__/**/*.test.js"]
  }
}
```

Run: `cd cloudfunctions/tournament-registrations && npm install --package-lock-only`

Expected: `package-lock.json` is created or updated without installing runtime code into source files.

- [ ] **Step 2: Write self-service tests**

Create `cloudfunctions/tournament-registrations/__tests__/self-service.test.js`:

```js
const {
  selfRegister,
  withdrawRegistration,
  buildRegistrationId
} = require('../lib/service')

function makeCtx(overrides = {}) {
  const state = {
    tournament: {
      _id: 't1',
      seasonId: 'season_2026',
      name: '5月周末赛',
      type: 'singles',
      format: 'regular',
      startDate: '2026-05-24',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none',
      confirmedCount: 0,
      ...overrides.tournament
    },
    member: { _id: 'm1', name: '小林', openid: 'openid-1', claimStatus: 'claimed', ...overrides.member },
    existing: overrides.existing || [],
    resultRows: overrides.resultRows || [],
    brackets: overrides.brackets || [],
    writes: []
  }
  return {
    now: () => overrides.now || '2026-05-21T12:00:00+08:00',
    openid: overrides.openid || 'openid-1',
    runTransaction: fn => fn(),
    db: {
      getTournament: jest.fn(async () => state.tournament),
      getMemberByOpenid: jest.fn(async () => state.member),
      listRegistrations: jest.fn(async () => state.existing),
      listMatchResults: jest.fn(async () => state.resultRows),
      listBrackets: jest.fn(async () => state.brackets),
      upsertRegistration: jest.fn(async doc => state.writes.push({ type: 'upsertRegistration', doc })),
      updateRegistration: jest.fn(async (id, data) => state.writes.push({ type: 'updateRegistration', id, data })),
      updateTournament: jest.fn(async data => state.writes.push({ type: 'updateTournament', data })),
      updateBracket: jest.fn(async (id, data) => state.writes.push({ type: 'updateBracket', id, data }))
    },
    state
  }
}

test('selfRegister creates a confirmed personal registration for regular tournament', async () => {
  const ctx = makeCtx()
  const res = await selfRegister(ctx, { tournamentId: 't1' })
  expect(res.success).toBe(true)
  expect(ctx.state.writes[0].doc).toMatchObject({
    tournamentId: 't1',
    playerId: 'm1',
    playerName: '小林',
    registrationStatus: 'confirmed',
    source: 'wechat'
  })
  expect(ctx.state.writes[1].data).toMatchObject({ confirmedCount: 1 })
})

test('selfRegister reuses withdrew row when member registers again', async () => {
  const ctx = makeCtx({
    existing: [{ _id: 'reg_t1_001', playerId: 'm1', registrationStatus: 'withdrew' }]
  })
  const res = await selfRegister(ctx, { tournamentId: 't1' })
  expect(res.success).toBe(true)
  expect(ctx.state.writes[0]).toMatchObject({
    type: 'updateRegistration',
    id: 'reg_t1_001',
    data: { registrationStatus: 'confirmed', cancelledAt: null, cancelledBy: null, cancelReason: null }
  })
})

test('selfRegister blocks duplicate active registration', async () => {
  const ctx = makeCtx({
    existing: [{ _id: 'reg_t1_001', playerId: 'm1', registrationStatus: 'confirmed' }]
  })
  const res = await selfRegister(ctx, { tournamentId: 't1' })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('ALREADY_REGISTERED')
})

test('selfRegister blocks knockout singles at capacity', async () => {
  const ctx = makeCtx({
    tournament: { format: 'knockout', type: 'singles', maxPlayers: 8, confirmedCount: 8 }
  })
  const res = await selfRegister(ctx, { tournamentId: 't1' })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('CAPACITY_FULL')
})

test('withdrawRegistration blocks after withdraw deadline', async () => {
  const ctx = makeCtx({
    now: '2026-05-24T00:00:00+08:00',
    existing: [{ _id: 'reg_t1_001', playerId: 'm1', registrationStatus: 'confirmed' }]
  })
  const res = await withdrawRegistration(ctx, { tournamentId: 't1' })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('WITHDRAW_CLOSED')
})

test('withdrawRegistration blocks when an affected match already has score', async () => {
  const ctx = makeCtx({
    tournament: { scheduleStatus: 'published' },
    existing: [{ _id: 'reg_t1_001', playerId: 'm1', registrationStatus: 'confirmed' }],
    resultRows: [{ sourceMatchId: 'match1', player1: { id: 'm1' }, resultStatus: 'confirmed' }]
  })
  const res = await withdrawRegistration(ctx, { tournamentId: 't1' })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('MATCH_HAS_RESULT')
})

test('withdrawRegistration marks affected schedule for revision before results exist', async () => {
  const ctx = makeCtx({
    tournament: { scheduleStatus: 'published', confirmedCount: 2 },
    existing: [{ _id: 'reg_t1_001', playerId: 'm1', registrationStatus: 'confirmed' }],
    brackets: [{
      _id: 'bracket_t1_round_1',
      matches: [{ matchId: 'match1', player1: { id: 'm1' }, player2: { id: 'm2' } }]
    }]
  })
  const res = await withdrawRegistration(ctx, { tournamentId: 't1' })
  expect(res.success).toBe(true)
  expect(ctx.state.writes).toContainEqual(expect.objectContaining({
    type: 'updateTournament',
    data: expect.objectContaining({ confirmedCount: 1, scheduleNeedsRevision: true })
  }))
})

test('buildRegistrationId uses current tournament id convention', () => {
  expect(buildRegistrationId('tournament_2026_123456_001', 4)).toBe('reg_2026_123456_001_004')
})
```

- [ ] **Step 3: Run self-service tests and verify failure**

Run: `cd cloudfunctions/tournament-registrations && npm test -- __tests__/self-service.test.js --runInBand`

Expected: fail because `lib/service.js` does not exist.

- [ ] **Step 4: Implement service functions**

Create `cloudfunctions/tournament-registrations/lib/service.js` using `cloudfunctions/_shared/tournament-phase.js` for `canRegister`, `canWithdraw`, and `isActiveRegistration`. Implement these exported functions:

```js
module.exports = {
  buildRegistrationId,
  selfRegister,
  withdrawRegistration,
  isAffectedMatch,
  hasSubmittedScore
}
```

Required behavior:

```js
async function selfRegister(ctx, event) {
  return ctx.runTransaction(async () => {
    const tournament = await ctx.db.getTournament(event.tournamentId)
    const member = await ctx.db.getMemberByOpenid(ctx.openid)
    if (!member || member.claimStatus !== 'claimed') return fail('MEMBER_REQUIRED', '请先完成会员资料')
    if (member.openid && member.openid !== ctx.openid) return fail('PERMISSION_DENIED', '只能为自己报名')
    const existing = await ctx.db.listRegistrations(event.tournamentId)
    if (existing.some(row => isActiveRegistration(row) && row.playerId === member._id)) return fail('ALREADY_REGISTERED', '你已报名')
    const guard = canRegister(tournament, { now: ctx.now(), confirmedCount: tournament.confirmedCount || countConfirmed(existing) })
    if (!guard.ok) return fail(guard.code, guard.code === 'CAPACITY_FULL' ? '名额已满' : '报名不可用')
    const withdrew = existing.find(row => row.playerId === member._id && row.registrationStatus === 'withdrew')
    if (withdrew) {
      await ctx.db.updateRegistration(withdrew._id, {
        registrationStatus: 'confirmed',
        cancelledAt: null,
        cancelledBy: null,
        cancelReason: null,
        reregisteredAt: ctx.now(),
        updateTime: ctx.now()
      })
    } else {
      await ctx.db.upsertRegistration(buildDoc(tournament, member, existing.length + 1, ctx.now()))
    }
    await ctx.db.updateTournament({ confirmedCount: Number(tournament.confirmedCount || countConfirmed(existing)) + 1 })
    return ok({ tournamentId: event.tournamentId, playerId: member._id })
  })
}
```

For `withdrawRegistration`, mark `registrationStatus: 'withdrew'`, decrement `confirmedCount`, block `submitted/confirmed/settled` affected score rows, and set `scheduleNeedsRevision: true` plus `match.needsRevision: true` for affected bracket matches without results.

**Transaction wiring (spec §12 capacity atomicity):** `ctx.runTransaction` must wrap the real `db.runTransaction`; the test stub `fn => fn()` is *only* for unit tests and does not verify ordering. Production context builder:

```js
function buildServiceCtx(wxContext) {
  return {
    openid: wxContext.OPENID || null,
    now: () => new Date().toISOString(),
    runTransaction: async fn => db.runTransaction(async transaction => fn(buildTxnDb(transaction))),
    db: buildPlainDb()                       // non-transactional reads outside the txn
  }
}

function buildTxnDb(transaction) {
  return {
    getTournament: async id => {
      const res = await transaction.collection('tournaments').doc(id).get().catch(() => null)
      return res && res.data
    },
    getMemberByOpenid: async openid => {
      const res = await transaction.collection('members').where({ openid }).limit(1).get()
      return (res.data || [])[0]
    },
    listRegistrations: async tournamentId => {
      const res = await transaction.collection('tournament_registrations').where({ tournamentId }).get()
      return res.data || []
    },
    upsertRegistration: async doc => transaction.collection('tournament_registrations').add({ data: doc }),
    updateRegistration: async (id, data) => transaction.collection('tournament_registrations').doc(id).update({ data }),
    updateTournament: async data => transaction.collection('tournaments').doc(data._id || data.tournamentId).update({ data })
  }
}
```

Add a Jest test that mocks `db.runTransaction` to record call order, asserting that `getTournament` / `listRegistrations` and the subsequent `upsertRegistration` + `updateTournament(confirmedCount)` all happen inside the same transaction call. Without this assertion the capacity guarantee is unverified.

For cross-collection writes WeChat cloud `runTransaction` cannot reach (e.g., reading `tournament_brackets` to set `match.needsRevision`), use a two-step pattern: do the registration-state mutation inside the transaction, then do bracket annotations outside but in the same handler with a compensating `scheduleNeedsRevision` flag so admin can re-confirm.

- [ ] **Step 5: Wire cloud actions and align active-registration filters**

In `cloudfunctions/tournament-registrations/index.js`, route:

```js
case 'selfRegister':
  return await service.selfRegister(buildServiceCtx(wxContext), { tournamentId })
case 'withdraw':
  return await service.withdrawRegistration(buildServiceCtx(wxContext), { tournamentId })
```

Concrete filter migrations (must apply ALL of these in this step to avoid the bug where new data writes only `registrationStatus` but legacy code reads `status`):

1. `cloudfunctions/tournament-registrations/index.js` — `getStats`:

   ```diff
   - confirmed: registrations.filter(r => r.status === 'confirmed').length,
   - withdrew: registrations.filter(r => r.status === 'withdrew').length
   + confirmed: registrations.filter(isActiveRegistration).length,
   + withdrew: registrations.filter(r => !isActiveRegistration(r)).length
   ```

   where `isActiveRegistration` is imported from `cloudfunctions/_shared/tournament-phase.js`.

2. `cloudfunctions/tournament-registrations/index.js` — `list` action: keep raw rows but include both fields so callers can pick.

3. `cloudfunctions/scheduler-engine/index.js:106` — replace:

   ```diff
   - return data.filter((r) => r.status !== 'withdrew' && r.status !== 'cancelled');
   + return data.filter(isActiveRegistration);
   ```

   Add a unit test under `cloudfunctions/scheduler-engine/__tests__/` (create the folder if missing) that asserts a row with `registrationStatus: 'withdrew'` is excluded even when its legacy `status` is `'confirmed'`.

4. `miniprogram/utils/scheduler-mirror.js` — grep for `status !== 'withdrew'` / `status === 'cancelled'` patterns and replace with the same `isActiveRegistration` helper imported from `miniprogram/utils/tournament-phase.js`. If no such filter exists in this file, document the grep result in the commit message.

5. `cloudfunctions/tournament-registrations/lib/__tests__/validate.test.js` (or `__tests__/validate.test.js` per existing location): extend to accept both `registrationStatus` and legacy `status` shapes; reject neither when both are missing on read paths.

Run:

```bash
cd cloudfunctions/tournament-registrations
npm test -- __tests__/validate.test.js __tests__/self-service.test.js --runInBand
cd ../scheduler-engine
npm test -- --runInBand
cd ../../miniprogram
npm test -- utils/__tests__/scheduler-mirror.test.js --runInBand 2>/dev/null || true   # only if such test exists
```

Expected: validation, self-service, and scheduler-engine filter tests pass.

- [ ] **Step 6: Commit registration cloud work**

Run:

```bash
git add cloudfunctions/tournament-registrations/index.js \
        cloudfunctions/tournament-registrations/lib/service.js \
        cloudfunctions/tournament-registrations/__tests__/self-service.test.js \
        cloudfunctions/tournament-registrations/package.json \
        cloudfunctions/tournament-registrations/package-lock.json \
        cloudfunctions/scheduler-engine/index.js \
        cloudfunctions/scheduler-engine/__tests__ \
        miniprogram/utils/scheduler-mirror.js
git commit -m "feat: add self service tournament registration"
```

Expected: commit succeeds and does not include unrelated dirty files. Scheduler-engine + scheduler-mirror filter changes ship in the same commit as the registration field migration so production never sees a half-migrated state.

### Task 4: Schedule Draft, Publish, And Revision Protection

**Files:**
- Modify: `cloudfunctions/tournament-brackets/index.js`
- Create: `cloudfunctions/tournament-brackets/__tests__/schedule-revision.test.js`
- Modify: `cloudfunctions/match-results/lib/handlers/query.js`
- Modify: `cloudfunctions/match-results/index.js`
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/query.test.js`

**Design intent (Section 11.3 contract):** `handleSaveSchedule` is the *low-level* primitive — it updates round-1 bracket court assignments and `tournament.schedulePlan.queues`, and writes NOTHING about `scheduleStatus`. The *high-level* orchestrators are `tournaments.saveScheduleDraft` and `tournaments.publishSchedule` (Task 2). The wizard chains low + high in `persistScheduleDraftOnly()` / `persistPublishedSchedule()` (Task 5). Legacy `commitStep3()` keeps calling the low-level primitive only, so legacy tournaments stay on the pre-phase code path and never enter a `draft + score-rows` contradiction.

- [ ] **Step 0: Refactor handleSaveSchedule to accept a context**

`handleSaveSchedule` is currently a closure over module-level `db` and `collection`. Pull collaborators into a context parameter so unit tests can inject fakes:

```js
async function handleSaveScheduleWithCtx(ctx, { tournamentId, queues }) { /* same logic, via ctx.db.*, ctx.serverDate() */ }

async function handleSaveSchedule(event) {
  return handleSaveScheduleWithCtx(buildDefaultCtx(), event)
}

function buildDefaultCtx() {
  return {
    db: {
      getBracket: id => collection.doc(id).get().catch(() => null),
      updateBracket: (id, data) => collection.doc(id).update({ data }),
      getTournament: id => db.collection('tournaments').doc(id).get().catch(() => null),
      updateTournament: (id, data) => db.collection('tournaments').doc(id).update({ data })
    },
    serverDate: () => db.serverDate(),
    set: _.set
  }
}

exports.__test__ = {
  validateBracket,
  markMatchesForRevision,
  handleSaveScheduleWithCtx,
  makeScheduleCtx: ({ tournament, r1 }) => ({
    bracketUpdates: [],
    tournamentUpdates: [],
    db: {
      getBracket: jest.fn(async id => (id === r1._id ? { data: r1 } : null)),
      updateBracket: jest.fn(async (id, data) => { /* record */ }),
      getTournament: jest.fn(async id => ({ data: tournament })),
      updateTournament: jest.fn(async (id, data) => { /* record */ })
    },
    serverDate: () => 'server-date',
    set: v => v
  })
}
```

Expected: no behavior change in the legacy `handleSaveSchedule` entry — only an extraction seam appears.

- [ ] **Step 1: Write bracket schedule tests**

Create `cloudfunctions/tournament-brackets/__tests__/schedule-revision.test.js`:

```js
const { __test__ } = require('../index')

test('saveSchedule writes schedulePlan but NEVER touches scheduleStatus (low-level primitive)', async () => {
  const ctx = __test__.makeScheduleCtx({
    tournament: { _id: 't1', scheduleStatus: 'none', schedulePlan: { slotMinutes: 20, courts: [] } },
    r1: { _id: 'bracket_t1_round_1', matches: [{ matchId: 'm1', round: 1, position: 1 }] }
  })
  const res = await __test__.handleSaveScheduleWithCtx(ctx, { tournamentId: 't1', queues: [] })
  expect(res.success).toBe(true)
  const tournamentWrites = ctx.db.updateTournament.mock.calls.map(c => c[1])
  for (const write of tournamentWrites) {
    expect(write).not.toHaveProperty('scheduleStatus')
  }
})

test('markMatchesForRevision sets needsRevision on affected matches only', () => {
  const matches = [
    { matchId: 'm1', player1: { id: 'p1' }, player2: { id: 'p2' } },
    { matchId: 'm2', player1: { id: 'p3' }, player2: { id: 'p4' } }
  ]
  expect(__test__.markMatchesForRevision(matches, 'p1')).toEqual([
    { matchId: 'm1', player1: { id: 'p1' }, player2: { id: 'p2' }, needsRevision: true },
    { matchId: 'm2', player1: { id: 'p3' }, player2: { id: 'p4' } }
  ])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd cloudfunctions/tournament-brackets && npm test -- __tests__/schedule-revision.test.js --runInBand`

Expected: fail because the test-only helpers do not exist and `markMatchesForRevision` is not implemented.

- [ ] **Step 3: Update schedule save behavior (low-level only)**

In `handleSaveScheduleWithCtx`, after mirroring queues into `tournament.schedulePlan`, update tournaments WITHOUT writing `scheduleStatus`:

```js
await ctx.db.updateTournament(tournamentId, {
  schedulePlan: ctx.set(nextSP),
  updateTime: ctx.serverDate()
})
// Intentionally NOT writing scheduleStatus here. Higher-level callers
// (tournaments.saveScheduleDraft / tournaments.publishSchedule) own that field.
// Legacy commitStep3() relies on the absence of scheduleStatus to keep the
// pre-phase legacy display path (see Section 5 phase derivation rule 7).
```

Add `markMatchesForRevision(matches, playerId)` helper that returns a new array with `needsRevision: true` on matches whose player1/player2 matches `playerId`.

Run Step 1 tests again — expect green.

Expected: saving schedule mutates schedulePlan + bracket courts only; `scheduleStatus` stays whatever it was set to by the higher-level caller.

- [ ] **Step 4: TDD — gate match result reads until schedule is published**

First add failing tests to `cloudfunctions/match-results/lib/__tests__/handlers/query.test.js`:

```js
test('canExposeScoreRows: legacy tournament with no scheduleStatus is exposed (backward compat)', () => {
  expect(__test__.canExposeScoreRows({ _id: 't-legacy' })).toBe(true)
})

test('canExposeScoreRows: published is exposed', () => {
  expect(__test__.canExposeScoreRows({ scheduleStatus: 'published' })).toBe(true)
})

test('canExposeScoreRows: none / draft are hidden', () => {
  expect(__test__.canExposeScoreRows({ scheduleStatus: 'none' })).toBe(false)
  expect(__test__.canExposeScoreRows({ scheduleStatus: 'draft' })).toBe(false)
})

test('listByTournament returns empty rows when scheduleStatus is draft', async () => {
  const ctx = makeQueryCtx({ tournament: { scheduleStatus: 'draft' }, rows: [{ _id: 'r1' }] })
  const res = await __test__.listByTournamentWithCtx(ctx, { tournamentId: 't1' })
  expect(res).toEqual({ results: [] })
})
```

Run: `cd cloudfunctions/match-results && npm test -- lib/__tests__/handlers/query.test.js --runInBand` → expect red.

Then implement in `cloudfunctions/match-results/lib/handlers/query.js`:

```js
// canExposeScoreRows: three explicit states for clarity.
// - 'published'          → expose
// - undefined / null     → legacy tournament, backward-compat expose
// - 'none' / 'draft'     → hide member-visible rows
function canExposeScoreRows(tournament) {
  if (!tournament) return false
  const s = tournament.scheduleStatus
  if (s === 'published') return true
  if (s === undefined || s === null) return true  // legacy backward compat
  return false                                     // 'none' | 'draft'
}
```

For `listByTournament` and score page entry queries, read the tournament first; if `canExposeScoreRows(tournament) === false`, return `{ results: [] }` for members and `FORBIDDEN` for direct non-admin score entry. Export `canExposeScoreRows` under `__test__`.

Run the same test command again — expect green.

- [ ] **Step 5: Commit schedule state work**

Run:

```bash
git add cloudfunctions/tournament-brackets/index.js cloudfunctions/tournament-brackets/__tests__/schedule-revision.test.js cloudfunctions/match-results/lib/handlers/query.js cloudfunctions/match-results/index.js cloudfunctions/match-results/lib/__tests__/handlers/query.test.js
git commit -m "feat: separate schedule draft from published rows"
```

Expected: schedule draft and score row visibility are committed together.

### Task 5: Tournament Edit Wizard Registration Publishing

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.js`
- Modify: `miniprogram/pages/tournament-edit/index.wxml`
- Modify: `miniprogram/pages/tournament-edit/index.wxss`
- Modify: `miniprogram/pages/tournament-edit/__tests__/index.test.js`

- [ ] **Step 1: Write wizard behavior tests**

Add tests to `miniprogram/pages/tournament-edit/__tests__/index.test.js`:

```js
test('step 2 requires registration deadline before publishing registration', async () => {
  const def = loadPage()
  const ctx = makeCtx(def, { tournamentId: 't1', form: { ...def.data.form, registrationDeadlineAt: '' } })
  await ctx.onPublishRegistration()
  expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择报名截止', icon: 'none' })
  expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
    name: 'tournaments',
    data: expect.objectContaining({ action: 'publishRegistration' })
  }))
})

test('step 2 can publish registration and prepare share path without entering schedule', async () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    tournamentId: 't1',
    form: { ...def.data.form, name: '5月周末赛', registrationDeadlineAt: '2026-05-24T18:00:00+08:00' },
    selectedPlayers: players,
    schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
  })
  wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: { id: 't1' } } })
  await ctx.onPublishRegistration()
  expect(ctx.data.step).toBe(2)
  expect(ctx.data.registrationPublished).toBe(true)
  expect(ctx.data.sharePath).toBe('/pages/tournament-detail/index?id=t1&entry=register')
})

test('step 2 next still enters schedule directly', async () => {
  const def = loadPage()
  const ctx = makeCtx(def, {
    tournamentId: 't1',
    selectedPlayers: players,
    schedulePlanCourts: [{ courtId: 'c1', slots: ['2026-05-25T18:00'] }]
  })
  wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: { count: 4 } } })
  await ctx.commitStep2()
  expect(ctx.data.step).toBe(3)
})

test('step 3 save draft does not generate score rows', async () => {
  const def = loadPage()
  const ctx = makeCtx(def, { tournamentId: 't1', step: 3, matches: [{ matchId: 'm1', round: 1, position: 1 }], queues: [] })
  wx.cloud.callFunction.mockResolvedValue({ result: { success: true, data: {} } })
  await ctx.onSaveScheduleDraft()
  expect(wx.cloud.callFunction).toHaveBeenCalledWith({
    name: 'tournaments',
    data: { action: 'saveScheduleDraft', id: 't1', schedulePlan: expect.any(Object) }
  })
  expect(wx.cloud.callFunction).not.toHaveBeenCalledWith(expect.objectContaining({
    name: 'match-results',
    data: expect.objectContaining({ action: 'bulkUpsertScheduledMatches' })
  }))
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd miniprogram && npm test -- pages/tournament-edit/__tests__/index.test.js --runInBand`

Expected: fail because new methods/data do not exist.

- [ ] **Step 3: Add wizard data and hydration**

Add fields to `data.form`:

```js
registrationDeadlineAt: '',
```

Add top-level state:

```js
registrationPublished: false,
sharePath: '',
scheduleStarted: false
```

In `hydrateDraft`, read:

```js
'form.registrationDeadlineAt': t.registrationDeadlineAt || '',
registrationPublished: !!t.registrationPublishedAt,
scheduleStarted: t.scheduleStatus === 'draft' || t.scheduleStatus === 'published'
```

If `scheduleStarted` is true, keep the existing field layout and show a small note beside the deadline field: `已开始排程，如需重新开放报名请先清空草稿`.

- [ ] **Step 4: Add registration deadline UI in existing step 2 card style**

In `index.wxml`, inside `step === 2`, add a `card` before the player card:

```xml
<view class="card registration-card">
  <view class="card-head">
    <view class="card-title-row">
      <text class="card-title">报名设置</text>
      <text wx:if="{{registrationPublished}}" class="title-pill">报名中</text>
    </view>
  </view>
  <view class="field compact-field">
    <text class="label">报名截止 *</text>
    <picker mode="date" bindchange="onRegistrationDeadlineDateChange" value="{{registrationDeadlineDate}}">
      <view class="picker-value">
        <text class="num">{{registrationDeadlineDisplay || '选择日期时间'}}</text>
        <text class="picker-arrow">›</text>
      </view>
    </picker>
  </view>
  <text wx:if="{{scheduleStarted}}" class="field-hint">已开始排程，如需重新开放报名请先清空草稿</text>
</view>
```

Use existing `card`, `field`, `label`, `picker-value`, and `title-pill`; `registration-card` and `compact-field` may only add local spacing.

- [ ] **Step 5: Add publish/share and draft/publish actions**

Implement methods. Note the `onShareAppMessage` lifecycle hook is mandatory — without it the WeChat share button will fall back to the current `tournament-edit` page path instead of the required `/pages/tournament-detail/index?id=<id>&entry=register`.

```js
async onPublishRegistration() {
  if (!this.data.form.registrationDeadlineAt) {
    wx.showToast({ title: '请选择报名截止', icon: 'none' })
    return
  }
  await this.persistStep2Inputs()
  const res = await wx.cloud.callFunction({
    name: 'tournaments',
    data: {
      action: 'publishRegistration',
      id: this.data.tournamentId,
      registrationDeadlineAt: this.data.form.registrationDeadlineAt
    }
  })
  if (!_isSuccess(res)) {
    wx.showToast({ title: _errMsg(res, '发布失败'), icon: 'none' })
    return                       // do NOT open the share panel on publish failure
  }
  const sharePath = `/pages/tournament-detail/index?id=${this.data.tournamentId}&entry=register`
  this.setData({ registrationPublished: true, sharePath })
  if (wx.showShareMenu) {
    wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
  }
  wx.showToast({ title: '已发布', icon: 'success' })
}

// WeChat lifecycle hook — required for the share button to use sharePath.
onShareAppMessage() {
  if (!this.data.registrationPublished || !this.data.sharePath) {
    return { title: '赛事报名', path: '/pages/tournament-detail/index' }
  }
  return {
    title: this.data.form.name || '赛事报名',
    path: this.data.sharePath
  }
}

async onSaveScheduleDraft() {
  await this.persistScheduleDraftOnly()
  wx.showToast({ title: '已保存草稿', icon: 'success' })
}

async onPublishSchedule() {
  await this.persistPublishedSchedule()
  wx.redirectTo({ url: `/pages/tournament-detail/index?id=${this.data.tournamentId}` })
}

// Chain low-level + high-level: tournament-brackets writes schedulePlan.queues
// and round-1 bracket court assignments; tournaments.saveScheduleDraft then
// writes scheduleStatus='draft'. Splitting these prevents the legacy
// commitStep3 path from accidentally hitting scheduleStatus.
async persistScheduleDraftOnly() {
  await wx.cloud.callFunction({
    name: 'tournament-brackets',
    data: { action: 'saveSchedule', tournamentId: this.data.tournamentId, queues: this.data.queues }
  })
  await wx.cloud.callFunction({
    name: 'tournaments',
    data: { action: 'saveScheduleDraft', id: this.data.tournamentId, schedulePlan: this.buildSchedulePlanSnapshot() }
  })
}

// publishSchedule on the cloud side calls bulkUpsertScheduledMatches itself
// (Task 2 Step 3) — the wizard just needs to push the latest queues first,
// then trigger publish.
async persistPublishedSchedule() {
  await wx.cloud.callFunction({
    name: 'tournament-brackets',
    data: { action: 'saveSchedule', tournamentId: this.data.tournamentId, queues: this.data.queues }
  })
  await wx.cloud.callFunction({
    name: 'tournaments',
    data: { action: 'publishSchedule', id: this.data.tournamentId }
  })
}
```

Extract current Step 2 save logic into `persistStep2Inputs()` so both `commitStep2()` and `onPublishRegistration()` use the same validation and `bulkSet` call. Keep `commitStep2()` entering Step 3.

`buildSchedulePlanSnapshot()` is a small helper that returns the current `{ slotMinutes, courts, queues }` from `this.data` — reuse whatever construction `commitStep3` already does.

- [ ] **Step 6: Update footer without changing wizard structure**

Step 2 has TWO footer states (spec §6.2 vs §6.3). Use existing `footer`, `back`, and `next` classes plus local modifiers:

```xml
<!-- Step 2 pre-publish: spec §6.2 -->
<view wx:if="{{step === 2 && !registrationPublished}}" class="footer footer-three">
  <view class="back tap-scale" bindtap="onBack">上一步</view>
  <view class="next secondary tap-scale" bindtap="onNext">下一步排程</view>
  <view class="next tap-scale" bindtap="onPublishRegistration">发布并分享到微信</view>
</view>

<!-- Step 2 post-publish: spec §6.3 -->
<view wx:elif="{{step === 2 && registrationPublished}}" class="footer">
  <view class="back tap-scale" bindtap="onManageRegistration">管理报名</view>
  <button open-type="share" class="next tap-scale">分享到微信</button>
</view>

<!-- Step 3: spec §6.4 -->
<view wx:elif="{{step === 3}}" class="footer">
  <view class="back tap-scale" bindtap="onSaveScheduleDraft">保存草稿</view>
  <view class="next tap-scale" bindtap="onPublishSchedule">发布赛程</view>
</view>
```

`onManageRegistration` navigates to the existing report/manage entry; if no dedicated page exists, scroll to the registration card section in step 2 (no new page introduced).

Expected: no new page-level layout or prototype-only card styling is introduced. `footer-three` is the only new local modifier, applied via WXSS in this task.

- [ ] **Step 7: Verify and commit**

Run: `cd miniprogram && npm test -- pages/tournament-edit/__tests__/index.test.js --runInBand`

Expected: all tournament edit tests pass.

Run:

```bash
git add miniprogram/pages/tournament-edit/index.js miniprogram/pages/tournament-edit/index.wxml miniprogram/pages/tournament-edit/index.wxss miniprogram/pages/tournament-edit/__tests__/index.test.js
git commit -m "feat: publish tournament registration from wizard"
```

Expected: commit includes only tournament edit files.

### Task 6: Tournament Detail Phase And Role UI

**Files:**
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-detail/index.wxml`
- Modify: `miniprogram/pages/tournament-detail/index.wxss`
- Modify: `miniprogram/pages/tournament-detail/__tests__/index.test.js`
- Modify: `miniprogram/pages/edit-profile/index.js`
- Modify: `miniprogram/pages/edit-profile/__tests__/index.test.js`

- [ ] **Step 1: Write phase display tests**

Add tests to `miniprogram/pages/tournament-detail/__tests__/index.test.js`:

```js
test('registration open member sees registration phase and register CTA', async () => {
  const { pageDef } = loadPage({
    app: { globalData: { currentMember: { _id: 'm2' }, isAdmin: false } },
    tournament: {
      _id: 't1',
      name: '5月周末赛',
      type: 'singles',
      format: 'regular',
      startDate: '2026-05-25',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    },
    registrations: []
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1', entry: 'register', now: '2026-05-21T12:00:00+08:00' })
  await ctx.refresh()
  expect(ctx.data.phase).toBe('registration_open')
  expect(ctx.data.primaryActionLabel).toBe('我要报名')
  expect(ctx.data.showRegistrationStatusCard).toBe(false)
})

test('registered member before withdraw deadline sees withdraw CTA and no waiting button', async () => {
  const { pageDef } = loadPage({
    app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false } },
    tournament: {
      _id: 't1',
      startDate: '2026-05-24',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
      scheduleStatus: 'none'
    },
    registrations: [{ _id: 'reg1', playerId: 'm1', registrationStatus: 'confirmed' }]
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1', now: '2026-05-23T23:00:00+08:00' })
  await ctx.refresh()
  expect(ctx.data.phase).toBe('pending_schedule')
  expect(ctx.data.primaryActionLabel).toBe('退出报名')
  expect(ctx.data.showWaitingScheduleButton).toBe(false)
})

test('admin pending schedule sees share edit and arrange actions', async () => {
  const { pageDef } = loadPage({
    app: { globalData: { currentMember: { _id: 'admin1' }, isAdmin: true } },
    tournament: {
      _id: 't1',
      startDate: '2026-05-24',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
      scheduleStatus: 'none'
    }
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })
  await ctx.refresh()
  expect(ctx.data.footerActions.map(a => a.label)).toEqual(['分享', '编辑', '安排对局'])
})

test('schedule published shows schedule before roster and hides registration module', async () => {
  const { pageDef } = loadPage({
    tournament: { _id: 't1', scheduleStatus: 'published', status: 'upcoming', schedulePlan: { courts: [] } }
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })
  await ctx.refresh()
  expect(ctx.data.phase).toBe('schedule_published')
  expect(ctx.data.showRegistrationModule).toBe(false)
  expect(ctx.data.showScheduleSection).toBe(true)
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd miniprogram && npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand`

Expected: fail because `phase`, footer action array, and registration actions do not exist.

- [ ] **Step 3: Add phase state builder**

In `index.js`, import:

```js
const { PHASE, derivePhase, getWithdrawDeadline, canWithdraw, isActiveRegistration } = require('../../utils/tournament-phase')
```

Add `buildDetailPhaseState` near existing display builders:

```js
function buildDetailPhaseState({ tournament, registrations, isAdmin, isParticipant, now, entry }) {
  const activeRegs = (registrations || []).filter(isActiveRegistration)
  const phase = derivePhase(tournament, { now })
  const withdraw = getWithdrawDeadline(tournament)
  const showRegistrationModule = phase === PHASE.REGISTRATION_OPEN || phase === PHASE.PENDING_SCHEDULE
  const showScheduleSection = phase === PHASE.SCHEDULE_PUBLISHED || phase === PHASE.RESULTS || (isAdmin && phase === PHASE.SCHEDULE_DRAFT)
  const canMemberWithdraw = isParticipant && canWithdraw(tournament, { now }) && (phase === PHASE.REGISTRATION_OPEN || phase === PHASE.PENDING_SCHEDULE || phase === PHASE.SCHEDULE_PUBLISHED)
  const footerActions = buildFooterActions({ phase, isAdmin, isParticipant, canMemberWithdraw })
  return {
    phase,
    entry,
    activeRegistrationCount: activeRegs.length,
    withdrawDeadlineLabel: withdraw.label,
    showRegistrationModule,
    showRegistrationStatusCard: false,
    showWaitingScheduleButton: false,
    showScheduleSection,
    showResultsSection: phase === PHASE.RESULTS,
    footerActions,
    primaryActionLabel: footerActions.length ? footerActions[footerActions.length - 1].label : ''
  }
}
```

Use `this.data.now || new Date()` in tests and runtime.

- [ ] **Step 4: Add member registration and withdrawal actions**

Implement:

```js
async onRegisterSelf() {
  await this.ensureIdentity()
  const member = app.globalData && app.globalData.currentMember
  if (!member || member.claimStatus === 'unclaimed') {
    wx.navigateTo({ url: `/pages/edit-profile/index?from=tournament-register&tournamentId=${this.data.tournamentId}` })
    return
  }
  const res = await wx.cloud.callFunction({
    name: 'tournament-registrations',
    data: { action: 'selfRegister', tournamentId: this.data.tournamentId }
  })
  if (!_isSuccess(res)) {
    wx.showToast({ title: _errMsg(res, '报名失败'), icon: 'none' })
    return
  }
  wx.showToast({ title: '已报名', icon: 'success' })
  await this.refresh()
}

async onWithdrawSelf() {
  const ok = await new Promise(resolve => wx.showModal({
    title: '退出报名',
    content: `确定退出本次赛事？${this.data.withdrawDeadlineLabel ? '退赛截止为 ' + this.data.withdrawDeadlineLabel : ''}`,
    success: ({ confirm }) => resolve(confirm),
    fail: () => resolve(false)
  }))
  if (!ok) return
  const res = await wx.cloud.callFunction({
    name: 'tournament-registrations',
    data: { action: 'withdraw', tournamentId: this.data.tournamentId }
  })
  if (!_isSuccess(res)) {
    wx.showToast({ title: _errMsg(res, '退出失败'), icon: 'none' })
    return
  }
  wx.showToast({ title: '已退出', icon: 'success' })
  await this.refresh()
}
```

Map error codes: `MEMBER_REQUIRED -> 请先完善资料`, `CAPACITY_FULL -> 名额已满`, `REGISTRATION_CLOSED -> 报名已截止`, `WITHDRAW_CLOSED -> 已过退赛截止时间`, `MATCH_HAS_RESULT -> 该场次已有成绩，请联系管理员处理`, `SELF_REGISTRATION_UNSUPPORTED -> 该赛制暂不支持自助报名`, `ALREADY_REGISTERED -> 你已报名`, `PERMISSION_DENIED -> 只能为自己操作`.

Defense in depth — also hide the `我要报名` CTA at the UI layer when `tournament.format === 'knockout' && tournament.type === 'doubles'`. The error code mapping is a backend tripwire; the UI should not let users click a button that always errors:

```js
const selfRegistrationSupported = !(tournament.format === 'knockout' && tournament.type === 'doubles')
```

Use `selfRegistrationSupported` to gate `primaryActionLabel === '我要报名'` rendering in WXML.

- [ ] **Step 5: Add admin navigation actions**

Implement:

```js
onArrangeSchedule() {
  wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}&step=3` })
}

onEditSchedule() {
  wx.navigateTo({ url: `/pages/tournament-edit/index?id=${this.data.tournamentId}&step=3&mode=edit-schedule` })
}

onAdjustResults() {
  wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}&mode=adjust` })
}

onConfirmScheduleRevision() {
  return wx.cloud.callFunction({
    name: 'tournaments',
    data: { action: 'confirmScheduleRevision', id: this.data.tournamentId }
  }).then(() => this.refresh())
}
```

Expected: pending admin footer is `分享 / 编辑 / 安排对局`; schedule mode admin footer is `分享 / 编辑赛程 / 录入成绩`; results mode admin footer is `分享 / 调整成绩`.

- [ ] **Step 6: Update WXML using existing sections**

Add a small phase strip at the top of the detail content before hero:

```xml
<view class="td-section phase-strip">
  <view class="phase-steps">
    <text class="phase-step {{phase === 'registration_open' ? 'active' : ''}}">报名</text>
    <text class="phase-step {{phase === 'pending_schedule' || phase === 'schedule_draft' ? 'active' : ''}}">排程</text>
    <text class="phase-step {{phase === 'schedule_published' ? 'active' : ''}}">比赛</text>
    <text class="phase-step {{phase === 'results' ? 'active' : ''}}">赛果</text>
  </view>
</view>
```

Adjust hero meta so registration/pending phases show `COURT TIME`, `DEADLINE`, and `WITHDRAW BY` from `tournamentDisplay` instead of duplicating a registration card. Keep `SCHEDULE` before `ROSTER` in schedule/results modes and `ROSTER` before next-stage copy in registration/pending modes.

Render footer from `footerActions`:

```xml
<view wx:if="{{tournament}}" class="td-footer">
  <block wx:for="{{footerActions}}" wx:key="key">
    <button wx:if="{{item.openType}}" open-type="{{item.openType}}" class="footer-cta {{item.className}}">{{item.label}}</button>
    <view wx:else class="footer-cta {{item.className}}" bindtap="{{item.handler}}">{{item.label}}</view>
  </block>
</view>
```

If dynamic handler names are not supported in the current Mini Program base library, render explicit `wx:if` branches for each action key. Keep the same `td-footer` and `footer-cta` styles.

- [ ] **Step 7: Handle `entry=register` and edit-profile return without polluting the nav stack**

In `onLoad`, store `entry: options.entry || ''`. After refresh, if `entry === 'register'` and phase is `registration_open` and `selfRegistrationSupported === true`, call:

```js
wx.createSelectorQuery().select('#registration-section').boundingClientRect(rect => {
  if (rect) wx.pageScrollTo({ scrollTop: Math.max(0, rect.top - 80), duration: 200 })
}).exec()
```

The naive `wx.redirectTo` from edit-profile would pollute the stack (`[detail, detail]`). Use `navigateBack` + an event-channel handshake so the originating detail page refreshes itself:

```js
// In tournament-detail onLoad, when entering edit-profile flow:
wx.navigateTo({
  url: `/pages/edit-profile/index?from=tournament-register&tournamentId=${this.data.tournamentId}`,
  events: {
    registrationIdentityReady: () => {
      this.setData({ entry: 'register' })
      this.refresh()
    }
  }
})

// In miniprogram/pages/edit-profile/index.js, after successful save:
if (this.data.from === 'tournament-register' && this.data.tournamentId) {
  const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel()
  if (eventChannel && eventChannel.emit) {
    eventChannel.emit('registrationIdentityReady')
  }
  wx.navigateBack({ delta: 1 })
  return
}
```

Fallback when `getOpenerEventChannel` is unavailable (older base library): fall back to the simple `wx.redirectTo` path but log a warning so QA notices.

Add tests:

- `from=tournament-register` calls `navigateBack`, not `redirectTo`, in the modern base library mock.
- `EventChannel.emit('registrationIdentityReady')` fires before navigateBack.
- Manual verify in Task 9 that the back arrow on the post-flow detail returns to the home / previous page, not another detail.

- [ ] **Step 8: Verify and commit detail work**

Run:

```bash
cd miniprogram
npm test -- pages/tournament-detail/__tests__/index.test.js pages/edit-profile/__tests__/index.test.js --runInBand
```

Expected: detail and edit-profile tests pass.

Run:

```bash
git add miniprogram/pages/tournament-detail/index.js miniprogram/pages/tournament-detail/index.wxml miniprogram/pages/tournament-detail/index.wxss miniprogram/pages/tournament-detail/__tests__/index.test.js miniprogram/pages/edit-profile/index.js miniprogram/pages/edit-profile/__tests__/index.test.js
git commit -m "feat: add phase aware tournament detail"
```

Expected: footer, section order, and registration actions are committed.

### Task 7: Events List, Admin Workbench, And My Matches States

**Files:**
- Modify: `miniprogram/pages/match/index.js`
- Modify: `miniprogram/pages/match/index.wxml`
- Modify: `miniprogram/pages/match/index.wxss`
- Modify: `miniprogram/pages/match/__tests__/index.test.js`
- Modify: `cloudfunctions/tournaments/lib/handlers/admin-console.js`
- Modify: `cloudfunctions/tournaments/lib/__tests__/admin-console.test.js`
- Modify: `miniprogram/pages/tournament-manage/index.js`
- Modify: `miniprogram/pages/tournament-manage/index.wxml`
- Modify: `miniprogram/pages/tournament-manage/index.wxss`
- Modify: `cloudfunctions/match-results/lib/handlers/my-summary.js`
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js`
- Modify: `miniprogram/pages/my-match/index.js`
- Modify: `miniprogram/pages/my-match/index.wxml`
- Modify: `miniprogram/pages/my-match/index.wxss`
- Modify: `miniprogram/pages/my-match/__tests__/index.test.js`

- [ ] **Step 1: Add match list phase tests**

In `miniprogram/pages/match/__tests__/index.test.js`, add:

```js
test('decorates registration open tournament as available to register for viewer', async () => {
  const { pageDef } = loadPage({
    tournaments: [{
      _id: 't1',
      name: '5月周末赛',
      format: 'regular',
      type: 'singles',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-24T18:00:00+08:00',
      scheduleStatus: 'none'
    }]
  })
  const ctx = makeCtx(pageDef)
  await ctx.loadTournaments()
  expect(ctx.data.tournaments[0].__statusLabel).toBe('报名中')
  expect(ctx.data.tournaments[0].__permissionLabel).toBe('可报名')
})

test('decorates participant pending schedule as waiting for schedule', async () => {
  const { pageDef } = loadPage({
    app: { globalData: { currentMember: { _id: 'm1' }, isAdmin: false }, refreshIdentity: jest.fn().mockResolvedValue(null) },
    tournaments: [{
      _id: 't1',
      registrationPublishedAt: '2026-05-20T12:00:00+08:00',
      registrationDeadlineAt: '2026-05-21T10:00:00+08:00',
      scheduleStatus: 'none'
    }],
    registrationsByTournament: { t1: [{ playerId: 'm1', registrationStatus: 'confirmed' }] }
  })
  const ctx = makeCtx(pageDef)
  await ctx.loadTournaments()
  expect(ctx.data.tournaments[0].__permissionLabel).toBe('等待赛程')
})
```

Run: `cd miniprogram && npm test -- pages/match/__tests__/index.test.js --runInBand`

Expected: fail until match decorators use phase helper and active registration status.

- [ ] **Step 2: Update match page decorators**

In `miniprogram/pages/match/index.js`, import `derivePhase`, `PHASE`, and `isActiveRegistration`. Update `permissionLabel` to accept phase:

```js
function permissionLabel(kind, phase, isParticipant) {
  if (kind === 'admin') return phase === PHASE.PENDING_SCHEDULE ? '待排程' : '可编辑'
  if (isParticipant && phase === PHASE.PENDING_SCHEDULE) return '等待赛程'
  if (isParticipant) return '已报名'
  if (phase === PHASE.REGISTRATION_OPEN) return '可报名'
  if (phase === PHASE.SCHEDULE_PUBLISHED) return '可录分'
  return '仅查看'
}
```

Update WXML only where current labels are already rendered; do not introduce a new card layout.

- [ ] **Step 3: Extend admin console snapshot tests**

In `cloudfunctions/tournaments/lib/__tests__/admin-console.test.js`, add cases for snapshot groups:

```js
expect(snapshot.registrationOpen[0]).toMatchObject({ tournamentId: 'reg-open', confirmedCount: 9, deadlineText: '5月24日 18:00' })
expect(snapshot.pendingSchedule[0]).toMatchObject({ tournamentId: 'pending', playerCount: 12 })
expect(snapshot.scheduleDrafts[0]).toMatchObject({ tournamentId: 'draft', scheduledCount: 4 })
expect(snapshot.scheduleRevisions[0]).toMatchObject({ tournamentId: 'needs-revision', affectedCount: 2 })
```

Run: `cd cloudfunctions/tournaments && npm test -- lib/__tests__/admin-console.test.js --runInBand`

Expected: fail until admin console handler includes the new groups.

- [ ] **Step 4: Implement admin workbench groups**

In `cloudfunctions/tournaments/lib/handlers/admin-console.js`, add arrays:

```js
registrationOpen: [],
pendingSchedule: [],
scheduleDrafts: [],
scheduleRevisions: []
```

Use `derivePhase` to group tournaments and compute:

```js
// 1 hour per court ≈ SLOT_GAMES_FACTOR games per slot (20-min slots, ~30-min games).
// Adjust if real-world tournament durations diverge.
const SLOT_GAMES_FACTOR = 2

const suggestedCapacity = countCourts(t.schedulePlan) * countSlots(t.schedulePlan) * SLOT_GAMES_FACTOR

// Legacy tournaments without confirmedCount are excluded from the soft-warning
// (count is undefined → 0 → no warning). New tournaments maintain
// confirmedCount via the transactional path (Section 12), so this is safe.
const confirmed = Number.isFinite(t.confirmedCount) ? Number(t.confirmedCount) : null
const capacityWarning = t.format === 'regular'
  && suggestedCapacity > 0
  && confirmed !== null
  && confirmed > suggestedCapacity
```

Expose `capacityWarning`, `deadlineText`, `playerCount`, `scheduledCount`, and `affectedCount`. When `confirmed === null`, set `playerCount` to the live `tournament_registrations` count via `countConfirmedRegistrations(t._id)` so the workbench still shows correct numbers for legacy tournaments even though the soft-warning stays off.

In `miniprogram/pages/tournament-manage/index.wxml`, add new `block` sections using the existing `row`, `row-l`, `row-t`, `row-s`, and `status-tag` classes. Add handlers:

```js
onRegistrationOpenRow(e) { wx.navigateTo({ url: `/pages/tournament-detail/index?id=${e.currentTarget.dataset.tournamentid}` }) }
onPendingScheduleRow(e) { wx.navigateTo({ url: `/pages/tournament-edit/index?id=${e.currentTarget.dataset.tournamentid}&step=3` }) }
onScheduleDraftRow(e) { wx.navigateTo({ url: `/pages/tournament-edit/index?id=${e.currentTarget.dataset.tournamentid}&step=3` }) }
onScheduleRevisionRow(e) { wx.navigateTo({ url: `/pages/tournament-detail/index?id=${e.currentTarget.dataset.tournamentid}` }) }
```

- [ ] **Step 5: Add my-match registration summary tests**

In `cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js`, add a registration section test:

```js
expect(summary.registrations).toEqual([
  expect.objectContaining({
    tournamentId: 't1',
    statusLabel: '可退出',
    withdrawDeadlineLabel: '5月23日 24:00'
  })
])
```

In `miniprogram/pages/my-match/__tests__/index.test.js`, assert the WXML contains a `我的报名` block and that tapping a registration row navigates to detail.

Run:

```bash
cd cloudfunctions/match-results && npm test -- lib/__tests__/handlers/my-summary.test.js --runInBand
cd ../../miniprogram && npm test -- pages/my-match/__tests__/index.test.js --runInBand
```

Expected: fail until summary and page render the registration block.

- [ ] **Step 6: Implement my-match registration block**

Extend `mySummary` result shape:

```js
registrations: [
  {
    tournamentId,
    tournamentName,
    phase,
    statusLabel,
    withdrawDeadlineLabel,
    canWithdraw
  }
]
```

In `miniprogram/pages/my-match/index.wxml`, add a `mm-block` before `待录分`:

```xml
<view wx:if="{{summary.registrations.length > 0}}" class="mm-block">
  <view class="mm-block-title">
    <text>我的报名</text>
    <status-tag type="muted" text="{{summary.registrations.length}}" />
  </view>
  <view class="mm-row" wx:for="{{summary.registrations}}" wx:key="tournamentId" data-tournamentid="{{item.tournamentId}}" bindtap="onRegistrationRow">
    <view class="mm-row-l">
      <text class="mm-row-t">{{item.tournamentName}}</text>
      <text class="mm-row-s">{{item.withdrawDeadlineLabel ? ('可退至 ' + item.withdrawDeadlineLabel) : item.statusLabel}}</text>
    </view>
    <status-tag type="{{item.canWithdraw ? 'amber' : 'muted'}}" text="{{item.statusLabel}}" />
  </view>
</view>
```

Add:

```js
onRegistrationRow(e) {
  const { tournamentid } = e.currentTarget.dataset
  wx.navigateTo({ url: `/pages/tournament-detail/index?id=${tournamentid}` })
}
```

- [ ] **Step 7: Verify and commit list/workbench/my-match work**

Run:

```bash
cd miniprogram && npm test -- pages/match/__tests__/index.test.js pages/my-match/__tests__/index.test.js --runInBand
cd ../cloudfunctions/tournaments && npm test -- lib/__tests__/admin-console.test.js --runInBand
cd ../match-results && npm test -- lib/__tests__/handlers/my-summary.test.js --runInBand
```

Expected: all targeted tests pass.

Run:

```bash
git add miniprogram/pages/match miniprogram/pages/tournament-manage miniprogram/pages/my-match cloudfunctions/tournaments/lib/handlers/admin-console.js cloudfunctions/tournaments/lib/__tests__/admin-console.test.js cloudfunctions/match-results/lib/handlers/my-summary.js cloudfunctions/match-results/lib/__tests__/handlers/my-summary.test.js
git commit -m "feat: surface registration states across lists"
```

Expected: existing card/block structures remain intact.

### Task 8: Score Gates, Schedule Editing, And Result Adjustment

**Files:**
- Modify: `miniprogram/pages/tournament-brackets/index.js`
- Modify: `miniprogram/pages/tournament-brackets/index.wxml`
- Modify: `miniprogram/pages/tournament-score/index.js`
- Modify: `miniprogram/pages/tournament-score/index.wxml`
- Modify: `miniprogram/pages/tournament-score/__tests__/index.test.js`
- Modify: `cloudfunctions/match-results/lib/handlers/submit.js`
- Modify: `cloudfunctions/match-results/lib/handlers/batch.js`
- Modify: `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`

- [ ] **Step 1: Write score gate tests**

In `miniprogram/pages/tournament-score/__tests__/index.test.js`, add:

```js
test('draft schedule blocks score page with clear message', async () => {
  const { pageDef } = loadPage({
    tournament: { _id: 't1', scheduleStatus: 'draft', name: '5月周末赛' },
    matchResults: []
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })
  await ctx.refresh()
  expect(ctx.data.empty).toBe(true)
  expect(ctx.data.error).toBe('赛程发布后才能录入成绩')
})

test('admin adjust mode can edit confirmed rows', async () => {
  const { pageDef } = loadPage({
    app: { globalData: { isAdmin: true, currentMember: { _id: 'admin1' } } },
    tournament: { _id: 't1', scheduleStatus: 'published' },
    matchResults: [{ _id: 'r1', sourceMatchId: 'm1', resultStatus: 'confirmed', player1: { id: 'a' }, player2: { id: 'b' } }]
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1', mode: 'adjust' })
  await ctx.refresh()
  expect(ctx.data.adjustMode).toBe(true)
  expect(ctx.data.rowsByRound[0].matches[0].canAdminAdjust).toBe(true)
})
```

Run: `cd miniprogram && npm test -- pages/tournament-score/__tests__/index.test.js --runInBand`

Expected: fail until the page reads `scheduleStatus` and `mode=adjust`.

- [ ] **Step 2: Implement frontend gates**

In `tournament-score/index.js`, store `mode: options.mode || ''` and `adjustMode: options.mode === 'adjust'`. After loading tournament:

```js
if (tournament && tournament.scheduleStatus && tournament.scheduleStatus !== 'published') {
  this.setData({
    rowsByRound: [],
    empty: true,
    error: '赛程发布后才能录入成绩'
  })
  return
}
```

Decorate rows with `canAdminAdjust` when `adjustMode && isAdmin && row.resultStatus === 'confirmed'`. Reuse existing score-row behavior and labels; do not add a separate adjustment page.

- [ ] **Step 3: Add server-side score gates (TDD)**

First write failing tests in `cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js`:

```js
test('rejects score submission when scheduleStatus is draft', async () => {
  const ctx = makeBatchCtx({ tournament: { _id: 't1', scheduleStatus: 'draft' } })
  const res = await __test__.handleSubmitWithCtx(ctx, { tournamentId: 't1', matchId: 'm1', scores: [{ p1: 21, p2: 18 }] })
  expect(res).toEqual({ success: false, error: { code: 'SCHEDULE_NOT_PUBLISHED', message: '赛程发布后才能录入成绩' } })
})

test('rejects score submission when scheduleStatus is none', async () => {
  const ctx = makeBatchCtx({ tournament: { _id: 't1', scheduleStatus: 'none' } })
  const res = await __test__.handleSubmitWithCtx(ctx, { tournamentId: 't1', matchId: 'm1', scores: [{ p1: 21, p2: 18 }] })
  expect(res.error.code).toBe('SCHEDULE_NOT_PUBLISHED')
})

test('legacy tournament without scheduleStatus accepts score submission (backward compat)', async () => {
  const ctx = makeBatchCtx({ tournament: { _id: 't-legacy' } })
  const res = await __test__.handleSubmitWithCtx(ctx, { tournamentId: 't-legacy', matchId: 'm1', scores: [{ p1: 21, p2: 18 }] })
  expect(res.success).toBe(true)
})

test('admin adjust path can update confirmed rows after schedule is published', async () => {
  const ctx = makeBatchCtx({
    tournament: { _id: 't1', scheduleStatus: 'published' },
    isAdmin: true,
    existingRow: { resultStatus: 'confirmed' }
  })
  const res = await __test__.handleAdjustWithCtx(ctx, { tournamentId: 't1', matchId: 'm1', scores: [{ p1: 21, p2: 19 }] })
  expect(res.success).toBe(true)
  expect(ctx.recomputeTriggered).toBe(true)
})
```

Run: `cd cloudfunctions/match-results && npm test -- lib/__tests__/handlers/batch.test.js --runInBand`

Expected: fail because handlers do not yet check `scheduleStatus`.

Then implement in `cloudfunctions/match-results/lib/handlers/submit.js` and `batch.js`, before accepting score changes, read the tournament and reject:

```js
if (tournament.scheduleStatus && tournament.scheduleStatus !== 'published') {
  return fail('SCHEDULE_NOT_PUBLISHED', '赛程发布后才能录入成绩')
}
```

For admin reconfirm/adjust actions, allow confirmed rows to be updated, then trigger the existing points recomputation path used by `reconfirmMatch`.

Run the same test command — expect green.

- [ ] **Step 4: Add schedule edit impact confirmation plan hooks**

In `tournament-edit/index.js`, when opened with `mode=edit-schedule`, compare changed `matches/queues` to current `matchResultRows`. If affected confirmed rows exist, show a modal with these choices:

```js
const choices = [
  { key: 'keep_time_only', label: '保留比分，仅改场地/时间' },
  { key: 'invalidate_scores', label: '清空比分并重新录入' },
  { key: 'cancel', label: '取消编辑' }
]
```

Backend enforcement belongs in `match-results` and `tournament-brackets`: keep-time-only may only change `courtId` and `queueOrder`; invalidate writes `resultStatus = 'invalidated'`, `invalidatedAt`, `invalidatedBy`, and calls points recomputation.

- [ ] **Step 5: Verify and commit gates/results work**

Run:

```bash
cd miniprogram && npm test -- pages/tournament-score/__tests__/index.test.js --runInBand
cd ../cloudfunctions/match-results && npm test -- lib/__tests__/handlers/batch.test.js --runInBand
```

Expected: targeted score tests pass.

Run:

```bash
git add miniprogram/pages/tournament-brackets miniprogram/pages/tournament-score cloudfunctions/match-results/lib/handlers/submit.js cloudfunctions/match-results/lib/handlers/batch.js cloudfunctions/match-results/lib/__tests__/handlers/batch.test.js
git commit -m "feat: gate scores by published schedule"
```

Expected: score access is blocked until schedule publication and admin adjustment is explicit.

### Task 9: End-To-End Verification And Visual Guardrails

**Files:**
- No new production files unless verification exposes a regression.
- Create: `release-screenshots/wechat-registration-flow/` screenshots if browser or DevTools screenshots are captured.

- [ ] **Step 1: Run cloud helper and function tests**

Run:

```bash
cd cloudfunctions/_shared && npm test -- --runInBand
cd ../tournaments && npm test -- --runInBand
cd ../tournament-brackets && npm test -- --runInBand
cd ../tournament-registrations && npm test -- --runInBand
cd ../match-results && npm test -- --runInBand
```

Expected: every listed Jest command exits with code 0.

- [ ] **Step 2: Run mini program tests**

Run:

```bash
cd miniprogram
npm test -- --runInBand
```

Expected: all mini program Jest suites pass.

- [ ] **Step 3: Manual flow verification in WeChat DevTools or in-app browser**

Verify these flows with screenshots:

1. Create regular tournament: Step 1 has no max player cap; Step 2 has报名截止,球员,球场与时间; footer contains `上一步 / 下一步排程 / 发布并分享到微信`.
2. Publish registration: cloud action succeeds first; share path is `/pages/tournament-detail/index?id=<id>&entry=register`; `onShareAppMessage` returns the expected path (verify by tapping the share button in DevTools and inspecting the shared payload).
3. Member opens shared detail: hero shows date, court time such as `2号场：18:00-20:00`, registration deadline; no duplicate registration card; footer shows `分享 / 我要报名`.
4. Member registers: roster count changes; footer changes to `分享 / 退出报名`; withdrawal deadline shows as比赛日前一天 `24:00`.
5. Pending schedule member: no `报名状态` duplicate card and no disabled `等待赛程` button.
6. Admin pending detail: footer shows `分享 / 编辑 / 安排对局`; edit opens Step 1; arrange opens Step 3.
7. Schedule draft: members cannot see draft schedule or score rows.
8. Publish schedule: detail order is top phase strip, hero, schedule, roster, footer; registration module is gone.
9. Enter result: after scores are confirmed, detail enters results mode and admin can open adjustment.
10. Legacy tournament without `registrationPublishedAt` and `scheduleStatus`: list/detail/my-match/workbench still look like before. Score rows remain visible (backward compat for the legacy `canExposeScoreRows` branch).
11. Non-member opens share link → tournament-detail → `我要报名` → bounces to `edit-profile` with `from=tournament-register` → completes claim/registration → `navigateBack` returns to the same detail page with `entry=register`; back arrow at top-left returns to home, not to another detail page (verify nav stack via `getCurrentPages().length === 1`).
12. Concurrent capacity contention: open two devtools sessions sharing the same knockout-singles tournament at `maxPlayers - 1` slots. Both tap `我要报名` within 200 ms. Exactly one succeeds; the other shows `名额已满`. Inspect cloud logs to confirm `db.runTransaction` reported a conflict for the loser.
13. `entry=register` ignored when phase ≠ `registration_open`: open `…?id=<id>&entry=register` for a tournament that already moved to `schedule_published`. Expected: no auto-scroll and no register button — the `entry` parameter is silently ignored.
14. `scheduleNeedsRevision` lifecycle: trigger a member withdrawal that affects a published-schedule match without scores; verify admin workbench shows the `赛程需调整` task card; tap `已确认赛程`; reload workbench; the card disappears and `tournaments.scheduleNeedsRevision === false` in the DB.

Expected: screenshots show existing style structure is preserved; new styles are limited to local phase/registration modifiers.

- [ ] **Step 4: Style drift scan**

Run:

```bash
git diff -- miniprogram/pages/tournament-edit/index.wxss miniprogram/pages/tournament-detail/index.wxss miniprogram/pages/match/index.wxss miniprogram/pages/tournament-manage/index.wxss miniprogram/pages/my-match/index.wxss
```

Expected: no large page background rewrite, no broad override of `card`, `td-section`, `match-card`, `block`, `mm-block`, `footer-cta`, or component internals. New selectors are scoped to this feature, for example `.phase-strip`, `.registration-card`, `.footer-three`, `.schedule-revision`.

- [ ] **Step 5: Final status and commit**

Run:

```bash
git status --short
git log --oneline -8
```

Expected: only intentional feature files remain modified. Commit verification-only screenshot additions if they are useful to keep:

```bash
git add release-screenshots/wechat-registration-flow
git commit -m "test: capture wechat registration flow screenshots"
```

Expected: screenshots commit is optional; do not commit unrelated worktree changes.

## Self-Review Checklist

- Spec coverage: Tasks cover Section 5 phase model, Section 6 wizard publishing, Section 7 member registration/withdrawal, Section 8 admin pending/schedule/results, Section 9 list/workbench/my-match, Section 10 profile and score/bracket gates, Section 11 data fields, Section 12 permission/errors/concurrency, and Section 15 visual guardrails.
- Placeholder scan: This plan contains no unresolved placeholders and every task has concrete files, tests, commands, expected results, and implementation snippets.
- Type consistency: The plan consistently uses `registrationStatus: 'confirmed' | 'withdrew'`, `scheduleStatus: 'none' | 'draft' | 'published'`, `scheduleNeedsRevision: boolean`, and `confirmedCount: number`.
