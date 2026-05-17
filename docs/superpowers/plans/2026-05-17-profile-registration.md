# 资料注册与编辑流程改造 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造小程序「我的」注册入口、edit-profile / member-edit / player-detail 与 members 云函数，使新用户走「先收集姓名+打法+头像」流程，全面切换微信原生头像/昵称组件，移除「打法备注」，并把打法替换为 6 个新 slug。

**Architecture:** 复用 `edit-profile` 页面，引入 `mode=register|edit` query；新增前端共享 `play-style` 常量；云函数 `members` 增加 `add` 必填校验与 `playStyleNote` 白名单清理；同步更新 `member-edit`（后台新增/编辑会员）和 `player-detail`（展示端）以及 `DATABASE_SCHEMA.md`、mock 数据、测试 fixture。

**Tech Stack:** 微信小程序（WXML / WXSS / JS）、wx-server-sdk 云函数（Node.js）、Jest 29 单测、wx.cloud.uploadFile（COS）。

**关联设计文档：** `docs/superpowers/specs/2026-05-17-profile-registration-design.md`

---

## 文件结构总览

### 新建
- `miniprogram/utils/play-style.js` —— 单一打法 slug/label 常量源，被 edit-profile / member-edit / player-detail 引用
- `cloudfunctions/members/__tests__/index.test.js` —— `members` 云函数 handler 集成测试
- `miniprogram/pages/edit-profile/__tests__/index.test.js` —— edit-profile 页面单测（注册/编辑模式分支）
- `miniprogram/pages/member-edit/__tests__/index.test.js` —— member-edit 页面单测（新增必填打法）

### 修改
- `miniprogram/config.js` —— 暴露 `DEFAULT_AVATAR_URL`
- `miniprogram/pages/mine/index.js` —— 未注册分支改为 `navigateTo edit-profile?mode=register`
- `miniprogram/pages/edit-profile/index.{js,wxml,wxss,json}` —— 原生 chooseAvatar / nickname、mode 分支、6 项新打法、移除「打法备注」
- `miniprogram/pages/member-edit/index.{js,wxml}` —— 增加打法 picker（新增模式必填）
- `miniprogram/pages/player-detail/index.js` —— `PLAY_STYLE_LABEL` 替换为新 6 项
- `miniprogram/pages/player-detail/index.wxml` —— 删除「关于」区域 `playStyleNote` 展示
- `miniprogram/pages/player-detail/__tests__/index.test.js` —— fixture 改用新 slug
- `miniprogram/mock/data.js` —— `playStyle` 改用新 slug，删除 `playStyleNote`
- `cloudfunctions/members/lib/validate.js` —— 新 slug 枚举、删除 playStyleNote 校验、新增 add 模式必填校验、暴露 `sanitizeMemberPayload`
- `cloudfunctions/members/lib/__tests__/validate.test.js` —— 同步新枚举与 add 校验断言
- `cloudfunctions/members/index.js` —— 调用 `sanitizeMemberPayload`、`add` 调用新 `validateMemberAdd`、`add/update/updateById` 不再落库 playStyleNote
- `cloudfunctions/migrations/001-add-new-fields.js` —— 注释/移除 `playStyleNote` 字段补默认值（数据库无脏数据，但脚本要去掉对该字段的写入）
- `cloudfunctions/DATABASE_SCHEMA.md` —— `playStyle` 枚举更新、`playStyleNote` 行删除

---

## Task 1：替换打法校验枚举与新增「add 模式必填」校验

**Files:**
- Modify: `cloudfunctions/members/lib/validate.js`
- Modify: `cloudfunctions/members/lib/__tests__/validate.test.js`

- [ ] **Step 1: 改写 validate 单测以反映新契约**

替换 `cloudfunctions/members/lib/__tests__/validate.test.js` 全文为：

```js
const {
  validateMemberData,
  validateMemberAdd,
  sanitizeMemberPayload,
  VALID_PLAY_STYLES
} = require('../validate');

describe('validateMemberData (通用校验)', () => {
  test('正常数据通过', () => {
    const result = validateMemberData({
      name: '张三',
      avatarUrl: 'https://x.com/a.jpg'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('新 6 个 playStyle 均通过', () => {
    expect(VALID_PLAY_STYLES).toEqual([
      'ice-cow', 'vers', 'iron-lady', 'moon-queen', 'grinder', 'slicer'
    ]);
    for (const playStyle of VALID_PLAY_STYLES) {
      const result = validateMemberData({ playStyle });
      expect(result.valid).toBe(true);
    }
  });

  test('旧 slug 被拒绝', () => {
    const result = validateMemberData({ playStyle: 'baseliner' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/playStyle/);
  });

  test('playStyle 空值合法（编辑场景允许不修改）', () => {
    expect(validateMemberData({}).valid).toBe(true);
    expect(validateMemberData({ playStyle: '' }).valid).toBe(true);
    expect(validateMemberData({ playStyle: null }).valid).toBe(true);
  });

  test('playStyleNote 任意输入不再触发错误（字段被忽略）', () => {
    const result = validateMemberData({
      name: '张三',
      playStyleNote: 'x'.repeat(500)
    });
    expect(result.valid).toBe(true);
  });
});

describe('validateMemberAdd (新增必填校验)', () => {
  test('姓名 + 新打法 通过', () => {
    const result = validateMemberAdd({ name: '张三', playStyle: 'ice-cow' });
    expect(result.valid).toBe(true);
  });

  test('缺姓名失败', () => {
    const result = validateMemberAdd({ playStyle: 'ice-cow' });
    expect(result.valid).toBe(false);
    expect(result.errors.join(';')).toMatch(/姓名|name/);
  });

  test('缺打法失败', () => {
    const result = validateMemberAdd({ name: '张三' });
    expect(result.valid).toBe(false);
    expect(result.errors.join(';')).toMatch(/打法|playStyle/);
  });

  test('姓名为空白字符串失败', () => {
    const result = validateMemberAdd({ name: '   ', playStyle: 'vers' });
    expect(result.valid).toBe(false);
  });

  test('打法 slug 非法失败', () => {
    const result = validateMemberAdd({ name: '张三', playStyle: 'baseliner' });
    expect(result.valid).toBe(false);
  });
});

describe('sanitizeMemberPayload (白名单)', () => {
  test('剔除 playStyleNote、createTime、updateTime、openid', () => {
    const result = sanitizeMemberPayload({
      name: '张三',
      phone: '13800000000',
      avatarUrl: 'x.jpg',
      status: 'active',
      admin: true,
      playStyle: 'vers',
      playStyleNote: '不应保留',
      createTime: 'x',
      updateTime: 'x',
      openid: 'should-not-write',
      arbitrary: 'drop me'
    });
    expect(result).toEqual({
      name: '张三',
      phone: '13800000000',
      avatarUrl: 'x.jpg',
      status: 'active',
      admin: true,
      playStyle: 'vers'
    });
  });

  test('未传入字段不会出现在输出', () => {
    const result = sanitizeMemberPayload({ name: '李四' });
    expect(Object.keys(result)).toEqual(['name']);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd cloudfunctions/members && npx jest lib/__tests__/validate.test.js -v`
Expected: 多条 FAIL（新枚举不匹配、`validateMemberAdd` / `sanitizeMemberPayload` 未定义）。

- [ ] **Step 3: 重写 validate.js 以实现新契约**

把 `cloudfunctions/members/lib/validate.js` 全文替换为：

```js
const VALID_PLAY_STYLES = [
  'ice-cow',
  'vers',
  'iron-lady',
  'moon-queen',
  'grinder',
  'slicer'
];

const ALLOWED_MEMBER_FIELDS = [
  'name',
  'phone',
  'avatarUrl',
  'status',
  'admin',
  'playStyle'
];

function validateMemberData(data) {
  const errors = [];
  if (data == null) return { valid: true, errors };

  if (data.playStyle != null && data.playStyle !== '' && !VALID_PLAY_STYLES.includes(data.playStyle)) {
    errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`);
  }

  return { valid: errors.length === 0, errors };
}

function validateMemberAdd(data) {
  const base = validateMemberData(data || {});
  const errors = [...base.errors];

  const name = data && typeof data.name === 'string' ? data.name.trim() : '';
  if (!name) {
    errors.push('姓名不能为空');
  }

  const playStyle = data && data.playStyle;
  if (!playStyle) {
    errors.push('打法为必填项');
  } else if (!VALID_PLAY_STYLES.includes(playStyle)) {
    // already covered by base, but ensure presence even if base skipped (empty string handled above)
    if (!errors.some((e) => e.startsWith('playStyle'))) {
      errors.push(`playStyle 必须是 ${VALID_PLAY_STYLES.join('/')} 之一`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function sanitizeMemberPayload(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const key of ALLOWED_MEMBER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      out[key] = data[key];
    }
  }
  return out;
}

module.exports = {
  validateMemberData,
  validateMemberAdd,
  sanitizeMemberPayload,
  VALID_PLAY_STYLES,
  ALLOWED_MEMBER_FIELDS
};
```

- [ ] **Step 4: 重跑测试确认通过**

Run: `cd cloudfunctions/members && npx jest lib/__tests__/validate.test.js -v`
Expected: 所有测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/members/lib/validate.js cloudfunctions/members/lib/__tests__/validate.test.js
git commit -m "feat(members): swap play-style enum and add register-mode validators"
```

---

## Task 2：members 云函数 handler 接入 sanitize + add 必填

**Files:**
- Modify: `cloudfunctions/members/index.js`
- Create: `cloudfunctions/members/__tests__/index.test.js`

- [ ] **Step 1: 新建 handler 集成测试**

创建 `cloudfunctions/members/__tests__/index.test.js`：

```js
const addMock = jest.fn(async () => ({ _id: 'm1' }));
const getMock = jest.fn(async () => ({ data: [] }));
const updateMock = jest.fn(async () => ({ stats: { updated: 1 } }));
const removeMock = jest.fn(async () => ({ stats: { removed: 1 } }));
const docMock = jest.fn(() => ({ update: updateMock, remove: removeMock, get: jest.fn(async () => ({ data: { _id: 'm1' } })) }));
const whereMock = jest.fn(() => ({
  get: getMock,
  update: updateMock,
  remove: removeMock,
  orderBy: () => ({ skip: () => ({ limit: () => ({ get: getMock }) }) })
}));
const collectionMock = {
  add: addMock,
  where: whereMock,
  doc: docMock
};

jest.mock('wx-server-sdk', () => ({
  init: jest.fn(),
  DYNAMIC_CURRENT_ENV: 'env',
  getWXContext: () => ({ OPENID: 'openid-test' }),
  database: () => ({
    collection: () => collectionMock,
    command: { or: (x) => x, and: (x) => x },
    RegExp: ({ regexp }) => regexp,
    serverDate: () => new Date('2026-05-17T00:00:00Z')
  })
}));

beforeEach(() => {
  addMock.mockClear();
  getMock.mockClear();
  updateMock.mockClear();
  removeMock.mockClear();
  whereMock.mockClear();
  docMock.mockClear();
});

const { main } = require('../index');

describe('members action=add', () => {
  test('缺姓名返回 VALIDATION_FAILED', async () => {
    const res = await main({ action: 'add', data: { playStyle: 'ice-cow' } });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('VALIDATION_FAILED');
    expect(addMock).not.toHaveBeenCalled();
  });

  test('缺打法返回 VALIDATION_FAILED', async () => {
    const res = await main({ action: 'add', data: { name: '张三' } });
    expect(res.success).toBe(false);
    expect(res.error.code).toBe('VALIDATION_FAILED');
    expect(addMock).not.toHaveBeenCalled();
  });

  test('已存在 openid 返回 already registered，不再写库', async () => {
    getMock.mockResolvedValueOnce({ data: [{ _id: 'existing', name: '老用户' }] });
    const res = await main({
      action: 'add',
      data: { name: '张三', playStyle: 'vers' }
    });
    expect(res.errMsg).toBe('already registered');
    expect(addMock).not.toHaveBeenCalled();
  });

  test('合法数据写入时剔除 playStyleNote 与额外字段', async () => {
    const res = await main({
      action: 'add',
      data: {
        name: '  张三  ',
        avatarUrl: 'a.jpg',
        playStyle: 'ice-cow',
        playStyleNote: '不该落库',
        admin: false,
        bogus: 'x'
      }
    });
    expect(res._id).toBe('m1');
    expect(addMock).toHaveBeenCalledTimes(1);
    const written = addMock.mock.calls[0][0].data;
    expect(written.openid).toBe('openid-test');
    expect(written.playStyle).toBe('ice-cow');
    expect(written).not.toHaveProperty('playStyleNote');
    expect(written).not.toHaveProperty('bogus');
    expect(written.createTime).toBeInstanceOf(Date);
    expect(written.updateTime).toBeInstanceOf(Date);
  });
});

describe('members action=update', () => {
  test('剔除 playStyleNote 与 openid', async () => {
    const res = await main({
      action: 'update',
      data: {
        name: '张三',
        playStyle: 'grinder',
        playStyleNote: '不该落库',
        openid: 'should-not-overwrite'
      }
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    const written = updateMock.mock.calls[0][0].data;
    expect(written).not.toHaveProperty('playStyleNote');
    expect(written).not.toHaveProperty('openid');
    expect(written.playStyle).toBe('grinder');
    expect(written.updateTime).toBeInstanceOf(Date);
    expect(res.stats.updated).toBe(1);
  });
});

describe('members action=updateById', () => {
  test('缺 _id 返回错误', async () => {
    const res = await main({ action: 'updateById', data: { name: 'x' } });
    expect(res.errMsg).toBe('_id is required');
    expect(docMock).not.toHaveBeenCalled();
  });

  test('剔除 playStyleNote', async () => {
    const res = await main({
      action: 'updateById',
      _id: 'm1',
      data: { name: '张三', playStyle: 'slicer', playStyleNote: '不该落库' }
    });
    expect(docMock).toHaveBeenCalledWith('m1');
    const written = updateMock.mock.calls[0][0].data;
    expect(written).not.toHaveProperty('playStyleNote');
    expect(written.playStyle).toBe('slicer');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd cloudfunctions/members && npx jest __tests__/index.test.js -v`
Expected: 多条 FAIL（playStyleNote 仍被写入；add 校验未升级）。

- [ ] **Step 3: 重写 handler 以使用 sanitize / validateMemberAdd**

把 `cloudfunctions/members/index.js` 全文替换为：

```js
// 云函数入口文件
const cloud = require('wx-server-sdk')
const {
  validateMemberData,
  validateMemberAdd,
  sanitizeMemberPayload
} = require('./lib/validate')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const collection = db.collection('members')

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const { action, data, page = 1, pageSize = 10, keyword, _id } = event

  switch (action) {
    case 'add': {
      const payload = sanitizeMemberPayload(data || {})
      if (typeof payload.name === 'string') payload.name = payload.name.trim()
      const v = validateMemberAdd(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const exist = await collection.where({ openid }).get()
      if (exist.data && exist.data.length > 0) {
        return { errMsg: 'already registered', data: exist.data[0] }
      }
      const now = db.serverDate()
      return await collection.add({
        data: {
          openid,
          status: 'active',
          admin: false,
          ...payload,
          createTime: now,
          updateTime: now
        }
      })
    }
    case 'get': {
      return await collection.where({ openid }).get()
    }
    case 'update': {
      const payload = sanitizeMemberPayload(data || {})
      if (typeof payload.name === 'string') payload.name = payload.name.trim()
      const v = validateMemberData(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const now = db.serverDate()
      return await collection.where({ openid }).update({
        data: {
          ...payload,
          updateTime: now
        }
      })
    }
    case 'delete': {
      return await collection.where({ openid }).remove()
    }
    case 'search': {
      const query = []
      if (keyword) {
        query.push(
          _.or([
            { name: db.RegExp({ regexp: keyword, options: 'i' }) },
            { phone: db.RegExp({ regexp: keyword, options: 'i' }) }
          ])
        )
      }
      return await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    }
    case 'list': {
      const query = []
      if (data && data.status) {
        query.push({ status: data.status })
      }
      return await collection
        .where(query.length ? _.and(query) : {})
        .orderBy('createTime', 'desc')
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .get()
    }
    case 'updateById': {
      if (!_id) {
        return { errMsg: '_id is required' }
      }
      const payload = sanitizeMemberPayload(data || {})
      if (typeof payload.name === 'string') payload.name = payload.name.trim()
      const v = validateMemberData(payload)
      if (!v.valid) {
        return { success: false, error: { code: 'VALIDATION_FAILED', message: v.errors.join('; ') } }
      }
      const now = db.serverDate()
      return await collection.doc(_id).update({
        data: {
          ...payload,
          updateTime: now
        }
      })
    }
    case 'deleteById': {
      if (!_id) {
        return { errMsg: '_id is required' }
      }
      return await collection.doc(_id).remove()
    }
    case 'getById': {
      if (!_id) {
        return { success: false, error: { code: 'MISSING_PARAM', message: '_id is required' } };
      }
      return await collection.doc(_id).get();
    }
    default:
      return { errMsg: 'invalid action' }
  }
}
```

- [ ] **Step 4: 重跑全部 members 测试**

Run: `cd cloudfunctions/members && npx jest -v`
Expected: 所有用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add cloudfunctions/members/index.js cloudfunctions/members/__tests__/index.test.js
git commit -m "feat(members): sanitize payload and enforce add-mode required fields"
```

---

## Task 3：清理 migration 与数据库文档

**Files:**
- Modify: `cloudfunctions/migrations/001-add-new-fields.js`
- Modify: `cloudfunctions/DATABASE_SCHEMA.md`

- [ ] **Step 1: 修改 migration，不再写入 playStyleNote**

把 `cloudfunctions/migrations/001-add-new-fields.js` 中 `members` 段：

```js
  // members: 补 playStyle 默认空字符串（playStyleNote 字段已废弃，不再写入）
  const membersRes = await db.collection('members').where({
    playStyle: _.exists(false)
  }).update({
    data: { playStyle: '' }
  })
  report.members = membersRes.stats
```

- [ ] **Step 2: 更新 DATABASE_SCHEMA.md**

把 `cloudfunctions/DATABASE_SCHEMA.md` 中 members 段两行替换为：

```
| `playStyle` | String | 否 | 打法风格枚举：ice-cow/vers/iron-lady/moon-queen/grinder/slicer（注册时必填，编辑时可改） |
```

并删除 `playStyleNote` 整行。同时把示例 JSON 顶部 `"admin": false,` 之后补一行 `"playStyle": "vers",` 让示例自洽（如果原示例没有 playStyle 行就插入，否则只更新值）。

- [ ] **Step 3: Commit**

```bash
git add cloudfunctions/migrations/001-add-new-fields.js cloudfunctions/DATABASE_SCHEMA.md
git commit -m "chore(members): drop playStyleNote from migration and schema doc"
```

---

## Task 4：前端共享打法常量 + 默认头像常量

**Files:**
- Create: `miniprogram/utils/play-style.js`
- Modify: `miniprogram/config.js`

- [ ] **Step 1: 新建 play-style 常量模块**

写入 `miniprogram/utils/play-style.js`：

```js
const PLAY_STYLE_OPTIONS = [
  { value: 'ice-cow', label: '冰上母牛' },
  { value: 'vers', label: 'Vers' },
  { value: 'iron-lady', label: '女金刚' },
  { value: 'moon-queen', label: '月亮女王' },
  { value: 'grinder', label: '磨女' },
  { value: 'slicer', label: '削削乐' }
]

const PLAY_STYLE_VALUES = PLAY_STYLE_OPTIONS.map((o) => o.value)

const PLAY_STYLE_LABEL = PLAY_STYLE_OPTIONS.reduce((map, item) => {
  map[item.value] = item.label
  return map
}, {})

function getPlayStyleLabel(value) {
  if (!value) return ''
  return PLAY_STYLE_LABEL[value] || ''
}

module.exports = {
  PLAY_STYLE_OPTIONS,
  PLAY_STYLE_VALUES,
  PLAY_STYLE_LABEL,
  getPlayStyleLabel
}
```

- [ ] **Step 2: 暴露默认头像常量**

修改 `miniprogram/config.js` 全文为：

```js
module.exports = {
  USE_MOCK: false,
  MOCK_SCENARIO: 'success',
  MOCK_DELAY_MS: 120,
  DEFAULT_AVATAR_URL: '/images/icons/usercenter.png'
}
```

- [ ] **Step 3: Commit**

```bash
git add miniprogram/utils/play-style.js miniprogram/config.js
git commit -m "feat(miniprogram): add shared play-style constants and default avatar"
```

---

## Task 5：edit-profile 改造（注册/编辑双模式 + 原生头像/昵称 + 6 项新打法）

**Files:**
- Modify: `miniprogram/pages/edit-profile/index.json`
- Modify: `miniprogram/pages/edit-profile/index.wxml`
- Modify: `miniprogram/pages/edit-profile/index.js`
- Modify: `miniprogram/pages/edit-profile/index.wxss`

- [ ] **Step 1: 调整 json（注册模式下导航栏标题暂保留为「编辑资料」，标题在 JS 里 setNavigationBarTitle 处理）**

`miniprogram/pages/edit-profile/index.json` 保持不变（已是 `编辑资料`），无需修改。跳过本步骤的写入；只在 JS 里通过 `wx.setNavigationBarTitle` 切换。

- [ ] **Step 2: 重写 WXML**

把 `miniprogram/pages/edit-profile/index.wxml` 全文替换为：

```xml
<view class="ep-page">

  <view class="ep-head anim-stage-rise">
    <view class="head-tapes">
      <text class="tape tape-stamped">{{isRegister ? 'PROFILE · 注册' : 'PROFILE · 编辑'}}</text>
    </view>
    <text class="head-title">{{isRegister ? '注册' : '编辑资料'}}</text>
  </view>

  <view class="ep-form anim-stage-rise anim-delay-1">
    <view class="form-item form-item-avatar">
      <view class="field-label">
        <text class="num field-num">01</text>
        <text class="field-text">头像 <text class="optional">(选填)</text></text>
      </view>
      <button
        class="avatar-row tap-scale"
        open-type="chooseAvatar"
        bindchooseavatar="onChooseAvatar"
      >
        <view class="avatar-wrap">
          <image class="avatar-img" src="{{formData.avatarUrl || defaultAvatar}}" mode="aspectFill" />
        </view>
        <view class="avatar-meta">
          <text class="avatar-meta-label">CHANGE</text>
          <text class="avatar-meta-val">点击更换 →</text>
        </view>
      </button>
    </view>

    <view class="form-item">
      <view class="field-label">
        <text class="num field-num">02</text>
        <text class="field-text">姓名 <text class="required">*</text></text>
      </view>
      <input
        class="form-input"
        type="nickname"
        placeholder="请输入姓名"
        placeholder-class="form-placeholder"
        value="{{formData.name}}"
        bindinput="onNameInput"
        maxlength="20"
      />
    </view>

    <view class="form-item">
      <view class="field-label">
        <text class="num field-num">03</text>
        <text class="field-text">手机号 <text class="optional">(选填)</text></text>
      </view>
      <input
        class="form-input num"
        type="number"
        placeholder="请输入手机号"
        placeholder-class="form-placeholder"
        value="{{formData.phone}}"
        bindinput="onPhoneInput"
        maxlength="11"
      />
    </view>

    <view class="form-item">
      <view class="field-label">
        <text class="num field-num">04</text>
        <text class="field-text">打法 <text wx:if="{{isRegister}}" class="required">*</text><text wx:else class="optional">(选填)</text></text>
      </view>
      <radio-group class="play-style-group" bindchange="onPlayStyleChange">
        <label class="ps-radio" wx:for="{{playStyleOptions}}" wx:key="value">
          <radio value="{{item.value}}" checked="{{formData.playStyle === item.value}}" />
          <text class="ps-radio-label">{{item.label}}</text>
        </label>
      </radio-group>
    </view>
  </view>

  <view class="ep-footer">
    <view wx:if="{{!isRegister}}" class="footer-btn footer-btn-ghost tap-scale" bindtap="onCancel">取消</view>
    <view class="footer-btn footer-btn-primary tap-scale" bindtap="onSave">{{isRegister ? '完成注册' : '保存'}}</view>
  </view>
</view>
```

- [ ] **Step 3: 重写页面 JS**

把 `miniprogram/pages/edit-profile/index.js` 全文替换为：

```js
const { callFunction } = require('../../utils/cloud')
const { PLAY_STYLE_OPTIONS, PLAY_STYLE_VALUES } = require('../../utils/play-style')
const { DEFAULT_AVATAR_URL } = require('../../config')

Page({
  data: {
    isRegister: false,
    defaultAvatar: DEFAULT_AVATAR_URL,
    formData: {
      name: '',
      phone: '',
      avatarUrl: '',
      playStyle: null
    },
    playStyleOptions: PLAY_STYLE_OPTIONS
  },

  onLoad(query) {
    const isRegister = (query && query.mode) === 'register'
    this.setData({ isRegister })
    wx.setNavigationBarTitle({ title: isRegister ? '注册' : '编辑资料' })
    if (!isRegister) {
      this.loadUserInfo()
    }
  },

  async loadUserInfo() {
    const currentMember = getApp().globalData.currentMember
    if (currentMember) {
      this.setUserForm(currentMember)
      return
    }

    try {
      const res = await callFunction({ name: 'members', data: { action: 'get' } })
      const user = res.result && res.result.data && res.result.data[0]
      if (user) this.setUserForm(user)
    } catch (err) {
      console.error('[edit-profile] loadUserInfo', err)
    }
  },

  setUserForm(user) {
    this.setData({
      formData: {
        name: user.name || '',
        phone: user.phone || '',
        avatarUrl: user.avatarUrl || '',
        playStyle: PLAY_STYLE_VALUES.includes(user.playStyle) ? user.playStyle : null
      }
    })
  },

  onChooseAvatar(e) {
    const tempPath = e.detail && e.detail.avatarUrl
    if (!tempPath) return
    this.uploadAvatar(tempPath)
  },

  uploadAvatar(filePath) {
    wx.showLoading({ title: '上传中...' })
    const cloudPath = `avatar/${Date.now()}.jpg`
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success: (uploadRes) => {
        this.setData({ 'formData.avatarUrl': uploadRes.fileID })
        wx.hideLoading()
        wx.showToast({ title: '上传成功', icon: 'success' })
      },
      fail: () => {
        wx.hideLoading()
        wx.showToast({ title: '上传失败', icon: 'error' })
      }
    })
  },

  onNameInput(e) {
    this.setData({ 'formData.name': e.detail.value })
  },

  onPhoneInput(e) {
    this.setData({ 'formData.phone': e.detail.value })
  },

  onPlayStyleChange(e) {
    const value = e.detail.value || null
    this.setData({ 'formData.playStyle': PLAY_STYLE_VALUES.includes(value) ? value : null })
  },

  onCancel() {
    wx.navigateBack()
  },

  async onSave() {
    const { isRegister } = this.data
    const { name, phone, avatarUrl, playStyle } = this.data.formData
    const cleanName = (name || '').trim()

    if (!cleanName) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请输入正确的手机号', icon: 'none' })
      return
    }
    if (isRegister && !playStyle) {
      wx.showToast({ title: '请选择打法', icon: 'none' })
      return
    }

    wx.showLoading({ title: isRegister ? '注册中...' : '保存中...' })

    try {
      const payload = {
        name: cleanName,
        phone: phone || '',
        avatarUrl: avatarUrl || DEFAULT_AVATAR_URL,
        playStyle: playStyle || ''
      }
      const action = isRegister ? 'add' : 'update'
      const res = await callFunction({ name: 'members', data: { action, data: payload } })

      if (res.result && res.result.success === false) {
        wx.hideLoading()
        wx.showToast({ title: (res.result.error && res.result.error.message) || '保存失败', icon: 'none' })
        return
      }

      const app = getApp()
      if (app && app.globalData) {
        app.globalData.currentMember = {
          ...(app.globalData.currentMember || {}),
          ...payload
        }
      }

      wx.hideLoading()
      wx.showToast({ title: isRegister ? '注册成功' : '保存成功', icon: 'success' })

      setTimeout(() => {
        if (isRegister) {
          wx.reLaunch({ url: '/pages/mine/index' })
        } else {
          wx.navigateBack()
        }
      }, 600)
    } catch (err) {
      console.error('[edit-profile] onSave', err)
      wx.hideLoading()
      wx.showToast({ title: '保存失败', icon: 'error' })
    }
  }
})
```

- [ ] **Step 4: 调整 WXSS：让 `button.avatar-row` 表现为 view（去掉 button 默认边框/padding）**

在 `miniprogram/pages/edit-profile/index.wxss` 文件末尾追加：

```css
/* 抹平 button 默认样式以保持 avatar-row 视觉一致 */
button.avatar-row {
  width: 100%;
  margin: 0;
  text-align: left;
  line-height: 1.4;
}
button.avatar-row::after {
  border: none;
}
```

同时删除文件中已不使用的 `.form-textarea` 与 `.form-counter` 两个块（位于「INPUT」分区的末尾，约 169-188 行），因为「打法备注」已移除。

- [ ] **Step 5: 在开发者工具里编译，确认页面渲染无 schema/语法错误**

Run（本地命令行无法启动微信工具，需要研发自查）：在微信开发者工具点击「编译」，控制台无报错；进入 `/pages/edit-profile/index?mode=register` 与不带参数两种 URL 验证文案切换。

- [ ] **Step 6: Commit**

```bash
git add miniprogram/pages/edit-profile/index.wxml miniprogram/pages/edit-profile/index.js miniprogram/pages/edit-profile/index.wxss
git commit -m "feat(edit-profile): wx native avatar/nickname, mode-aware register flow"
```

---

## Task 6：edit-profile 页面单测（注册/编辑分支）

**Files:**
- Create: `miniprogram/pages/edit-profile/__tests__/index.test.js`

- [ ] **Step 1: 写单测**

新建 `miniprogram/pages/edit-profile/__tests__/index.test.js`：

```js
function loadPage(overrides = {}) {
  jest.resetModules()
  let pageDef
  global.wx = {
    navigateBack: jest.fn(),
    navigateTo: jest.fn(),
    reLaunch: jest.fn(),
    showToast: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    setNavigationBarTitle: jest.fn(),
    cloud: { uploadFile: jest.fn() }
  }
  global.getApp = () => ({ globalData: { currentMember: null, ...overrides } })
  global.Page = (def) => { pageDef = def }
  jest.mock('../../../utils/cloud', () => ({ callFunction: jest.fn() }))
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  const ctx = {
    ...def,
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) {
      for (const key of Object.keys(patch)) {
        if (key.includes('.')) {
          const [head, ...rest] = key.split('.')
          let cur = this.data[head]
          for (let i = 0; i < rest.length - 1; i++) cur = cur[rest[i]]
          cur[rest[rest.length - 1]] = patch[key]
        } else {
          this.data[key] = patch[key]
        }
      }
    }
  }
  Object.assign(ctx.data, data)
  return ctx
}

describe('edit-profile mode handling', () => {
  test('mode=register 时设置导航标题与 isRegister', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.onLoad({ mode: 'register' })
    expect(ctx.data.isRegister).toBe(true)
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({ title: '注册' })
  })

  test('mode 缺省时为编辑模式', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.onLoad({})
    expect(ctx.data.isRegister).toBe(false)
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({ title: '编辑资料' })
  })
})

describe('edit-profile validation', () => {
  test('注册模式缺打法时拒绝保存', async () => {
    const def = loadPage()
    const ctx = makeCtx(def, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: null }
    await ctx.onSave()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择打法', icon: 'none' })
  })

  test('编辑模式不要求打法必填', async () => {
    const def = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { stats: { updated: 1 } } })
    const ctx = makeCtx(def, { isRegister: false })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: null }
    await ctx.onSave()
    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(callFunction.mock.calls[0][0].data.action).toBe('update')
  })

  test('注册模式保存成功后 reLaunch 到 mine', async () => {
    jest.useFakeTimers()
    const def = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({ result: { _id: 'm1' } })
    const ctx = makeCtx(def, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'ice-cow' }
    await ctx.onSave()
    jest.runAllTimers()
    expect(wx.reLaunch).toHaveBeenCalledWith({ url: '/pages/mine/index' })
    jest.useRealTimers()
  })

  test('校验失败响应展示错误消息', async () => {
    const def = loadPage()
    const { callFunction } = require('../../../utils/cloud')
    callFunction.mockResolvedValueOnce({
      result: { success: false, error: { code: 'VALIDATION_FAILED', message: '打法为必填项' } }
    })
    const ctx = makeCtx(def, { isRegister: true })
    ctx.data.formData = { name: '张三', phone: '', avatarUrl: '', playStyle: 'ice-cow' }
    await ctx.onSave()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '打法为必填项', icon: 'none' })
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })
})

describe('edit-profile avatar', () => {
  test('onChooseAvatar 调用 uploadFile', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.uploadAvatar = jest.fn()
    ctx.onChooseAvatar({ detail: { avatarUrl: 'wxfile://temp-path' } })
    expect(ctx.uploadAvatar).toHaveBeenCalledWith('wxfile://temp-path')
  })
})
```

- [ ] **Step 2: 运行测试**

Run: `cd miniprogram && npx jest pages/edit-profile -v`
Expected: 所有用例 PASS。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/edit-profile/__tests__/index.test.js
git commit -m "test(edit-profile): cover register/edit modes and validation paths"
```

---

## Task 7：mine 页未注册分支改为跳转注册

**Files:**
- Modify: `miniprogram/pages/mine/index.js`

- [ ] **Step 1: 替换 onLogin 未注册分支**

把 `miniprogram/pages/mine/index.js` 的 `onLogin` 整段函数替换为：

```js
	onLogin() {
		wx.showLoading({ title: '登录中...' })

		wx.cloud.callFunction({
			name: 'members',
			data: { action: 'get' },
			success: (getRes) => {
				wx.hideLoading()

				if (getRes.result && getRes.result.data && getRes.result.data.length > 0) {
					const user = getRes.result.data[0]
					this.setData({
						isLogin: true,
						isAdmin: user.admin || false,
						userInfo: {
							avatarUrl: user.avatarUrl || DEFAULT_AVATAR,
							name: user.name || '微信用户'
						},
						currentMemberId: user._id
					})
					app.globalData.currentMember = user
					app.globalData.isAdmin = !!user.admin
					this.loadUserPoints(user._id)
					wx.showToast({ title: '登录成功', icon: 'success' })
				} else {
					// 未注册 → 直接跳转到 edit-profile 走注册模式
					wx.navigateTo({ url: '/pages/edit-profile/index?mode=register' })
				}
			},
			fail: () => {
				wx.hideLoading()
				wx.showToast({ title: '登录失败', icon: 'error' })
			}
		})
	},
```

- [ ] **Step 2: 手动验证（开发者工具）**

在微信开发者工具：
1. 通过云开发控制台删除当前 openid 的 members 记录
2. 编译，进入「我的」点「登录/注册」
3. 期望：直接跳到 edit-profile 注册模式，且 members 集合无新增脏数据

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/mine/index.js
git commit -m "feat(mine): route unregistered users to register form instead of placeholder add"
```

---

## Task 8：member-edit 增加打法 picker（后台新增/编辑会员）

**Files:**
- Modify: `miniprogram/pages/member-edit/index.js`
- Modify: `miniprogram/pages/member-edit/index.wxml`

- [ ] **Step 1: 修改 JS 引入打法选项并校验**

把 `miniprogram/pages/member-edit/index.js` 全文替换为：

```js
const { PLAY_STYLE_OPTIONS, PLAY_STYLE_VALUES } = require('../../utils/play-style')

Page({
  data: {
    isEdit: false,
    member: { name: '', phone: '', avatarUrl: '', status: '', admin: false, playStyle: '' },
    memberId: '',
    statusOptions: [
      { label: '活跃', value: 'active' },
      { label: '不活跃', value: 'inactive' }
    ],
    statusIndex: 0,
    playStyleOptions: PLAY_STYLE_OPTIONS,
    playStyleIndex: -1
  },

  onLoad(options) {
    if (options.member) {
      const member = JSON.parse(decodeURIComponent(options.member))
      const statusIndex = this.data.statusOptions.findIndex((s) => s.value === member.status)
      const playStyleIndex = PLAY_STYLE_VALUES.indexOf(member.playStyle || '')
      this.setData({
        isEdit: true,
        member: { ...this.data.member, ...member },
        memberId: member._id,
        statusIndex: statusIndex >= 0 ? statusIndex : 0,
        playStyleIndex
      })
    } else {
      this.setData({
        'member.status': 'active',
        'member.admin': false,
        statusIndex: 0,
        playStyleIndex: -1
      })
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`member.${key}`]: e.detail.value })
  },

  onPickStatus(e) {
    const idx = e.detail.value
    this.setData({
      statusIndex: idx,
      'member.status': this.data.statusOptions[idx].value
    })
  },

  onPickPlayStyle(e) {
    const idx = Number(e.detail.value)
    const option = this.data.playStyleOptions[idx]
    if (!option) return
    this.setData({
      playStyleIndex: idx,
      'member.playStyle': option.value
    })
  },

  onAdminChange(e) {
    this.setData({ 'member.admin': e.detail.value })
  },

  onDeleteMember() {
    wx.showModal({
      title: '删除会员',
      content: '确定要删除该会员吗？删除后数据将无法恢复！',
      confirmText: '确认删除',
      confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...' })
          wx.cloud.callFunction({
            name: 'members',
            data: { action: 'deleteById', _id: this.data.memberId },
            success: () => {
              wx.hideLoading()
              wx.showToast({ title: '删除成功', icon: 'success' })
              getApp().globalData.memberDelete = this.data.memberId
              setTimeout(() => wx.navigateBack(), 500)
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '删除失败', icon: 'error' })
            }
          })
        }
      }
    })
  },

  onSubmit() {
    const member = this.data.member

    if (!member.name || !member.status) {
      wx.showToast({ title: '请填写必填项', icon: 'none' })
      return
    }
    if (!this.data.isEdit && !member.playStyle) {
      wx.showToast({ title: '请选择打法', icon: 'none' })
      return
    }
    if (member.playStyle && !PLAY_STYLE_VALUES.includes(member.playStyle)) {
      wx.showToast({ title: '打法选项不合法', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    if (this.data.isEdit) {
      wx.cloud.callFunction({
        name: 'members',
        data: {
          action: 'updateById',
          _id: this.data.memberId,
          data: {
            name: member.name,
            phone: member.phone,
            status: member.status,
            admin: member.admin,
            playStyle: member.playStyle || ''
          }
        },
        success: () => {
          wx.hideLoading()
          wx.showToast({ title: '保存成功', icon: 'success' })
          getApp().globalData.memberUpdate = {
            _id: this.data.memberId,
            name: member.name,
            phone: member.phone,
            status: member.status,
            admin: member.admin,
            playStyle: member.playStyle || ''
          }
          setTimeout(() => wx.navigateBack(), 500)
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '保存失败', icon: 'error' })
        }
      })
    } else {
      wx.cloud.callFunction({
        name: 'members',
        data: { action: 'add', data: member },
        success: (res) => {
          wx.hideLoading()
          if (res.result && res.result.success === false) {
            wx.showToast({ title: (res.result.error && res.result.error.message) || '新增失败', icon: 'none' })
            return
          }
          if (res.result.errMsg === 'already registered') {
            wx.showToast({ title: '会员已存在', icon: 'none' })
          } else {
            wx.showToast({ title: '新增成功', icon: 'success' })
            getApp().globalData.memberRefresh = true
            setTimeout(() => wx.navigateBack(), 500)
          }
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '新增失败', icon: 'error' })
        }
      })
    }
  },

  onCancel() {
    wx.showModal({
      title: '确认取消',
      content: '确定要放弃当前编辑内容吗？',
      success: (res) => {
        if (res.confirm) wx.navigateBack()
      }
    })
  }
})
```

- [ ] **Step 2: 修改 WXML 增加打法 picker 项**

在 `miniprogram/pages/member-edit/index.wxml` 中，把原 `04 管理员权限` 那一项前面插入一个新的 form-item（编号顺延），同时把 `04 → 05`：

替换 `<view class="form-item">` 中 04 项块（管理员权限）改为 05，并在其前插入：

```xml
    <view class="form-item">
      <view class="field-label">
        <text class="num field-num">04</text>
        <text class="field-text">打法 <text wx:if="{{!isEdit}}" class="required">*</text><text wx:else class="optional">(选填)</text></text>
      </view>
      <picker mode="selector" range="{{playStyleOptions}}" range-key="label" value="{{playStyleIndex}}" bindchange="onPickPlayStyle">
        <view class="form-input picker-input">
          <text class="{{member.playStyle ? '' : 'form-placeholder'}}">{{member.playStyle ? playStyleOptions[playStyleIndex].label : '选择打法'}}</text>
          <text class="picker-arrow num">→</text>
        </view>
      </picker>
    </view>
```

完整修改后该段 form 的编号顺序应为 01 姓名 → 02 手机 → 03 状态 → 04 打法 → 05 管理员权限。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/member-edit/index.js miniprogram/pages/member-edit/index.wxml
git commit -m "feat(member-edit): require play style for new members in admin form"
```

---

## Task 9：member-edit 页面单测（新增必填打法）

**Files:**
- Create: `miniprogram/pages/member-edit/__tests__/index.test.js`

- [ ] **Step 1: 写测试**

新建 `miniprogram/pages/member-edit/__tests__/index.test.js`：

```js
function loadPage() {
  jest.resetModules()
  let pageDef
  global.wx = {
    showToast: jest.fn(),
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showModal: jest.fn(),
    navigateBack: jest.fn(),
    cloud: { callFunction: jest.fn() }
  }
  global.getApp = () => ({ globalData: {} })
  global.Page = (def) => { pageDef = def }
  require('../index')
  return pageDef
}

function makeCtx(def, data = {}) {
  return {
    ...def,
    data: JSON.parse(JSON.stringify({ ...def.data, ...data })),
    setData(patch) {
      for (const key of Object.keys(patch)) {
        if (key.includes('.')) {
          const [head, ...rest] = key.split('.')
          let cur = this.data[head]
          for (let i = 0; i < rest.length - 1; i++) cur = cur[rest[i]]
          cur[rest[rest.length - 1]] = patch[key]
        } else {
          this.data[key] = patch[key]
        }
      }
    }
  }
}

describe('member-edit add mode', () => {
  test('新增模式缺打法时拒绝提交', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.isEdit = false
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: '' }
    ctx.onSubmit()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '请选择打法', icon: 'none' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test('选择打法后提交 payload 携带 playStyle', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.isEdit = false
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: 'vers' }
    ctx.onSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    const call = wx.cloud.callFunction.mock.calls[0][0]
    expect(call.data.action).toBe('add')
    expect(call.data.data.playStyle).toBe('vers')
  })

  test('编辑模式不强制打法', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.isEdit = true
    ctx.data.memberId = 'm1'
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: '' }
    ctx.onSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    const call = wx.cloud.callFunction.mock.calls[0][0]
    expect(call.data.action).toBe('updateById')
  })

  test('非法打法 slug 被前端拦截', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.data.isEdit = false
    ctx.data.member = { name: '张三', phone: '', avatarUrl: '', status: 'active', admin: false, playStyle: 'baseliner' }
    ctx.onSubmit()
    expect(wx.showToast).toHaveBeenCalledWith({ title: '打法选项不合法', icon: 'none' })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })
})

describe('member-edit picker', () => {
  test('onPickPlayStyle 写入 slug 与 index', () => {
    const def = loadPage()
    const ctx = makeCtx(def)
    ctx.onPickPlayStyle({ detail: { value: '2' } })
    expect(ctx.data.playStyleIndex).toBe(2)
    expect(ctx.data.member.playStyle).toBe('iron-lady')
  })
})
```

- [ ] **Step 2: 运行测试**

Run: `cd miniprogram && npx jest pages/member-edit -v`
Expected: 所有用例 PASS。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/pages/member-edit/__tests__/index.test.js
git commit -m "test(member-edit): cover required play style on new member"
```

---

## Task 10：player-detail 切换到共享打法常量、移除 playStyleNote 展示

**Files:**
- Modify: `miniprogram/pages/player-detail/index.js`
- Modify: `miniprogram/pages/player-detail/index.wxml`
- Modify: `miniprogram/pages/player-detail/__tests__/index.test.js`

- [ ] **Step 1: 替换 player-detail JS 顶部常量来源**

修改 `miniprogram/pages/player-detail/index.js`：

把第 1-9 行（开头到 `}`）替换为：

```js
const { callFunction } = require('../../utils/cloud')
const { getPlayStyleLabel } = require('../../utils/play-style')
```

并把 `_formatPlayStyle` 方法（约 189-193 行）替换为：

```js
  _formatPlayStyle(player) {
    const label = getPlayStyleLabel(player && player.playStyle)
    return label || '打法未设置'
  },
```

- [ ] **Step 2: 删除 player-detail WXML 中 `playStyleNote` 区域**

在 `miniprogram/pages/player-detail/index.wxml` 中找到：

```xml
    <view wx:if="{{player.playStyleNote}}" class="pd-section pd-about anim-stage-rise anim-delay-1">
      ...
      <text class="pd-about-text">{{player.playStyleNote}}</text>
    </view>
```

整段（约 27-32 行）删除。

- [ ] **Step 3: 更新 player-detail 单测 fixture 使用新 slug**

在 `miniprogram/pages/player-detail/__tests__/index.test.js` 中：

把
```js
    player: { _id: 'A', name: 'Alice', playStyle: 'all-court' },
```
替换为：
```js
    player: { _id: 'A', name: 'Alice', playStyle: 'moon-queen' },
```

并在文件末尾追加：

```js
test('_formatPlayStyle returns label for new slug, fallback for unknown', () => {
  const def = loadPage()
  const ctx = makeCtx(def)
  expect(ctx._formatPlayStyle({ playStyle: 'vers' })).toBe('Vers')
  expect(ctx._formatPlayStyle({ playStyle: 'baseliner' })).toBe('打法未设置')
  expect(ctx._formatPlayStyle({})).toBe('打法未设置')
})
```

- [ ] **Step 4: 运行测试**

Run: `cd miniprogram && npx jest pages/player-detail -v`
Expected: 所有用例 PASS。

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/player-detail/index.js miniprogram/pages/player-detail/index.wxml miniprogram/pages/player-detail/__tests__/index.test.js
git commit -m "feat(player-detail): use shared play-style labels and drop note section"
```

---

## Task 11：mock 数据替换为新 slug

**Files:**
- Modify: `miniprogram/mock/data.js`

- [ ] **Step 1: 替换 playStyle 值并删除 playStyleNote**

打开 `miniprogram/mock/data.js`，对 12 个 member 条目逐一调整：

| 行号近似 | 旧值 | 新值 |
| --- | --- | --- |
| 6 | `playStyle: '右手底线型'` | `playStyle: 'ice-cow'` |
| 14 | `playStyle: '全场型'` | `playStyle: 'moon-queen'` |
| 21 | `playStyle: '左手进攻型'` | `playStyle: 'iron-lady'` |
| 28 | `playStyle: '反击型'` | `playStyle: 'vers'` |
| 35 | `playStyle: '发上型'` | `playStyle: 'iron-lady'` |
| 42 | `playStyle: '稳定相持型'` | `playStyle: 'grinder'` |
| 49 | `playStyle: '双打网前型'` | `playStyle: 'moon-queen'` |
| 56 | `playStyle: '节奏变化型'` | `playStyle: 'slicer'` |
| 63 | `playStyle: '进攻底线型'` | `playStyle: 'iron-lady'` |
| 70 | `playStyle: '耐心防守型'` | `playStyle: 'grinder'` |
| 77 | `playStyle: '强力发球型'` | `playStyle: 'vers'` |
| 84 | `playStyle: '双反底线型'` | `playStyle: 'ice-cow'` |

并删除每条记录中的 `playStyleNote: '...'` 整行（含上一行末逗号修正）。

- [ ] **Step 2: 确认无残留**

Run: `grep -n "playStyleNote\|baseliner\|serve-volleyer\|all-court\|counter-puncher\|aggressive-baseliner\|右手底线型\|发上型" miniprogram/mock/data.js`
Expected: 无匹配输出。

- [ ] **Step 3: Commit**

```bash
git add miniprogram/mock/data.js
git commit -m "chore(mock): align fixtures with new play-style slugs"
```

---

## Task 12：全量回归与最终自检

**Files:** 无新文件，跑测试 + 手动 E2E

- [ ] **Step 1: 跑全部 cloudfunctions/members 测试**

Run: `cd cloudfunctions/members && npx jest -v`
Expected: 全部 PASS。

- [ ] **Step 2: 跑全部 miniprogram 测试**

Run: `cd miniprogram && npx jest -v`
Expected: 全部 PASS。

- [ ] **Step 3: 全仓库残留扫描**

Run: `grep -rn "playStyleNote\|baseliner\|serve-volleyer\|all-court\|counter-puncher\|aggressive-baseliner" miniprogram cloudfunctions --include="*.js" --include="*.wxml" --include="*.json" --include="*.md" 2>&1 | grep -v node_modules | grep -v package-lock`
Expected: 无匹配输出。如有遗漏，定位并补 commit。

- [ ] **Step 4: 微信开发者工具手动 E2E（参照 spec §7.3）**

四个场景全过：
1. 清空 openid 对应 members 记录 → 点「登录/注册」 → 注册页 → 选头像/填昵称/选打法 → 「完成注册」 → 回到「我的」头像/姓名展示正确，members 集合新增一条且无 `playStyleNote` 字段。
2. 已注册用户 → 点「编辑资料」 → 改姓名/打法 → 保存 → 再次进入仍正确。
3. 注册中途关闭 → 重新进入仍触发注册流程（无脏数据）。
4. 后台「会员管理」新增会员：不选打法时拒绝提交；选择后新增成功；进入「球员详情」展示对应中文打法。

- [ ] **Step 5: Commit 残留修复（若有）**

```bash
git add -A
git status   # 确认无意外文件
git commit -m "chore(profile-registration): final regression sweep"
```

- [ ] **Step 6: PR 准备**

Run: `git log --oneline main..HEAD`
Expected: 看到本计划 11 + N 次 commit；按设计文档 §9 验收清单逐项打勾后开 PR。

---

## 完成判定

- 所有任务 checkbox 勾选
- 单元/集成测试 PASS，覆盖率不下降
- spec §9 验收清单全部满足
- 手动 E2E 四个场景通过
- 仓库无旧 slug 与 `playStyleNote` 残留
