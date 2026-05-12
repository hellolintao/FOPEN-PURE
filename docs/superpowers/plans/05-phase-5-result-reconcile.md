# Phase 5 · 录分对账 + 仲裁 + 积分计算 · Implementation Plan

> **执行说明:** 按本文 checkbox（`- [ ]`）逐项推进。状态机任务适合先用纯函数 TDD 锁定行为，再接云函数和页面。

**Goal:** 实现完整的录分对账闭环——玩家提交、双方比对自动确认、不一致进入管理员仲裁、确认后触发 points-engine 计算积分。

**Architecture:** 新建 `result-reconcile` 云函数作为状态机入口。新建玩家侧录分页 `result-submit`。改造 `manage` 页加仲裁队列。改造 `my-match` 页让玩家能从这里入口录分。

**Tech Stack:** Node.js + Jest（重测试，状态机目标 90% 覆盖率）

**Spec 引用:** §6.2 result-reconcile、§8 工作流 B、§10 错误码、§11.3 测试用例

**前置条件:** Phase 1 + 4 完成（match-results 已有新字段、scheduler-engine 能生成对局）

**推荐执行方式:** Subagent-driven。状态机的 TDD 任务很独立，子代理跑得稳。

---

## File Structure

```
cloudfunctions/result-reconcile/             (新建)
├── index.js
├── lib/
│   ├── state-machine.js                     - 状态机纯函数
│   └── __tests__/state-machine.test.js
└── package.json

miniprogram/
├── pages/
│   ├── result-submit/index.{js,wxml,wxss,json}  (新建)
│   ├── my-match/index.{js,wxml,wxss}            (改 - 加录分入口)
│   └── manage/index.{js,wxml,wxss}              (改 - 加仲裁队列)
└── utils/api.js                                  (新建 - 统一调云函数 + 错误处理)
```

---

## Task 1 · utils/api.js 统一调用工具

**Files:**
- Create: `miniprogram/utils/api.js`

- [ ] **Step 1.1 写 api.js**

```js
// miniprogram/utils/api.js
// 统一调云函数 + 错误信封处理

const ERROR_HANDLERS = {
  PERMISSION_DENIED: () => wx.showToast({ title: '你没有权限执行此操作', icon: 'none' }),
  NOT_AUTHENTICATED: () => {
    wx.showToast({ title: '请先注册', icon: 'none' });
    setTimeout(() => wx.redirectTo({ url: '/pages/setting/index' }), 800);
  },
  RESULT_ALREADY_CONFIRMED: () => wx.showToast({ title: '结果已确认，请联系管理员', icon: 'none' }),
  RESULT_DISPUTED: () => wx.showToast({ title: '与对手提交不一致，已转管理员仲裁', icon: 'none' }),
  DUPLICATE_REGISTRATION: () => wx.showToast({ title: '已报名此赛事', icon: 'none' }),
  VALIDATION_FAILED: (err) => wx.showToast({ title: err.message, icon: 'none' }),
  NETWORK_ERROR: () => wx.showToast({ title: '网络异常，请重试', icon: 'none' }),
  UNKNOWN: (err) => wx.showToast({ title: err.message || '操作失败', icon: 'none' })
};

async function callFunction(name, data) {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    if (res.result && res.result.success === false) {
      const handler = ERROR_HANDLERS[res.result.error?.code] || ERROR_HANDLERS.UNKNOWN;
      handler(res.result.error);
      return null;
    }
    // 兼容老云函数（不返回 { success, data }，直接返回 data）
    return res.result?.data !== undefined ? res.result.data : res.result;
  } catch (err) {
    ERROR_HANDLERS.NETWORK_ERROR();
    return null;
  }
}

module.exports = { callFunction };
```

- [ ] **Step 1.2 commit**

```bash
git add miniprogram/utils/
git commit -m "feat(utils): 统一 callFunction 工具与错误处理"
```

---

## Task 2 · state-machine.js 状态机纯函数（TDD）

**Files:**
- Create: `cloudfunctions/result-reconcile/`
- Create: `cloudfunctions/result-reconcile/lib/__tests__/state-machine.test.js`
- Create: `cloudfunctions/result-reconcile/lib/state-machine.js`

- [ ] **Step 2.1 创建目录 + package.json + jest（同 Phase 1 模式）**

- [ ] **Step 2.2 写失败测试**

```js
const { reconcile } = require('../state-machine');

const match = {
  _id: 'm1',
  players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
  resultStatus: 'pending',
  submissions: []
};

describe('reconcile state machine', () => {
  test('管理员提交 → 立即 confirmed', () => {
    const r = reconcile(match, { submittedBy: 'admin1', role: 'admin', winnerIds: 'p1', score: '6-3,6-4' });
    expect(r.newStatus).toBe('confirmed');
    expect(r.shouldTriggerPoints).toBe(true);
    expect(r.confirmedBy).toBe('admin1');
  });

  test('玩家单方提交，无对手提交 → pending', () => {
    const r = reconcile(match, { submittedBy: 'p1', role: 'player', winnerIds: 'p1', score: '6-3' });
    expect(r.newStatus).toBe('pending');
    expect(r.shouldTriggerPoints).toBe(false);
    expect(r.newSubmissions).toHaveLength(1);
  });

  test('两玩家提交一致 → confirmed', () => {
    const m = { ...match, submissions: [{ submittedBy: 'p1', role: 'player', winnerIds: 'p1', score: '6-3', submittedAt: '...' }] };
    const r = reconcile(m, { submittedBy: 'p2', role: 'player', winnerIds: 'p1', score: '6-3' });
    expect(r.newStatus).toBe('confirmed');
    expect(r.shouldTriggerPoints).toBe(true);
    expect(r.confirmedBy).toBe(null);  // 双方一致 auto
  });

  test('两玩家提交不一致 → disputed', () => {
    const m = { ...match, submissions: [{ submittedBy: 'p1', role: 'player', winnerIds: 'p1', score: '6-3', submittedAt: '...' }] };
    const r = reconcile(m, { submittedBy: 'p2', role: 'player', winnerIds: 'p2', score: '6-4' });
    expect(r.newStatus).toBe('disputed');
    expect(r.shouldTriggerPoints).toBe(false);
  });

  test('已 confirmed 再提交 → 报错', () => {
    const m = { ...match, resultStatus: 'confirmed' };
    expect(() => reconcile(m, { submittedBy: 'p1', role: 'player', winnerIds: 'p1' }))
      .toThrow('RESULT_ALREADY_CONFIRMED');
  });

  test('非参赛玩家提交 → 报错', () => {
    expect(() => reconcile(match, { submittedBy: 'p99', role: 'player', winnerIds: 'p1' }))
      .toThrow('PERMISSION_DENIED');
  });

  test('disputed 状态下管理员仲裁 → confirmed', () => {
    const m = { ...match, resultStatus: 'disputed' };
    const r = reconcile(m, { submittedBy: 'admin1', role: 'admin', winnerIds: 'p1' });
    expect(r.newStatus).toBe('confirmed');
    expect(r.confirmedBy).toBe('admin1');
  });

  test('玩家更新自己的提交（覆盖旧的）', () => {
    const m = { ...match, submissions: [{ submittedBy: 'p1', role: 'player', winnerIds: 'p1', score: '6-3', submittedAt: '...' }] };
    const r = reconcile(m, { submittedBy: 'p1', role: 'player', winnerIds: 'p2', score: '4-6' });
    expect(r.newSubmissions).toHaveLength(1);  // 仍是 1 条（覆盖）
    expect(r.newSubmissions[0].winnerIds).toBe('p2');
  });
});
```

- [ ] **Step 2.3 跑测试 - 失败**

- [ ] **Step 2.4 实现 state-machine.js**

```js
function reconcile(match, submission) {
  // 1. 校验已 confirmed
  if (match.resultStatus === 'confirmed') {
    const err = new Error('RESULT_ALREADY_CONFIRMED');
    err.code = 'RESULT_ALREADY_CONFIRMED';
    throw err;
  }

  // 2. 校验权限
  const playerIds = (match.players || []).map(p => p.id);
  if (submission.role === 'player' && !playerIds.includes(submission.submittedBy)) {
    const err = new Error('PERMISSION_DENIED');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }

  // 3. 管理员路径
  if (submission.role === 'admin') {
    const newSubmissions = [...(match.submissions || []), submission];
    return {
      newStatus: 'confirmed',
      newSubmissions,
      confirmedBy: submission.submittedBy,
      confirmedAt: new Date(),
      winnerIds: submission.winnerIds,
      shouldTriggerPoints: true
    };
  }

  // 4. 玩家路径：覆盖自己之前的提交
  const others = (match.submissions || []).filter(s => s.submittedBy !== submission.submittedBy);
  const newSubmissions = [...others, submission];

  // 5. 如果有多于 1 条玩家提交 → 判断一致性
  const playerSubs = newSubmissions.filter(s => s.role === 'player');
  if (playerSubs.length >= 2) {
    const winners = new Set(playerSubs.map(s => s.winnerIds));
    if (winners.size === 1) {
      return {
        newStatus: 'confirmed',
        newSubmissions,
        confirmedBy: null,
        confirmedAt: new Date(),
        winnerIds: playerSubs[0].winnerIds,
        shouldTriggerPoints: true
      };
    } else {
      return {
        newStatus: 'disputed',
        newSubmissions,
        confirmedBy: null,
        confirmedAt: null,
        winnerIds: null,
        shouldTriggerPoints: false
      };
    }
  }

  // 6. 单方提交，pending
  return {
    newStatus: 'pending',
    newSubmissions,
    confirmedBy: null,
    confirmedAt: null,
    winnerIds: null,
    shouldTriggerPoints: false
  };
}

module.exports = { reconcile };
```

- [ ] **Step 2.5 测试全过**

- [ ] **Step 2.6 commit**

```bash
git add cloudfunctions/result-reconcile/
git commit -m "feat(result-reconcile): 状态机纯函数 + 8 个单测"
```

---

## Task 3 · result-reconcile/index.js 接入

**Files:**
- Modify: `cloudfunctions/result-reconcile/index.js`

- [ ] **Step 3.1 写 index.js**

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const { reconcile } = require('./lib/state-machine');

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { matchId, winnerIds, score, role } = event;

  // 1. 拉 match
  const matchRes = await db.collection('match_results').doc(matchId).get();
  if (!matchRes.data) {
    return { success: false, error: { code: 'NOT_FOUND', message: '比赛不存在' } };
  }
  const match = matchRes.data;

  // 2. 找提交人 _id
  const memberRes = await db.collection('members').where({ openid: OPENID }).get();
  const submitter = memberRes.data?.[0];
  if (!submitter) {
    return { success: false, error: { code: 'NOT_AUTHENTICATED', message: '请先注册' } };
  }

  // 3. role 校验
  const actualRole = (role === 'admin' && submitter.admin) ? 'admin' : 'player';

  // 4. 调状态机
  let result;
  try {
    result = reconcile(match, {
      submittedBy: submitter._id,
      role: actualRole,
      winnerIds,
      score: score || '',
      submittedAt: new Date()
    });
  } catch (err) {
    return { success: false, error: { code: err.code, message: err.message } };
  }

  // 5. 持久化
  const updateData = {
    resultStatus: result.newStatus,
    submissions: result.newSubmissions
  };
  if (result.newStatus === 'confirmed') {
    updateData.confirmedAt = db.serverDate();
    updateData.confirmedBy = result.confirmedBy;
    // 写入 winner/loser id（从 match.players 中找）
    const winnerId = result.winnerIds;
    const loserId = match.players.find(p => p.id !== winnerId)?.id;
    updateData.winnerId = winnerId;
    updateData.loserId = loserId;
    updateData.winnerName = match.players.find(p => p.id === winnerId)?.name || '';
    updateData.loserName = match.players.find(p => p.id === loserId)?.name || '';
  }
  await db.collection('match_results').doc(matchId).update({ data: updateData });

  // 6. 触发 points-engine
  if (result.shouldTriggerPoints) {
    await cloud.callFunction({
      name: 'points-engine',
      data: { action: 'recalculateMatch', matchId }
    });
  }

  return { success: true, data: { resultStatus: result.newStatus } };
};
```

- [ ] **Step 3.2 上传：`bash uploadCloudFunction.sh result-reconcile`**

- [ ] **Step 3.3 commit**

```bash
git add cloudfunctions/result-reconcile/index.js
git commit -m "feat(result-reconcile): 云函数入口接入状态机与 points-engine"
```

---

## Task 4 · 新建 result-submit 页面（玩家录分）

**Files:**
- Create: `miniprogram/pages/result-submit/index.{js,wxml,wxss,json}`
- Modify: `miniprogram/app.json` (注册)

- [ ] **Step 4.1 app.json 加 `"pages/result-submit/index"`**

- [ ] **Step 4.2 json**

```json
{ "navigationBarTitleText": "录入比分" }
```

- [ ] **Step 4.3 js**

```js
const { callFunction } = require('../../utils/api');
Page({
  data: {
    matchId: '',
    match: null,
    selectedWinnerSide: '',  // 'player1' | 'player2'
    score: ''
  },

  async onLoad(query) {
    this.setData({ matchId: query.matchId });
    await this.loadMatch();
  },

  async loadMatch() {
    const res = await wx.cloud.database().collection('match_results').doc(this.data.matchId).get();
    this.setData({ match: res.data });
  },

  onSelectWinner(e) {
    this.setData({ selectedWinnerSide: e.currentTarget.dataset.side });
  },

  onScoreInput(e) {
    this.setData({ score: e.detail.value });
  },

  async onSubmit() {
    if (!this.data.selectedWinnerSide) {
      wx.showToast({ title: '请选择胜方', icon: 'none' });
      return;
    }
    const m = this.data.match;
    const winnerIds = this.data.selectedWinnerSide === 'player1'
      ? m.players[0].id : m.players[1].id;

    const result = await callFunction('result-reconcile', {
      matchId: this.data.matchId,
      winnerIds,
      score: this.data.score,
      role: 'player'
    });

    if (result) {
      const status = result.resultStatus;
      const msg = status === 'confirmed' ? '已确认！' : status === 'disputed' ? '与对手不一致，已转仲裁' : '已提交，等待对方确认';
      wx.showToast({ title: msg, icon: 'success' });
      setTimeout(() => wx.navigateBack(), 1000);
    }
  }
});
```

- [ ] **Step 4.4 wxml**

```xml
<view class="page">
  <view class="header">
    <text class="text-h1">RECORD RESULT</text>
  </view>

  <view wx:if="{{match}}">
    <view class="vs-block">
      <view
        class="player-side {{selectedWinnerSide === 'player1' ? 'on' : ''}}"
        data-side="player1" bindtap="onSelectWinner"
      >
        <text class="text-title">{{match.players[0].name}}</text>
        <text class="text-meta">点击选为胜方</text>
      </view>
      <text class="vs">VS</text>
      <view
        class="player-side {{selectedWinnerSide === 'player2' ? 'on' : ''}}"
        data-side="player2" bindtap="onSelectWinner"
      >
        <text class="text-title">{{match.players[1].name}}</text>
        <text class="text-meta">点击选为胜方</text>
      </view>
    </view>

    <view class="form-row">
      <text class="text-label">比分（可选）</text>
      <input class="form-input" placeholder="6-3, 6-4" value="{{score}}" bindinput="onScoreInput" maxlength="50" />
    </view>

    <button class="cta-primary" bindtap="onSubmit" style="width:100%;margin-top:48rpx">提交</button>
  </view>
</view>
```

- [ ] **Step 4.5 wxss**

```css
.page { padding: var(--space-5); padding-bottom: 160rpx; }
.header { margin-bottom: var(--space-5); }
.vs-block { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-5); }
.player-side {
  flex: 1;
  background: var(--color-bg-2);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: 2rpx solid var(--color-border);
  text-align: center;
}
.player-side.on {
  background: var(--color-lime);
  border-color: var(--color-lime);
}
.vs { font-size: 32rpx; font-weight: 900; color: var(--color-muted); }
.form-row { display: flex; flex-direction: column; gap: var(--space-2); }
.form-input {
  background: var(--color-bg-2);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1rpx solid var(--color-border);
}
```

- [ ] **Step 4.6 commit**

```bash
git add miniprogram/pages/result-submit/ miniprogram/app.json
git commit -m "feat(result-submit): 玩家录分页"
```

---

## Task 5 · 改造 my-match 加录分入口

**Files:**
- Modify: `miniprogram/pages/my-match/index.{js,wxml}`

- [ ] **Step 5.1 wxml 每场比赛卡片末尾加按钮**

```xml
<view wx:for="{{matches}}" wx:key="_id" class="match-card">
  <text>{{item.players[0].name}} vs {{item.players[1].name}}</text>
  <text class="text-meta">第 {{item.round}} 轮 · {{item.scheduledStart}}</text>
  <button
    wx:if="{{item.resultStatus !== 'confirmed'}}"
    class="cta-primary"
    data-match-id="{{item._id}}"
    bindtap="onRecordResult"
  >录入比分</button>
  <text wx:elif="{{item.resultStatus === 'confirmed'}}" class="text-meta">已确认 · 胜方 {{item.winnerName}}</text>
</view>
```

- [ ] **Step 5.2 js**

```js
onRecordResult(e) {
  const matchId = e.currentTarget.dataset.matchId;
  wx.navigateTo({ url: `/pages/result-submit/index?matchId=${matchId}` });
}
```

- [ ] **Step 5.3 commit**

```bash
git add miniprogram/pages/my-match/
git commit -m "feat(my-match): 录分入口接通"
```

---

## Task 6 · 改造 manage 页加仲裁队列

**Files:**
- Modify: `miniprogram/pages/manage/index.{js,wxml,wxss}`

- [ ] **Step 6.1 js 加载 pending/disputed**

```js
const { callFunction } = require('../../utils/api');
Page({
  data: {
    pendingList: [],
    disputedList: []
  },

  async onShow() {
    const db = wx.cloud.database();
    const [p, d] = await Promise.all([
      db.collection('match_results').where({ resultStatus: 'pending', submissions: db.command.size(db.command.gt(0)) }).limit(20).get(),
      db.collection('match_results').where({ resultStatus: 'disputed' }).limit(20).get()
    ]);
    this.setData({
      pendingList: p.data || [],
      disputedList: d.data || []
    });
  },

  async onConfirm(e) {
    const { matchId, winnerId } = e.currentTarget.dataset;
    const r = await callFunction('result-reconcile', {
      matchId,
      winnerIds: winnerId,
      role: 'admin'
    });
    if (r) {
      wx.showToast({ title: '已确认', icon: 'success' });
      this.onShow();
    }
  }
});
```

- [ ] **Step 6.2 wxml**

```xml
<view class="manage-page">
  <view class="header">
    <text class="text-h1">MANAGE</text>
  </view>

  <view class="section">
    <text class="text-label">DISPUTED ({{disputedList.length}})</text>
    <view wx:for="{{disputedList}}" wx:key="_id" class="dispute-card">
      <text class="text-title">{{item.players[0].name}} vs {{item.players[1].name}}</text>
      <text class="text-meta">提交记录：</text>
      <view wx:for="{{item.submissions}}" wx:for-item="sub" wx:key="submittedAt">
        <text class="text-meta">- {{sub.submittedBy}} 说胜方 = {{sub.winnerIds}}</text>
      </view>
      <view class="dispute-actions">
        <button class="cta-secondary" data-match-id="{{item._id}}" data-winner-id="{{item.players[0].id}}" bindtap="onConfirm">{{item.players[0].name}} 胜</button>
        <button class="cta-secondary" data-match-id="{{item._id}}" data-winner-id="{{item.players[1].id}}" bindtap="onConfirm">{{item.players[1].name}} 胜</button>
      </view>
    </view>
  </view>

  <view class="section">
    <text class="text-label">PENDING ({{pendingList.length}})</text>
    <view wx:for="{{pendingList}}" wx:key="_id" class="pending-card">
      <text class="text-title">{{item.players[0].name}} vs {{item.players[1].name}}</text>
      <text class="text-meta">{{item.submissions[0].submittedBy}} 提交了胜方 = {{item.submissions[0].winnerIds}}，等对手确认中</text>
      <button class="cta-secondary" data-match-id="{{item._id}}" data-winner-id="{{item.submissions[0].winnerIds}}" bindtap="onConfirm">代为确认</button>
    </view>
  </view>

  <view class="section">
    <text class="text-label">QUICK ACTIONS</text>
    <button class="cta-secondary" bindtap="onGoCreate">+ 创建新赛事</button>
    <button class="cta-secondary" bindtap="onGoMembers">会员管理</button>
    <button class="cta-secondary" bindtap="onGoSeasons">赛季管理</button>
  </view>
</view>
```

- [ ] **Step 6.3 wxss**

```css
.manage-page { padding: var(--space-5); padding-bottom: 160rpx; }
.dispute-card, .pending-card {
  background: var(--color-bg-2);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-3);
}
.dispute-card { border: 2rpx solid var(--color-danger); }
.pending-card { border: 2rpx solid var(--color-warn); }
.dispute-actions { display: flex; gap: var(--space-3); margin-top: var(--space-3); }
.dispute-actions button { flex: 1; }
```

- [ ] **Step 6.4 commit**

```bash
git add miniprogram/pages/manage/
git commit -m "feat(manage): 仲裁队列 UI"
```

---

## Task 7 · 端到端联调验证

- [ ] **Step 7.1 在工具里跑一次完整闭环**

1. admin 创建一个 4 人小赛事（Phase 3 路径）
2. 让 scheduler 排程（Phase 4 路径）
3. p1（玩家身份）打开 my-match → 录分 → 提交 p1 胜
4. 在云控制台手动改 admin 身份，进 manage 页看 pending 队列
5. 直接代确认 → 进 db 看 resultStatus = confirmed + pointsAwarded 被填
6. 排行榜页面应该看到这场比赛带来的分数

- [ ] **Step 7.2 修任何回归 bug 后 commit**

---

## Task 8 · 更新 PROGRESS.md

- [ ] **Step 8.1**

```diff
- | 05 | Phase 5 · Result Reconcile | ⬜ 待开始 | — | — | — | — |
+ | 05 | Phase 5 · Result Reconcile | ✅ 已完成 | YYYY-MM-DD | YYYY-MM-DD | <hash> | 闭环联通 |
```

进度条 `[████████████████████░░░░] 5/6`，下一个 Phase 改为 `06-phase-6-polish.md`。

- [ ] **Step 8.2 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 5 完成"
```

---

## Self-Review Checklist

- [ ] `cd cloudfunctions/result-reconcile && npx jest` 覆盖率 ≥ 90%
- [ ] 端到端：玩家提交 → admin 确认 → 积分入排行榜
- [ ] 双方一致 auto-confirm 路径走通
- [ ] 双方不一致 disputed 路径走通
- [ ] 已 confirmed 二次提交报错
- [ ] PROGRESS.md 更新
