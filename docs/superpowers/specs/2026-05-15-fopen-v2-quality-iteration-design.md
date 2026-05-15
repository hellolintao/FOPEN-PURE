# FOPEN 小程序 v2.1 质量迭代设计 spec

- 日期：2026-05-16
- 范围版本：v2.1
- 状态：设计已审定，等待写实施 plan
- 上游文档：
  - 审计：`docs/superpowers/audits/2026-05-15-v2-quality-audit.md`
  - 沟通日志：`docs/communication/2026-05-16-claude-codex-v2-1-log.md`
- 维护：本文档是 v2.1 唯一设计来源；任何后续 plan / 实现 / review 都以本 spec 为准。本文档未覆盖的细节，回查沟通日志的"待同步"节。

---

## 1. 范围与成功标准

### 1.1 目标

把比赛日的两条主路径做到生产级——

- **路径 A · 管理员一键确认**：admin 开工作台 → 一眼审完所有待确认 → 不离开当前页一键 confirm。
- **路径 B · 会员提交比分**：会员开 my-match → 看到结构清晰的"待录 / 确认中 / 已确认"三块 → 提交后立刻看到「确认中」状态。

不再容忍：
- 串行循环 `submit/reconfirmMatch` 导致中途失败无明细
- 「确认全部」CTA 没有 review 直接 batch
- 三页文案/状态徽章/视觉散落，看起来不像同一个产品

### 1.2 范围内（v2.1 必须做）

| 类别 | 项目 |
|---|---|
| 页面重构 IA | `pages/tournament-manage`、`pages/tournament-score`、`pages/my-match` |
| 新组件 | `components/status-tag`、`components/empty-state`、`components/batch-result-sheet` |
| 现有组件 | `components/score-row` 仅视觉债清理（**不动**内部状态机） |
| 后端新增 action | `tournaments.adminConsoleSnapshot`、`tournaments.finishedRecent`、`match-results.batchConfirm`、`match-results.batchSubmit`、`match-results.mySummary`、`match-results.pendingReviewItems` |
| 后端文件拆分 | `cloudfunctions/match-results/index.js` 拆为 `index.js + lib/handlers/{batch,submit,query,my-summary}.js`，控制单文件体积 |
| 后端日志集合 | 新建 `_request_log` 集合（详 §4.8） |
| 前端统一 | 三页全部接入 `utils/cloud.callFunction` wrapper（详 §5.1） |
| 文档 | 更新 `cloudfunctions/DATABASE_SCHEMA.md`（含 `_request_log`） |

### 1.3 显式不做（推 v2.2 或更后）

- 创建赛事 step 3 orchestration（`commitStep3` 串行问题保留）
- reconfirm 下游影响可视化（admin 改已确认比分时下游清理的范围提示）
- `pages/tournament-detail` / `pages/schedule-board` / `pages/home` / `pages/rank` / `pages/tournament-edit` 的视觉或 IA
- legacy 页（`round-settlement` / `tournament-view` / `tournament-add-player`）的下线判定
- `award.js` / `score-rule.js` / `points-engine` 任何业务逻辑
- `score-row` 内部状态机（折叠/展开、双打 2 行、stepper、reconfirm 二次确认）— 单独列入后续 backlog
- 全站 `wx.showLoading / wx.showToast({title:'加载失败'})` 禁用（v2.1 仅在三页 + sheet 范围禁用）
- 全局视觉系统收口（C 整体 → v2.2）

### 1.4 验收门槛（不达不算 v2.1 完成）

| # | 标准 | 度量 |
|---|---|---|
| 1 | Happy path：admin → 工作台 → 一键确认 3 场 → 全部 confirmed | ≤ 4 次点击、端到端 ≤ 3 秒、hero 数字归零 |
| 2 | Partial failure：单场云函数失败 | sheet 显示 `✓N/✗M` + 失败原因可展开 + 单条重试，无需刷新页面 |
| 3 | 会员路径 my-match | 三区块「待录 / 确认中 / 已确认」语义清晰；提交后 hero 数字立刻减 |
| 4 | 单测 | 新 `batch.js` ≥ 90% lines / 80% branches；`batchConfirm / batchSubmit` 新增 ≥ 15 用例；`adminConsoleSnapshot` 与 `mySummary` ≥ 85%；wrapper ≥ 90%；`batch-result-sheet` ≥ 85%。现状基线 `_shared 22 / match-results 55 / points-engine 16 / tournaments 19 / tournament-brackets 44 / weekly-star 4` 不破 |
| 5 | E2E | §6.2 全 10 条通过 |
| 6 | 性能 | `adminConsoleSnapshot(50 场)` 端到端首屏 ≤ 1.2s；`mySummary(100 场)` ≤ 800ms；`batchConfirm(5 场)` ≤ 3s |
| 7 | 视觉一致 | 三页 + score-row 内 grep `#333\|#999\|#667eea\|linear-gradient(135deg` = 0；`\.tag-(confirmed|pending|warn|ok)` = 0 |
| 8 | 兼容 | 旧 `match-results.submit / confirmAll / reconfirmMatch` 仍工作；旧 tournament-score 链接（`?id=`）仍能进入；`pages/manage/index` 仍可手动进入 |

### 1.5 已显式接受的风险与代价

- `tournament-manage` 重构后与现有 `manage/index` 职责重叠加剧——v2.1 **不删** `manage/index`，仅在 `tournament-manage` 上接管管理员主路径；`manage/index` 进入「legacy 入口」清单，v2.2 处理。
- `batchConfirm` 部分失败时 admin 工作台 hero 数据可能 stale（已写入的 N 场 entries 已落库）——由 sheet 关闭强制 refresh snapshot + 300ms debounce 解决。
- v2.1 不做离线 retry queue：弱网失败由 sheet 内 retryable 标志驱动手动重试。
- score-row 视觉只做 token 替换 + tag 统一，**不重构** 折叠/展开/stepper/reconfirm 等业务逻辑；如未来需要重构，单独立任务。
- 工作台首屏 snapshot 不含 match-level review items 和已结束赛事。Admin 点 hero CTA 时二次拉 `match-results.pendingReviewItems`，"已结束"块用户展开时调 `tournaments.finishedRecent`。代价：CTA 后多一次短 loading；收益：首屏轻、stale 风险更低、失败语义干净。
- 乐观锁字段使用 `match_results.updateTime`（已存在，无 schema 迁移），API 字段名 `expectedUpdateTime`。若未来需更严格版本控制，再加 `version: Number` 字段并向后兼容。

---

## 2. 信息架构

### 2.1 `pages/tournament-manage`（工作台 · admin 主路径）

**布局（从上到下）**

1. **顶部 nav**：标题"工作台" + 右上"+ 创建赛事"入口
2. **Hero card · 今日待办**
   - 文案模板（按状态切换）：
     - `pendingConfirm.total > 0`：「N 场待确认 · M 个草稿」+ 副文 `按赛事统计`，主 CTA「→ 审核并确认 N 场」
     - `pendingConfirm.total == 0 && myDrafts.length > 0`：「M 个草稿待发布」，主 CTA「→ 继续编辑」
     - 全空：「今天无待办任务」，主 CTA「+ 创建赛事」
3. **块 1 · 待确认比分**（仅 `pendingConfirm.total > 0` 时显示）：按赛事分组，每行显示 `tournamentName · "X 场提交中" · 最近提交时间`，右侧 count badge（`status-tag warn-solid`）。点击该行触发 sheet 二次拉（仅该赛事的 pending matches）。
4. **块 2 · 我的草稿**（`status=draft, createdBy=me`）：每行 `tournamentName · "X 球员 · 排程状态"`。点击进 `tournament-edit` 继续编辑。
5. **块 3 · 进行中赛事**（`status=ongoing` 且 createdBy=me 或 isAdmin 全部）：每行 `tournamentName · "Rx/y · X 场剩余"`。点击进 `tournament-detail`。
6. **块 4 · 已结束**（独立 lazy load 块，默认显示收起态 + 「展开」CTA；用户展开时调 `tournaments.finishedRecent` 拉取，块内 inline loading / error / retry，**与 snapshot 解耦**）。

**数据加载**

- `onLoad` / `onShow` 调 `tournaments.adminConsoleSnapshot`（详 §4.2）拉首屏 hero + 块 1/2/3。**不**拉 review items 或 finished 列表。
- 用户点 hero CTA 或块 1 内某赛事行 → 调 `match-results.pendingReviewItems`（详 §4.6）拉 sheet 明细 → sheet 内 loading skeleton 期间显示 spinner → 加载完成后展示 review cards。
- 用户展开"已结束"块 → 调 `tournaments.finishedRecent`（详 §4.7）独立拉 → 块内 inline 显示加载/错误/重试。
- sheet close（详 §5.3）后 parent 调用 `refreshSnapshot()`，含 **300ms debounce**，与 `onShow` 触发的刷新合并去重

**空态**

- `pendingConfirm + myDrafts + ongoing` 全空 → 全屏 `<empty-state icon="check" title="没有任务" subtitle="新建赛事或等待会员提交比分" action="+ 创建赛事" bindaction="onCreate" />`
- snapshot 加载失败 → 全屏 `<empty-state icon="warn" title="加载失败" subtitle="{error.message}" action="重新加载" bindaction="onRetry" />`
- 已结束块独立 lazy load 失败 → 块内 inline 显示「已结束 · 暂时无法加载 · 重试」（不影响首屏其他块）

### 2.2 `pages/my-match`（会员主路径）

**布局**

1. **顶部 nav**：返回 + 标题"我的比赛"
2. **Hero card**
   - `pending.length > 0`：「你有 N 场待录分」+ 副文最近一场赛事/时间，主 CTA「→ 现在录」（点跳 tournament-score + 首场 matchId anchor）
   - `pending.length == 0 && submitted.length > 0`：「N 场等管理员确认」，主 CTA「查看赛程」
   - 全空：「本周没有比赛」，主 CTA「查看赛程」（跳 match tab）
3. **块 1 · 待录分**（`status-tag amber`）：每行 `tournamentName Rx-y · vs 对手 · 时间/场地/搭档`，右侧 `<status-tag type="amber" text="录分" />`。点击进 tournament-score + matchId anchor。
4. **块 2 · 确认中**（`status-tag amber`）：每行 `tournamentName Rx-y · score · vs 对手 · X 分钟前提交`，右侧 `<status-tag type="amber" text="确认中" />`。点击只读跳进 tournament-score 查看（不可编辑）。
5. **块 3 · 已确认**（`status-tag ok`）：最近 N 场（默认 10），每行 `tournamentName 轮次 · score · 胜/负 · +X 积分 · 时间`。

**数据加载**

- `onShow` 调 `match-results.mySummary`（详 §4.3）
- 用户点条目跳 tournament-score 不在本页编辑

**关键决策**

- my-match **不显示**"+ 创建"入口；即使 admin 打开 my-match 也只看到自己作为参赛方的视图，与工作台职责完全分开。
- v2.1 **不在 my-match 内**做"一次性提交 N 场"批量入口；会员批量提交场景留给 tournament-score sticky 按钮（详 §2.3）。

### 2.3 `pages/tournament-score`（录分页 · 双角色入口）

**入参**

- `tournamentId`（必填）：进入哪个赛事
- `matchId`（可选）：跳转后滚动到该场（用 scroll-into-view + anchor）
- `id`（兼容旧链接）：等同 `tournamentId`，不再使用但保留

**布局**

1. **顶部 nav**：返回 + 标题 `tournamentName · 当前轮次/总轮次`
2. **进度条**
   - admin 视角：本轮 `共 N 场` + `<status-tag type="ok" text="X 已确认" /> <status-tag type="warn-solid" text="Y 待确认" count="Y" />`
   - 会员视角：本轮 `共 N 场` + 仅显示自己相关的进度（不显示别人的"X 已确认"数字，避免会员误以为别人的比分已被处理）
3. **score-row 列表**（按 round 分组渲染）
   - score-row 内部状态机保持现状（折叠/展开内联编辑、双打 2 行、stepper 0-4、3:3 抢七、reconfirm 二次确认）
   - 视觉债清理（详 §3.4）：硬编码颜色 → token，时段标 → `<status-tag muted>`，状态标 → `<status-tag>` 复用
4. **sticky 底部 CTA**
   - admin 当 `submittedCount > 0`：「→ 审核并确认 N 场」（触发 batch-result-sheet · mode=`confirm`）
   - admin 当 `submittedCount == 0` 且有 pending：（不显示 sticky；admin 不录分，只确认）
   - 会员当本人有 dirty drafts（已在 score-row 编辑器内填了比分但未提交）：「→ 提交比分 N 场」（触发 batch-result-sheet · mode=`submit`）

**空 matches**

- 不应出现。如果接口返回 `matches=[]`，按数据异常处理：全屏 `<empty-state icon="warn" title="比赛数据异常" subtitle="该赛事没有比赛数据，请联系管理员" action="重新加载" />`，**不**作为普通 empty。

### 2.4 统一状态语义（贯通三页 + score-row）

**总原则**：同一后端状态可以在不同角色下使用不同 `status-tag type` 和不同文案。**同一角色看到的语言全局一致**。

| 后端状态 | 会员看到（文案 / type） | admin 看到（文案 / type） | 可点击行为 |
|---|---|---|---|
| `matchKind=BYE` | 「轮空」 / `muted` | 「轮空」 / `muted` | 不可录 |
| `resultStatus=pending` 且我是参赛方 | 「待录分」 / `amber` | 「待录分」 / `amber` | → tournament-score + matchId |
| `resultStatus=pending` 且我不是参赛方 | （我看不到）| 「未录入」 / `muted` | （admin 不录分）|
| `resultStatus=submitted` | 「确认中」 / `amber` | 「待确认」 / `warn-solid`（含 count badge）| 会员：只读；admin：进入 batch sheet review |
| `resultStatus=confirmed` | 「已确认」 / `ok` | 「已确认」 / `ok` | 会员：只读；admin：可点 reconfirmMatch |
| `status=cancelled` | 「已取消」 / `muted` | 「已取消」 / `muted` | 只读 |

**关键纠正**：会员视角看到 submitted 比赛是「确认中」`amber`（**不紧急**，等待中），不是 `warn`。红色只用于 admin 视角的「待确认」（需要立刻处理）。

### 2.5 关键 IA 决策清单

- Hero CTA 在 `N=0` 时切换文案（admin → "+ 创建赛事"、会员 → "查看赛程"），不要出现空 hero
- "我的草稿"块在工作台**第二位**（不放进 hero），因为创建赛事不是 v2.1 优化对象
- "已结束"块默认折叠，减少视觉噪音
- my-match 与工作台职责完全分开，admin 在 my-match 看到的也是参赛者视角

---

## 3. 组件设计

### 3.1 `components/status-tag`（新）

**用途**：全站状态徽章。三页 + score-row + my-match hero 都用它。后续 v2.2 也复用。

**API**

```wxml
<status-tag type="warn-solid" text="待确认" count="{{3}}" size="md" />
<status-tag type="amber" text="确认中" />
```

| Prop | Type | Default | 说明 |
|---|---|---|---|
| `type` | `'warn'` \| `'warn-solid'` \| `'ok'` \| `'amber'` \| `'muted'` \| `'info'` | `'muted'` | 见 §3.1.1 语义表 |
| `text` | String | — | 必填 |
| `count` | Number \| null | `null` | 右侧 count badge，仅 `type='warn-solid'` 或 `type='info'` 时建议带 |
| `size` | `'sm'` \| `'md'` | `'md'` | sm = 10px 字、md = 11px 字 |

#### 3.1.1 type 语义表（最终口径）

| type | 颜色 | 语义 | 典型场景 |
|---|---|---|---|
| `warn-solid` | 红实心 + 白字 | 需立刻处理 + 醒目 count badge | hero 上"3 待确认"；admin 视角下「待确认」单条 |
| `warn` | 红浅底 + 红字 | 需立刻处理（次紧迫） | v2.1 暂不用，留给 reconfirm UX |
| `amber` | 琥珀浅底 + 棕字 | 需用户在合理时间内行动，**不紧急** | 会员视角「确认中」、「待录分」 |
| `ok` | 绿浅底 + 深绿字 | 成功完成 | 「已确认」、sheet result 行 ✓ 标识 |
| `muted` | 灰底 + 灰字 | 中性、无紧迫、元信息 | 「轮空」、「已结束」、「draft」、"14:00 · 1号场" |
| `info` | 黑实心 + 白字 | 文档型/分类标签 | 「公开赛」、「regularRound」分类徽章 |

**实施约束**：禁止页面或其他组件再写自己的 `.tag-xx` CSS 类（lint 加规则）。赛事类型类标签（如「单打」「双打」「四局制」）也走 `<status-tag type="info">`，但状态语义不在本规则范围内。

### 3.2 `components/empty-state`（新）

**用途**：替代"暂无数据"toast 与无路径 placeholder 文字。

**API**

```wxml
<empty-state
  icon="sprout"
  title="本周没有待录分的比赛"
  subtitle="管理员发布后会在这里出现"
  action="查看赛程"
  bindaction="onViewSchedule"
/>
```

| Prop | Type | Required | 说明 |
|---|---|---|---|
| `icon` | `'sprout'` \| `'check'` \| `'warn'` \| `'plus'` \| `null` | optional | 可为 null（不显图标） |
| `title` | String | **required** | 一句话解释空因 |
| `subtitle` | String | optional | 补充说明，可省 |
| `action` | String | **required** | CTA 文案 |
| `bindaction` | event | **required** | CTA 点击事件 |

**强制约束**：组件运行时只能校验 `action` prop 存在（缺失则 `console.error`）。`bindaction` 是否绑定无法在组件内可靠检测——由 **lint 规则 / 手工 review / E2E（§6.2 E2E-10）** 三层保证。组件内部点击 CTA 统一 emit `triggerEvent('action')`；父页未绑定 `bindaction` 时事件丢弃但 UI 不破。

设计原则不变：v2.1 规则是"空态必须告诉用户下一步能做什么"，但执行手段从"组件兜底"改为"工程约束 + 测试 + 审阅"，避免组件做无法实现的父级绑定推断。

### 3.3 `components/batch-result-sheet`（新 · X1 核心）

**用途**：工作台 hero CTA、tournament-score sticky CTA 触发的"review-then-confirm"底部 sheet。

**API**

```wxml
<batch-result-sheet
  visible="{{sheetVisible}}"
  title="待确认比分"
  mode="confirm"
  items="{{reviewItems}}"
  result="{{batchResult}}"
  bindcommit="onSheetCommit"
  bindretry="onSheetRetry"
  bindeditrow="onSheetEditRow"
  bindclose="onSheetClose"
/>
```

| Prop | Type | 说明 |
|---|---|---|
| `visible` | Boolean | parent 控制 |
| `title` | String | sheet 顶部标题 |
| `mode` | `'submit'` \| `'confirm'` \| `'reconfirm'` | 决定 CTA 文案与 emit 上下文。`'reconfirm'` 仅占位，v2.1 内不主动触发 |
| `items` | Array<MatchReviewItem> | 见 §3.3.1 |
| `result` | Object \| null | parent 收到 batch action 返回后塞入；见 §3.3.2 |
| `bindcommit` | event | sheet "确认/提交 N 场" 点击 |
| `bindretry` | event | sheet "重试失败 M 条" 点击 |
| `bindeditrow` | event | 用户点单行"逐条改" |
| `bindclose` | event | sheet 关闭（手动 / all-ok / cancel） |

#### 3.3.1 MatchReviewItem 结构

```js
{
  matchId: 'mr_abc',
  tournamentId: 't_xxx',
  tournamentName: 'XXX 杯',
  round: 'R1',
  position: 3,                    // 显示 R1-3
  scheduledStartLabel: '14:00',   // 已格式化
  courtName: '1 号场',
  p1: { name: '王明', partnerName: '李强' },   // partnerName 仅双打
  p2: { name: '张明', partnerName: '赵亮' },
  score: { sets: [{ a: 4, b: 2 }], tiebreak: null },  // Phase 8 score 结构
  isDoubles: true,
  submitter: { memberId: 'mem_xxx', name: '王明' },   // 可选，用于审计
  submittedAt: ServerDate,                            // 可选
  updateTime: ServerDate                              // 必填，乐观锁字段；parent commit 时映射为 expectedUpdateTime
}
```

#### 3.3.2 result 结构（parent 收到 batch action 返回后塞入）

```js
{
  requestId: 'req_<uuid>',
  successIds: ['mr_abc', 'mr_ghi'],
  failures: [
    {
      matchId: 'mr_def',
      code: 'STALE_VERSION',
      message: '该比分已被其他管理员处理',
      retryable: false,
      requestId: 'req_<uuid>'
    }
  ]
}
```

#### 3.3.3 状态机

```
closed → previewing → submitting → result(partial|all-ok) ──→ done(close)
                  ↑          │
                  └── (retry) ┘
```

| state | 触发 | UI |
|---|---|---|
| `closed` | 初始 | 隐藏 |
| `previewing` | parent 设 visible=true | 列 items + 底部 CTA "提交/确认 N 场" |
| `submitting` | 用户点 commit/retry | 半透蒙层 + 居中 spinner；按钮禁用 |
| `result(partial)` | parent 设 result（有 failures）| 显示成功/失败混合；失败行展开 code+message；按钮 "重试失败 M 条"（如 retryable）+ "完成" |
| `result(all-ok)` | parent 设 result（无 failures）| 显示全 ✓；3s 计时后 emit close `reason='all-ok'` |
| `done` | bindclose 后 | parent 切 visible=false |

#### 3.3.4 关键不变量

- `requestId` 在 sheet 整个生命周期内**只生成一次**（开 sheet 时由 parent 生成），所有 retry 复用
- 单 sheet 内永远 ≤ 1 个云函数请求在飞（submitting 期间禁用 commit/retry 按钮）
- close 之后 parent **必须** refreshSnapshot（含 300ms debounce）
- sheet destroy / close 时清理 `all-ok` 3s timer，避免重复 close 或 setData on detached component
- retry 只重试 `retryable=true` 的失败项；retryable=false 的灰色不可点

### 3.4 `components/score-row` 改造（仅视觉）

**保留**（不动）：折叠/展开动画、双打 2 行布局、stepper 0-4、3:3 抢七 input、reconfirm 二次确认弹窗、`submit/newScore` event 协议。

**改造清单**（≈ 60 行 wxss 变更，0 行 js 变更）。token 一律使用 `miniprogram/styles/tokens.wxss` 现有定义，**v2.1 不引入新 token**：

| 改前 | 改后 |
|---|---|
| `#333` 硬编码（深字） | `var(--color-ink)` |
| `#999` 硬编码（次要字） | `var(--color-muted)` |
| `#f5f5f5` 硬编码（灰底） | `var(--color-bg-2)` 或 `var(--color-bg-3)` 视层级 |
| WXS 拼接的 "14:00 · 1号场" + 自定义灰底 | `<status-tag type="muted" text="14:00 · 1号场" />` |
| 自己的 `.tag-confirmed / .tag-pending` CSS 类 | `<status-tag type=...>` 复用 |
| stepper 紫色 `#4F46E5` | `var(--color-lime)`（含 hover/active）+ 字 `var(--color-ink)` |
| 3:3 抢七紫色高亮 | `var(--color-lime)` 高亮 + 文字「决胜局」 |
| 二次确认 modal 灰底 | 复用现有 modal 样式（含 `var(--color-bg-2)` + `--shadow-lifted`）；若现有 modal 未走 token，单独列入 v2.2 |

---

## 4. 后端契约

### 4.1 Envelope 协议（所有新 action 共用）

```js
// success
{ success: true, data: { ... } }

// failure
{ success: false, error: { code: 'XXX', message: '...', requestId?: 'req_<uuid>' } }
```

- `success: false` **仅用于整批级拒绝**：`FORBIDDEN` / `INVALID_PAYLOAD` / `SNAPSHOT_TIMEOUT` / `SUMMARY_TIMEOUT` / `BATCH_TIMEOUT`。
- 批量接口（batchConfirm / batchSubmit）即便有部分失败，整体仍返回 `success: true`，失败项在 `data.failures[]`。
- 失败 envelope 的 `error.requestId` 字段**对 batch action 必填**（特别是 `BATCH_TIMEOUT`，前端需要它复用同一 group id 重试）；snapshot / mySummary 等非 batch action 失败时该字段可省。

### 4.2 `tournaments.adminConsoleSnapshot`（新）

**目的**：工作台首屏 hero + 块 1（待确认统计/分组）+ 块 2（草稿）+ 块 3（进行中）。**不**含 match-level review items（由 §4.6 二次拉）和已结束赛事列表（由 §4.7 lazy load）。

**Input**

```js
{
  action: 'adminConsoleSnapshot',
  payload: {}                       // 无 includeFinished / finishedLimit；已结束块完全独立
}
```

**Output**

```js
{
  success: true,
  data: {
    pendingConfirm: {
      total: 3,
      byTournament: [
        { tournamentId, tournamentName, format, count: 2, mostRecentSubmitAt }
      ]
    },
    myDrafts: [
      { tournamentId, name, playerCount, scheduleReady, updatedAt }
    ],
    ongoing: [
      { tournamentId, name, format, round: 'R2/3', remainingMatches: 6 }
    ]
  }
}
```

**约束**

- Admin only（非 admin 返回 `success: false, error: { code: 'FORBIDDEN' }`）
- 并行拉 3 路子查询：`match_results.aggregate({resultStatus: 'submitted'})`、`tournaments.list(status='draft', createdBy=me)`、`tournaments.list(status='ongoing')`
- **任一子查询失败 → 整体 `success: false, error: { code: 'SNAPSHOT_TIMEOUT' | 'SNAPSHOT_FAILED' }`**。snapshot 内**不再有"单块降级"概念**（已结束块独立 lazy load 不属于 snapshot）。
- 整体超时硬上限：8s

### 4.3 `match-results.mySummary`（新 · 并入 match-results）

**位置**：`cloudfunctions/match-results/lib/handlers/my-summary.js`（match-results 主入口拆分后的子 handler；详见 §4.7）

**Input**

```js
{
  action: 'mySummary',
  payload: {
    historyLimit: 10                // default 10, ≤ 50
  }
}
```

**Output**

```js
{
  success: true,
  data: {
    pending: [
      { matchId, tournamentId, tournamentName, round, position,
        scheduledStart, courtName, p1, p2, partnerLabel, isDoubles }
    ],
    submitted: [
      { matchId, tournamentId, tournamentName, round, score, submittedAt, opponentLabel }
    ],
    confirmed: [
      { matchId, tournamentName, round, score, isWinner, pointsEarned, confirmedAt }
    ]
  }
}
```

**约束**

- 任何已登录会员可用（admin 也可用，看的是自己作为参赛者的视图）
- `pending` 必须同时匹配 `playerId` 和 `partnerId`（双打两个 memberId 都算"我"参赛）
- `confirmed.pointsEarned` 是过滤 `pointsAwarded.entries[].memberId === me` 后求和（含 placement 行）
- 超时硬上限：6s，返回 `success: false, error: { code: 'SUMMARY_TIMEOUT' }`

### 4.4 `match-results.batchConfirm`（新 · admin only）

**位置**：`cloudfunctions/match-results/lib/handlers/batch.js`

**Input**

```js
{
  action: 'batchConfirm',
  payload: {
    matches: [
      { matchId: 'mr_abc', expectedUpdateTime: '2026-05-16T14:23:45.123Z' },
      { matchId: 'mr_def', expectedUpdateTime: '2026-05-16T14:24:10.456Z' }
    ],
    requestId: 'req_<uuid>'       // batch group id, 由前端 parent 在开 sheet 时生成
  }
}
```

**Output**

```js
{
  success: true,
  data: {
    requestId: 'req_<uuid>',
    successIds: ['mr_abc'],
    failures: [
      {
        matchId: 'mr_def',
        code: 'STALE_VERSION',
        message: '该比分已被其他管理员处理（数据已更新）',
        retryable: false,
        requestId: 'req_<uuid>'
      }
    ]
  }
}
```

**核心约束**

- **整体响应 `success: true`，即使有 failures**（部分失败不抬升为整批失败）
- **乐观锁**：每场处理前后端 `current = await get(matchId)`，校验 `current.updateTime.getTime() === new Date(item.expectedUpdateTime).getTime()`。不匹配返回该场 `{ code: 'STALE_VERSION', retryable: false }`，并**不**修改该行
- 校验通过后调用 Phase 8 现有 `state.confirmOne`（内部会更新 `updateTime`）；失败收进 `failures[]`，继续下一场
- 写 `_request_log[requestId].results[matchId]`：成功记 `{ state: 'success', confirmedAt }`；失败记 `{ state: 'failure', code, message, retryable, attemptCount }`
- **`requestId` 是 batch group id**：同 requestId 重复调用时，已 `success` 的 matchId 跳过；payload 内此次未列出的 matchId 保持上次结果不动；列出的 matchId 重新跑（覆盖该 matchId 上次结果）
- **重试时前端必须重新拉 review item 拿到最新 `updateTime`**——绝不复用上次 commit 时的 expectedUpdateTime（防止覆盖被他人修改的数据）
- Payload 缺 `matches[i].expectedUpdateTime` → 整批 `success: false, error: { code: 'INVALID_PAYLOAD', requestId }`
- 单场最大处理时间 1.5s；整批 25s 硬超时（≥ 16 场需分两次，由前端在 commit 时拆分；服务端不做自动拆分）
- 超过整批超时时返回 `success: false, error: { code: 'BATCH_TIMEOUT', requestId }`，**已在飞的子操作可能已写入**（详见 §4.12 BATCH_TIMEOUT 语义）

### 4.5 `match-results.batchSubmit`（新 · 参赛方）

**位置**：`cloudfunctions/match-results/lib/handlers/batch.js`

**Input**

```js
{
  action: 'batchSubmit',
  payload: {
    submissions: [
      {
        matchId: 'mr_abc',
        score: { sets: [{ a: 4, b: 2 }], tiebreak: null }   // 与 Phase 8 完全一致
      },
      {
        matchId: 'mr_def',
        score: { sets: [{ a: 4, b: 3 }], tiebreak: '7-5' }
      }
    ],
    requestId: 'req_<uuid>'
  }
}
```

**Output**：与 batchConfirm 同结构。

**核心约束**

- 调用方 OPENID 必须在每场 `playerIds[]` 里（含 partnerId 双打），否则该场 `code: 'FORBIDDEN'`
- 提交 confirmed 行返回 `code: 'CANNOT_OVERWRITE_CONFIRMED'`（会员永远不能改 confirmed，admin 走 reconfirm）
- `score` 走 Phase 8 现有 `validateScore` 校验，结构非法返 `code: 'INVALID_SCORE'`
- 同一 `requestId` 复用规则同 batchConfirm

### 4.6 `match-results.pendingReviewItems`（新 · admin only · sheet 二次拉）

**目的**：admin 点工作台 hero CTA 或块 1 内某赛事行后，拉 match-level review items 喂给 batch-result-sheet。Snapshot **不**预拉这些数据，避免首屏体积。

**位置**：`cloudfunctions/match-results/lib/handlers/query.js`

**Input**

```js
{
  action: 'pendingReviewItems',
  payload: {
    tournamentId: 't_xxx' | null,   // null = 拉所有赛事；指定 = 仅该赛事
    limit: 50                        // 默认 50，硬上限 100
  }
}
```

**Output**

```js
{
  success: true,
  data: {
    items: [
      // 完整 MatchReviewItem 结构（§3.3.1），含 updateTime
      {
        matchId, tournamentId, tournamentName, round, position,
        scheduledStartLabel, courtName,
        p1, p2, score, isDoubles, submitter, submittedAt,
        updateTime    // 乐观锁字段
      }
    ],
    truncated: false   // 若 total > limit，true；前端可提示
  }
}
```

**约束**

- Admin only
- 内部 query：`match_results.where({ resultStatus: 'submitted' [, tournamentId] }).orderBy('updateTime', 'desc').limit(limit)`
- 同步 join：tournaments 拉 name/format；members 拉 submitter name（如 items 内 submitter.name 缺失）
- 超时 5s，超时返回 `success: false, error: { code: 'QUERY_TIMEOUT' }`

### 4.7 `tournaments.finishedRecent`（新 · admin only · 已结束块 lazy load）

**目的**：用户展开工作台"已结束"块时调用。与 snapshot 完全解耦。

**Input**

```js
{
  action: 'finishedRecent',
  payload: {
    limit: 5                         // 默认 5，硬上限 20
  }
}
```

**Output**

```js
{
  success: true,
  data: {
    items: [
      { tournamentId, name, format, completedAt, winnerLabel }
    ]
  }
}
```

**约束**

- Admin only
- `tournaments.where({ status: 'completed' }).orderBy('completedAt', 'desc').limit(limit)`
- 失败时仅影响"已结束"块内联状态，不影响工作台其他块（前端已 lazy load）

### 4.8 已有 action 兼容（不动）

| action | 处置 |
|---|---|
| `match-results.submit` | 保留，前端单场录入仍可用 |
| `match-results.confirmAll` | 保留，旧 tournament-score 路径仍可用 |
| `match-results.reconfirmMatch` | 保留，admin 改已确认仍走它（v2.1 不动 reconfirm UX）|
| `match-results.submittedQueue` | 保留 |
| `match-results.listByTournament` | 保留 |
| `match-results.listByPlayer` | 保留（my-match 新走 `mySummary`，但兼容入口仍存在）|

### 4.9 `match-results` 结构拆分

```
cloudfunctions/match-results/
├── index.js                       # 仅 envelope 路由分发，≤ 150 行
├── lib/
│   ├── state.js                   # Phase 8 现状，不动
│   ├── score-rule.js              # Phase 8 现状，不动
│   ├── award.js                   # vendored _shared/award.js
│   └── handlers/                  # 新建
│       ├── batch.js               # batchConfirm + batchSubmit
│       ├── submit.js              # submit / confirmAll / reconfirmMatch（迁旧逻辑）
│       ├── query.js               # submittedQueue / listByTournament / listByPlayer / pendingReviewItems
│       └── my-summary.js          # mySummary
```

旧 action 一律保留，路由从 `index.js` 分发到对应 handler。

### 4.10 `_request_log` 集合 schema（新 · 落 DATABASE_SCHEMA.md）

```js
// collection: _request_log
{
  _id: 'req_<uuid>',                 // = requestId（batch group id）
  action: 'batchConfirm' | 'batchSubmit',
  callerOpenid: 'oXXX',
  callerMemberId: 'mem_xxx',
  firstSeenAt: ServerDate,
  lastSeenAt: ServerDate,
  results: {                         // map<matchId, perMatchResult>
    'mr_abc': { state: 'success', confirmedAt: ServerDate, attemptCount: 1 },
    'mr_def': {
      state: 'failure',
      code: 'CLOUD_TIMEOUT',
      message: '...',
      retryable: true,
      attemptCount: 2
    }
  },
  closedAt: ServerDate | null        // 全部 success 或 sheet 显式 close 时打戳
}
```

- TTL 索引：`lastSeenAt + 30 天` 自动清理
- 索引：`(callerOpenid, lastSeenAt desc)` 便于按用户审计
- 写入位置：`batch.js` 处理每条 submission 后立即写 `results[matchId]`

### 4.11 错误码表

| code | retryable | scope | 适用 action | 含义 |
|---|---|---|---|---|
| `STALE_VERSION` | false | per-match | batchConfirm | `expectedUpdateTime` 不匹配 current `updateTime`；数据被其他人改了 |
| `CLOUD_TIMEOUT` | true | per-match | both | 单场云函数超时（< 整批超时） |
| `DB_CONFLICT` | true | per-match | both | 数据库写入冲突 |
| `INVALID_STATE` | false | per-match | batchConfirm | 状态不是 submitted（已 confirmed 或 pending） |
| `INVALID_SCORE` | false | per-match | batchSubmit | score 结构非法或不符合 4 局 + 抢七规则 |
| `MISSING_SCORE` | false | per-match | batchConfirm | 比分为空 |
| `CANNOT_OVERWRITE_CONFIRMED` | false | per-match | batchSubmit | 会员不能覆盖 confirmed 行 |
| `FORBIDDEN` | false | per-match \| batch | both | 非参赛方/非 admin |
| `INVALID_PAYLOAD` | false | batch | both | 整批 payload 结构非法（如 batchConfirm 缺 `expectedUpdateTime`） |
| `SNAPSHOT_TIMEOUT` | true | batch | adminConsoleSnapshot | 整体超时 |
| `SNAPSHOT_FAILED` | true | batch | adminConsoleSnapshot | 非超时的整体失败 |
| `SUMMARY_TIMEOUT` | true | batch | mySummary | 整体超时 |
| `QUERY_TIMEOUT` | true | batch | pendingReviewItems / finishedRecent | 二次拉接口超时 |
| `BATCH_TIMEOUT` | true | batch | batchConfirm/batchSubmit | 整批超过 25s；envelope 必带 requestId；已写入子操作的状态可通过 `_request_log` 查 |

### 4.12 `BATCH_TIMEOUT` 语义说明

整批超时（或 `NETWORK` / `CLOUD_TIMEOUT` 整批级未知结果）时，前端收 `success: false, error: { code: 'BATCH_TIMEOUT' | 'NETWORK', requestId }`。后端可能已经成功处理部分 match 并写入 `_request_log[requestId].results`。

**前端处理**（"未知结果"路径，与 §4.13 retry 规则配合）：
- 提示 admin「请求超时，部分已提交。重试将合并已有结果」
- 用户点重试 → 复用同一 `requestId` 调一次新的 batchConfirm，payload 仍是**原 matches 全集**（含每场原 `expectedUpdateTime`，**不**预先重拉）
- 后端读 `_request_log[requestId].results`：已 `success` 的 matchId 跳过；剩余 matchId 按 §4.4 规则正常处理（含 `expectedUpdateTime` 校验）
- 若剩余 match 的 `current.updateTime` 已变（被其他人改过），后端按 STALE_VERSION 返回该行；其它正常 confirm
- 重要：这条路径保证"不重复 confirm、不重复结算积分"，同时不盲覆盖他人修改

### 4.13 Retry 规则（区分两种失败路径）

| 失败路径 | 重试前是否重拉 review item | 重试 payload | 原因 |
|---|---|---|---|
| **`result(partial)` 内某行 retryable=true**（如单场 `CLOUD_TIMEOUT` / `DB_CONFLICT`） | **必须重拉**该行的 `pendingReviewItems` 拿最新 `updateTime` | 仅失败行，复用同一 `requestId` | 已知后端单条失败、其他行已 success；重拉避免覆盖他人在等待期间的修改 |
| **整批 `success: false`（`BATCH_TIMEOUT` / `NETWORK`）整批未知结果** | **不**预先重拉 | 原 matches 全集，复用同一 `requestId` | 客户端不知道哪些已成功；用 `_request_log` 合并已 success 项；server 端再做 `expectedUpdateTime` 校验，已变更行返 STALE_VERSION |

**关键**：两种路径在 sheet 内对 admin 表现一致（result(partial) UI），但底层重试行为不同。sheet 内部根据 parent 提供的 `result.failures` 或 envelope `error.code` 自动判定路径。

**STALE_VERSION 处理**：无论哪条路径，STALE_VERSION 行始终 `retryable=false`、sheet 内灰色不可点；admin 必须 close + 重开 sheet（snapshot 刷新带来新 items + 新 `expectedUpdateTime`）。

---

## 5. 数据流与错误恢复

### 5.1 `utils/cloud.callFunction` wrapper（统一 cloud client）

```js
// utils/cloud.js
async function callFunction(name, payload, options = {}) {
  const { traceId = generateTraceId(), timeout = 8000, onLoading } = options
  if (onLoading) onLoading(true)

  try {
    const res = await wx.cloud.callFunction({
      name,
      data: payload,
      config: { timeout }
    })
    const env = res.result
    if (!env || typeof env.success !== 'boolean') {
      return { ok: false, error: {
        code: 'INVALID_ENVELOPE',
        message: 'cloud function 返回非 envelope',
        retryable: false
      }, traceId }
    }
    if (env.success === false) {
      return { ok: false, error: { ...env.error }, traceId }
    }
    return { ok: true, data: env.data, traceId }
  } catch (e) {
    const code = classifyClientError(e)    // 先存局部变量
    return { ok: false, error: {
      code,
      message: e.errMsg || e.message || '请求失败',
      retryable: ['NETWORK','TIMEOUT'].includes(code)
    }, traceId }
  } finally {
    if (onLoading) onLoading(false)
  }
}
```

**契约**

- 永远返回 `{ ok: true, data, traceId } | { ok: false, error: { code, message, retryable }, traceId }`，**永不抛**
- 调用方判 `ok` 即可，不需要再解包 envelope
- `onLoading(true/false)` 回调：parent 页面绑 loading state，不再每页自写 `wx.showLoading`

**重要区分**：

- 上面 wrapper 内的 `traceId` 是**前端 trace id**（每次 call 都新），用于客户端日志关联
- 批量接口（batchConfirm / batchSubmit）payload 内的 `requestId` 是**后端 batch group id**，必须由 parent 在开 sheet 时显式生成并放进 `payload.requestId`
- 二者不能混用

### 5.2 三页页面状态机

#### 5.2.1 `tournament-manage`

```
              ┌──── onShow ────┐
              ▼                │
        idle ─→ loading ─→ loaded ─→ refreshing ─→ loaded
                       │       │
                       ▼       ▼
                     error ←── stale-after-sheet-close
                       │
                       ▼ tap retry
                     loading
```

- `onLoad`: 首次进入 → loading → 调 `adminConsoleSnapshot` → loaded / error
- `onShow`: 每次 tab 切回 / 从其他页 navigateBack → refreshing → 同 action
- **sheet 关闭后**：parent 显式触发 `refreshing` 拉最新 snapshot（300ms debounce + 与 onShow 合并去重）
- error 状态：全屏 `<empty-state icon="warn" ... action="重新加载" />`

#### 5.2.2 `my-match`

```
        idle ─→ loading ─→ loaded ─→ refreshing ─→ loaded
                      │
                      ▼
                    error
```

- `onShow` 调 `mySummary`
- 用户点条目跳 tournament-score，不在本页编辑

#### 5.2.3 `tournament-score`

```
        idle ─→ loading ─→ loaded ─┬─→ row-editing(matchId) ─→ loaded
                                   ├─→ admin-batch-sheet ─→ loaded
                                   └─→ member-submit-sheet ─→ loaded
```

- score-row 单行编辑：本地 dirty state，提交时调 `match-results.submit`（单场，复用旧 action）
- admin sticky "审核并确认 N 场" → 开 batch-result-sheet · mode=`confirm` → 调 `batchConfirm`
- 会员 sticky "提交比分 N 场" → 开 batch-result-sheet · mode=`submit` → 调 `batchSubmit`

### 5.3 batch-result-sheet 完整 sequence（admin partial-failure + retry）

```
admin 工作台 (已加载 snapshot)
  │
  │ tap hero "→ 审核并确认 3 场"
  ▼
parent.requestId = generateRequestId()       # batch group id, sheet 生命周期内只生成一次
parent.openSheet({ mode: 'confirm', loading: true })  # 立刻开 sheet 显 skeleton
  │
  ▼ utils/cloud.callFunction('match-results', {
        action: 'pendingReviewItems', payload: { tournamentId: null, limit: 50 }
    })
        ▼ return { success: true, data: { items: [{...updateTime, score, p1, p2, ...}, ...] }}
  │
parent.items = data.items
sheet.state = 'previewing'                    # skeleton 切换到 review cards
  │
  │ admin 看完三条比分, tap "确认 3 场"
  ▼
sheet emit commit { matchIds: ['mr_a','mr_b','mr_c'] }
parent.state = 'submitting'; sheet.state = 'submitting'
  │
  │ parent 把 items[i].updateTime 映射成 expectedUpdateTime
  ▼ utils/cloud.callFunction('match-results', {
        action:'batchConfirm',
        payload:{
          matches: [
            { matchId:'mr_a', expectedUpdateTime: items.mr_a.updateTime },
            { matchId:'mr_b', expectedUpdateTime: items.mr_b.updateTime },
            { matchId:'mr_c', expectedUpdateTime: items.mr_c.updateTime }
          ],
          requestId: parent.requestId
        }
    })
        ▼ cloud 逐场处理（含 expectedUpdateTime 校验）
        ▼ writeLog _request_log[requestId].results
        ▼ return { success:true, data:{
              successIds:['mr_a','mr_c'],
              failures:[{ matchId:'mr_b', code:'CLOUD_TIMEOUT', retryable:true, requestId }],
              requestId
          }}
  │
parent receives result
sheet.result = { successIds, failures }
sheet.state = 'result(partial)'
  │
  │ admin sees "✓ 2 / ✗ 1", tap "重试失败 1 条"
  ▼
sheet emit retry { failureIds:['mr_b'] }
  │
  │ 重试前 parent **重新拉 mr_b 的 review item**（拿最新 updateTime）
  ▼ utils/cloud.callFunction('match-results', {
        action: 'pendingReviewItems',
        payload: { tournamentId: items.mr_b.tournamentId, limit: 50 }
    })
        ▼ return { items: [..., mr_b: { updateTime: 新值 }, ...] }
  │
parent.items.mr_b = 新 item（含新 updateTime）
  ▼ utils/cloud.callFunction('match-results', {
        action:'batchConfirm',
        payload:{ matches: [{ matchId:'mr_b', expectedUpdateTime: 新值 }], requestId: parent.requestId }
    })
        ▼ cloud 读 _request_log[requestId].results
        ▼ 'mr_a' / 'mr_c' 已 success, 跳过
        ▼ 重跑 'mr_b'（用新 expectedUpdateTime 校验）→ success → 更新 _request_log
        ▼ return { successIds:['mr_b'], failures:[], requestId }
  │
parent merges: 累计 successIds = ['mr_a','mr_b','mr_c']
sheet.result = { successIds: [...all], failures: [] }
sheet.state = 'result(all-ok)'
  │
  │ 3s timer
  ▼
sheet emit close { reason: 'all-ok' }
parent.refreshSnapshot() (300ms debounce)
工作台 hero 数字 3 → 0
```

**关键不变量补充**（来自 expectedUpdateTime 引入 · 区分两种路径，详 §4.13）：
- `result(partial)` 内 retryable 失败行：retry 前**必须**重新拉该行 `pendingReviewItems` 拿新 `updateTime`；retry payload 仅含失败行，复用 `requestId`。
- 整批级 `success: false`（`BATCH_TIMEOUT` / `NETWORK`）未知结果：retry **不**预先重拉，直接复用 `requestId` 重发**原 matches 全集**；服务端通过 `_request_log` 合并已 success 项；剩余项做 `expectedUpdateTime` 校验，已变更返 STALE_VERSION。
- STALE_VERSION 行（任意路径产生）`retryable=false`、灰色不可点；admin 必须 close + 重开 sheet 才能继续。

### 5.4 并发与脏数据边界

| 场景 | 行为 | UI 反馈 |
|---|---|---|
| 两个 admin 同时 batchConfirm 同一 matchId | 后到者收 `STALE_VERSION` | sheet 失败行展示「已被其他管理员处理」+ 灰色不可重试（**禁止强制覆盖**） |
| 会员在 admin batchConfirm 期间再次 submit | 会员 submit 成功（覆盖 submitted），admin 看到 STALE_VERSION 后需重新拉 snapshot；若仍要操作走 `reconfirmMatch` | admin 重新打开 sheet 看新数据 |
| 网络断在 batchConfirm 飞行中 | parent 收 `code: 'CLOUD_TIMEOUT' | 'NETWORK'`, retryable=true | sheet result(partial) 失败条可重试；复用同一 requestId 后端合并已写入项 |
| BATCH_TIMEOUT（整批超时） | 整批 `success: false, error.code='BATCH_TIMEOUT'` | sheet 提示「请求超时，部分已提交。重试将合并已有结果」+「重试全部」 |
| admin 在 result(partial) 后切到别的 tab | sheet 关闭，close reason=`manual`；parent 仍触发 refresh（debounce） | 回工作台看到的 hero 数字已扣除成功项 |
| sheet 还没 commit 就关闭 | close reason=`cancel`，parent 不触发任何云函数；本地 state 丢弃 | 工作台数字不变 |

**核心原则**：脏数据只可能短暂存在（≤ 一次 snapshot 刷新周期），每次 sheet close / 页面 onShow 都强制 refetch（300ms debounce）。

### 5.5 Loading / Empty / Error 决策矩阵

| 页面 | loading | empty | error | partial-loading |
|---|---|---|---|---|
| **tournament-manage** | hero skeleton + 3 块灰色 placeholder（不含已结束块）+ 已结束块默认收起态 | `<empty-state icon="check" title="没有任务" subtitle="新建赛事或等待会员提交比分" action="+ 创建赛事" />`（全屏，无 hero） | `<empty-state icon="warn" title="加载失败" subtitle="{error.message}" action="重新加载" />`（全屏） | 已结束块独立 lazy load：展开时块内 inline loading；失败时块内「暂时无法加载 · 重试」（不影响其他块） |
| **batch-result-sheet 二次拉** | sheet 显示 skeleton（3 行 review-card 灰底）+ 顶部 spinner | n/a（snapshot 已确认 pendingConfirm.total > 0 才会开 sheet）| sheet 内显示 `<empty-state icon="warn" title="加载失败" subtitle="..." action="重新加载" />` → 重新调 pendingReviewItems | n/a |
| **my-match** | hero skeleton + 3 块 placeholder | `<empty-state icon="sprout" title="本周没有比赛" subtitle="加入下一场赛事或查看历史" action="查看赛程" />` | 同 manage 风格 | n/a（mySummary 不分块降级） |
| **tournament-score** | 顶部 progress skeleton + 3 行 score-row placeholder | **数据异常**：`<empty-state icon="warn" title="比赛数据异常" subtitle="该赛事没有比赛数据" action="重新加载" />`（不视作 empty） | 同上 | n/a |
| **batch-result-sheet 内 submit/confirm** | submitting 状态全 sheet 半透蒙层 + 居中 spinner；按钮禁用 | n/a | result(partial) 内联失败行 | n/a |

**禁用范围（v2.1 局部规则，不全站）**：
- `wx.showLoading` → 不允许在三页 + sheet 内使用
- `wx.showToast({ title: '加载失败' })` → 不允许在三页 + sheet 内使用
- 错误反馈一律由 `empty-state` 或 sheet 内 result(partial) 表达
- 其他页面（home/rank/tournament-edit/...）保持现状

### 5.6 兼容与回滚

- 任何新 action 上线**不删旧 action**。旧前端代码（如旧 tournament-score 链接、旧 manage 页）依然走 `submit / confirmAll`。
- 若新 action 在云端 incident：发布新版小程序，把 `tournament-manage` 入口换回旧 `pages/manage/index`。`manage/index` 在 v2.1 不删，正是为此保留。
- v2.1 **不需要 feature flag**：小程序自带审核/发布流，灰度由微信平台控制。

---

## 6. 测试与验收

### 6.1 单元测试

| 模块 | 覆盖率门槛 | 关键用例数 |
|---|---|---|
| `cloudfunctions/match-results/lib/handlers/batch.js`（新） | ≥ 90% lines / 80% branches | ≥ 20 |
| `cloudfunctions/match-results/lib/handlers/submit.js`（迁旧） | 不退化（与现状一致） | 现状 |
| `cloudfunctions/match-results/lib/handlers/query.js`（迁旧） | 不退化 | 现状 |
| `cloudfunctions/match-results/lib/handlers/my-summary.js`（新） | ≥ 85% lines | ≥ 8 |
| `cloudfunctions/tournaments/index.js:adminConsoleSnapshot`（新 handler） | ≥ 85% lines | ≥ 8（权限 / 超时 / 任一子查询失败整体 error / 并行执行 / payload 为空） |
| `cloudfunctions/tournaments/index.js:finishedRecent`（新 handler） | ≥ 85% lines | ≥ 5（权限 / limit 默认与硬上限 / 排序 / 空结果 / 超时） |
| `cloudfunctions/match-results/lib/handlers/query.js:pendingReviewItems`（新） | ≥ 85% lines | ≥ 8（权限 / 含 tournamentId / 不含 tournamentId / limit 默认与硬上限 / truncated 标记 / updateTime 字段必出现 / submitter join / 超时） |
| `miniprogram/utils/cloud.js:callFunction` wrapper | ≥ 90% lines | ≥ 8（success / FORBIDDEN / 超时 / 网络错 / 非法 envelope / 永不抛 / loading 回调 / traceId） |
| `miniprogram/components/status-tag` | snapshot | 6 type × 含/不含 count = 12 |
| `miniprogram/components/empty-state` | snapshot + assert | 缺 `action` prop 时 `console.error`、点击 CTA 触发 `triggerEvent('action')`、缺 icon/subtitle 仍正常渲染、父级未 bindaction 时事件丢弃不破 UI |
| `miniprogram/components/batch-result-sheet` | ≥ 85% lines | ≥ 12（4 状态切换 / commit emit / retry emit / editrow emit / close emit / result(partial) 失败行 / submitting 禁用按钮 / all-ok 3s 自动关 / destroy 清理 timer / retryable 灰色 / requestId 复用） |

**现状基线（必须不破）**：

```
_shared           22 tests
match-results     55 tests
points-engine     16 tests
tournaments       19 tests
tournament-brackets  44 tests
weekly-star       4 tests
```

### 6.2 E2E 手动验证（v2.1 验收门槛 10 条）

#### E2E-1 · Admin batch happy

- [ ] admin 打开 tab "工作台"
- [ ] hero 显示「3 场待确认」+ 主 CTA「→ 审核并确认 3 场」
- [ ] 点 CTA → sheet 弹起，3 条 review-card 可见，比分/选手/赛事/轮次完整
- [ ] 点「确认 3 场」→ sheet submitting overlay → result(all-ok)「✓ 3 已确认」
- [ ] 3 秒后 sheet 自动关 → 工作台 hero 数字变 0，主 CTA 切换为「+ 创建赛事」
- [ ] `_request_log` 新增一条 requestId，3 个 matchId 全 success
- [ ] **积分验收**：
  - 若赛事 `format='regular'`：3 场 `match_results[i].pointsAwarded.entries` 已写入对应 memberId 与 points
  - 若赛事 `format='knockout'` 且本批含 final/placement：`tournament_points` 集合新增 placement 行
  - 两种情况不混淆

#### E2E-2 · Admin batch partial-STALE

- [ ] 准备：
  - 优先：admin A 开 sheet 但不 commit；admin B 在另一个 session 调 reconfirmMatch 改其中一场比分（这会更新 `match_results.<mr_b>.updateTime`）
  - 备选 fixture：用 cloud 脚本直接 mutate `match_results.<mr_b>.updateTime`（或通过 submit/reconfirm 触发该行 updateTime 刷新），使 admin A 持有的 `expectedUpdateTime` 不再匹配
- [ ] admin A 点「确认 3 场」→ result(partial)「✓ 2 / ✗ 1」
- [ ] 失败行展开显示 `code: STALE_VERSION`，灰色不可重试，message「该比分已被其他管理员处理」
- [ ] 底部 CTA = 「完成」+「重试失败」按钮**隐藏或灰色不可点**（因 retryable=false）
- [ ] admin A 点「完成」→ sheet 关 → 工作台 refresh → 数字 = 1（admin B 改过的那场仍在 pendingConfirm 里）
- [ ] `_request_log` 显示 mr_b 为 STALE_VERSION，未覆盖 admin B 的修改

#### E2E-3 · Admin batch network failure + retry

- [ ] 准备：admin 工作台 → sheet「确认 3 场」点击瞬间断网（DevTools network throttle: offline）
- [ ] sheet 显示 result(partial) 全 3 条 failure，code=`CLOUD_TIMEOUT` 或 `NETWORK`，retryable=true
- [ ] 恢复网络 → 点「重试失败 3 条」（复用同一 requestId）
- [ ] **正确验收**：
  - 后端读 `_request_log[requestId].results`，**已有 success 项跳过**，pending/failure 项重跑
  - 整体不重复 confirm，不重复写入 `pointsAwarded.entries` 或 `tournament_points`
  - 终态 successIds 累计 3 场，failures 空
- [ ] sheet 3s 自动关 → 工作台数字归 0

#### E2E-4 · 会员 batchSubmit happy

- [ ] 会员（非 admin）开 my-match → hero「你有 2 场待录分」
- [ ] 点 hero CTA → 跳 tournament-score + matchId anchor
- [ ] 在 score-row 内分别录第 1 场 4:2、第 2 场 4:1
- [ ] sticky 显示「→ 提交比分 2 场」→ 点 → sheet review → 点「提交 2 场」
- [ ] result(all-ok)，3s 自动关
- [ ] my-match 重进，hero 数字 0，「确认中」区块新增 2 行 `status-tag amber`
- [ ] admin 端工作台 hero 数字 +2

#### E2E-5 · 会员 batchSubmit FORBIDDEN

- [ ] 用 devtools 模拟：会员 A 用别人的 matchId 调 batchSubmit
- [ ] sheet result(partial) 显示 code=`FORBIDDEN`
- [ ] my-match 状态未变化
- [ ] `_request_log` 记录该 matchId failure

#### E2E-6 · 工作台 snapshot 完全失败 → retry

- [ ] 准备：临时让 `tournaments.adminConsoleSnapshot` 抛错或超时
- [ ] admin 进工作台 → 全屏 empty-state「加载失败」+「重新加载」CTA
- [ ] 期间 hero / 4 块完全不显示残缺数据
- [ ] 恢复云函数 → 点重新加载 → 正常 loaded

#### E2E-7 · 已结束块 lazy load 独立降级

- [ ] 工作台首屏正常 loaded：hero + pendingConfirm + myDrafts + ongoing 全显示，"已结束"块默认收起态
- [ ] 准备：让 `tournaments.finishedRecent` 接口超时
- [ ] 用户展开"已结束"块 → 块内 inline 显示「已结束 · 暂时无法加载 · 重试」
- [ ] 工作台其他三块完全不受影响
- [ ] 恢复接口 → 点 inline 重试 → 块内加载并展示 finished items
- [ ] **同时验证**：让 `adminConsoleSnapshot` 任一子查询失败 → 整体 error（snapshot 内无降级，全屏 empty-state「加载失败」）

#### E2E-8 · 视觉一致性 grep

```bash
# 全部 0 命中
grep -rn '#333\|#999\|#667eea\|#f5f5f5\|linear-gradient(135deg' \
  miniprogram/pages/tournament-manage \
  miniprogram/pages/tournament-score \
  miniprogram/pages/my-match \
  miniprogram/components/score-row

# 全部 0 命中
grep -rn '\.tag-\(confirmed\|pending\|warn\|ok\)' \
  miniprogram/pages/tournament-manage \
  miniprogram/pages/tournament-score \
  miniprogram/pages/my-match \
  miniprogram/components/score-row

# 三页 + sheet 内 0 命中
grep -rn 'wx\.showLoading\|wx\.showToast.*加载失败' \
  miniprogram/pages/tournament-manage \
  miniprogram/pages/tournament-score \
  miniprogram/pages/my-match \
  miniprogram/components/batch-result-sheet
```

#### E2E-9 · 旧入口兼容

- [ ] 旧链接 `pages/tournament-score/index?id=mr_xxx` 仍能进入（单场 matchId 入参）
- [ ] 旧 action `match-results.submit / confirmAll / reconfirmMatch` 通过 Jest 仍绿
- [ ] 旧页 `pages/manage/index` 仍可手动进入并可用

#### E2E-10 · 状态语义勘对

- [ ] 对照 §2.4 状态语义表，三页 + score-row + sheet 内每一处 `<status-tag>` 用法逐一勘对：
  - 会员视角看到 submitted match → `type="amber"` `text="确认中"`
  - admin 视角看到 submitted match → `type="warn-solid"` `text="待确认"`（含 count 时带 badge）
  - 任何视角的 confirmed → `type="ok"` `text="已确认"`
  - BYE → `type="muted"` `text="轮空"`
  - 时段元信息（如 "14:00 · 1号场"）→ `type="muted"`
- [ ] 任一处与表不符 = 视为 v2.1 验收失败

### 6.3 性能基线

| 场景 | 目标 | 测量方法 |
|---|---|---|
| `adminConsoleSnapshot(50 场待确认数据)` | 端到端首屏 ≤ 1.2s | 云函数日志 invokeTime + 前端 `console.info('[v2.1]', ...)` 埋点 |
| `pendingReviewItems(50 场)` | 端到端 ≤ 800ms（admin 点 CTA 到 sheet items 渲染完毕） | 前端埋点 |
| `finishedRecent(5 场)` | 端到端 ≤ 500ms | 前端埋点 |
| `mySummary(100 场历史)` | 端到端 ≤ 800ms | 同上 |
| `batchConfirm(5 场)` | 整批返回 ≤ 3s | 云函数日志 |
| `batchSubmit(5 场)` | 整批返回 ≤ 3s | 云函数日志 |
| sheet open 动画 | 主线程阻塞 < 16ms | DevTools Performance |

### 6.4 视觉验收（QA 截图集）

存放路径：`docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design/qa-screenshots/`

- 工作台 loaded / loading / empty / error 各 1 张
- my-match loaded / loading / empty / error 各 1 张
- tournament-score loaded（含 score-row 改造前后对比 2 张）
- batch-result-sheet previewing / submitting / result(partial) / result(all-ok) 各 1 张
- status-tag 全部 6 type 一张总览
- empty-state 三种典型场景一张总览

### 6.5 已锁定的开放问题决策

| # | 问题 | 决定 | 理由 |
|---|---|---|---|
| 1 | `my-match.summary` 放新云函数 or 并入 match-results | **B · 并入 match-results.mySummary** + 拆 handlers/ 子目录 | 单部署单元，避免 vendored award.js 又添一份 |
| 2 | `_request_log` TTL | **30 天** | 7 天对事故复盘偏短，30 天能覆盖比赛日 + 发布后排查窗口；过老不再有操作意义 |
| 3 | `adminConsoleSnapshot` server cache | **v2.1 不做** | 靠前端 300ms debounce + onShow/sheet close 合并已足；待 QPS 数据出来再决定加 |
| 4 | E2E-2 STALE_VERSION 多端准备 | 维持双 admin 手工 E2E + 增加集成测试 mock 并发场景，备选 cloud 脚本 mutate fixture | DevTools 双 session 不稳，需 fallback |
| 5 | 测试集补 E2E-10 | 增「状态语义勘对」逐一对照 §2.4 表 | 防止任何"自己写法"残留 |

### 6.6 补充测试场景（来自 Codex review）

- 重复点击 commit/retry：submitting 期间只能有一个云函数请求在飞（按钮禁用 + UI 测试）
- sheet destroy / close 时清理 `all-ok` 3s timer，避免重复 close 或 setData on detached component
- retry 只重试 `retryable=true` 的失败项（不传 retryable=false 的 matchId）
- 同一 requestId 下成功项不会重复 confirm，也不会重复写积分（含 entries 和 placement）
- `batchSubmit` 必须覆盖现有比分结构校验：`{ sets: [{ a, b }], tiebreak }`，结构非法返 INVALID_SCORE
- **`expectedUpdateTime` 乐观锁**：
  - 后端校验 `updateTime` 精确匹配（毫秒级），不一致返 STALE_VERSION
  - 缺 `expectedUpdateTime` → 整批 INVALID_PAYLOAD
  - **Retry 规则区分两路径**（详 §4.13）：
    - `result(partial)` 内 retryable 失败行：retry 前**必须**重新拉该行 `pendingReviewItems` 拿新 `updateTime`，payload 仅含失败行
    - `BATCH_TIMEOUT` / `NETWORK` 整批未知结果：**不**预先重拉，直接复用 `requestId` 重发原 matches 全集；服务端用 `_request_log` 合并已 success 项 + 用 `expectedUpdateTime` 校验剩余项
  - STALE_VERSION 行 sheet 内禁用重试，admin 必须 close + 重开 sheet
- **`pendingReviewItems` 二次拉**：
  - `tournamentId=null` 拉全部待确认 items；指定 tournamentId 仅拉该赛事
  - 超过 `limit` 返回 `truncated: true`，前端展示提示
  - sheet open 时立刻显示 skeleton，loading 期间禁用 commit 按钮
- **`finishedRecent` 独立失败**：仅影响"已结束"块内联状态，不影响工作台其他块
- `_request_log` TTL 30 天：写入 7+ 天前的 doc 应被清理（手工验证或 mock TTL 测试）

### 6.7 验收 Gate（这些不过不算 v2.1 完成）

1. 6.1 全部单测绿，覆盖率达标
2. 6.2 E2E-1 ~ E2E-10 全部 [x]
3. 6.3 性能基线全部达标
4. 6.4 截图齐
5. `DATABASE_SCHEMA.md` 已更新（含 `_request_log` 集合）
6. 旧 action 集成测试不破
7. 微信开发者工具问题面板 0 个问题、Console 0 红错

---

## 7. 实施切片建议（写 plan 时参考）

v2.1 建议拆 5 段 Phase，依次完成。每段独立可测、可验收。

| Phase | 内容 | 依赖 |
|---|---|---|
| **P1 · 后端基础** | 新建 `_request_log` collection 与 schema；`match-results` 拆 handlers/；写 `mySummary` + `batchConfirm`（含 `expectedUpdateTime` 乐观锁）+ `batchSubmit` + `pendingReviewItems` 单测 | — |
| **P2 · 工作台接口** | `tournaments.adminConsoleSnapshot`（轻量，仅 hero+三块）+ `tournaments.finishedRecent`（lazy load）实装 + 单测 | P1（共用 batch infra） |
| **P3 · 前端基础设施** | `utils/cloud.callFunction` wrapper + 单测；新建 `status-tag` / `empty-state` / `batch-result-sheet`（含 sheet 内 skeleton + 二次拉编排）三组件 + 单测 | — |
| **P4 · 三页重构** | `tournament-manage`（含已结束块 lazy load）/ `my-match` / `tournament-score` IA 重构；score-row 视觉债清理（用现有 token）；接 P1+P2+P3 | P1, P2, P3 |
| **P5 · E2E + 验收** | E2E-1 ~ E2E-10；性能测；QA 截图；DATABASE_SCHEMA.md 更新（`_request_log` + `match_results.updateTime` 作为乐观锁键说明）；commit & deploy 云函数 | P4 |

P3 与 P1/P2 可并行（前后端无依赖），P4 必须在 P1+P2+P3 完成后启动。

详细 Task 拆分由后续 `writing-plans` skill 输出 `docs/superpowers/plans/09-phase-9-v2.1-quality-iteration.md`（命名续 Phase 8）。

---

## 8. 词汇表

| 术语 | 定义 |
|---|---|
| **batch group id** | 即 `requestId`，由前端 parent 在开 sheet 时生成；同一 sheet 生命周期内所有 retry 复用 |
| **trace id** | `utils/cloud.callFunction` 每次 call 生成的客户端日志关联 id；与 batch group id 不同 |
| **review-then-confirm（X1）** | v2.1 选择的 confirm 操作流：admin 先在 sheet 内审完比分再 batch confirm，禁止盲确认 |
| **expectedUpdateTime** | `match-results.batchConfirm` 的乐观锁键，值是 review item 拉取时记录的 `updateTime`。后端确认前精确匹配，保证 admin 没盲改他人新提交的数据 |
| **review item / pendingReviewItems** | sheet 二次拉接口返回的 match-level 明细，含 `updateTime` 等字段，喂给 `batch-result-sheet.items` |
| **lazy load 块** | 工作台"已结束"块独立 lazy load，与 snapshot 解耦，调 `tournaments.finishedRecent` |
| **partial failure** | 批量接口整体 `success: true` 但 `data.failures[]` 非空的情况 |
| **integral failure** | 批量接口整体 `success: false`，仅用于 FORBIDDEN / INVALID_PAYLOAD / *_TIMEOUT |
| **stale-after-sheet-close** | sheet 关闭后 parent 强制 refresh snapshot 的命名状态（实质等同 refreshing） |

---

## 9. 上下文引用

- 审计依据：`docs/superpowers/audits/2026-05-15-v2-quality-audit.md`
- 沟通日志（含每节决策与 Codex review）：`docs/communication/2026-05-16-claude-codex-v2-1-log.md`
- Phase 8（v2.1 直接上游）：`docs/superpowers/plans/08-phase-8-score-engine.md`
- 进度记录：`docs/superpowers/plans/PROGRESS.md`
- 数据库 schema：`cloudfunctions/DATABASE_SCHEMA.md`（v2.1 实施期间需更新 `_request_log` 集合）
