# FOPEN 小程序 · 实施进度日志

> 每完成一个 Phase 都更新这个文件。新对话第一步必读。

## 总进度

```
[░░░░░░░░░░░░░░░░░░░░░░░░] 0/6 Phase 完成
```

## Phase 状态

| # | Phase | 状态 | 开始时间 | 完成时间 | commit hash | 关键备忘 |
|---|---|---|---|---|---|---|
| 01 | Phase 1 · Foundation | ⬜ 待开始 | — | — | — | — |
| 02 | Phase 3 · Create Tournament | ⬜ 待开始 | — | — | — | — |
| 03 | Phase 4 · Scheduler | ⬜ 待开始 | — | — | — | — |
| 04 | Phase 2 · Browse UI | ⬜ 待开始 | — | — | — | — |
| 05 | Phase 5 · Result Reconcile | ⬜ 待开始 | — | — | — | — |
| 06 | Phase 6 · Polish | ⬜ 待开始 | — | — | — | — |

**状态图例**：⬜ 待开始 / 🟦 进行中 / ✅ 已完成 / ⚠️ 阻塞

---

## 当前应该做什么

**👉 下一个 Phase**：`01-phase-1-foundation.md`

打开该文件，从 "Task 1" 开始按步骤执行。

---

## 执行日志（按时间倒序）

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
