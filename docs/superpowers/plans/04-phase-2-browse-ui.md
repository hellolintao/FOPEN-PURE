# Phase 2 · 首页 + 排行榜 + 玩家详情 · Implementation Plan

> **执行说明:** 按本文 checkbox（`- [ ]`）逐项推进。页面和组件可并行拆分，但最终需要统一视觉与数据联调。

**Goal:** 让用户看到美观、有冲击力的浏览体验——首页 hero、排行榜（单/双打 + 每周之星）、玩家详情页。

**Architecture:** 新建 `points-engine` 云函数供这些页面调用积分聚合。新建组件库（stat-block / rank-row / brush-stroke-bg / player-card）。新建 `pages/player-detail`。重写 `home / rank / mine`。新建 custom-tab-bar 实现 admin 看到第 3 个"管理"tab。

**Tech Stack:** 微信小程序原生 + Jest

**Spec 引用:** §4 视觉系统、§7.1 页面、§7.2 组件、§7.4 自定义 tabBar、§8 工作流 C/D

**前置条件:** Phase 1 + 3 + 4 完成（积分能从 match-results 聚合，至少有 1 个完整赛事在 DB 里）

**推荐执行方式:** Subagent-driven。多个独立页面/组件适合派子代理并行做。

---

## File Structure

```
miniprogram/
├── components/
│   ├── stat-block/index.{js,wxml,wxss,json}    (新建)
│   ├── rank-row/index.{js,wxml,wxss,json}      (新建)
│   ├── player-card/index.{js,wxml,wxss,json}   (新建)
│   ├── brush-stroke-bg/index.{js,wxml,wxss}    (新建 - SVG 装饰)
│   └── skeleton-loader/index.{js,wxml,wxss}    (新建)
├── custom-tab-bar/
│   └── index.{js,wxml,wxss,json}               (新建 - 5 tab 动态显示)
├── app.json                                    (改 - 启用 custom: true)
├── app.js                                      (改 - globalData 加 isAdmin)
├── pages/
│   ├── home/index.{js,wxml,wxss}               (重写)
│   ├── rank/index.{js,wxml,wxss}               (重写)
│   ├── mine/index.{js,wxml,wxss}               (改 - 套新视觉)
│   └── player-detail/index.{js,wxml,wxss,json} (新建)
└── utils/
    └── format.js                               (新建 - 时间/数字 format)

cloudfunctions/points-engine/                    (新建)
├── index.js
├── lib/calculate.js                            (纯函数)
├── lib/__tests__/calculate.test.js
└── package.json
```

---

## Task 1 · points-engine 云函数（TDD）

**Files:**
- Create: `cloudfunctions/points-engine/`

- [ ] **Step 1.1 创建目录 + package.json + jest（同 Phase 1 模式）**

- [ ] **Step 1.2 写失败测试 `lib/__tests__/calculate.test.js`**

```js
const { calculatePoints, isPointValid } = require('../calculate');

const now = new Date('2026-05-25T10:00:00Z');

const tournament = {
  _id: 't1',
  seasonId: 's2026',
  type: 'singles',
  format: 'regular',
  pointsRules: { win: 100, loss: 20, walkover: 50, bonusByRound: { 1:0, 2:50, 3:100 } }
};

const match = {
  tournamentId: 't1',
  round: 1,
  winnerId: 'p1',
  loserId: 'p2',
  resultStatus: 'confirmed',
  createTime: new Date('2026-05-25T09:00:00Z')
};

describe('calculatePoints', () => {
  test('常规赛胜方 +win', () => {
    const r = calculatePoints(match, tournament);
    expect(r.winner.total).toBe(100);
    expect(r.loser.total).toBe(20);
  });

  test('淘汰赛胜 + bonusByRound', () => {
    const knockout = { ...tournament, format: 'knockout' };
    const round2Match = { ...match, round: 2 };
    const r = calculatePoints(round2Match, knockout);
    expect(r.winner.total).toBe(100 + 50);  // win + bonus[2]
  });

  test('walkover 用 walkover 分数', () => {
    const wo = { ...match, walkover: true };
    const r = calculatePoints(wo, tournament);
    expect(r.winner.total).toBe(50);
  });
});

describe('isPointValid', () => {
  test('当前赛季常规赛积分有效', () => {
    expect(isPointValid({ seasonId: 's2026', format: 'regular', createTime: now }, 's2026', now)).toBe(true);
  });

  test('上赛季常规赛积分失效', () => {
    expect(isPointValid({ seasonId: 's2025', format: 'regular', createTime: now }, 's2026', now)).toBe(false);
  });

  test('淘汰赛 365 天内有效', () => {
    const halfYearAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    expect(isPointValid({ seasonId: 'any', format: 'knockout', createTime: halfYearAgo }, 's2026', now)).toBe(true);
  });

  test('淘汰赛 365 天前失效', () => {
    const twoYearsAgo = new Date(now.getTime() - 730 * 24 * 60 * 60 * 1000);
    expect(isPointValid({ seasonId: 'any', format: 'knockout', createTime: twoYearsAgo }, 's2026', now)).toBe(false);
  });
});
```

- [ ] **Step 1.3 跑测试 - 失败**

- [ ] **Step 1.4 实现 `lib/calculate.js`**

```js
function calculatePoints(match, tournament) {
  const r = tournament.pointsRules;
  let winnerTotal, loserTotal;

  if (match.walkover) {
    winnerTotal = r.walkover;
    loserTotal = 0;
  } else {
    winnerTotal = r.win;
    loserTotal = r.loss;
  }

  if (tournament.format === 'knockout') {
    const bonus = (r.bonusByRound && r.bonusByRound[match.round]) || 0;
    winnerTotal += bonus;
  }

  return {
    winner: { base: r.win, bonus: winnerTotal - r.win, total: winnerTotal },
    loser: { base: r.loss, bonus: 0, total: loserTotal }
  };
}

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function isPointValid(matchMeta, currentSeasonId, now = new Date()) {
  if (matchMeta.format === 'regular') {
    return matchMeta.seasonId === currentSeasonId;
  }
  if (matchMeta.format === 'knockout') {
    const created = new Date(matchMeta.createTime).getTime();
    return now.getTime() - created <= ONE_YEAR_MS;
  }
  return false;
}

module.exports = { calculatePoints, isPointValid };
```

- [ ] **Step 1.5 测试全过**

- [ ] **Step 1.6 写 index.js**

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const { calculatePoints, isPointValid } = require('./lib/calculate');

exports.main = async (event) => {
  const { action } = event;
  if (action === 'rankList') return await rankList(event);
  if (action === 'playerStats') return await playerStats(event);
  if (action === 'recalculateMatch') return await recalculateMatch(event);
  return { success: false, error: { code: 'UNKNOWN_ACTION', message: action } };
};

async function rankList({ type = 'singles', currentSeasonId }) {
  // 拉所有 confirmed match-results
  const matches = (await db.collection('match_results')
    .where({ resultStatus: 'confirmed' })
    .get()).data;
  // 拉 tournaments（取 format/seasonId/pointsRules）
  const tournaments = await fetchTournaments(matches.map(m => m.tournamentId));
  // 聚合积分
  const map = {};
  for (const m of matches) {
    const t = tournaments[m.tournamentId];
    if (!t || t.type !== type) continue;
    const meta = { seasonId: t.seasonId, format: t.format, createTime: m.createTime };
    if (!isPointValid(meta, currentSeasonId)) continue;
    // m.pointsAwarded 应该已被 result-reconcile 写入
    const award = m.pointsAwarded || {};
    addPoints(map, m.winnerId, award.winner?.total || 0, true);
    addPoints(map, m.loserId, award.loser?.total || 0, false);
  }
  // 取出会员信息
  const memberIds = Object.keys(map);
  if (memberIds.length === 0) return { success: true, data: { rankList: [] } };
  const members = (await db.collection('members').where({ _id: _.in(memberIds) }).get()).data;
  const list = members.map(mb => ({
    _id: mb._id,
    name: mb.name,
    avatarUrl: mb.avatarUrl,
    ...map[mb._id]
  })).sort((a, b) => b.totalPoints - a.totalPoints);
  return { success: true, data: { rankList: list } };
}

function addPoints(map, id, pts, isWin) {
  if (!id) return;
  if (!map[id]) map[id] = { totalPoints: 0, winCount: 0, lossCount: 0 };
  map[id].totalPoints += pts;
  if (isWin) map[id].winCount++; else map[id].lossCount++;
}

async function fetchTournaments(ids) {
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return {};
  const list = (await db.collection('tournaments').where({ _id: _.in(unique) }).get()).data;
  const map = {};
  list.forEach(t => { map[t._id] = t; });
  return map;
}

async function playerStats({ playerId, currentSeasonId }) {
  // 拉该 player 参与的所有 confirmed matches
  const winMatches = (await db.collection('match_results').where({ winnerId: playerId, resultStatus: 'confirmed' }).get()).data;
  const loseMatches = (await db.collection('match_results').where({ loserId: playerId, resultStatus: 'confirmed' }).get()).data;
  const all = [...winMatches, ...loseMatches];
  const tournaments = await fetchTournaments(all.map(m => m.tournamentId));

  const stats = { singles: { winCount: 0, lossCount: 0, totalPoints: 0 }, doubles: { winCount: 0, lossCount: 0, totalPoints: 0 } };
  const recent = all.sort((a, b) => new Date(b.createTime) - new Date(a.createTime)).slice(0, 10);

  for (const m of all) {
    const t = tournaments[m.tournamentId];
    if (!t) continue;
    const meta = { seasonId: t.seasonId, format: t.format, createTime: m.createTime };
    if (!isPointValid(meta, currentSeasonId)) continue;
    const bucket = stats[t.type] || stats.singles;
    const isWin = m.winnerId === playerId;
    if (isWin) bucket.winCount++; else bucket.lossCount++;
    const pts = isWin ? (m.pointsAwarded?.winner?.total || 0) : (m.pointsAwarded?.loser?.total || 0);
    bucket.totalPoints += pts;
  }

  return { success: true, data: { stats, recent } };
}

async function recalculateMatch({ matchId }) {
  const match = (await db.collection('match_results').doc(matchId).get()).data;
  const tournament = (await db.collection('tournaments').doc(match.tournamentId).get()).data;
  const pointsAwarded = calculatePoints(match, tournament);
  await db.collection('match_results').doc(matchId).update({ data: { pointsAwarded } });
  return { success: true, data: { pointsAwarded } };
}
```

- [ ] **Step 1.7 上传**

```bash
cd cloudfunctions/points-engine && npm install && cd ../..
bash uploadCloudFunction.sh points-engine
```

- [ ] **Step 1.8 commit**

```bash
git add cloudfunctions/points-engine/
git commit -m "feat(points-engine): 积分聚合云函数 + 单测"
```

---

## Task 2 · 组件库 · stat-block

**Files:**
- Create: `miniprogram/components/stat-block/index.{js,wxml,wxss,json}`

- [ ] **Step 2.1 json**

```json
{ "component": true }
```

- [ ] **Step 2.2 wxml**

```xml
<view class="stat-block">
  <text class="text-stat">{{value}}</text>
  <text class="text-label">{{label}}</text>
</view>
```

- [ ] **Step 2.3 wxss**

```css
.stat-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-3);
}
.stat-block .text-stat {
  font-size: 48rpx;
}
```

- [ ] **Step 2.4 js**

```js
Component({
  properties: {
    value: String,
    label: String
  }
});
```

- [ ] **Step 2.5 commit**

```bash
git add miniprogram/components/stat-block/
git commit -m "feat(components): stat-block 巨型数据展示"
```

---

## Task 3 · 组件库 · rank-row

**Files:**
- Create: `miniprogram/components/rank-row/index.{js,wxml,wxss,json}`

- [ ] **Step 3.1 wxml**

```xml
<view class="rank-row {{highlight ? 'highlight' : ''}}" bindtap="onTap">
  <text class="rank-num">{{rank}}</text>
  <image class="avatar" src="{{avatarUrl || '/images/icons/avatar.png'}}" />
  <view class="info flex-1">
    <text class="name">{{name}}</text>
    <text class="text-meta">UTR {{utr || '—'}}</text>
  </view>
  <view class="trend">
    <text wx:if="{{trend > 0}}" class="trend-up">↑ {{trend}}</text>
    <text wx:elif="{{trend < 0}}" class="trend-down">↓ {{-trend}}</text>
    <text wx:else class="text-meta">—</text>
  </view>
</view>
```

- [ ] **Step 3.2 wxss**

```css
.rank-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: #fff;
  border-radius: var(--radius-md);
  border: 1rpx solid var(--color-border);
}
.rank-row.highlight {
  background: var(--color-lime);
  border-color: var(--color-lime);
}
.rank-num {
  font-size: 32rpx;
  font-weight: 800;
  width: 48rpx;
  text-align: center;
}
.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
}
.info .name {
  font-weight: 600;
  font-size: var(--font-title-size);
}
.trend-up { color: var(--color-success); font-weight: 600; }
.trend-down { color: var(--color-danger); font-weight: 600; }
```

- [ ] **Step 3.3 js**

```js
Component({
  properties: {
    rank: Number,
    name: String,
    avatarUrl: String,
    utr: String,
    trend: { type: Number, value: 0 },  // 正数=升 负数=降 0=平
    highlight: Boolean,
    playerId: String
  },
  methods: {
    onTap() {
      this.triggerEvent('tap', { playerId: this.data.playerId });
    }
  }
});
```

- [ ] **Step 3.4 commit**

```bash
git add miniprogram/components/rank-row/
git commit -m "feat(components): rank-row 排名条目组件"
```

---

## Task 4 · 组件库 · brush-stroke-bg（SVG 装饰）

**Files:**
- Create: `miniprogram/components/brush-stroke-bg/index.{wxml,wxss,js}`

- [ ] **Step 4.1 wxml**

```xml
<view class="brush-stroke">
  <view class="stroke-svg" style="background-image: url('data:image/svg+xml;utf8,{{svgEncoded}}')"></view>
</view>
```

- [ ] **Step 4.2 wxss**

```css
.brush-stroke {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}
.stroke-svg {
  width: 200%;
  height: 100%;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: right center;
  opacity: 0.6;
  transform: rotate(-8deg);
}
```

- [ ] **Step 4.3 js — 内置 SVG 字符串**

```js
const SVG = `<svg viewBox='0 0 200 100' xmlns='http://www.w3.org/2000/svg'><path d='M10,60 Q40,20 80,40 T180,50' stroke='%23BEE645' stroke-width='40' fill='none' stroke-linecap='round'/></svg>`;
Component({
  data: { svgEncoded: SVG }
});
```

- [ ] **Step 4.4 commit**

```bash
git add miniprogram/components/brush-stroke-bg/
git commit -m "feat(components): brush-stroke-bg 装饰元素"
```

---

## Task 5 · 自定义 tabBar

**Files:**
- Create: `miniprogram/custom-tab-bar/index.{js,wxml,wxss,json}`
- Modify: `miniprogram/app.json`
- Modify: `miniprogram/app.js`

- [ ] **Step 5.1 app.json 改 tabBar 加 custom**

```diff
  "tabBar": {
+   "custom": true,
    "color": "#888",
    "selectedColor": "#0A0A0A",
    "backgroundColor": "#FFFFFF",
    "borderStyle": "white",
    "list": [
      { "pagePath": "pages/home/index", "text": "首页", ... },
      { "pagePath": "pages/match/index", "text": "赛事", ... },
+     { "pagePath": "pages/manage/index", "text": "管理", ... },
      { "pagePath": "pages/rank/index", "text": "排行", ... },
      { "pagePath": "pages/mine/index", "text": "我的", ... }
    ]
  }
```

注：list 仍要列出 5 个（小程序要求），custom tabBar 会自己决定显示几个。

- [ ] **Step 5.2 app.js 加 globalData.isAdmin + checkAdmin**

```js
App({
  globalData: { isAdmin: false, currentMember: null },

  onLaunch() {
    wx.cloud.init({ env: 'YOUR_ENV', traceUser: true });
    this.refreshIdentity();
  },

  async refreshIdentity() {
    try {
      const res = await wx.cloud.callFunction({ name: 'members', data: { action: 'get' } });
      const member = res.result?.data?.[0];
      this.globalData.currentMember = member || null;
      this.globalData.isAdmin = !!(member && member.admin);
      // 通知所有 page 刷新 tabBar
      const pages = getCurrentPages();
      const last = pages[pages.length - 1];
      if (last && last.getTabBar) {
        const tabBar = last.getTabBar();
        if (tabBar) tabBar.refresh();
      }
    } catch (err) {
      this.globalData.isAdmin = false;
    }
  }
});
```

- [ ] **Step 5.3 custom-tab-bar/index.json**

```json
{ "component": true }
```

- [ ] **Step 5.4 custom-tab-bar/index.js**

```js
Component({
  data: {
    selected: 0,
    list: [],
    isAdmin: false
  },

  attached() {
    this.refresh();
  },

  methods: {
    refresh() {
      const isAdmin = getApp().globalData.isAdmin;
      const baseList = [
        { pagePath: '/pages/home/index',  text: '首页', icon: 'home' },
        { pagePath: '/pages/match/index', text: '赛事', icon: 'flag' },
        { pagePath: '/pages/manage/index', text: '管理', icon: 'cog', adminOnly: true },
        { pagePath: '/pages/rank/index',  text: '排行', icon: 'trophy' },
        { pagePath: '/pages/mine/index',  text: '我的', icon: 'user' }
      ];
      const list = baseList.filter(item => !item.adminOnly || isAdmin);
      this.setData({ list, isAdmin });
    },

    onTap(e) {
      const idx = e.currentTarget.dataset.index;
      const item = this.data.list[idx];
      wx.switchTab({ url: item.pagePath });
      this.setData({ selected: idx });
    }
  }
});
```

- [ ] **Step 5.5 custom-tab-bar/index.wxml**

```xml
<view class="tab-bar">
  <view
    wx:for="{{list}}" wx:key="pagePath"
    class="tab {{selected === index ? 'on' : ''}}"
    data-index="{{index}}"
    bindtap="onTap"
  >
    <text class="tab-icon">{{item.icon}}</text>
    <text class="tab-text">{{item.text}}</text>
  </view>
</view>
```

- [ ] **Step 5.6 custom-tab-bar/index.wxss**

```css
.tab-bar {
  display: flex;
  height: 120rpx;
  background: #fff;
  border-top: 1rpx solid var(--color-border);
  padding-bottom: env(safe-area-inset-bottom);
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 100;
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  color: var(--color-muted);
}
.tab.on {
  color: var(--color-ink);
  font-weight: 700;
}
.tab-icon {
  font-size: 36rpx;
  /* 后续替换为真实 icon image */
}
.tab-text {
  font-size: 22rpx;
}
```

- [ ] **Step 5.7 commit**

```bash
git add miniprogram/custom-tab-bar/ miniprogram/app.json miniprogram/app.js
git commit -m "feat(tab-bar): 自定义 tabBar，管理 tab 仅 admin 可见"
```

---

## Task 6 · 重写 home 页面

**Files:**
- Modify: `miniprogram/pages/home/index.{js,wxml,wxss}`

- [ ] **Step 6.1 js 加载数据**

```js
Page({
  data: {
    currentMember: null,
    upcomingMatch: null,
    myStats: { matches: 0, wins: 0, winRate: 0 }
  },

  async onShow() {
    await this.loadHome();
  },

  async loadHome() {
    const app = getApp();
    const member = app.globalData.currentMember;
    if (!member) return;
    this.setData({ currentMember: member });

    // 拉个人 stats
    const stats = await wx.cloud.callFunction({
      name: 'points-engine',
      data: { action: 'playerStats', playerId: member._id, currentSeasonId: this._getCurrentSeasonId() }
    });
    const s = stats.result?.data?.stats?.singles || {};
    const total = (s.winCount || 0) + (s.lossCount || 0);
    const winRate = total > 0 ? Math.round((s.winCount / total) * 100) : 0;
    this.setData({
      myStats: { matches: total, wins: s.winCount || 0, winRate }
    });

    // 拉即将开始的比赛
    await this.loadUpcomingMatch(member._id);
  },

  async loadUpcomingMatch(playerId) {
    // 简化：从 tournament_brackets 找此 player 最近一场未开始的比赛
    // 完整实现可后续优化
  },

  _getCurrentSeasonId() {
    // 假设按自然年命名
    return `s${new Date().getFullYear()}`;
  }
});
```

- [ ] **Step 6.2 wxml**

```xml
<view class="home-page">
  <!-- 欢迎条 -->
  <view class="greeting">
    <view class="avatar-row">
      <image class="user-avatar" src="{{currentMember.avatarUrl || '/images/icons/avatar.png'}}" />
      <view>
        <text class="text-h2">你好, {{currentMember.name}}</text>
        <text class="text-meta">FOPEN 网球俱乐部</text>
      </view>
    </view>
  </view>

  <!-- Hero 标语 -->
  <view class="hero">
    <brush-stroke-bg></brush-stroke-bg>
    <text class="text-display">
      PLAY.{'\n'}COMPETE.{'\n'}IMPROVE.
    </text>
  </view>

  <!-- Upcoming match -->
  <view wx:if="{{upcomingMatch}}" class="card-hero" bindtap="onUpcomingTap">
    <text class="text-label">UPCOMING MATCH</text>
    <text class="text-h2">{{upcomingMatch.tournamentName}}</text>
    <view class="meta-row">
      <text class="text-meta">{{upcomingMatch.scheduledStart}}</text>
      <text class="text-meta">·</text>
      <text class="text-meta">{{upcomingMatch.courtName}}</text>
    </view>
  </view>

  <!-- Quick actions -->
  <view class="section">
    <text class="text-label">QUICK ACTIONS</text>
    <view class="actions-grid">
      <view class="action-tile" bindtap="onQuickAction" data-action="match">
        <text>赛事</text>
      </view>
      <view class="action-tile" bindtap="onQuickAction" data-action="rank">
        <text>排行</text>
      </view>
      <view class="action-tile" bindtap="onQuickAction" data-action="my-match">
        <text>我的比赛</text>
      </view>
      <view wx:if="{{isAdmin}}" class="action-tile" bindtap="onQuickAction" data-action="create">
        <text>创建赛事</text>
      </view>
    </view>
  </view>

  <!-- My stats -->
  <view class="section">
    <text class="text-label">MY STATS</text>
    <view class="stats-grid">
      <stat-block value="{{myStats.matches}}" label="MATCHES"></stat-block>
      <stat-block value="{{myStats.wins}}" label="WINS"></stat-block>
      <stat-block value="{{myStats.winRate}}%" label="WIN RATE"></stat-block>
    </view>
  </view>
</view>
```

- [ ] **Step 6.3 wxss**

```css
.home-page {
  padding: var(--space-5);
  padding-bottom: 160rpx;  /* 留 tabBar 空间 */
}
.greeting { margin-bottom: var(--space-5); }
.avatar-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.user-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
}
.hero {
  position: relative;
  padding: var(--space-6) var(--space-5);
  background: var(--color-lime);
  border-radius: var(--radius-lg);
  overflow: hidden;
  margin-bottom: var(--space-5);
}
.hero .text-display {
  position: relative;
  z-index: 1;
  white-space: pre-line;
}
.meta-row {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.section { margin-bottom: var(--space-5); }
.actions-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.action-tile {
  background: var(--color-bg-2);
  border-radius: var(--radius-md);
  padding: var(--space-4) 0;
  text-align: center;
  font-weight: 600;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
  margin-top: var(--space-3);
}
```

- [ ] **Step 6.4 commit**

```bash
git add miniprogram/pages/home/
git commit -m "feat(home): 重写首页（hero + upcoming + actions + stats）"
```

---

## Task 7 · 重写 rank 页面（单/双打 + 每周之星 placeholder）

**Files:**
- Modify: `miniprogram/pages/rank/index.{js,wxml,wxss}`
- Modify: `miniprogram/pages/rank/index.json`

- [ ] **Step 7.1 index.json 注册组件**

```json
{ "usingComponents": { "rank-row": "/components/rank-row/index" } }
```

- [ ] **Step 7.2 js**

```js
Page({
  data: {
    activeTab: 'singles',  // singles | doubles
    rankList: [],
    weeklyStar: null,
    currentMember: null
  },

  async onShow() {
    this.setData({ currentMember: getApp().globalData.currentMember });
    await this.loadRank();
  },

  async loadRank() {
    wx.showLoading({ title: '加载中' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'points-engine',
        data: { action: 'rankList', type: this.data.activeTab, currentSeasonId: `s${new Date().getFullYear()}` }
      });
      this.setData({ rankList: res.result?.data?.rankList || [] });
    } finally {
      wx.hideLoading();
    }
  },

  onTabChange(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab });
    this.loadRank();
  },

  onPlayerTap(e) {
    const { playerId } = e.detail;
    wx.navigateTo({ url: `/pages/player-detail/index?id=${playerId}` });
  }
});
```

- [ ] **Step 7.3 wxml**

```xml
<view class="rank-page">
  <view class="header">
    <text class="text-h1">RANKINGS</text>
  </view>

  <view class="tabs">
    <view
      class="chip {{activeTab === 'singles' ? 'chip-active' : ''}}"
      data-tab="singles" bindtap="onTabChange"
    >SINGLES</view>
    <view
      class="chip {{activeTab === 'doubles' ? 'chip-active' : ''}}"
      data-tab="doubles" bindtap="onTabChange"
    >DOUBLES</view>
  </view>

  <!-- 每周之星 hero card (Phase 6 接入真实数据，此处先放 #1) -->
  <view wx:if="{{rankList[0]}}" class="card-hero star-card">
    <text class="text-label">RANK #1</text>
    <text class="text-h2">{{rankList[0].name}}</text>
    <text class="text-meta">{{rankList[0].totalPoints}} 分</text>
  </view>

  <view class="list">
    <rank-row
      wx:for="{{rankList}}" wx:key="_id"
      wx:if="{{index > 0}}"
      rank="{{index + 1}}"
      name="{{item.name}}"
      avatar-url="{{item.avatarUrl}}"
      utr="{{item.totalPoints}}"
      player-id="{{item._id}}"
      bind:tap="onPlayerTap"
    />
  </view>
</view>
```

- [ ] **Step 7.4 wxss**

```css
.rank-page { padding: var(--space-5); padding-bottom: 160rpx; }
.header { margin-bottom: var(--space-4); }
.tabs { display: flex; gap: var(--space-2); margin-bottom: var(--space-5); }
.star-card {
  margin-bottom: var(--space-4);
  text-align: left;
}
.list { display: flex; flex-direction: column; gap: var(--space-2); }
```

- [ ] **Step 7.5 commit**

```bash
git add miniprogram/pages/rank/
git commit -m "feat(rank): 重写排行榜（单/双打 + #1 hero）"
```

---

## Task 8 · 新建 player-detail 页面

**Files:**
- Create: `miniprogram/pages/player-detail/index.{js,wxml,wxss,json}`
- Modify: `miniprogram/app.json` (注册新页面)

- [ ] **Step 8.1 在 app.json 的 pages 数组末尾加 `"pages/player-detail/index"`**

- [ ] **Step 8.2 json**

```json
{
  "usingComponents": {
    "stat-block": "/components/stat-block/index"
  },
  "navigationBarTitleText": "球员详情"
}
```

- [ ] **Step 8.3 js**

```js
Page({
  data: {
    playerId: '',
    player: null,
    stats: null,
    recent: [],
    headToHead: []
  },

  async onLoad(query) {
    const playerId = query.id;
    this.setData({ playerId });
    await this.loadAll();
  },

  async loadAll() {
    const [playerRes, statsRes] = await Promise.all([
      wx.cloud.callFunction({ name: 'members', data: { action: 'getById', _id: this.data.playerId } }),
      wx.cloud.callFunction({ name: 'points-engine', data: { action: 'playerStats', playerId: this.data.playerId, currentSeasonId: `s${new Date().getFullYear()}` } })
    ]);
    this.setData({
      player: playerRes.result?.data?.[0] || null,
      stats: statsRes.result?.data?.stats || null,
      recent: statsRes.result?.data?.recent || []
    });
  }
});
```

- [ ] **Step 8.4 wxml**

```xml
<view class="player-page">
  <view wx:if="{{player}}">
    <view class="hero-row">
      <image class="big-avatar" src="{{player.avatarUrl || '/images/icons/avatar.png'}}" />
      <view>
        <text class="text-h1">{{player.name}}</text>
        <text class="text-meta">{{player.playStyle || '打法未知'}}</text>
      </view>
    </view>

    <view wx:if="{{player.playStyleNote}}" class="card">
      <text class="text-label">关于</text>
      <text class="text-body">{{player.playStyleNote}}</text>
    </view>

    <view class="section">
      <text class="text-label">SINGLES</text>
      <view class="stats-grid">
        <stat-block value="{{stats.singles.winCount + stats.singles.lossCount}}" label="MATCHES"></stat-block>
        <stat-block value="{{stats.singles.winCount}}" label="WINS"></stat-block>
        <stat-block value="{{stats.singles.totalPoints}}" label="POINTS"></stat-block>
      </view>
    </view>

    <view class="section">
      <text class="text-label">DOUBLES</text>
      <view class="stats-grid">
        <stat-block value="{{stats.doubles.winCount + stats.doubles.lossCount}}" label="MATCHES"></stat-block>
        <stat-block value="{{stats.doubles.winCount}}" label="WINS"></stat-block>
        <stat-block value="{{stats.doubles.totalPoints}}" label="POINTS"></stat-block>
      </view>
    </view>

    <view class="section">
      <text class="text-label">RECENT MATCHES</text>
      <view wx:for="{{recent}}" wx:key="_id" class="recent-item">
        <text class="text-body">{{item.winnerName}} vs {{item.loserName}}</text>
        <text class="text-meta">第 {{item.round}} 轮</text>
      </view>
    </view>
  </view>
</view>
```

- [ ] **Step 8.5 wxss**

```css
.player-page { padding: var(--space-5); padding-bottom: 160rpx; }
.hero-row { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-5); }
.big-avatar { width: 160rpx; height: 160rpx; border-radius: 50%; border: 4rpx solid var(--color-lime); }
.section { margin-top: var(--space-5); }
.stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); margin-top: var(--space-3); }
.recent-item {
  display: flex;
  justify-content: space-between;
  padding: var(--space-3) 0;
  border-bottom: 1rpx solid var(--color-border);
}
```

- [ ] **Step 8.6 members 云函数加 getById action**

修改 `cloudfunctions/members/index.js`：

```js
case 'getById': {
  return await collection.where({ _id }).get();
}
```

上传：`bash uploadCloudFunction.sh members`

- [ ] **Step 8.7 commit**

```bash
git add miniprogram/pages/player-detail/ miniprogram/app.json cloudfunctions/members/index.js
git commit -m "feat(player-detail): 玩家详情页 + members.getById"
```

---

## Task 9 · 改造 mine 页面套新视觉

**Files:**
- Modify: `miniprogram/pages/mine/index.{js,wxml,wxss}`

- [ ] **Step 9.1 wxml 用 hero card + stats 风格**

```xml
<view class="mine-page">
  <view wx:if="{{isLogin}}">
    <view class="card-hero">
      <image class="big-avatar" src="{{userInfo.avatarUrl}}" />
      <text class="text-h2">{{userInfo.name}}</text>
      <text class="text-meta">{{totalPoints}} 分</text>
    </view>

    <view class="actions">
      <button class="cta-secondary" bindtap="onEditProfile">编辑资料</button>
      <button class="cta-secondary" bindtap="onMyMatches">我的比赛</button>
      <button class="cta-secondary" bindtap="onSettings">设置</button>
    </view>
  </view>

  <view wx:else class="empty-state">
    <text class="text-h2">未登录</text>
    <button class="cta-primary" bindtap="onRegister">立即注册</button>
  </view>
</view>
```

- [ ] **Step 9.2 wxss 调整**

```css
.mine-page { padding: var(--space-5); padding-bottom: 160rpx; }
.mine-page .card-hero { text-align: center; padding: var(--space-6); }
.mine-page .big-avatar { width: 160rpx; height: 160rpx; border-radius: 50%; margin-bottom: var(--space-4); }
.actions { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-5); }
.actions button { width: 100%; }
```

- [ ] **Step 9.3 commit**

```bash
git add miniprogram/pages/mine/
git commit -m "feat(mine): 套新视觉"
```

---

## Task 10 · 更新 PROGRESS.md

- [ ] **Step 10.1**

```diff
- | 04 | Phase 2 · Browse UI | ⬜ 待开始 | — | — | — | — |
+ | 04 | Phase 2 · Browse UI | ✅ 已完成 | YYYY-MM-DD | YYYY-MM-DD | <hash> | home/rank/player-detail/mine 全面重写 + custom tabBar |
```

进度条 `[████████████████░░░░░░░░] 4/6`，下一个 Phase 改为 `05-phase-5-result-reconcile.md`。

- [ ] **Step 10.2 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 2 完成"
```

---

## Self-Review Checklist

- [ ] `cd cloudfunctions/points-engine && npx jest` 全过
- [ ] 在工具里打开首页，能看到 hero / upcoming / quick actions / stats
- [ ] 排行榜单/双打 tab 切换正常，#1 hero 高亮
- [ ] 玩家详情页能从排行榜点进
- [ ] 管理员视角 tabBar 多一个"管理"
- [ ] 普通会员视角 tabBar 是 4 个
- [ ] PROGRESS.md 更新
