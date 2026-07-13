# Group Knockout Detail State Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align tournament-detail group-knockout phases with raw draft/completed lifecycle states without changing normal phases or cancelled-history visibility.

**Architecture:** Keep the fix inside the existing `buildGroupKnockoutDetailPhaseState` boundary. Compute one effective phase with lifecycle fallbacks, then let the existing phase steps, visibility flags, and footer-action logic consume it unchanged.

**Tech Stack:** WeChat Mini Program JavaScript/WXML, Jest 29.

## Global Constraints

- `draft` must resolve to `group_draft` even if a stale published group phase is stored.
- Missing group phase with `completed` or `settled` must resolve to `completed`.
- `cancelled` must retain an explicitly stored phase so historical bracket/results remain viewable.
- Do not change WXML order, status-title helpers, cloud functions, or stored data.
- Do not commit implementation files unless the user requests it.

---

### Task 1: Resolve the effective group-knockout detail phase

**Files:**
- Modify: `miniprogram/pages/tournament-detail/__tests__/index.test.js`
- Modify: `miniprogram/pages/tournament-detail/index.js:712-759`

**Interfaces:**
- Consumes: `isCompletedStatus(status: string): boolean`, already imported from `utils/tournament-status`.
- Produces: the existing detail-state object with a corrected `phase`, `showResultsSection`, `phaseSteps`, and `footerActions`.

- [ ] **Step 1: Add three state-consistency regression tests**

Add tests beside the existing group-knockout phase tests:

```js
test('legacy completed group knockout without phase shows settled detail state', async () => {
  const ctx = await loadDetail({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      type: 'singles',
      status: 'completed',
      scheduleStatus: 'none'
    },
    isAdmin: true
  })

  expect(ctx.data.phase).toBe('completed')
  expect(ctx.data.showResultsSection).toBe(true)
  expect(ctx.data.footerActions.map(action => action.key)).toEqual(['share', 'viewBracket'])
})

test('draft group knockout ignores a stale published phase', async () => {
  const ctx = await loadDetail({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      type: 'singles',
      status: 'draft',
      scheduleStatus: 'none',
      groupKnockoutPhase: 'group_published'
    },
    isAdmin: true
  })

  expect(ctx.data.phase).toBe('group_draft')
  expect(ctx.data.showResultsSection).toBe(false)
  expect(ctx.data.footerActions.map(action => action.key)).toEqual(['share', 'edit', 'arrangeGroupBracket'])
})

test('cancelled group knockout keeps an explicit completed phase for history', async () => {
  const ctx = await loadDetail({
    tournament: {
      _id: 't1',
      format: 'group_knockout',
      type: 'singles',
      status: 'cancelled',
      scheduleStatus: 'none',
      groupKnockoutPhase: 'completed'
    },
    isAdmin: true
  })

  expect(ctx.data.tournamentDisplay.statusLabel).toBe('已取消')
  expect(ctx.data.phase).toBe('completed')
  expect(ctx.data.showResultsSection).toBe(true)
  expect(ctx.data.footerActions.map(action => action.key)).toEqual(['share', 'viewBracket'])
})
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run:

```bash
cd miniprogram
npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js
```

Expected: the legacy-completed and stale-draft tests fail because the current code resolves phases to `group_draft` and `group_published`; the cancelled-history regression passes.

- [ ] **Step 3: Implement the minimal effective-phase fallback**

Replace the current phase assignment in `buildGroupKnockoutDetailPhaseState` with:

```js
const phase = tournament.status === 'draft'
  ? 'group_draft'
  : (tournament.groupKnockoutPhase || (isCompletedStatus(tournament.status) ? 'completed' : 'group_draft'))
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run the Step 2 command again.

Expected: 1 suite and 62 tests pass.

- [ ] **Step 5: Run full verification and adversarial review**

Run:

```bash
cd miniprogram
npm test -- --runInBand
```

Expected: 35 suites and 399 tests pass. Then enumerate draft, registration/published, knockout, completed, settled, and cancelled group states; confirm WXML order remains unchanged; request an independent read-only code review of the focused diff.
