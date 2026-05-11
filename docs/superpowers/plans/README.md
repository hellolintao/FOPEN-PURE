# FOPEN 小程序 · 实施计划入口

## 这是什么

整个项目的实施被切成 **6 个独立的 Phase**，每个 Phase 在**独立的对话**里执行，完成后 commit。这样做的目的：

1. 避免单个对话上下文过长
2. 每期完成都有明确的 git commit，能回滚
3. 跨对话仍保持上下文一致（靠 README + PROGRESS）

## 新对话开始时怎么做

**在新对话的第一句话告诉 Claude**：

> 我要继续 FOPEN 小程序的实施。请读 docs/superpowers/plans/README.md 和 PROGRESS.md，告诉我当前在哪个 Phase，下一步要做什么。

Claude 会：
1. 读 README（本文件）→ 了解整体节奏
2. 读 PROGRESS.md → 知道已完成的 Phase 与 commit hash
3. 找到当前要做的 Phase 的 plan 文件 → 按任务清单执行

## 工作流约定

| 步骤 | 谁做 | 做什么 |
|---|---|---|
| 1 | 用户 | 在新对话粘贴上面那句话 |
| 2 | Claude | 读 README + PROGRESS + 当前 Phase plan |
| 3 | Claude | 按 plan 任务逐个执行（每步先写测试、再实现、再跑通） |
| 4 | 用户 | 验证产出 |
| 5 | 用户 | 用户喊"提交"后 Claude 才 git commit |
| 6 | Claude | 更新 PROGRESS.md 记录 commit hash + 完成时间 |
| 7 | 用户 | 关闭对话；准备好开下一个 Phase 时回到步骤 1 |

**绝不允许**：
- 跳过测试直接写实现
- 一次性把多个 Phase 塞进同一对话
- 没有用户确认就 commit

## 6 个 Phase 索引

按**执行顺序**列（不是 spec 期号顺序）：

| # | 文件 | 主题 | 解锁能力 | 预计时间 |
|---|---|---|---|---|
| 01 | [phase-1-foundation.md](./01-phase-1-foundation.md) | 数据模型迁移 + 设计系统 tokens | 后续基础 | 2-3 小时 |
| 02 | [phase-3-create-tournament.md](./02-phase-3-create-tournament.md) | 创建赛事改造（含 20min 时间格子 UI） | 管理员能开新赛事 | 4-6 小时 |
| 03 | [phase-4-scheduler.md](./03-phase-4-scheduler.md) | 自动排程引擎 + 签表/对局表 | 比赛能跑起来 | 4-6 小时 |
| 04 | [phase-2-browse-ui.md](./04-phase-2-browse-ui.md) | 首页 + 排行榜 + 玩家详情 | 用户有美观的浏览体验 | 6-8 小时 |
| 05 | [phase-5-result-reconcile.md](./05-phase-5-result-reconcile.md) | 录分对账 + 仲裁 + 积分计算 | 闭环 | 4-6 小时 |
| 06 | [phase-6-polish.md](./06-phase-6-polish.md) | 每周之星 + 视觉打磨 + 微交互 | 上线水准 | 3-5 小时 |

## 设计 spec 在哪

完整设计规范在 [../specs/2026-05-11-tennis-club-miniprogram-design.md](../specs/2026-05-11-tennis-club-miniprogram-design.md)。每个 Phase plan 顶部都引用了 spec 中对应章节，需要时回查。

## 全局技术约束

- **微信小程序原生**（WXML/WXSS/JS，**非 React/Vue/Taro**）
- **微信云开发**（Node.js 云函数 + NoSQL 数据库）
- **TDD**：每个云函数任务必须先写 Jest 测试再实现
- **覆盖率**：80% 起步，核心算法（scheduler/reconcile/points）≥ 90%
- **不引入 node_modules 到 miniprogram/**（`project.config.json` 已禁用）

## 当前状态

实时进度看 [PROGRESS.md](./PROGRESS.md)。
