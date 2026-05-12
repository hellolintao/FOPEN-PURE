# FOPEN 小程序 · 实施进度日志

> 每完成一个 Phase 都更新这个文件。新对话第一步必读。

## 总进度

```
[████████░░░░░░░░░░░░░░░░] 2/6 Phase 完成
```

## Phase 状态

| # | Phase | 状态 | 开始时间 | 完成时间 | commit hash | 关键备忘 |
|---|---|---|---|---|---|---|
| 01 | Phase 1 · Foundation | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 756682a | 迁移 members 80 / tournaments 2 / match_results 3 条；3 个云函数加 Jest（4×3=12 测试全绿） |
| 02 | Phase 3 · Create Tournament | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 9da74f2 | court-grid 组件 + tournament-edit 重写为 5 步表单；Codex 验证补齐了双打 partnerId/seed 与编辑模式 `_syncRegistrations` 同步 |
| 03 | Phase 4 · Scheduler | ⬜ 待开始 | — | — | — | — |
| 04 | Phase 2 · Browse UI | ⬜ 待开始 | — | — | — | — |
| 05 | Phase 5 · Result Reconcile | ⬜ 待开始 | — | — | — | — |
| 06 | Phase 6 · Polish | ⬜ 待开始 | — | — | — | — |

**状态图例**：⬜ 待开始 / 🟦 进行中 / ✅ 已完成 / ⚠️ 阻塞

---

## 当前应该做什么

**👉 下一个 Phase**：`03-phase-4-scheduler.md`

打开该文件，从 "Task 1" 开始按步骤执行。

---

## 执行日志（按时间倒序）

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
