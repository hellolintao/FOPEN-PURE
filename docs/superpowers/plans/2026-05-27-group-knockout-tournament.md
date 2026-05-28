# Group Knockout Tournament Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `group_knockout` singles tournament format with manual group draw entry, group-stage rankings, fixed 8-player knockout seeding, live bracket display, and final points settlement.

**Architecture:** Add a focused pure rules module under `cloudfunctions/tournament-brackets/lib/group-knockout.js` as the source of truth for group validation, match generation, standings, knockout seeding, and points math. Cloud functions persist group assignments, bracket documents, and match result rows with explicit `stage: 'group' | 'knockout'`; frontend pages consume one aggregated bracket payload for detail actions, bracket tabs, and score grouping.

**Tech Stack:** WeChat Mini Program JavaScript, Tencent Cloud Functions, wx-server-sdk database API, Jest unit tests.

---

## File Structure

- Create `cloudfunctions/tournament-brackets/lib/group-knockout.js`: pure rules for bracket sizes, group validation, match generation, standings, fixed knockout seeding, doc ids, and default points.
- Create `cloudfunctions/tournament-brackets/lib/__tests__/group-knockout.test.js`: exhaustive pure-rule tests.
- Modify `cloudfunctions/tournaments/lib/validate.js`: accept `group_knockout`, enforce singles-only and 12/16 bracket size, validate `pointsRules.groupKnockout`.
- Modify `cloudfunctions/tournaments/lib/__tests__/validate.test.js`: validation coverage for the new format.
- Modify `cloudfunctions/tournaments/index.js`: default `maxPlayers = bracketSize`, persist new fields, expose admin-console summaries.
- Modify `cloudfunctions/tournament-brackets/index.js`: add actions `saveGroups`, `generateGroupMatches`, `getGroupKnockoutBracket`, `confirmKnockoutSeeds`, `resetKnockoutSeeds`.
- Modify `cloudfunctions/tournament-brackets/__tests__/*.test.js`: action-level tests for grouping, generation, snapshot freezing, and rebuild rules.
- Modify `cloudfunctions/match-results/index.js`: accept `matchKind: 'group'`, persist `stage/groupCode`, include `group` in orphan cleanup, pre-create only matching-stage skeletons.
- Modify `cloudfunctions/match-results/lib/state.js`: stage-aware bracket doc lookup and group-knockout final settlement trigger.
- Modify `cloudfunctions/match-results/lib/__tests__/state.test.js` and `cloudfunctions/match-results/__tests__/*.test.js`: group result and knockout advancement regression tests.
- Modify `cloudfunctions/points-engine/index.js`: branch `recompute` and new helper for `group_knockout` before default win/loss path.
- Create `cloudfunctions/points-engine/lib/group-knockout.js`: idempotent final points computation for 12/16 sign rules.
- Create `cloudfunctions/points-engine/lib/__tests__/group-knockout.test.js`: settlement and idempotency tests.
- Modify `miniprogram/pages/tournament-edit/index.js|wxml|wxss`: expose format, bracket size, draw mode, defaults, and save payload.
- Modify `miniprogram/pages/tournament-detail/index.js|wxml|wxss`: phase/footer actions, bracket summary section, and arrange-bracket entry.
- Modify `miniprogram/pages/tournament-brackets/index.js|wxml|wxss|format.wxs`: dual-tab group/knockout bracket page and arrange-groups state.
- Modify `miniprogram/pages/tournament-score/index.js|wxml|wxss`: group `group_knockout` rows by group and knockout round.
- Modify tests under `miniprogram/pages/*/__tests__`: create flow, detail footer, bracket tabs, score grouping.

---

### Task 1: Pure Group-Knockout Rules

**Files:**
- Create: `cloudfunctions/tournament-brackets/lib/group-knockout.js`
- Create: `cloudfunctions/tournament-brackets/lib/__tests__/group-knockout.test.js`

- [ ] **Step 1: Write failing tests for constants, group validation, and match generation**

Add `cloudfunctions/tournament-brackets/lib/__tests__/group-knockout.test.js`:

```js
const {
  GROUP_CODES,
  GROUP_KNOCKOUT_PHASES,
  defaultGroupKnockoutPoints,
  validateGroupAssignments,
  generateGroupMatches,
  generateKnockoutMatches,
  knockoutBracketDocId,
  groupBracketDocId
} = require('../group-knockout')

const players = ids => ids.map(id => ({ playerId: id, playerName: id.toUpperCase(), registrationId: `reg_${id}` }))

function groups16() {
  const ids = players(['a1','a2','a3','a4','b1','b2','b3','b4','c1','c2','c3','c4','d1','d2','d3','d4'])
  return GROUP_CODES.map((code, groupIndex) => ({
    groupCode: code,
    slots: [1, 2, 3, 4].map((slotNo, i) => ({ slotNo, ...ids[groupIndex * 4 + i] }))
  }))
}

describe('group knockout rules', () => {
  test('exposes supported phases and default points', () => {
    expect(GROUP_KNOCKOUT_PHASES).toContain('group_draft')
    expect(defaultGroupKnockoutPoints(12).placement.champion).toBe(250)
    expect(defaultGroupKnockoutPoints(16).group.win).toBe(50)
  })

  test('validates complete 16 draw groups', () => {
    expect(validateGroupAssignments({ bracketSize: 16, groups: groups16() })).toEqual([])
  })

  test('rejects missing slots and duplicate players', () => {
    const groups = groups16()
    groups[2].slots = groups[2].slots.slice(0, 3)
    groups[3].slots[0] = { ...groups[3].slots[0], playerId: 'a1' }
    expect(validateGroupAssignments({ bracketSize: 16, groups })).toEqual([
      'C组必须有 4 位选手',
      '选手 a1 重复出现在多个小组'
    ])
  })

  test('generates 16-sign group matches in fixed slot order', () => {
    const matches = generateGroupMatches({ tournamentId: 'tournament_1', bracketSize: 16, groups: groups16(), now: 1700000000000 })
    expect(matches).toHaveLength(24)
    expect(matches.filter(m => m.groupCode === 'A').map(m => [m.groupSlot1, m.groupSlot2])).toEqual([
      [1, 4], [2, 3], [1, 3], [2, 4], [1, 2], [3, 4]
    ])
    expect(matches[0]).toMatchObject({
      matchId: 'gk_tournament_1_gA_p1_1700000000000',
      matchKind: 'group',
      stage: 'group',
      groupCode: 'A',
      round: 1,
      position: 1,
      type: 'singles'
    })
  })

  test('builds fixed knockout bracket from frozen seeds', () => {
    const seeds = {
      A1: { id: 'a1', name: 'A1' },
      A2: { id: 'a2', name: 'A2' },
      B1: { id: 'b1', name: 'B1' },
      B2: { id: 'b2', name: 'B2' },
      C1: { id: 'c1', name: 'C1' },
      C2: { id: 'c2', name: 'C2' },
      D1: { id: 'd1', name: 'D1' },
      D2: { id: 'd2', name: 'D2' }
    }
    const brackets = generateKnockoutMatches({ tournamentId: 'tournament_1', seeds, now: 1700000000000 })
    expect(brackets).toHaveLength(3)
    expect(brackets[0].matches.map(m => [m.player1Source, m.player2Source])).toEqual([
      ['A1', 'C2'], ['B1', 'D2'], ['C1', 'A2'], ['D1', 'B2']
    ])
    expect(brackets[1].matches[0].player1Source).toBeUndefined()
    expect(groupBracketDocId('tournament_1', 'A')).toBe('bracket_1_group_A')
    expect(knockoutBracketDocId('tournament_1', 2)).toBe('bracket_1_knockout_round_2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand lib/__tests__/group-knockout.test.js`

Expected: FAIL with `Cannot find module '../group-knockout'`.

- [ ] **Step 3: Implement pure group-knockout rules**

Create `cloudfunctions/tournament-brackets/lib/group-knockout.js`:

```js
'use strict'

const GROUP_CODES = ['A', 'B', 'C', 'D']
const GROUP_KNOCKOUT_PHASES = ['group_draft', 'group_published', 'group_completed', 'knockout_published', 'completed']
const SUPPORTED_BRACKET_SIZES = [12, 16]

const DEFAULT_POINTS = Object.freeze({
  12: {
    placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 },
    group: { win: 20, loss: 10 }
  },
  16: {
    placement: { champion: 500, runnerUp: 350, semifinal: 250, quarterfinal: 180 },
    group: { win: 50, loss: 25 }
  }
})

const GROUP_SLOT_PAIRS = Object.freeze({
  12: [[1, 2], [1, 3], [2, 3]],
  16: [[1, 4], [2, 3], [1, 3], [2, 4], [1, 2], [3, 4]]
})

const KNOCKOUT_PAIRINGS = Object.freeze([
  ['A1', 'C2'],
  ['B1', 'D2'],
  ['C1', 'A2'],
  ['D1', 'B2']
])

function defaultGroupKnockoutPoints(bracketSize) {
  const config = DEFAULT_POINTS[Number(bracketSize)]
  return config ? clone(config) : clone(DEFAULT_POINTS[16])
}

function expectedGroupSize(bracketSize) {
  const size = Number(bracketSize)
  if (!SUPPORTED_BRACKET_SIZES.includes(size)) return 0
  return size / 4
}

function validateGroupAssignments({ bracketSize, groups }) {
  const errors = []
  const expectedSize = expectedGroupSize(bracketSize)
  if (!expectedSize) return ['签位规模必须是 12 或 16']
  if (!Array.isArray(groups)) return ['groups 必须是数组']

  const byCode = new Map(groups.map(group => [group && group.groupCode, group]))
  const seenPlayers = new Set()
  const duplicatePlayers = new Set()

  for (const code of GROUP_CODES) {
    const group = byCode.get(code)
    const slots = Array.isArray(group && group.slots) ? group.slots : []
    if (slots.length !== expectedSize) errors.push(`${code}组必须有 ${expectedSize} 位选手`)
    const slotNos = new Set()
    for (const slot of slots) {
      if (!slot || !slot.slotNo || slot.slotNo < 1 || slot.slotNo > expectedSize) {
        errors.push(`${code}组包含无效签位`)
        continue
      }
      if (slotNos.has(slot.slotNo)) errors.push(`${code}组签位 ${slot.slotNo} 重复`)
      slotNos.add(slot.slotNo)
      if (!slot.playerId) errors.push(`${code}组 ${slot.slotNo} 号签缺少选手`)
      if (slot.playerId) {
        if (seenPlayers.has(slot.playerId)) duplicatePlayers.add(slot.playerId)
        seenPlayers.add(slot.playerId)
      }
    }
  }

  for (const playerId of duplicatePlayers) errors.push(`选手 ${playerId} 重复出现在多个小组`)
  return errors
}

function generateGroupMatches({ tournamentId, bracketSize, groups, now }) {
  // position 是"全赛事维度"连续编号（A 组 1-N，B 组 N+1-2N …），用于录分页排序；
  // 同一组内对阵的相对顺序由 GROUP_SLOT_PAIRS 决定，UI 也可通过 (groupCode, groupSlot1, groupSlot2) 重排。
  const timestamp = now || Date.now()
  const pairs = GROUP_SLOT_PAIRS[Number(bracketSize)] || []
  const byCode = new Map((groups || []).map(group => [group.groupCode, group]))
  const matches = []
  for (const code of GROUP_CODES) {
    const group = byCode.get(code)
    const slotMap = new Map(((group && group.slots) || []).map(slot => [slot.slotNo, slot]))
    pairs.forEach(([slot1, slot2], index) => {
      const p1 = slotMap.get(slot1)
      const p2 = slotMap.get(slot2)
      matches.push({
        matchId: `gk_${normalizeTournamentId(tournamentId)}_g${code}_p${index + 1}_${timestamp}`,
        matchKind: 'group',
        stage: 'group',
        groupCode: code,
        groupSlot1: slot1,
        groupSlot2: slot2,
        round: 1,
        position: matches.length + 1,
        type: 'singles',
        player1: regToPlayer(p1),
        player2: regToPlayer(p2),
        bye: false,
        status: 'pending',
        resultStatus: 'pending',
        winner: null,
        courtId: null,
        queueOrder: null
      })
    })
  }
  return matches
}

function generateKnockoutMatches({ tournamentId, seeds, now }) {
  const timestamp = now || Date.now()
  const shortId = normalizeTournamentId(tournamentId)
  const qf = {
    _id: knockoutBracketDocId(tournamentId, 1),
    tournamentId,
    format: 'group_knockout',
    stage: 'knockout',
    round: 1,
    type: 'singles',
    matches: KNOCKOUT_PAIRINGS.map(([source1, source2], index) => ({
      matchId: `gk_${shortId}_ko_r1_p${index + 1}_${timestamp}`,
      matchKind: 'bracket',
      stage: 'knockout',
      round: 1,
      position: index + 1,
      type: 'singles',
      player1: seeds[source1] || null,
      player2: seeds[source2] || null,
      player1Source: source1,
      player2Source: source2,
      bye: false,
      status: 'pending',
      resultStatus: 'pending',
      winner: null,
      courtId: null,
      queueOrder: null
    }))
  }
  return [
    qf,
    placeholderKnockoutDoc({ tournamentId, round: 2, count: 2, now: timestamp }),
    placeholderKnockoutDoc({ tournamentId, round: 3, count: 1, now: timestamp })
  ]
}

function placeholderKnockoutDoc({ tournamentId, round, count, now }) {
  const shortId = normalizeTournamentId(tournamentId)
  return {
    _id: knockoutBracketDocId(tournamentId, round),
    tournamentId,
    format: 'group_knockout',
    stage: 'knockout',
    round,
    type: 'singles',
    matches: Array.from({ length: count }, (_, index) => ({
      matchId: `gk_${shortId}_ko_r${round}_p${index + 1}_${now}`,
      matchKind: 'bracket',
      stage: 'knockout',
      round,
      position: index + 1,
      type: 'singles',
      player1: null,
      player2: null,
      bye: false,
      status: 'pending',
      resultStatus: 'pending',
      winner: null,
      courtId: null,
      queueOrder: null
    }))
  }
}

function groupBracketDocId(tournamentId, groupCode) {
  return `bracket_${normalizeTournamentId(tournamentId)}_group_${groupCode}`
}

function knockoutBracketDocId(tournamentId, round) {
  return `bracket_${normalizeTournamentId(tournamentId)}_knockout_round_${round}`
}

function normalizeTournamentId(tournamentId) {
  return String(tournamentId || '').replace(/^tournament_/, '')
}

function regToPlayer(reg) {
  if (!reg) return null
  return {
    id: reg.playerId,
    name: reg.playerName,
    registrationId: reg.registrationId || reg._id || ''
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

module.exports = {
  GROUP_CODES,
  GROUP_KNOCKOUT_PHASES,
  SUPPORTED_BRACKET_SIZES,
  KNOCKOUT_PAIRINGS,
  defaultGroupKnockoutPoints,
  expectedGroupSize,
  validateGroupAssignments,
  generateGroupMatches,
  generateKnockoutMatches,
  groupBracketDocId,
  knockoutBracketDocId,
  normalizeTournamentId
}
```

- [ ] **Step 4: Run pure-rule tests**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand lib/__tests__/group-knockout.test.js`

Expected: PASS.

- [ ] **Step 5: Commit pure rules**

```bash
git add cloudfunctions/tournament-brackets/lib/group-knockout.js cloudfunctions/tournament-brackets/lib/__tests__/group-knockout.test.js
git commit -m "feat: add group knockout bracket rules"
```

---

### Task 2: Standings Algorithm and Manual Tiebreak Shape

**Files:**
- Modify: `cloudfunctions/tournament-brackets/lib/group-knockout.js`
- Modify: `cloudfunctions/tournament-brackets/lib/__tests__/group-knockout.test.js`

- [ ] **Step 1: Add failing standings tests**

Append to `cloudfunctions/tournament-brackets/lib/__tests__/group-knockout.test.js`:

```js
const { calculateGroupStandings } = require('../group-knockout')

function row(id, groupCode, player1, player2, a, b) {
  const winner = a > b ? player1 : player2
  return {
    _id: `result_${id}`,
    sourceMatchId: id,
    stage: 'group',
    matchKind: 'group',
    groupCode,
    player1: { id: player1, name: player1.toUpperCase() },
    player2: { id: player2, name: player2.toUpperCase() },
    score: { sets: [{ a, b }], tiebreak: null },
    resultStatus: 'confirmed',
    winner: { id: winner, name: winner.toUpperCase() }
  }
}

describe('calculateGroupStandings', () => {
  test('orders two-player tie by head-to-head', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c', 'd'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('m1', 'A', 'a', 'b', 4, 1),
      row('m2', 'A', 'a', 'c', 4, 1),
      row('m3', 'A', 'd', 'a', 4, 1),
      row('m4', 'A', 'b', 'c', 4, 1),
      row('m5', 'A', 'b', 'd', 4, 1),
      row('m6', 'A', 'c', 'd', 4, 1)
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.map(r => r.playerId)).toEqual(['a', 'b', 'c', 'd'])
    expect(standings.A.manualTiebreakRequired).toBe(false)
    expect(standings.A.rows[0].headToHead).toBe('beat b')
  })

  test('three-player circular tie uses gameDiff over recursive head-to-head', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('m1', 'A', 'a', 'b', 4, 3),
      row('m2', 'A', 'b', 'c', 4, 1),
      row('m3', 'A', 'c', 'a', 4, 0)
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.rows.map(r => ({ id: r.playerId, gameDiff: r.gameDiff }))).toEqual([
      { id: 'b', gameDiff: 2 },
      { id: 'c', gameDiff: 1 },
      { id: 'a', gameDiff: -3 }
    ])
    expect(standings.A.rows[0].playerId).toBe('b')
  })

  test('marks unresolved ties for manual ordering', () => {
    const groups = [{
      groupCode: 'A',
      slots: ['a', 'b', 'c'].map((id, index) => ({ slotNo: index + 1, playerId: id, playerName: id.toUpperCase() }))
    }]
    const rows = [
      row('m1', 'A', 'a', 'b', 4, 2),
      row('m2', 'A', 'a', 'c', 2, 4),
      row('m3', 'A', 'b', 'c', 4, 2)
    ]
    const standings = calculateGroupStandings({ groups, results: rows })
    expect(standings.A.manualTiebreakRequired).toBe(true)
  })
})
```

- [ ] **Step 2: Run standings tests to verify failure**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand lib/__tests__/group-knockout.test.js -t calculateGroupStandings`

Expected: FAIL with `calculateGroupStandings is not a function`.

- [ ] **Step 3: Implement standings calculation**

Add this export to `cloudfunctions/tournament-brackets/lib/group-knockout.js`:

```js
function calculateGroupStandings({ groups, results, manualOverrides }) {
  const overrides = manualOverrides || {}
  const output = {}
  for (const group of groups || []) {
    const groupCode = group.groupCode
    const rowsByPlayer = new Map()
    for (const slot of group.slots || []) {
      rowsByPlayer.set(slot.playerId, {
        playerId: slot.playerId,
        playerName: slot.playerName,
        registrationId: slot.registrationId || slot._id || '',
        groupCode,
        wins: 0,
        losses: 0,
        gameDiff: 0,
        totalGamesWon: 0,
        headToHead: ''
      })
    }

    for (const result of (results || []).filter(r => r.groupCode === groupCode && r.resultStatus === 'confirmed')) {
      const set = result.score && result.score.sets && result.score.sets[0]
      if (!set || !result.player1 || !result.player2) continue
      applyResult(rowsByPlayer.get(result.player1.id), set.a, set.b, result.winner)
      applyResult(rowsByPlayer.get(result.player2.id), set.b, set.a, result.winner)
    }

    let rows = [...rowsByPlayer.values()]
    const override = overrides[groupCode]
    if (override && Array.isArray(override.finalRows) && override.finalRows.length) {
      const order = new Map(override.finalRows.map((row, index) => [row.playerId, index]))
      rows.sort((a, b) => (order.get(a.playerId) ?? 999) - (order.get(b.playerId) ?? 999))
      output[groupCode] = { groupCode, rows: markPromotion(rows), manualTiebreakRequired: false, manualOverride: override }
      continue
    }

    const ranked = rankRows(rows, results || [], groupCode)
    output[groupCode] = { groupCode, rows: markPromotion(ranked.rows), manualTiebreakRequired: ranked.manualTiebreakRequired }
  }
  return output
}

function applyResult(row, wonGames, lostGames, winner) {
  if (!row) return
  row.totalGamesWon += Number(wonGames || 0)
  row.gameDiff += Number(wonGames || 0) - Number(lostGames || 0)
  if (winner && winner.id === row.playerId) {
    row.wins += 1
  } else {
    row.losses += 1
  }
}

function rankRows(rows, results, groupCode) {
  // 注意：headToHead 仅在 N=2 并列时由 rankRows 写入对应两行，
  // applyResult 不再写 headToHead（避免被多场胜利覆盖）。
  let manualTiebreakRequired = false
  const sorted = [...rows].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    const tied = rows.filter(row => row.wins === a.wins)
    if (tied.length === 2) {
      const winnerId = headToHeadWinner(tied[0].playerId, tied[1].playerId, results, groupCode)
      if (winnerId) {
        const loserId = winnerId === tied[0].playerId ? tied[1].playerId : tied[0].playerId
        const winnerRow = rows.find(row => row.playerId === winnerId)
        const loserRow = rows.find(row => row.playerId === loserId)
        if (winnerRow) winnerRow.headToHead = `beat ${loserId}`
        if (loserRow) loserRow.headToHead = `lost to ${winnerId}`
        if (winnerId === a.playerId) return -1
        if (winnerId === b.playerId) return 1
      }
    }
    if (b.gameDiff !== a.gameDiff) return b.gameDiff - a.gameDiff
    if (b.totalGamesWon !== a.totalGamesWon) return b.totalGamesWon - a.totalGamesWon
    manualTiebreakRequired = true
    return 0
  })
  return { rows: sorted, manualTiebreakRequired }
}

function headToHeadWinner(a, b, results, groupCode) {
  const match = (results || []).find(result => {
    if (result.groupCode !== groupCode || result.resultStatus !== 'confirmed') return false
    const ids = [result.player1 && result.player1.id, result.player2 && result.player2.id]
    return ids.includes(a) && ids.includes(b)
  })
  return match && match.winner && match.winner.id
}

function markPromotion(rows) {
  return rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    source: index < 2 ? `${row.groupCode}${index + 1}` : '',
    promoted: index < 2
  }))
}
```

Also add `calculateGroupStandings` to `module.exports`.

- [ ] **Step 4: Run all pure-rule tests**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand lib/__tests__/group-knockout.test.js`

Expected: PASS.

- [ ] **Step 5: Commit standings**

```bash
git add cloudfunctions/tournament-brackets/lib/group-knockout.js cloudfunctions/tournament-brackets/lib/__tests__/group-knockout.test.js
git commit -m "feat: calculate group knockout standings"
```

---

### Task 3: Tournament Validation and Persistence

**Files:**
- Modify: `cloudfunctions/tournaments/lib/validate.js`
- Modify: `cloudfunctions/tournaments/lib/__tests__/validate.test.js`
- Modify: `cloudfunctions/tournaments/index.js`

- [ ] **Step 1: Add failing validation tests**

Append to `cloudfunctions/tournaments/lib/__tests__/validate.test.js`:

```js
describe('group_knockout validation', () => {
  test('allows singles group knockout with 16 sign bracket', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 16,
      maxPlayers: 16
    }), { isDraft: false })
    expect(errors).toEqual([])
  })

  test.each(['doubles', 'mixed'])('rejects group knockout %s', (type) => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type,
      bracketSize: 16,
      maxPlayers: 16
    }), { isDraft: false })
    expect(errors).toContain('小组赛+淘汰赛只支持 singles 类型')
  })

  test('requires bracketSize 12 or 16', () => {
    const errors = validateTournament(validTournament({
      format: 'group_knockout',
      type: 'singles',
      bracketSize: 14,
      maxPlayers: 14
    }), { isDraft: false })
    expect(errors).toContain('小组赛+淘汰赛 bracketSize 必须是 12 或 16')
  })
})
```

- [ ] **Step 2: Run validation tests to verify failure**

Run: `cd cloudfunctions/tournaments && npm test -- --runInBand lib/__tests__/validate.test.js -t group_knockout`

Expected: FAIL because `group_knockout` is rejected by the format whitelist.

- [ ] **Step 3: Update tournament validation**

Modify constants and format checks in `cloudfunctions/tournaments/lib/validate.js`:

```js
const TOURNAMENT_TYPES = ['singles', 'doubles', 'mixed'];
const TOURNAMENT_FORMATS = ['regular', 'knockout', 'group_knockout'];
const GROUP_KNOCKOUT_BRACKET_SIZES = [12, 16];
```

Replace the current format check with:

```js
  if (!data.format || !TOURNAMENT_FORMATS.includes(data.format)) {
    errors.push('赛制必须是 regular(常规赛)、knockout(淘汰赛) 或 group_knockout(小组赛+淘汰赛)');
  }
  if (data.format === 'knockout' && data.type === 'mixed') {
    errors.push('淘汰赛不支持 mixed 类型');
  }
  if (data.format === 'group_knockout') {
    if (data.type !== 'singles') errors.push('小组赛+淘汰赛只支持 singles 类型');
    if (!GROUP_KNOCKOUT_BRACKET_SIZES.includes(Number(data.bracketSize))) {
      errors.push('小组赛+淘汰赛 bracketSize 必须是 12 或 16');
    }
  }
```

Add after the knockout `maxPlayers` check:

```js
  if (data.format === 'group_knockout') {
    const size = Number(data.bracketSize);
    if (!GROUP_KNOCKOUT_BRACKET_SIZES.includes(size)) {
      errors.push('小组赛+淘汰赛 bracketSize 必须是 12 或 16');
    }
    if (data.maxPlayers && Number(data.maxPlayers) !== size) {
      errors.push('小组赛+淘汰赛 maxPlayers 必须等于 bracketSize');
    }
  }
```

**`scheduleStatus` 兼容性**：现有 `shouldValidateSchedulePlan` (validate.js line 143) 在 `scheduleStatus !== 'none'` 且 `!== 'draft'` 时会校验 `schedulePlan`，而 `group_knockout` 不维护 `schedulePlan`（没有球场/时间排程）。必须在该函数里跳过 group_knockout：

```js
function shouldValidateSchedulePlan(data) {
  if (data.format === 'group_knockout') return false
  return data.scheduleStatus !== 'none' && data.scheduleStatus !== 'draft'
}
```

对应地，Task 4 `handleGenerateGroupMatches` 里写的 `scheduleStatus: 'published'` 要去掉，让 `group_knockout` 全程保持 `scheduleStatus: 'none'`——状态机靠 `groupKnockoutPhase`，不复用 `scheduleStatus` 的语义。

- [ ] **Step 4: Persist new fields and normalize defaults**

In `cloudfunctions/tournaments/index.js`, add helper near `generateTournamentId`:

```js
function normalizeTournamentPayload(data = {}) {
  if (data.format !== 'group_knockout') return data
  const bracketSize = Number(data.bracketSize || data.maxPlayers || 16)
  return {
    ...data,
    type: 'singles',
    bracketSize,
    maxPlayers: bracketSize,
    groupDrawMode: data.groupDrawMode || 'onsite',
    groupKnockoutPhase: data.groupKnockoutPhase || 'group_draft'
  }
}
```

Use it at the top of `actionCreate`:

```js
  const input = normalizeTournamentPayload(data)
  const status = input.status || 'upcoming'
  const isDraft = status === 'draft'
  const errors = validateTournament(input, { isDraft })
```

Then build `doc` from `input` and include:

```js
    bracketSize: input.bracketSize || null,
    groupDrawMode: input.groupDrawMode || '',
    groupKnockoutPhase: input.groupKnockoutPhase || '',
    groupRankSnapshot: input.groupRankSnapshot || null,
    knockoutSeedSnapshot: input.knockoutSeedSnapshot || null,
```

Use the helper in `actionUpdate` before merging:

```js
  const normalizedPatch = normalizeTournamentPayload(data)
  const merged = { ...cur.data, ...normalizedPatch }
```

and build `updateData` from `normalizedPatch`.

- [ ] **Step 5: Run tournament tests**

Run: `cd cloudfunctions/tournaments && npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit validation and persistence**

```bash
git add cloudfunctions/tournaments/lib/validate.js cloudfunctions/tournaments/lib/__tests__/validate.test.js cloudfunctions/tournaments/index.js
git commit -m "feat: validate group knockout tournaments"
```

---

### Task 4: Group Assignment and Generation Cloud Actions

**Files:**
- Modify: `cloudfunctions/tournament-brackets/index.js`
- Create: `cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js`

- [ ] **Step 1: Add action-level failing tests**

**重要**：`cloudfunctions/tournament-brackets/index.js` 在文件顶部 `const collection = db.collection('tournament_brackets')` 缓存了模块级别引用。`jest.mock` 工厂返回的 `db` 实例必须是稳定单例，所有 `db.collection(name)` 调用都要从**同一个** `state.collections` 闭包查表，否则模块顶部缓存的 `collection` 与测试 seed 的 collections 会不指向同一份。沿用 `__tests__/admin-auth.test.js` 现有的 `mockState` 闭包模式。

Create `cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js`:

```js
let mockState

function makeCollectionMock(name) {
  return {
    doc: jest.fn(id => ({
      get: jest.fn(async () => ({ data: mockState.collections[name].get(id) || null })),
      update: jest.fn(async ({ data }) => {
        const cur = mockState.collections[name].get(id) || {}
        mockState.collections[name].set(id, { ...cur, ...data })
        return { updated: 1 }
      }),
      remove: jest.fn(async () => {
        mockState.collections[name].delete(id)
        return { removed: 1 }
      })
    })),
    add: jest.fn(async ({ data }) => {
      mockState.collections[name].set(data._id, data)
      return { _id: data._id }
    }),
    where: jest.fn(query => ({
      get: jest.fn(async () => ({
        data: [...mockState.collections[name].values()]
          .filter(row => Object.keys(query).every(key => {
            const val = query[key]
            if (val && typeof val === 'object' && '$gt' in val) return Number(row[key]) > Number(val.$gt)
            if (val && typeof val === 'object' && '$in' in val) return val.$in.includes(row[key])
            return row[key] === val
          }))
      })),
      limit: jest.fn(function () { return this })
    }))
  }
}

jest.mock('wx-server-sdk', () => {
  const db = {
    command: {
      in: jest.fn(values => ({ $in: values })),
      gt: jest.fn(value => ({ $gt: value })),
      set: jest.fn(value => value)
    },
    serverDate: jest.fn(() => 'SERVER_DATE'),
    collection: jest.fn(name => {
      if (!mockState.collections[name]) mockState.collections[name] = new Map()
      return makeCollectionMock(name)
    })
  }
  return {
    init: jest.fn(),
    DYNAMIC_CURRENT_ENV: 'test-env',
    getWXContext: jest.fn(() => ({ OPENID: mockState.openid })),
    database: jest.fn(() => db)
  }
})

const { main } = require('../index')

beforeEach(() => {
  mockState = {
    openid: 'admin-openid',
    collections: {
      members: new Map([['m_admin', { _id: 'm_admin', openid: 'admin-openid', admin: true }]]),
      tournaments: new Map(),
      tournament_groups: new Map(),
      tournament_brackets: new Map(),
      match_results: new Map()
    }
  }
})

test('saveGroups validates and persists four groups', async () => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', bracketSize: 12, type: 'singles',
    groupKnockoutPhase: 'group_draft'
  })
  const groups = ['A', 'B', 'C', 'D'].map(code => ({
    groupCode: code,
    slots: [1, 2, 3].map(slotNo => ({ slotNo, playerId: `${code}${slotNo}`, playerName: `${code}${slotNo}` }))
  }))
  const res = await main({ action: 'saveGroups', tournamentId: 'tournament_1', groups })
  expect(res.success).toBe(true)
  expect(mockState.collections.tournament_groups.get('group_tournament_1_A').slots).toHaveLength(3)
  // 状态机：saveGroups 不应自动推进 phase
  expect(mockState.collections.tournaments.get('tournament_1').groupKnockoutPhase).toBe('group_draft')
})

test.each([
  ['group_published'],
  ['group_completed'],
  ['knockout_published'],
  ['completed']
])('saveGroups is rejected by state machine when phase is %s', async (phase) => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', bracketSize: 12, type: 'singles',
    groupKnockoutPhase: phase
  })
  const groups = ['A', 'B', 'C', 'D'].map(code => ({
    groupCode: code,
    slots: [1, 2, 3].map(slotNo => ({ slotNo, playerId: `${code}${slotNo}`, playerName: `${code}${slotNo}` }))
  }))
  const res = await main({ action: 'saveGroups', tournamentId: 'tournament_1', groups })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('PHASE_LOCKED')
})
```

Use this as the base and extend with tests for `generateGroupMatches` after the first action passes. **后续测试用例不要重新赋值 `db.collection`**，所有 seed 操作都直接写 `mockState.collections.<name>.set(...)`。

- [ ] **Step 2: Run action test to verify failure**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand __tests__/group-knockout-actions.test.js`

Expected: FAIL with invalid action or missing handler.

- [ ] **Step 3: Add action handlers**

**约定**：`cloudfunctions/tournament-brackets/index.js` 顶部已 `const collection = db.collection('tournament_brackets')` 作为 bracket 集合别名。下面所有 handler 直接用 `collection.where(...)` / `collection.doc(...)` / `collection.add(...)`，引用 `tournament_groups` 等其他集合时仍用 `db.collection('tournament_groups')` 完整路径。

In `cloudfunctions/tournament-brackets/index.js`, import pure helpers:

```js
const {
  GROUP_CODES,
  validateGroupAssignments,
  generateGroupMatches,
  groupBracketDocId,
  normalizeTournamentId
} = require('./lib/group-knockout')
```

Add cases in the action switch before `default`:

```js
      case 'saveGroups': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleSaveGroups(event)
      }

      case 'generateGroupMatches': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleGenerateGroupMatches(event)
      }
```

Add handlers below existing helper handlers:

```js
async function handleSaveGroups({ tournamentId, groups }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (!tournament || tournament.format !== 'group_knockout') {
    return { success: false, error: { code: 'INVALID_TOURNAMENT', message: '赛事不是小组赛+淘汰赛' } }
  }
  // 状态机：仅在 group_draft 阶段允许保存分组；group_published 之后请走 resetGroups 显式撤回
  const phase = tournament.groupKnockoutPhase || 'group_draft'
  if (phase !== 'group_draft') {
    return { success: false, error: { code: 'PHASE_LOCKED', message: `当前阶段 ${phase} 不允许直接保存分组，请先撤回到 group_draft`, phase } }
  }
  const errors = validateGroupAssignments({ bracketSize: tournament.bracketSize, groups })
  if (errors.length) return { success: false, error: { code: 'VALIDATION_FAILED', message: errors.join('; '), errors } }

  const oldGroups = await db.collection('tournament_groups').where({ tournamentId }).get().catch(() => ({ data: [] }))
  for (const group of oldGroups.data || []) await db.collection('tournament_groups').doc(group._id).remove().catch(() => null)

  for (const group of groups) {
    await db.collection('tournament_groups').add({
      data: {
        _id: `group_${tournamentId}_${group.groupCode}`,
        tournamentId,
        groupCode: group.groupCode,
        slots: group.slots,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
  }
  // 不再写 groupKnockoutPhase：保持当前 group_draft 不变，由 generateGroupMatches 推进到 group_published
  await db.collection('tournaments').doc(tournamentId).update({
    data: { updateTime: db.serverDate() }
  })
  return { success: true, data: { count: groups.length } }
}

async function handleGenerateGroupMatches({ tournamentId }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (!tournament || tournament.format !== 'group_knockout') {
    return { success: false, error: { code: 'INVALID_TOURNAMENT', message: '赛事不是小组赛+淘汰赛' } }
  }
  const groupRows = (await db.collection('tournament_groups').where({ tournamentId }).get().catch(() => ({ data: [] }))).data || []
  const groups = GROUP_CODES.map(code => groupRows.find(group => group.groupCode === code)).filter(Boolean)
  const errors = validateGroupAssignments({ bracketSize: tournament.bracketSize, groups })
  if (errors.length) return { success: false, error: { code: 'VALIDATION_FAILED', message: errors.join('; '), errors } }

  const oldGroupBrackets = await collection.where({ tournamentId, stage: 'group' }).get().catch(() => ({ data: [] }))
  for (const bracket of oldGroupBrackets.data || []) await collection.doc(bracket._id).remove().catch(() => null)

  const allMatches = generateGroupMatches({ tournamentId, bracketSize: tournament.bracketSize, groups })
  for (const groupCode of GROUP_CODES) {
    const matches = allMatches.filter(match => match.groupCode === groupCode)
    await collection.add({
      data: {
        _id: groupBracketDocId(tournamentId, groupCode),
        tournamentId,
        format: 'group_knockout',
        stage: 'group',
        groupCode,
        round: 1,
        type: 'singles',
        matches,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    })
  }

  await db.collection('tournaments').doc(tournamentId).update({
    data: { groupKnockoutPhase: 'group_published', updateTime: db.serverDate() }
  })
  // group_knockout 全程保持 scheduleStatus='none'，避免触发 shouldValidateSchedulePlan
  return { success: true, data: { count: allMatches.length } }
}
```

- [ ] **Step 4: Extend tests for group match generation**

Add to `cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js`:

```js
test('generateGroupMatches writes group bracket docs and publishes group phase', async () => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', bracketSize: 12, type: 'singles',
    groupKnockoutPhase: 'group_draft'
  })
  for (const code of ['A', 'B', 'C', 'D']) {
    mockState.collections.tournament_groups.set(`group_tournament_1_${code}`, {
      _id: `group_tournament_1_${code}`,
      tournamentId: 'tournament_1',
      groupCode: code,
      slots: [1, 2, 3].map(slotNo => ({ slotNo, playerId: `${code}${slotNo}`, playerName: `${code}${slotNo}` }))
    })
  }
  const res = await main({ action: 'generateGroupMatches', tournamentId: 'tournament_1' })
  expect(res.success).toBe(true)
  expect(res.data.count).toBe(12)
  expect(mockState.collections.tournament_brackets.get('bracket_1_group_A').matches).toHaveLength(3)
  expect(mockState.collections.tournaments.get('tournament_1').groupKnockoutPhase).toBe('group_published')
})
```

- [ ] **Step 5: Run tournament-brackets tests**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit group actions**

```bash
git add cloudfunctions/tournament-brackets/index.js cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js
git commit -m "feat: save and generate group knockout draws"
```

---

### Task 5: Aggregate Bracket Query and Confirm 8 Seeds

**Files:**
- Modify: `cloudfunctions/tournament-brackets/index.js`
- Modify: `cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js`

- [ ] **Step 1: Add failing tests for aggregate query and seed confirmation**

Add tests:

```js
test('confirmKnockoutSeeds blocks unresolved manual tie', async () => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', bracketSize: 12, type: 'singles',
    groupKnockoutPhase: 'group_completed'
  })
  const res = await main({ action: 'confirmKnockoutSeeds', tournamentId: 'tournament_1' })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('GROUPS_NOT_READY')
})

test('getGroupKnockoutBracket returns groups, standings, and knockout docs', async () => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', bracketSize: 12, type: 'singles'
  })
  mockState.collections.tournament_groups.set('group_tournament_1_A', {
    _id: 'group_tournament_1_A', tournamentId: 'tournament_1', groupCode: 'A', slots: []
  })
  const res = await main({ action: 'getGroupKnockoutBracket', tournamentId: 'tournament_1' })
  expect(res.success).toBe(true)
  expect(res.data.groups).toHaveLength(1)
  expect(res.data.groupBrackets).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand __tests__/group-knockout-actions.test.js -t "confirmKnockoutSeeds|getGroupKnockoutBracket"`

Expected: FAIL with invalid actions.

- [ ] **Step 3: Add aggregate and confirmation actions**

Import:

```js
const {
  calculateGroupStandings,
  generateKnockoutMatches,
  knockoutBracketDocId
} = require('./lib/group-knockout')
```

Add switch cases:

```js
      case 'getGroupKnockoutBracket':
        return await handleGetGroupKnockoutBracket(event)

      case 'confirmKnockoutSeeds': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleConfirmKnockoutSeeds(event)
      }
```

Add helper:

```js
async function loadGroupKnockoutContext(tournamentId) {
  const [tournamentRes, groupRes, bracketRes, resultRes] = await Promise.all([
    db.collection('tournaments').doc(tournamentId).get().catch(() => null),
    db.collection('tournament_groups').where({ tournamentId }).get().catch(() => ({ data: [] })),
    collection.where({ tournamentId }).get().catch(() => ({ data: [] })),
    db.collection('match_results').where({ tournamentId }).get().catch(() => ({ data: [] }))
  ])
  const tournament = tournamentRes && tournamentRes.data
  const groups = (groupRes.data || []).sort((a, b) => GROUP_CODES.indexOf(a.groupCode) - GROUP_CODES.indexOf(b.groupCode))
  const brackets = bracketRes.data || []
  const results = resultRes.data || []
  const standings = calculateGroupStandings({
    groups,
    results,
    manualOverrides: tournament && tournament.groupRankSnapshot && tournament.groupRankSnapshot.manualOverrides
  })
  return { tournament, groups, brackets, results, standings }
}

async function handleGetGroupKnockoutBracket({ tournamentId }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  const ctx = await loadGroupKnockoutContext(tournamentId)
  if (!ctx.tournament) return { success: false, error: { code: 'NOT_FOUND', message: tournamentId } }
  return {
    success: true,
    data: {
      tournament: ctx.tournament,
      groups: ctx.groups,
      standings: ctx.standings,
      groupBrackets: ctx.brackets.filter(b => b.stage === 'group'),
      knockoutBrackets: ctx.brackets.filter(b => b.stage === 'knockout').sort((a, b) => a.round - b.round)
    }
  }
}
```

Add confirmation handler:

```js
async function handleConfirmKnockoutSeeds({ tournamentId }) {
  if (!tournamentId) return { success: false, error: { code: 'INVALID_ARG', message: 'tournamentId 必填' } }
  const ctx = await loadGroupKnockoutContext(tournamentId)
  if (!ctx.tournament || ctx.tournament.format !== 'group_knockout') {
    return { success: false, error: { code: 'INVALID_TOURNAMENT', message: '赛事不是小组赛+淘汰赛' } }
  }
  const groupBrackets = ctx.brackets.filter(b => b.stage === 'group')
  const expectedMatches = Number(ctx.tournament.bracketSize) === 12 ? 12 : 24
  const confirmedGroupResults = ctx.results.filter(row => row.stage === 'group' && row.resultStatus === 'confirmed')
  if (groupBrackets.length !== 4 || confirmedGroupResults.length < expectedMatches) {
    return { success: false, error: { code: 'GROUPS_NOT_READY', message: '小组赛未全部确认' } }
  }
  const blocked = Object.values(ctx.standings).filter(group => group.manualTiebreakRequired)
  if (blocked.length) {
    return { success: false, error: { code: 'MANUAL_TIEBREAK_REQUIRED', message: '存在需要手动排序的小组', groups: blocked.map(g => g.groupCode) } }
  }

  const seeds = {}
  for (const code of GROUP_CODES) {
    const rows = ctx.standings[code] && ctx.standings[code].rows
    if (!rows || rows.length < 2) return { success: false, error: { code: 'GROUPS_NOT_READY', message: `${code}组排名不足` } }
    seeds[`${code}1`] = standingsRowToPlayer(rows[0])
    seeds[`${code}2`] = standingsRowToPlayer(rows[1])
  }

  const existingKo = ctx.brackets.filter(b => b.stage === 'knockout')
  for (const bracket of existingKo) await collection.doc(bracket._id).remove().catch(() => null)
  const knockoutDocs = generateKnockoutMatches({ tournamentId, seeds })
  for (const doc of knockoutDocs) {
    await collection.add({ data: { ...doc, createTime: db.serverDate(), updateTime: db.serverDate() } })
  }
  const snapshot = { seeds, standings: ctx.standings, confirmedBy: getOpenidSafe(), confirmedAt: db.serverDate() }
  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      groupRankSnapshot: snapshot.standings,
      knockoutSeedSnapshot: snapshot,
      groupKnockoutPhase: 'knockout_published',
      updateTime: db.serverDate()
    }
  })
  return { success: true, data: { seeds, knockoutRounds: knockoutDocs.length } }
}

function standingsRowToPlayer(row) {
  return { id: row.playerId, name: row.playerName, registrationId: row.registrationId || '' }
}

function getOpenidSafe() {
  try {
    const ctx = cloud.getWXContext()
    return (ctx && ctx.OPENID) || ''
  } catch (e) {
    return ''
  }
}
```

- [ ] **Step 4: Run bracket action tests**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand`

Expected: PASS after test fixtures include confirmed rows for the successful confirmation case.

- [ ] **Step 5: Commit aggregate and seed confirmation**

```bash
git add cloudfunctions/tournament-brackets/index.js cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js
git commit -m "feat: confirm group knockout seeds"
```

---

### Task 6: Match Result Rows for Group and Stage-Aware Knockout

**Files:**
- Modify: `cloudfunctions/match-results/index.js`
- Modify: `cloudfunctions/match-results/__tests__/direct-get-schedule-gate.test.js`

- [ ] **Step 1: Add failing bulk-upsert test**

Add this test to `cloudfunctions/match-results/__tests__/direct-get-schedule-gate.test.js`, inside the existing `describe('direct get schedule visibility gate', ...)` block after the direct-get visibility tests:

```js
test('bulkUpsertScheduledMatches preserves group stage fields', async () => {
  setState({ scheduleStatus: 'published', isAdmin: true })
  mockState.tournaments.t1 = {
    _id: 't1',
    seasonId: 'season_2026',
    type: 'singles',
    format: 'group_knockout',
    scheduleStatus: 'published'
  }

  const result = await main({
    action: 'bulkUpsertScheduledMatches',
    tournamentId: 't1',
    matches: [{
      matchId: 'gk_t1_gA_p1',
      matchKind: 'group',
      stage: 'group',
      groupCode: 'A',
      round: 1,
      position: 1,
      type: 'singles',
      player1: { id: 'a1', name: 'A1' },
      player2: { id: 'a2', name: 'A2' }
    }],
    queues: []
  })

  expect(result.success).toBe(true)
  expect(mockState.rows.result_t1_gk_t1_gA_p1).toMatchObject({
    matchKind: 'group',
    stage: 'group',
    groupCode: 'A',
    tournamentType: 'singles',
    playerIds: ['a1', 'a2']
  })
})
```

This uses the file's existing `setState`, `mockState`, and imported `main` harness. Keep the assertions about persisted fields and `playerIds`; do not add unrelated schedule-gate assertions to this test.

- [ ] **Step 2: Run selected match-results test**

Run: `cd cloudfunctions/match-results && npm test -- --runInBand __tests__/direct-get-schedule-gate.test.js -t "bulkUpsertScheduledMatches preserves group stage fields"`

Expected: FAIL because `stage` and `groupCode` are not written and orphan cleanup ignores `group`.

- [ ] **Step 3: Persist stage and groupCode**

In `handleBulkUpsert` 的 R1 upsert 路径（`cloudfunctions/match-results/index.js` line 243-266 的 `doc = { ... }`），在 `tournamentType: matchType,` 之后插入 3 行：

```js
        format: tournament.format || '',
        stage: m.stage || (m.matchKind === 'group' ? 'group' : ''),
        groupCode: m.groupCode || '',
        groupSlot1: m.groupSlot1 || null,
        groupSlot2: m.groupSlot2 || null,
```

`groupSlot1/2` 写入是为了录分页能显示"A 组 1 号签 vs 2 号签"，不写就只能显示选手名。

Add to skeleton doc（line 291 之后的 R2+ pre-create `doc = { ... }`），紧跟 `tournamentType: matchType,` 之后：

```js
          format: tournament.format || '',
          stage: m.stage || bracket.stage || '',
          groupCode: m.groupCode || bracket.groupCode || '',
          groupSlot1: m.groupSlot1 || null,
          groupSlot2: m.groupSlot2 || null,
```

Update orphan query (line 328 的 `_.in([...])`)：

```js
      matchKind: _.in(['bracket', 'regularRound', 'extra', 'group'])
```

For group knockout skeleton pre-create（line 280 的 `.where(...)`），filter only knockout docs:

```js
      .where(tournament.format === 'group_knockout'
        ? { tournamentId, stage: 'knockout', round: _.gt(1) }
        : { tournamentId, round: _.gt(1) })
```

- [ ] **Step 4: Run match-results tests**

Run: `cd cloudfunctions/match-results && npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit match result support**

```bash
git add cloudfunctions/match-results/index.js cloudfunctions/match-results/__tests__/direct-get-schedule-gate.test.js
git commit -m "feat: support group knockout score rows"
```

---

### Task 7: Stage-Aware Advancement and Settlement Trigger

**Files:**
- Modify: `cloudfunctions/match-results/lib/state.js`
- Modify: `cloudfunctions/match-results/lib/__tests__/state.test.js`

- [ ] **Step 1: Add failing state tests**

Add tests to `cloudfunctions/match-results/lib/__tests__/state.test.js`:

```js
test('group knockout bracket advancement uses knockout bracket doc ids', async () => {
  const { svc, db } = makeService()
  db.seed({
    tournaments: [{ _id: 'tournament_1', format: 'group_knockout', type: 'singles', seasonId: 'season_2026', scheduleStatus: 'published', pointsRules: { winLoss: { win: 20, loss: 10, walkover: 0 } } }],
    tournament_brackets: [{
      _id: 'bracket_1_knockout_round_2',
      tournamentId: 'tournament_1',
      stage: 'knockout',
      round: 2,
      matches: [{ matchId: 'sf1', round: 2, position: 1, player1: null, player2: null }]
    }],
    match_results: [{
      _id: 'result_1_qf1',
      tournamentId: 'tournament_1',
      sourceMatchId: 'qf1',
      matchKind: 'bracket',
      stage: 'knockout',
      round: 1,
      position: 1,
      player1: { id: 'a1', name: 'A1' },
      player2: { id: 'c2', name: 'C2' },
      resultStatus: 'pending',
      playerIds: ['a1', 'c2']
    }]
  })
  await svc.submitResult({ matchId: 'qf1', score: { sets: [{ a: 4, b: 1 }] }, submitter: { _id: 'admin', isAdmin: true } })
  expect(db.get('tournament_brackets', 'bracket_1_knockout_round_2').matches[0].player1).toEqual({ id: 'a1', name: 'A1' })
})
```

- [ ] **Step 2: Run state test to verify failure**

Run: `cd cloudfunctions/match-results && npm test -- --runInBand lib/__tests__/state.test.js -t "group knockout bracket advancement"`

Expected: FAIL because `bracketDocId` currently resolves `bracket_1_round_2`.

- [ ] **Step 3: Make bracket doc lookup stage-aware**

**避免双份格式漂移**：在 `cloudfunctions/match-results/lib/state.js` 顶部 require pure module 的 `knockoutBracketDocId`，让 match-results 和 tournament-brackets 共用同一份 doc id 生成逻辑。

> 注意：微信云函数之间通常**不能**跨目录 require。如果 `cloudfunctions/match-results/lib/state.js` 不能 require `cloudfunctions/tournament-brackets/lib/group-knockout.js`，则把 `knockoutBracketDocId`/`groupBracketDocId`/`normalizeTournamentId` 三个纯函数额外复制到 `cloudfunctions/match-results/lib/group-knockout-id.js`，并在两份文件顶部都注释 "**与 `cloudfunctions/tournament-brackets/lib/group-knockout.js` 同步**，修改需双改"。验收：用一个共享测试断言两份返回值一致（在 `cloudfunctions/_shared/__tests__/` 加 cross-module id parity 测试，加载两侧函数对比输出）。

替换 `bracketDocId(tournamentId, round)` 为：

```js
  // 与 cloudfunctions/tournament-brackets/lib/group-knockout.js 同步，修改需双改。
  function bracketDocId(tournamentId, round, stage) {
    const normalized = String(tournamentId || '').replace(/^tournament_/, '')
    if (stage === 'knockout') return `bracket_${normalized}_knockout_round_${round}`
    return `bracket_${normalized}_round_${round}`
  }
```

Update all calls using a result row:

```js
const currentDocId = bracketDocId(result.tournamentId, result.round || 1, result.stage)
const docId = bracketDocId(result.tournamentId, nextRound, result.stage)
const docId = bracketDocId(tournamentId, nextRound, oldMatch.stage)
```

When recursively calling `clearDownstream`, pass `stage`:

```js
await clearDownstream(tournamentId, { ...refreshed, round: nextRound, position: nextPosition, stage: oldMatch.stage })
```

- [ ] **Step 4: Add final settlement trigger hook**

**关键**：`refreshTournamentSettlementStatus(tournamentId)` 在 `state.js` 中被四处调用——`submitResult` (line 35)、basic confirm 路径 (line 62)、`reconfirmMatch` (line 89 与 line 164)。最常见的"选手互相确认决赛"走的是 line 62 的 basic confirm，**不挂在那里会让正常比赛流的赛事永远不结算**。

最干净的做法是把触发器嵌进 `refreshTournamentSettlementStatus` 内部：每次它把赛事 status 写为 `completed` 之后，紧跟着调用 `maybeTriggerGroupKnockoutSettlement`。

在 `refreshTournamentSettlementStatus` 内 (line 385 起)，找到 `await updateDoc('tournaments', tournamentId, { status: 'completed', completedAt: now, updateTime: now }, ...)` 的位置，紧跟在它后面加：

```js
      await maybeTriggerGroupKnockoutSettlement(tournamentId)
```

注意：`maybeTriggerGroupKnockoutSettlement` 自身负责判断 `format` 并 early-return，所以挂在通用路径是安全的。

Define:

```js
  async function maybeTriggerGroupKnockoutSettlement(tournamentId) {
    const tournament = await getTournament(tournamentId)
    if (!tournament || tournament.format !== 'group_knockout') return { skipped: true, reason: 'not_group_knockout' }
    // 幂等：决赛被 reconfirm 多次时不重复触发；失败重试由管理员从详情页"重新结算"入口走（见 Task 10 D2 修复）
    if (tournament.groupKnockoutPhase === 'completed') return { skipped: true, reason: 'already_settled' }
    const finalRows = ((await db.collection('match_results').where({ tournamentId, stage: 'knockout', round: 3 }).get()).data || []).filter(isActiveScoreRow)
    const final = finalRows[0]
    if (!final || final.resultStatus !== 'confirmed') return { skipped: true, reason: 'final_not_confirmed' }
    const res = await cloudCallPointsEngine({ tournamentId })
    if (!(res && res.success)) {
      console.error('[match-results] group knockout settlement failed for', tournamentId, res && res.error)
      // 不写 groupKnockoutPhase=completed，允许 Task 10 "重新结算" 入口重试。
      // 注意：points-engine.recomputeGroupKnockout 成功时会自己写 phase=completed，这里不重复写。
      return { skipped: true, reason: 'points_failed', error: res && res.error }
    }
    return { skipped: false }
  }

  async function cloudCallPointsEngine({ tournamentId }) {
    if (db.__testPointsEngine) return db.__testPointsEngine({ action: 'recompute', tournamentId })
    try {
      const cloud = require('wx-server-sdk')
      const res = await cloud.callFunction({ name: 'points-engine', data: { action: 'recompute', tournamentId } })
      return res && res.result
    } catch (e) {
      console.error('[match-results] group knockout settlement failed', e)
      return { success: false, error: { code: 'POINTS_ENGINE_FAILED', message: e.message } }
    }
  }
```

If the local test harness does not expose `cloud.callFunction`, use `db.__testPointsEngine` in tests and keep the production fallback above.

- [ ] **Step 5: Run state tests**

Run: `cd cloudfunctions/match-results && npm test -- --runInBand lib/__tests__/state.test.js`

Expected: PASS.

- [ ] **Step 6: Commit advancement and settlement trigger**

```bash
git add cloudfunctions/match-results/lib/state.js cloudfunctions/match-results/lib/__tests__/state.test.js
git commit -m "feat: advance group knockout brackets"
```

---

### Task 8: Points Engine Group-Knockout Settlement

**Files:**
- Create: `cloudfunctions/points-engine/lib/group-knockout.js`
- Create: `cloudfunctions/points-engine/lib/__tests__/group-knockout.test.js`
- Modify: `cloudfunctions/points-engine/index.js`

- [ ] **Step 1: Add failing points tests**

Create `cloudfunctions/points-engine/lib/__tests__/group-knockout.test.js`:

```js
const { buildGroupKnockoutPointEntries } = require('../group-knockout')

function groupRow(player1, player2, winnerId) {
  return {
    stage: 'group',
    matchKind: 'group',
    resultStatus: 'confirmed',
    player1: { id: player1 },
    player2: { id: player2 },
    winner: { id: winnerId }
  }
}

function koRow(round, player1, player2, winnerId) {
  return {
    stage: 'knockout',
    matchKind: 'bracket',
    round,
    resultStatus: 'confirmed',
    player1: { id: player1 },
    player2: { id: player2 },
    winner: { id: winnerId }
  }
}

test('16 sign awards placement to top 8 and group points to non-qualifiers only', () => {
  const rows = [
    groupRow('a1', 'a3', 'a1'),
    groupRow('a2', 'a4', 'a2'),
    koRow(1, 'a1', 'c2', 'a1'),
    koRow(1, 'b1', 'd2', 'b1'),
    koRow(1, 'c1', 'a2', 'a2'),
    koRow(1, 'd1', 'b2', 'd1'),
    koRow(2, 'a1', 'b1', 'a1'),
    koRow(2, 'a2', 'd1', 'd1'),
    koRow(3, 'a1', 'd1', 'a1')
  ]
  const entries = buildGroupKnockoutPointEntries({ tournament: { bracketSize: 16 }, rows })
  expect(entries.find(e => e.memberId === 'a1')).toMatchObject({ rank: 'champion', points: 500 })
  expect(entries.find(e => e.memberId === 'd1')).toMatchObject({ rank: 'runnerUp', points: 350 })
  expect(entries.find(e => e.memberId === 'a3')).toMatchObject({ rank: 'group', points: 25 })
  expect(entries.find(e => e.memberId === 'a2').points).toBe(250)
  // Top 8 都拿名次分，没拿 group 累计分
  expect(entries.find(e => e.memberId === 'c2').rank).toBe('quarterfinal')
  expect(entries.find(e => e.memberId === 'c2').points).toBe(180)
  // a4 只打了小组赛输一场
  expect(entries.find(e => e.memberId === 'a4')).toMatchObject({ rank: 'group', points: 25 })
})

test('12 sign awards 250/150/100/65 placement and 20/10 group points', () => {
  const rows = [
    // 小组赛 (12 场)
    groupRow('a1', 'a2', 'a1'), groupRow('a1', 'a3', 'a1'), groupRow('a2', 'a3', 'a2'),
    groupRow('b1', 'b2', 'b1'), groupRow('b1', 'b3', 'b1'), groupRow('b2', 'b3', 'b2'),
    groupRow('c1', 'c2', 'c1'), groupRow('c1', 'c3', 'c1'), groupRow('c2', 'c3', 'c2'),
    groupRow('d1', 'd2', 'd1'), groupRow('d1', 'd3', 'd1'), groupRow('d2', 'd3', 'd2'),
    // 8 强 / 半决赛 / 决赛
    koRow(1, 'a1', 'c2', 'a1'),
    koRow(1, 'b1', 'd2', 'b1'),
    koRow(1, 'c1', 'a2', 'c1'),
    koRow(1, 'd1', 'b2', 'd1'),
    koRow(2, 'a1', 'b1', 'a1'),
    koRow(2, 'c1', 'd1', 'c1'),
    koRow(3, 'a1', 'c1', 'a1')
  ]
  const entries = buildGroupKnockoutPointEntries({ tournament: { bracketSize: 12 }, rows })
  expect(entries.find(e => e.memberId === 'a1')).toMatchObject({ rank: 'champion', points: 250 })
  expect(entries.find(e => e.memberId === 'c1')).toMatchObject({ rank: 'runnerUp', points: 150 })
  expect(entries.find(e => e.memberId === 'b1')).toMatchObject({ rank: 'semifinal', points: 100 })
  expect(entries.find(e => e.memberId === 'a2')).toMatchObject({ rank: 'quarterfinal', points: 65 })
  // 未晋级的 a3 只打了小组赛输 2 场
  expect(entries.find(e => e.memberId === 'a3')).toMatchObject({ rank: 'group', points: 20 })  // 0 胜 2 负 = 20
})
```

补一个 recompute 分发测试，确保 group_knockout 不走默认 winLoss 路径（这是 B3 风险的回归保护）。新增 `cloudfunctions/points-engine/__tests__/recompute-dispatch.test.js`：

```js
let mockState
jest.mock('wx-server-sdk', () => {
  const db = {
    command: { in: v => ({ $in: v }) },
    collection: jest.fn(name => ({
      doc: id => ({ get: jest.fn(async () => ({ data: mockState.collections[name].get(id) || null })) }),
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ data: [...(mockState.collections[name] || new Map()).values()] })),
        limit: jest.fn(function () { return this })
      }))
    })),
  }
  return { init: jest.fn(), DYNAMIC_CURRENT_ENV: 'test-env', database: jest.fn(() => db) }
})

const { main } = require('../index')
const buildGK = require('../lib/group-knockout')

beforeEach(() => {
  mockState = {
    collections: {
      tournaments: new Map([['t1', { _id: 't1', format: 'group_knockout', bracketSize: 16, type: 'singles', seasonId: 's1' }]]),
      match_results: new Map()
    }
  }
})

test('recompute dispatches group_knockout to group_knockout branch, not default winLoss path', async () => {
  const spy = jest.spyOn(buildGK, 'buildGroupKnockoutPointEntries').mockReturnValue([])
  const res = await main({ action: 'recompute', tournamentId: 't1' })
  expect(res.success).toBe(true)
  expect(res.data.source).toBe('group_knockout')
  expect(spy).toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd cloudfunctions/points-engine && npm test -- --runInBand lib/__tests__/group-knockout.test.js`

Expected: FAIL with missing module.

- [ ] **Step 3: Implement point entry builder**

Create `cloudfunctions/points-engine/lib/group-knockout.js`:

```js
'use strict'

const DEFAULTS = {
  12: { placement: { champion: 250, runnerUp: 150, semifinal: 100, quarterfinal: 65 }, group: { win: 20, loss: 10 } },
  16: { placement: { champion: 500, runnerUp: 350, semifinal: 250, quarterfinal: 180 }, group: { win: 50, loss: 25 } }
}

function buildGroupKnockoutPointEntries({ tournament, rows }) {
  const size = Number(tournament && tournament.bracketSize) || 16
  const rules = ((tournament.pointsRules || {}).groupKnockout || {})[String(size)] || DEFAULTS[size] || DEFAULTS[16]
  const knockout = (rows || []).filter(row => row.stage === 'knockout' && row.resultStatus === 'confirmed')
  const group = (rows || []).filter(row => row.stage === 'group' && row.resultStatus === 'confirmed')
  const entriesByMember = new Map()
  const top8 = new Set()

  for (const row of knockout.filter(r => r.round === 1)) {
    addSideIds(row.player1, top8)
    addSideIds(row.player2, top8)
  }

  const final = knockout.find(row => row.round === 3 && row.winner && row.winner.id)
  if (final) {
    setPlacement(entriesByMember, final.winner.id, 'champion', rules.placement.champion)
    const runnerUp = loserOf(final)
    if (runnerUp) setPlacement(entriesByMember, runnerUp.id, 'runnerUp', rules.placement.runnerUp)
  }

  for (const row of knockout.filter(r => r.round === 2)) {
    const loser = loserOf(row)
    if (loser) setPlacement(entriesByMember, loser.id, 'semifinal', rules.placement.semifinal)
  }
  for (const row of knockout.filter(r => r.round === 1)) {
    const loser = loserOf(row)
    if (loser) setPlacement(entriesByMember, loser.id, 'quarterfinal', rules.placement.quarterfinal)
  }

  for (const row of group) {
    for (const side of [row.player1, row.player2]) {
      if (!side || !side.id || top8.has(side.id)) continue
      const current = entriesByMember.get(side.id) || { memberId: side.id, rank: 'group', points: 0 }
      current.points += row.winner && row.winner.id === side.id ? rules.group.win : rules.group.loss
      entriesByMember.set(side.id, current)
    }
  }

  return [...entriesByMember.values()]
}

function setPlacement(map, memberId, rank, points) {
  if (!memberId || map.has(memberId)) return
  map.set(memberId, { memberId, rank, points })
}

function loserOf(row) {
  const winnerId = row && row.winner && row.winner.id
  if (!winnerId) return null
  if (row.player1 && row.player1.id === winnerId) return row.player2 || null
  if (row.player2 && row.player2.id === winnerId) return row.player1 || null
  return null
}

function addSideIds(side, set) {
  if (side && side.id) set.add(side.id)
}

module.exports = { buildGroupKnockoutPointEntries }
```

- [ ] **Step 4: Branch recompute before default win/loss path**

In `cloudfunctions/points-engine/index.js`, import:

```js
const { buildGroupKnockoutPointEntries } = require('./lib/group-knockout')
```

At the start of `async function recompute({ tournamentId })`, after loading `t`, add:

```js
  if (t.format === 'group_knockout') {
    return await recomputeGroupKnockout({ tournamentId, tournament: t })
  }
```

**积分存储位置**：沿用现有 `recompute` 的存储方式——通过 `replacePointsAwarded(matchResultId, { source, entries })` 把积分写到 `match_results.pointsAwarded`（line 52 现有路径），不引入新集合。group_knockout 的特殊点是：每位选手只发一条积分结果，所以选一条"代表性 match_result"作为载体（每位选手的最后一场比赛），其它 match_result 的 `pointsAwarded` 保持 `{ source: 'match', entries: [] }`。

Add helper:

```js
async function recomputeGroupKnockout({ tournamentId, tournament }) {
  const rows = (await db.collection('match_results').where({ tournamentId, resultStatus: 'confirmed' }).limit(500).get()).data || []
  const entries = buildGroupKnockoutPointEntries({ tournament, rows })

  // 为每位选手选一条载体 match_result：优先取该选手最高轮次的比赛
  const carrierByMember = pickCarrierMatches(rows, entries.map(e => e.memberId))

  // 先清空所有 match_result.pointsAwarded（避免上一次 recompute 残留）
  for (const row of rows) {
    if (row.bye) continue
    await replacePointsAwarded(row._id, { source: 'group_knockout', entries: [] })
  }

  // 再把每位选手的积分写到其载体 match_result
  let count = 0
  for (const entry of entries) {
    const carrierId = carrierByMember.get(entry.memberId)
    if (!carrierId) continue
    await replacePointsAwarded(carrierId, {
      source: 'group_knockout',
      entries: [{ memberId: entry.memberId, points: entry.points, rank: entry.rank }]
    })
    count += 1
  }

  // 结算成功后把 phase 推到 completed（自动触发与手动"重新结算"共享此路径）
  await db.collection('tournaments').doc(tournamentId).update({
    data: { groupKnockoutPhase: 'completed', updateTime: new Date() }
  })

  return { success: true, data: { count, source: 'group_knockout' } }
}

function pickCarrierMatches(rows, memberIds) {
  // 每位选手选其参与的最高 round 的比赛；同 round 取 stage='knockout' 优先
  const out = new Map()
  const stageWeight = { group: 0, knockout: 1 }
  for (const row of rows) {
    if (row.bye) continue
    for (const side of [row.player1, row.player2]) {
      if (!side || !side.id || !memberIds.includes(side.id)) continue
      const prev = out.get(side.id)
      const prevRow = prev && rows.find(r => r._id === prev)
      const better = !prev
        || (Number(row.round) > Number(prevRow.round))
        || (Number(row.round) === Number(prevRow.round) && (stageWeight[row.stage] || 0) > (stageWeight[prevRow.stage] || 0))
      if (better) out.set(side.id, row._id)
    }
  }
  return out
}
```

注意：`replacePointsAwarded` 是 points-engine 现有 helper（line 52 上下文）。如果它的签名是 `replacePointsAwarded(matchResultId, payload)`，直接复用；若不是，本任务**不要**改它，而是把上面的写入用 `db.collection('match_results').doc(id).update({ data: { pointsAwarded: ... } })` 显式实现。

- [ ] **Step 5: Run points-engine tests**

Run: `cd cloudfunctions/points-engine && npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit settlement**

```bash
git add cloudfunctions/points-engine/index.js cloudfunctions/points-engine/lib/group-knockout.js cloudfunctions/points-engine/lib/__tests__/group-knockout.test.js
git commit -m "feat: settle group knockout points"
```

---

### Task 9: Mini Program Create Flow

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.js`
- Modify: `miniprogram/pages/tournament-edit/index.wxml`
- Modify: `miniprogram/pages/tournament-edit/index.wxss`
- Modify: `miniprogram/pages/tournament-edit/__tests__/index.test.js`

- [ ] **Step 1: Add failing frontend tests**

Add tests:

```js
test('group knockout locks type to singles and defaults bracket size', () => {
  const ctx = makeCtx(def)
  ctx.onChipTap({ currentTarget: { dataset: { k: 'format', v: 'group_knockout' } } })
  expect(ctx.data.form.format).toBe('group_knockout')
  expect(ctx.data.form.type).toBe('singles')
  expect(ctx.data.form.bracketSize).toBe(16)
  expect(ctx.data.form.maxPlayers).toBe(16)
})

test('group knockout bracket size syncs maxPlayers', () => {
  const ctx = makeCtx(def, { form: { ...def.data.form, format: 'group_knockout', type: 'singles', bracketSize: 16, maxPlayers: 16 } })
  // 注意：dataset 在微信小程序里都是 string，测试也用 string 保持一致
  ctx.onChipTap({ currentTarget: { dataset: { k: 'bracketSize', v: '12' } } })
  expect(ctx.data.form.bracketSize).toBe(12)
  expect(ctx.data.form.maxPlayers).toBe(12)
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-edit/__tests__/index.test.js -t "group knockout"`

Expected: FAIL because `group_knockout` is not handled.

- [ ] **Step 3: Update form defaults and chip behavior**

In `miniprogram/pages/tournament-edit/index.js`, add to `data.form`:

```js
      bracketSize: 16,
      groupDrawMode: 'onsite',
```

Update `hydrateDraft` form mapping:

```js
        bracketSize: t.bracketSize || t.maxPlayers || 16,
        groupDrawMode: t.groupDrawMode || 'onsite',
```

Update `onChipTap`:

```js
    if (k === 'format') {
      const patch = { 'form.format': v }
      if (v === 'knockout' && this.data.form.type === 'mixed') patch['form.type'] = 'singles'
      if (v === 'group_knockout') {
        patch['form.type'] = 'singles'
        patch['form.bracketSize'] = this.data.form.bracketSize || 16
        patch['form.maxPlayers'] = this.data.form.bracketSize || 16
        patch['form.groupDrawMode'] = this.data.form.groupDrawMode || 'onsite'
      }
      this.setData(patch)
      return
    }
    if (k === 'bracketSize') {
      const size = parseInt(v, 10)
      this.setData({ 'form.bracketSize': size, 'form.maxPlayers': size })
      return
    }
    if (k === 'groupDrawMode') {
      this.setData({ 'form.groupDrawMode': v })
      return
    }
    if (k === 'type' && this.data.form.format === 'group_knockout' && v !== 'singles') {
      wx.showToast({ title: '小组赛+淘汰赛只支持单打', icon: 'none' })
      return
    }
```

Update `_remainingPlayerSlots`:

```js
    if (this.data.form.format === 'group_knockout') {
      const cap = this.data.form.bracketSize || 16
      return Math.max(1, cap - this.data.selectedPlayers.length)
    }
```

Update `_minPlayers`:

```js
    if (this.data.form.format === 'group_knockout') return this.data.form.bracketSize || 16
```

- [ ] **Step 4: Update WXML controls**

In `miniprogram/pages/tournament-edit/index.wxml`, add format chip beside current ones:

```xml
<text class="chip {{form.format === 'group_knockout' ? 'active' : ''}}" bindtap="onChipTap" data-k="format" data-v="group_knockout">小组+淘汰</text>
```

Add bracket-size and draw-mode fields visible only for group knockout:

```xml
<view wx:if="{{form.format === 'group_knockout'}}" class="field">
  <text class="label label-strong">签位规模</text>
  <view class="chip-row">
    <text class="chip {{form.bracketSize === 12 ? 'active' : ''}}" bindtap="onChipTap" data-k="bracketSize" data-v="12">12签</text>
    <text class="chip {{form.bracketSize === 16 ? 'active' : ''}}" bindtap="onChipTap" data-k="bracketSize" data-v="16">16签</text>
  </view>
</view>

<view wx:if="{{form.format === 'group_knockout'}}" class="field">
  <text class="label label-strong">分组方式</text>
  <view class="chip-row">
    <text class="chip {{form.groupDrawMode === 'onsite' ? 'active' : ''}}" bindtap="onChipTap" data-k="groupDrawMode" data-v="onsite">现场抽签后录入</text>
    <text class="chip {{form.groupDrawMode === 'preset' ? 'active' : ''}}" bindtap="onChipTap" data-k="groupDrawMode" data-v="preset">提前设计</text>
  </view>
</view>
```

- [ ] **Step 5: Run edit-page tests**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-edit/__tests__/index.test.js`

Expected: PASS.

- [ ] **Step 6: Commit create flow**

```bash
git add miniprogram/pages/tournament-edit/index.js miniprogram/pages/tournament-edit/index.wxml miniprogram/pages/tournament-edit/index.wxss miniprogram/pages/tournament-edit/__tests__/index.test.js
git commit -m "feat: create group knockout tournaments"
```

---

### Task 10: Detail Page Phase and Footer Actions

**Files:**
- Modify: `miniprogram/pages/tournament-detail/index.js`
- Modify: `miniprogram/pages/tournament-detail/index.wxml`
- Modify: `miniprogram/pages/tournament-detail/index.wxss`
- Modify: `miniprogram/pages/tournament-detail/__tests__/index.test.js`

- [ ] **Step 1: Add failing detail tests**

Add tests:

```js
test('group knockout draft shows arrange bracket footer action', async () => {
  const ctx = await loadDetail({
    tournament: { _id: 't1', format: 'group_knockout', type: 'singles', bracketSize: 16, groupKnockoutPhase: 'group_draft', status: 'upcoming', scheduleStatus: 'none' },
    isAdmin: true
  })
  expect(ctx.data.footerActions.map(a => a.key)).toContain('arrangeGroupBracket')
})

test('group knockout published shows score action', async () => {
  const ctx = await loadDetail({
    tournament: { _id: 't1', format: 'group_knockout', type: 'singles', bracketSize: 16, groupKnockoutPhase: 'group_published', status: 'upcoming', scheduleStatus: 'published' },
    isAdmin: true
  })
  expect(ctx.data.footerActions.map(a => a.key)).toContain('enterScore')
})
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js -t "group knockout"`

Expected: FAIL because footer action is missing.

- [ ] **Step 3: Add detail actions**

In `buildDetailPhaseState`, before default schedule actions, add:

```js
  if (tournament.format === 'group_knockout') {
    return buildGroupKnockoutDetailPhaseState({ tournament, isAdmin, isParticipant, canOpenScore, scoreActionLabel })
  }
```

Add helper:

```js
function buildGroupKnockoutDetailPhaseState({ tournament, isAdmin, isParticipant, canOpenScore, scoreActionLabel }) {
  const phase = tournament.groupKnockoutPhase || 'group_draft'
  // 兜底入口：决赛已 confirm 且 status='completed' 但 phase 还停在 knockout_published（积分引擎之前失败过）
  const needsResettle = isAdmin && phase === 'knockout_published' && tournament.status === 'completed'
  const footerActions = []
  if (isAdmin && phase === 'group_draft') {
    footerActions.push({ key: 'arrangeGroupBracket', label: '安排签表', className: 'primary full' })
  } else if (isAdmin && phase === 'group_completed') {
    footerActions.push({ key: 'confirmKnockoutSeeds', label: '确认8强', className: 'primary full' })
  } else if (needsResettle) {
    footerActions.push({ key: 'resettleGroupKnockout', label: '重新结算', className: 'primary full' })
  } else if (['group_published', 'knockout_published'].includes(phase)) {
    footerActions.push({ key: 'viewBracket', label: '查看签表', className: 'secondary' })
    footerActions.push({ key: 'enterScore', label: scoreActionLabel || '录入成绩', className: 'primary' })
  } else {
    footerActions.push({ key: 'viewBracket', label: '查看签表', className: 'primary full' })
  }
  return {
    phase: phase === 'completed' ? PHASE.RESULTS : PHASE.SCHEDULE_PUBLISHED,
    phaseSteps: buildGroupKnockoutPhaseSteps(phase),
    showScheduleSection: false,
    showResultsSection: phase === 'completed',
    footerActions,
    canOpenScore
  }
}

function buildGroupKnockoutPhaseSteps(phase) {
  const order = [
    { key: 'registration', label: '报名' },
    { key: 'group', label: phase === 'group_draft' ? '签表' : '小组赛' },
    { key: 'knockout', label: '淘汰赛' },
    { key: 'results', label: '赛果' }
  ]
  const activeIndex = phase === 'group_draft' || phase === 'group_published' || phase === 'group_completed'
    ? 1
    : phase === 'knockout_published'
      ? 2
      : 3
  return order.map((step, index) => ({ ...step, active: index === activeIndex, done: index < activeIndex }))
}
```

Add methods:

```js
  onArrangeGroupBracket() {
    wx.navigateTo({ url: `/pages/tournament-brackets/index?id=${this.data.tournamentId}&mode=arrange` })
  },

  onViewBracket() {
    wx.navigateTo({ url: `/pages/tournament-brackets/index?id=${this.data.tournamentId}` })
  },

  async onConfirmKnockoutSeeds() {
    const res = await wx.cloud.callFunction({ name: 'tournament-brackets', data: { action: 'confirmKnockoutSeeds', tournamentId: this.data.tournamentId } })
    if (!(res.result && res.result.success)) {
      wx.showToast({ title: (res.result && res.result.error && res.result.error.message) || '确认失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已生成8强', icon: 'success' })
    this.refresh()
  },

  async onResettleGroupKnockout() {
    const res = await wx.cloud.callFunction({ name: 'points-engine', data: { action: 'recompute', tournamentId: this.data.tournamentId } })
    if (!(res.result && res.result.success)) {
      wx.showToast({ title: (res.result && res.result.error && res.result.error.message) || '结算失败', icon: 'none' })
      return
    }
    wx.showToast({ title: '已重新结算', icon: 'success' })
    this.refresh()
  },
```

Update footer WXML:

```xml
<view wx:elif="{{item.key === 'arrangeGroupBracket'}}" class="footer-cta {{item.className}}" bindtap="onArrangeGroupBracket">{{item.label}}</view>
<view wx:elif="{{item.key === 'viewBracket'}}" class="footer-cta {{item.className}}" bindtap="onViewBracket">{{item.label}}</view>
<view wx:elif="{{item.key === 'confirmKnockoutSeeds'}}" class="footer-cta {{item.className}}" bindtap="onConfirmKnockoutSeeds">{{item.label}}</view>
<view wx:elif="{{item.key === 'resettleGroupKnockout'}}" class="footer-cta {{item.className}}" bindtap="onResettleGroupKnockout">{{item.label}}</view>
```

- [ ] **Step 4: Add bracket summary section**

In WXML after hero, add:

```xml
<view wx:if="{{tournament.format === 'group_knockout'}}" class="td-section anim-stage-rise anim-delay-2">
  <view class="td-section-head">
    <text class="tape">签表 · BRACKET</text>
    <text class="td-section-count">{{tournamentDisplay.groupKnockoutProgressText}}</text>
  </view>
  <view class="gk-summary">
    <view class="gk-summary-row">
      <text class="gk-summary-title">分组签表</text>
      <text class="gk-summary-status">{{tournamentDisplay.groupDrawStatusText}}</text>
    </view>
    <view class="gk-summary-row">
      <text class="gk-summary-title">小组赛签表</text>
      <text class="gk-summary-status">{{tournamentDisplay.groupStageStatusText}}</text>
    </view>
    <view class="gk-summary-row">
      <text class="gk-summary-title">淘汰赛签表</text>
      <text class="gk-summary-status">{{tournamentDisplay.knockoutStatusText}}</text>
    </view>
  </view>
</view>
```

Add minimal CSS:

```css
.gk-summary {
  border-top: 4rpx solid var(--color-ink);
  border-bottom: 4rpx solid var(--color-ink);
}
.gk-summary-row {
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  border-top: 1rpx solid var(--color-border);
}
.gk-summary-row:first-child { border-top: 0; }
.gk-summary-title {
  font-size: 28rpx;
  font-weight: 900;
  color: var(--color-ink);
}
.gk-summary-status {
  flex: 0 0 auto;
  max-width: 220rpx;
  font-size: 22rpx;
  font-weight: 800;
  color: var(--color-muted);
  text-align: right;
}
```

- [ ] **Step 5: Run detail tests**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-detail/__tests__/index.test.js`

Expected: PASS.

- [ ] **Step 6: Commit detail page**

```bash
git add miniprogram/pages/tournament-detail/index.js miniprogram/pages/tournament-detail/index.wxml miniprogram/pages/tournament-detail/index.wxss miniprogram/pages/tournament-detail/__tests__/index.test.js
git commit -m "feat: show group knockout detail actions"
```

---

### Task 11: Bracket Page Arrange and Display States

**Files:**
- Modify: `miniprogram/pages/tournament-brackets/index.js`
- Modify: `miniprogram/pages/tournament-brackets/index.wxml`
- Modify: `miniprogram/pages/tournament-brackets/index.wxss`
- Modify: `miniprogram/pages/tournament-brackets/__tests__/index.test.js`

- [ ] **Step 1: Add failing bracket-page tests**

Add tests:

```js
test('group knockout bracket page has only group and knockout tabs', async () => {
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_draft', bracketSize: 16 },
    groupKnockoutBracket: { groups: [], groupBrackets: [], knockoutBrackets: [], standings: {} }
  })
  expect(ctx.data.tabs.map(t => t.key)).toEqual(['group', 'knockout'])
})

test('arrange mode saves groups then generates group matches', async () => {
  const calls = []
  const ctx = await loadPage({
    tournament: { _id: 't1', format: 'group_knockout', groupKnockoutPhase: 'group_draft', bracketSize: 12 },
    cloudCalls: calls
  })
  ctx.setData({ arrangeGroups: completeArrangeGroups12() })
  await ctx.onGenerateGroupMatches()
  expect(calls.map(call => call.data.action)).toEqual(['saveGroups', 'generateGroupMatches'])
})
```

- [ ] **Step 2: Run bracket-page tests to verify failure**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-brackets/__tests__/index.test.js -t "group knockout"`

Expected: FAIL because state and handlers do not exist.

- [ ] **Step 3: Load group-knockout payload**

In `index.js`, add data:

```js
    tabs: [{ key: 'group', label: '小组赛' }, { key: 'knockout', label: '淘汰赛' }],
    activeTab: 'group',
    groupKnockout: null,
    arrangeGroups: [],
    arrangeErrors: []
```

In `refresh`, branch:

```js
      if (tournament && tournament.format === 'group_knockout') {
        await this.refreshGroupKnockout(tournament)
        return
      }
```

Add:

```js
  async refreshGroupKnockout(tournament) {
    const res = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'getGroupKnockoutBracket', tournamentId: this.data.tournamentId }
    })
    const payload = (res.result && res.result.success && res.result.data) || { groups: [], groupBrackets: [], knockoutBrackets: [], standings: {} }
    this.setData({
      tournament,
      groupKnockout: decorateGroupKnockout(payload),
      arrangeGroups: buildArrangeGroups(payload.groups, tournament.bracketSize),
      r1Matches: [],
      laterRounds: [],
      decoratedCourts: [],
      scheduleGateBlocked: false
    })
  },

  onTabTap(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key })
  },
```

Add helper functions:

```js
function buildArrangeGroups(groups, bracketSize) {
  const size = Number(bracketSize) === 12 ? 3 : 4
  const byCode = Object.fromEntries((groups || []).map(g => [g.groupCode, g]))
  return ['A', 'B', 'C', 'D'].map(code => {
    const slots = Array.from({ length: size }, (_, index) => {
      const slotNo = index + 1
      const existing = byCode[code] && (byCode[code].slots || []).find(slot => slot.slotNo === slotNo)
      return existing || { slotNo, playerId: '', playerName: '' }
    })
    return { groupCode: code, slots }
  })
}

function decorateGroupKnockout(payload) {
  return {
    ...payload,
    groupBrackets: (payload.groupBrackets || []).map(group => ({
      ...group,
      matches: (group.matches || []).map(match => ({ ...match, __player1Name: playerLabel(match.player1), __player2Name: playerLabel(match.player2) }))
    })),
    knockoutBrackets: (payload.knockoutBrackets || []).map(round => ({
      ...round,
      matches: (round.matches || []).map(match => ({ ...match, __player1Name: playerLabel(match.player1), __player2Name: playerLabel(match.player2) }))
    }))
  }
}
```

- [ ] **Step 4: Add save/generate handler**

Add:

```js
  async onGenerateGroupMatches() {
    const save = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'saveGroups', tournamentId: this.data.tournamentId, groups: this.data.arrangeGroups }
    })
    if (!(save.result && save.result.success)) {
      this.setData({ arrangeErrors: (save.result && save.result.error && save.result.error.errors) || ['保存分组失败'] })
      return
    }
    const generated = await wx.cloud.callFunction({
      name: 'tournament-brackets',
      data: { action: 'generateGroupMatches', tournamentId: this.data.tournamentId }
    })
    if (!(generated.result && generated.result.success)) {
      this.setData({ arrangeErrors: (generated.result && generated.result.error && generated.result.error.errors) || ['生成小组赛失败'] })
      return
    }
    wx.showToast({ title: '已生成小组赛', icon: 'success' })
    await this.refresh()
  },
```

- [ ] **Step 5: Update WXML to two tabs and arrange state**

Add group-knockout branch near top:

```xml
<block wx:if="{{tournament.format === 'group_knockout'}}">
  <view class="gk-tabs">
    <view wx:for="{{tabs}}" wx:key="key" data-key="{{item.key}}" bindtap="onTabTap" class="gk-tab {{activeTab === item.key ? 'active' : ''}}">{{item.label}}</view>
  </view>

  <view wx:if="{{activeTab === 'group'}}" class="gk-groups">
    <block wx:if="{{tournament.groupKnockoutPhase === 'group_draft'}}">
      <view class="gk-group-card" wx:for="{{arrangeGroups}}" wx:key="groupCode">
        <view class="gk-group-head">
          <text>{{item.groupCode}}组</text>
          <text>{{item.slots.length}} 位</text>
        </view>
        <view class="gk-slot" wx:for="{{item.slots}}" wx:for-item="slot" wx:key="slotNo">
          <text class="slot-no">{{slot.slotNo}}</text>
          <text>{{slot.playerName || '选择选手'}}</text>
        </view>
      </view>
      <view wx:if="{{arrangeErrors.length}}" class="gk-errors">
        <text wx:for="{{arrangeErrors}}" wx:key="*this">{{item}}</text>
      </view>
      <view class="footer-cta primary full" bindtap="onGenerateGroupMatches">确认分组并生成小组赛</view>
    </block>
    <block wx:else>
      <view class="gk-group-card" wx:for="{{groupKnockout.groupBrackets}}" wx:key="_id">
        <view class="gk-group-head"><text>{{item.groupCode}}组</text></view>
        <view class="gk-match" wx:for="{{item.matches}}" wx:for-item="match" wx:key="matchId">
          <text>{{match.__player1Name}}</text>
          <text>VS</text>
          <text>{{match.__player2Name}}</text>
        </view>
      </view>
    </block>
  </view>

  <view wx:if="{{activeTab === 'knockout'}}" class="gk-knockout">
    <view wx:if="{{!groupKnockout.knockoutBrackets.length}}" class="td-empty">待小组赛结束并确认 8 强</view>
    <view wx:else class="gk-round" wx:for="{{groupKnockout.knockoutBrackets}}" wx:key="_id">
      <text class="gk-round-title">第{{item.round}}轮</text>
      <view class="gk-match" wx:for="{{item.matches}}" wx:for-item="match" wx:key="matchId">
        <text>{{match.player1Source || ''}} {{match.__player1Name}}</text>
        <text>VS</text>
        <text>{{match.player2Source || ''}} {{match.__player2Name}}</text>
      </view>
    </view>
  </view>
</block>
```

Keep existing regular/knockout rendering in an `wx:else` block.

- [ ] **Step 6: Add minimal CSS**

Add classes in `index.wxss`:

```css
.gk-tabs {
  display: flex;
  gap: 12rpx;
  margin-bottom: 24rpx;
}
.gk-tab {
  height: 56rpx;
  padding: 0 24rpx;
  display: flex;
  align-items: center;
  border: 2rpx solid var(--color-ink);
  border-radius: var(--radius-pill);
  font-size: 24rpx;
  font-weight: 900;
}
.gk-tab.active {
  background: var(--color-ink);
  color: var(--color-bg);
}
.gk-groups {
  display: grid;
  gap: 20rpx;
}
.gk-group-card,
.gk-round {
  border: 2rpx solid var(--color-ink);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  padding: 20rpx;
}
.gk-group-head,
.gk-slot,
.gk-match {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16rpx;
  min-height: 64rpx;
  border-bottom: 1rpx solid var(--color-border);
}
.gk-group-head {
  display: flex;
  justify-content: space-between;
  font-weight: 900;
}
.gk-slot {
  grid-template-columns: 48rpx 1fr;
}
.slot-no {
  width: 40rpx;
  height: 40rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-ink);
  color: var(--color-bg);
  border-radius: var(--radius-sm);
}
.gk-errors {
  display: grid;
  gap: 8rpx;
  color: var(--color-danger);
  font-size: 24rpx;
}
```

- [ ] **Step 7: Run bracket-page tests**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-brackets/__tests__/index.test.js`

Expected: PASS.

- [ ] **Step 8: Commit bracket page**

```bash
git add miniprogram/pages/tournament-brackets/index.js miniprogram/pages/tournament-brackets/index.wxml miniprogram/pages/tournament-brackets/index.wxss miniprogram/pages/tournament-brackets/__tests__/index.test.js
git commit -m "feat: render group knockout brackets"
```

---

### Task 12: Score Page Grouping

**Files:**
- Modify: `miniprogram/pages/tournament-score/index.js`
- Modify: `miniprogram/pages/tournament-score/index.wxml`
- Modify: `miniprogram/pages/tournament-score/__tests__/index.test.js`

- [ ] **Step 1: Confirm score page grouping variable**

先确认现有 score 页用的状态字段名（plan 假设是 `rowsByRound`，但可能是 `matchesByRound` 或 `groupedMatches`）：

```bash
grep -n "rowsByRound\|matchesByRound\|groupedMatches" miniprogram/pages/tournament-score/index.js miniprogram/pages/tournament-score/index.wxml
```

下面用 `rowsByRound` 占位，**worker 须按实际变量名替换**。

Add:

```js
test('group knockout score rows group by group then knockout round', async () => {
  const ctx = loadPage({
    tournament: { _id: 't1', format: 'group_knockout', type: 'singles' },
    matchResults: [
      { _id: 'g1', sourceMatchId: 'g1', stage: 'group', matchKind: 'group', groupCode: 'A', round: 1, position: 1, resultStatus: 'pending', player1: { id: 'a1' }, player2: { id: 'a2' } },
      { _id: 'qf1', sourceMatchId: 'qf1', stage: 'knockout', matchKind: 'bracket', round: 1, position: 1, resultStatus: 'pending', player1: { id: 'a1' }, player2: { id: 'c2' } }
    ]
  })
  await ctx.refresh()
  expect(ctx.data.rowsByRound.map(row => row.label)).toEqual(['A组', '8强'])
})
```

- [ ] **Step 2: Run score-page test to verify failure**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-score/__tests__/index.test.js -t "group knockout score rows"`

Expected: FAIL because labels are round numbers only.

- [ ] **Step 3: Add grouping helper**

In `index.js`, add:

```js
function groupScoreRows(tournament, rows) {
  if (tournament && tournament.format === 'group_knockout') return groupGroupKnockoutRows(rows)
  return groupRowsByRound(rows)
}

function groupGroupKnockoutRows(rows) {
  const output = []
  for (const code of ['A', 'B', 'C', 'D']) {
    const matches = (rows || []).filter(row => row.stage === 'group' && row.groupCode === code)
    if (matches.length) output.push({ round: `group_${code}`, label: `${code}组`, matches })
  }
  const roundLabels = { 1: '8强', 2: '半决赛', 3: '决赛' }
  for (const round of [1, 2, 3]) {
    const matches = (rows || []).filter(row => row.stage === 'knockout' && Number(row.round) === round)
    if (matches.length) output.push({ round: `knockout_${round}`, label: roundLabels[round], matches })
  }
  return output
}
```

Replace existing grouping call with `groupScoreRows(this.data.tournament, decoratedRows)`.

- [ ] **Step 4: Update WXML heading**

Where the score page renders `第{{item.round}}轮`, change to:

```xml
<text>{{item.label || ('第' + item.round + '轮')}}</text>
```

- [ ] **Step 5: Run score tests**

Run: `cd miniprogram && npm test -- --runInBand pages/tournament-score/__tests__/index.test.js`

Expected: PASS.

- [ ] **Step 6: Commit score grouping**

```bash
git add miniprogram/pages/tournament-score/index.js miniprogram/pages/tournament-score/index.wxml miniprogram/pages/tournament-score/__tests__/index.test.js
git commit -m "feat: group knockout score rows"
```

---

### Task 13: Registration Capacity and Self-Registration

**Files:**
- Modify: `miniprogram/utils/tournament-phase.js`
- Modify: `cloudfunctions/_shared/tournament-phase.js`
- Modify: `miniprogram/utils/__tests__/tournament-phase.test.js`
- Modify: `cloudfunctions/_shared/__tests__/tournament-phase.test.js`
- Modify: `cloudfunctions/tournament-registrations/lib/service.js`
- Modify: `cloudfunctions/tournament-registrations/__tests__/*.test.js`

- [ ] **Step 1: Add failing capacity tests**

In both tournament-phase test files, add:

```js
test('group knockout self registration respects bracketSize capacity', () => {
  const tournament = {
    format: 'group_knockout',
    type: 'singles',
    bracketSize: 16,
    registrationPublishedAt: '2026-05-01T00:00:00.000Z',
    registrationDeadlineAt: '2026-06-01T00:00:00.000Z'
  }
  expect(canRegister(tournament, { now: new Date('2026-05-02T00:00:00.000Z'), confirmedCount: 16 })).toEqual({ ok: false, code: 'CAPACITY_FULL' })
  expect(canRegister(tournament, { now: new Date('2026-05-02T00:00:00.000Z'), confirmedCount: 15 })).toEqual({ ok: true })
})
```

- [ ] **Step 2: Run parity-related tests to verify failure**

Run:

```bash
cd miniprogram && npm test -- --runInBand utils/__tests__/tournament-phase.test.js
cd ../cloudfunctions/_shared && npm test -- --runInBand __tests__/tournament-phase.test.js
```

Expected: FAIL because `group_knockout` capacity is not checked.

- [ ] **Step 3: Update canRegister in both mirrored files**

先 Read 两份文件确认 `canRegister` 现有签名和已有的 knockout 分支位置：

```bash
Read cloudfunctions/_shared/tournament-phase.js (offset=60, limit=50)
Read miniprogram/utils/tournament-phase.js (offset=60, limit=50)
```

**两个文件必须同次提交**（`scripts/check-tournament-phase-parity.sh` 强校验文件一致），不要分两个 commit。

In `canRegister`, after knockout singles capacity check, add（如果现有 knockout 分支不存在，直接追加到函数末尾、`return { ok: true }` 之前）：

```js
  if (tournament.format === 'group_knockout') {
    const max = Number(tournament.bracketSize || tournament.maxPlayers || 0)
    const confirmed = Number(options.confirmedCount === undefined ? tournament.confirmedCount : options.confirmedCount)
    if (max > 0 && confirmed >= max) return { ok: false, code: 'CAPACITY_FULL' }
  }
```

同时确认 `tournament-registrations` 的现有调用方传了 `confirmedCount` 给 `canRegister`：

```bash
grep -n "canRegister" cloudfunctions/tournament-registrations/lib/service.js
```

如果当前调用没传，按现有 knockout 容量分支同样的方式注入。

- [ ] **Step 4: Run parity script and tests**

Run:

```bash
scripts/check-tournament-phase-parity.sh
cd miniprogram && npm test -- --runInBand utils/__tests__/tournament-phase.test.js
cd ../cloudfunctions/_shared && npm test -- --runInBand __tests__/tournament-phase.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit registration capacity**

```bash
git add miniprogram/utils/tournament-phase.js cloudfunctions/_shared/tournament-phase.js miniprogram/utils/__tests__/tournament-phase.test.js cloudfunctions/_shared/__tests__/tournament-phase.test.js
git commit -m "feat: cap group knockout registration"
```

---

### Task 14: Rebuild and Snapshot Archive Rules

本任务实现两条撤回路径（覆盖 spec 状态机里的两条反向迁移）：

- `resetGroups`：`group_published` → `group_draft`，前提是没有任何 confirmed 小组赛成绩。
- `resetKnockoutSeeds`：`knockout_published` → `group_completed`，前提是没有任何 confirmed 淘汰赛成绩。


**Files:**
- Modify: `cloudfunctions/tournament-brackets/index.js`
- Modify: `cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js`

- [ ] **Step 1: Add failing reset tests**

Add:

```js
test('resetGroups rejects when any group match is confirmed', async () => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', groupKnockoutPhase: 'group_published'
  })
  mockState.collections.match_results.set('result_1_gA_p1', {
    _id: 'result_1_gA_p1', tournamentId: 'tournament_1', stage: 'group', resultStatus: 'confirmed'
  })
  const res = await main({ action: 'resetGroups', tournamentId: 'tournament_1' })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('GROUP_ALREADY_STARTED')
})

test('resetGroups clears group brackets and rewinds phase to group_draft', async () => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', groupKnockoutPhase: 'group_published'
  })
  mockState.collections.tournament_brackets.set('bracket_1_group_A', {
    _id: 'bracket_1_group_A', tournamentId: 'tournament_1', stage: 'group', groupCode: 'A', matches: []
  })
  const res = await main({ action: 'resetGroups', tournamentId: 'tournament_1' })
  expect(res.success).toBe(true)
  expect(mockState.collections.tournaments.get('tournament_1').groupKnockoutPhase).toBe('group_draft')
  expect(mockState.collections.tournament_brackets.has('bracket_1_group_A')).toBe(false)
})

test('resetKnockoutSeeds rejects confirmed knockout scores', async () => {
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', groupKnockoutPhase: 'knockout_published'
  })
  mockState.collections.match_results.set('result_1_qf1', {
    _id: 'result_1_qf1', tournamentId: 'tournament_1', stage: 'knockout', resultStatus: 'confirmed'
  })
  const res = await main({ action: 'resetKnockoutSeeds', tournamentId: 'tournament_1' })
  expect(res.success).toBe(false)
  expect(res.error.code).toBe('KNOCKOUT_ALREADY_STARTED')
})

test('resetKnockoutSeeds archives old snapshot to tournament_snapshots', async () => {
  const oldSnapshot = { seeds: { A1: { id: 'a1' } }, confirmedBy: 'admin', confirmedAt: 'T1' }
  mockState.collections.tournaments.set('tournament_1', {
    _id: 'tournament_1', format: 'group_knockout', groupKnockoutPhase: 'knockout_published',
    knockoutSeedSnapshot: oldSnapshot
  })
  // 没有 confirmed 的 knockout 比分
  mockState.collections.tournament_brackets.set('bracket_1_knockout_round_1', {
    _id: 'bracket_1_knockout_round_1', tournamentId: 'tournament_1', stage: 'knockout', matches: []
  })
  const res = await main({ action: 'resetKnockoutSeeds', tournamentId: 'tournament_1' })
  expect(res.success).toBe(true)
  expect(mockState.collections.tournaments.get('tournament_1').groupKnockoutPhase).toBe('group_completed')
  expect(mockState.collections.tournaments.get('tournament_1').knockoutSeedSnapshot).toBe(null)
  const snapshots = [...(mockState.collections.tournament_snapshots || new Map()).values()]
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0].kind).toBe('knockoutSeedSnapshot')
  expect(snapshots[0].snapshot).toEqual(oldSnapshot)
})
```

- [ ] **Step 2: Run reset test to verify failure**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand __tests__/group-knockout-actions.test.js -t resetKnockoutSeeds`

Expected: FAIL with invalid action.

- [ ] **Step 3: Implement reset actions**

Add switch cases:

```js
      case 'resetGroups': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleResetGroups(event)
      }

      case 'resetKnockoutSeeds': {
        const adminGate = await requireAdmin()
        if (adminGate) return adminGate
        return await handleResetKnockoutSeeds(event)
      }
```

Add `resetGroups` handler (covers spec 状态机 `group_published → group_draft`):

```js
async function handleResetGroups({ tournamentId }) {
  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (!tournament || tournament.format !== 'group_knockout') {
    return { success: false, error: { code: 'INVALID_TOURNAMENT', message: '赛事不是小组赛+淘汰赛' } }
  }
  const phase = tournament.groupKnockoutPhase || 'group_draft'
  if (!['group_published', 'group_completed'].includes(phase)) {
    return { success: false, error: { code: 'PHASE_LOCKED', message: `当前阶段 ${phase} 不允许撤回分组`, phase } }
  }
  const groupRows = (await db.collection('match_results').where({ tournamentId, stage: 'group' }).get().catch(() => ({ data: [] }))).data || []
  if (groupRows.some(row => row.resultStatus === 'confirmed')) {
    return { success: false, error: { code: 'GROUP_ALREADY_STARTED', message: '小组赛已有成绩，不能直接撤回分组' } }
  }
  // 同时清空潜在的淘汰赛 placeholder（group_completed 但还没 confirmKnockoutSeeds 不会有 KO doc，这里防御性清理）
  const groupBrackets = (await collection.where({ tournamentId, stage: 'group' }).get().catch(() => ({ data: [] }))).data || []
  for (const bracket of groupBrackets) await collection.doc(bracket._id).remove().catch(() => null)
  for (const row of groupRows) await db.collection('match_results').doc(row._id).remove().catch(() => null)
  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      groupKnockoutPhase: 'group_draft',
      groupRankSnapshot: null,
      updateTime: db.serverDate()
    }
  })
  return { success: true, data: { removedBrackets: groupBrackets.length, removedRows: groupRows.length } }
}
```

Add `resetKnockoutSeeds` handler:

```js
async function handleResetKnockoutSeeds({ tournamentId }) {
  const tournamentRes = await db.collection('tournaments').doc(tournamentId).get().catch(() => null)
  const tournament = tournamentRes && tournamentRes.data
  if (!tournament || tournament.format !== 'group_knockout') {
    return { success: false, error: { code: 'INVALID_TOURNAMENT', message: '赛事不是小组赛+淘汰赛' } }
  }
  const koRows = (await db.collection('match_results').where({ tournamentId, stage: 'knockout' }).get().catch(() => ({ data: [] }))).data || []
  if (koRows.some(row => row.resultStatus === 'confirmed')) {
    return { success: false, error: { code: 'KNOCKOUT_ALREADY_STARTED', message: '淘汰赛已有成绩，不能直接重排 8 强' } }
  }
  const koBrackets = (await collection.where({ tournamentId, stage: 'knockout' }).get().catch(() => ({ data: [] }))).data || []
  for (const bracket of koBrackets) await collection.doc(bracket._id).remove().catch(() => null)
  for (const row of koRows) await db.collection('match_results').doc(row._id).remove().catch(() => null)
  await archiveKnockoutSnapshot(tournamentId, tournament.knockoutSeedSnapshot)
  await db.collection('tournaments').doc(tournamentId).update({
    data: {
      knockoutSeedSnapshot: null,
      groupRankSnapshot: null,
      groupKnockoutPhase: 'group_completed',
      updateTime: db.serverDate()
    }
  })
  return { success: true, data: { removedBrackets: koBrackets.length, removedRows: koRows.length } }
}

async function archiveKnockoutSnapshot(tournamentId, snapshot) {
  if (!snapshot) return
  await db.collection('tournament_snapshots').add({
    data: {
      _id: `snapshot_${tournamentId}_${Date.now()}`,
      tournamentId,
      kind: 'knockoutSeedSnapshot',
      snapshot,
      overwrittenAt: db.serverDate()
    }
  }).catch(() => null)
}
```

- [ ] **Step 4: Run bracket tests**

Run: `cd cloudfunctions/tournament-brackets && npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit reset behavior**

```bash
git add cloudfunctions/tournament-brackets/index.js cloudfunctions/tournament-brackets/__tests__/group-knockout-actions.test.js
git commit -m "feat: reset group knockout seeds safely"
```

---

### Task 15: Full Regression and Deployment Checklist

**Files:**
- Modify: `docs/superpowers/plans/PROGRESS.md` if the repository tracks current plan progress there.

- [ ] **Step 1: Run backend cloud function suites**

Run:

```bash
cd cloudfunctions/tournaments && npm test -- --runInBand
cd ../tournament-brackets && npm test -- --runInBand
cd ../match-results && npm test -- --runInBand
cd ../points-engine && npm test -- --runInBand
cd ../_shared && npm test -- --runInBand
```

Expected: all PASS.

- [ ] **Step 2: Run mini program tests**

Run:

```bash
cd miniprogram && npm test -- --runInBand
```

Expected: all PASS.

- [ ] **Step 3: Run parity and smoke checks**

Run:

```bash
scripts/check-tournament-phase-parity.sh
node scripts/e2e-regression-smoke.js
```

Expected: parity PASS and smoke script exits 0. If `e2e-regression-smoke.js` requires unavailable cloud credentials, record the exact error in the final handoff and run all Jest suites instead.

- [ ] **Step 4: Manual acceptance pass in WeChat devtools**

Use a seeded 16-player test tournament:

1. Create `group_knockout` tournament with 16 sign and onsite draw.
2. Confirm the detail footer shows `安排签表`.
3. Enter A/B/C/D groups manually and generate group stage.
4. Confirm the bracket page has only `小组赛` and `淘汰赛` tabs.
5. Enter all group scores and confirm rankings update.
6. Confirm 8 players and verify QF pairings are A1-C2, B1-D2, C1-A2, D1-B2.
7. Confirm source labels only show in QF.
8. Enter knockout scores through final.
9. Verify `points-engine` writes one points row per player.

- [ ] **Step 5: Commit any final doc/progress update**

```bash
git status --short
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs: update group knockout progress"
```

Only run the commit command if `PROGRESS.md` was actually changed.

---

## Self-Review

Spec coverage:

- 赛制、12/16 sign, 4 groups, single round-robin, fixed QF pairings: Tasks 1, 4, 5.
- Ranking rules (N=2 vs N≥3 分支, gameDiff 全组范围), manual tiebreak, live standings: Tasks 2, 5, 11.
- Points settlement trigger 挂在 `refreshTournamentSettlementStatus` 内部覆盖 submit/basic confirm/reconfirm 所有路径; group_knockout 分发不走 winLoss 默认路径; 积分写入沿用 `match_results.pointsAwarded`：Tasks 7, 8.
- State machine（saveGroups PHASE_LOCKED, resetGroups, resetKnockoutSeeds, 失败重试入口）和 rebuild rules: Tasks 4, 5, 10, 14.
- `scheduleStatus` 与 `groupKnockoutPhase` 分离, group_knockout 全程 `scheduleStatus='none'`: Task 3.
- Create flow, detail footer (含 resettleGroupKnockout 兜底), arrange bracket button, bracket tabs, score page: Tasks 9, 10, 11, 12.
- Registration capacity and mirrored phase helper (双文件同次提交): Task 13.
- Regression coverage: Task 15.
- Cross-module id parity (`bracketDocId` 与 `knockoutBracketDocId` 同步): Task 7 + `_shared` parity test.

Placeholder scan:

- No task contains unresolved marker text.
- Code steps include concrete function names, paths, snippets, commands, and expected outcomes.

Type consistency:

- `format: 'group_knockout'`, `stage: 'group' | 'knockout'`, `matchKind: 'group' | 'bracket'`, `groupKnockoutPhase`, `bracketSize`, `groupDrawMode`, `groupRankSnapshot`, and `knockoutSeedSnapshot` match the spec.
- Bracket doc ids are `bracket_${shortId}_group_${groupCode}` and `bracket_${shortId}_knockout_round_${round}` throughout.
