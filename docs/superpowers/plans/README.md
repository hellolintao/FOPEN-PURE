# FOPEN 小程序 · 实施计划入口

## 这是什么

整个项目的实施按 Phase 推进。每个 Phase 完成后都要：

1. 跑测试 / 必要的 DevTools 验证
2. 由用户确认后再 commit
3. 回填 `PROGRESS.md` 的完成时间与 commit hash
4. 用 README + PROGRESS 作为跨对话交接入口

## 新对话开始时怎么做

**在新对话的第一句话告诉执行 agent**：

> 我要继续 FOPEN 小程序的实施。请读 docs/superpowers/plans/README.md 和 PROGRESS.md，告诉我当前在哪个 Phase，下一步要做什么。

执行 agent 会：

1. 读 README（本文件）→ 了解整体节奏
2. 读 PROGRESS.md → 知道已完成的 Phase、commit hash、遗留事项
3. 找到当前要做的 Phase plan 文件 → 按任务清单执行

## 工作流约定

| 步骤 | 谁做 | 做什么 |
|---|---|---|
| 1 | 用户 | 在新对话粘贴上面那句话 |
| 2 | 执行 agent | 读 README + PROGRESS + 当前 Phase plan |
| 3 | 执行 agent | 按 plan 任务逐个执行；云函数/核心算法优先测试验证 |
| 4 | 用户 / agent | 验证产出；涉及微信开发者工具时按 PROGRESS 记录的方式执行 |
| 5 | 用户 | 用户喊“提交”后执行 agent 才 git commit |
| 6 | 执行 agent | 更新 PROGRESS.md 记录 commit hash + 完成时间 |
| 7 | 用户 | 关闭对话；准备好开下一个 Phase 时回到步骤 1 |

**绝不允许**：

- 跳过关键测试直接写实现
- 一次性把多个 Phase 塞进同一对话，除非用户明确要求修订历史 Phase
- 没有用户确认就 commit

## Phase 索引

按**执行顺序**列（不是 spec 期号顺序）：

| # | 文件 | 主题 | 状态 | commit / 备注 |
|---|---|---|---|---|
| 01 | [phase-1-foundation.md](./01-phase-1-foundation.md) | 数据模型迁移 + 设计系统 tokens | ✅ 已完成 | 见 [PROGRESS.md](./PROGRESS.md) |
| 02 | [phase-3-create-tournament.md](./02-phase-3-create-tournament.md) | 创建赛事改造（含时间格子 UI） | ✅ 已完成 | 见 PROGRESS |
| 03 | [phase-4-scheduler.md](./03-phase-4-scheduler.md) | 自动排程引擎 + 签表/对局表 | ✅ 已完成 | 见 PROGRESS |
| 04 | [phase-2-browse-ui.md](./04-phase-2-browse-ui.md) | 首页 + 排行榜 + 玩家详情 | ✅ 已完成 | 见 PROGRESS |
| 05 | [phase-5-result-reconcile.md](./05-phase-5-result-reconcile.md) | 录分对账 + 仲裁 + 积分计算 | ⏸ 由 Phase 7+8 重做覆盖 | 不再作为主线继续 |
| 06 | [phase-6-polish.md](./06-phase-6-polish.md) | 每周之星 + 视觉打磨 + 微交互 | ⏸ 延后 | 等核心闭环稳定后再做 |
| 07 | [phase-7-create-schedule.md](./07-phase-7-create-schedule.md) | 创建赛事 + 排程重构 | ✅ 已完成 | `63ee6f5` + 2026-05-15 修订 |
| 08 | [phase-8-score-engine.md](./08-phase-8-score-engine.md) | 成绩链路 + 积分引擎 | ✅ 已完成 | `4df153f`；hash 回填 `f57c393` |

## 当前状态

截至 2026-05-15：

- 当前最新主线：Phase 8 已完成并通过 E2E。
- Phase 8 主提交：`4df153f feat(phase8): complete score engine e2e`
- Phase 8 hash 回填提交：`f57c393 docs(progress): backfill phase 8 commit hash`
- 已验证：`match-results 55/55`、`points-engine 16/16`、`scripts/sync-shared-libs.sh` 通过、DevTools 三条 E2E 通过。
- 云函数上传：`points-engine` 已通过 DevTools GUI；`match-results` 因 `lib/` 目录触发 DevTools CLI `EISDIR`，最终使用临时 deploy-only bundle + `--paths` 成功部署。

下一步以 [PROGRESS.md](./PROGRESS.md) 的最新“下一步”与遗留事项为准。

## 设计 spec 在哪

完整设计规范在 [../specs/2026-05-11-tennis-club-miniprogram-design.md](../specs/2026-05-11-tennis-club-miniprogram-design.md)。每个 Phase plan 顶部都引用了 spec 中对应章节，需要时回查。

## 全局技术约束

- **微信小程序原生**（WXML/WXSS/JS，**非 React/Vue/Taro**）
- **微信云开发**（Node.js 云函数 + NoSQL 数据库）
- **TDD**：云函数 / 核心算法任务必须保留 Jest 覆盖
- **覆盖率**：核心算法（scheduler / score-rule / award / points）优先 ≥ 90%
- **不引入 node_modules 到 miniprogram/**（`project.config.json` 已禁用）

## 执行注意

- Phase plan 里的代码片段是目标实现草案，执行时必须先对照当前仓库代码，再按现状调整。
- 数据字段以 spec 与 `cloudfunctions/DATABASE_SCHEMA.md` 的最新定义为准；如发生冲突，先修文档再写实现。
- `PROGRESS.md` 只记录已完成并通过验证的 Phase，不要因为文档修订而改成已完成。
