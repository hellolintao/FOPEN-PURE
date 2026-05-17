# Mixed Regular Tournament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a regular-season mixed tournament category that schedules singles, doubles, and free-play each hour while keeping scoring in existing singles/doubles rankings.

**Architecture:** Store mixed as a tournament-level type only for event setup and display. Store every scheduled match with its own `type: 'singles' | 'doubles'`, and make match-results use the per-match type for player collection and points. Keep knockout support limited to singles/doubles.

**Tech Stack:** WeChat Mini Program JavaScript/WXML/WXSS, cloudfunctions on wx-server-sdk, Jest tests per package.

---

## File Map

- Modify `miniprogram/pages/tournament-edit/index.js`: default type, format/type chip behavior, min player count, schedule rebuild checks.
- Modify `miniprogram/pages/tournament-edit/index.wxml`: add mixed chip and disabled state for knockout.
- Modify `miniprogram/pages/tournament-edit/index.wxss`: disabled chip styling if no existing style covers it.
- Modify `miniprogram/utils/scheduler-mirror.js`: generate regular mixed slot plan and per-match types.
- Modify `cloudfunctions/tournament-brackets/lib/scheduler.js`: mirror the same scheduler behavior used by cloud tests.
- Modify `cloudfunctions/tournament-brackets/lib/__tests__/scheduler.test.js`: TDD coverage for mixed default schedule.
- Modify `cloudfunctions/tournaments/index.js`: validate tournament type includes mixed only for regular.
- Modify `cloudfunctions/tournaments/lib/validate.js`: shared validator docs or support if tests cover it.
- Modify `cloudfunctions/tournaments/lib/__tests__/validate.test.js`: TDD coverage for regular mixed and knockout mixed.
- Modify `cloudfunctions/tournament-registrations/index.js`: allow mixed registration type and keep it personal.
- Modify `cloudfunctions/tournament-brackets/index.js`: allow mixed bracket doc type for R1 mixed tournaments.
- Modify `cloudfunctions/match-results/index.js`: persist per-match tournamentType and collect playerIds by match type.
- Modify `cloudfunctions/match-results/lib/state.js`: use result.tournamentType for award entries and downstream playerIds.
- Modify `cloudfunctions/match-results/lib/__tests__/state.test.js`: TDD coverage for mixed singles/doubles scoring.
- Modify `miniprogram/components/schedule-board/index.js`: add single/double/free action sheet and assemble typed extra matches.
- Modify `miniprogram/pages/tournament-detail/index.js`: build person-level roster view.
- Modify `miniprogram/pages/tournament-detail/index.wxml`: render person-level roster for all tournament types.
- Modify `miniprogram/pages/tournament-detail/index.wxss`: remove or bypass doubles-only roster layout styles where needed.

---

### Task 1: Scheduler Supports Mixed Regular Hours

**Files:**
- Test: `cloudfunctions/tournament-brackets/lib/__tests__/scheduler.test.js`
- Modify: `cloudfunctions/tournament-brackets/lib/scheduler.js`
- Modify: `miniprogram/utils/scheduler-mirror.js`

- [ ] **Step 1: Write the failing tests**

Add tests under `describe('buildRegularSchedule · 常规赛填满日程', ...)`:

```js
test('混合常规赛：1 小时 → 单打 + 双打 + 自由拉球', () => {
  const courts = [{
    courtId: 'c1',
    name: '1 号场',
    slots: [
      '2026-05-25T08:00',
      '2026-05-25T08:20',
      '2026-05-25T08:40'
    ]
  }]
  const { matches, queues, freePlays } = buildRegularSchedule({
    registrations: reg(['p1', 'p2', 'p3', 'p4']),
    courts,
    type: 'mixed',
    now: 789
  })

  expect(matches).toHaveLength(2)
  expect(matches.map(m => m.type)).toEqual(['singles', 'doubles'])
  expect(matches[0].player1.partnerId).toBeUndefined()
  expect(matches[1].player1.partnerId).toBeDefined()
  expect(matches[1].player2.partnerId).toBeDefined()
  expect(freePlays).toHaveLength(1)
  expect(queues[0].items.map(it => it.kind)).toEqual(['match', 'match', 'freePlay'])
})

test('混合常规赛：2 小时 → 每小时重复单打 + 双打 + 自由拉球', () => {
  const courts = [{
    courtId: 'c1',
    name: '1 号场',
    slots: [
      '2026-05-25T08:00',
      '2026-05-25T08:20',
      '2026-05-25T08:40',
      '2026-05-25T09:00',
      '2026-05-25T09:20',
      '2026-05-25T09:40'
    ]
  }]
  const { matches, queues, freePlays } = buildRegularSchedule({
    registrations: reg(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']),
    courts,
    type: 'mixed',
    now: 790
  })

  expect(matches.map(m => m.type)).toEqual(['singles', 'doubles', 'singles', 'doubles'])
  expect(freePlays.map(fp => fp.queueOrder)).toEqual([2, 5])
  expect(queues[0].items.map(it => it.kind)).toEqual([
    'match',
    'match',
    'freePlay',
    'match',
    'match',
    'freePlay'
  ])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand lib/__tests__/scheduler.test.js`

Expected: FAIL because mixed matches either have no mixed-specific singles/doubles split or lack per-match `type`.

- [ ] **Step 3: Implement scheduler changes**

In both scheduler files:

```js
function buildRegularSlotPlan(courts, type) {
  const cells = []
  const matchCells = []

  courts.forEach(court => {
    const grouped = groupSlotsByHour(court.slots || [])
    grouped.forEach(group => {
      group.slots.forEach((slot, index) => {
        const kind = index < 2 ? 'match' : 'freePlay'
        const matchType = type === 'mixed'
          ? (index === 0 ? 'singles' : index === 1 ? 'doubles' : null)
          : (kind === 'match' ? type : null)
        const cell = { courtId: court.courtId, slot, kind, matchType }
        cells.push(cell)
        if (kind === 'match') matchCells.push(cell)
      })
    })
  })

  return { cells, matchCells }
}
```

Generate matches one cell at a time so mixed can request 2 or 4 players per match:

```js
const matches = plan.matchCells
  .map((cell, index) => generateBalancedRegularMatch({
    registrations: shuffledRegs,
    counts,
    index,
    type: cell.matchType || type,
    now: timestamp
  }))
  .filter(Boolean)
```

Each regular match includes `type`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand lib/__tests__/scheduler.test.js`

Expected: PASS.

---

### Task 2: Tournament Type Validation Allows Regular Mixed Only

**Files:**
- Test: `cloudfunctions/tournaments/lib/__tests__/validate.test.js`
- Modify: `cloudfunctions/tournaments/index.js`
- Modify: `cloudfunctions/tournaments/lib/validate.js`

- [ ] **Step 1: Write the failing tests**

Add tests:

```js
test('regular mixed tournament is valid', () => {
  const errors = validateTournamentPayload({
    name: '混合常规赛',
    type: 'mixed',
    format: 'regular',
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    schedulePlan: validSchedulePlan(),
    pointsRules: validPointsRules()
  }, { isDraft: false })
  expect(errors).toEqual([])
})

test('knockout mixed tournament is invalid', () => {
  const errors = validateTournamentPayload({
    name: '混合淘汰赛',
    type: 'mixed',
    format: 'knockout',
    startDate: '2026-05-25',
    seasonId: 'season_2026',
    maxPlayers: 8,
    schedulePlan: validSchedulePlan(),
    pointsRules: validPointsRules()
  }, { isDraft: false })
  expect(errors).toContain('淘汰赛不支持 mixed 类型')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloudfunctions/tournaments && npm test -- --runInBand lib/__tests__/validate.test.js`

Expected: FAIL because mixed is not accepted.

- [ ] **Step 3: Implement validation**

Use a helper in `cloudfunctions/tournaments/index.js`:

```js
const TOURNAMENT_TYPES = ['singles', 'doubles', 'mixed']

if (!data.type || !TOURNAMENT_TYPES.includes(data.type)) {
  errors.push('赛事类型必须是 singles、doubles 或 mixed')
}
if (data.format === 'knockout' && data.type === 'mixed') {
  errors.push('淘汰赛不支持 mixed 类型')
}
```

Mirror the same accepted type set wherever shared validation repeats it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloudfunctions/tournaments && npm test -- --runInBand lib/__tests__/validate.test.js`

Expected: PASS.

---

### Task 3: Match Results Persist Per-Match Type

**Files:**
- Test: `cloudfunctions/match-results/lib/__tests__/state.test.js`
- Modify: `cloudfunctions/match-results/index.js`
- Modify: `cloudfunctions/match-results/lib/state.js`

- [ ] **Step 1: Write the failing tests**

Add tests proving mixed tournament rows score by row type:

```js
test('mixed regular singles row awards 2 entries as singles', async () => {
  const db = makeDb({
    tournaments: [{ _id: 'TM', type: 'mixed', format: 'regular', seasonId: 'S1', pointsRules: { winLoss: { win: 20, loss: 10 } } }],
    tournament_registrations: [{ tournamentId: 'TM', playerId: 'A' }],
    match_results: [{
      _id: 'result_TM_s1',
      tournamentId: 'TM',
      sourceMatchId: 's1',
      matchKind: 'regularRound',
      tournamentType: 'singles',
      player1: { id: 'A' },
      player2: { id: 'B' },
      playerIds: ['A', 'B'],
      resultStatus: 'pending'
    }]
  })
  const svc = createMatchStateService({ db, awardLib, scoreRule })
  await svc.submitResult({ matchId: 's1', score: { sets: [{ a: 4, b: 2 }] }, submitter: { _id: 'admin', isAdmin: true } })
  const row = db.__all().match_results.find(x => x._id === 'result_TM_s1')
  expect(row.pointsAwarded.entries).toEqual([
    { memberId: 'A', points: 20, role: 'winner' },
    { memberId: 'B', points: 10, role: 'loser' }
  ])
})

test('mixed regular doubles row awards 4 entries as doubles', async () => {
  const db = makeDb({
    tournaments: [{ _id: 'TM', type: 'mixed', format: 'regular', seasonId: 'S1', pointsRules: { winLoss: { win: 20, loss: 10 } } }],
    tournament_registrations: [{ tournamentId: 'TM', playerId: 'A' }],
    match_results: [{
      _id: 'result_TM_d1',
      tournamentId: 'TM',
      sourceMatchId: 'd1',
      matchKind: 'regularRound',
      tournamentType: 'doubles',
      player1: { id: 'A', partnerId: 'B' },
      player2: { id: 'C', partnerId: 'D' },
      playerIds: ['A', 'B', 'C', 'D'],
      resultStatus: 'pending'
    }]
  })
  const svc = createMatchStateService({ db, awardLib, scoreRule })
  await svc.submitResult({ matchId: 'd1', score: { sets: [{ a: 4, b: 2 }] }, submitter: { _id: 'admin', isAdmin: true } })
  const row = db.__all().match_results.find(x => x._id === 'result_TM_d1')
  expect(row.pointsAwarded.entries.map(e => e.memberId)).toEqual(['A', 'B', 'C', 'D'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloudfunctions/match-results && npm test -- --runInBand lib/__tests__/state.test.js`

Expected: FAIL because state service uses tournament.type for award entries.

- [ ] **Step 3: Implement per-match type resolution**

Add helper:

```js
function resolveMatchType(match, tournament) {
  return (match && (match.type || match.tournamentType)) || (tournament && tournament.type) || 'singles'
}
```

Use it in:

- `match-results/index.js` `handleBulkUpsert`: `const matchType = resolveMatchType(m, tournament)`, then `tournamentType: matchType`, `playerIds: collectPlayerIds(m, matchType)`.
- `match-results/lib/state.js` `confirmOne`: pass `resolveMatchType(result, tournament)` to `awardLib.buildAwardEntries`.
- `match-results/lib/state.js` downstream playerIds: pass `resolveMatchType(nextRow || result, tournament)` where computing next result participants.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cloudfunctions/match-results && npm test -- --runInBand lib/__tests__/state.test.js`

Expected: PASS.

---

### Task 4: Create Page and Schedule Board UI Logic

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.js`
- Modify: `miniprogram/pages/tournament-edit/index.wxml`
- Modify: `miniprogram/pages/tournament-edit/index.wxss`
- Modify: `miniprogram/components/schedule-board/index.js`

- [ ] **Step 1: Update form defaults and chip behavior**

Implementation shape:

```js
form: {
  name: '',
  location: '海峡奥体网球场',
  startDate: todayISODate(),
  type: 'mixed',
  format: 'regular',
  maxPlayers: 8,
  description: ''
}
```

In `onChipTap`:

```js
if (k === 'format') {
  const patch = { 'form.format': v }
  if (v === 'knockout' && this.data.form.type === 'mixed') patch['form.type'] = 'singles'
  if (v === 'regular' && !this.data.form.type) patch['form.type'] = 'mixed'
  this.setData(patch)
  return
}
if (k === 'type' && v === 'mixed' && this.data.form.format === 'knockout') {
  wx.showToast({ title: '淘汰赛不支持混合', icon: 'none' })
  return
}
this.setData({ [`form.${k}`]: v })
```

`_minPlayers()` returns 4 for `mixed`.

- [ ] **Step 2: Update WXML chips**

Add:

```xml
<text class="chip {{form.type === 'mixed' ? 'active' : ''}} {{form.format === 'knockout' ? 'disabled' : ''}}" bindtap="onChipTap" data-k="type" data-v="mixed">混合</text>
```

- [ ] **Step 3: Update schedule board add actions**

Change empty action sheet:

```js
itemList: ['单打', '双打', '自由拉球']
```

For singles:

```js
this.openAddMatchPicker({ courtId, slotIndex, matchType: 'singles', requiredCount: 2, title: '选择单打球员' })
```

For doubles:

```js
this.openAddMatchPicker({ courtId, slotIndex, matchType: 'doubles', requiredCount: 4, title: '选择双打球员' })
```

`assemblePlayerObjects(memberIds, matchId, matchType)` uses `matchType === 'doubles'` to build partners and returns `{ ..., type: matchType, matchKind: 'extra' }`.

- [ ] **Step 4: Run miniprogram tests**

Run: `cd miniprogram && npm test -- --runInBand`

Expected: PASS.

---

### Task 5: Details Roster Shows People, Not Teams

**Files:**
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-detail/index.wxml`
- Modify: `miniprogram/pages/tournament-detail/index.wxss`

- [ ] **Step 1: Build person roster in JS**

After loading raw registrations:

```js
const rosterPeople = buildRosterPeople(rawRegs, avatarMap)
this.setData({ registrations: rosterPeople })
```

Helper:

```js
function buildRosterPeople(rawRegs, avatarMap) {
  const seen = new Set()
  const people = []
  const push = (id, name, seed) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    people.push({
      _id: id,
      playerId: id,
      playerName: name || '',
      seed,
      avatarUrl: avatarMap[id] || '',
      playerInitial: firstChar(name),
      displayStatus: 'confirmed'
    })
  }
  rawRegs.forEach(reg => {
    push(reg.playerId, reg.playerName, reg.seed)
    push(reg.partnerId, reg.partnerName, reg.seed)
  })
  return people
}
```

- [ ] **Step 2: Simplify WXML roster card**

Render one avatar and one name for every item. Remove `tournament.type === 'doubles'` branch.

- [ ] **Step 3: Run miniprogram tests**

Run: `cd miniprogram && npm test -- --runInBand`

Expected: PASS.

---

### Task 6: Cross-Package Verification

**Files:**
- No source changes unless verification exposes a root-cause bug.

- [ ] **Step 1: Run relevant test suites**

Run:

```bash
cd cloudfunctions/tournament-brackets && npm test -- --runInBand
cd ../tournaments && npm test -- --runInBand
cd ../match-results && npm test -- --runInBand
cd ../../miniprogram && npm test -- --runInBand
```

Expected: all selected suites exit 0.

- [ ] **Step 2: Inspect final diff**

Run: `git diff --stat && git diff --check`

Expected: no whitespace errors and diff limited to mixed tournament feature files plus this plan.
