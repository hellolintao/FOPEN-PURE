# Tournament Detail Results And Season Association Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show final tournament results on the tournament detail page after settlement, move points rules near the bottom, keep delete last, and fix newly created tournaments so they attach to the active season and display the season name.

**Architecture:** Keep the tournament detail page as the single read surface. Reuse `match-results.listByTournament` to build both settlement status and final result display; add a small season selection helper behind the `seasons.getCurrent` cloud action, then make tournament creation and detail display consume that resolved season consistently.

**Tech Stack:** WeChat Mini Program WXML/WXSS/JS, WeChat cloud functions with `wx-server-sdk`, Jest through `miniprogram/node_modules`.

---

## Root Cause Evidence

The season association bug has two causes:

- `miniprogram/pages/tournament-edit/index.js` calls `seasons` with `action: 'getCurrent'`, but `cloudfunctions/seasons/index.js` does not implement `getCurrent`. The create flow therefore falls back to `season_<year>`.
- `miniprogram/pages/season-manage/index.js` creates season ids as `season_<Date.now()>`, so `season_<year>` often does not match the actual active season document.
- `miniprogram/pages/tournament-detail/index.js` reads the raw `tournaments` document directly and renders `tournament.seasonName || '—'`. New tournament documents store `seasonId`, not `seasonName`, so the detail page can display `—` even when `seasonId` is valid.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `cloudfunctions/seasons/lib/current.js` | Create | Pure helper for selecting the season that covers a tournament date. |
| `cloudfunctions/seasons/lib/__tests__/current.test.js` | Create | Covers active/date matching and fallback ordering. |
| `cloudfunctions/seasons/index.js` | Modify | Adds `getCurrent` action that returns `{ success, data: { season, seasonId, name } }`. |
| `miniprogram/pages/tournament-edit/index.js` | Modify | Passes tournament start date into `getCurrent` and reads the returned active season id. |
| `miniprogram/pages/tournament-edit/__tests__/index.test.js` | Modify | Covers resolving a timestamp-style active season id. |
| `miniprogram/pages/tournament-detail/index.js` | Modify | Resolves `seasonName`, builds final result display, and keeps state in sync after refresh. |
| `miniprogram/pages/tournament-detail/index.wxml` | Modify | Adds final results section, moves points rules below roster, keeps delete last. |
| `miniprogram/pages/tournament-detail/index.wxss` | Modify | Styles final results using the existing detail page visual language. |
| `miniprogram/pages/tournament-detail/__tests__/index.test.js` | Modify | Covers season name, final results visibility/content, and block ordering. |
| `docs/superpowers/plans/2026-05-19-tournament-detail-results-and-season.md` | Create | This implementation plan. |

## Repo Workflow Note

The working tree already contains unrelated uncommitted changes. Each task below stages only the files listed for that task. Do not revert unrelated files.

---

### Task 1: Fix Current Season Resolution At Creation

**Files:**
- Create: `cloudfunctions/seasons/lib/current.js`
- Create: `cloudfunctions/seasons/lib/__tests__/current.test.js`
- Modify: `cloudfunctions/seasons/index.js`
- Modify: `miniprogram/pages/tournament-edit/index.js`
- Modify: `miniprogram/pages/tournament-edit/__tests__/index.test.js`

- [ ] **Step 1: Write the failing season selection tests**

Create `cloudfunctions/seasons/lib/__tests__/current.test.js`:

```js
const { selectCurrentSeason } = require('../current')

describe('selectCurrentSeason', () => {
  test('prefers active season that contains the target date', () => {
    const result = selectCurrentSeason([
      { _id: 'season_2025', name: '2025', status: 'active', startDate: '2025-01-01', endDate: '2025-12-31' },
      { _id: 'season_1740000000000', name: '2026 春季', status: 'active', startDate: '2026-01-01', endDate: '2026-12-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_1740000000000')
  })

  test('uses date coverage before generic active fallback', () => {
    const result = selectCurrentSeason([
      { _id: 'season_future', name: 'Future', status: 'active', startDate: '2027-01-01', endDate: '2027-12-31' },
      { _id: 'season_match', name: 'Match', status: 'ended', startDate: '2026-01-01', endDate: '2026-12-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_match')
  })

  test('falls back to latest active season when no date range matches', () => {
    const result = selectCurrentSeason([
      { _id: 'season_old', name: 'Old', status: 'active', startDate: '2024-01-01', endDate: '2024-12-31' },
      { _id: 'season_new', name: 'New', status: 'active', startDate: '2025-01-01', endDate: '2025-12-31' }
    ], '2026-05-19')

    expect(result._id).toBe('season_new')
  })

  test('returns null for empty input', () => {
    expect(selectCurrentSeason([], '2026-05-19')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
./miniprogram/node_modules/.bin/jest cloudfunctions/seasons/lib/__tests__/current.test.js --runInBand --config '{"testEnvironment":"node","testMatch":["**/__tests__/**/*.test.js"],"modulePathIgnorePatterns":["<rootDir>/.superpowers"]}'
```

Expected: FAIL because `cloudfunctions/seasons/lib/current.js` does not exist.

- [ ] **Step 3: Add the season selection helper**

Create `cloudfunctions/seasons/lib/current.js`:

```js
function toTime(dateLike) {
  if (!dateLike) return NaN
  const time = new Date(dateLike).getTime()
  return Number.isFinite(time) ? time : NaN
}

function coversDate(season, targetTime) {
  const start = toTime(season && season.startDate)
  const end = toTime(season && season.endDate)
  if (!Number.isFinite(targetTime) || !Number.isFinite(start)) return false
  if (!Number.isFinite(end)) return targetTime >= start
  return targetTime >= start && targetTime <= end
}

function compareLatestStart(a, b) {
  return toTime(b.startDate) - toTime(a.startDate)
}

function selectCurrentSeason(seasons, targetDate) {
  const rows = Array.isArray(seasons) ? seasons.filter(Boolean) : []
  if (rows.length === 0) return null

  const targetTime = toTime(targetDate)
  const covering = rows.filter(season => coversDate(season, targetTime)).sort((a, b) => {
    if ((a.status === 'active') !== (b.status === 'active')) return a.status === 'active' ? -1 : 1
    return compareLatestStart(a, b)
  })
  if (covering.length > 0) return covering[0]

  const active = rows.filter(season => season.status === 'active').sort(compareLatestStart)
  if (active.length > 0) return active[0]

  return rows.slice().sort(compareLatestStart)[0] || null
}

module.exports = { selectCurrentSeason }
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
./miniprogram/node_modules/.bin/jest cloudfunctions/seasons/lib/__tests__/current.test.js --runInBand --config '{"testEnvironment":"node","testMatch":["**/__tests__/**/*.test.js"],"modulePathIgnorePatterns":["<rootDir>/.superpowers"]}'
```

Expected: PASS.

- [ ] **Step 5: Add `seasons.getCurrent`**

Modify `cloudfunctions/seasons/index.js` near the imports:

```js
const { selectCurrentSeason } = require('./lib/current')
```

Add this switch case before `default`:

```js
    case 'getCurrent': {
      const targetDate = event.date || (data && data.date) || new Date().toISOString().slice(0, 10)
      const result = await collection
        .where({})
        .orderBy('startDate', 'desc')
        .limit(100)
        .get()
      const season = selectCurrentSeason(result.data || [], targetDate)
      if (!season) {
        return { success: false, error: { code: 'NOT_FOUND', message: '未找到当前赛季' } }
      }
      return {
        success: true,
        data: {
          season,
          seasonId: season._id,
          name: season.name
        }
      }
    }
```

- [ ] **Step 6: Write the failing tournament-edit season id test**

Append this test to `miniprogram/pages/tournament-edit/__tests__/index.test.js`:

```js
test('resolveSeasonId uses active season returned by seasons.getCurrent', async () => {
  const def = loadPage()
  const ctx = makeCtx(def)
  wx.cloud.callFunction.mockResolvedValueOnce({
    result: {
      success: true,
      data: {
        seasonId: 'season_1740000000000',
        season: { _id: 'season_1740000000000', name: '2026 春季' }
      }
    }
  })

  await expect(ctx.resolveSeasonId('2026-05-19')).resolves.toBe('season_1740000000000')
  expect(wx.cloud.callFunction).toHaveBeenCalledWith({
    name: 'seasons',
    data: { action: 'getCurrent', date: '2026-05-19' }
  })
})
```

- [ ] **Step 7: Run the tournament-edit test and verify it fails**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-edit/__tests__/index.test.js --runInBand
```

Expected: FAIL because `resolveSeasonId()` currently calls `getCurrent` without `date`.

- [ ] **Step 8: Update `resolveSeasonId()`**

Replace `resolveSeasonId()` in `miniprogram/pages/tournament-edit/index.js` with:

```js
  async resolveSeasonId(startDate) {
    const year = String(new Date(startDate).getFullYear())
    const r = await wx.cloud.callFunction({
      name: 'seasons',
      data: { action: 'getCurrent', date: startDate }
    }).catch(() => null)
    const data = r && r.result && r.result.data
    return (data && data.seasonId)
      || (data && data.season && data.season._id)
      || (data && data._id)
      || `season_${year}`
  }
```

- [ ] **Step 9: Verify Task 1 tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
./miniprogram/node_modules/.bin/jest cloudfunctions/seasons/lib/__tests__/current.test.js cloudfunctions/seasons/lib/__tests__/get-current.test.js --runInBand --config '{"testEnvironment":"node","testMatch":["**/__tests__/**/*.test.js"],"modulePathIgnorePatterns":["<rootDir>/.superpowers"]}'
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-edit/__tests__/index.test.js --runInBand
```

Expected: both commands PASS.

- [ ] **Step 10: Commit Task 1 if requested**

Run only if the user asks to commit:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git add cloudfunctions/seasons/lib/current.js cloudfunctions/seasons/lib/__tests__/current.test.js cloudfunctions/seasons/index.js miniprogram/pages/tournament-edit/index.js miniprogram/pages/tournament-edit/__tests__/index.test.js
git commit -m "Fix tournament season resolution"
```

---

### Task 2: Resolve Season Name On Tournament Detail

**Files:**
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-detail/__tests__/index.test.js`

- [ ] **Step 1: Write the failing detail season name test**

Update the `loadPage()` helper in `miniprogram/pages/tournament-detail/__tests__/index.test.js` so it accepts `options.seasons` and routes `wx.cloud.callFunction({ name: 'seasons', data: { action: 'get', id } })` to that map:

```js
  const seasons = options.seasons || {}
```

Inside `wx.cloud.callFunction`, add this branch before the default response:

```js
        if (name === 'seasons') {
          const id = data && data.id
          return Promise.resolve({ result: { data: seasons[id] || null } })
        }
```

The mock callback must accept the full argument:

```js
      callFunction: jest.fn(({ name, data }) => {
```

Append this test:

```js
test('loads seasonName from seasonId for detail hero', async () => {
  const { pageDef } = loadPage({
    tournament: { _id: 't1', name: '五月排位赛', type: 'singles', format: 'regular', status: 'upcoming', seasonId: 'season_1740000000000' },
    seasons: {
      season_1740000000000: { _id: 'season_1740000000000', name: '2026 春季赛' }
    }
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.loadTournamentDetail()

  expect(ctx.data.tournament.seasonName).toBe('2026 春季赛')
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand
```

Expected: FAIL because `loadTournamentDetail()` does not resolve `seasonName`.

- [ ] **Step 3: Add season enrichment helper**

Add this method inside the `Page({ ... })` object in `miniprogram/pages/tournament-detail/index.js` before `loadTournamentDetail()`:

```js
  async enrichTournamentSeason(tournament) {
    if (!tournament || tournament.seasonName || !tournament.seasonId) return tournament
    try {
      const res = await wx.cloud.callFunction({
        name: 'seasons',
        data: { action: 'get', id: tournament.seasonId }
      })
      const season = res && res.result && res.result.data
      if (!season || !season.name) return tournament
      return { ...tournament, seasonName: season.name }
    } catch (err) {
      console.warn('[tournament-detail] load season failed', err)
      return tournament
    }
  },
```

- [ ] **Step 4: Use the helper in `loadTournamentDetail()`**

In `loadTournamentDetail()`, replace direct use of `result.data` with an enriched tournament:

```js
      const tournament = await this.enrichTournamentSeason(result.data)
      const me = app.globalData && app.globalData.currentMember
      const isCreator = !!(me && tournament.createdBy && tournament.createdBy === me._id)
      const isAdmin = !!((app.globalData && app.globalData.isAdmin) || isCreator)
      const accessState = this.buildAccessState({
        tournament,
        resultSummary: this.data.resultSummary,
        isAdmin,
        isParticipant: this.data.isParticipant
      })
      this.enableShareMenu(accessState.shareEnabled)
      this.setData({
        tournament,
        tournamentDisplay: buildTournamentDisplay(tournament, this.data.resultSummary),
        isAdmin,
        ...accessState,
        loading: false
      })
```

- [ ] **Step 5: Verify Task 2**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand
```

Expected: PASS for existing tests and the new season-name test.

- [ ] **Step 6: Commit Task 2 if requested**

Run only if the user asks to commit:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git add miniprogram/pages/tournament-detail/index.js miniprogram/pages/tournament-detail/__tests__/index.test.js
git commit -m "Show tournament season name on detail"
```

---

### Task 3: Build Final Result Display Data

**Files:**
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-detail/__tests__/index.test.js`

- [ ] **Step 1: Write failing result-display tests**

Append these tests to `miniprogram/pages/tournament-detail/__tests__/index.test.js`:

```js
test('shows final result display only when all playable matches are confirmed', async () => {
  const { pageDef } = loadPage({
    tournament: { _id: 't1', name: 'Finals', type: 'singles', format: 'regular', status: 'completed' },
    matchResults: [
      {
        _id: 'r1',
        tournamentId: 't1',
        round: 1,
        position: 1,
        player1: { id: 'A', name: 'A' },
        player2: { id: 'B', name: 'B' },
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null },
        winner: { id: 'A', name: 'A' },
        resultStatus: 'confirmed',
        pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] }
      }
    ]
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.resultDisplay.visible).toBe(true)
  expect(ctx.data.resultDisplay.completedText).toBe('已完成 1 / 1 场')
  expect(ctx.data.resultDisplay.groups[0].matches[0]).toMatchObject({
    p1Label: 'A',
    p2Label: 'B',
    scoreText: '4:2',
    winnerLabel: 'A',
    pointsText: '+20 / +10'
  })
})

test('hides final result display while any playable match is unconfirmed', async () => {
  const { pageDef } = loadPage({
    tournament: { _id: 't1', name: 'Finals', type: 'singles', format: 'regular', status: 'ongoing' },
    matchResults: [
      { player1: { id: 'A', name: 'A' }, player2: { id: 'B', name: 'B' }, resultStatus: 'confirmed', score: { sets: [{ a: 4, b: 1 }] } },
      { player1: { id: 'C', name: 'C' }, player2: { id: 'D', name: 'D' }, resultStatus: 'submitted', score: { sets: [{ a: 4, b: 3 }] } }
    ]
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  expect(ctx.data.resultDisplay.visible).toBe(false)
})

test('formats doubles and tiebreak result rows without inventing missing points', async () => {
  const { pageDef } = loadPage({
    tournament: { _id: 't1', name: 'Doubles', type: 'doubles', format: 'regular', status: 'completed' },
    matchResults: [
      {
        round: 1,
        position: 1,
        player1: { id: 'A', name: 'A', partnerId: 'B', partnerName: 'B' },
        player2: { id: 'C', name: 'C', partnerId: 'D', partnerName: 'D' },
        score: { sets: [{ a: 3, b: 3 }], tiebreak: '7-5' },
        winner: { id: 'A', name: 'A', partnerId: 'B', partnerName: 'B' },
        resultStatus: 'confirmed'
      }
    ]
  })
  const ctx = makeCtx(pageDef, { tournamentId: 't1' })

  await ctx.refresh()

  const row = ctx.data.resultDisplay.groups[0].matches[0]
  expect(row.p1Label).toBe('A / B')
  expect(row.p2Label).toBe('C / D')
  expect(row.scoreText).toBe('3:3 (7-5)')
  expect(row.pointsText).toBe('')
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand
```

Expected: FAIL because `resultDisplay` does not exist.

- [ ] **Step 3: Add result state fields**

In `miniprogram/pages/tournament-detail/index.js`, add these data fields:

```js
    matchResultRows: [],
    resultDisplay: { visible: false, completedText: '', leaders: [], groups: [] },
```

- [ ] **Step 4: Store rows and sync display after refresh**

Update `refresh()` so `resultDisplay` is built after both tournament and results have loaded:

```js
  async refresh() {
    await this.ensureIdentity()
    await Promise.all([
      this.loadTournamentDetail(),
      this.loadRegistrations(),
      this.loadBrackets(),
      this.loadFreePlays(),
      this.loadResultSummary()
    ])
    this.syncTournamentDisplayState()
    this.syncResultDisplayState()
    this._rebuildScheduleView()
  },
```

Add the page method:

```js
  syncResultDisplayState() {
    this.setData({
      resultDisplay: buildResultDisplay(this.data.matchResultRows, this.data.tournament)
    })
  },
```

Update `loadResultSummary()`:

```js
      const rows = unpackMatchResultRows(res)
      this.setData({
        matchResultRows: rows,
        resultSummary: buildResultSummary(rows)
      })
```

In the catch branch, set both:

```js
      this.setData({
        matchResultRows: [],
        resultSummary: null,
        resultDisplay: { visible: false, completedText: '', leaders: [], groups: [] }
      })
```

- [ ] **Step 5: Add pure result display helpers**

Append these helpers near the existing `buildResultSummary()` helper:

```js
function emptyResultDisplay() {
  return { visible: false, completedText: '', leaders: [], groups: [] }
}

function isPlayableResult(row) {
  return !!(row && !row.bye && row.player1 && row.player2 && row.player1.id && row.player2.id)
}

function buildResultDisplay(rows, tournament) {
  const playable = (rows || []).filter(isPlayableResult)
  if (playable.length === 0) return emptyResultDisplay()
  if (!playable.every(row => row.resultStatus === 'confirmed')) return emptyResultDisplay()

  const sorted = playable.slice().sort((a, b) => {
    if ((a.round || 0) !== (b.round || 0)) return (a.round || 0) - (b.round || 0)
    if ((a.position || 0) !== (b.position || 0)) return (a.position || 0) - (b.position || 0)
    return (a.queueOrder || 0) - (b.queueOrder || 0)
  })
  const groupsMap = new Map()
  sorted.forEach(row => {
    const round = row.round || 1
    if (!groupsMap.has(round)) groupsMap.set(round, [])
    groupsMap.get(round).push(buildResultMatchRow(row))
  })

  return {
    visible: true,
    completedText: `已完成 ${playable.length} / ${playable.length} 场`,
    leaders: buildResultLeaders(sorted, tournament || {}),
    groups: [...groupsMap.entries()].map(([round, matches]) => ({
      round,
      label: `ROUND ${round < 10 ? '0' : ''}${round}`,
      matches
    }))
  }
}

function buildResultMatchRow(row) {
  return {
    matchId: row._id || row.sourceMatchId || '',
    round: row.round || 1,
    position: row.position || 0,
    p1Label: sideLabel(row.player1),
    p2Label: sideLabel(row.player2),
    scoreText: scoreText(row.score),
    winnerLabel: sideLabel(row.winner),
    pointsText: pointsText(row)
  }
}

function sideLabel(side) {
  if (!side) return ''
  const name = side.name || ''
  const partner = side.partnerName || ''
  return partner ? `${name} / ${partner}` : name
}

function scoreText(score) {
  const set0 = score && score.sets && score.sets[0]
  if (!set0) return ''
  const base = `${set0.a}:${set0.b}`
  return score.tiebreak ? `${base} (${score.tiebreak})` : base
}

function pointsText(row) {
  const entries = row && row.pointsAwarded && row.pointsAwarded.entries
  if (!Array.isArray(entries) || entries.length === 0) return ''
  const p1Ids = sideIds(row.player1)
  const p2Ids = sideIds(row.player2)
  const sumFor = ids => entries
    .filter(entry => ids.includes(entry.memberId))
    .reduce((sum, entry) => sum + (entry.points || 0), 0)
  const p1 = sumFor(p1Ids)
  const p2 = sumFor(p2Ids)
  if (!p1 && !p2) return ''
  return `+${p1} / +${p2}`
}

function sideIds(side) {
  if (!side) return []
  return [side.id, side.partnerId].filter(Boolean)
}

function buildResultLeaders(rows, tournament) {
  if ((tournament && tournament.format) === 'knockout') return buildKnockoutLeaders(rows)
  return buildRegularLeaders(rows)
}

function buildKnockoutLeaders(rows) {
  const final = rows.slice().sort((a, b) => (b.round || 0) - (a.round || 0))[0]
  if (!final || !final.winner) return []
  const loser = sameSide(final.winner, final.player1) ? final.player2 : final.player1
  return [
    { label: '冠军', value: sideLabel(final.winner) },
    loser ? { label: '亚军', value: sideLabel(loser) } : null
  ].filter(Boolean)
}

function buildRegularLeaders(rows) {
  const stats = new Map()
  const ensure = side => {
    const key = sideLabel(side)
    if (!key) return null
    if (!stats.has(key)) stats.set(key, { label: key, points: 0, wins: 0, losses: 0 })
    return stats.get(key)
  }
  rows.forEach(row => {
    const p1 = ensure(row.player1)
    const p2 = ensure(row.player2)
    if (!p1 || !p2) return
    const winnerIsP1 = sameSide(row.winner, row.player1)
    if (winnerIsP1) {
      p1.wins += 1
      p2.losses += 1
    } else {
      p2.wins += 1
      p1.losses += 1
    }
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    p1.points += entries.filter(e => sideIds(row.player1).includes(e.memberId)).reduce((sum, e) => sum + (e.points || 0), 0)
    p2.points += entries.filter(e => sideIds(row.player2).includes(e.memberId)).reduce((sum, e) => sum + (e.points || 0), 0)
  })
  return [...stats.values()]
    .sort((a, b) => (b.points - a.points) || (b.wins - a.wins) || (a.losses - b.losses) || a.label.localeCompare(b.label))
    .slice(0, 3)
    .map(item => ({ label: item.label, value: `${item.points} 分 · ${item.wins}胜${item.losses}负` }))
}

function sameSide(a, b) {
  if (!a || !b) return false
  return a.id === b.id || a.id === b.partnerId || a.partnerId === b.id || (a.partnerId && a.partnerId === b.partnerId)
}
```

- [ ] **Step 6: Reuse `isPlayableResult()` in `buildResultSummary()`**

Replace the first line of `buildResultSummary()` with:

```js
  const playable = (rows || []).filter(isPlayableResult)
```

- [ ] **Step 7: Verify Task 3**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand
```

Expected: PASS for existing tests and the new result-display tests.

- [ ] **Step 8: Commit Task 3 if requested**

Run only if the user asks to commit:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git add miniprogram/pages/tournament-detail/index.js miniprogram/pages/tournament-detail/__tests__/index.test.js
git commit -m "Build final results for tournament detail"
```

---

### Task 4: Render Results And Reorder Detail Sections

**Files:**
- Modify: `miniprogram/pages/tournament-detail/index.wxml`
- Modify: `miniprogram/pages/tournament-detail/index.wxss`
- Modify: `miniprogram/pages/tournament-detail/__tests__/index.test.js`

- [ ] **Step 1: Add a failing WXML order test**

Append this Node-level test to `miniprogram/pages/tournament-detail/__tests__/index.test.js`:

```js
const fs = require('fs')
const path = require('path')

test('detail sections render in results schedule roster points delete order', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../index.wxml'), 'utf8')
  const results = wxml.indexOf('<!-- RESULTS -->')
  const schedule = wxml.indexOf('<!-- SCHEDULE -->')
  const roster = wxml.indexOf('<!-- REGISTRATIONS -->')
  const points = wxml.indexOf('<!-- POINTS RULES -->')
  const del = wxml.indexOf('<!-- DELETE -->')

  expect(results).toBeGreaterThan(-1)
  expect(results).toBeLessThan(schedule)
  expect(schedule).toBeLessThan(roster)
  expect(roster).toBeLessThan(points)
  expect(points).toBeLessThan(del)
})
```

- [ ] **Step 2: Run the WXML order test and verify it fails**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand
```

Expected: FAIL because there is no `<!-- RESULTS -->` block and points currently render before schedule.

- [ ] **Step 3: Insert the results section above schedule**

In `miniprogram/pages/tournament-detail/index.wxml`, after the hero block and before `<!-- SCHEDULE -->`, add:

```xml
    <!-- RESULTS -->
    <view wx:if="{{resultDisplay.visible}}" class="td-section result-section anim-stage-rise anim-delay-2">
      <view class="td-section-head">
        <text class="tape">赛果 · RESULTS</text>
        <text class="td-section-count num">{{resultDisplay.completedText}}</text>
      </view>
      <view wx:if="{{resultDisplay.leaders.length > 0}}" class="result-leaders">
        <view wx:for="{{resultDisplay.leaders}}" wx:key="label" class="result-leader">
          <text class="result-leader-label">{{item.label}}</text>
          <text class="result-leader-value">{{item.value}}</text>
        </view>
      </view>
      <view class="result-groups">
        <view wx:for="{{resultDisplay.groups}}" wx:for-item="group" wx:key="round" class="result-group">
          <text class="result-round tape tape-lime">{{group.label}}</text>
          <view wx:for="{{group.matches}}" wx:for-item="match" wx:key="matchId" class="result-row">
            <view class="result-sides">
              <text class="result-side {{match.winnerLabel === match.p1Label ? 'winner' : ''}}">{{match.p1Label}}</text>
              <text class="result-score num">{{match.scoreText}}</text>
              <text class="result-side {{match.winnerLabel === match.p2Label ? 'winner' : ''}}">{{match.p2Label}}</text>
            </view>
            <view class="result-meta">
              <text>胜方 {{match.winnerLabel}}</text>
              <text wx:if="{{match.pointsText}}" class="result-points num">{{match.pointsText}}</text>
            </view>
          </view>
        </view>
      </view>
    </view>
```

- [ ] **Step 4: Move points rules below roster**

Move the whole existing `<!-- POINTS RULES -->` block so it appears after `<!-- REGISTRATIONS -->` and before `<!-- DELETE -->`.

Keep the delete block after points rules:

```xml
    <!-- DELETE -->
    <view wx:if="{{isAdmin}}" class="td-danger">
```

- [ ] **Step 5: Adjust animation delays**

Use a simple sequence after reordering:

```xml
result-section: anim-delay-2
schedule section: anim-delay-3
roster section: anim-delay-4
points section: anim-delay-4
```

This keeps existing animation utilities and avoids introducing new timing tokens.

- [ ] **Step 6: Add result styles**

Append these styles to `miniprogram/pages/tournament-detail/index.wxss`:

```css
.result-section {
  gap: 22rpx;
}

.result-leaders {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16rpx;
}

.result-leader {
  border: 2rpx solid var(--color-line);
  border-radius: 8rpx;
  padding: 18rpx;
  background: var(--color-bg);
}

.result-leader-label {
  display: block;
  font-size: 20rpx;
  color: var(--color-muted);
  margin-bottom: 8rpx;
}

.result-leader-value {
  display: block;
  font-size: 30rpx;
  font-weight: 800;
  color: var(--color-ink);
}

.result-groups {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.result-group {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.result-round {
  align-self: flex-start;
}

.result-row {
  border: 2rpx solid var(--color-line);
  border-radius: 8rpx;
  padding: 18rpx;
  background: var(--color-bg);
}

.result-sides {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 14rpx;
}

.result-side {
  font-size: 26rpx;
  font-weight: 700;
  color: var(--color-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-side:last-child {
  text-align: right;
}

.result-side.winner {
  color: var(--color-ink);
}

.result-score {
  min-width: 96rpx;
  text-align: center;
  font-size: 30rpx;
  font-weight: 900;
  color: var(--color-ink);
}

.result-meta {
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: var(--color-muted);
}

.result-points {
  color: var(--color-ink);
  font-weight: 800;
}
```

- [ ] **Step 7: Verify Task 4**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-detail/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4 if requested**

Run only if the user asks to commit:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git add miniprogram/pages/tournament-detail/index.wxml miniprogram/pages/tournament-detail/index.wxss miniprogram/pages/tournament-detail/__tests__/index.test.js
git commit -m "Render final results on tournament detail"
```

---

### Task 5: Full Verification

**Files:**
- No additional files unless verification exposes a regression.

- [ ] **Step 1: Run focused tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
./miniprogram/node_modules/.bin/jest cloudfunctions/seasons/lib/__tests__/current.test.js cloudfunctions/seasons/lib/__tests__/get-current.test.js --runInBand --config '{"testEnvironment":"node","testMatch":["**/__tests__/**/*.test.js"],"modulePathIgnorePatterns":["<rootDir>/.superpowers"]}'
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- pages/tournament-edit/__tests__/index.test.js pages/tournament-detail/__tests__/index.test.js --runInBand
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run mini program test suite**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- --runInBand
```

Expected: all Jest suites PASS.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git diff -- cloudfunctions/seasons miniprogram/pages/tournament-edit miniprogram/pages/tournament-detail docs/superpowers/plans/2026-05-19-tournament-detail-results-and-season.md
```

Expected: diff contains only the season association fix, tournament detail result display/order changes, tests, and this plan.

- [ ] **Step 4: Commit all task files if requested**

Run only if the user asks to commit:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
git add cloudfunctions/seasons miniprogram/pages/tournament-edit miniprogram/pages/tournament-detail docs/superpowers/plans/2026-05-19-tournament-detail-results-and-season.md
git commit -m "Show settled results on tournament detail"
```
