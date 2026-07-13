# 小组淘汰赛详情状态一致性设计

## 目标

修复赛事详情页对异常或旧版小组淘汰赛数据的阶段解释，使标题状态、可见模块和底部操作保持一致，同时保留已取消赛事的历史签表与赛果。

## 有效阶段规则

详情页按以下优先级计算小组淘汰赛的有效阶段：

1. 原始赛事状态为 `draft` 时，强制使用 `group_draft`，不得因残留的已发布阶段开放录分操作。
2. 其他状态存在合法 `groupKnockoutPhase` 时，继续使用该阶段。
3. 缺少 `groupKnockoutPhase` 且原始状态为 `completed` 或 `settled` 时，回退为 `completed`，展示已确认赛果。
4. 其他缺失阶段的记录继续回退为 `group_draft`。

`cancelled` 不覆盖已保存的阶段：已取消赛事若已有 `completed` 阶段，仍可查看历史签表和赛果，但标题继续显示“已取消”。

## 实现范围

- 仅调整 `miniprogram/pages/tournament-detail/index.js` 的小组淘汰赛详情阶段解析。
- 复用现有 `isCompletedStatus`，不新增通用抽象。
- 不修改模块顺序、状态标题工具、云函数、数据库记录或迁移脚本。
- 不改变正常的 `group_draft`、`group_published`、`group_completed`、`knockout_published`、`completed` 流程。

## 测试与审核

先增加失败回归，覆盖：

- 旧版已结算记录缺少 `groupKnockoutPhase`；
- 草稿记录残留 `group_published`；
- 已取消记录保存 `completed` 阶段时仍保留历史结果入口。

完成最小修复后，运行赛事详情定向测试和小程序全量 Jest。最后重新执行状态矩阵与独立对抗式代码审阅，确认没有影响模块顺序、正常阶段或已取消赛事的历史查看能力。
