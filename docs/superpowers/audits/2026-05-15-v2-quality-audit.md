# FOPEN 小程序 v2 全貌质量审计

日期：2026-05-15  
范围：`miniprogram/` 前端、`cloudfunctions/` 云函数、`docs/superpowers/plans/PROGRESS.md` 交接记录  
方法：Superpowers `brainstorming` 设计前诊断 + `impeccable` 设计上下文准则 + `audit/critique/optimize/polish` 检查口径；本报告只诊断与规划，不改实现。

## 结论

这个项目不能简单判定为“做完”。更准确的状态是：

- v1 功能闭环已经跑通：创建赛事、排程、录分、积分、排行榜、每周之星都有可用实现。
- v1 的体验质量还不稳定：核心流程能完成，但复杂度、视觉一致性、错误恢复、性能策略和旧代码残留都没有达到可长期运营的水准。
- 下一步不应该继续堆新功能，而应进入 v2 质量迭代：先统一体验和接口，再优化高频流程，最后做视觉和性能收敛。

## 证据快照

### 代码体量

- `miniprogram/pages` 页面文件总计约 9066 行。
- 最大页面/样式热点：
  - `miniprogram/pages/tournament-edit/index.js`：568 行
  - `miniprogram/pages/tournament-detail/index.wxss`：621 行
  - `miniprogram/pages/tournament-add-players-doubles/index.js`：434 行
  - `miniprogram/pages/tournament-add-players-doubles/index.wxss`：412 行
  - `miniprogram/pages/tournament-view/index.wxss`：367 行
  - `miniprogram/pages/tournament-manage/index.wxss`：333 行
- 云函数入口热点：
  - `cloudfunctions/match-results/index.js`：663 行
  - `cloudfunctions/tournament-brackets/index.js`：525 行
  - `cloudfunctions/tournament-registrations/index.js`：439 行
  - `cloudfunctions/tournaments/index.js`：403 行

### 验证基线

已通过：

- `cloudfunctions/tournament-brackets npm test`：44/44 passed
- `cloudfunctions/match-results npm test`：55/55 passed
- `cloudfunctions/points-engine npm test`：16/16 passed
- `node scripts/test-miniprogram-mock.js`：passed
- `bash scripts/sync-shared-libs.sh`：passed

未通过：

- `cloudfunctions/tournaments npm test` 失败，原因是当前本地 `node_modules/.bin/jest` 缺失。`package.json` 和 `package-lock.json` 声明了 Jest，但本地依赖安装状态不完整。这是环境/依赖一致性问题，不是业务测试失败。

### 自动检测

`npx impeccable --json --fast miniprogram/pages miniprogram/components` 返回 `[]`。由于该检测器主要面向 Web HTML/JSX，对微信小程序 WXML/WXSS 覆盖有限，不能代表视觉质量合格。

## 质量评分

| 维度 | 分数 | 判断 |
|---|---:|---|
| 功能完整性 | 3/5 | 主闭环存在，但流程不够稳，旧入口和新入口并存 |
| 性能 | 2/5 | 多页面串联云函数，列表/聚合缺缓存和统一请求层，部分批量操作串行 |
| 交互 | 2/5 | 可完成任务，但创建、排程、录分认知负担高，错误恢复弱 |
| 视觉 | 2/5 | 有青柠黑白方向，但大量旧灰色、蓝紫渐变、硬编码样式残留 |
| 工程稳定性 | 3/5 | 核心算法测试强，但前端缺自动化，云函数依赖/部署一致性不足 |
| 总体 | 12/25 | v1 可用，v2 必须质量收敛 |

## 关键问题

### P0：不能继续把“Phase 完成”当作产品完成

影响：现在 `PROGRESS.md` 显示 6/6 Phase 完成，但这只说明计划任务已执行，不说明产品体验达标。用户已经明确反馈功能、性能、交互和视觉都不满意，说明需要进入 v2 质量路线。

建议：新增 `docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design.md`，把 v2 目标定义为“可运营质量”，而不是新 Phase 堆叠。

### P1：管理员创建赛事流程复杂且脆弱

证据：

- `miniprogram/pages/tournament-edit/index.js` 同时处理表单、草稿、成员/球场加载、排程生成、报名同步、积分规则、添加球场、历史规则和 picker 协议。
- `commitStep3()` 连续调用 `saveInitialMatches`、`saveSchedule`、`bulkUpsertScheduledMatches`、`free-plays.bulkSet`，任何一步失败都会让用户处在半完成状态。
- WXML 的 4 步 wizard 信息量大，但缺少清晰的“当前进度质量”和“下一步会发生什么”的反馈。

影响：管理员创建比赛时很难建立信心，尤其是球员、球场、排程、积分规则之间有强依赖。一旦中途失败，用户不知道哪些数据已经保存，哪些要重来。

建议：

- 把创建流程重构成“草稿状态机”：基本信息、参与者、排程、发布前检查分别有明确保存状态。
- `commitStep3()` 后端合并为一个事务式 orchestration action，例如 `publishScheduleDraft`，前端只发一次请求，后端返回完整诊断。
- 在 UI 增加发布前 checklist：球员数量、球场时间、比赛数量、自由拉球、积分规则、可录分行。

### P1：录分流程功能强，但批量保存和状态文案不够可信

证据：

- `miniprogram/pages/tournament-score/index.js` 的 `onConfirmAll()` 对 drafts 串行循环调用 `match-results.submit` 或 `reconfirmMatch`。
- 管理员和普通会员共用 `bottomLabel`，会员端显示“确认全部”，实际含义是“提交给管理员确认”。
- 改分、确认、提交都依赖 toast 做反馈，没有明确的可恢复状态或失败明细。

影响：录分是比赛当天最敏感的流程。文案不精确会伤害信任；串行请求在多场比赛时慢且失败后很难定位哪一场失败。

建议：

- 新增批量 action：`match-results.batchSubmit` / `batchConfirm` / `batchReconfirm`，返回逐场结果。
- 会员端 CTA 改为“提交比分”，管理员端 CTA 改为“确认并计入积分”。
- 保存后显示轻量结果摘要：成功 N 场、失败 M 场、失败原因可展开。

### P1：视觉系统没有真正统一

证据：

- `miniprogram/styles/tokens.wxss` 定义青柠黑白，但许多页面仍硬编码灰色、蓝色、微信绿和旧紫蓝渐变。
- `miniprogram/pages/tournament-add-players-doubles/index.wxss` 仍有 `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`。
- `miniprogram/pages/tournament-manage/index.wxml` 使用左侧装饰条；`impeccable` 规则明确把宽侧条列为 AI/后台 UI 反模式。
- `miniprogram/pages/tournament-manage/index.wxss` 仍以 `#333/#999/#f5f5f5` 为主，和青柠运动感方向脱节。

影响：用户会感觉不是一个完整产品，而是不同阶段页面拼起来。视觉不满意的根因不是某个颜色，而是系统没有收口。

建议：

- v2 先做“视觉债清理”，不是继续加装饰。
- 移除旧紫蓝渐变、微信绿和散落灰色；保留青柠/墨黑/白底，但降低大面积卡片感。
- 将 `tournament-manage`、`my-match`、`tournament-edit`、`schedule-board`、`score-row` 作为第一批统一样式对象。

### P1：性能瓶颈主要在请求结构，不是动画

证据：

- 小程序前端仍大量直接 `wx.cloud.callFunction`，只有首页/排行榜/用户详情接入 `utils/cloud.callFunction`。
- `tournament-edit` 创建流程多处连续请求；`tournament-score` 批量保存逐场请求；`my-match` 混用云函数和直接数据库读取。
- `points-engine` 排行榜实时聚合，文档已注明 2500 条以内 OK，5000+ 建议增量索引。

影响：当前测试数据下能跑，但真实俱乐部连续赛事后，排行、我的比赛、录分批量确认都会变慢。请求散落也会让 loading/error 状态难以统一。

建议：

- 建立统一小程序 cloud client：请求 envelope 解包、错误码、loading、mock、埋点耗时。
- 高频页面引入页面级缓存：`members/current`、`rankList`、`weekly-star`、`tournament list`。
- 后端增加组合接口：`tournament-dashboard`、`my-match-summary`、`scoreboard-load`。

### P1：旧入口和兼容代码仍在放大复杂度

证据：

- `app.json` 仍注册 `tournament-add-player`、`tournament-add-players-doubles`、`round-settlement`、`tournament-view`、`tournament-brackets` 等旧/过渡入口。
- `cloudfunctions/tournaments/index.js`、`match-results/index.js` 保留大量 legacy action。
- `DATABASE_SCHEMA.md` 中也标注多个历史兼容字段。

影响：兼容不是坏事，但现在没有明确“哪些是线上必须保留、哪些是可下线”的清单。继续迭代会越来越难判断是否能删。

建议：

- 建立 Legacy Retirement 表：页面、云函数 action、字段、最后调用点、删除条件。
- 先把前端入口层统一，再开始删除未被新流程调用的旧页面。

### P2：信息架构和导航不够面向真实使用场景

证据：

- tabBar 有首页、赛事、管理、排名、我的，但“我的比赛”不是 tab，只能从首页快捷入口进入。
- `tournament-manage` 同时承载草稿、待确认比分、公开赛事列表和旧管理操作。
- `manage/index` 和 `tournament-manage/index` 存在职责重叠。

影响：管理员和会员的主路径混在一起。管理员比赛当天最需要的是“待确认比分”和“当前赛事”；会员最需要的是“可录分比赛”和“我的赛程”，但这些不是一级结构。

建议：

- 管理员视角：管理首页 = 今日待办、草稿、待确认、进行中赛事、创建入口。
- 会员视角：我的 = 可录分、已报名赛事、最近成绩、积分变化。
- 将“赛事列表”从运营工作台拆出来，只承担浏览和详情入口。

### P2：空状态、错误恢复和确认提示偏弱

证据：

- 多数页面仍用 `wx.showToast({ title: '加载失败' })`，没有恢复路径。
- 空状态文案多是“暂无数据”，缺少下一步操作。
- 创建流程错误会停在当前页面，但没有展示字段级问题或保存状态。

影响：真实用户遇到数据空、网络慢、云函数失败时会不知道该做什么。

建议：

- 定义标准状态组件：loading、empty、error、partial success。
- 关键错误要有动作：重试、回草稿、查看失败明细、联系管理员。

## 用户画像红旗

### 管理员

目标：5 分钟内创建赛事，并在比赛当天快速确认比分。

红旗：

- 创建步骤多，且第 3 步保存涉及多个后端动作，失败后不可见。
- 待确认比分在 `tournament-manage` 顶部出现，但没有按“今天/赛事/风险”排序。
- 修改已确认比分虽然有二次确认，但后续影响没有可视化解释。

### 普通会员

目标：看到自己要打什么、和谁打、快速提交比分、看到排名变化。

红旗：

- “我的比赛”不是一级 tab。
- 可录分比赛只显示 tournamentName 和 opponentLabel，缺少时间/球场/轮次优先级。
- 提交比分后的状态依赖 toast，缺少“管理员确认中”的稳定状态反馈。

### 观赛/围观会员

目标：打开小程序看排行榜、赛事进展、每周之星。

红旗：

- 首页、排行榜已有基础，但赛事进展和排名变化没有形成连续故事。
- 每周之星只是排行榜模块中的点状功能，没有与赛事结果联动成“俱乐部动态”。

## 推荐 v2 迭代路线

### 方案 A：先做“运营闭环可靠性”

内容：

- 统一 cloud client 和 envelope 解包。
- 创建赛事第 3 步合并为后端 orchestration action。
- 录分批量保存改为 batch action。
- 建立错误/部分成功 UI。

优点：最能降低真实比赛当天风险。  
缺点：视觉改善感知较慢。  
适合：你最担心功能和稳定性不满意。

### 方案 B：先做“核心体验重设计”

内容：

- 重做管理首页、我的比赛、创建赛事、录分页的信息架构。
- 管理员和会员分角色首页。
- 把“可录分、待确认、草稿、进行中赛事”变成明确任务队列。

优点：用户立刻感觉产品更清楚。  
缺点：需要同时动多页，必须有设计 spec 和计划控制范围。  
适合：你最不满意交互和产品逻辑。

### 方案 C：先做“视觉系统收口”

内容：

- 清理硬编码颜色和旧渐变。
- 统一赛事卡、队列、score-row、schedule-board、picker sheet。
- 建立小程序组件级样式约束和 token 迁移清单。

优点：视觉感知最快。  
缺点：如果功能流程不先收敛，后续仍会返工。  
适合：你最不满意“看起来不像一个成品”。

### 推荐：B → A → C 的组合路线

原因：

1. 先重定信息架构和角色路径，避免继续优化错误页面结构。
2. 再把关键请求和后端动作收敛，保证真实运营稳定。
3. 最后做视觉统一，避免给旧流程做昂贵皮肤。

第一轮建议只做一个 v2 plan：

**v2.1 · Role-Based Operations UX**

范围：

- 管理员工作台：草稿、待确认、进行中赛事、创建入口。
- 会员我的比赛：可录分、待确认、已报名赛事、最近成绩。
- 创建赛事发布前检查页。
- 录分页 CTA 文案与批量结果反馈。

不做：

- 不改积分算法。
- 不重写全部云函数。
- 不做通知推送。
- 不删 legacy actions，只标记和隔离。
- 不大改排行榜视觉，先保留为第二轮。

## 下一步

按照 Superpowers 流程，下一步应写正式设计 spec：

`docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design.md`

设计 spec 需要明确：

- v2.1 的用户角色和主路径。
- 页面信息架构。
- 数据加载与错误恢复策略。
- 哪些云函数新增组合接口，哪些旧接口保持不动。
- 测试和验收清单。

在 spec 通过前，不应直接改代码。
