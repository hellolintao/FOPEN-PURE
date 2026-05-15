# Phase 6 · Post-Phase-8 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 7/8 已完成创建、排程、录分、积分后，补齐上线前体验：每周之星、排行榜高光、全局动效、加载/空状态、视觉 token 收敛、关键流程手动验收。

**Architecture:** 不再引入旧版 `result-reconcile/result-submit` 路线；录分与积分以现有 `match-results`、`points-engine`、`tournament-score` 为准。新增独立 `weekly-star` 云函数，按 `match_results.pointsAwarded.entries` 和 `tournament_points` 计算每周积分冠军。前端只做轻量组件与样式增强，优先复用现有 `stat-block/rank-row/brush-stroke-bg/score-row`。

**Tech Stack:** 微信小程序原生组件 + WXSS 动效 + 云开发定时触发器 + Node.js/Jest。

**Current Baseline (2026-05-15):**
- `PROGRESS.md` 标记 6/6 已完成，且 Phase 5/6 旧方案已由 Phase 7/8 覆盖。
- 已存在：`cloudfunctions/points-engine`、`cloudfunctions/match-results`、`miniprogram/pages/tournament-score`、`miniprogram/components/score-row`、`miniprogram/components/brush-stroke-bg`。
- 不存在：`cloudfunctions/weekly-star`、`miniprogram/components/chip-tab`、`miniprogram/components/number-counter`、`miniprogram/components/skeleton-loader`、`miniprogram/styles/animations.wxss`。
- 旧 Phase 6 里按 `pointsAwarded.winner.total` 聚合的写法已过期；当前积分结构是 `{ pointsAwarded: { source, entries: [{ memberId, points, role }] } }`。
- 如果小程序里排行榜、用户详情、用户数据为空，先执行 Task 0；后续 UI polish 不应建立在“数据自然存在”的假设上。

---

## File Structure

```
cloudfunctions/weekly-star/                         (新建)
├── index.js                                        云函数入口：compute/latest 两个 action + timer 默认 compute
├── config.json                                     每周一 00:30 定时触发
├── package.json                                    wx-server-sdk + jest
└── lib/
    ├── week-window.js                              周区间与 weekId 纯函数
    ├── weekly-star.js                              聚合 match_results + tournament_points
    └── __tests__/
        ├── week-window.test.js
        └── weekly-star.test.js

scripts/
└── audit-polish-data.js                            新建：只读检查 members / match_results / tournament_points / rankable users

miniprogram/
├── app.json                                        统一 tabBar/window 颜色到 Phase 1 tokens
├── app.wxss                                        import animations.wxss
├── styles/
│   ├── tokens.wxss                                 补 token alias，移除负字距
│   ├── utilities.wxss                              CTA/tab/card 动效与 token 收敛
│   └── animations.wxss                             新建全局动效类
├── components/
│   ├── chip-tab/index.{js,wxml,wxss,json}          新建：单/双打 tab
│   ├── number-counter/index.{js,wxml,wxss,json}    新建：数字入场动画，非数字 fallback
│   ├── skeleton-loader/index.{js,wxml,wxss,json}   新建：列表/卡片骨架屏
│   └── stat-block/index.{js,wxml,wxss,json}        改：接入 number-counter
└── pages/
    ├── rank/index.{js,wxml,wxss,json}              改：真实每周之星、chip-tab、loading/empty
    ├── home/index.{js,wxml,wxss,json}              改：loading/empty、stat 数字动效
    ├── player-detail/index.{js,wxml,wxss,json}     改：hero brush stroke、loading/empty、recent copy
    ├── tournament-score/index.{wxml,wxss}          改：token 收敛、触摸态、loading/empty
    ├── tournament-manage/index.{wxml,wxss}         改：待确认队列视觉 polish
    └── my-match/index.{wxml,wxss}                  改：可录分区块视觉 polish

docs/superpowers/plans/PROGRESS.md                  最后更新 Phase 6 状态与执行日志
```

---

## Task 0 · 数据可用性核查（排行 / 用户详情 / 用户数据）

**Files:**
- Create: `scripts/audit-polish-data.js`
- Modify: `scripts/package.json`

- [ ] **Step 0.1 确认 scripts 依赖存在**

`scripts/package.json` 已有 `@cloudbase/node-sdk`。如果本地没安装：

```bash
cd scripts
npm install
```

- [ ] **Step 0.2 新建只读数据审计脚本**

`scripts/audit-polish-data.js`：

```js
#!/usr/bin/env node

const tcb = require('@cloudbase/node-sdk')

const PAGE_SIZE = 1000

async function main() {
  const env = process.env.FOPEN_CLOUD_ENV
  const seasonId = process.env.FOPEN_SEASON_ID || `s${new Date().getFullYear()}`

  if (!env) {
    console.error('[abort] FOPEN_CLOUD_ENV is required')
    console.error('usage: FOPEN_CLOUD_ENV=<envId> FOPEN_SEASON_ID=s2026 node scripts/audit-polish-data.js')
    process.exit(1)
  }

  const app = tcb.init({ env })
  const db = app.database()

  const members = await safeFetchAll(db, 'members', {})
  const matchResults = await safeFetchAll(db, 'match_results', { seasonId })
  const tournamentPoints = await safeFetchAll(db, 'tournament_points', { seasonId })

  const activeMembers = members.filter(m => m.status !== 'inactive')
  const displayReadyMembers = activeMembers.filter(m => m._id && m.name)
  const confirmedMatches = matchResults.filter(r => r.resultStatus === 'confirmed')
  const matchesWithEntries = confirmedMatches.filter(r => {
    const entries = r.pointsAwarded && r.pointsAwarded.entries
    return Array.isArray(entries) && entries.length > 0
  })

  const rankable = aggregateRankableMembers(matchesWithEntries, tournamentPoints)
  const missingMemberRows = Array.from(rankable.keys()).filter(id => !members.find(m => m._id === id))
  const noNameRows = Array.from(rankable.keys()).filter(id => {
    const m = members.find(x => x._id === id)
    return m && !m.name
  })

  const report = {
    env,
    seasonId,
    members: members.length,
    activeMembers: activeMembers.length,
    displayReadyMembers: displayReadyMembers.length,
    matchResults: matchResults.length,
    confirmedMatches: confirmedMatches.length,
    matchesWithPointEntries: matchesWithEntries.length,
    tournamentPoints: tournamentPoints.length,
    rankableMembers: rankable.size,
    missingMemberRows,
    noNameRows,
    topRankPreview: Array.from(rankable.entries())
      .map(([memberId, points]) => ({ memberId, points, name: (members.find(m => m._id === memberId) || {}).name || '' }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10)
  }

  console.log(JSON.stringify(report, null, 2))

  const failures = []
  if (displayReadyMembers.length < 2) failures.push('members display data is insufficient: need at least 2 members with _id/name')
  if (matchesWithEntries.length < 1 && tournamentPoints.length < 1) failures.push('rank source is empty: need confirmed match_results.pointsAwarded.entries or tournament_points')
  if (rankable.size < 1) failures.push('rankable member count is 0')
  if (missingMemberRows.length > 0) failures.push(`rank references missing members: ${missingMemberRows.join(', ')}`)
  if (noNameRows.length > 0) failures.push(`rank references members without name: ${noNameRows.join(', ')}`)

  if (failures.length > 0) {
    console.error('\n[FAIL]')
    failures.forEach(f => console.error(`- ${f}`))
    process.exit(2)
  }

  console.log('\n[PASS] polish data is ready for rank, player-detail, and weekly-star.')
}

async function safeFetchAll(db, collectionName, filter) {
  try {
    const out = []
    for (let skip = 0; skip < 100000; skip += PAGE_SIZE) {
      const page = await db.collection(collectionName).where(filter).skip(skip).limit(PAGE_SIZE).get()
      const rows = page.data || []
      out.push(...rows)
      if (rows.length < PAGE_SIZE) break
    }
    return out
  } catch (err) {
    const msg = `${err.code || ''} ${err.message || ''} ${err.errMsg || ''}`
    if (/DATABASE_COLLECTION_NOT_EXIST|not exist|collection/i.test(msg)) return []
    throw err
  }
}

function aggregateRankableMembers(matches, tournamentPoints) {
  const map = new Map()
  for (const row of matches) {
    const entries = (row.pointsAwarded && row.pointsAwarded.entries) || []
    for (const e of entries) add(map, e.memberId, e.points)
  }
  for (const row of tournamentPoints) {
    add(map, row.memberId, row.points)
  }
  return map
}

function add(map, memberId, points) {
  if (!memberId) return
  map.set(memberId, (map.get(memberId) || 0) + (Number(points) || 0))
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 0.3 package.json 加脚本入口**

`scripts/package.json`：

```json
{
  "scripts": {
    "audit:polish-data": "node audit-polish-data.js"
  }
}
```

保留现有 `dependencies` 不动。

- [ ] **Step 0.4 运行审计**

```bash
cd scripts
FOPEN_CLOUD_ENV=<envId> FOPEN_SEASON_ID=s2026 npm run audit:polish-data
```

Expected PASS 示例：

```text
[PASS] polish data is ready for rank, player-detail, and weekly-star.
```

- [ ] **Step 0.5 如果审计失败，先补真实业务数据**

不要写假排行数据。按现有 Phase 7/8 工作流补齐最小闭环：

1. 管理员登录小程序。
2. 进入 `tournament-manage` 创建一个当前赛季赛事，至少 2 个单打会员或 4 个双打会员。
3. 完成 4 步 wizard，进入赛事详情。
4. 进入 `tournament-score`，录入至少 1 场可确认比分。
5. 管理员保存比赛结果，确保 `match_results.resultStatus='confirmed'` 且 `pointsAwarded.entries.length > 0`。
6. 在 `scripts/` 目录重新跑 `npm run audit:polish-data`，直到 PASS。

如果已经有 confirmed 比赛但没有积分，调用：

```json
{ "action": "recompute", "tournamentId": "<tournamentId>" }
```

在云开发控制台手动执行 `points-engine` 后，再跑审计。

- [ ] **Step 0.6 手动验证当前三块数据**

- 排行榜：`rankList.length > 0`，至少一个用户有 `name/totalPoints`。
- 用户详情：从排行榜点任意用户进入，`player`、`stats`、`recent` 至少能正常渲染；没有 recent 时显示空状态而不是白屏。
- 首页用户数据：当前登录会员有 `currentMember.name`；如果该会员没有比赛，stats 显示 0 而不是加载失败。

- [ ] **Step 0.7 commit**

```bash
git add scripts/audit-polish-data.js scripts/package.json scripts/package-lock.json
git commit -m "chore(scripts): audit rank and member data readiness"
```

---

## Task 1 · weekly-star 纯函数与云函数

**Files:**
- Create: `cloudfunctions/weekly-star/package.json`
- Create: `cloudfunctions/weekly-star/config.json`
- Create: `cloudfunctions/weekly-star/index.js`
- Create: `cloudfunctions/weekly-star/lib/week-window.js`
- Create: `cloudfunctions/weekly-star/lib/weekly-star.js`
- Create: `cloudfunctions/weekly-star/lib/__tests__/week-window.test.js`
- Create: `cloudfunctions/weekly-star/lib/__tests__/weekly-star.test.js`

- [ ] **Step 1.1 创建目录和 package.json**

```bash
mkdir -p cloudfunctions/weekly-star/lib/__tests__
cd cloudfunctions/weekly-star
npm init -y
npm install wx-server-sdk@~3.0.4
npm install --save-dev jest@^29.7.0
```

把 `cloudfunctions/weekly-star/package.json` 改成：

```json
{
  "name": "weekly-star",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "test": "jest"
  },
  "dependencies": {
    "wx-server-sdk": "~3.0.4"
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

- [ ] **Step 1.2 写定时触发配置**

`cloudfunctions/weekly-star/config.json`：

```json
{
  "triggers": [
    {
      "name": "weekly-star-monday",
      "type": "timer",
      "config": "0 30 0 ? * MON *"
    }
  ]
}
```

- [ ] **Step 1.3 写失败测试：week-window**

`cloudfunctions/weekly-star/lib/__tests__/week-window.test.js`：

```js
const { getPreviousNaturalWeek, getWeekId } = require('../week-window')

describe('week-window', () => {
  test('周一 00:30 计算上一自然周', () => {
    const now = new Date('2026-05-18T00:30:00+08:00')
    const w = getPreviousNaturalWeek(now)
    expect(w.weekStart).toBe('2026-05-11')
    expect(w.weekEnd).toBe('2026-05-17')
    expect(w.start.getHours()).toBe(0)
    expect(w.end.getHours()).toBe(23)
    expect(w.end.getMinutes()).toBe(59)
  })

  test('weekId 使用周一日期，避免跨年周序争议', () => {
    expect(getWeekId(new Date('2026-05-11T00:00:00+08:00'))).toBe('ws_2026-05-11')
  })
})
```

- [ ] **Step 1.4 实现 week-window**

`cloudfunctions/weekly-star/lib/week-window.js`：

```js
function pad(n) {
  return String(n).padStart(2, '0')
}

function toDateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function startOfLocalDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function getPreviousNaturalWeek(now = new Date()) {
  const today = startOfLocalDay(now)
  const dow = today.getDay() === 0 ? 7 : today.getDay()
  const thisMonday = new Date(today)
  thisMonday.setDate(today.getDate() - (dow - 1))

  const start = new Date(thisMonday)
  start.setDate(thisMonday.getDate() - 7)

  const end = new Date(thisMonday)
  end.setMilliseconds(-1)

  return {
    start,
    end,
    weekStart: toDateKey(start),
    weekEnd: toDateKey(end),
    weekId: getWeekId(start)
  }
}

function getWeekId(mondayDate) {
  return `ws_${toDateKey(mondayDate)}`
}

module.exports = { getPreviousNaturalWeek, getWeekId, toDateKey }
```

- [ ] **Step 1.5 写失败测试：weekly-star 聚合 Phase 8 积分结构**

`cloudfunctions/weekly-star/lib/__tests__/weekly-star.test.js`：

```js
const { computeWeeklyStarsFromRows } = require('../weekly-star')

const week = {
  start: new Date('2026-05-11T00:00:00+08:00'),
  end: new Date('2026-05-17T23:59:59+08:00'),
  weekStart: '2026-05-11',
  weekEnd: '2026-05-17',
  weekId: 'ws_2026-05-11'
}

describe('computeWeeklyStarsFromRows', () => {
  test('按 pointsAwarded.entries 汇总单/双打每周之星', () => {
    const result = computeWeeklyStarsFromRows({
      week,
      members: [
        { _id: 'm1', name: 'A', avatarUrl: 'a.png' },
        { _id: 'm2', name: 'B', avatarUrl: 'b.png' },
        { _id: 'm3', name: 'C', avatarUrl: 'c.png' }
      ],
      matches: [
        {
          _id: 'r1',
          seasonId: 's2026',
          tournamentType: 'singles',
          resultStatus: 'confirmed',
          confirmedAt: new Date('2026-05-12T10:00:00+08:00'),
          pointsAwarded: { source: 'match', entries: [
            { memberId: 'm1', points: 20, role: 'winner' },
            { memberId: 'm2', points: 10, role: 'loser' }
          ] }
        },
        {
          _id: 'r2',
          seasonId: 's2026',
          tournamentType: 'doubles',
          resultStatus: 'confirmed',
          confirmedAt: new Date('2026-05-13T10:00:00+08:00'),
          pointsAwarded: { source: 'match', entries: [
            { memberId: 'm3', points: 30, role: 'winner' }
          ] }
        }
      ],
      placementRows: [
        {
          _id: 'p1',
          seasonId: 's2026',
          tournamentType: 'singles',
          memberId: 'm1',
          points: 100,
          createTime: new Date('2026-05-17T12:00:00+08:00')
        }
      ],
      seasonId: 's2026'
    })

    expect(result._id).toBe('s2026_ws_2026-05-11')
    expect(result.weekId).toBe('ws_2026-05-11')
    expect(result.singlesStar).toEqual({ memberId: 'm1', name: 'A', avatarUrl: 'a.png', points: 120 })
    expect(result.doublesStar).toEqual({ memberId: 'm3', name: 'C', avatarUrl: 'c.png', points: 30 })
  })

  test('忽略周外、赛季外、未 confirmed 数据', () => {
    const result = computeWeeklyStarsFromRows({
      week,
      members: [{ _id: 'm1', name: 'A' }],
      matches: [
        { seasonId: 's2025', tournamentType: 'singles', resultStatus: 'confirmed', confirmedAt: week.start, pointsAwarded: { entries: [{ memberId: 'm1', points: 999 }] } },
        { seasonId: 's2026', tournamentType: 'singles', resultStatus: 'submitted', confirmedAt: week.start, pointsAwarded: { entries: [{ memberId: 'm1', points: 999 }] } },
        { seasonId: 's2026', tournamentType: 'singles', resultStatus: 'confirmed', confirmedAt: new Date('2026-05-18T00:00:00+08:00'), pointsAwarded: { entries: [{ memberId: 'm1', points: 999 }] } }
      ],
      placementRows: [],
      seasonId: 's2026'
    })
    expect(result.singlesStar).toBe(null)
    expect(result.doublesStar).toBe(null)
  })
})
```

- [ ] **Step 1.6 实现 weekly-star 纯函数**

`cloudfunctions/weekly-star/lib/weekly-star.js`：

```js
function getTime(row) {
  return new Date(row.confirmedAt || row.createTime || row.updateTime || 0).getTime()
}

function inWeek(row, week) {
  const t = getTime(row)
  return t >= week.start.getTime() && t <= week.end.getTime()
}

function add(map, memberId, points) {
  if (!memberId) return
  map[memberId] = (map[memberId] || 0) + (Number(points) || 0)
}

function topStar(map, membersById) {
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return null
  const [memberId, points] = sorted[0]
  const m = membersById[memberId] || {}
  return { memberId, name: m.name || memberId, avatarUrl: m.avatarUrl || '', points }
}

function computeWeeklyStarsFromRows({ week, matches, placementRows, members, seasonId }) {
  const buckets = { singles: {}, doubles: {} }

  for (const row of matches || []) {
    if (row.seasonId !== seasonId) continue
    if (row.resultStatus !== 'confirmed') continue
    if (!inWeek(row, week)) continue
    const type = row.tournamentType
    if (!buckets[type]) continue
    for (const e of ((row.pointsAwarded && row.pointsAwarded.entries) || [])) {
      add(buckets[type], e.memberId, e.points)
    }
  }

  for (const row of placementRows || []) {
    if (row.seasonId !== seasonId) continue
    if (!inWeek(row, week)) continue
    const type = row.tournamentType
    if (!buckets[type]) continue
    add(buckets[type], row.memberId, row.points)
  }

  const membersById = Object.fromEntries((members || []).map(m => [m._id, m]))
  return {
    _id: `${seasonId}_${week.weekId}`,
    seasonId,
    weekId: week.weekId,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    singlesStar: topStar(buckets.singles, membersById),
    doublesStar: topStar(buckets.doubles, membersById)
  }
}

module.exports = { computeWeeklyStarsFromRows }
```

- [ ] **Step 1.7 跑测试**

```bash
cd cloudfunctions/weekly-star
npx jest
```

Expected: `2 test suites passed`。

- [ ] **Step 1.8 写 index.js：compute/latest action**

`cloudfunctions/weekly-star/index.js`：

```js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { getPreviousNaturalWeek } = require('./lib/week-window')
const { computeWeeklyStarsFromRows } = require('./lib/weekly-star')

exports.main = async (event = {}) => {
  const action = event.action || 'compute'
  try {
    if (action === 'latest') return await latest(event)
    if (action === 'compute') return await compute(event)
    return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } }
  } catch (e) {
    console.error('[weekly-star]', action, e)
    return { success: false, error: { code: 'INTERNAL', message: e.message } }
  }
}

async function latest({ seasonId = `s${new Date().getFullYear()}` }) {
  const rows = (await db.collection('weekly_stars')
    .where({ seasonId })
    .orderBy('weekStart', 'desc')
    .limit(1)
    .get()).data
  return { success: true, data: rows[0] || null }
}

async function compute({ seasonId = `s${new Date().getFullYear()}`, now }) {
  const week = getPreviousNaturalWeek(now ? new Date(now) : new Date())
  const [matches, placementRows] = await Promise.all([
    // confirmedAt 是 Phase 8 新路径；旧/兼容行可能只有 createTime。
    // 这里先按 season/status 拉取，再交给纯函数用 confirmedAt/createTime/updateTime 过滤周区间。
    fetchAll('match_results', { seasonId, resultStatus: 'confirmed' }),
    fetchAll('tournament_points', {
      seasonId,
      createTime: _.gte(week.start).and(_.lte(week.end))
    }).catch(e => {
      const msg = `${e.errMsg || e.message || ''}`
      if (/not exist|collection/i.test(msg)) return []
      throw e
    })
  ])

  const memberIds = Array.from(new Set([
    ...matches.flatMap(m => ((m.pointsAwarded && m.pointsAwarded.entries) || []).map(e => e.memberId)),
    ...placementRows.map(p => p.memberId)
  ].filter(Boolean)))
  const members = memberIds.length
    ? (await db.collection('members').where({ _id: _.in(memberIds) }).get()).data
    : []

  const doc = {
    ...computeWeeklyStarsFromRows({ week, matches, placementRows, members, seasonId }),
    computedAt: db.serverDate()
  }

  await upsert('weekly_stars', doc._id, doc)
  return { success: true, data: doc }
}

async function fetchAll(collectionName, filter, pageSize = 100) {
  const out = []
  for (let skip = 0; skip < 5000; skip += pageSize) {
    const page = (await db.collection(collectionName).where(filter).skip(skip).limit(pageSize).get()).data || []
    out.push(...page)
    if (page.length < pageSize) break
  }
  return out
}

async function upsert(collectionName, id, data) {
  try {
    await db.collection(collectionName).doc(id).set({ data })
  } catch (e) {
    await db.collection(collectionName).add({ data })
  }
}
```

- [ ] **Step 1.9 上传并手动测试**

```bash
bash uploadCloudFunction.sh weekly-star
```

在云开发控制台调用：

```json
{ "action": "compute", "seasonId": "s2026" }
```

Expected:
- 返回 `{ success: true, data: { _id, weekStart, weekEnd, singlesStar, doublesStar } }`
- 数据库新增或覆盖 `weekly_stars/<seasonId>_ws_YYYY-MM-DD`

- [ ] **Step 1.10 commit**

```bash
git add cloudfunctions/weekly-star
git commit -m "feat(weekly-star): compute weekly stars from awarded points"
```

---

## Task 2 · rank 页接入真实每周之星

**Files:**
- Modify: `miniprogram/pages/rank/index.js`
- Modify: `miniprogram/pages/rank/index.wxml`
- Modify: `miniprogram/pages/rank/index.wxss`
- Modify: `miniprogram/pages/rank/index.json`

- [ ] **Step 2.1 修改 rank data 与加载流程**

在 `miniprogram/pages/rank/index.js` 的 `data` 增加：

```js
weeklyStar: null,
weeklyStarWeekRange: '',
loading: false
```

把 `onShow/loadRank/onTabChange` 改成：

```js
async onShow() {
  this.setData({ currentMember: getApp().globalData.currentMember })
  await Promise.all([this.loadRank(), this.loadWeeklyStar()])
},

async loadRank() {
  this.setData({ loading: true })
  try {
    const res = await wx.cloud.callFunction({
      name: 'points-engine',
      data: {
        action: 'rankList',
        type: this.data.activeTab,
        currentSeasonId: `s${new Date().getFullYear()}`
      }
    })
    this.setData({ rankList: res.result?.data?.rankList || [] })
  } catch (err) {
    console.error('[rank] loadRank error', err)
    wx.showToast({ title: '加载失败', icon: 'none', duration: 2000 })
  } finally {
    this.setData({ loading: false })
  }
},

async loadWeeklyStar() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'weekly-star',
      data: { action: 'latest', seasonId: `s${new Date().getFullYear()}` }
    })
    const star = res.result?.data || null
    const selected = this.data.activeTab === 'singles' ? star?.singlesStar : star?.doublesStar
    this.setData({
      weeklyStar: selected || null,
      weeklyStarWeekRange: star ? `${star.weekStart} ~ ${star.weekEnd}` : ''
    })
  } catch (err) {
    console.error('[rank] loadWeeklyStar error', err)
  }
},

onTabChange(e) {
  const tab = e.detail?.value || e.currentTarget.dataset.tab
  if (!tab || tab === this.data.activeTab) return
  this.setData({ activeTab: tab })
  this.loadRank()
  this.loadWeeklyStar()
}
```

- [ ] **Step 2.2 注册新组件**

`miniprogram/pages/rank/index.json`：

```json
{
  "usingComponents": {
    "rank-row": "/components/rank-row/index",
    "brush-stroke-bg": "/components/brush-stroke-bg/index",
    "chip-tab": "/components/chip-tab/index",
    "skeleton-loader": "/components/skeleton-loader/index"
  },
  "navigationBarTitleText": "排行榜"
}
```

- [ ] **Step 2.3 替换 rank tab 与 hero**

`miniprogram/pages/rank/index.wxml` 里把 `.tabs` 和 `RANK #1` card 替换为：

```xml
<chip-tab
  value="{{activeTab}}"
  options="{{[{ label: 'SINGLES', value: 'singles' }, { label: 'DOUBLES', value: 'doubles' }]}}"
  bindchange="onTabChange"
/>

<view wx:if="{{weeklyStar}}" class="card-hero star-card anim-fade-up">
  <brush-stroke-bg></brush-stroke-bg>
  <view class="star-content">
    <text class="text-label">WEEKLY STAR · {{weeklyStarWeekRange}}</text>
    <view class="star-row">
      <image class="star-avatar" src="{{weeklyStar.avatarUrl || '/images/icons/usercenter.png'}}" mode="aspectFill" />
      <view class="star-copy">
        <text class="text-h2">{{weeklyStar.name}}</text>
        <text class="text-meta">本周积分 {{weeklyStar.points}}</text>
      </view>
    </view>
  </view>
</view>

<view wx:elif="{{rankList[0]}}" class="card-hero star-card anim-fade-up">
  <brush-stroke-bg></brush-stroke-bg>
  <view class="star-content">
    <text class="text-label">RANK #1</text>
    <text class="text-h2">{{rankList[0].name}}</text>
    <text class="text-meta">{{rankList[0].totalPoints}} 分</text>
  </view>
</view>

<skeleton-loader wx:if="{{loading}}" rows="{{6}}" />
```

- [ ] **Step 2.4 补 rank 样式**

追加到 `miniprogram/pages/rank/index.wxss`：

```css
.star-card {
  position: relative;
  overflow: hidden;
  margin-top: var(--space-5);
}

.star-content {
  position: relative;
  z-index: 1;
}

.star-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-3);
}

.star-avatar {
  width: 96rpx;
  height: 96rpx;
  border-radius: 50%;
  border: 3rpx solid #fff;
  background: var(--color-bg-3);
}

.star-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
```

- [ ] **Step 2.5 手动验证**

在开发者工具打开排行榜：
- 单/双打切换时排名和每周之星同步切换。
- 没有 `weekly_stars` 数据时 fallback 到 `RANK #1`。
- 点击列表头像仍进入 `player-detail`。

- [ ] **Step 2.6 commit**

```bash
git add miniprogram/pages/rank
git commit -m "feat(rank): show weekly star and polished tabs"
```

---

## Task 3 · 全局动效与 token 收敛

**Files:**
- Create: `miniprogram/styles/animations.wxss`
- Modify: `miniprogram/app.wxss`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/styles/tokens.wxss`
- Modify: `miniprogram/styles/utilities.wxss`

- [ ] **Step 3.1 新建 animations.wxss**

`miniprogram/styles/animations.wxss`：

```css
@keyframes fade-up {
  from { opacity: 0; transform: translateY(16rpx); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes soft-pop {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes skeleton-pulse {
  0% { opacity: 0.45; }
  50% { opacity: 1; }
  100% { opacity: 0.45; }
}

.anim-fade-up {
  animation: fade-up 220ms var(--ease-out) both;
}

.anim-soft-pop {
  animation: soft-pop 180ms var(--ease-out) both;
}

.tap-scale {
  transition: transform 120ms var(--ease-out), opacity 120ms var(--ease-out);
}

.tap-scale:active {
  transform: scale(0.97);
  opacity: 0.88;
}
```

- [ ] **Step 3.2 app.wxss import**

`miniprogram/app.wxss`：

```css
@import "/styles/tokens.wxss";
@import "/styles/base.wxss";
@import "/styles/utilities.wxss";
@import "/styles/animations.wxss";
```

- [ ] **Step 3.3 补 token alias，消除旧 fallback 名称漂移**

在 `miniprogram/styles/tokens.wxss` 的 `page {}` 内补：

```css
--color-primary: var(--color-lime);
--color-bg-soft: var(--color-bg-3);
--color-text: var(--color-ink);
--color-text-strong: var(--color-ink);
--color-text-muted: var(--color-muted);
```

- [ ] **Step 3.4 移除负字距**

把 `miniprogram/styles/utilities.wxss` 里的负 `letter-spacing` 改为 `0`：

```css
.text-display { letter-spacing: 0; }
.text-h2 { letter-spacing: 0; }
.text-stat { letter-spacing: 0; }
```

保留 `.text-label` 的正字距和 CTA 的正字距。

- [ ] **Step 3.5 app.json 颜色跟随当前视觉系统**

`miniprogram/app.json` 中只改这些颜色字段，保留 `pages` 与 `tabBar.list` 原值：

| Path | Value |
|---|---|
| `tabBar.color` | `#6B7280` |
| `tabBar.selectedColor` | `#0A0A0A` |
| `tabBar.backgroundColor` | `#FFFFFF` |
| `tabBar.borderStyle` | `white` |
| `window.backgroundColor` | `#FFFFFF` |
| `window.backgroundTextStyle` | `dark` |
| `window.navigationBarBackgroundColor` | `#FFFFFF` |
| `window.navigationBarTextStyle` | `black` |

注意：不要删除 `tabBar.list`，也不要调整 tab 顺序。

- [ ] **Step 3.6 commit**

```bash
git add miniprogram/app.json miniprogram/app.wxss miniprogram/styles
git commit -m "style: add global polish animations and token aliases"
```

---

## Task 4 · chip-tab / number-counter / skeleton-loader 组件

**Files:**
- Create: `miniprogram/components/chip-tab/index.{js,wxml,wxss,json}`
- Create: `miniprogram/components/number-counter/index.{js,wxml,wxss,json}`
- Create: `miniprogram/components/skeleton-loader/index.{js,wxml,wxss,json}`
- Modify: `miniprogram/components/stat-block/index.{js,wxml,wxss,json}`

- [ ] **Step 4.1 新建 chip-tab**

`miniprogram/components/chip-tab/index.json`：

```json
{ "component": true }
```

`miniprogram/components/chip-tab/index.js`：

```js
Component({
  properties: {
    value: String,
    options: { type: Array, value: [] }
  },
  methods: {
    onTap(e) {
      const value = e.currentTarget.dataset.value
      if (value === this.data.value) return
      wx.vibrateShort({ type: 'light' })
      this.triggerEvent('change', { value })
    }
  }
})
```

`miniprogram/components/chip-tab/index.wxml`：

```xml
<view class="chip-tab" role="tablist">
  <view
    wx:for="{{options}}"
    wx:key="value"
    class="chip-tab-item tap-scale {{value === item.value ? 'active' : ''}}"
    data-value="{{item.value}}"
    bindtap="onTap"
  >
    <text>{{item.label}}</text>
  </view>
</view>
```

`miniprogram/components/chip-tab/index.wxss`：

```css
.chip-tab {
  display: flex;
  gap: var(--space-2);
  padding: 6rpx;
  border-radius: var(--radius-pill);
  background: var(--color-bg-3);
}

.chip-tab-item {
  flex: 1;
  min-height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  color: var(--color-muted);
  font-size: var(--font-label-size);
  font-weight: 700;
}

.chip-tab-item.active {
  background: var(--color-lime);
  color: var(--color-ink);
  box-shadow: var(--shadow-card);
}
```

- [ ] **Step 4.2 新建 number-counter**

`miniprogram/components/number-counter/index.json`：

```json
{ "component": true }
```

`miniprogram/components/number-counter/index.js`：

```js
Component({
  properties: {
    value: { type: null, observer: 'animateToValue' },
    suffix: { type: String, value: '' }
  },
  data: {
    displayValue: '0'
  },
  lifetimes: {
    attached() {
      this.animateToValue(this.data.value)
    }
  },
  methods: {
    animateToValue(value) {
      const target = Number(value)
      if (!Number.isFinite(target)) {
        this.setData({ displayValue: value == null ? '0' : String(value) })
        return
      }
      const start = 0
      const steps = 12
      const duration = 240
      let tick = 0
      clearInterval(this._timer)
      this._timer = setInterval(() => {
        tick += 1
        const p = tick / steps
        const eased = 1 - Math.pow(1 - p, 3)
        const current = Math.round(start + (target - start) * eased)
        this.setData({ displayValue: `${current}${this.data.suffix}` })
        if (tick >= steps) clearInterval(this._timer)
      }, duration / steps)
    }
  }
})
```

`miniprogram/components/number-counter/index.wxml`：

```xml
<text class="number-counter">{{displayValue}}</text>
```

`miniprogram/components/number-counter/index.wxss`：

```css
.number-counter {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4.3 新建 skeleton-loader**

`miniprogram/components/skeleton-loader/index.json`：

```json
{ "component": true }
```

`miniprogram/components/skeleton-loader/index.js`：

```js
Component({
  properties: {
    rows: { type: Number, value: 3 }
  },
  data: {
    rowList: []
  },
  observers: {
    rows(rows) {
      this.setData({ rowList: Array.from({ length: rows || 3 }, (_, i) => i) })
    }
  },
  lifetimes: {
    attached() {
      this.setData({ rowList: Array.from({ length: this.data.rows || 3 }, (_, i) => i) })
    }
  }
})
```

`miniprogram/components/skeleton-loader/index.wxml`：

```xml
<view class="skeleton">
  <view wx:for="{{rowList}}" wx:key="*this" class="skeleton-row">
    <view class="skeleton-avatar"></view>
    <view class="skeleton-lines">
      <view class="skeleton-line long"></view>
      <view class="skeleton-line short"></view>
    </view>
  </view>
</view>
```

`miniprogram/components/skeleton-loader/index.wxss`：

```css
.skeleton {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.skeleton-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
}

.skeleton-avatar,
.skeleton-line {
  background: var(--color-bg-3);
  animation: skeleton-pulse 900ms ease-in-out infinite;
}

.skeleton-avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
}

.skeleton-lines {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.skeleton-line {
  height: 22rpx;
  border-radius: var(--radius-pill);
}

.skeleton-line.long { width: 70%; }
.skeleton-line.short { width: 42%; }
```

- [ ] **Step 4.4 stat-block 接入 number-counter**

`miniprogram/components/stat-block/index.json`：

```json
{
  "component": true,
  "usingComponents": {
    "number-counter": "/components/number-counter/index"
  }
}
```

`miniprogram/components/stat-block/index.js`：

```js
Component({
  properties: {
    value: null,
    label: String,
    suffix: { type: String, value: '' }
  }
})
```

`miniprogram/components/stat-block/index.wxml`：

```xml
<view class="stat-block anim-soft-pop">
  <text class="text-stat">
    <number-counter value="{{value}}" suffix="{{suffix}}"></number-counter>
  </text>
  <text class="text-label">{{label}}</text>
</view>
```

- [ ] **Step 4.5 替换百分比调用**

在 `miniprogram/pages/home/index.wxml` 里把：

```xml
<stat-block value="{{myStats.winRate + '%'}}" label="WIN RATE"></stat-block>
```

改成：

```xml
<stat-block value="{{myStats.winRate}}" suffix="%" label="WIN RATE"></stat-block>
```

- [ ] **Step 4.6 commit**

```bash
git add miniprogram/components/chip-tab miniprogram/components/number-counter miniprogram/components/skeleton-loader miniprogram/components/stat-block miniprogram/pages/home/index.wxml
git commit -m "feat(ui): add polished tabs counters and skeleton loaders"
```

---

## Task 5 · 页面级 polish：home / player-detail / score flows

**Files:**
- Modify: `miniprogram/pages/home/index.{js,wxml,wxss}`
- Modify: `miniprogram/pages/player-detail/index.{js,wxml,wxss,json}`
- Modify: `miniprogram/pages/tournament-score/index.{wxml,wxss}`
- Modify: `miniprogram/pages/tournament-manage/index.wxss`
- Modify: `miniprogram/pages/my-match/index.wxss`

- [ ] **Step 5.1 home 增加 loading/empty 状态**

在 `miniprogram/pages/home/index.js` 的 `data` 增加：

```js
loadingStats: false
```

在 `loadHome()` 调 `points-engine` 前后设置：

```js
this.setData({ loadingStats: true })
try {
  // existing stats call
} finally {
  this.setData({ loadingStats: false })
}
```

在 `miniprogram/pages/home/index.wxml` stats 区块里加：

```xml
<skeleton-loader wx:if="{{loadingStats}}" rows="{{2}}" />
<view wx:else class="stats-grid">
  <stat-block value="{{myStats.matches}}" label="MATCHES"></stat-block>
  <stat-block value="{{myStats.wins}}" label="WINS"></stat-block>
  <stat-block value="{{myStats.winRate}}" suffix="%" label="WIN RATE"></stat-block>
</view>
```

并在 `miniprogram/pages/home/index.json` 注册：

```json
"skeleton-loader": "/components/skeleton-loader/index"
```

- [ ] **Step 5.2 player-detail hero 加 brush stroke**

`miniprogram/pages/player-detail/index.json` 注册：

```json
{
  "usingComponents": {
    "stat-block": "/components/stat-block/index",
    "brush-stroke-bg": "/components/brush-stroke-bg/index",
    "skeleton-loader": "/components/skeleton-loader/index"
  },
  "navigationBarTitleText": "球员详情"
}
```

`miniprogram/pages/player-detail/index.wxml` 里把 `hero-row` 改成：

```xml
<view class="hero-row card-hero anim-fade-up">
  <brush-stroke-bg></brush-stroke-bg>
  <image class="big-avatar" src="{{player.avatarUrl || '/images/icons/usercenter.png'}}" mode="aspectFill" />
  <view class="player-info">
    <text class="text-h1">{{player.name}}</text>
    <text class="text-meta">{{player.playStyle || '打法未知'}}</text>
  </view>
</view>
```

在 `miniprogram/pages/player-detail/index.wxss` 确保：

```css
.hero-row {
  position: relative;
  overflow: hidden;
}

.hero-row .big-avatar,
.hero-row .player-info {
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 5.3 tournament-score token 收敛**

在 `miniprogram/pages/tournament-score/index.wxss`：
- 将 `var(--color-bg-soft, #f0f0f0)` 替换为 `var(--color-bg-3)`。
- 将 `var(--color-text-muted, #777)` 替换为 `var(--color-muted)`。
- 将 `var(--color-primary, #16a34a)` 替换为 `var(--color-success)`。
- 给 `.round-group` 加 `animation: fade-up 220ms var(--ease-out) both;`。
- 给 `.confirm-all` 加 `transition: transform 120ms var(--ease-out), opacity 120ms var(--ease-out);` 和 `.confirm-all:active { transform: scale(0.98); }`。

- [ ] **Step 5.4 tournament-manage / my-match 队列区块统一视觉**

检查两个页面里“待确认比分”和“可录分比赛”区块，统一：

```css
.queue-card,
.scorable-card {
  background: var(--color-bg-2);
  border: 1rpx solid var(--color-border);
  border-radius: var(--radius-lg);
  padding: var(--space-4);
  box-shadow: var(--shadow-card);
}

.queue-card:active,
.scorable-card:active {
  transform: scale(0.99);
  opacity: 0.9;
}
```

如果现有 class 名不同，只改对应已有 class，不新增重复结构。

- [ ] **Step 5.5 手动验证**

- 首页首次进来 stats 有骨架屏，加载后数字动效不撑开布局。
- 球员详情 hero 装饰不遮挡头像和姓名。
- 录分页底部按钮点击反馈清晰，不影响禁用态。
- 管理页待确认队列和我的比赛可录分队列视觉一致。

- [ ] **Step 5.6 commit**

```bash
git add miniprogram/pages/home miniprogram/pages/player-detail miniprogram/pages/tournament-score miniprogram/pages/tournament-manage miniprogram/pages/my-match
git commit -m "style: polish key post-score user flows"
```

---

## Task 6 · 清理调试输出与最终验收

**Files:**
- Modify: `miniprogram/pages/season-manage/index.js`
- Modify: `miniprogram/pages/round-settlement/index.js`
- Modify: `miniprogram/pages/match/index.js`
- Modify: `miniprogram/pages/index/index.js`
- Modify: `cloudfunctions/match-results/index.js`
- Modify: `docs/superpowers/plans/PROGRESS.md`

- [ ] **Step 6.1 清理明显调试 console.log**

删除这些只用于开发期的输出：

```bash
rg -n "console\\.log" miniprogram cloudfunctions
```

必须删除或降级的已知位置：
- `miniprogram/pages/season-manage/index.js`
- `miniprogram/pages/round-settlement/index.js`
- `miniprogram/pages/match/index.js`
- `miniprogram/pages/index/index.js`
- `cloudfunctions/match-results/index.js` 中 legacy `add/update/updateMatchScore` 的大对象日志

保留 `console.error/console.warn`，因为云函数和页面失败时仍需要定位。

- [ ] **Step 6.2 跑后端测试**

```bash
cd cloudfunctions/weekly-star && npx jest
cd ../points-engine && npx jest
cd ../match-results && npx jest
cd ../_shared && npx jest
```

Expected:
- `weekly-star`: all tests pass
- `points-engine`: existing 16 tests pass
- `match-results`: existing 55 tests pass
- `_shared`: existing 22 tests pass

- [ ] **Step 6.3 跑 shared hash 检查**

```bash
bash scripts/sync-shared-libs.sh
```

Expected: 所有 mirror hash 一致。

- [ ] **Step 6.4 JS 语法检查**

```bash
find miniprogram cloudfunctions -path "*/node_modules" -prune -o -name "*.js" -print0 | xargs -0 -n1 node -c
```

Expected: 无 syntax error。

- [ ] **Step 6.5 开发者工具手动巡检**

逐页检查：
- 首页：hero、quick actions、stats 骨架屏和数字动效。
- 赛事 tab：赛事列表可进入详情。
- 排行榜：weekly star、单/双打切换、点击球员。
- 球员详情：hero、单双打 stats、recent matches。
- 我的比赛：可录分比赛入口。
- 管理：待确认比分队列。
- 录分页：展开编辑、提交、admin 保存、底部 sticky 按钮。
- 创建赛事：4 步 wizard 无视觉回归。
- 排程页：schedule-board 仍可拖动/保存。
- tabBar：admin 5 个 tab，普通会员隐藏管理 tab。

- [ ] **Step 6.6 更新 PROGRESS.md**

把 `docs/superpowers/plans/PROGRESS.md` 中 Phase 6 行从“由 Phase 7+8 重做覆盖”改为：

```md
| 06 | Phase 6 · Polish | ✅ 已完成 | 2026-05-15 | 2026-05-15 | <commit> | Post-Phase-8 polish：weekly-star 定时云函数、排行榜每周之星、全局动效、骨架屏、数字动效、关键录分流程视觉收敛 |
```

在执行日志顶部追加：

```md
### 2026-05-15 · Phase 6 Post-Phase-8 Polish 完成

- 新增 `scripts/audit-polish-data.js`，上线 polish 前先确认 members / confirmed match_results / tournament_points 能支撑排行榜、用户详情、首页用户数据。
- 新增 `weekly-star` 定时云函数，按 Phase 8 的 `pointsAwarded.entries` 与 `tournament_points` 计算每周之星。
- 排行榜接入真实 weekly star，缺数据时 fallback 到当前 #1。
- 新增 `chip-tab / number-counter / skeleton-loader`，并接入 rank/home/stat-block。
- 全局补 `animations.wxss`，统一 token alias，收敛旧 `color-text-muted/color-bg-soft` fallback。
- 清理明显调试日志。
- 验证：`weekly-star / points-engine / match-results / _shared` Jest 全过，`scripts/sync-shared-libs.sh` 全过，JS syntax check 全过，DevTools 关键页面手动巡检通过。
```

- [ ] **Step 6.7 commit**

```bash
git add miniprogram cloudfunctions docs/superpowers/plans/PROGRESS.md
git commit -m "chore: complete post-phase-8 polish"
```

---

## Acceptance Criteria

- [ ] `cd scripts && FOPEN_CLOUD_ENV=<envId> FOPEN_SEASON_ID=s2026 npm run audit:polish-data` 通过，报告里 `rankableMembers >= 1`。
- [ ] 排行榜不是空白：有 rank 数据时显示真实会员姓名和积分；没有 rank 数据时显示明确空状态。
- [ ] 从排行榜点击用户能进入用户详情，`members.getById` 与 `points-engine.playerStats` 返回结构能被页面正确渲染。
- [ ] 首页当前用户数据不是空白：未登录/无比赛/有比赛三种状态都有明确展示。
- [ ] `weekly-star` 定时触发器存在，手动调用 `compute` 能写入 `weekly_stars`。
- [ ] 排行榜显示对应 tab 的真实每周之星；无周数据时显示 Rank #1。
- [ ] 单/双打 tab 使用统一 `chip-tab`，切换有轻触反馈，不破坏 rank 数据加载。
- [ ] 首页、排行榜、球员详情、录分页有一致的加载/空状态。
- [ ] `stat-block` 数字首次展示有轻量滚动，不造成布局跳动。
- [ ] `app.json/app.wxss/styles/*` 与 Phase 1 白底 + 青柠/黑视觉统一。
- [ ] 不再新增旧路线页面：不创建 `result-submit`，不创建 `result-reconcile`。
- [ ] `cloudfunctions/weekly-star && npx jest` 通过。
- [ ] `cloudfunctions/points-engine && npx jest` 通过。
- [ ] `cloudfunctions/match-results && npx jest` 通过。
- [ ] `cloudfunctions/_shared && npx jest` 通过。
- [ ] `bash scripts/sync-shared-libs.sh` 通过。
- [ ] 全部 JS `node -c` 通过。
- [ ] 微信开发者工具关键页面巡检通过，Console 无新增红错。
