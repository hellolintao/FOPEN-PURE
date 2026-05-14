# scheduler-engine (@deprecated since Phase 7)

算法已经迁到 `cloudfunctions/tournament-brackets/lib/`：

- `generator.js` — BYE 自动推进 + 推进公式（Phase 7 新加，原 scheduler-engine 无此能力）
- `scheduler.js` — 顺序填满场地（替代原来的 greedy 贪心排程）
- `pairing/round-robin.js` — 常规赛配对
- `pairing/knockout-bracket.js` — 单败签表

本目录的 44 例单测保留为回归基准，Phase 8 完成后再整体下线（含云端云函数）。新页面与新创建流程一律调用 `tournament-brackets` 的 `saveInitialMatches / saveSchedule / regenerateDraft`，不再触发 `scheduler-engine.schedule`。
