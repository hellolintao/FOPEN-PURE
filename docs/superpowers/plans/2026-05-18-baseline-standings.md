# Baseline Standings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 2026 FUOPEN singles/doubles cumulative standings as one-time baseline scores, show unregistered players in rankings, and let exact-name registration claim the matching member record.

**Architecture:** Store manually transcribed baseline rows in a script-owned seed module, import them into `members` and a new `baseline_standings` collection, and extend the existing rank aggregator to add baseline totals before match and placement totals. Registration claims an unclaimed `members` row by exact name; ordinary pages render the same member records, while admin member management shows the unclaimed state.

**Tech Stack:** WeChat Mini Program native JS/WXML/WXSS, WeChat cloud functions with `wx-server-sdk`, local maintenance scripts with Node.js, Jest tests.

---

## Repo Workflow Note

This repo's project docs say commits happen only after user confirmation. The commit steps below are checkpoints for an executing worker; run them only when the user explicitly asks to commit.

## Final Implementation Notes

These notes reflect the code as implemented after review:

- `scripts/import-baseline-standings.js` imports only direct ranking fields into `baseline_standings`: `seasonId`, `type`, `memberId`, `playerName`, `rank`, `totalPoints`, `wins`, `losses`, source/baseline flags, and timestamps.
- The script does not write `winRate`, screenshot-only fields, or `rank_snapshots`.
- Unregistered players are stored as `members` placeholders with `_id: unclaimed_{playerName}`, `status: 'active'`, `claimStatus: 'unclaimed'`, no `openid/openId`, and `source/createdBy: 'baseline_import'`.
- Registration claims a placeholder by exact trimmed name using a conditional update on `_id`, `claimStatus: 'unclaimed'`, and absent `openid/openId`; concurrent conflicts return `CLAIM_CONFLICT`.
- `points-engine` and `weekly-star` aggregate `baseline_standings + match_results.pointsAwarded.entries + tournament_points`.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `scripts/lib/baseline-standings-data.js` | Create | Holds the one-time singles/doubles baseline seed rows and seed validation helpers. |
| `scripts/import-baseline-standings.js` | Create | Imports baseline seed rows into `members` and `baseline_standings`. |
| `scripts/__tests__/baseline-standings-data.test.js` | Create | Verifies seed totals, row counts, and key player values from the screenshots. |
| `scripts/__tests__/import-baseline-standings.test.js` | Create | Verifies idempotent import, existing member reuse, conflict detection, and CloudBase node-sdk write shape. |
| `cloudfunctions/points-engine/lib/aggregate.js` | Modify | Includes `baseline_standings` in rank aggregation. |
| `cloudfunctions/weekly-star/lib/aggregate.js` | Modify | Copy of `points-engine/lib/aggregate.js`; must stay hash-identical for `scripts/sync-shared-libs.sh`. |
| `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js` | Modify | Adds baseline aggregation coverage. |
| `cloudfunctions/points-engine/__tests__/index.test.js` | Modify | Adds wrapper-level `rankList` and `playerStats` baseline tests. |
| `cloudfunctions/members/index.js` | Modify | Claims unclaimed member records during self-service registration. |
| `cloudfunctions/members/__tests__/index.test.js` | Modify | Adds claim success, no-match create, and conflict tests. |
| `miniprogram/pages/edit-profile/index.js` | Modify | Handles claimed-member `members.add` responses and `CLAIM_CONFLICT`. |
| `miniprogram/pages/edit-profile/__tests__/index.test.js` | Modify | Covers claimed member response and conflict toast. |
| `miniprogram/pages/member-manage/index.js` | Modify | Maps `claimStatus` to display labels for admin list rows. |
| `miniprogram/pages/member-manage/index.wxml` | Modify | Shows “待认领” for unclaimed rows. |
| `miniprogram/pages/member-manage/index.wxss` | Modify | Styles the lightweight claim badge. |
| `miniprogram/pages/member-manage/__tests__/index.test.js` | Create | Covers claim-status formatting and row update behavior. |
| `cloudfunctions/DATABASE_SCHEMA.md` | Modify | Documents `members.claimStatus` and `baseline_standings`. |

## Baseline Seed Rows

Use these exact rows in `scripts/lib/baseline-standings-data.js`. Only directly corresponding fields are included.

```js
const SEASON_ID = 'season_2026'

const BASELINE_STANDINGS = {
  singles: [
    { playerName: '小飞', totalPoints: 2940, wins: 4, losses: 0 },
    { playerName: '抖抖', totalPoints: 2250, wins: 0, losses: 1 },
    { playerName: '栗子', totalPoints: 1810, wins: 2, losses: 1 },
    { playerName: '小野马', totalPoints: 1630, wins: 0, losses: 1 },
    { playerName: '标子', totalPoints: 1560, wins: 1, losses: 1 },
    { playerName: '乐乐', totalPoints: 1450, wins: 0, losses: 1 },
    { playerName: '老板', totalPoints: 1360, wins: 0, losses: 1 },
    { playerName: '大卫', totalPoints: 1170, wins: 0, losses: 1 },
    { playerName: '剑锋', totalPoints: 1150, wins: 0, losses: 1 },
    { playerName: '哲身', totalPoints: 1090, wins: 1, losses: 1 },
    { playerName: '宜帆', totalPoints: 1030, wins: 4, losses: 1 },
    { playerName: '林大', totalPoints: 1010, wins: 0, losses: 1 },
    { playerName: '海伦', totalPoints: 970, wins: 0, losses: 1 },
    { playerName: '许尧', totalPoints: 820, wins: 2, losses: 1 },
    { playerName: 'ELla', totalPoints: 790, wins: 0, losses: 1 },
    { playerName: '小雯', totalPoints: 750, wins: 0, losses: 0 },
    { playerName: '大壮', totalPoints: 710, wins: 3, losses: 1 },
    { playerName: '小叶', totalPoints: 660, wins: 1, losses: 1 },
    { playerName: '威治', totalPoints: 650, wins: 0, losses: 1 },
    { playerName: '奶爸', totalPoints: 500, wins: 0, losses: 0 },
    { playerName: '杜导', totalPoints: 450, wins: 2, losses: 1 },
    { playerName: '钱钱', totalPoints: 450, wins: 2, losses: 1 },
    { playerName: '小童', totalPoints: 440, wins: 1, losses: 1 },
    { playerName: '烈总', totalPoints: 300, wins: 0, losses: 0 },
    { playerName: '小天', totalPoints: 300, wins: 0, losses: 1 },
    { playerName: '大炮', totalPoints: 180, wins: 0, losses: 1 },
    { playerName: '姜黄', totalPoints: 160, wins: 0, losses: 0 },
    { playerName: '雅婷', totalPoints: 80, wins: 0, losses: 0 },
    { playerName: '彭于晏', totalPoints: 60, wins: 0, losses: 0 },
    { playerName: '吴老师', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '蛊惑', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '飞鸟', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '小勇', totalPoints: 0, wins: 0, losses: 0 }
  ],
  doubles: [
    { playerName: '标子', totalPoints: 2250, wins: 9, losses: 5 },
    { playerName: '抖抖', totalPoints: 1890, wins: 24, losses: 23 },
    { playerName: 'ELla', totalPoints: 1860, wins: 12, losses: 16 },
    { playerName: '小飞', totalPoints: 1780, wins: 18, losses: 2 },
    { playerName: '剑锋', totalPoints: 1630, wins: 20, losses: 22 },
    { playerName: '栗子', totalPoints: 1580, wins: 24, losses: 19 },
    { playerName: '姜黄', totalPoints: 1500, wins: 4, losses: 0 },
    { playerName: '林大', totalPoints: 1460, wins: 23, losses: 20 },
    { playerName: '大卫', totalPoints: 1330, wins: 14, losses: 30 },
    { playerName: '小叶', totalPoints: 1190, wins: 20, losses: 18 },
    { playerName: '乐乐', totalPoints: 1170, wins: 14, losses: 14 },
    { playerName: '蛊惑', totalPoints: 1110, wins: 6, losses: 6 },
    { playerName: '哲身', totalPoints: 1040, wins: 1, losses: 3 },
    { playerName: '小野马', totalPoints: 1030, wins: 7, losses: 10 },
    { playerName: '威治', totalPoints: 1000, wins: 1, losses: 2 },
    { playerName: '海伦', totalPoints: 890, wins: 6, losses: 7 },
    { playerName: '许尧', totalPoints: 870, wins: 5, losses: 3 },
    { playerName: '老板', totalPoints: 840, wins: 1, losses: 2 },
    { playerName: '小童', totalPoints: 770, wins: 16, losses: 16 },
    { playerName: '小宜', totalPoints: 480, wins: 8, losses: 3 },
    { playerName: '大壮', totalPoints: 450, wins: 1, losses: 1 },
    { playerName: '小雯', totalPoints: 370, wins: 0, losses: 0 },
    { playerName: '钱钱', totalPoints: 300, wins: 0, losses: 1 },
    { playerName: '雅婷', totalPoints: 230, wins: 6, losses: 6 },
    { playerName: '奶爸', totalPoints: 120, wins: 0, losses: 0 },
    { playerName: '烈总', totalPoints: 120, wins: 0, losses: 0 },
    { playerName: '大炮', totalPoints: 50, wins: 2, losses: 1 },
    { playerName: '小勇', totalPoints: 30, wins: 0, losses: 3 },
    { playerName: '飞鸟', totalPoints: 20, wins: 0, losses: 2 },
    { playerName: '吴老师', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '小天', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '杜导', totalPoints: 0, wins: 0, losses: 0 },
    { playerName: '彭于晏', totalPoints: 0, wins: 0, losses: 0 }
  ]
}

module.exports = { SEASON_ID, BASELINE_STANDINGS }
```

---

### Task 1: Add Baseline Seed Data

**Files:**
- Create: `scripts/lib/baseline-standings-data.js`
- Create: `scripts/__tests__/baseline-standings-data.test.js`

- [ ] **Step 1: Write the failing seed data tests**

Create `scripts/__tests__/baseline-standings-data.test.js`:

```js
const { SEASON_ID, BASELINE_STANDINGS, flattenBaselineStandings, validateBaselineStandings } = require('../lib/baseline-standings-data')

describe('baseline standings seed', () => {
  test('contains 2026 singles and doubles rows from screenshots', () => {
    expect(SEASON_ID).toBe('season_2026')
    expect(BASELINE_STANDINGS.singles).toHaveLength(33)
    expect(BASELINE_STANDINGS.doubles).toHaveLength(33)
  })

  test('contains key singles values', () => {
    expect(BASELINE_STANDINGS.singles[0]).toEqual({ playerName: '小飞', totalPoints: 2940, wins: 4, losses: 0 })
    expect(BASELINE_STANDINGS.singles.find(row => row.playerName === '标子')).toEqual({ playerName: '标子', totalPoints: 1560, wins: 1, losses: 1 })
    expect(BASELINE_STANDINGS.singles.find(row => row.playerName === '蛊惑')).toEqual({ playerName: '蛊惑', totalPoints: 0, wins: 0, losses: 0 })
  })

  test('contains key doubles values', () => {
    expect(BASELINE_STANDINGS.doubles[0]).toEqual({ playerName: '标子', totalPoints: 2250, wins: 9, losses: 5 })
    expect(BASELINE_STANDINGS.doubles.find(row => row.playerName === '小宜')).toEqual({ playerName: '小宜', totalPoints: 480, wins: 8, losses: 3 })
    expect(BASELINE_STANDINGS.doubles.find(row => row.playerName === '彭于晏')).toEqual({ playerName: '彭于晏', totalPoints: 0, wins: 0, losses: 0 })
  })

  test('flattenBaselineStandings annotates season and type', () => {
    const rows = flattenBaselineStandings()
    expect(rows).toHaveLength(66)
    expect(rows[0]).toMatchObject({ seasonId: 'season_2026', type: 'singles', playerName: '小飞' })
    expect(rows.find(row => row.type === 'doubles' && row.playerName === '标子')).toMatchObject({ totalPoints: 2250 })
  })

  test('validateBaselineStandings rejects duplicate names within one type', () => {
    expect(validateBaselineStandings(flattenBaselineStandings())).toEqual({ valid: true, errors: [] })
    const rows = flattenBaselineStandings()
    rows.push({ ...rows[0] })
    expect(validateBaselineStandings(rows)).toMatchObject({ valid: false })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npx jest __tests__/baseline-standings-data.test.js --runInBand
```

Expected: FAIL because `scripts/lib/baseline-standings-data.js` does not exist.

- [ ] **Step 3: Add the seed module**

Create `scripts/lib/baseline-standings-data.js` using the seed rows listed in the “Baseline Seed Rows” section and append these helpers:

```js
function flattenBaselineStandings(source = BASELINE_STANDINGS, seasonId = SEASON_ID) {
  return ['singles', 'doubles'].flatMap(type => (source[type] || []).map(row => ({
    seasonId,
    type,
    playerName: row.playerName,
    totalPoints: row.totalPoints,
    wins: row.wins,
    losses: row.losses
  })))
}

function validateBaselineStandings(rows) {
  const errors = []
  const seen = new Set()
  for (const row of rows || []) {
    const key = `${row.seasonId}:${row.type}:${row.playerName}`
    if (!row.seasonId) errors.push(`missing seasonId for ${row.playerName}`)
    if (row.type !== 'singles' && row.type !== 'doubles') errors.push(`invalid type for ${row.playerName}`)
    if (!row.playerName || typeof row.playerName !== 'string') errors.push('missing playerName')
    for (const field of ['totalPoints', 'wins', 'losses']) {
      if (!Number.isInteger(row[field]) || row[field] < 0) errors.push(`${row.playerName}.${field} must be a non-negative integer`)
    }
    if (seen.has(key)) errors.push(`duplicate baseline row: ${key}`)
    seen.add(key)
  }
  return { valid: errors.length === 0, errors }
}

module.exports = {
  SEASON_ID,
  BASELINE_STANDINGS,
  flattenBaselineStandings,
  validateBaselineStandings
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npx jest __tests__/baseline-standings-data.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not commit unless the user has asked for commits. If committing is approved:

```bash
git add scripts/lib/baseline-standings-data.js scripts/__tests__/baseline-standings-data.test.js
git commit -m "feat(scripts): add 2026 baseline standings seed"
```

---

### Task 2: Add Idempotent Baseline Import Script

> **Implementation note:** The detailed TDD draft in this Task 2 section is retained as historical planning context only. Do not execute the old code snippets or unchecked boxes below. The final implementation is `scripts/import-baseline-standings.js`, exports `importBaselineStandings(db, options)`, writes no `rank_snapshots`, writes no `winRate`, uses `source: 'baseline_import'`, creates `unclaimed_{playerName}` members with `createdBy: 'baseline_import'`, and uses CloudBase node-sdk `doc.set(data)` / `doc.update(data)` payloads without `_id`.

**Files:**
- Create: `scripts/import-baseline-standings.js`
- Create: `scripts/__tests__/import-baseline-standings.test.js`

- [ ] **Step 1: Write the failing import tests**

Create `scripts/__tests__/import-baseline-standings.test.js`:

```js
jest.mock('../backfill-rank-snapshots-W0', () => ({
  runBackfill: jest.fn(() => Promise.resolve({ total: 2 }))
}))

const {
  calculateWinRate,
  makeBaselineMemberId,
  makeBaselineStandingId,
  runImport
} = require('../import-baseline-standings')
const { runBackfill } = require('../backfill-rank-snapshots-W0')

function makeFakeDb({ members = [], baseline = [], snapshots = [] } = {}) {
  const rows = { members, baseline_standings: baseline, rank_snapshots: snapshots }
  function matches(row, filter) {
    for (const [key, value] of Object.entries(filter || {})) {
      if (row[key] !== value) return false
    }
    return true
  }
  function collection(name) {
    return {
      where(filter) {
        return {
          get: async () => ({ data: (rows[name] || []).filter(row => matches(row, filter)) })
        }
      },
      doc(id) {
        return {
          get: async () => ({ data: (rows[name] || []).find(row => row._id === id) || null }),
          update: async ({ data }) => {
            const index = rows[name].findIndex(row => row._id === id)
            if (index < 0) {
              const err = new Error('document not exist')
              err.errCode = -502005
              throw err
            }
            rows[name][index] = { ...rows[name][index], ...data }
            return { stats: { updated: 1 } }
          },
          set: async ({ data }) => {
            const index = rows[name].findIndex(row => row._id === id)
            if (index >= 0) rows[name][index] = { _id: id, ...data }
            else rows[name].push({ _id: id, ...data })
            return { stats: { updated: 1 } }
          }
        }
      },
      add: async ({ data }) => {
        rows[name].push(data)
        return { _id: data._id }
      }
    }
  }
  return { db: { collection }, rows }
}

describe('import-baseline-standings', () => {
  test('calculateWinRate returns 0 when no matches exist', () => {
    expect(calculateWinRate(0, 0)).toBe(0)
    expect(calculateWinRate(7, 1)).toBe(0.875)
  })

  test('deterministic ids are stable', () => {
    expect(makeBaselineMemberId('标子')).toBe(makeBaselineMemberId('标子'))
    expect(makeBaselineStandingId('season_2026', 'singles', 'member_1')).toBe('baseline_2026_singles_member_1')
  })

  test('first import creates unclaimed members and baseline rows', async () => {
    const { db, rows } = makeFakeDb()
    const result = await runImport({
      db,
      now: new Date('2026-05-18T10:00:00Z'),
      rows: [
        { seasonId: 'season_2026', type: 'singles', playerName: '标子', totalPoints: 1560, wins: 1, losses: 1 },
        { seasonId: 'season_2026', type: 'doubles', playerName: '标子', totalPoints: 2250, wins: 9, losses: 5 }
      ],
      writeSnapshots: false
    })
    expect(result).toMatchObject({ membersCreated: 1, baselineRowsWritten: 2 })
    expect(rows.members[0]).toMatchObject({ name: '标子', claimStatus: 'unclaimed', source: 'baseline_2026' })
    expect(rows.baseline_standings).toHaveLength(2)
    expect(rows.baseline_standings[0]).toMatchObject({ playerName: '标子', memberId: rows.members[0]._id, totalPoints: 1560, wins: 1, losses: 1, winRate: 0.5 })
  })

  test('re-running import is idempotent', async () => {
    const { db, rows } = makeFakeDb()
    const seedRows = [{ seasonId: 'season_2026', type: 'singles', playerName: '标子', totalPoints: 1560, wins: 1, losses: 1 }]
    await runImport({ db, rows: seedRows, now: new Date('2026-05-18T10:00:00Z'), writeSnapshots: false })
    await runImport({ db, rows: seedRows, now: new Date('2026-05-18T10:00:00Z'), writeSnapshots: false })
    expect(rows.members).toHaveLength(1)
    expect(rows.baseline_standings).toHaveLength(1)
  })

  test('existing claimed member with the same name is reused', async () => {
    const { db, rows } = makeFakeDb({ members: [{ _id: 'member_claimed', name: '标子', openid: 'o1', claimStatus: 'claimed' }] })
    await runImport({
      db,
      rows: [{ seasonId: 'season_2026', type: 'singles', playerName: '标子', totalPoints: 1560, wins: 1, losses: 1 }],
      now: new Date('2026-05-18T10:00:00Z'),
      writeSnapshots: false
    })
    expect(rows.members).toHaveLength(1)
    expect(rows.baseline_standings[0].memberId).toBe('member_claimed')
  })

  test('duplicate same-name members stop the import', async () => {
    const { db } = makeFakeDb({ members: [{ _id: 'a', name: '标子' }, { _id: 'b', name: '标子' }] })
    await expect(runImport({
      db,
      rows: [{ seasonId: 'season_2026', type: 'singles', playerName: '标子', totalPoints: 1560, wins: 1, losses: 1 }],
      now: new Date('2026-05-18T10:00:00Z'),
      writeSnapshots: false
    })).rejects.toThrow('duplicate member name: 标子')
  })

  test('writeSnapshots calls the existing rank snapshot backfill', async () => {
    const { db } = makeFakeDb()
    const now = new Date('2026-05-18T10:00:00Z')
    await runImport({
      db,
      rows: [{ seasonId: 'season_2026', type: 'singles', playerName: '标子', totalPoints: 1560, wins: 1, losses: 1 }],
      now,
      writeSnapshots: true
    })
    expect(runBackfill).toHaveBeenCalledWith({ db, seasonId: 'season_2026', now })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npx jest __tests__/import-baseline-standings.test.js --runInBand
```

Expected: FAIL because `scripts/import-baseline-standings.js` does not exist.

- [ ] **Step 3: Add the import script**

Create `scripts/import-baseline-standings.js`:

```js
#!/usr/bin/env node
const crypto = require('crypto')
const path = require('path')

const { flattenBaselineStandings, validateBaselineStandings } = require('./lib/baseline-standings-data')

const DEFAULT_AVATAR_URL = '/images/icons/usercenter.png'

function calculateWinRate(wins, losses) {
  const total = (wins || 0) + (losses || 0)
  return total > 0 ? wins / total : 0
}

function makeHash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12)
}

function makeBaselineMemberId(playerName) {
  return `baseline_2026_${makeHash(playerName)}`
}

function makeBaselineStandingId(seasonId, type, memberId) {
  return `baseline_${seasonId.replace(/^season_/, '')}_${type}_${memberId}`
}

async function getMembersByName(db, name) {
  const res = await db.collection('members').where({ name }).get()
  return (res && res.data) || []
}

async function upsertDoc(db, collectionName, id, data) {
  const coll = db.collection(collectionName)
  const doc = coll.doc(id)
  if (typeof doc.set === 'function') {
    await doc.set({ data })
    return
  }
  const existing = await doc.get().catch(() => ({ data: null }))
  if (existing && existing.data) {
    await doc.update({ data })
  } else {
    await coll.add({ data: { _id: id, ...data } })
  }
}

async function resolveOrCreateMember(db, playerName, now) {
  const existing = await getMembersByName(db, playerName)
  if (existing.length > 1) throw new Error(`duplicate member name: ${playerName}`)
  if (existing.length === 1) return { member: existing[0], created: false }

  const memberId = makeBaselineMemberId(playerName)
  const member = {
    _id: memberId,
    name: playerName,
    avatarUrl: DEFAULT_AVATAR_URL,
    status: 'active',
    claimStatus: 'unclaimed',
    source: 'baseline_2026',
    createTime: now,
    updateTime: now
  }
  await db.collection('members').add({ data: member })
  return { member, created: true }
}

async function runImport({ db, rows = flattenBaselineStandings(), now = new Date(), writeSnapshots = false }) {
  const validation = validateBaselineStandings(rows)
  if (!validation.valid) throw new Error(validation.errors.join('; '))

  let membersCreated = 0
  let baselineRowsWritten = 0
  for (const row of rows) {
    const { member, created } = await resolveOrCreateMember(db, row.playerName, now)
    if (created) membersCreated += 1
    const standingId = makeBaselineStandingId(row.seasonId, row.type, member._id)
    await upsertDoc(db, 'baseline_standings', standingId, {
      seasonId: row.seasonId,
      type: row.type,
      memberId: member._id,
      playerName: row.playerName,
      totalPoints: row.totalPoints,
      wins: row.wins,
      losses: row.losses,
      winRate: calculateWinRate(row.wins, row.losses),
      source: '2026_fuopen_screenshot',
      createTime: now,
      updateTime: now
    })
    baselineRowsWritten += 1
  }

  if (writeSnapshots) {
    const { runBackfill } = require('./backfill-rank-snapshots-W0')
    await runBackfill({ db, seasonId: 'season_2026', now })
  }

  return { membersCreated, baselineRowsWritten }
}

function loadCloudSdk() {
  try {
    return require('wx-server-sdk')
  } catch (e) {
    return require(path.join(__dirname, '..', 'cloudfunctions', 'weekly-star', 'node_modules', 'wx-server-sdk'))
  }
}

async function mainCli() {
  const cloud = loadCloudSdk()
  cloud.init({ env: process.env.WX_CLOUD_ENV || cloud.DYNAMIC_CURRENT_ENV })
  const db = cloud.database()
  const now = process.env.IMPORT_NOW ? new Date(process.env.IMPORT_NOW) : new Date()
  const result = await runImport({ db, now, writeSnapshots: true })
  console.log(`[baseline] membersCreated=${result.membersCreated} baselineRowsWritten=${result.baselineRowsWritten}`)
}

if (require.main === module) {
  mainCli().then(() => process.exit(0)).catch(err => {
    console.error(err)
    process.exit(1)
  })
}

module.exports = {
  calculateWinRate,
  makeBaselineMemberId,
  makeBaselineStandingId,
  runImport
}
```

- [ ] **Step 4: Run the import tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npx jest __tests__/import-baseline-standings.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run all script tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- --runInBand
```

Expected: PASS, including the existing backfill tests.

- [ ] **Step 6: Checkpoint**

Do not commit unless approved. If committing is approved:

```bash
git add scripts/import-baseline-standings.js scripts/__tests__/import-baseline-standings.test.js
git commit -m "feat(scripts): import baseline standings"
```

---

### Task 3: Add Baseline Rows To Rank Aggregation

**Files:**
- Modify: `cloudfunctions/points-engine/lib/aggregate.js`
- Modify: `cloudfunctions/weekly-star/lib/aggregate.js`
- Modify: `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`

- [ ] **Step 1: Write the failing aggregate tests**

In `cloudfunctions/points-engine/lib/__tests__/aggregate.test.js`, update `makeFakeDb` to accept `baselineStandings = []`, return it for `collection('baseline_standings')`, and add:

```js
test('combines baseline_standings with confirmed match_results and tournament_points', async () => {
  const seasonId = 'season_2026'
  const db = makeFakeDb({
    baselineStandings: [
      { _id: 'b_A', seasonId, type: 'singles', memberId: 'A', totalPoints: 100, wins: 3, losses: 1, createTime: new Date('2026-01-01') },
      { _id: 'b_B', seasonId, type: 'singles', memberId: 'B', totalPoints: 90, wins: 1, losses: 2, createTime: new Date('2026-01-01') }
    ],
    matchResults: [
      { _id: 'm_A', seasonId, tournamentType: 'singles', resultStatus: 'confirmed', createTime: new Date('2026-05-18'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }, { memberId: 'B', points: 10, role: 'loser' }] } }
    ],
    tournamentPoints: [
      { _id: 'tp_A', seasonId, tournamentType: 'singles', memberId: 'A', points: 50, createTime: new Date('2026-05-18') }
    ]
  })

  const list = await aggregateRanks({ db, seasonId, type: 'singles', pageSize: 100 })

  expect(list.find(row => row.memberId === 'A')).toMatchObject({ totalPoints: 170, wins: 4, losses: 1 })
  expect(list.find(row => row.memberId === 'B')).toMatchObject({ totalPoints: 100, wins: 1, losses: 3 })
})

test('baseline_standings collection missing does not break aggregation', async () => {
  const db = makeFakeDb({
    baselineStandings: undefined,
    matchResults: generateConfirmedMatches('S1', 'singles', 3),
    tournamentPoints: []
  })
  const list = await aggregateRanks({ db, seasonId: 'S1', type: 'singles', pageSize: 100 })
  expect(list.reduce((sum, row) => sum + row.totalPoints, 0)).toBe(3 * 30)
})

test('asOf includes baseline rows regardless of later real match cutoff', async () => {
  const seasonId = 'season_2026'
  const db = makeFakeDb({
    baselineStandings: [
      { _id: 'b_A', seasonId, type: 'singles', memberId: 'A', totalPoints: 100, wins: 3, losses: 1, createTime: new Date('2026-01-01') }
    ],
    matchResults: [
      { _id: 'future', seasonId, tournamentType: 'singles', resultStatus: 'confirmed',
        confirmedAt: new Date('2026-06-01'), createTime: new Date('2026-06-01'),
        pointsAwarded: { entries: [{ memberId: 'A', points: 20, role: 'winner' }] } }
    ],
    tournamentPoints: []
  })
  const list = await aggregateRanks({ db, seasonId, type: 'singles', asOf: new Date('2026-05-18'), pageSize: 100 })
  expect(list.find(row => row.memberId === 'A')).toMatchObject({ totalPoints: 100, wins: 3, losses: 1 })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npx jest lib/__tests__/aggregate.test.js --runInBand
```

Expected: FAIL because `aggregateRanks` does not read `baseline_standings`.

- [ ] **Step 3: Implement baseline aggregation**

In `cloudfunctions/points-engine/lib/aggregate.js`, add a safe baseline pager before `match_results`:

```js
  await safePageBaselineStandings(db, { seasonId, type }, limit, async (row) => {
    accumulateBaseline(acc, row)
  }, _)
```

Add helpers:

```js
async function safePageBaselineStandings(db, filter, pageSize, visit, command) {
  try {
    await pageCollection({ db, collectionName: 'baseline_standings', baseFilter: filter, limit: pageSize, visit, command })
  } catch (e) {
    const text = `${(e && (e.errMsg || e.message || e.code)) || ''}`
    if ((e && e.errCode === -502005) || /collection not exists|Db or Table not exist|not exist/i.test(text)) return
    throw e
  }
}

function accumulateBaseline(acc, row) {
  if (!row || !row.memberId) return
  const cur = acc.get(row.memberId) || { totalPoints: 0, wins: 0, losses: 0 }
  cur.totalPoints += row.totalPoints || 0
  cur.wins += row.wins || 0
  cur.losses += row.losses || 0
  acc.set(row.memberId, cur)
}
```

Copy the final `cloudfunctions/points-engine/lib/aggregate.js` to `cloudfunctions/weekly-star/lib/aggregate.js` after tests pass:

```bash
cp /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine/lib/aggregate.js /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/weekly-star/lib/aggregate.js
```

- [ ] **Step 4: Run aggregate tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npx jest lib/__tests__/aggregate.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Run sync script**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
bash scripts/sync-shared-libs.sh
```

Expected: `aggregate.js ok`.

- [ ] **Step 6: Checkpoint**

Do not commit unless approved. If committing is approved:

```bash
git add cloudfunctions/points-engine/lib/aggregate.js cloudfunctions/weekly-star/lib/aggregate.js cloudfunctions/points-engine/lib/__tests__/aggregate.test.js
git commit -m "feat(points): include baseline standings in rank aggregation"
```

---

### Task 4: Cover Points Engine Public Wrappers

**Files:**
- Modify: `cloudfunctions/points-engine/__tests__/index.test.js`

- [ ] **Step 1: Write failing wrapper tests**

In the `wx-server-sdk` mock inside `cloudfunctions/points-engine/__tests__/index.test.js`, add `baseline_standings: []` to `rows`. Reset it in relevant `beforeEach` blocks. Add:

```js
describe('baseline standings wrappers', () => {
  beforeEach(() => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.match_results.length = 0
    cloud.__rows.tournament_points.length = 0
    cloud.__rows.baseline_standings.length = 0
    cloud.__rows.members.length = 0
    cloud.__rows.rank_snapshots.length = 0
  })

  test('rankList includes unclaimed baseline member rows', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'baseline_A', name: '标子', avatarUrl: '/images/icons/usercenter.png', claimStatus: 'unclaimed' })
    cloud.__rows.baseline_standings.push({
      _id: 'b1',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'baseline_A',
      playerName: '标子',
      totalPoints: 1560,
      wins: 1,
      losses: 1
    })
    const { main } = require('../index')
    const res = await main({ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' })
    expect(res.data.rankList[0]).toMatchObject({
      _id: 'baseline_A',
      name: '标子',
      totalPoints: 1560,
      winCount: 1,
      lossCount: 1,
      winRate: 0.5
    })
  })

  test('playerStats merges baseline stats with later confirmed matches', async () => {
    const cloud = require('wx-server-sdk')
    cloud.__rows.members.push({ _id: 'baseline_A', name: '标子' })
    cloud.__rows.baseline_standings.push({
      _id: 'b1',
      seasonId: 'season_2026',
      type: 'singles',
      memberId: 'baseline_A',
      playerName: '标子',
      totalPoints: 1560,
      wins: 1,
      losses: 1
    })
    cloud.__rows.match_results.push({
      _id: 'm1',
      seasonId: 'season_2026',
      tournamentType: 'singles',
      resultStatus: 'confirmed',
      confirmedAt: '2026-05-18',
      createTime: '2026-05-18',
      playerIds: ['baseline_A'],
      pointsAwarded: { entries: [{ memberId: 'baseline_A', points: 20, role: 'winner' }] }
    })
    const { main } = require('../index')
    const res = await main({ action: 'playerStats', playerId: 'baseline_A', currentSeasonId: 'season_2026' })
    expect(res.data.stats.singles).toMatchObject({
      winCount: 2,
      lossCount: 1,
      totalPoints: 1580
    })
    expect(res.data.stats.singles.winRate).toBeCloseTo(2 / 3, 5)
    expect(res.data.recent).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npx jest __tests__/index.test.js --runInBand
```

Expected after Task 3 implementation: PASS. If the tests fail because the mock does not route `baseline_standings`, update `makeCollection` routing in the test mock.

- [ ] **Step 3: Run all points-engine tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Checkpoint**

Do not commit unless approved. If committing is approved:

```bash
git add cloudfunctions/points-engine/__tests__/index.test.js
git commit -m "test(points): cover baseline standings wrappers"
```

---

### Task 5: Implement Registration Claiming

> **Implementation note:** The detailed Task 5 steps below, including unchecked boxes and code snippets, are historical planning context only. Do not execute the old helper code or unchecked steps. The final implementation uses a conditional `collection.where({ _id, claimStatus: 'unclaimed', openid: _.exists(false), openId: _.exists(false) }).update(...)`, checks the updated count, writes `admin: false` and `isAdmin: false`, and returns `CLAIM_CONFLICT` if the conditional update affects zero rows.

**Files:**
- Modify: `cloudfunctions/members/index.js`
- Modify: `cloudfunctions/members/__tests__/index.test.js`

- [ ] **Step 1: Write failing member claim tests**

Refactor `cloudfunctions/members/__tests__/index.test.js` mock state so separate `where().get()` calls can return different rows. Add a queue helper:

```js
mockState.whereGetQueue = []
mockQuery.get = jest.fn(() => Promise.resolve({ data: mockState.whereGetQueue.length ? mockState.whereGetQueue.shift() : mockState.whereGetData }))
```

Add tests:

```js
test('action=add claims exactly one unclaimed member by exact name', async () => {
  const unclaimed = { _id: 'baseline_A', name: '标子', claimStatus: 'unclaimed', avatarUrl: '/images/icons/usercenter.png' }
  mockState.whereGetQueue = [
    [],
    [unclaimed]
  ]
  mockState.docGetResult = { data: { ...unclaimed, openid: mockState.openid, claimStatus: 'claimed', playStyle: 'vers' } }

  const result = await main({
    action: 'add',
    data: { name: ' 标子 ', avatarUrl: 'cloud://avatar', phone: '13800000000', playStyle: 'vers' }
  }, {})

  expect(mockCollection.add).not.toHaveBeenCalled()
  expect(mockCollection.doc).toHaveBeenCalledWith('baseline_A')
  expect(mockDoc.update).toHaveBeenCalledWith({
    data: expect.objectContaining({
      openid: mockState.openid,
      name: '标子',
      avatarUrl: 'cloud://avatar',
      phone: '13800000000',
      playStyle: 'vers',
      claimStatus: 'claimed',
      updateTime: mockState.serverDate
    })
  })
  expect(result).toMatchObject({ _id: 'baseline_A', claimed: true })
})

test('action=add creates new member when no unclaimed exact-name match exists', async () => {
  mockState.whereGetQueue = [
    [],
    []
  ]

  await main({
    action: 'add',
    data: { name: '新会员', playStyle: 'grinder' }
  }, {})

  expect(mockCollection.add).toHaveBeenCalledWith({
    data: expect.objectContaining({
      openid: mockState.openid,
      name: '新会员',
      claimStatus: 'claimed',
      status: 'active',
      admin: false
    })
  })
})

test('action=add returns CLAIM_CONFLICT when multiple unclaimed exact-name matches exist', async () => {
  mockState.whereGetQueue = [
    [],
    [
      { _id: 'baseline_A1', name: '标子', claimStatus: 'unclaimed' },
      { _id: 'baseline_A2', name: '标子', claimStatus: 'unclaimed' }
    ]
  ]

  const result = await main({
    action: 'add',
    data: { name: '标子', playStyle: 'vers' }
  }, {})

  expect(result).toMatchObject({
    success: false,
    error: { code: 'CLAIM_CONFLICT' }
  })
  expect(mockCollection.add).not.toHaveBeenCalled()
  expect(mockDoc.update).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/members
npx jest __tests__/index.test.js --runInBand
```

Expected: FAIL because `members.add` does not claim by name and does not set `claimStatus`.

- [ ] **Step 3: Implement claim helpers**

In `cloudfunctions/members/index.js`, add:

```js
async function findUnclaimedMembersByName(name) {
  if (!name) return []
  const res = await collection.where({ name, claimStatus: 'unclaimed' }).get()
  return ((res && res.data) || []).filter(member => !member.openid && !member.openId)
}

async function claimUnclaimedMember(member, payload, openid) {
  const now = db.serverDate()
  const updateData = {
    ...payload,
    openid,
    status: 'active',
    admin: false,
    claimStatus: 'claimed',
    updateTime: now
  }
  await collection.doc(member._id).update({ data: updateData })
  return {
    _id: member._id,
    ...member,
    ...updateData
  }
}
```

Update `case 'add'` after the existing-openid guard and before `collection.add`:

```js
      const claimMatches = await findUnclaimedMembersByName(payload.name)
      if (claimMatches.length > 1) {
        return { success: false, error: { code: 'CLAIM_CONFLICT', message: '姓名匹配到多条待认领记录，请联系管理员处理' } }
      }
      if (claimMatches.length === 1) {
        const claimed = await claimUnclaimedMember(claimMatches[0], payload, openid)
        return { _id: claimed._id, claimed: true, data: claimed }
      }
```

Update new member creation payload to include:

```js
          claimStatus: 'claimed',
```

- [ ] **Step 4: Run members tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/members
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not commit unless approved. If committing is approved:

```bash
git add cloudfunctions/members/index.js cloudfunctions/members/__tests__/index.test.js
git commit -m "feat(members): claim baseline member on registration"
```

---

### Task 6: Handle Claimed Registration Responses In Edit Profile

**Files:**
- Modify: `miniprogram/pages/edit-profile/index.js`
- Modify: `miniprogram/pages/edit-profile/__tests__/index.test.js`

- [ ] **Step 1: Write failing edit-profile tests**

Append to `miniprogram/pages/edit-profile/__tests__/index.test.js`:

```js
test('claimed registration response stores returned member data', async () => {
  jest.useFakeTimers()
  const claimed = { _id: 'baseline_A', name: '标子', avatarUrl: 'cloud://avatar', playStyle: 'vers', claimStatus: 'claimed' }
  const { pageDef, app } = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValueOnce({ result: { _id: 'baseline_A', claimed: true, data: claimed } })
  const ctx = makeCtx(pageDef, { isRegister: true })
  ctx.data.formData = { name: '标子', phone: '', avatarUrl: 'cloud://avatar', playStyle: 'vers' }

  await ctx.onSave()
  jest.runAllTimers()

  expect(app.globalData.currentMember).toEqual(claimed)
  expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/mine/index' })
  jest.useRealTimers()
})

test('claim conflict response tells user to contact admin', async () => {
  const { pageDef } = loadPage()
  const { callFunction } = require('../../../utils/cloud')
  callFunction.mockResolvedValueOnce({
    result: { success: false, error: { code: 'CLAIM_CONFLICT', message: '姓名匹配到多条待认领记录，请联系管理员处理' } }
  })
  const ctx = makeCtx(pageDef, { isRegister: true })
  ctx.data.formData = { name: '标子', phone: '', avatarUrl: '', playStyle: 'vers' }

  await ctx.onSave()

  expect(wx.showToast).toHaveBeenCalledWith({
    title: '姓名匹配到多条待认领记录，请联系管理员处理',
    icon: 'none'
  })
  expect(wx.reLaunch).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npx jest pages/edit-profile/__tests__/index.test.js --runInBand
```

Expected: first new test fails because `onSave` ignores `result.data` unless `errMsg === 'already registered'`.

- [ ] **Step 3: Update saved member selection**

In `miniprogram/pages/edit-profile/index.js`, replace `savedMember` construction with:

```js
      const savedMember = result.errMsg === 'already registered' && result.data
        ? result.data
        : result.data
          ? result.data
          : {
              ...(currentMember || {}),
              ...payload,
              _id: result._id || (currentMember && currentMember._id)
            }
```

Leave the existing `success === false` toast handling in place; it already displays `CLAIM_CONFLICT` message.

- [ ] **Step 4: Run edit-profile tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npx jest pages/edit-profile/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Do not commit unless approved. If committing is approved:

```bash
git add miniprogram/pages/edit-profile/index.js miniprogram/pages/edit-profile/__tests__/index.test.js
git commit -m "fix(profile): store claimed baseline member"
```

---

### Task 7: Show Unclaimed State In Admin Member List

**Files:**
- Modify: `miniprogram/pages/member-manage/index.js`
- Modify: `miniprogram/pages/member-manage/index.wxml`
- Modify: `miniprogram/pages/member-manage/index.wxss`
- Create: `miniprogram/pages/member-manage/__tests__/index.test.js`

- [ ] **Step 1: Write failing member-manage page tests**

Create `miniprogram/pages/member-manage/__tests__/index.test.js`:

```js
function loadPage() {
  jest.resetModules()
  let pageDef
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    cloud: { callFunction: jest.fn() },
    showToast: jest.fn(),
    stopPullDownRefresh: jest.fn(),
    previewImage: jest.fn(),
    navigateTo: jest.fn()
  }
  global.Page = (def) => { pageDef = def }
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: { ...def.data, ...data },
    setData(patch) { Object.assign(this.data, patch) }
  }
}

describe('member-manage claim status', () => {
  test('formatMember marks unclaimed rows for admin display', () => {
    const def = loadPage()
    const row = def.formatMember({ _id: 'baseline_A', name: '标子', claimStatus: 'unclaimed', createTime: '2026-05-18' })
    expect(row).toMatchObject({
      claimStatus: 'unclaimed',
      claimLabel: '待认领',
      claimClass: 'unclaimed'
    })
  })

  test('formatMember leaves claimed rows visually quiet', () => {
    const def = loadPage()
    const row = def.formatMember({ _id: 'A', name: '标子', claimStatus: 'claimed', createTime: '2026-05-18' })
    expect(row).toMatchObject({
      claimStatus: 'claimed',
      claimLabel: '',
      claimClass: 'claimed'
    })
  })

  test('updateMemberItem preserves claim display fields', () => {
    const def = loadPage()
    const ctx = makeCtx(def, {
      memberList: [def.formatMember({ _id: 'baseline_A', name: '标子', claimStatus: 'unclaimed', status: 'active' })]
    })

    ctx.updateMemberItem({ _id: 'baseline_A', name: '标子', phone: '', status: 'active', admin: false, playStyle: 'vers', claimStatus: 'claimed' })

    expect(ctx.data.memberList[0]).toMatchObject({ claimLabel: '', claimClass: 'claimed' })
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npx jest pages/member-manage/__tests__/index.test.js --runInBand
```

Expected: FAIL because `formatMember` does not exist.

- [ ] **Step 3: Add formatter and use it in list loading**

In `miniprogram/pages/member-manage/index.js`, add:

```js
  formatMember(item) {
    const claimStatus = item.claimStatus || 'claimed'
    return {
      ...item,
      formattedTime: this.formatTime(item.createTime),
      claimStatus,
      claimLabel: claimStatus === 'unclaimed' ? '待认领' : '',
      claimClass: claimStatus === 'unclaimed' ? 'unclaimed' : 'claimed'
    }
  },
```

Replace the `formattedMembers` map in `getMemberList` with:

```js
        const formattedMembers = newMembers.map(item => this.formatMember(item))
```

Update `updateMemberItem` to format the merged item:

```js
        return this.formatMember({
          ...item,
          name,
          phone,
          status,
          admin,
          playStyle,
          claimStatus
        })
```

Destructure `claimStatus` in `updateMemberItem`:

```js
    const { _id, name, phone, status, admin, playStyle, claimStatus } = updateData
```

- [ ] **Step 4: Update WXML**

In `miniprogram/pages/member-manage/index.wxml`, inside `.member-info` after `member-meta`, add:

```xml
        <text wx:if="{{item.claimLabel}}" class="member-claim member-claim-{{item.claimClass}}">{{item.claimLabel}}</text>
```

- [ ] **Step 5: Update WXSS**

In `miniprogram/pages/member-manage/index.wxss`, add:

```css
.member-claim {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  height: 34rpx;
  padding: 0 12rpx;
  border-radius: var(--radius-sm);
  font-size: 18rpx;
  font-weight: 900;
  letter-spacing: 0.08em;
}

.member-claim-unclaimed {
  background: var(--color-bg-3);
  color: var(--color-ink);
  border: 1rpx solid var(--color-ink);
}
```

- [ ] **Step 6: Run member-manage tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npx jest pages/member-manage/__tests__/index.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 7: Run miniprogram tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 8: Checkpoint**

Do not commit unless approved. If committing is approved:

```bash
git add miniprogram/pages/member-manage/index.js miniprogram/pages/member-manage/index.wxml miniprogram/pages/member-manage/index.wxss miniprogram/pages/member-manage/__tests__/index.test.js
git commit -m "feat(admin): show unclaimed baseline members"
```

---

### Task 8: Update Database Documentation

**Files:**
- Modify: `cloudfunctions/DATABASE_SCHEMA.md`
- Modify: `docs/superpowers/specs/2026-05-18-baseline-standings-design.md`
- Modify: `docs/superpowers/plans/2026-05-18-baseline-standings.md`

- [x] **Step 1: Update members schema docs**

`cloudfunctions/DATABASE_SCHEMA.md` now documents:

- `openid` is optional because unclaimed placeholders have no `openid/openId`.
- `claimStatus: claimed|unclaimed`.
- `isAdmin` legacy admin flag and the registration claim flow.
- Example unclaimed member `_id: unclaimed_{playerName}`, `status:'active'`, `claimStatus:'unclaimed'`, `source:'baseline_import'`.

- [x] **Step 2: Document `baseline_standings`**

`cloudfunctions/DATABASE_SCHEMA.md` now documents the actual stored fields:

- `_id: baseline_{seasonId}_{type}_{playerName}`
- `seasonId`, `type`, `memberId`, `playerName`, `rank`, `totalPoints`, `wins`, `losses`
- `source:'baseline_import'`, `baseline:true`
- `createTime/updateTime` and script compatibility `createdAt/updatedAt`

No `winRate`, screenshot-only fields, or `rank_snapshots` writes are documented as import outputs. The ranking formula is documented as `baseline_standings + match_results.pointsAwarded.entries + tournament_points`.

- [x] **Step 3: Verify docs contain no old unsupported scope**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
rg -n "官方排名|最佳排名|搭档|春季大满贯" cloudfunctions/DATABASE_SCHEMA.md
```

Expected: no new `baseline_standings` schema entries for those fields. Existing unrelated documentation may still mention tournament fields.

- [ ] **Step 4: Checkpoint**

Do not commit unless approved. If committing is approved:

```bash
git add cloudfunctions/DATABASE_SCHEMA.md
git commit -m "docs(db): document baseline standings"
```

---

### Task 9: Run Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run cloud function tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/members
npm test -- --runInBand

cd /Users/liaoxiaole/FOPEN-PURE/cloudfunctions/points-engine
npm test -- --runInBand
```

Expected: both suites PASS.

- [ ] **Step 2: Run script tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/scripts
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Run miniprogram tests**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE/miniprogram
npm test -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run shared-library sync**

Run:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
bash scripts/sync-shared-libs.sh
```

Expected: all checks PASS, especially `aggregate.js ok`.

- [ ] **Step 5: Run import script against target cloud only after local tests pass**

Use the known project target environment:

```bash
cd /Users/liaoxiaole/FOPEN-PURE
WX_CLOUD_ENV=cloud1-0gthnke69a09f52a node scripts/import-baseline-standings.js
```

Expected CLI output contains this shape:

```text
[baseline] membersCreated=0..34 baselineRowsWritten=66
```

Do not run this production-cloud import step without explicit user confirmation in the implementation session.

- [ ] **Step 6: Manual cloud smoke after import**

Call `points-engine.rankList` for both types through the existing cloud smoke tool or DevTools:

```js
{ action: 'rankList', type: 'singles', currentSeasonId: 'season_2026' }
{ action: 'rankList', type: 'doubles', currentSeasonId: 'season_2026' }
```

Expected:

- Singles list includes 33 rows.
- Singles #1 is `小飞` with `2940` points, `4` wins, `0` losses.
- Doubles list includes 33 rows.
- Doubles #1 is `标子` with `2250` points, `9` wins, `5` losses.

- [ ] **Step 7: Manual UI smoke**

In WeChat DevTools:

- Open rank page, singles tab: verify unregistered baseline players appear.
- Switch doubles tab: verify doubles baseline players appear.
- Open a baseline-only player detail: verify stats render and H2H/recent remain empty.
- Open admin member list: verify unclaimed baseline members show `待认领`.
- Register a test user with an exact unclaimed name in a disposable environment: verify the existing member row becomes claimed and rank row remains continuous.

- [ ] **Step 8: Final status**

Record:

- Test commands run.
- Import command result.
- Any cloud collection indexes created manually.
- Any names that failed because of duplicates.

Do not commit or deploy unless the user explicitly asks.
