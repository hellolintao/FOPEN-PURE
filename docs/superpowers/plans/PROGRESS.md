# FOPEN 小程序 · 实施进度日志

> 每完成一个 Phase 都更新这个文件。新对话第一步必读。

## 总进度

```
[████████████████░░░░░░░░] 4/6 Phase 完成
```

## Phase 状态

| # | Phase | 状态 | 开始时间 | 完成时间 | commit hash | 关键备忘 |
|---|---|---|---|---|---|---|
| 01 | Phase 1 · Foundation | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 756682a | 迁移 members 80 / tournaments 2 / match_results 3 条；3 个云函数加 Jest（4×3=12 测试全绿） |
| 02 | Phase 3 · Create Tournament | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 9da74f2 | court-grid 组件 + tournament-edit 重写为 5 步表单；Codex 验证补齐了双打 partnerId/seed 与编辑模式 `_syncRegistrations` 同步 |
| 03 | Phase 4 · Scheduler | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 9941d79 | scheduler-engine 上线（44 单测全绿，Lines 100%/Stmts 95%）；触发策略改为 C（签表页按钮）+ 保存合并 B + 双打 partnerId 入约束；plan 顶部记录 6 处修订 |
| 04 | Phase 2 · Browse UI | ✅ 已完成 | 2026-05-12 | 2026-05-12 | e95fcac | points-engine 云函数（7单测全绿）+ 组件库（stat-block/rank-row/brush-stroke-bg）+ custom tabBar（admin 可见管理 tab）+ home/rank/player-detail/mine 全面重写 |
| 05 | Phase 5 · Result Reconcile | ⬜ 待开始 | — | — | — | — |
| 06 | Phase 6 · Polish | ⬜ 待开始 | — | — | — | — |

**状态图例**：⬜ 待开始 / 🟦 进行中 / ✅ 已完成 / ⚠️ 阻塞

---

## 当前应该做什么

**👉 下一个 Phase**：`05-phase-5-result-reconcile.md`

打开该文件，从 "Task 1" 开始按步骤执行。

---

## 执行日志（按时间倒序）

### 2026-05-12 · Phase 2 完成
- 新建 `cloudfunctions/points-engine/` 云函数：
  - `lib/calculate.js` 积分计算（calculatePoints / isPointValid，7 单测全绿）
  - `index.js` action=rankList|playerStats|recalculateMatch，全部带 try/catch 错误处理
- 新建组件库：
  - `miniprogram/components/stat-block/` 数字统计展示
  - `miniprogram/components/rank-row/` 排名条目（头像 + 名字 + 积分 + 涨跌趋势）
  - `miniprogram/components/brush-stroke-bg/` SVG 装饰背景
- 新建 `miniprogram/custom-tab-bar/` 自定义 tabBar：管理员可见第 5 个"管理"tab；用 pagePath 作为选中键；图标用图片资源
- 更新 `miniprogram/app.js`：globalData 加 isAdmin / currentMember；refreshIdentity 在 cloud init 后调用
- 重写 `miniprogram/pages/home/`：hero 板块 + quick actions + 个人 stat 三格
- 重写 `miniprogram/pages/rank/`：单/双打 tab + #1 hero 卡 + rank-row 列表 + 空态
- 新建 `miniprogram/pages/player-detail/`：并行拉 members.getById + points-engine.playerStats，单/双打各 3 格 + 近期比赛列表
- 改造 `miniprogram/pages/mine/`：hero card + action 按钮，保留原有登录/积分逻辑
- `cloudfunctions/members/index.js` 新增 getById action（with _id null guard）

### 2026-05-12 · Phase 4 完成
- 新建 `cloudfunctions/scheduler-engine/` 云函数：
  - `lib/constraints.js` 约束（含 collectMatchPlayerIds / isPlayerFree / isMatchFreeOfConflicts / hasRestBetween / matchHasRestBetween），双打把 4 个 playerId 全部计入
  - `lib/greedy.js` 贪心排程，输出对齐 `tournament_brackets.matches[*]` schema（`player1/player2` 对象 + `courtId/scheduledStart/scheduledSlotId/status`）
  - `lib/pairing/round-robin.js` 常规赛配对（单/双打）
  - `lib/pairing/knockout-bracket.js` 单败签表（标准 seeding，1 vs N 在 R1 不同对、补 BYE、R2+ 用 TBD 占位）
  - `index.js` action=schedule|preview，落库走 `tournament-brackets:add/update`（不绕 validator），upsert 时保留旧 winner/score
  - 单测：44 例全绿；Lines 100% / Stmts 95.13% / Branches 81.6%
- 签表页 `tournament-brackets`：
  - 顶部加「自动排程」按钮（策略 C，不在创建赛事流程里触发）
  - 每场比赛卡片用 WXS 展示 `时段 · 场地`，未排程标红
  - 顶部 unscheduled 警告条 + 每条「手动指派」按钮（弹 actionsheet 选 `(slot, court)`）
  - 保存合并（策略 B）：手动改完保存时按 matchId/position 保留 courtId/scheduledStart/scheduledSlotId/winner/score
- 关键 plan 修订（落入 `03-phase-4-scheduler.md` 顶部「2026-05-12 执行决策」节）：
  - 触发 = C：签表页手动按钮（避免创建流程被排程失败拖累）
  - 保存 = B：merge 保留排程字段
  - 双打 partnerId 必须计入冲突 + 休息约束
  - 算法内部数据结构对齐 DB schema（不用扁平 playerIds）
  - 不再 `.catch(()=>{})` 静默吞错；落库改 upsert
  - 修正 Task 5 测试断言（原 plan 自己打自己脸）
- 已知遗留：
  - `cloudfunctions/scheduler-engine/node_modules/` 同 `tournaments/` 一样会随 npm install 入库；如需清理用 `git rm --cached -r`
  - 云函数尚未上传到云端（需 admin 在 WeChat DevTools 里上传或 `FOPEN_CLOUD_ENV=... bash uploadCloudFunction.sh scheduler-engine`）
  - `tournament-brackets:updateMatchStatus` 现有 action 用 `scheduledTime`，scheduler-engine 写的是 `scheduledStart`，未来要统一字段名（暂不影响功能）

### 2026-05-12 · Phase 3 完成
- 新建 `miniprogram/components/court-grid/`（208 行 js）：场地增删 / 时段大块编辑（自动切 20min 档）/ 格子矩阵点选 / 序列化与反序列化
- 重写 `miniprogram/pages/tournament-edit/` 为 5 步表单：基本信息 / 场地时段 / 积分规则 / 选手 / 确认提交
- 用户决策：放弃当前 config UI（maxPlayers / playersPerMatch / eliminationType），云函数默认值兜底；playersPerMatch 仍由 type 自动推导
- 偏离 plan 的修正：
  - `tournaments:update` 用 `id` 而非 `_id`（与现网云函数一致）
  - WXML 用预计算的 `selectedPlayerMap[id]` 替代 `.indexOf/.includes`（兼容旧基础库）
  - `tournament-registrations:listByTournament` 不存在，改用 `list` + `tournamentId` 过滤
- Codex 验证补全（commit `9da74f2`）：
  - 双打报名需 `partnerId/partnerName/teamName/seed`，未传则云函数 validation failed
  - 编辑模式改选手不持久化 → 新增 `_syncRegistrations`：先全删旧报名再批量 add，create / edit 同一路径
  - 新增双打配对预览 UI（按选择顺序两两成 `#N A/B`）
  - 切换 type 时重置选手；编辑模式 hydrate doubles partnerId
  - `_assertRegistrationResult` 显式抛出云函数的 errMsg，避免静默失败
- 顺带修复：`uploadCloudFunction.sh` 已修复（commit `b6936bf`），脚本会在 cli 出错时返回非 0；Phase 1 遗留的"需手动右键上传"问题解除
- 已知遗留：`cloudfunctions/tournaments/node_modules/` drift 在 commit `3dd507c` 里被一并提交（不影响功能）；`_syncRegistrations` 删-再-加不是事务，中途失败会留下部分报名，可重试修复

### 2026-05-12 · Phase 1 完成
- 全部 12 个 Task 完成，最终 commit `756682a`
- 数据库迁移：members 80 条、tournaments 2 条、match_results 3 条
- 3 个云函数（members / tournaments / match-results）接入 Jest，共 12 个测试全绿
- 设计 token / base / utilities 三个 wxss 上线，app.wxss 切换浅底主题
- 顺手清理：`project.private.config.json` 加入 .gitignore 并停止跟踪（commit `59f5d5e`）
- 已知遗留：`cloudfunctions/tournaments/node_modules/` 历史上被入库，本期未处理（npm install 会产生 diff 噪声）；建议下个 Phase 用 `git rm --cached -r` 清掉
- `uploadCloudFunction.sh` 文件已损坏（单行无 shebang、变量未定义、不接受函数名参数），云函数上传当前需要在微信开发者工具里手动右键上传

### 2026-05-12
- 文档一致性修复：根 README 改为项目入口；spec / DATABASE_SCHEMA / plans README 对齐字段命名与执行说明
- 明确 `match_results.status` 保留为比赛生命周期；结果确认状态统一使用 `resultStatus`
- 明确赛事结束态使用当前代码里的 `completed`，不再使用 `ended`
- 明确 `tournaments.format` 是现有字段：`regular` / `knockout`

### 2026-05-11
- 设计规范完成（superpowers:brainstorming 流程）
- 6 个 Phase plan 完成（superpowers:writing-plans 流程）
- 等待开始 Phase 1 执行

---

## 跨对话决策档案

> 实施过程中如果做出任何**偏离 spec** 的决定，记到这里，下个对话能看到。

- `match_results.status` 保留为比赛生命周期：`pending` / `ongoing` / `completed` / `cancelled`。
- 结果对账状态统一使用 `match_results.resultStatus`：`pending` / `confirmed` / `disputed`。
- 赛事状态统一使用当前代码中的 `upcoming` / `ongoing` / `completed`，不再使用 `ended`。
- `tournaments.format` 为现有字段，取值 `regular` / `knockout`，后续 points / scheduler 逻辑以它区分常规赛与淘汰赛。

---

## 阻塞 / 待办

> 实施中遇到的需要用户决策、但当时没法立即解决的事项。

（暂无）

---

## 关键命令速查

```bash
# 上传单个云函数（朋友写的脚本）
bash uploadCloudFunction.sh <函数名>

# 跑云函数本地测试
cd cloudfunctions/<函数名> && npm test

# 查看当前 git 状态
git status && git log --oneline -10
```
