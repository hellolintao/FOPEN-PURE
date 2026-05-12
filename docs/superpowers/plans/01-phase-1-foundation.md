# Phase 1 · 数据模型迁移 + 设计系统 tokens · Implementation Plan

> **执行说明:** 按本文 checkbox（`- [ ]`）逐项推进。云函数与迁移任务建议用独立上下文做 TDD；执行前必须先对照当前仓库代码，不要机械复制片段。

**Goal:** 为整个项目铺好基础——CSS 设计 token 全局可用 + 数据库新字段就位，后续所有 Phase 都基于此。

**Architecture:** 三个 WXSS 文件（tokens / base / utilities）在 `app.wxss` 内一次性引入；云函数加字段校验；写一次性迁移脚本给老数据补默认值。

**Tech Stack:** 微信小程序原生 WXSS + 云函数 Node.js + Jest（单元测试）

**Spec 引用:** §4 视觉系统、§5 数据模型、§12 第 1 期

**前置条件:** 无（这是第一期）

---

## File Structure

```
miniprogram/
├── styles/                          (新建)
│   ├── tokens.wxss                  (新建 - CSS 变量定义)
│   ├── base.wxss                    (新建 - 全局 reset + 字体)
│   └── utilities.wxss               (新建 - 常用工具类)
├── app.wxss                         (改 - 引入新 style + 移除老深色)
└── app.json                         (不动)

cloudfunctions/
├── members/
│   ├── index.js                     (改 - 接受 playStyle/playStyleNote)
│   ├── lib/                         (新建)
│   │   └── validate.js              (新建 - 提取校验逻辑)
│   ├── lib/__tests__/               (新建)
│   │   └── validate.test.js         (新建 - Jest 测试)
│   └── package.json                 (改 - 加 jest 依赖)
├── tournaments/
│   ├── index.js                     (改 - 接受 courtTimeGrid)
│   ├── lib/
│   │   └── validate.js
│   ├── lib/__tests__/
│   │   └── validate.test.js
│   └── package.json
├── match-results/
│   ├── index.js                     (改 - 接受 resultStatus / submissions / ...)
│   ├── lib/
│   │   └── validate.js
│   ├── lib/__tests__/
│   │   └── validate.test.js
│   └── package.json
├── migrations/                      (新建)
│   └── 001-add-new-fields.js        (新建 - 一次性迁移脚本)
└── DATABASE_SCHEMA.md               (改 - 文档同步)
```

---

## Task 1 · 创建 styles 目录与 tokens.wxss

**Files:**
- Create: `miniprogram/styles/tokens.wxss`

- [ ] **Step 1.1 创建 styles 目录**

```bash
mkdir -p miniprogram/styles
```

- [ ] **Step 1.2 写 tokens.wxss**

参考实现（执行时先对照当前 `app.wxss` 与页面样式，再按需调整）：

```css
/* miniprogram/styles/tokens.wxss
 * 全局设计 token。所有页面/组件都通过这些变量取值，
 * 严禁直接写硬编码颜色。
 */

page {
  /* ===== 色板 ===== */
  --color-lime: #BEE645;
  --color-lime-soft: #DDF099;
  --color-ink: #0A0A0A;
  --color-ink-2: #1F1F23;
  --color-bg: #FFFFFF;
  --color-bg-2: #FAFAFA;
  --color-bg-3: #F3F4F6;
  --color-muted: #6B7280;
  --color-muted-2: #9CA3AF;
  --color-border: #E5E7EB;
  --color-danger: #DC2626;
  --color-warn: #F59E0B;
  --color-success: #16A34A;

  /* ===== 间距 ===== */
  --space-1: 4rpx;
  --space-2: 8rpx;
  --space-3: 12rpx;
  --space-4: 16rpx;
  --space-5: 24rpx;
  --space-6: 32rpx;
  --space-7: 48rpx;
  --space-8: 64rpx;

  /* ===== 圆角 ===== */
  --radius-sm: 8rpx;
  --radius-md: 16rpx;
  --radius-lg: 24rpx;
  --radius-pill: 999rpx;

  /* ===== 字号 / 字重 ===== */
  --font-display-size: 56rpx;
  --font-display-weight: 900;

  --font-h1-size: 40rpx;
  --font-h1-weight: 800;

  --font-h2-size: 32rpx;
  --font-h2-weight: 700;

  --font-title-size: 28rpx;
  --font-title-weight: 600;

  --font-body-size: 26rpx;
  --font-body-weight: 400;

  --font-label-size: 22rpx;
  --font-label-weight: 600;

  --font-meta-size: 20rpx;
  --font-meta-weight: 400;

  --font-stat-size: 64rpx;
  --font-stat-weight: 900;

  /* ===== 阴影 ===== */
  --shadow-card: 0 4rpx 16rpx rgba(0, 0, 0, 0.04);
  --shadow-lifted: 0 8rpx 32rpx rgba(0, 0, 0, 0.08);

  /* ===== 动画 ===== */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

- [ ] **Step 1.3 commit**

```bash
git add miniprogram/styles/tokens.wxss
git commit -m "feat(styles): 添加全局设计 token"
```

---

## Task 2 · base.wxss 全局基础样式

**Files:**
- Create: `miniprogram/styles/base.wxss`

- [ ] **Step 2.1 写 base.wxss**

```css
/* miniprogram/styles/base.wxss
 * 全局基础样式：重置 + 默认字体
 */

page {
  background: var(--color-bg);
  color: var(--color-ink);
  font-family:
    "PingFang SC",
    -apple-system,
    BlinkMacSystemFont,
    "Helvetica Neue",
    "Microsoft YaHei",
    sans-serif;
  font-size: var(--font-body-size);
  line-height: 1.5;
}

view, text, input, textarea, button {
  box-sizing: border-box;
}

button {
  background: initial;
  padding: 0;
  margin: 0;
  border: none;
  outline: none;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

button:focus,
button:active {
  outline: 0;
}

button::after {
  border: none;
}

image {
  display: block;
}
```

- [ ] **Step 2.2 commit**

```bash
git add miniprogram/styles/base.wxss
git commit -m "feat(styles): 添加全局基础样式"
```

---

## Task 3 · utilities.wxss 工具类

**Files:**
- Create: `miniprogram/styles/utilities.wxss`

- [ ] **Step 3.1 写 utilities.wxss**

```css
/* miniprogram/styles/utilities.wxss
 * 常用工具类。按需在 WXML 上加 class 复用。
 */

/* ===== 字体层级 ===== */
.text-display {
  font-size: var(--font-display-size);
  font-weight: var(--font-display-weight);
  letter-spacing: -0.03em;
  line-height: 1;
}

.text-h1 {
  font-size: var(--font-h1-size);
  font-weight: var(--font-h1-weight);
  text-transform: uppercase;
  letter-spacing: 0.01em;
  line-height: 1.1;
}

.text-h2 {
  font-size: var(--font-h2-size);
  font-weight: var(--font-h2-weight);
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.text-title {
  font-size: var(--font-title-size);
  font-weight: var(--font-title-weight);
  line-height: 1.3;
}

.text-body {
  font-size: var(--font-body-size);
  font-weight: var(--font-body-weight);
  line-height: 1.5;
}

.text-label {
  font-size: var(--font-label-size);
  font-weight: var(--font-label-weight);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--color-muted);
}

.text-meta {
  font-size: var(--font-meta-size);
  font-weight: var(--font-meta-weight);
  color: var(--color-muted);
}

.text-stat {
  font-size: var(--font-stat-size);
  font-weight: var(--font-stat-weight);
  letter-spacing: -0.03em;
  line-height: 1;
}

/* ===== 颜色 ===== */
.color-ink { color: var(--color-ink); }
.color-muted { color: var(--color-muted); }
.color-lime { color: var(--color-lime); }
.color-white { color: #fff; }
.color-danger { color: var(--color-danger); }
.color-success { color: var(--color-success); }

.bg-lime { background: var(--color-lime); }
.bg-ink { background: var(--color-ink); }
.bg-card { background: var(--color-bg-2); }

/* ===== 布局 ===== */
.flex { display: flex; }
.flex-col { display: flex; flex-direction: column; }
.flex-center { display: flex; align-items: center; justify-content: center; }
.flex-between { display: flex; align-items: center; justify-content: space-between; }
.flex-1 { flex: 1; }

.gap-2 { gap: var(--space-2); }
.gap-3 { gap: var(--space-3); }
.gap-4 { gap: var(--space-4); }
.gap-5 { gap: var(--space-5); }

/* ===== 圆角 ===== */
.rounded-sm { border-radius: var(--radius-sm); }
.rounded-md { border-radius: var(--radius-md); }
.rounded-lg { border-radius: var(--radius-lg); }
.rounded-pill { border-radius: var(--radius-pill); }

/* ===== Padding ===== */
.p-3 { padding: var(--space-3); }
.p-4 { padding: var(--space-4); }
.p-5 { padding: var(--space-5); }

/* ===== Margin ===== */
.mt-3 { margin-top: var(--space-3); }
.mt-4 { margin-top: var(--space-4); }
.mb-3 { margin-bottom: var(--space-3); }
.mb-4 { margin-bottom: var(--space-4); }

/* ===== 卡片 ===== */
.card {
  background: var(--color-bg-2);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-card);
}

.card-hero {
  background: var(--color-lime);
  color: var(--color-ink);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  position: relative;
  overflow: hidden;
}

/* ===== CTA ===== */
.cta-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-ink);
  color: #fff;
  font-weight: 600;
  font-size: 28rpx;
  padding: 24rpx 48rpx;
  border-radius: var(--radius-pill);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  transition: transform 0.1s var(--ease-out);
}

.cta-primary:active {
  transform: scale(0.96);
}

.cta-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  color: var(--color-ink);
  font-weight: 600;
  font-size: 28rpx;
  padding: 20rpx 40rpx;
  border-radius: var(--radius-pill);
  border: 1rpx solid var(--color-ink);
}

/* ===== Chip Tab ===== */
.chip {
  display: inline-flex;
  align-items: center;
  padding: 12rpx 24rpx;
  border-radius: var(--radius-pill);
  font-size: var(--font-label-size);
  font-weight: 600;
  background: #fff;
  color: var(--color-muted);
  border: 1rpx solid var(--color-border);
}

.chip-active {
  background: var(--color-lime);
  color: var(--color-ink);
  border-color: var(--color-lime);
}
```

- [ ] **Step 3.2 commit**

```bash
git add miniprogram/styles/utilities.wxss
git commit -m "feat(styles): 添加工具类样式"
```

---

## Task 4 · 重写 app.wxss

**Files:**
- Modify: `miniprogram/app.wxss`

- [ ] **Step 4.1 用新内容覆盖**

```css
/* app.wxss — 全局入口，仅做 import 与最基本兜底 */
@import "/styles/tokens.wxss";
@import "/styles/base.wxss";
@import "/styles/utilities.wxss";

/* 旧版兼容：保留 .container 类供未重写的页面用 */
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
}
```

注：移除了旧的 `page { background: #0d0d14; }` 深色规则，新主题由 `base.wxss` 接管。

- [ ] **Step 4.2 在小程序开发工具里打开任一页面，确认背景已变白**

预期：原来深色 `#0d0d14` 的页面现在变白底；如果有页面写死了 `color: white` 则可能看不见——这是预期的，Phase 2 会修。

- [ ] **Step 4.3 commit**

```bash
git add miniprogram/app.wxss
git commit -m "feat(styles): 切换全局主题为浅底+青柠"
```

---

## Task 5 · 给 members 云函数加 Jest 测试基础设施

**Files:**
- Modify: `cloudfunctions/members/package.json`
- Create: `cloudfunctions/members/lib/validate.js`
- Create: `cloudfunctions/members/lib/__tests__/validate.test.js`

- [ ] **Step 5.1 修改 members/package.json**

完整新内容：

```json
{
  "name": "members",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "test": "jest"
  },
  "author": "",
  "license": "ISC",
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

- [ ] **Step 5.2 安装依赖**

```bash
cd cloudfunctions/members && npm install
```

预期：node_modules 出现，jest 可用。

- [ ] **Step 5.3 写失败测试**

新建 `cloudfunctions/members/lib/__tests__/validate.test.js`：

```js
const { validateMemberData } = require('../validate');

describe('validateMemberData', () => {
  test('正常数据通过', () => {
    const result = validateMemberData({
      name: '张三',
      avatarUrl: 'https://x.com/a.jpg'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('playStyle 取值必须在枚举内', () => {
    const result = validateMemberData({
      name: '张三',
      playStyle: 'invalid-style'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('playStyle 必须是 baseliner/serve-volleyer/all-court/counter-puncher/aggressive-baseliner 之一');
  });

  test('playStyle 空值合法', () => {
    const result = validateMemberData({ name: '张三' });
    expect(result.valid).toBe(true);
  });

  test('playStyleNote 超过 100 字符不通过', () => {
    const result = validateMemberData({
      name: '张三',
      playStyleNote: 'x'.repeat(101)
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('playStyleNote 不能超过 100 字符');
  });
});
```

- [ ] **Step 5.4 运行测试 — 应失败**

```bash
cd cloudfunctions/members && npx jest
```

预期：FAIL，提示 `Cannot find module '../validate'`。

- [ ] **Step 5.5 实现 validate.js**

新建 `cloudfunctions/members/lib/validate.js`：

```js
const VALID_PLAY_STYLES = [
  'baseliner',
  'serve-volleyer',
  'all-court',
  'counter-puncher',
  'aggressive-baseliner'
];

function validateMemberData(data) {
  const errors = [];

  if (data.playStyle != null && data.playStyle !== '' && !VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`);
  }

  if (data.playStyleNote != null && typeof data.playStyleNote === 'string' && data.playStyleNote.length > 100) {
    errors.push('playStyleNote 不能超过 100 字符');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateMemberData, VALID_PLAY_STYLES };
```

- [ ] **Step 5.6 再跑测试 — 应通过**

```bash
cd cloudfunctions/members && npx jest
```

预期：4 个测试全部 PASS。

- [ ] **Step 5.7 commit**

```bash
git add cloudfunctions/members/
git commit -m "feat(members): 新增 playStyle/playStyleNote 字段校验 + Jest 测试"
```

---

## Task 6 · 将 validate 接入 members/index.js

**Files:**
- Modify: `cloudfunctions/members/index.js`

- [ ] **Step 6.1 在 index.js 中引入并调用**

找到 `'add'` 与 `'update'` 两个 action，在写入 db 之前调用校验。

修改 `cloudfunctions/members/index.js` 顶部：

```js
const cloud = require('wx-server-sdk')
const { validateMemberData } = require('./lib/validate')   // 新增
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
```

找到 `case 'add'` 块，在 `const exist = await collection.where(...)` 之前插入：

```js
const v = validateMemberData(data)
if (!v.valid) {
  return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
}
```

并在 `collection.add` 的 `data` 对象里加：

```js
data: {
  openid,
  name: data.name,
  avatarUrl: data.avatarUrl,
  phone: data.phone || '',
  status: data.status || 'active',
  admin: data.admin || false,
  playStyle: data.playStyle || '',        // 新增
  playStyleNote: data.playStyleNote || '', // 新增
  createTime: now,
  updateTime: now
}
```

`case 'update'` 块同理：先 validate，再 update。update 中只把传入的非空字段更新（保护未传字段不被清空）。

- [ ] **Step 6.2 上传云函数到云开发**

```bash
bash uploadCloudFunction.sh members
```

预期：上传成功。

- [ ] **Step 6.3 commit**

```bash
git add cloudfunctions/members/index.js
git commit -m "feat(members): index.js 接入 playStyle 校验与字段写入"
```

---

## Task 7 · tournaments 云函数加 courtTimeGrid 字段

**Files:**
- Modify: `cloudfunctions/tournaments/package.json`
- Create: `cloudfunctions/tournaments/lib/validate.js`
- Create: `cloudfunctions/tournaments/lib/__tests__/validate.test.js`
- Modify: `cloudfunctions/tournaments/index.js`

- [ ] **Step 7.1 改 tournaments/package.json 加 jest（同 Task 5.1 模式）**

- [ ] **Step 7.2 安装：`cd cloudfunctions/tournaments && npm install`**

- [ ] **Step 7.3 写失败测试 `validate.test.js`**

```js
const { validateCourtTimeGrid } = require('../validate');

describe('validateCourtTimeGrid', () => {
  test('合法 grid', () => {
    const r = validateCourtTimeGrid({
      matchDuration: 20,
      courts: [{ courtId: 'c1', name: '1号' }],
      slots: [{
        slotId: 's1',
        start: '2026-05-25T08:00:00+08:00',
        end:   '2026-05-25T08:20:00+08:00',
        availableCourtIds: ['c1']
      }]
    });
    expect(r.valid).toBe(true);
  });

  test('matchDuration 必须是 20', () => {
    const r = validateCourtTimeGrid({ matchDuration: 30, courts: [], slots: [] });
    expect(r.errors).toContain('matchDuration 必须是 20 分钟');
  });

  test('slot 引用了不存在的 courtId', () => {
    const r = validateCourtTimeGrid({
      matchDuration: 20,
      courts: [{ courtId: 'c1', name: '1号' }],
      slots: [{
        slotId: 's1', start: 'a', end: 'b',
        availableCourtIds: ['c-ghost']
      }]
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes('availableCourtIds 引用了未知 court'))).toBe(true);
  });

  test('空 grid 合法（创建时允许后填）', () => {
    const r = validateCourtTimeGrid(null);
    expect(r.valid).toBe(true);
  });
});
```

- [ ] **Step 7.4 运行 — 应失败**

```bash
cd cloudfunctions/tournaments && npx jest
```

- [ ] **Step 7.5 写 `validate.js`**

```js
function validateCourtTimeGrid(grid) {
  const errors = [];
  if (grid == null) return { valid: true, errors };

  if (grid.matchDuration !== 20) {
    errors.push('matchDuration 必须是 20 分钟');
  }
  if (!Array.isArray(grid.courts)) {
    errors.push('courts 必须是数组');
    return { valid: false, errors };
  }
  if (!Array.isArray(grid.slots)) {
    errors.push('slots 必须是数组');
    return { valid: false, errors };
  }

  const courtIdSet = new Set(grid.courts.map(c => c.courtId));
  grid.slots.forEach((slot, i) => {
    if (!Array.isArray(slot.availableCourtIds)) {
      errors.push(`slots[${i}].availableCourtIds 必须是数组`);
      return;
    }
    for (const cid of slot.availableCourtIds) {
      if (!courtIdSet.has(cid)) {
        errors.push(`slots[${i}].availableCourtIds 引用了未知 court: ${cid}`);
      }
    }
  });

  return { valid: errors.length === 0, errors };
}

module.exports = { validateCourtTimeGrid };
```

- [ ] **Step 7.6 跑测试 — 应通过**

- [ ] **Step 7.7 接入 `tournaments/index.js`**

在 `validateTournament` 旁边加调用：

```js
const { validateCourtTimeGrid } = require('./lib/validate')
// ...
function validateTournament(data) {
  const errors = []
  // 沿用现有校验...

  // 新增
  if (data.courtTimeGrid) {
    const gridResult = validateCourtTimeGrid(data.courtTimeGrid)
    if (!gridResult.valid) {
      errors.push(...gridResult.errors)
    }
  }

  return errors
}
```

并在 `collection.add` 与 `collection.update` 写入数据中包含 `courtTimeGrid: data.courtTimeGrid || null`。

- [ ] **Step 7.8 上传：`bash uploadCloudFunction.sh tournaments`**

- [ ] **Step 7.9 commit**

```bash
git add cloudfunctions/tournaments/
git commit -m "feat(tournaments): 新增 courtTimeGrid 字段与校验"
```

---

## Task 8 · match-results 云函数加结果对账字段

**关键提醒**：现有 `status` 字段含义是"比赛生命周期"（pending/ongoing/completed/cancelled），**不要覆盖**。新增 `resultStatus` 字段表示"结果确认状态"。

**Files:**
- Modify: `cloudfunctions/match-results/package.json`
- Create: `cloudfunctions/match-results/lib/validate.js`
- Create: `cloudfunctions/match-results/lib/__tests__/validate.test.js`
- Modify: `cloudfunctions/match-results/index.js`

- [ ] **Step 8.1 加 jest（同 Task 5.1）**

- [ ] **Step 8.2 安装：`cd cloudfunctions/match-results && npm install`**

- [ ] **Step 8.3 写失败测试**

```js
const { validateResultSubmission } = require('../validate');

describe('validateResultSubmission', () => {
  test('合法提交', () => {
    const r = validateResultSubmission({
      submittedBy: 'm1',
      role: 'player',
      winnerIds: 'm1',
      score: '6-3, 6-4'
    });
    expect(r.valid).toBe(true);
  });

  test('role 必须是 admin/player', () => {
    const r = validateResultSubmission({ submittedBy: 'm1', role: 'visitor', winnerIds: 'm1' });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('role 必须是 admin 或 player');
  });

  test('score 超过 50 字符不通过', () => {
    const r = validateResultSubmission({
      submittedBy: 'm1', role: 'player', winnerIds: 'm1',
      score: 'x'.repeat(51)
    });
    expect(r.errors).toContain('score 不能超过 50 字符');
  });

  test('winnerIds 缺失不通过', () => {
    const r = validateResultSubmission({ submittedBy: 'm1', role: 'player' });
    expect(r.errors).toContain('winnerIds 不能为空');
  });
});
```

- [ ] **Step 8.4 跑测试 — 失败**

- [ ] **Step 8.5 写 `validate.js`**

```js
const VALID_RESULT_STATUS = ['pending', 'confirmed', 'disputed'];

function validateResultSubmission(s) {
  const errors = [];
  if (!s.submittedBy) errors.push('submittedBy 不能为空');
  if (!['admin', 'player'].includes(s.role)) {
    errors.push('role 必须是 admin 或 player');
  }
  if (!s.winnerIds) errors.push('winnerIds 不能为空');
  if (s.score != null && typeof s.score === 'string' && s.score.length > 50) {
    errors.push('score 不能超过 50 字符');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateResultSubmission, VALID_RESULT_STATUS };
```

- [ ] **Step 8.6 跑测试 — 通过**

- [ ] **Step 8.7 接入 `match-results/index.js`**

在 `match-results/index.js` 中新增一个 action：

```js
const { validateResultSubmission } = require('./lib/validate')
// ... 在 switch (action) 里：

case 'submit-result': {
  const v = validateResultSubmission(data)
  if (!v.valid) {
    return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
  }
  // 注意：完整对账状态机在 Phase 5 实现，这里仅记录提交，不触发 points-engine
  const match = await collection.doc(data.matchId).get()
  const submissions = (match.data.submissions || []).filter(s => s.submittedBy !== data.submittedBy)
  submissions.push({
    submittedBy: data.submittedBy,
    role: data.role,
    winnerIds: data.winnerIds,
    score: data.score || '',
    submittedAt: db.serverDate()
  })
  await collection.doc(data.matchId).update({
    data: { submissions, resultStatus: 'pending' }
  })
  return { success: true, data: { resultStatus: 'pending' } }
}
```

注：完整对账逻辑（auto-confirm / disputed）在 Phase 5 实现；本期只让字段就位。

- [ ] **Step 8.8 上传：`bash uploadCloudFunction.sh match-results`**

- [ ] **Step 8.9 commit**

```bash
git add cloudfunctions/match-results/
git commit -m "feat(match-results): 新增 resultStatus/submissions 字段与基础提交"
```

---

## Task 9 · 写数据库迁移脚本

**Files:**
- Create: `cloudfunctions/migrations/001-add-new-fields.js`
- Create: `cloudfunctions/migrations/README.md`

- [ ] **Step 9.1 创建目录**

```bash
mkdir -p cloudfunctions/migrations
```

- [ ] **Step 9.2 写迁移脚本**

新建 `cloudfunctions/migrations/001-add-new-fields.js`：

```js
/**
 * 迁移脚本 001：给老数据补默认值
 *
 * 用法：
 *  1) 在微信开发者工具云开发控制台 → 数据库 → 选择对应集合 → 高级 → 直接复制此脚本到云函数执行
 *  或
 *  2) 临时把此文件改名 index.js 放进新的 migration-runner 云函数，部署后调一次
 *
 * 幂等：重复跑安全（先判断字段是否已有）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async () => {
  const report = {}

  // members: 补 playStyle/playStyleNote
  const membersRes = await db.collection('members').where({
    playStyle: _.exists(false)
  }).update({
    data: { playStyle: '', playStyleNote: '' }
  })
  report.members = membersRes.stats

  // tournaments: 补 courtTimeGrid (默认 null)
  const tournamentsRes = await db.collection('tournaments').where({
    courtTimeGrid: _.exists(false)
  }).update({
    data: { courtTimeGrid: null }
  })
  report.tournaments = tournamentsRes.stats

  // match_results: 补 resultStatus/submissions/confirmedAt/confirmedBy/disputeReason
  const matchResultsRes = await db.collection('match_results').where({
    resultStatus: _.exists(false)
  }).update({
    data: {
      resultStatus: 'pending',
      submissions: [],
      confirmedAt: null,
      confirmedBy: null,
      disputeReason: '',
      courtId: '',
      scheduledStart: null,
      scheduledSlotId: ''
    }
  })
  report.match_results = matchResultsRes.stats

  // tournament_brackets: matches[*] 内字段在生成时填，此处不需要补

  return { success: true, data: report }
}
```

- [ ] **Step 9.3 写迁移说明文档**

新建 `cloudfunctions/migrations/README.md`：

```markdown
# 数据库迁移脚本

按顺序执行。每个脚本必须**幂等**，重复跑不破坏数据。

## 已应用的迁移

| 编号 | 文件 | 内容 | 应用时间 |
|---|---|---|---|
| 001 | 001-add-new-fields.js | 给 members / tournaments / match_results 补 Phase 1 新字段默认值 | 待应用 |

## 应用方式

1. 在 cloudfunctions/ 下新建一个临时云函数目录 `migration-runner/`
2. 把待执行的 `XXX-*.js` 复制为该云函数的 `index.js`
3. `bash uploadCloudFunction.sh migration-runner` 上传
4. 在云开发控制台触发一次（"云函数 → 测试" 入口）
5. 看 return 的 stats，确认 updated 数符合预期
6. 把临时云函数删掉
7. 在本表的"应用时间"列填上日期
```

- [ ] **Step 9.4 commit**

```bash
git add cloudfunctions/migrations/
git commit -m "feat(migrations): 添加 001 字段迁移脚本"
```

---

## Task 10 · 执行迁移

**Files:** （操作云端 DB，不改本地文件）

- [ ] **Step 10.1 创建 migration-runner 云函数目录**

```bash
mkdir -p cloudfunctions/migration-runner
```

- [ ] **Step 10.2 复制迁移脚本与 package.json**

```bash
cp cloudfunctions/migrations/001-add-new-fields.js cloudfunctions/migration-runner/index.js
```

新建 `cloudfunctions/migration-runner/package.json`：

```json
{
  "name": "migration-runner",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": { "wx-server-sdk": "~3.0.4" }
}
```

- [ ] **Step 10.3 安装与上传**

```bash
cd cloudfunctions/migration-runner && npm install && cd ../..
bash uploadCloudFunction.sh migration-runner
```

- [ ] **Step 10.4 在微信开发者工具云开发控制台 → 云函数 → migration-runner → 测试 → 调用**

预期返回：

```json
{ "success": true, "data": {
  "members": { "updated": N },
  "tournaments": { "updated": M },
  "match_results": { "updated": K }
} }
```

把 N/M/K 数字记到 PROGRESS.md。

- [ ] **Step 10.5 删除 migration-runner 临时云函数（云端 + 本地）**

```bash
rm -rf cloudfunctions/migration-runner
```

云端也删（云开发控制台"云函数 → migration-runner → 删除"）。

- [ ] **Step 10.6 更新 migrations/README.md 标记应用时间**

把表格中"001"那行的"应用时间"列改为今天日期。

- [ ] **Step 10.7 commit**

```bash
git add cloudfunctions/migrations/README.md
git commit -m "chore(migrations): 应用 001 字段迁移"
```

---

## Task 11 · 更新 DATABASE_SCHEMA.md 文档

**Files:**
- Modify: `cloudfunctions/DATABASE_SCHEMA.md`

- [ ] **Step 11.1 在 members 表字段表中新增**

在第 1 节"members（会员表）"的字段表里追加 2 行：

```markdown
| `playStyle` | String | 否 | 打法风格枚举：baseliner/serve-volleyer/all-court/counter-puncher/aggressive-baseliner |
| `playStyleNote` | String | 否 | 打法备注，最多 100 字 |
```

- [ ] **Step 11.2 在 tournaments 表中追加 courtTimeGrid**

```markdown
| `courtTimeGrid` | Object | 否 | 场地×时段矩阵，结构见下面"courtTimeGrid 结构"小节 |
```

并新增小节：

```markdown
### courtTimeGrid 结构

\```json
{
  "matchDuration": 20,
  "courts": [
    { "courtId": "c1", "name": "1号场" }
  ],
  "slots": [
    {
      "slotId": "s_20260525_0800",
      "start": "2026-05-25T08:00:00+08:00",
      "end":   "2026-05-25T08:20:00+08:00",
      "availableCourtIds": ["c1"]
    }
  ]
}
\```

- `matchDuration` 固定为 20 分钟
- `slots` 粒度为 20 分钟一档
- 未被任何比赛排到的 `(slot, court)` 在前端显示为"自由拉球"
```

- [ ] **Step 11.3 在 match_results 表中追加新字段**

```markdown
| `resultStatus` | String | 是 | 'pending' \| 'confirmed' \| 'disputed'，结果对账状态 |
| `submissions` | Array | 否 | 提交记录列表，结构见下 |
| `confirmedAt` | Date | 否 | 自动/仲裁 confirmed 时间 |
| `confirmedBy` | String | 否 | 管理员仲裁时填 admin._id；双方一致 auto-confirm 时为 null |
| `disputeReason` | String | 否 | disputed 状态时的描述 |
| `courtId` | String | 否 | 排程后填 |
| `scheduledStart` | Date | 否 | 排程后填 |
| `scheduledSlotId` | String | 否 | 排程后填 |
```

并新增 submissions 结构说明：

```markdown
### submissions 子结构

\```json
[
  {
    "submittedBy": "member_xxx",
    "role": "admin",
    "winnerIds": "member_xxx",
    "score": "6-3, 6-4",
    "submittedAt": "2026-05-25T10:30:00.000Z"
  }
]
\```
- `role`: 'admin' (管理员录入，立即 confirmed) / 'player' (玩家提交，等对账)
- `winnerIds`: 单人 id，双打用逗号分隔多 id
- `score`: 纯文本存档，不解析
```

- [ ] **Step 11.4 commit**

```bash
git add cloudfunctions/DATABASE_SCHEMA.md
git commit -m "docs(schema): 同步 Phase 1 字段变更"
```

---

## Task 12 · 更新 PROGRESS.md 标记 Phase 1 完成

**Files:**
- Modify: `docs/superpowers/plans/PROGRESS.md`

- [ ] **Step 12.1 修改进度表**

```diff
- | 01 | Phase 1 · Foundation | ⬜ 待开始 | — | — | — | — |
+ | 01 | Phase 1 · Foundation | ✅ 已完成 | YYYY-MM-DD | YYYY-MM-DD | <commit-hash> | 迁移 members N / tournaments M / match_results K 条 |
```

修改总进度条：

```
[████░░░░░░░░░░░░░░░░░░░░] 1/6 Phase 完成
```

修改"当前应该做什么"：

```
**👉 下一个 Phase**：`02-phase-3-create-tournament.md`
```

在执行日志追加：

```markdown
### YYYY-MM-DD
- Phase 1 完成（commit: <hash>）
- 数据库迁移：members N 条、tournaments M 条、match_results K 条
```

- [ ] **Step 12.2 commit**

```bash
git add docs/superpowers/plans/PROGRESS.md
git commit -m "docs(progress): Phase 1 完成"
```

---

## Self-Review Checklist

完成后回查这 5 点：

- [ ] 全部 12 个 Task 都已勾完
- [ ] `cd cloudfunctions/members && npx jest` 全绿
- [ ] `cd cloudfunctions/tournaments && npx jest` 全绿
- [ ] `cd cloudfunctions/match-results && npx jest` 全绿
- [ ] 微信开发者工具打开小程序，能看到背景变白（如果还是深色，检查 app.wxss 是否成功 import）
- [ ] PROGRESS.md 已更新，下一个对话能从那里继续
