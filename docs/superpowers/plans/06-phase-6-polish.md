# Phase 6 · 每周之星 + 视觉打磨 + 微交互 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans（推荐 inline 执行，多为视觉打磨小任务）。Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让产品到达上线水准——每周之星定时任务 + 全局微交互 + 装饰元素 + 各种小细节修补。

**Architecture:** 新增 `weekly-star` 定时云函数（每周一 0:30 触发）。给 rank 页接入真实每周之星数据。给所有 tab 切换、CTA 点击、stat 数字加微交互。把 brush-stroke SVG 嵌入到首页 / 排行 hero / 玩家详情 hero。

**Tech Stack:** 微信小程序云开发定时触发器 + WXSS 动画

**Spec 引用:** §4.5 微交互、§6.2 weekly-star、§12 第 6 期

**前置条件:** Phase 1-5 全部完成

**推荐执行方式:** Inline。多为视觉小调整，一个对话内连贯完成更顺。

---

## File Structure

```
cloudfunctions/weekly-star/                  (新建)
├── index.js
├── config.json                              - 定时触发配置
└── package.json

miniprogram/
├── pages/rank/index.{js,wxml}               (改 - 接入真实每周之星)
├── pages/home/index.wxml                    (改 - hero 加 brush-stroke)
├── pages/player-detail/index.wxml           (改 - hero 加 brush-stroke)
├── components/
│   ├── chip-tab/index.{js,wxml,wxss,json}   (新建 - 带滑动指示)
│   └── number-counter/index.{js,wxml,wxss}  (新建 - 数字滚动动画)
└── styles/animations.wxss                   (新建 - 全局动画 keyframes)
```

---

## Task 1 · weekly-star 云函数（定时触发）

**Files:**
- Create: `cloudfunctions/weekly-star/index.js`
- Create: `cloudfunctions/weekly-star/config.json`
- Create: `cloudfunctions/weekly-star/package.json`

- [ ] **Step 1.1 创建目录 + package.json**

同 Phase 1 模式，含 wx-server-sdk + jest。

- [ ] **Step 1.2 config.json 定时配置**

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

每周一 0:30 触发。

- [ ] **Step 1.3 index.js**

```js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  // 算"上一自然周"（周一 0 点 ~ 周日 23:59）
  const now = new Date();
  const todayDow = now.getDay() === 0 ? 7 : now.getDay();
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - (todayDow - 1));
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setMilliseconds(-1);

  const weekId = getWeekId(lastMonday);

  // 拉上周 confirmed match-results
  const matches = (await db.collection('match_results')
    .where({
      resultStatus: 'confirmed',
      confirmedAt: _.gte(lastMonday).and(_.lte(lastSunday))
    })
    .get()).data;

  // 拉对应 tournaments 取 type
  const tIds = Array.from(new Set(matches.map(m => m.tournamentId)));
  const tournaments = tIds.length === 0 ? [] : (await db.collection('tournaments').where({ _id: _.in(tIds) }).get()).data;
  const tMap = {}; tournaments.forEach(t => tMap[t._id] = t);

  // 按 type 聚合积分
  const aggregateByType = (type) => {
    const map = {};
    matches.forEach(m => {
      const t = tMap[m.tournamentId];
      if (!t || t.type !== type) return;
      const wId = m.winnerId, lId = m.loserId;
      const wPts = m.pointsAwarded?.winner?.total || 0;
      const lPts = m.pointsAwarded?.loser?.total || 0;
      if (wId) { map[wId] = (map[wId] || 0) + wPts; }
      if (lId) { map[lId] = (map[lId] || 0) + lPts; }
    });
    let topId = null, topPts = 0;
    Object.entries(map).forEach(([id, pts]) => {
      if (pts > topPts) { topId = id; topPts = pts; }
    });
    return topId ? { memberId: topId, points: topPts } : null;
  };

  const singlesStar = aggregateByType('singles');
  const doublesStar = aggregateByType('doubles');

  const memberIds = [singlesStar?.memberId, doublesStar?.memberId].filter(Boolean);
  let memberMap = {};
  if (memberIds.length > 0) {
    const ms = (await db.collection('members').where({ _id: _.in(memberIds) }).get()).data;
    ms.forEach(m => { memberMap[m._id] = m; });
  }

  const fillName = (star) => {
    if (!star) return null;
    const m = memberMap[star.memberId];
    return { ...star, name: m?.name || '', avatarUrl: m?.avatarUrl || '' };
  };

  const doc = {
    _id: weekId,
    weekStart: lastMonday.toISOString().slice(0, 10),
    weekEnd: lastSunday.toISOString().slice(0, 10),
    singlesStar: fillName(singlesStar),
    doublesStar: fillName(doublesStar),
    computedAt: db.serverDate()
  };

  // upsert
  try { await db.collection('weekly_stars').add({ data: doc }); }
  catch (e) { await db.collection('weekly_stars').doc(weekId).update({ data: doc }); }

  return { success: true, data: doc };
};

function getWeekId(mondayDate) {
  const y = mondayDate.getFullYear();
  const start = new Date(y, 0, 1);
  const diff = Math.floor((mondayDate - start) / 86400000);
  const week = Math.floor(diff / 7) + 1;
  return `ws_${y}_W${String(week).padStart(2, '0')}`;
}
```

- [ ] **Step 1.4 上传：`bash uploadCloudFunction.sh weekly-star`**

- [ ] **Step 1.5 在云开发控制台手动跑一次测试**

进入云函数面板 → weekly-star → 测试。看 weekly_stars 集合是否多一条记录。

- [ ] **Step 1.6 commit**

```bash
git add cloudfunctions/weekly-star/
git commit -m "feat(weekly-star): 定时每周之星计算云函数"
```

---

## Task 2 · rank 页接入真实每周之星

**Files:**
- Modify: `miniprogram/pages/rank/index.{js,wxml}`

- [ ] **Step 2.1 js 加载 weekly star**

在 onShow 中追加：

```js
await this.loadWeeklyStar();
```

新方法：

```js
async loadWeeklyStar() {
  const db = wx.cloud.database();
  const res = await db.collection('weekly_stars').orderBy('weekStart', 'desc').limit(1).get();
  const star = res.data?.[0];
  if (!star) return;
  this.setData({
    weeklyStar: this.data.activeTab === 'singles' ? star.singlesStar : star.doublesStar,
    weeklyStarWeekRange: `${star.weekStart} ~ ${star.weekEnd}`
  });
}
```

在 onTabChange 中追加 `this.loadWeeklyStar();`

- [ ] **Step 2.2 wxml 替换原 #1 card 为真正每周之星**

```xml
<view wx:if="{{weeklyStar}}" class="card-hero star-card">
  <brush-stroke-bg></brush-stroke-bg>
  <view style="position:relative;z-index:1">
    <text class="text-label">每周之星 · {{weeklyStarWeekRange}}</text>
    <view class="star-row">
      <image class="star-avatar" src="{{weeklyStar.avatarUrl || '/images/icons/avatar.png'}}" />
      <view>
        <text class="text-h1">{{weeklyStar.name}}</text>
        <text class="text-meta">本周积分 {{weeklyStar.points}}</text>
      </view>
    </view>
  </view>
</view>
```

- [ ] **Step 2.3 wxss**

```css
.star-card { padding: var(--space-5); position: relative; overflow: hidden; }
.star-row { display: flex; align-items: center; gap: var(--space-4); margin-top: var(--space-3); }
.star-avatar { width: 96rpx; height: 96rpx; border-radius: 50%; border: 3rpx solid #fff; }
```

- [ ] **Step 2.4 注册 brush-stroke-bg 在 rank/index.json**

```json
{
  "usingComponents": {
    "rank-row": "/components/rank-row/index",
    "brush-stroke-bg": "/components/brush-stroke-bg/index"
  }
}
```

- [ ] **Step 2.5 commit**

```bash
git add miniprogram/pages/rank/
git commit -m "feat(rank): 真实每周之星 + brush-stroke 装饰"
```

---

## Task 3 · animations.wxss 全局动画

**Files:**
- Create: `miniprogram/styles/animations.wxss`
- Modify: `miniprogram/app.wxss` (import)

- [ ] **Step 3.1 写 animations.wxss**

```css
/* 全局动画 keyframes */

@keyframes scale-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(0.96); }
}

@keyframes slide-in-up {
  from { transform: translateY(40rpx); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.anim-slide-in {
  animation: slide-in-up 400ms var(--ease-out);
}

.anim-fade-in {
  animation: fade-in 300ms var(--ease-out);
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-bg-3) 0%,
    var(--color-bg-2) 50%,
    var(--color-bg-3) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-md);
}
```

- [ ] **Step 3.2 app.wxss import**

```diff
  @import "/styles/tokens.wxss";
  @import "/styles/base.wxss";
  @import "/styles/utilities.wxss";
+ @import "/styles/animations.wxss";
```

- [ ] **Step 3.3 commit**

```bash
git add miniprogram/styles/animations.wxss miniprogram/app.wxss
git commit -m "feat(styles): 全局动画 keyframes"
```

---

## Task 4 · chip-tab 组件（带滑动指示）

**Files:**
- Create: `miniprogram/components/chip-tab/index.{js,wxml,wxss,json}`

- [ ] **Step 4.1 json**

```json
{ "component": true }
```

- [ ] **Step 4.2 wxml**

```xml
<view class="chip-tab">
  <view
    wx:for="{{items}}" wx:key="value"
    class="chip-item {{value === item.value ? 'active' : ''}}"
    data-value="{{item.value}}"
    bindtap="onTap"
  >
    <text>{{item.label}}</text>
  </view>
</view>
```

- [ ] **Step 4.3 wxss**

```css
.chip-tab {
  display: flex;
  background: var(--color-bg-3);
  border-radius: var(--radius-pill);
  padding: 4rpx;
}
.chip-item {
  flex: 1;
  text-align: center;
  padding: 16rpx 32rpx;
  border-radius: var(--radius-pill);
  font-weight: 600;
  font-size: var(--font-label-size);
  color: var(--color-muted);
  transition: all 200ms var(--ease-spring);
}
.chip-item.active {
  background: var(--color-lime);
  color: var(--color-ink);
  transform: scale(1.02);
}
```

- [ ] **Step 4.4 js**

```js
Component({
  properties: {
    items: Array,  // [{ label, value }]
    value: String
  },
  methods: {
    onTap(e) {
      const value = e.currentTarget.dataset.value;
      this.triggerEvent('change', { value });
      wx.vibrateShort({ type: 'light' });
    }
  }
});
```

- [ ] **Step 4.5 在 rank/home 等页替换原 chip 用法**

修改 rank/index.json：
```json
{ "usingComponents": { "chip-tab": "/components/chip-tab/index", ... } }
```

修改 rank/index.wxml 中的 tabs：
```xml
<chip-tab
  items="{{[{label: 'SINGLES', value: 'singles'}, {label: 'DOUBLES', value: 'doubles'}]}}"
  value="{{activeTab}}"
  bind:change="onTabChange"
/>
```

js 中改 `onTabChange(e) { this.setData({ activeTab: e.detail.value }); this.loadRank(); }`

- [ ] **Step 4.6 commit**

```bash
git add miniprogram/components/chip-tab/ miniprogram/pages/rank/
git commit -m "feat(components): chip-tab 滑动 tab 切换"
```

---

## Task 5 · number-counter 数字滚动动画

**Files:**
- Create: `miniprogram/components/number-counter/index.{js,wxml,wxss}`

- [ ] **Step 5.1 wxml + wxss**

```xml
<text class="number-counter">{{displayValue}}</text>
```

```css
.number-counter {
  font-size: var(--font-stat-size);
  font-weight: var(--font-stat-weight);
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5.2 js（从 0 滚动到 target）**

```js
Component({
  properties: {
    value: { type: Number, value: 0, observer: '_animate' }
  },
  data: { displayValue: 0 },
  methods: {
    _animate(newVal) {
      const start = 0;
      const end = Number(newVal) || 0;
      const duration = 600;
      const startTime = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        this.setData({ displayValue: Math.round(start + (end - start) * eased) });
        if (t < 1) setTimeout(tick, 16);
      };
      tick();
    }
  }
});
```

- [ ] **Step 5.3 替换 stat-block 内的 text 为 number-counter（仅数字字段）**

修改 `components/stat-block/index.json`：
```json
{ "component": true, "usingComponents": { "number-counter": "/components/number-counter/index" } }
```

修改 wxml：
```xml
<view class="stat-block">
  <number-counter value="{{value}}" wx:if="{{isNumber}}"></number-counter>
  <text class="text-stat" wx:else>{{value}}</text>
  <text class="text-label">{{label}}</text>
</view>
```

js 添加 `isNumber` 自动判断：
```js
Component({
  properties: {
    value: { type: null },
    label: String
  },
  computed: {
    isNumber() { return typeof this.data.value === 'number' || /^\d+$/.test(String(this.data.value)); }
  }
});
```

注：小程序 Component 默认不支持 computed，需要 behavior 或手动 observer。简化版：直接在 wxml 用 `{{value+0===value}}` 判断或在 js setData 时计算。

实用做法：

```js
Component({
  properties: {
    value: { type: null, observer: '_check' },
    label: String
  },
  data: { isNumber: false, valueNum: 0 },
  methods: {
    _check(v) {
      const num = Number(v);
      const isNumber = !isNaN(num) && String(num) === String(v);
      this.setData({ isNumber, valueNum: num });
    }
  }
});
```

wxml 调整：
```xml
<number-counter wx:if="{{isNumber}}" value="{{valueNum}}"></number-counter>
<text class="text-stat" wx:else>{{value}}</text>
```

- [ ] **Step 5.4 commit**

```bash
git add miniprogram/components/number-counter/ miniprogram/components/stat-block/
git commit -m "feat(components): number-counter 滚动 + stat-block 接入"
```

---

## Task 6 · 首页 / 玩家详情 hero 加 brush-stroke

**Files:**
- Modify: `miniprogram/pages/home/index.{wxml,json}`
- Modify: `miniprogram/pages/player-detail/index.{wxml,json}`

- [ ] **Step 6.1 home/index.json 注册组件**

```json
{
  "usingComponents": {
    "stat-block": "/components/stat-block/index",
    "brush-stroke-bg": "/components/brush-stroke-bg/index"
  }
}
```

- [ ] **Step 6.2 home/index.wxml 在 hero 内嵌入**

```diff
  <view class="hero">
+   <brush-stroke-bg></brush-stroke-bg>
    <text class="text-display">PLAY.{'\n'}COMPETE.{'\n'}IMPROVE.</text>
  </view>
```

确保 .hero 是 `position: relative` （Phase 2 已设置）。

- [ ] **Step 6.3 同样处理 player-detail/index**

```diff
  <view class="hero-row">
+   <brush-stroke-bg></brush-stroke-bg>
    <image class="big-avatar" .../>
    ...
  </view>
```

`.hero-row` 改 `position: relative; overflow: hidden;`，给内部元素 `position: relative; z-index: 1;`。

- [ ] **Step 6.4 commit**

```bash
git add miniprogram/pages/home/ miniprogram/pages/player-detail/
git commit -m "feat(pages): home + player-detail hero 加 brush-stroke 装饰"
```

---

## Task 7 · CTA 触觉反馈 + page slide-in 动画

**Files:**
- Modify: `miniprogram/styles/utilities.wxss`
- 全局给主要页面 wxml 加 anim-slide-in 类

- [ ] **Step 7.1 utilities.wxss 增强 cta-primary**

```diff
  .cta-primary {
    ...
+   user-select: none;
  }
  .cta-primary:active {
    transform: scale(0.96);
+   filter: brightness(0.9);
  }
```

- [ ] **Step 7.2 在 home/rank/player-detail/result-submit/manage 顶层 view 加 `class="anim-slide-in"`**

```xml
<view class="home-page anim-slide-in">
  ...
</view>
```

- [ ] **Step 7.3 commit**

```bash
git add miniprogram/styles/utilities.wxss miniprogram/pages/
git commit -m "feat(ui): CTA 触觉反馈 + 页面进场动画"
```

---

## Task 8 · skeleton-loader 列表骨架屏

**Files:**
- Create: `miniprogram/components/skeleton-loader/index.{js,wxml,wxss,json}`
- 在 rank/home 列表加载时使用

- [ ] **Step 8.1 json**

```json
{ "component": true }
```

- [ ] **Step 8.2 wxml**

```xml
<view class="skeleton-list">
  <view wx:for="{{count}}" wx:key="*this" class="skeleton skeleton-row"></view>
</view>
```

- [ ] **Step 8.3 wxss**

```css
.skeleton-list { display: flex; flex-direction: column; gap: var(--space-3); }
.skeleton-row { height: 96rpx; }
```

- [ ] **Step 8.4 js**

```js
Component({
  properties: {
    count: { type: Number, value: 6 }
  }
});
```

- [ ] **Step 8.5 在 rank 页接入**

修改 rank/index.json 注册组件。修改 rank wxml：

```xml
<skeleton-loader wx:if="{{loading}}" count="6"></skeleton-loader>
<view wx:else class="list">
  <rank-row .../>
  ...
</view>
```

在 js 中加 `loading: true` 初始值，在 loadRank 成功后设 false。

- [ ] **Step 8.6 commit**

```bash
git add miniprogram/components/skeleton-loader/ miniprogram/pages/rank/
git commit -m "feat(components): 骨架屏 + rank 页接入"
```

---

## Task 9 · 最终 QA 巡检 + 更新 PROGRESS

**Files:** -

- [ ] **Step 9.1 完整巡检清单（在工具里跑一遍每个页面）**

- [ ] 首页：hero 装饰可见 / 个人 stats 显示正确 / quick actions 可点
- [ ] 赛事 tab：能看到所有赛事列表，能进入详情
- [ ] 排行榜：单/双打 tab 流畅切换 / #1 (或每周之星) 高亮 / 点头像进玩家详情
- [ ] 玩家详情：基本信息 + 单/双打 stats 显示 / brush stroke 装饰
- [ ] 我的：基本信息卡 + 操作按钮可用
- [ ] 管理（admin only）：仲裁队列 + 待确认队列 + 快捷入口
- [ ] my-match：能看到自己的待打/已打比赛
- [ ] result-submit：vs 选择 + 比分输入 + 提交 → toast 正确
- [ ] tournament-edit：5 步表单流畅
- [ ] tournament-brackets：unscheduled 警告条 / 正常显示
- [ ] tabBar：admin 5 个 / 普通会员 4 个
- [ ] 全局：背景白、字体青柠+黑、按钮触觉、tab 滑动、数字滚动

任何不对的地方 inline 修，每个修复都 commit。

- [ ] **Step 9.2 更新 PROGRESS.md**

```diff
- | 06 | Phase 6 · Polish | ⬜ 待开始 | — | — | — | — |
+ | 06 | Phase 6 · Polish | ✅ 已完成 | YYYY-MM-DD | YYYY-MM-DD | <hash> | 上线水准达成 |
```

进度条 `[████████████████████████] 6/6 Phase 完成 🎉`，下一个 Phase 改为 `（无 — 全部完成）`。

- [ ] **Step 9.3 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 6 完成，项目第一版完整交付"
```

---

## Self-Review Checklist

- [ ] weekly-star 定时触发器配置正确，云开发控制台能手动跑成功
- [ ] 排行榜上每周之星显示当前周（如果是周一刚跑过的）
- [ ] 所有 tab 切换有触觉 + 动画
- [ ] stat 数字第一次加载时滚动
- [ ] CTA 点击有 scale 反馈
- [ ] 列表加载时显示骨架屏
- [ ] PROGRESS.md 显示全部 6 Phase 完成
- [ ] 在真实手机上跑一遍（不是只在工具里）
