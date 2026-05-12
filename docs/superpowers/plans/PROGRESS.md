# FOPEN 小程序 · 实施进度日志

> 每完成一个 Phase 都更新这个文件。新对话第一步必读。

## 总进度

```
[████░░░░░░░░░░░░░░░░░░░░] 1/6 Phase 完成
```

## Phase 状态

| # | Phase | 状态 | 开始时间 | 完成时间 | commit hash | 关键备忘 |
|---|---|---|---|---|---|---|
| 01 | Phase 1 · Foundation | ✅ 已完成 | 2026-05-12 | 2026-05-12 | 756682a | 迁移 members 80 / tournaments 2 / match_results 3 条；3 个云函数加 Jest（4×3=12 测试全绿） |
| 02 | Phase 3 · Create Tournament | ⬜ 待开始 | — | — | — | — |
| 03 | Phase 4 · Scheduler | ⬜ 待开始 | — | — | — | — |
| 04 | Phase 2 · Browse UI | ⬜ 待开始 | — | — | — | — |
| 05 | Phase 5 · Result Reconcile | ⬜ 待开始 | — | — | — | — |
| 06 | Phase 6 · Polish | ⬜ 待开始 | — | — | — | — |

**状态图例**：⬜ 待开始 / 🟦 进行中 / ✅ 已完成 / ⚠️ 阻塞

---

## 当前应该做什么

**👉 下一个 Phase**：`02-phase-3-create-tournament.md`

打开该文件，从 "Task 1" 开始按步骤执行。

---

## 执行日志（按时间倒序）

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
