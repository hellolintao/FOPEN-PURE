# Phase 4 · 自动排程引擎 + 签表/对局表 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development（推荐子代理执行）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现自动排程引擎（避同人冲突 + 均衡休息），让每场比赛被分配到 `(courtId, slotId)`；同时生成常规赛/淘汰赛的对局表 / 签表。

**Architecture:** 新建 `scheduler-engine` 云函数，含独立的 `lib/` 算法模块（纯函数、可单测）。配对生成（常规赛随机配对、淘汰赛签表）拆出 `lib/pairing/` 子目录。改造 `tournament-brackets` 页面展示场地+时段信息和"未排程"区块。

**Tech Stack:** Node.js + Jest（重测试覆盖率，目标 95%）

**Spec 引用:** §6.2 scheduler-engine、§8 工作流 A、§11.3 测试用例

**前置条件:** Phase 1 + Phase 3 完成（tournaments 有 courtTimeGrid 字段且能创建）

**推荐执行方式:** Subagent-driven。算法部分 Task 之间独立，给每个 Task 派一个清白上下文的子代理跑 TDD 循环，质量更稳。

---

## File Structure

```
cloudfunctions/scheduler-engine/                (新建)
├── index.js                                    - 云函数入口
├── lib/
│   ├── constraints.js                          - 约束检查（纯函数）
│   ├── greedy.js                               - 贪心分配算法
│   ├── pairing/
│   │   ├── round-robin.js                      - 常规赛配对（每人每轮 1 场）
│   │   └── knockout-bracket.js                 - 淘汰赛签表
│   └── __tests__/
│       ├── constraints.test.js
│       ├── greedy.test.js
│       ├── round-robin.test.js
│       └── knockout-bracket.test.js
├── package.json                                - 加 jest
└── README.md                                   - 算法说明

miniprogram/pages/tournament-brackets/
├── index.wxml                                  - 改：展示 courtId + scheduledStart
├── index.wxss                                  - 改：unscheduled 区块样式
└── index.js                                    - 改：调度后端、展示 unscheduled
```

---

## Task 1 · scheduler-engine 云函数骨架 + Jest

**Files:**
- Create: `cloudfunctions/scheduler-engine/package.json`
- Create: `cloudfunctions/scheduler-engine/index.js`
- Create: `cloudfunctions/scheduler-engine/lib/`（空目录）

- [ ] **Step 1.1 创建目录与 package.json**

```bash
mkdir -p cloudfunctions/scheduler-engine/lib/__tests__
mkdir -p cloudfunctions/scheduler-engine/lib/pairing
```

package.json（同 Phase 1 Task 5.1 模式）：

```json
{
  "name": "scheduler-engine",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": { "test": "jest" },
  "dependencies": { "wx-server-sdk": "~3.0.4" },
  "devDependencies": { "jest": "^29.7.0" },
  "jest": { "testEnvironment": "node", "testMatch": ["**/__tests__/**/*.test.js"] }
}
```

- [ ] **Step 1.2 安装 `cd cloudfunctions/scheduler-engine && npm install`**

- [ ] **Step 1.3 index.js 骨架**

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const { schedule } = require('./lib/greedy');
const { generateRoundRobin } = require('./lib/pairing/round-robin');
const { generateKnockout } = require('./lib/pairing/knockout-bracket');

exports.main = async (event, context) => {
  const { action, tournamentId } = event;

  if (action === 'schedule') {
    return await runSchedule(tournamentId);
  }
  return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } };
};

async function runSchedule(tournamentId) {
  const tournament = (await db.collection('tournaments').doc(tournamentId).get()).data;
  const regs = (await db.collection('tournament_registrations').where({ tournamentId }).get()).data;
  // 1. 生成所有对阵
  const matches = tournament.format === 'regular'
    ? generateRoundRobin(regs, tournament.config.totalRounds || 4)
    : generateKnockout(regs, tournament.config.eliminationType || 'single');
  // 2. 把对阵塞到 grid
  const result = schedule(matches, tournament.courtTimeGrid);
  // 3. 写入 tournament_brackets
  await writeBackBrackets(tournamentId, result.scheduled);
  return { success: true, data: result };
}

async function writeBackBrackets(tournamentId, scheduledMatches) {
  // 按 round 分组
  const byRound = {};
  scheduledMatches.forEach(m => {
    if (!byRound[m.round]) byRound[m.round] = [];
    byRound[m.round].push(m);
  });
  for (const [round, matches] of Object.entries(byRound)) {
    await db.collection('tournament_brackets').add({
      data: {
        _id: `bracket_${tournamentId}_round_${round}`,
        tournamentId,
        round: Number(round),
        matches,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    }).catch(() => {/* 如果已存在则跳过；后期改成 upsert */});
  }
}
```

- [ ] **Step 1.4 commit**

```bash
git add cloudfunctions/scheduler-engine/
git commit -m "feat(scheduler-engine): 云函数骨架 + jest"
```

---

## Task 2 · constraints.js · 约束判断纯函数（TDD）

**Files:**
- Create: `cloudfunctions/scheduler-engine/lib/__tests__/constraints.test.js`
- Create: `cloudfunctions/scheduler-engine/lib/constraints.js`

- [ ] **Step 2.1 写失败测试**

```js
const { isPlayerFree, hasRestBetween } = require('../constraints');

describe('isPlayerFree', () => {
  test('player 在该 slot 没有其他比赛 → free', () => {
    const assigned = [];
    expect(isPlayerFree('m1', 's_0800', assigned)).toBe(true);
  });

  test('player 在该 slot 已有比赛 → not free', () => {
    const assigned = [{ slotId: 's_0800', playerIds: ['m1', 'm2'] }];
    expect(isPlayerFree('m1', 's_0800', assigned)).toBe(false);
  });

  test('player 在另一 slot 有比赛 → 当前 slot 仍 free', () => {
    const assigned = [{ slotId: 's_0830', playerIds: ['m1', 'm2'] }];
    expect(isPlayerFree('m1', 's_0800', assigned)).toBe(true);
  });
});

describe('hasRestBetween', () => {
  const allSlots = [
    { slotId: 's_0800', start: '2026-05-25T08:00:00+08:00' },
    { slotId: 's_0820', start: '2026-05-25T08:20:00+08:00' },
    { slotId: 's_0840', start: '2026-05-25T08:40:00+08:00' },
    { slotId: 's_0900', start: '2026-05-25T09:00:00+08:00' }
  ];

  test('player 上一场在 0800，下一场在 0840 → 中间隔了 1 档 → rest 满足', () => {
    const assigned = [{ slotId: 's_0800', playerIds: ['m1'] }];
    expect(hasRestBetween('m1', 's_0840', assigned, allSlots)).toBe(true);
  });

  test('player 上一场在 0800，下一场在 0820 → 紧挨 → rest 不满足', () => {
    const assigned = [{ slotId: 's_0800', playerIds: ['m1'] }];
    expect(hasRestBetween('m1', 's_0820', assigned, allSlots)).toBe(false);
  });

  test('没有上一场 → rest 满足', () => {
    expect(hasRestBetween('m1', 's_0800', [], allSlots)).toBe(true);
  });
});
```

- [ ] **Step 2.2 跑测试 — 应失败**

```bash
cd cloudfunctions/scheduler-engine && npx jest constraints
```

- [ ] **Step 2.3 实现 constraints.js**

```js
function isPlayerFree(playerId, slotId, assignedMatches) {
  return !assignedMatches.some(m =>
    m.slotId === slotId && m.playerIds.includes(playerId)
  );
}

function hasRestBetween(playerId, slotId, assignedMatches, allSlots) {
  const playerMatches = assignedMatches.filter(m => m.playerIds.includes(playerId));
  if (playerMatches.length === 0) return true;
  const slotIndex = allSlots.findIndex(s => s.slotId === slotId);
  for (const pm of playerMatches) {
    const pmIndex = allSlots.findIndex(s => s.slotId === pm.slotId);
    if (Math.abs(slotIndex - pmIndex) === 1) return false;  // 紧挨上一/下一档
  }
  return true;
}

module.exports = { isPlayerFree, hasRestBetween };
```

- [ ] **Step 2.4 跑测试 — 应全过**

- [ ] **Step 2.5 commit**

```bash
git add cloudfunctions/scheduler-engine/lib/
git commit -m "feat(scheduler-engine): constraints 约束函数 + 单测"
```

---

## Task 3 · greedy.js · 贪心分配算法（TDD）

**Files:**
- Create: `cloudfunctions/scheduler-engine/lib/__tests__/greedy.test.js`
- Create: `cloudfunctions/scheduler-engine/lib/greedy.js`

- [ ] **Step 3.1 写失败测试**

```js
const { schedule } = require('../greedy');

const grid = {
  matchDuration: 20,
  courts: [
    { courtId: 'c1', name: '1号' },
    { courtId: 'c2', name: '2号' }
  ],
  slots: [
    { slotId: 's_0800', start: '2026-05-25T08:00:00+08:00', end: '2026-05-25T08:20:00+08:00', availableCourtIds: ['c1', 'c2'] },
    { slotId: 's_0820', start: '2026-05-25T08:20:00+08:00', end: '2026-05-25T08:40:00+08:00', availableCourtIds: ['c1', 'c2'] }
  ]
};

describe('schedule', () => {
  test('2 场比赛 / 4 个格 → 全部安排', () => {
    const matches = [
      { matchId: 'm1', round: 1, playerIds: ['p1', 'p2'] },
      { matchId: 'm2', round: 1, playerIds: ['p3', 'p4'] }
    ];
    const r = schedule(matches, grid);
    expect(r.unscheduled).toEqual([]);
    expect(r.scheduled).toHaveLength(2);
    expect(r.scheduled[0].slotId).toBeDefined();
    expect(r.scheduled[0].courtId).toBeDefined();
  });

  test('5 场比赛 / 4 个格 → 1 场没排上', () => {
    const matches = [
      { matchId: 'm1', round: 1, playerIds: ['p1', 'p2'] },
      { matchId: 'm2', round: 1, playerIds: ['p3', 'p4'] },
      { matchId: 'm3', round: 2, playerIds: ['p5', 'p6'] },
      { matchId: 'm4', round: 2, playerIds: ['p7', 'p8'] },
      { matchId: 'm5', round: 3, playerIds: ['p9', 'p10'] }
    ];
    const r = schedule(matches, grid);
    expect(r.unscheduled).toHaveLength(1);
    expect(r.scheduled).toHaveLength(4);
  });

  test('同人冲突避免：p1 两场不会在同一 slot', () => {
    const matches = [
      { matchId: 'm1', round: 1, playerIds: ['p1', 'p2'] },
      { matchId: 'm2', round: 2, playerIds: ['p1', 'p3'] }
    ];
    const r = schedule(matches, grid);
    expect(r.scheduled).toHaveLength(2);
    expect(r.scheduled[0].slotId).not.toBe(r.scheduled[1].slotId);
  });

  test('休息约束：p1 两场之间至少隔 1 档', () => {
    // 只有 2 档可用，p1 在两场比赛都出现 → 排不下
    const matches = [
      { matchId: 'm1', round: 1, playerIds: ['p1', 'p2'] },
      { matchId: 'm2', round: 2, playerIds: ['p1', 'p3'] }
    ];
    const onlyTwoSlots = {
      ...grid,
      slots: grid.slots.slice(0, 2)  // s_0800 + s_0820 紧挨着
    };
    const r = schedule(matches, onlyTwoSlots);
    // m1 排在 s_0800（任一 court），m2 应该排不下（s_0820 紧挨）
    expect(r.unscheduled).toContainEqual(expect.objectContaining({ matchId: 'm2' }));
  });

  test('空 matches → 空结果', () => {
    expect(schedule([], grid)).toEqual({ scheduled: [], unscheduled: [] });
  });
});
```

- [ ] **Step 3.2 跑测试 — 应失败**

- [ ] **Step 3.3 实现 greedy.js**

```js
const { isPlayerFree, hasRestBetween } = require('./constraints');

function schedule(matches, grid) {
  if (!matches || matches.length === 0) return { scheduled: [], unscheduled: [] };
  if (!grid || !grid.slots) return { scheduled: [], unscheduled: matches };

  const sortedMatches = [...matches].sort((a, b) => a.round - b.round);
  const assigned = [];
  const unscheduled = [];

  for (const match of sortedMatches) {
    let placed = false;
    for (const slot of grid.slots) {
      for (const courtId of slot.availableCourtIds) {
        const cellTaken = assigned.some(a => a.slotId === slot.slotId && a.courtId === courtId);
        if (cellTaken) continue;

        const allFree = match.playerIds.every(pid => isPlayerFree(pid, slot.slotId, assigned));
        if (!allFree) continue;

        const allRested = match.playerIds.every(pid => hasRestBetween(pid, slot.slotId, assigned, grid.slots));
        if (!allRested) continue;

        assigned.push({
          ...match,
          slotId: slot.slotId,
          courtId,
          scheduledStart: slot.start
        });
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) unscheduled.push(match);
  }

  return { scheduled: assigned, unscheduled };
}

module.exports = { schedule };
```

- [ ] **Step 3.4 跑测试 — 全过**

- [ ] **Step 3.5 commit**

```bash
git add cloudfunctions/scheduler-engine/lib/
git commit -m "feat(scheduler-engine): greedy 分配算法 + 完整单测"
```

---

## Task 4 · round-robin.js · 常规赛配对（每人每轮 1 场）

**Files:**
- Create: `cloudfunctions/scheduler-engine/lib/__tests__/round-robin.test.js`
- Create: `cloudfunctions/scheduler-engine/lib/pairing/round-robin.js`

- [ ] **Step 4.1 写失败测试**

```js
const { generateRoundRobin } = require('../pairing/round-robin');

function regs(ids) {
  return ids.map(id => ({ _id: `reg_${id}`, playerId: id, playerName: id }));
}

describe('generateRoundRobin', () => {
  test('4 人 1 轮 → 2 场', () => {
    const r = generateRoundRobin(regs(['a', 'b', 'c', 'd']), 1);
    expect(r).toHaveLength(2);
    // 每个人在该轮各出现 1 次
    const playerIds = r.flatMap(m => m.playerIds);
    expect(new Set(playerIds).size).toBe(4);
  });

  test('4 人 2 轮 → 4 场，每人每轮各 1 场', () => {
    const r = generateRoundRobin(regs(['a', 'b', 'c', 'd']), 2);
    expect(r).toHaveLength(4);
    const round1 = r.filter(m => m.round === 1);
    const round2 = r.filter(m => m.round === 2);
    expect(round1).toHaveLength(2);
    expect(round2).toHaveLength(2);
  });

  test('奇数人（5 人）报错或留 1 个轮空', () => {
    // 选 5 人 1 轮：2 场 + 1 个轮空（player 'e' 跳过）
    const r = generateRoundRobin(regs(['a', 'b', 'c', 'd', 'e']), 1);
    expect(r).toHaveLength(2);
    const allInRound = r.flatMap(m => m.playerIds);
    expect(allInRound).toHaveLength(4);
  });

  test('matchId 唯一', () => {
    const r = generateRoundRobin(regs(['a', 'b', 'c', 'd']), 2);
    const ids = r.map(m => m.matchId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 4.2 跑测试 — 失败**

- [ ] **Step 4.3 实现 round-robin.js**

```js
function generateRoundRobin(registrations, totalRounds) {
  const matches = [];
  for (let round = 1; round <= totalRounds; round++) {
    const shuffled = [...registrations].sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      const p1 = shuffled[i];
      const p2 = shuffled[i + 1];
      matches.push({
        matchId: `match_r${round}_${Date.now()}_${i}`,
        round,
        playerIds: [p1.playerId, p2.playerId],
        playerNames: [p1.playerName, p2.playerName]
      });
    }
  }
  return matches;
}

module.exports = { generateRoundRobin };
```

- [ ] **Step 4.4 跑测试 — 全过**

- [ ] **Step 4.5 commit**

```bash
git add cloudfunctions/scheduler-engine/lib/
git commit -m "feat(scheduler-engine): 常规赛配对生成（随机+每人每轮1场）"
```

---

## Task 5 · knockout-bracket.js · 淘汰赛签表

**Files:**
- Create: `cloudfunctions/scheduler-engine/lib/__tests__/knockout-bracket.test.js`
- Create: `cloudfunctions/scheduler-engine/lib/pairing/knockout-bracket.js`

**说明**：先实现单败淘汰（single elimination）。双败淘汰（double）留到后续迭代。

- [ ] **Step 5.1 写失败测试**

```js
const { generateKnockout } = require('../pairing/knockout-bracket');

function regs(ids) {
  return ids.map((id, i) => ({ _id: `reg_${id}`, playerId: id, playerName: id, seed: i + 1 }));
}

describe('generateKnockout (single)', () => {
  test('8 人 → 第 1 轮 4 场，第 2 轮 2 场（占位）, 第 3 轮 1 场（占位）', () => {
    const r = generateKnockout(regs(['a','b','c','d','e','f','g','h']), 'single');
    const r1 = r.filter(m => m.round === 1);
    const r2 = r.filter(m => m.round === 2);
    const r3 = r.filter(m => m.round === 3);
    expect(r1).toHaveLength(4);
    expect(r2).toHaveLength(2);
    expect(r3).toHaveLength(1);
  });

  test('4 人 → 第 1 轮 2 场，第 2 轮 1 场（决赛）', () => {
    const r = generateKnockout(regs(['a','b','c','d']), 'single');
    expect(r.filter(m => m.round === 1)).toHaveLength(2);
    expect(r.filter(m => m.round === 2)).toHaveLength(1);
  });

  test('种子布签：1 号种子和 N 号种子在不同半区', () => {
    const r = generateKnockout(regs(['a','b','c','d','e','f','g','h']), 'single');
    const r1 = r.filter(m => m.round === 1);
    // 第 1 场含种子 1，最后一场含种子 8
    const firstMatchPlayers = r1[0].playerIds;
    const lastMatchPlayers = r1[r1.length - 1].playerIds;
    expect(firstMatchPlayers).toContain('a');  // seed 1
    expect(lastMatchPlayers).toContain('h');   // seed 8
  });

  test('非 2^N 人数（6 人）→ 自动加 bye 凑到 8', () => {
    const r = generateKnockout(regs(['a','b','c','d','e','f']), 'single');
    const r1 = r.filter(m => m.round === 1);
    expect(r1).toHaveLength(4);
    const byeMatches = r1.filter(m => m.playerIds.includes('BYE'));
    expect(byeMatches.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 5.2 跑测试 — 失败**

- [ ] **Step 5.3 实现 knockout-bracket.js**

```js
function generateKnockout(registrations, eliminationType) {
  // 仅实现 single elimination，double 后续
  const seeded = [...registrations].sort((a, b) => (a.seed || 999) - (b.seed || 999));

  // 凑到最近的 2^N
  const N = nextPowerOf2(seeded.length);
  while (seeded.length < N) {
    seeded.push({ _id: 'bye', playerId: 'BYE', playerName: 'BYE' });
  }

  // 第 1 轮按种子配对：(1, N), (2, N-1) 等不在同一半区
  // 简化版：把种子按蛇形分到上下半区
  const ordered = standardBracketOrder(N).map(idx => seeded[idx - 1]);

  const matches = [];
  let round1Count = N / 2;
  for (let i = 0; i < round1Count; i++) {
    const p1 = ordered[i * 2];
    const p2 = ordered[i * 2 + 1];
    matches.push({
      matchId: `match_r1_${i + 1}`,
      round: 1,
      position: i + 1,
      playerIds: [p1.playerId, p2.playerId],
      playerNames: [p1.playerName, p2.playerName]
    });
  }

  // 后续轮次：占位（player 待定）
  let prevCount = round1Count;
  let round = 2;
  while (prevCount > 1) {
    const count = prevCount / 2;
    for (let i = 0; i < count; i++) {
      matches.push({
        matchId: `match_r${round}_${i + 1}`,
        round,
        position: i + 1,
        playerIds: ['TBD', 'TBD'],
        playerNames: ['待定', '待定']
      });
    }
    prevCount = count;
    round++;
  }
  return matches;
}

function nextPowerOf2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// 标准 single-elim 布签顺序（1 vs N, 2 vs N-1 不同区）
function standardBracketOrder(N) {
  if (N === 2) return [1, 2];
  const prev = standardBracketOrder(N / 2);
  const result = [];
  for (const x of prev) {
    result.push(x);
    result.push(N + 1 - x);
  }
  return result;
}

module.exports = { generateKnockout };
```

- [ ] **Step 5.4 跑测试 — 全过**

- [ ] **Step 5.5 commit**

```bash
git add cloudfunctions/scheduler-engine/lib/
git commit -m "feat(scheduler-engine): 单败淘汰签表生成"
```

---

## Task 6 · 上传 scheduler-engine 并端到端验证

- [ ] **Step 6.1 上传**

```bash
bash uploadCloudFunction.sh scheduler-engine
```

- [ ] **Step 6.2 在创建赛事的最后一步加触发**

修改 `miniprogram/pages/tournament-edit/index.js` 的 `onFinalSubmit`，在赛事 + 报名都成功之后追加：

```js
// 3. 自动排程
await wx.cloud.callFunction({
  name: 'scheduler-engine',
  data: { action: 'schedule', tournamentId }
});
```

- [ ] **Step 6.3 在工具里跑：创建一个含 4 人 / 2 个场地 / 4 个 slot 的小赛事**

预期：
- tournament_brackets 集合多出几条 round 记录
- 每条 matches[*] 都填了 courtId + scheduledStart
- 如果有 unscheduled，返回结果包含 unscheduled 数组

- [ ] **Step 6.4 commit**

```bash
git add miniprogram/pages/tournament-edit/index.js
git commit -m "feat(tournament-edit): 创建后触发自动排程"
```

---

## Task 7 · tournament-brackets 页面展示场地+时段

**Files:**
- Modify: `miniprogram/pages/tournament-brackets/index.wxml`
- Modify: `miniprogram/pages/tournament-brackets/index.wxss`

- [ ] **Step 7.1 wxml 展示 courtId + 时间**

在每场比赛的卡片中追加：

```xml
<view class="match-card">
  <view class="match-players">
    <text>{{matches.player1.name}} vs {{matches.player2.name}}</text>
  </view>
  <!-- 新增 -->
  <view wx:if="{{matches.courtId}}" class="match-schedule">
    <text class="text-meta">{{matches.scheduledStart | formatTime}}</text>
    <text class="text-meta">·</text>
    <text class="text-meta">{{matches.courtId}}</text>
  </view>
</view>
```

- [ ] **Step 7.2 wxss**

```css
.match-schedule {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
```

- [ ] **Step 7.3 commit**

```bash
git add miniprogram/pages/tournament-brackets/
git commit -m "feat(tournament-brackets): 展示场地与时段信息"
```

---

## Task 8 · tournament-brackets 显示 unscheduled 区块

**Files:**
- Modify: `miniprogram/pages/tournament-brackets/index.js`
- Modify: `miniprogram/pages/tournament-brackets/index.wxml`

- [ ] **Step 8.1 js 加载 unscheduled**

```js
async loadUnscheduled() {
  // 从 tournament_brackets 中找 matches[*] 没有 courtId 的
  const all = (await db.collection('tournament_brackets')
    .where({ tournamentId: this.data.tournamentId })
    .get()).data;
  const unsched = [];
  all.forEach(br => {
    (br.matches || []).forEach(m => {
      if (!m.courtId) unsched.push({ ...m, round: br.round });
    });
  });
  this.setData({ unscheduledMatches: unsched });
}
```

在 onShow / loadData 中调用。

- [ ] **Step 8.2 wxml 顶部加 unscheduled banner**

```xml
<view wx:if="{{unscheduledMatches.length > 0}}" class="warn-banner">
  <text class="text-label color-danger">⚠️ {{unscheduledMatches.length}} 场未排程</text>
  <view wx:for="{{unscheduledMatches}}" wx:key="matchId" class="unsched-item">
    <text>第 {{item.round}} 轮 · {{item.player1.name}} vs {{item.player2.name}}</text>
    <button class="cta-secondary" data-match-id="{{item.matchId}}" bindtap="onManualAssign">手动排</button>
  </view>
  <text class="text-meta">建议：返回创建页加场地/减轮数，或手动给上面比赛分配格子</text>
</view>
```

- [ ] **Step 8.3 wxss**

```css
.warn-banner {
  background: rgba(220, 38, 38, 0.05);
  border: 1rpx solid var(--color-danger);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  margin-bottom: var(--space-4);
}
.unsched-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-2) 0;
  border-bottom: 1rpx solid var(--color-border);
}
```

- [ ] **Step 8.4 手动排程能力（onManualAssign 简化版：弹个 actionsheet 选 court+slot）**

复用现有 `actionSheetShow` 字段。完整 drag-drop UI 可选。

- [ ] **Step 8.5 commit**

```bash
git add miniprogram/pages/tournament-brackets/
git commit -m "feat(tournament-brackets): unscheduled 警告条与手动调整入口"
```

---

## Task 9 · 更新 PROGRESS.md

- [ ] **Step 9.1**

```diff
- | 03 | Phase 4 · Scheduler | ⬜ 待开始 | — | — | — | — |
+ | 03 | Phase 4 · Scheduler | ✅ 已完成 | YYYY-MM-DD | YYYY-MM-DD | <hash> | scheduler-engine 上线，单测覆盖率 95% |
```

进度条 `[████████████░░░░░░░░░░░░] 3/6`，下一个 Phase 改为 `04-phase-2-browse-ui.md`。

- [ ] **Step 9.2 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 4 完成"
```

---

## Self-Review Checklist

- [ ] `cd cloudfunctions/scheduler-engine && npx jest` 覆盖率 ≥ 95%
- [ ] 创建一个 4 人小赛事，scheduler-engine 能正确排程，每场都有 courtId + scheduledStart
- [ ] 故意造一个容量不够的赛事（人多场少），看 unscheduled 警告条能正常显示
- [ ] 淘汰赛签表对种子布签正确（1 号 vs 末号在不同半区）
- [ ] PROGRESS.md 更新
