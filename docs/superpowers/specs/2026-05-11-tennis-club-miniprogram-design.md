# FOPEN 网球俱乐部小程序 · 设计规范（Design Spec）

**日期**：2026-05-11
**作者**：Xiaole Liao（UX 设计师 / 产品负责人） · Claude（协作）
**状态**：草案 v1.0
**前置文件**：`cloudfunctions/DATABASE_SCHEMA.md`（朋友写的现有数据库 schema）

---

## 1. 摘要

FOPEN 是一个**业余网球俱乐部内部使用的微信小程序**。当前由朋友开发了基础骨架（20 个页面、6 张数据表、7 个云函数），但有几块明显缺口：场地+时段调度未建模、首页空白、玩家详情页不存在、排行榜未分单/双打、视觉样式缺失。本规范定义如何**补完功能 + 重做视觉**，最终交付一个能让管理员独立运营赛事、让会员愿意打开看自己排名的产品。

### 业务目标

- **管理员**：能在 < 5 分钟内创建一场含完整场地时段安排的比赛
- **会员**：能在 < 1 分钟内录入自己的比赛结果
- **所有人**：能在 < 10 秒内看到自己的排名变化

### 非目标（YAGNI）

- 公开报名 / 外部加入（俱乐部内部使用，仅管理员录入会员）
- 临时玩家 / 访客模式（必须注册小程序才能参与）
- 比分细节解析（比分仅做文本存档，不用于裁定）
- 通知推送（v1 不做）
- 多语言（仅中文）

---

## 2. 技术约束（重要！）

**这是微信小程序 + 云开发项目**。所有实现都必须在此栈内：

| 组件 | 技术 |
|---|---|
| 前端 | WXML + WXSS + JS（小程序原生，**非 React / Vue / Taro**） |
| 状态管理 | `Page() data` + `setData()`（**不引入 Redux/Pinia** 等） |
| 路由 | `wx.navigateTo` / `wx.switchTab` / `wx.redirectTo` |
| 后端 | 微信云开发云函数（Node.js 16+） |
| 数据库 | 微信云开发 NoSQL（文档型，类 MongoDB） |
| 存储 | 微信云存储（头像/图片） |
| 测试 | 云函数：Jest；小程序前端：微信开发者工具自动化测试（miniprogram-automator） |
| 构建 | 微信开发者工具 / `uploadCloudFunction.sh`（已有） |

**禁止做**：
- 把项目重写为 Taro/uni-app 等跨端框架
- 引入 npm 包到 miniprogram/ 目录（`project.config.json` 已禁用 nodeModules）
- 用 React/Vue 组件思维写 WXML（虽然 WXML 有 components，但 lifecycle 不同）

---

## 3. 范围与实施分期

完整范围分 6 期，按依赖关系实施。**实施顺序**（已确认）：**1 → 3 → 4 → 2 → 5 → 6**。

| 期 | 主题 | 解锁的能力 | 预估文件改动量 |
|---|---|---|---|
| **第 1 期** | 数据模型迁移 + 设计系统 tokens | 后续都基于新数据 + 新视觉 | 6 个云函数微改 + 3 个新 WXSS 文件 |
| **第 3 期** | 创建赛事改造（含 20min 时间格子 UI） | 管理员能用新模型创建赛事 | tournament-edit 重写 + 新 court-grid 组件 |
| **第 4 期** | 自动排程引擎 + 签表/对局表 | 比赛能跑起来 | 新 scheduler-engine 云函数 + brackets 页面增强 |
| **第 2 期** | 首页 + 排行榜 + 玩家详情页 | 用户有美观的浏览体验 | home/rank 重写 + 新 player-detail 页 |
| **第 5 期** | 录分对账 + 仲裁 + 积分计算 | 闭环：比赛→积分→排行 | 新 result-submit 页 + result-reconcile 云函数 |
| **第 6 期** | 每周之星定时任务 + 视觉打磨 + 微交互 | 上线水准 | 新 weekly-star 定时云函数 + 全局动画 |

每期独立可发布。**1+3+4 完成后可让一场真实比赛跑起来**（即使排行榜还没重做）。

---

## 4. 视觉设计系统

### 4.1 色板

参考：用户提供的网球 App 风格图（青柠+黑+白，运动感）。

| Token | 值 | 用途 |
|---|---|---|
| `--color-lime` | `#BEE645` | 主色：高亮卡片、tab 选中、CTA 强调 |
| `--color-lime-soft` | `#DDF099` | hover/按下状态、second tier 强调 |
| `--color-ink` | `#0A0A0A` | 主文字、主 CTA、底栏 |
| `--color-ink-2` | `#1F1F23` | 次级深色背景 |
| `--color-bg` | `#FFFFFF` | 主背景 |
| `--color-bg-2` | `#FAFAFA` | 卡片底色 |
| `--color-bg-3` | `#F3F4F6` | 灰底次级容器 |
| `--color-muted` | `#6B7280` | 次要文字 |
| `--color-muted-2` | `#9CA3AF` | 标签文字 |
| `--color-border` | `#E5E7EB` | 描边 |
| `--color-danger` | `#DC2626` | 错误 / disputed 状态 |
| `--color-warn` | `#F59E0B` | 警告 / pending 状态 |
| `--color-success` | `#16A34A` | 成功 / confirmed 状态 |

注：之前的深色 + 紫色调（`#0d0d14` + `#7c3aed`）**全部弃用**。

### 4.2 字体层级

| Token | 大小 / 字重 / 字距 | 用途 |
|---|---|---|
| `--font-display` | 56rpx / 900 / -0.03em | "PLAY. COMPETE." 这种 hero 标题 |
| `--font-h1` | 40rpx / 800 / 0.01em / uppercase | 页面主标题（RANKINGS） |
| `--font-h2` | 32rpx / 700 / -0.01em | 区段标题 |
| `--font-title` | 28rpx / 600 | 卡片标题、玩家名字 |
| `--font-body` | 26rpx / 400 | 正文 |
| `--font-label` | 22rpx / 600 / 0.08em / uppercase | 小标签（UPCOMING MATCH） |
| `--font-meta` | 20rpx / 400 | 次要元数据（日期/场地） |
| `--font-stat` | 64rpx / 900 / -0.03em | 巨型数字（24 / 66% / 4.2） |

字体族：`PingFang SC, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`（小程序原生）。

### 4.3 间距与圆角

| Token | 值 |
|---|---|
| `--space-1` ~ `--space-6` | 4 / 8 / 12 / 16 / 24 / 32rpx |
| `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-pill` | 8 / 16 / 24 / 999rpx |

### 4.4 关键组件规范

| 组件 | 规范 |
|---|---|
| **主 CTA**（黑色大胶囊） | `bg: ink, color: white, padding: 24rpx 48rpx, radius: pill, font-weight: 600, uppercase` |
| **次 CTA**（白底描边） | `bg: white, border: 1px ink, color: ink, padding: 20rpx 40rpx, radius: pill` |
| **Tab Chip**（青柠选中） | 选中：`bg: lime, color: ink`；未选中：`bg: white, border: 1px border, color: muted` |
| **Stat Block**（数据可视化） | `数字 font-stat + 下方 label font-label muted` |
| **Hero Card**（青柠强调卡） | `bg: lime, color: ink, radius: lg, padding: 24rpx, 含 brush stroke 装饰 SVG` |
| **Brush Stroke 装饰** | SVG，置于 hero 卡片背后或 #1 排名卡片背景（参考用户图） |

### 4.5 微交互

| 触发 | 反馈 |
|---|---|
| Tab 切换 | 青柠胶囊滑动到目标位置 200ms 弹簧 |
| Tap CTA | scale(0.96) 100ms + 触觉反馈 `wx.vibrateShort` |
| 排名变化 | 第一次显示时数字从 0 滚动到当前值 600ms |
| 列表加载 | skeleton（灰底脉冲） |
| Stat 数字变化 | 数字增加动画 400ms |

---

## 5. 数据模型

### 5.1 沿用集合（仅做字段增补）

#### members（会员表）

```diff
{
  // 沿用：_id, openid, name, avatarUrl, phone, status, admin, createTime, updateTime
+ playStyle: "baseliner",       // 'baseliner' | 'serve-volleyer' | 'all-court' |
+                                // 'counter-puncher' | 'aggressive-baseliner'
+ playStyleNote: "贝克汉心理"    // 自由备注，可空
}
```

#### tournaments（赛事表）

```diff
{
  // 沿用：_id, seasonId, name, type, startDate, endDate, location, status,
  //       description, config, pointsRules, createTime, updateTime
- // 移除：config.totalRounds 改为可由生成签表/对局表时推导（保留也行，不强求）
+ courtTimeGrid: {
+   matchDuration: 20,            // 单场分钟数，固定 20
+   courts: [
+     { courtId: "c1", name: "1号场" },
+     { courtId: "c2", name: "2号场" }
+   ],
+   slots: [
+     {
+       slotId: "s_20260525_0800",
+       start: "2026-05-25T08:00:00+08:00",
+       end:   "2026-05-25T08:20:00+08:00",
+       availableCourtIds: ["c1", "c2"]
+     }
+     // 20 分钟一档
+   ]
+ }
}
```

**说明**：管理员在创建/编辑赛事页用"时间轴格子"UI 编辑 → 落到 `slots[*].availableCourtIds`。未排程的 `(slot, court)` 在前端显示为"自由拉球"（衍生显示，无需独立字段）。

#### match-results（比赛结果表）

```diff
{
  // 沿用：_id, tournamentId, round, winnerId, loserId, winnerName, loserName,
  //       pointsAwarded, createTime
+ status: "pending",         // 'pending' | 'confirmed' | 'disputed'
+ submissions: [             // 提交记录，1-2 条为主
+   {
+     submittedBy: "member_xxxxx",
+     role: "player",         // 'admin' | 'player'
+     winnerIds: "member_xxxxx",    // 该提交认为的胜方（多人用逗号分隔）
+     score: "6-3, 6-4",     // 比分文本，存档用，不解析
+     submittedAt: Date
+   }
+ ],
+ confirmedAt: Date,
+ confirmedBy: null,         // 仲裁时填 admin _id
+ disputeReason: "",
+ courtId: "c2",             // 排程后填
+ scheduledStart: Date,      // 排程后填
+ scheduledSlotId: "s_xxxxx"
}
```

#### tournament_brackets（对位表）

```diff
{
  // 沿用：_id, tournamentId, round, type, matches, nextRoundMatches
  matches: [
    {
      // 沿用：matchId, position, player1, player2, winner, status
+     courtId: "c1",
+     scheduledStart: Date,
+     scheduledSlotId: "s_xxxxx"
    }
  ]
}
```

### 5.2 新增集合

#### weekly_stars（每周之星缓存表）

```js
{
  _id: "ws_2026_W19",          // ISO 周 id
  weekStart: "2026-05-04",     // 周一
  weekEnd: "2026-05-10",
  singlesStar: {
    memberId: "member_xxx",
    points: 350,
    name: "Alex",
    avatarUrl: "..."
  },
  doublesStar: { /* 同上结构 */ },
  computedAt: Date
}
```

**用途**：每周一 0:30 由 cron 云函数算上一周的星，写入此表。**当前周（进行中）**则按需实时查询 match-results 计算（不缓存）。

### 5.3 索引建议

| 集合 | 索引 | 用途 |
|---|---|---|
| `match-results` | `tournamentId` | 拉某赛事所有结果 |
| `match-results` | `(status, createTime DESC)` | 管理员仲裁队列分页 |
| `match-results` | `(winnerId, createTime DESC)` 和 `(loserId, createTime DESC)` | 玩家详情页的"近期比赛" |
| `tournament_brackets` | `(tournamentId, round)` | 拉某赛事某轮签表 |
| `tournament_registrations` | `(tournamentId, playerId)` | 报名校验、查个人参赛 |
| `members` | `openid` | 登录查会员 |
| `weekly_stars` | `(weekStart DESC)` | 历史每周之星 |

---

## 6. 云函数

### 6.1 沿用云函数（小改）

| 名称 | 改动 |
|---|---|
| `login` | 无 |
| `members` | 接受 playStyle / playStyleNote 字段；新增 `getById` action |
| `seasons` | 无 |
| `tournaments` | 新增 `updateCourtTimeGrid` action；create/update 时校验 admin |
| `tournament-registrations` | 报名时校验是否已注册（防重） |
| `tournament-brackets` | 生成签表时同时调用 scheduler-engine |
| `match-results` | 大改：拆出 result-reconcile 子模块（见下） |
| `quickstartFunctions` | 保持 |

### 6.2 新增云函数

#### scheduler-engine

**职责**：把所有比赛分配到 `(courtId, slotId)` 空格里。

**输入**：`{ tournamentId }`

**算法**（伪代码）：

```
loadCourtTimeGrid(tournamentId)
loadMatchesToSchedule(tournamentId)  // 所有未排程的对局
matches.sort(byRoundAsc, byPositionAsc)
for each match in matches:
    candidateCells = (slot, court) 笛卡尔积, 过滤已占用
    candidateCells = filter(候选, 双方此 slot 都未被其他比赛安排)
    candidateCells = filter(候选, 双方任一方上一场结束于本 slot 之前 - 至少隔 1 档)
    if candidateCells 非空:
        pick = candidateCells[0]  // 选最早的可用格
        assign match -> pick
    else:
        unscheduledMatches.push(match)
return { scheduled: [...], unscheduled: [...] }
```

**返回**：`{ success: true, data: { scheduled, unscheduled } }`。前端在 UI 显示 unscheduled 列表，让 admin 手动调整。

**关键约束**：
- 同一玩家不可同时安排在重叠时段
- 同一玩家两场之间至少间隔 1 个 20min 档（休息）

#### result-reconcile

**职责**：处理录分对账状态机。

**输入**：`{ matchId, role: 'admin' | 'player', winnerIds, score, submitterId }`

**逻辑**：

```
match = loadMatch(matchId)
if match.status === 'confirmed': throw RESULT_ALREADY_CONFIRMED
if role === 'admin':
    // 管理员录入或仲裁，直接确认
    finalize(match, winnerIds, submitterId, score)
    triggerPointsEngine(match)
    return { status: 'confirmed' }
else if role === 'player':
    if submitterId not in match.players: throw PERMISSION_DENIED
    if has existing submission from same submitter: update it
    else: append to submissions
    if submissions.length >= 2:
        if all winnerIds agree:
            finalize(match, winnerIds, null, score)
            triggerPointsEngine(match)
            return { status: 'confirmed' }
        else:
            match.status = 'disputed'
            return { status: 'disputed' }
    else:
        match.status = 'pending'
        return { status: 'pending' }
```

#### points-engine

**职责**：根据比赛 type/format + tournament.pointsRules 计算积分，写入 match-results.pointsAwarded。

**输入**：`{ matchId }`

**规则**：
- 常规赛：胜方 +win 分，负方 +loss 分
- 淘汰赛：胜方 +win 分 + bonusByRound[round]，负方 +loss 分（不进下一轮则止步该轮，不加额外 bonus）
- **积分有效期**（**计算时过滤，不在写入时打标**）：
  - 常规赛积分：仅当前赛季（seasonId 当前自然年内）有效
  - 淘汰赛积分：滚动 365 天有效（从 match createTime 起算）

#### weekly-star（定时任务）

**触发**：每周一 00:30 自动运行（云开发定时触发器）。

**逻辑**：
- 计算上一自然周（周一–周日）单/双打积分聚合
- 各取 top 1 写入 `weekly_stars` 集合

**手动触发**：保留 `recompute(weekId)` action 让管理员强制重算。

### 6.3 通用约定

**输入校验**：所有 action 第一句：

```js
async function requireAdmin(context) {
  const { OPENID } = cloud.getWXContext();
  const member = await db.collection('members').where({ openid: OPENID }).get();
  if (!member.data[0]?.admin) {
    throw { code: 'PERMISSION_DENIED', message: '需要管理员权限' };
  }
  return member.data[0];
}
```

**返回信封**：

```js
{ success: true, data: any }
// 或
{ success: false, error: { code: 'XXX', message: '友好提示' } }
```

**错误码**：见 §10。

---

## 7. 页面与组件

### 7.1 页面清单

| 页面 | 状态 | 备注 |
|---|---|---|
| `pages/home/index` | ✏️ 重写 | 含 hero + upcoming match + quick actions + stats |
| `pages/match/index`（赛事 tab） | ✏️ 改造 | Upcoming/Ongoing/Completed tabs + hero 卡 + 列表 |
| `pages/rank/index`（排行 tab） | ✏️ 重写 | Singles/Doubles tabs + 每周之星 hero + 列表 |
| `pages/mine/index`（我的 tab） | ✏️ 改造 | 头像+UTR+ 我的近期比赛 + 设置入口 |
| `pages/manage/index`（管理 tab，仅 admin） | ✏️ 改造 | 待确认结果 / 待安排赛事 / 会员管理 等入口 |
| `pages/tournament-detail/index` | ✏️ 微改 | 套用新视觉 |
| `pages/tournament-edit/index` | ✏️ 大改 | 含新场地+时段格子 UI |
| `pages/tournament-brackets/index` | ✏️ 微改 | 套用新视觉 |
| `pages/tournament-score/index` | ✏️ 微改 | 套用新视觉 |
| `pages/tournament-view/index` | ✏️ 微改 | 套用新视觉 |
| `pages/tournament-add-player/index` | ✏️ 微改 | 套用新视觉 |
| `pages/tournament-add-players-doubles/index` | ✏️ 微改 | 同上 |
| `pages/season-manage/index` | ✏️ 微改 | 套用新视觉 |
| `pages/tournament-manage/index` | ✏️ 微改 | 套用新视觉 |
| `pages/member-manage/index` | ✏️ 微改 | 套用新视觉 |
| `pages/member-edit/index` | ✏️ 改造 | 新增 playStyle/playStyleNote 字段 |
| `pages/setting/index` | ✏️ 微改 | 套用新视觉 |
| `pages/edit-profile/index` | ✏️ 改造 | 同 member-edit，加 playStyle |
| `pages/round-settlement/index` | ✏️ 微改 | 套用新视觉 |
| `pages/my-match/index` | ✏️ 改造 | 个人比赛列表 + 录分入口 |
| `pages/player-detail/index` | 🆕 新建 | 玩家详情页（含交手记录） |
| `pages/result-submit/index` | 🆕 新建 | 球员录分页 |
| `pages/index/index` | 🗑️ 删除？ | 现有 `index/` 似乎是模板默认页，确认能删 |

### 7.2 全局组件库

放在 `miniprogram/components/`：

| 组件 | 用途 |
|---|---|
| `chip-tab` | 青柠胶囊 tab 切换器 |
| `stat-block` | 巨型数字 + label 组合 |
| `player-card` | 头像+名字+stats 横向卡片 |
| `rank-row` | 排名条目（含变化箭头） |
| `match-card` | 比赛卡片（含场地、时间、对手） |
| `court-grid` | **核心新组件**：时间轴×场地格子 |
| `brush-stroke-bg` | 装饰用 svg 背景 |
| `cta-button` | 主/次 CTA 按钮 |
| `skeleton-loader` | 骨架屏 |

### 7.3 全局 WXSS

新建：
- `miniprogram/styles/tokens.wxss`：所有 CSS 变量
- `miniprogram/styles/base.wxss`：基础 reset + 字体
- `miniprogram/styles/utilities.wxss`：常用工具类

`app.wxss` `@import` 这三个。

### 7.4 底栏（app.json `tabBar`）

**问题**：小程序 tabBar 是静态配置，无法根据用户角色显示不同 tab 数量。

**方案**：注册 5 个 tab（admin 视图），普通会员通过 `wx.hideTabBarRedDot` 等手段**隐藏不掉**——所以选用以下两种之一：

- **A**：始终显示 5 tab；非管理员点"管理"时跳转到提示页"无权限"
- **B**：使用**自定义 tabBar**（小程序原生支持 `custom: true`），根据会员角色动态渲染 4 或 5 个 tab

**采用 B**。新建 `miniprogram/custom-tab-bar/index.{js,wxml,wxss,json}`，从全局 `getApp().globalData.isAdmin` 读取角色决定渲染。

---

## 8. 核心工作流（已在 brainstorming 第 3 段细化，此处仅指引）

| 工作流 | 涉及页面 | 涉及云函数 |
|---|---|---|
| A. 创建赛事 | tournament-edit → tournament-brackets | tournaments / tournament-registrations / tournament-brackets / scheduler-engine |
| B. 录分对账 | my-match → result-submit | result-reconcile → points-engine |
| C. 排行榜计算 | rank | match-results / members / points-engine / weekly-star |
| D. 玩家详情 | player-detail | members / match-results |

详细伪代码见 brainstorming 阶段第 3 段。

---

## 9. 角色与权限

### 9.1 权限矩阵

| 能力 | 会员 | 管理员 | 实施位置 |
|---|---|---|---|
| 查看赛事/排行/玩家详情 | ✅ | ✅ | 公开 |
| 报名赛事（自助） | ❌ | ✅ 代报 | tournament-registrations 云函数 |
| 录入自己比赛分数 | ✅ | ✅ | result-reconcile |
| 确认 / 仲裁结果 | ❌ | ✅ | result-reconcile 限定 role='admin' |
| 创建/编辑/删除赛事 | ❌ | ✅ | tournaments + tournament-brackets |
| 编辑别人资料 | ❌ | ✅ | members 云函数 |
| 看到底栏"管理"tab | ❌ | ✅ | custom-tab-bar JS |

### 9.2 校验流

**前端**：仅做 UX 校验（按钮置灰 / 隐藏入口）。

**云函数**：所有写操作入口调用 `requireAdmin(context)`（除会员自己改自己资料 / 自己录分）。

---

## 10. 错误处理

### 10.1 统一返回信封

```js
{ success: true, data: any }
// 或
{ success: false, error: { code: 'XXX', message: '友好提示' } }
```

### 10.2 错误码表

| Code | 场景 | UI 反应 |
|---|---|---|
| `PERMISSION_DENIED` | 非管理员调管理 API | toast "你没有权限执行此操作" |
| `NOT_AUTHENTICATED` | 未注册会员调任何 API | 跳登录页 |
| `SCHEDULE_OVERFLOW` | 场地+时段装不下所有比赛 | 内联警告条 + 列出 unscheduled，允许 admin 手动调整 |
| `RESULT_ALREADY_CONFIRMED` | 已确认的比赛再次提交 | toast "比赛结果已确认，如需修改请联系管理员" |
| `RESULT_DISPUTED` | 双方提交结果不一致 | toast "和对手提交的结果不一致，已转管理员仲裁" |
| `DUPLICATE_REGISTRATION` | 重复报名同一赛事 | toast "你已报名此赛事" |
| `VALIDATION_FAILED` | 字段缺失/格式错 | toast 显示 error.message（具体哪个字段） |
| `NETWORK_ERROR` | 网络/超时 | toast "网络异常，请重试" |

### 10.3 前端通用包装

新建 `miniprogram/utils/api.js`：

```js
async function callFunction(name, data) {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    if (!res.result.success) {
      handleError(res.result.error);
      return null;
    }
    return res.result.data;
  } catch (err) {
    handleError({ code: 'NETWORK_ERROR', message: '网络异常，请重试' });
    return null;
  }
}
function handleError(err) {
  wx.showToast({ title: err.message || '操作失败', icon: 'none' });
  if (err.code === 'NOT_AUTHENTICATED') {
    wx.redirectTo({ url: '/pages/setting/index' });
  }
}
```

所有页面通过这个工具调云函数，错误处理统一。

---

## 11. 测试策略

### 11.1 覆盖率目标

全局 80%（项目级规则）。重点子系统目标更高：

- `scheduler-engine`：95%（关键算法）
- `result-reconcile`：90%（状态机）
- `points-engine`：90%（金额计算性质，不能错）

### 11.2 测试层

| 层 | 范围 | 工具 |
|---|---|---|
| 单元 | scheduler-engine / points-engine / result-reconcile 纯逻辑 | Jest（在 cloudfunctions/ 目录） |
| 集成 | 云函数 ↔ DB 真实读写 | Jest + 云开发本地模拟器 |
| E2E | 小程序前端关键旅程 | miniprogram-automator（微信开发者工具自带） |

### 11.3 关键测试用例（清单）

**scheduler-engine**：
- 完美填充：4 场比赛恰好填满 4 个格 ✅
- 容量溢出：5 场比赛 / 4 个格 → 返回 1 个 unscheduled
- 同人冲突：同一玩家两场比赛排在相邻时段 → 应隔 1 档
- 多场地穿插：玩家从 court 1 转到 court 2 → 允许
- 空赛事：0 场比赛 → 返回空数组，不崩

**result-reconcile**：
- 管理员单方录入 → confirmed ✅
- 玩家单方提交 → pending
- 双方一致 → 自动 confirmed + 触发 points
- 双方不一致 → disputed
- 玩家提交后管理员仲裁 → confirmed + 覆盖玩家提交
- 已 confirmed 再提交 → RESULT_ALREADY_CONFIRMED
- 非参赛玩家提交 → PERMISSION_DENIED

**points-engine**：
- 常规赛胜：win 积分
- 淘汰赛胜并到达第 3 轮：win + bonusByRound[3]
- 弃权 walkover：用 walkover 积分
- 积分有效期：写入半年前的淘汰赛积分 → 在 1 年内仍计入
- 跨赛季：上赛季的常规赛积分 → 本赛季排行榜不计入

**E2E 旅程**：
- Admin 完整流程：登录 → 创建赛事 → 加场地时段 → 加选手 → 生成签表 → 自动排程 → 跑完比赛 → 仲裁结果 → 看排行变化
- Member 完整流程：登录 → 看赛事 → 看自己被报名 → 录分 → 等对方确认 → 看自己积分变化

---

## 12. 实施分期详情

### 第 1 期：数据模型迁移 + 设计系统 tokens

**输出**：
- `miniprogram/styles/tokens.wxss`、`base.wxss`、`utilities.wxss`
- `app.wxss` 引入新 tokens
- 全部页面 wxss 引用 tokens 变量（替换硬编码颜色）
- DB schema 字段增补（写迁移脚本：现有 documents 加默认值）
- `cloudfunctions/DATABASE_SCHEMA.md` 同步更新

**完成标准**：跑现有功能（创建赛事/录分），数据库新字段有默认值，UI 已经看到新色板。

### 第 3 期：创建赛事改造（含 20min 时间格子 UI）

**输出**：
- `tournament-edit` 重写：分步表单（基本信息 → 场地时段 → 积分 → 选手）
- 新 `court-grid` 组件：时间轴×场地的可点选格子
- `tournaments` 云函数支持 `courtTimeGrid` 字段
- 单元测试 grid → courtTimeGrid 序列化逻辑

**完成标准**：管理员能创建一个含 20min 时间格子的赛事，且数据落库正确。

### 第 4 期：自动排程引擎 + 签表/对局表

**输出**：
- 新 `scheduler-engine` 云函数（含全部单元测试）
- `tournament-brackets` 页面增强：每场比赛展示 courtId + scheduledStart
- 常规赛对局表生成：每人每轮 1 场，配对算法（随机+可调）
- 内联 unscheduled 列表 UI

**完成标准**：管理员一键点"生成对局表" → 看到所有比赛被排到具体场地+时段；未排程的有明显提示，且可手动调整。

### 第 2 期：首页 + 排行榜 + 玩家详情

**输出**：
- `home/index` 重写：参考用户提供的图（hero + upcoming + quick actions + stats）
- `rank/index` 重写：Singles/Doubles tab + 每周之星 hero card + 排名列表（rank, name, win rate, W-L, 变化箭头）
- 新 `player-detail/index` 页：基本信息 + 近期排名变化（折线）+ 交手记录
- `points-engine` 实现（用于这些页面的实时计算）

**完成标准**：用户在浏览的时候视觉冲击足够，数据正确。

### 第 5 期：录分对账 + 仲裁 + 积分计算

**输出**：
- 新 `result-submit/index` 页：玩家录分入口
- 新 `result-reconcile` 云函数（状态机）
- `manage/index` 加"待确认结果"队列 UI
- 完整测试覆盖

**完成标准**：完整闭环——比赛打完 → 双方提交 → 自动确认 → 积分入库 → 排行榜更新。

### 第 6 期：每周之星 + 视觉打磨 + 微交互

**输出**：
- `weekly-star` 定时云函数（每周一 0:30 跑）
- `weekly_stars` 集合数据
- rank 页 hero 接入每周之星
- 全局微交互：tab 切换弹簧、CTA scale 反馈、stat 数字动画、骨架屏
- 装饰元素：brush-stroke SVG 嵌入 hero 卡

**完成标准**：上线水准的体验。

---

## 13. 风险与开放问题

### 13.1 已识别风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 自动排程在大赛事（>30 人）下 NP-hard 性 | 性能 / 体验 | 把 timeout 设为 5 秒 + fallback 到 greedy + 必要时让 admin 手动 |
| 小程序 tabBar 自定义复杂度 | 开发量 | 已选 custom: true，按 doc 实现即可 |
| 双方对账逻辑的并发问题 | 状态错乱 | 在云函数内用 `db.collection().doc().update({ $cond: ... })` 乐观锁 |
| 积分有效期"过期失效"如何体现 | 用户疑惑积分变少 | 玩家详情页加"积分到期日"提示 |

### 13.2 推迟到 v2 的事项

- 通知推送（开赛提醒、结果待确认提醒）
- 比赛回放 / 比分视图（如热力图）
- 跨俱乐部对抗
- 报名表单（公开报名）
- 排行榜历史快照

### 13.3 开放问题（spec 评审后再决定）

- 第 1 期的字段迁移脚本是单次跑还是用 default-on-read？建议**单次跑 + 写防御代码兼容老数据**。
- `weekly_stars` 历史多久之前的需要展示？建议**最多 8 周**，老数据自动清理。
- 玩家详情页"近期排名变化"折线展示**最近几个周期**？建议**最近 12 周**。

---

**END OF SPEC**
