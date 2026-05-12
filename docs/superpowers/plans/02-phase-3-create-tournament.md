# Phase 3 · 创建赛事改造（含 20min 时间格子 UI）· Implementation Plan

> **执行说明:** 按本文 checkbox（`- [ ]`）逐项推进。此 Phase 多个 UI 任务强相关，建议在同一上下文内连续实现与验收。

**Goal:** 管理员能用新的多步表单（含时间×场地格子 UI）完整创建一场新赛事，数据落库到 `courtTimeGrid`。

**Architecture:** 把现有 tournament-edit/index.js（593 行单步表单）改造为 5 步分页表单。新建 `court-grid` 组件承担时段网格交互。基础信息/积分规则/选手选择沿用现有逻辑，仅套新视觉。

**Tech Stack:** 微信小程序原生组件（Component()）+ WXSS tokens（Phase 1 已铺）

**Spec 引用:** §5.1 courtTimeGrid、§7.2 court-grid 组件、§12 第 3 期

**前置条件:** Phase 1 完成（tokens 可用、tournaments 云函数已支持 courtTimeGrid）

**推荐执行方式:** Inline。整个 Phase 集中在一个 admin 页面 + 一个组件，跨任务有强 UI 反馈循环。

---

## File Structure

```
miniprogram/
├── components/
│   └── court-grid/                  (新建)
│       ├── index.js                 - 网格组件 JS
│       ├── index.wxml               - 网格 wxml
│       ├── index.wxss               - 网格样式
│       └── index.json               - 组件配置
└── pages/
    └── tournament-edit/             (大改)
        ├── index.js                 - 多步表单 JS
        ├── index.wxml               - 多步 wxml
        ├── index.wxss               - 重写视觉
        └── index.json               - 注册 court-grid 组件
```

---

## Task 1 · 创建 court-grid 组件骨架

**Files:**
- Create: `miniprogram/components/court-grid/index.json`
- Create: `miniprogram/components/court-grid/index.wxml`
- Create: `miniprogram/components/court-grid/index.wxss`
- Create: `miniprogram/components/court-grid/index.js`

- [ ] **Step 1.1 建目录**

```bash
mkdir -p miniprogram/components/court-grid
```

- [ ] **Step 1.2 写 index.json**

```json
{
  "component": true,
  "usingComponents": {}
}
```

- [ ] **Step 1.3 写 index.js（骨架 + 数据模型）**

```js
Component({
  properties: {
    // 父组件传入的初始值（编辑模式用）
    initialGrid: {
      type: Object,
      value: null
    },
    // 比赛日期，决定 slots 的日期前缀
    matchDate: {
      type: String,
      value: ''
    }
  },

  data: {
    // 内部 model
    courts: [],          // [{ courtId, name }]
    timeRanges: [],      // [{ start: '08:00', end: '12:00' }]  用户选的大时段
    // 自动从 timeRanges 推导出的 20min 档点
    slotTimes: [],       // ['08:00', '08:20', ...]
    // grid[slotTime][courtId] = true/false 表示这个格子是否选中
    grid: {},
    // UI 临时状态
    editingCourtIndex: -1
  },

  lifetimes: {
    attached() {
      this.hydrateFromInitial();
    }
  },

  methods: {
    // 用 initialGrid 反向填充内部 model（编辑模式）
    hydrateFromInitial() {
      const initial = this.data.initialGrid;
      if (!initial || !initial.slots || !initial.courts) {
        this.setData({ courts: [], timeRanges: [], slotTimes: [], grid: {} });
        return;
      }
      const courts = initial.courts.slice();
      // 从 slots 推导 timeRanges（合并连续档）
      const slotTimes = initial.slots.map(s => s.start.slice(11, 16)).sort();
      const grid = {};
      initial.slots.forEach(slot => {
        const t = slot.start.slice(11, 16);
        grid[t] = {};
        slot.availableCourtIds.forEach(cid => { grid[t][cid] = true; });
      });
      // timeRanges 推导逻辑放 Task 5
      this.setData({ courts, slotTimes, grid });
    },

    // 提供给父组件取最终值
    getCourtTimeGrid() {
      return this._serialize();
    },

    _serialize() {
      // Task 7 实现
      return null;
    }
  }
});
```

- [ ] **Step 1.4 写 index.wxml（占位）**

```xml
<view class="court-grid">
  <view class="header">
    <text class="text-label">场地与时段</text>
  </view>
  <view class="empty" wx:if="{{courts.length === 0}}">
    <text class="text-meta">先添加场地 →</text>
    <button class="cta-secondary" bindtap="onAddCourt">+ 添加场地</button>
  </view>
  <!-- 网格主体 Task 4-6 实现 -->
</view>
```

- [ ] **Step 1.5 写 index.wxss（仅基础容器）**

```css
.court-grid {
  padding: var(--space-4);
  background: var(--color-bg-2);
  border-radius: var(--radius-lg);
}
.court-grid .header {
  margin-bottom: var(--space-4);
}
.court-grid .empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-6) 0;
}
```

- [ ] **Step 1.6 commit**

```bash
git add miniprogram/components/court-grid/
git commit -m "feat(court-grid): 组件骨架与初始数据模型"
```

---

## Task 2 · 场地增删

**Files:**
- Modify: `miniprogram/components/court-grid/index.js`
- Modify: `miniprogram/components/court-grid/index.wxml`
- Modify: `miniprogram/components/court-grid/index.wxss`

- [ ] **Step 2.1 在 methods 中加增删函数**

```js
onAddCourt() {
  const courts = [...this.data.courts];
  const nextNum = courts.length + 1;
  courts.push({
    courtId: `c${Date.now()}_${nextNum}`,
    name: `${nextNum}号场`
  });
  this.setData({ courts });
  this._notifyChange();
},

onRemoveCourt(e) {
  const { courtId } = e.currentTarget.dataset;
  const courts = this.data.courts.filter(c => c.courtId !== courtId);
  // 清掉 grid 中关于这个 court 的所有标记
  const grid = { ...this.data.grid };
  Object.keys(grid).forEach(t => {
    if (grid[t][courtId]) {
      grid[t] = { ...grid[t] };
      delete grid[t][courtId];
    }
  });
  this.setData({ courts, grid });
  this._notifyChange();
},

onEditCourtName(e) {
  const { index } = e.currentTarget.dataset;
  const { value } = e.detail;
  const courts = [...this.data.courts];
  courts[index] = { ...courts[index], name: value };
  this.setData({ courts });
  this._notifyChange();
},

_notifyChange() {
  this.triggerEvent('change', { grid: this._serialize() });
}
```

- [ ] **Step 2.2 wxml 加场地列表**

替换 wxml 主体：

```xml
<view class="court-grid">
  <view class="header flex-between">
    <text class="text-label">场地与时段</text>
  </view>

  <view class="courts-section">
    <text class="text-meta">场地列表</text>
    <view class="courts-list">
      <view wx:for="{{courts}}" wx:key="courtId" class="court-row">
        <input
          class="court-name-input"
          value="{{item.name}}"
          data-index="{{index}}"
          bindinput="onEditCourtName"
        />
        <view
          class="court-remove"
          data-court-id="{{item.courtId}}"
          bindtap="onRemoveCourt"
        >×</view>
      </view>
    </view>
    <button class="cta-secondary" bindtap="onAddCourt" style="width:100%;margin-top:16rpx">+ 添加场地</button>
  </view>

  <!-- 时段 + 网格 Task 4-6 -->
</view>
```

- [ ] **Step 2.3 wxss**

```css
.courts-section { margin-bottom: var(--space-5); }
.courts-list { margin-top: var(--space-3); }
.court-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  background: #fff;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-2);
  border: 1rpx solid var(--color-border);
}
.court-name-input {
  flex: 1;
  font-size: var(--font-body-size);
}
.court-remove {
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  font-size: 36rpx;
}
```

- [ ] **Step 2.4 在小程序开发工具里临时把组件挂到任一页面验证**

在 `pages/tournament-edit/index.json` 里临时加：
```json
{ "usingComponents": { "court-grid": "/components/court-grid/index" } }
```
然后在 wxml 顶部加 `<court-grid />`，能看到"+ 添加场地"按钮，点击后场地列表多一行，能改名字、能删。验证完恢复 wxml（这个改动 Task 9 才正式接入）。

- [ ] **Step 2.5 commit**

```bash
git add miniprogram/components/court-grid/
git commit -m "feat(court-grid): 场地增删与重命名"
```

---

## Task 3 · 时段大块编辑（08:00-12:00 这种区间）

**目标**：管理员先输入"8 点到 12 点"这种大区间，组件自动把它切成 20min 档，每档生成一行格子。

**Files:**
- Modify: `miniprogram/components/court-grid/index.js`
- Modify: `miniprogram/components/court-grid/index.wxml`
- Modify: `miniprogram/components/court-grid/index.wxss`

- [ ] **Step 3.1 在 js 中加时段处理**

```js
// 加在 methods 中
onAddTimeRange() {
  const timeRanges = [...this.data.timeRanges];
  timeRanges.push({ start: '08:00', end: '12:00' });
  this.setData({ timeRanges });
  this._regenerateSlotTimes();
  this._notifyChange();
},

onRemoveTimeRange(e) {
  const { index } = e.currentTarget.dataset;
  const timeRanges = this.data.timeRanges.filter((_, i) => i !== index);
  this.setData({ timeRanges });
  this._regenerateSlotTimes();
  this._notifyChange();
},

onTimeRangeChange(e) {
  const { index, field } = e.currentTarget.dataset;
  const { value } = e.detail;
  const timeRanges = [...this.data.timeRanges];
  timeRanges[index] = { ...timeRanges[index], [field]: value };
  this.setData({ timeRanges });
  this._regenerateSlotTimes();
  this._notifyChange();
},

_regenerateSlotTimes() {
  // 把所有 timeRanges 展开成 20min 档点
  const set = new Set();
  this.data.timeRanges.forEach(r => {
    let t = this._toMinutes(r.start);
    const end = this._toMinutes(r.end);
    while (t < end) {
      set.add(this._toTimeStr(t));
      t += 20;
    }
  });
  const slotTimes = Array.from(set).sort();
  this.setData({ slotTimes });
},

_toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
},

_toTimeStr(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}
```

- [ ] **Step 3.2 wxml 加时段编辑 UI**

在 `courts-section` 下面加：

```xml
<view class="time-section">
  <text class="text-meta">时段</text>
  <view wx:for="{{timeRanges}}" wx:key="index" class="time-row">
    <picker
      mode="time"
      value="{{item.start}}"
      data-index="{{index}}"
      data-field="start"
      bindchange="onTimeRangeChange"
    >
      <view class="time-pick">{{item.start}}</view>
    </picker>
    <text> – </text>
    <picker
      mode="time"
      value="{{item.end}}"
      data-index="{{index}}"
      data-field="end"
      bindchange="onTimeRangeChange"
    >
      <view class="time-pick">{{item.end}}</view>
    </picker>
    <view
      class="time-remove"
      data-index="{{index}}"
      bindtap="onRemoveTimeRange"
    >×</view>
  </view>
  <button class="cta-secondary" bindtap="onAddTimeRange" style="width:100%;margin-top:16rpx">+ 添加时段</button>
</view>
```

- [ ] **Step 3.3 wxss**

```css
.time-section { margin-bottom: var(--space-5); }
.time-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  background: #fff;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-2);
  border: 1rpx solid var(--color-border);
}
.time-pick {
  background: var(--color-bg-3);
  padding: 8rpx 16rpx;
  border-radius: var(--radius-sm);
  font-size: var(--font-body-size);
}
.time-remove {
  margin-left: auto;
  width: 48rpx;
  height: 48rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-muted);
  font-size: 36rpx;
}
```

- [ ] **Step 3.4 commit**

```bash
git add miniprogram/components/court-grid/
git commit -m "feat(court-grid): 时段大块编辑（自动切 20min 档）"
```

---

## Task 4 · 渲染场地×档点格子矩阵

**Files:**
- Modify: `miniprogram/components/court-grid/index.wxml`
- Modify: `miniprogram/components/court-grid/index.wxss`
- Modify: `miniprogram/components/court-grid/index.js`

- [ ] **Step 4.1 wxml 在时段下追加格子矩阵**

```xml
<view class="grid-section" wx:if="{{courts.length > 0 && slotTimes.length > 0}}">
  <text class="text-meta">点格子切换可用</text>
  <view class="grid">
    <!-- 表头：时间列 + 各场地名 -->
    <view class="grid-row grid-head">
      <view class="grid-time-cell"></view>
      <view wx:for="{{courts}}" wx:key="courtId" class="grid-court-cell">{{item.name}}</view>
    </view>
    <!-- 每个档点一行 -->
    <view wx:for="{{slotTimes}}" wx:for-item="t" wx:key="t" class="grid-row">
      <view class="grid-time-cell">{{t}}</view>
      <view
        wx:for="{{courts}}" wx:for-item="c" wx:key="courtId"
        class="grid-cell {{grid[t][c.courtId] ? 'on' : ''}}"
        data-time="{{t}}"
        data-court-id="{{c.courtId}}"
        bindtap="onToggleCell"
      ></view>
    </view>
  </view>
</view>
```

- [ ] **Step 4.2 js 中加 toggle 处理**

```js
onToggleCell(e) {
  const { time, courtId } = e.currentTarget.dataset;
  const grid = { ...this.data.grid };
  if (!grid[time]) grid[time] = {};
  grid[time] = { ...grid[time], [courtId]: !grid[time][courtId] };
  this.setData({ grid });
  this._notifyChange();
  wx.vibrateShort({ type: 'light' });
}
```

- [ ] **Step 4.3 wxss**

```css
.grid-section { margin-top: var(--space-5); }
.grid {
  display: flex;
  flex-direction: column;
  gap: 2rpx;
  background: var(--color-bg-3);
  padding: 4rpx;
  border-radius: var(--radius-md);
  margin-top: var(--space-3);
}
.grid-row {
  display: flex;
  gap: 2rpx;
}
.grid-time-cell {
  width: 100rpx;
  font-size: var(--font-meta-size);
  color: var(--color-muted);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: var(--space-2);
  height: 56rpx;
}
.grid-court-cell {
  flex: 1;
  font-size: var(--font-label-size);
  font-weight: 600;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 56rpx;
  background: #fff;
  border-radius: var(--radius-sm);
}
.grid-cell {
  flex: 1;
  height: 56rpx;
  background: #fff;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}
.grid-cell.on {
  background: var(--color-lime);
}
```

- [ ] **Step 4.4 在工具里目视验证：加场地 + 加 8:00-9:00 时段，能看到 2 行格子（8:00/8:20/8:40 三档）；点格子能切换青柠**

- [ ] **Step 4.5 commit**

```bash
git add miniprogram/components/court-grid/
git commit -m "feat(court-grid): 格子矩阵渲染与点选切换"
```

---

## Task 5 · 序列化为 courtTimeGrid 对象

**Files:**
- Modify: `miniprogram/components/court-grid/index.js`

- [ ] **Step 5.1 实现 `_serialize`**

```js
_serialize() {
  const { courts, slotTimes, grid } = this.data;
  const dateStr = this.data.matchDate || '2026-01-01';

  const slots = slotTimes.map(t => {
    const availableCourtIds = courts
      .filter(c => grid[t] && grid[t][c.courtId])
      .map(c => c.courtId);
    return {
      slotId: `s_${dateStr.replace(/-/g, '')}_${t.replace(':', '')}`,
      start: this._composeISO(dateStr, t),
      end: this._composeISO(dateStr, this._addMinutes(t, 20)),
      availableCourtIds
    };
  }).filter(s => s.availableCourtIds.length > 0);

  return {
    matchDuration: 20,
    courts: courts.map(c => ({ courtId: c.courtId, name: c.name })),
    slots
  };
},

_composeISO(date, time) {
  return `${date}T${time}:00+08:00`;
},

_addMinutes(hhmm, minutes) {
  const total = this._toMinutes(hhmm) + minutes;
  return this._toTimeStr(total);
}
```

- [ ] **Step 5.2 在 console 验证**

在小程序工具里临时调一下 `this.selectComponent('court-grid').getCourtTimeGrid()`，看输出对不对。

- [ ] **Step 5.3 commit**

```bash
git add miniprogram/components/court-grid/index.js
git commit -m "feat(court-grid): 序列化为 courtTimeGrid 标准格式"
```

---

## Task 6 · 反序列化（编辑模式）

**Files:**
- Modify: `miniprogram/components/court-grid/index.js`

- [ ] **Step 6.1 完善 hydrateFromInitial**

把 Task 1 写的 hydrate 方法替换为：

```js
hydrateFromInitial() {
  const initial = this.data.initialGrid;
  if (!initial || !initial.slots || !initial.courts) {
    this.setData({ courts: [], timeRanges: [], slotTimes: [], grid: {} });
    return;
  }

  const courts = initial.courts.map(c => ({ courtId: c.courtId, name: c.name }));

  // 推导 timeRanges：找连续档点合并
  const sortedTimes = initial.slots
    .map(s => s.start.slice(11, 16))
    .sort();
  const timeRanges = this._mergeTimes(sortedTimes);

  // 推导 grid
  const grid = {};
  initial.slots.forEach(slot => {
    const t = slot.start.slice(11, 16);
    if (!grid[t]) grid[t] = {};
    slot.availableCourtIds.forEach(cid => { grid[t][cid] = true; });
  });

  this.setData({ courts, timeRanges, grid });
  this._regenerateSlotTimes();
},

_mergeTimes(sortedTimes) {
  if (sortedTimes.length === 0) return [];
  const ranges = [];
  let rangeStart = sortedTimes[0];
  let prev = sortedTimes[0];
  for (let i = 1; i < sortedTimes.length; i++) {
    const cur = sortedTimes[i];
    if (this._toMinutes(cur) - this._toMinutes(prev) === 20) {
      prev = cur;
    } else {
      ranges.push({ start: rangeStart, end: this._addMinutes(prev, 20) });
      rangeStart = cur;
      prev = cur;
    }
  }
  ranges.push({ start: rangeStart, end: this._addMinutes(prev, 20) });
  return ranges;
}
```

- [ ] **Step 6.2 验证**：手动把 initialGrid 设置为一个已知的 grid 对象，看 UI 是否正确还原。

- [ ] **Step 6.3 commit**

```bash
git add miniprogram/components/court-grid/index.js
git commit -m "feat(court-grid): 反序列化用于编辑模式"
```

---

## Task 7 · tournament-edit 改造为多步表单 — Step 1 基本信息

**说明**：现有 `tournament-edit/index.js` 是单步表单（593 行）。重写为 5 步：基本信息 / 场地时段 / 积分规则 / 选手 / 确认。

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.json`
- Modify: `miniprogram/pages/tournament-edit/index.js`
- Modify: `miniprogram/pages/tournament-edit/index.wxml`
- Modify: `miniprogram/pages/tournament-edit/index.wxss`

- [ ] **Step 7.1 json 注册组件**

```json
{
  "usingComponents": {
    "court-grid": "/components/court-grid/index"
  }
}
```

- [ ] **Step 7.2 js 顶部加 currentStep + step 切换**

在 data 中加：

```js
data: {
  // 沿用现有字段
  // ...

  // 新增
  currentStep: 1,         // 1-5
  totalSteps: 5,
  stepTitles: ['基本信息', '场地时段', '积分规则', '选手', '确认提交']
}
```

新增方法：

```js
onNextStep() {
  if (!this._validateCurrentStep()) return;
  if (this.data.currentStep < this.data.totalSteps) {
    this.setData({ currentStep: this.data.currentStep + 1 });
  } else {
    this.onFinalSubmit();
  }
},

onPrevStep() {
  if (this.data.currentStep > 1) {
    this.setData({ currentStep: this.data.currentStep - 1 });
  } else {
    wx.navigateBack();
  }
},

_validateCurrentStep() {
  const step = this.data.currentStep;
  const t = this.data.tournament;
  switch (step) {
    case 1:
      if (!t.name) { wx.showToast({ title: '请填写赛事名称', icon: 'none' }); return false; }
      if (!t.startDate) { wx.showToast({ title: '请选择开始日期', icon: 'none' }); return false; }
      return true;
    case 2:
      // grid 在 Task 8 校验
      return true;
    default:
      return true;
  }
},

onFinalSubmit() {
  // Task 11 实现
}
```

- [ ] **Step 7.3 wxml 改为分步结构**

```xml
<view class="page">
  <view class="topbar">
    <text class="text-label">第 {{currentStep}}/{{totalSteps}} 步</text>
    <text class="text-h2">{{stepTitles[currentStep - 1]}}</text>
  </view>

  <!-- Step 1: 基本信息 -->
  <view wx:if="{{currentStep === 1}}" class="step-body">
    <!-- 把现有的赛事名称/类型/赛制/赛季/日期/地点/描述 form 抽到这里 -->
    <view class="form-row">
      <text class="text-label">赛事名称</text>
      <input class="form-input" placeholder="例：2026春季公开赛" value="{{tournament.name}}" bindinput="onNameInput" />
    </view>
    <!-- 其他 form 项沿用现有逻辑，调样式即可 -->
  </view>

  <!-- Step 2: 场地时段 -->
  <view wx:if="{{currentStep === 2}}" class="step-body">
    <court-grid
      initial-grid="{{tournament.courtTimeGrid}}"
      match-date="{{tournament.startDate}}"
      bind:change="onGridChange"
    />
  </view>

  <!-- Step 3-5 placeholders, Task 9-11 填充 -->
  <view wx:if="{{currentStep === 3}}" class="step-body">
    <!-- Task 9 -->
  </view>
  <view wx:if="{{currentStep === 4}}" class="step-body">
    <!-- Task 10 -->
  </view>
  <view wx:if="{{currentStep === 5}}" class="step-body">
    <!-- Task 11 -->
  </view>

  <!-- 底栏 -->
  <view class="footer">
    <button class="cta-secondary" bindtap="onPrevStep">{{currentStep === 1 ? '取消' : '上一步'}}</button>
    <button class="cta-primary" bindtap="onNextStep">{{currentStep === totalSteps ? '提交' : '下一步'}}</button>
  </view>
</view>
```

- [ ] **Step 7.4 wxss 基础布局**

```css
.page {
  min-height: 100vh;
  padding: var(--space-5) var(--space-5) 120rpx;
}
.topbar {
  margin-bottom: var(--space-5);
}
.step-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.form-row {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.form-input {
  background: var(--color-bg-2);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  font-size: var(--font-body-size);
  border: 1rpx solid var(--color-border);
}
.footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  gap: var(--space-3);
  padding: var(--space-4);
  background: #fff;
  border-top: 1rpx solid var(--color-border);
}
.footer .cta-secondary,
.footer .cta-primary {
  flex: 1;
}
```

- [ ] **Step 7.5 commit**

```bash
git add miniprogram/pages/tournament-edit/
git commit -m "refactor(tournament-edit): 改造为多步表单 - Step 1 基本信息"
```

---

## Task 8 · Step 2 接入 court-grid 数据流

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.js`

- [ ] **Step 8.1 在 js methods 加 onGridChange**

```js
onGridChange(e) {
  const { grid } = e.detail;
  this.setData({
    'tournament.courtTimeGrid': grid
  });
},
```

- [ ] **Step 8.2 在 _validateCurrentStep 中给 step 2 加校验**

```js
case 2:
  const grid = this.data.tournament.courtTimeGrid;
  if (!grid || grid.slots.length === 0) {
    wx.showToast({ title: '请至少添加一个场地+时段', icon: 'none' });
    return false;
  }
  return true;
```

- [ ] **Step 8.3 commit**

```bash
git add miniprogram/pages/tournament-edit/index.js
git commit -m "feat(tournament-edit): Step 2 接入 court-grid"
```

---

## Task 9 · Step 3 积分规则表单

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.wxml`
- Modify: `miniprogram/pages/tournament-edit/index.js`

- [ ] **Step 9.1 wxml**

```xml
<view wx:if="{{currentStep === 3}}" class="step-body">
  <view class="form-row">
    <text class="text-label">胜利积分</text>
    <input class="form-input" type="number" value="{{tournament.pointsRules.win}}" bindinput="onPointsInput" data-field="win" />
  </view>
  <view class="form-row">
    <text class="text-label">失败积分</text>
    <input class="form-input" type="number" value="{{tournament.pointsRules.loss}}" bindinput="onPointsInput" data-field="loss" />
  </view>
  <view class="form-row">
    <text class="text-label">弃权积分</text>
    <input class="form-input" type="number" value="{{tournament.pointsRules.walkover}}" bindinput="onPointsInput" data-field="walkover" />
  </view>

  <view wx:if="{{tournament.format === 'knockout'}}" class="form-row">
    <text class="text-label">轮次奖励积分</text>
    <view wx:for="{{[1,2,3,4,5]}}" wx:for-item="r" wx:key="r" class="bonus-row">
      <text>第 {{r}} 轮</text>
      <input class="form-input bonus-input" type="number" value="{{tournament.pointsRules.bonusByRound[r]}}" data-round="{{r}}" bindinput="onBonusInput" />
    </view>
  </view>
</view>
```

- [ ] **Step 9.2 js methods**

```js
onPointsInput(e) {
  const field = e.currentTarget.dataset.field;
  this.setData({ [`tournament.pointsRules.${field}`]: parseInt(e.detail.value) || 0 });
},

onBonusInput(e) {
  const round = e.currentTarget.dataset.round;
  this.setData({ [`tournament.pointsRules.bonusByRound.${round}`]: parseInt(e.detail.value) || 0 });
}
```

- [ ] **Step 9.3 wxss**

```css
.bonus-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-2);
}
.bonus-input {
  flex: 1;
}
```

- [ ] **Step 9.4 commit**

```bash
git add miniprogram/pages/tournament-edit/
git commit -m "feat(tournament-edit): Step 3 积分规则表单"
```

---

## Task 10 · Step 4 选手选择

**说明**：选手必须是已注册会员，从 members 集合中选。

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.wxml`
- Modify: `miniprogram/pages/tournament-edit/index.js`

- [ ] **Step 10.1 js 加载会员列表**

在 onLoad 中追加：

```js
this.loadMembers();
```

新方法：

```js
async loadMembers() {
  try {
    const res = await wx.cloud.callFunction({
      name: 'members',
      data: { action: 'list' }
    });
    this.setData({
      allMembers: res.result.data || [],
      selectedPlayerIds: []
    });
  } catch (err) {
    wx.showToast({ title: '加载会员失败', icon: 'none' });
  }
},

onTogglePlayer(e) {
  const { id } = e.currentTarget.dataset;
  let selected = [...this.data.selectedPlayerIds];
  if (selected.includes(id)) {
    selected = selected.filter(x => x !== id);
  } else {
    selected.push(id);
  }
  this.setData({ selectedPlayerIds: selected });
}
```

- [ ] **Step 10.2 wxml**

```xml
<view wx:if="{{currentStep === 4}}" class="step-body">
  <text class="text-meta">已选 {{selectedPlayerIds.length}} 人</text>
  <view class="player-picker">
    <view
      wx:for="{{allMembers}}" wx:key="_id"
      class="player-pick-row {{selectedPlayerIds.includes(item._id) ? 'on' : ''}}"
      data-id="{{item._id}}"
      bindtap="onTogglePlayer"
    >
      <image src="{{item.avatarUrl || '/images/icons/avatar.png'}}" class="avatar" />
      <text class="player-name">{{item.name}}</text>
      <view class="check">{{selectedPlayerIds.includes(item._id) ? '✓' : ''}}</view>
    </view>
  </view>
</view>
```

- [ ] **Step 10.3 wxss**

```css
.player-picker { display: flex; flex-direction: column; gap: var(--space-2); }
.player-pick-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: #fff;
  border-radius: var(--radius-md);
  border: 1rpx solid var(--color-border);
}
.player-pick-row.on {
  background: var(--color-lime-soft);
  border-color: var(--color-lime);
}
.avatar { width: 64rpx; height: 64rpx; border-radius: 50%; }
.player-name { flex: 1; font-weight: 600; }
.check { color: var(--color-ink); font-weight: 700; }
```

- [ ] **Step 10.4 _validateCurrentStep step 4**

```js
case 4:
  if (this.data.selectedPlayerIds.length < 2) {
    wx.showToast({ title: '至少选 2 人', icon: 'none' });
    return false;
  }
  // 双打需要偶数
  if (this.data.tournament.type === 'doubles' && this.data.selectedPlayerIds.length % 2 !== 0) {
    wx.showToast({ title: '双打需要偶数人', icon: 'none' });
    return false;
  }
  return true;
```

- [ ] **Step 10.5 commit**

```bash
git add miniprogram/pages/tournament-edit/
git commit -m "feat(tournament-edit): Step 4 选手选择"
```

---

## Task 11 · Step 5 确认 + 最终提交

**Files:**
- Modify: `miniprogram/pages/tournament-edit/index.wxml`
- Modify: `miniprogram/pages/tournament-edit/index.js`

- [ ] **Step 11.1 wxml 摘要**

```xml
<view wx:if="{{currentStep === 5}}" class="step-body">
  <view class="card">
    <text class="text-label">赛事</text>
    <text class="text-title">{{tournament.name}}</text>
    <text class="text-meta">{{tournament.type === 'singles' ? '单打' : '双打'}} · {{tournament.format === 'regular' ? '常规' : '淘汰'}}</text>
  </view>
  <view class="card">
    <text class="text-label">时间</text>
    <text class="text-body">{{tournament.startDate}} ~ {{tournament.endDate}}</text>
  </view>
  <view class="card">
    <text class="text-label">场地+时段</text>
    <text class="text-body">{{tournament.courtTimeGrid.courts.length}} 个场地，{{tournament.courtTimeGrid.slots.length}} 个档点</text>
  </view>
  <view class="card">
    <text class="text-label">选手</text>
    <text class="text-body">{{selectedPlayerIds.length}} 人</text>
  </view>
</view>
```

- [ ] **Step 11.2 实现 onFinalSubmit**

```js
async onFinalSubmit() {
  wx.showLoading({ title: '提交中' });
  try {
    // 1. 创建/更新赛事
    const action = this.data.isEdit ? 'update' : 'add';
    const tournamentRes = await wx.cloud.callFunction({
      name: 'tournaments',
      data: { action, data: this.data.tournament, _id: this.data.tournament._id }
    });
    const tournamentId = tournamentRes.result.data?._id || this.data.tournament._id;

    // 2. 批量报名
    for (const playerId of this.data.selectedPlayerIds) {
      await wx.cloud.callFunction({
        name: 'tournament-registrations',
        data: { action: 'add', data: { tournamentId, playerId } }
      });
    }

    wx.hideLoading();
    wx.showToast({ title: '创建成功', icon: 'success' });
    setTimeout(() => {
      wx.redirectTo({ url: `/pages/tournament-detail/index?id=${tournamentId}` });
    }, 800);
  } catch (err) {
    wx.hideLoading();
    wx.showToast({ title: err.message || '创建失败', icon: 'none' });
  }
}
```

- [ ] **Step 11.3 端到端验证**

在小程序工具：从管理 tab 进入"创建赛事"→ 走完 5 步 → 看 tournament-detail 页能否打开新赛事。

- [ ] **Step 11.4 commit**

```bash
git add miniprogram/pages/tournament-edit/
git commit -m "feat(tournament-edit): Step 5 确认与最终提交"
```

---

## Task 12 · 更新 PROGRESS.md

- [ ] **Step 12.1 PROGRESS.md 标记 Phase 3 完成**

```diff
- | 02 | Phase 3 · Create Tournament | ⬜ 待开始 | — | — | — | — |
+ | 02 | Phase 3 · Create Tournament | ✅ 已完成 | YYYY-MM-DD | YYYY-MM-DD | <hash> | 多步表单 + court-grid 组件可用 |
```

进度条 `[████████░░░░░░░░░░░░░░░░] 2/6`，下一个 Phase 改为 `03-phase-4-scheduler.md`。

- [ ] **Step 12.2 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 3 完成"
```

---

## Self-Review Checklist

- [ ] 在工具中完整跑一遍创建赛事流程（5 步）成功
- [ ] tournaments 集合内新赛事文档有 `courtTimeGrid` 字段且结构正确
- [ ] tournament_registrations 集合内多了对应的报名记录
- [ ] 编辑已有赛事时 court-grid 能正确反序列化显示
- [ ] PROGRESS.md 更新
