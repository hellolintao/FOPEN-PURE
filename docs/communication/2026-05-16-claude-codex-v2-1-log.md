# Claude / Codex 沟通与执行日志

日期：2026-05-16

用途：记录 v2.1 设计、实现、review 过程中，Claude 与 Codex 的沟通结论、执行口径、待同步事项和后续验证结果。

## 维护规则

- 每次沟通追加一条，保留日期、参与方、主题和结论。
- 已被吸收到 spec / plan / schema 的事项，在“同步状态”里标记来源文档。
- 涉及 API、schema、组件契约的变更，必须写清“最终口径”，避免 Claude 与 Codex 各按不同理解实现。

## 2026-05-16 · §3 组件视觉与 API

参与方：用户、Codex，待同步 Claude。

主题：`status-tag`、`empty-state`、`batch-result-sheet`、`score-row` 的视觉与组件契约确认。

结论：

- `batch-result-sheet` 保持纯组件，parent 持有 `items/result` 并负责调用云函数；sheet 只展示状态并 emit `commit / retry / editrow / close`。
- `failures` 首版从 `{ matchId, code, message }` 扩展为 `{ matchId, code, message, retryable, requestId }`。
- `submitter / updatedAt` 不放进 failure 必填结构，优先从 `items` 或后端业务记录读取。
- `empty-state` 的 `action + bindaction` 应强制存在；既然规则是“空态必须有下一步”，API 不应把 action 设计成 optional。
- `status-tag` 需要固定语义表，尤其区分 admin 视角的 `warn-solid` 和会员视角的 `amber`。
- `score-row` 本轮只改视觉，不改内部状态机；折叠/展开、双打 2 行、stepper、reconfirm 二次确认逻辑保持不动。

待同步：

- 将 `empty-state` 的强制 action 规则落到 spec。
- 将 `status-tag` 语义表落到 spec。
- 实现时避免页面继续自建状态徽章类；赛事类型类标签不在本规则范围内。

## 2026-05-16 · §4 后端契约

参与方：用户、Codex，待同步 Claude。

主题：新增 envelope action、批量部分失败、幂等日志、工作台 snapshot 和 status-tag 最终语义。

结论：

- 批量接口同意采用 `success: true + data.failures[]` 表示“整批请求被接受，但部分单场失败”。
- `success: false` 仅用于整批级拒绝或无法执行，例如 `FORBIDDEN / INVALID_PAYLOAD / *_TIMEOUT`。
- `requestId` 当前描述存在冲突：既说“同 requestId 直接返回上次 result”，又说“失败子集重试可重新跑”。最终口径需二选一。
- 推荐最终口径：`requestId` 作为 batch group id；同组内成功项跳过，失败项允许重试并覆盖对应 matchId 的结果。若要严格幂等，可另加 `attemptId`。
- `_request_log` 是核心后端契约，应现在写入 `DATABASE_SCHEMA.md`，不建议等第二期补。
- `adminConsoleSnapshot` 不做部分成功可以接受；工作台入口页整体失败 + retry 比残缺展示更稳。`recentFinished` 可作为唯一可选块。
- 会员视角「确认中」使用 `status-tag type="amber"`；admin 视角「待确认」使用 `warn-solid`。红色只表达 admin 需要立刻处理。
- `batchSubmit` 的 `score` 结构需要统一为现有 Phase 8 结构：`{ sets: [{ a, b }], tiebreak }`，不要引入 `{ p1, p2 }` 第二套协议。

待同步：

- 在后端契约中明确 `requestId` 是 batch group id，或新增 `attemptId`。
- 在 `DATABASE_SCHEMA.md` 增加 `_request_log` 集合 schema。
- 在 `batchSubmit` input 中统一比分结构。
- 在错误码表中补充 `CANNOT_OVERWRITE_CONFIRMED`。

## 2026-05-16 · §5 数据流、错误恢复与状态机

参与方：用户、Codex，待同步 Claude。

主题：统一 cloud client wrapper、三页页面级状态机、batch-result-sheet sequence、并发边界、loading/empty/error 规则和回滚策略。

结论：

- `utils/cloud.callFunction` 采用永不抛异常的返回协议：`{ ok: true, data, requestId } | { ok: false, error }`。页面统一用 `if (res.ok) ... else ...`。
- wrapper 内的 `requestId` 只能作为前端 trace id；批量接口用于后端幂等/重试合并的 `requestId` 必须由 parent 在打开 sheet 时生成，并显式写入 `payload.requestId`。
- `classifyClientError(e)` 实现时先保存到局部变量，避免 catch 分支重复调用导致不一致。
- sheet 关闭后强制 refresh snapshot 是正确不变量；建议加 300ms 防抖，并合并 `onShow` 与 `sheet close` 的重复刷新请求。
- `STALE_VERSION` 在 batch sheet 中灰色不可重试，不允许 admin 在 batchConfirm 中强制覆盖。需要改已确认或已变更数据时，应重新拉最新数据后走 `reconfirmMatch`。
- `wx.showLoading / wx.showToast({ title: '加载失败' })` 禁用范围先限定在 v2.1 三页和 `batch-result-sheet` 内，不做全站禁用。
- `tournament-score` 出现空 matches 应按数据异常处理，展示 error 视图：`比赛数据异常` + `重新加载`，不要作为普通 empty 状态。

待同步：

- 在 spec 中明确 wrapper trace id 与 batch `payload.requestId` 的区别。
- 在三页刷新逻辑中加入防抖/合并请求策略。
- 在并发错误表中标明 `STALE_VERSION.retryable=false` 且不可强制覆盖。
- 将 loading/toast 禁用范围写成 v2.1 局部规则。

## 2026-05-16 · §6 测试与验收

参与方：用户、Codex，待同步 Claude。

主题：单元测试目标、E2E 手动验收、性能基线、视觉截图、开放问题和验收 gate。

结论：

- `my-match.summary` 建议选 B：并入 `match-results`，action 命名为 `mySummary`。同时将 `match-results/index.js` 拆成 `lib/handlers/{batch,submit,query}.js`，避免主文件继续膨胀。
- `_request_log` TTL 建议 30 天。7 天对事故复盘偏短，永久不删没有必要；30 天能覆盖比赛日和发布后排查窗口。
- `adminConsoleSnapshot` v2.1 不做 server cache。先依赖前端 300ms debounce 与 onShow/sheet close 合并刷新；如线上 QPS 过高，再补 30s server cache。
- `STALE_VERSION` 的 E2E 复现不要强依赖两个 admin session。DevTools 双 session 不稳定时，允许用 cloud 脚本或测试 fixture 直接 mutate `match_results` 的版本/状态，再让 admin A commit。

需要修正：

- §6 文档里 `6.3 / 6.4 / E2E-7~9` 有大量重复段落，需要清理，只保留一份。
- E2E-1 中“`tournament_points` 新增对应 entries”不总是成立。常规赛应验 `match_results.pointsAwarded.entries`；淘汰赛 placement 才验 `tournament_points`。
- E2E-3 不能假设“首次 timeout 未真正写库”。网络 timeout 时后端可能已经成功写库。正确验收是：retry 复用同一 `requestId` 后，后端返回/合并已有成功结果，不重复 confirm、不重复结算积分。
- E2E-7 可保留，但要明确它是唯一降级例外：`recentFinished` 是 optional 子块，允许单块降级；其他 snapshot 子查询失败仍整体 error。

补充测试场景：

- 重复点击 `commit/retry`：`submitting` 期间只能有一个云函数请求在飞。
- sheet destroy / close 时清理 `all-ok` 3s timer，避免重复 close 或 setData on detached component。
- retry 只重试 `retryable=true` 的失败项。
- 同一 `requestId` 下成功项不会重复 confirm，也不会重复写积分。
- `batchSubmit` 必须覆盖现有比分结构校验：`{ sets: [{ a, b }], tiebreak }`。

待同步：

- 让 Claude 先清理 §6 重复内容。
- 修正 E2E-1 的积分验收对象。
- 修正 E2E-3 的 timeout 语义。
- 将 6.5 开放问题落为最终选择：`mySummary` 并入 `match-results`、`_request_log` TTL 30 天、snapshot cache v2.1 不做。

## 2026-05-16 · Spec Review 决策补充

参与方：用户、Codex，待同步 Claude。

主题：review `docs/superpowers/specs/2026-05-15-fopen-v2-quality-iteration-design.md` 后，确认三个会影响 API 和数据流的最终口径。

Review 发现的 6 条问题：

1. `batchConfirm` 只有 `matchIds` 无法可靠产生 `STALE_VERSION`；必须带 `expectedVersion` 或等价版本字段。
2. `adminConsoleSnapshot.pendingConfirm` 只有统计与分组，不足以直接打开 `batch-result-sheet`；sheet 需要 match 级 review items。
3. `BATCH_TIMEOUT` 重试依赖 `requestId`，但当前 failure envelope 未明确允许 batch error 带 `requestId`。
4. `empty-state` 组件无法可靠检测父页面是否绑定了 `bindaction`，也不能内部兜底绑定父页面 `onRetry`。
5. `recentFinished` 默认 `includeFinished=false`，但 IA 又要求工作台有“已结束”块；默认拉取语义冲突。
6. `score-row` 改造里的 token 名称（`--ink-700 / --surface-1 / --brand-lime`）与现有项目 token（`--color-ink / --color-bg-2 / --color-lime`）不一致。

最终决策：

- `match-results.batchConfirm` input 从 `matchIds` 改为 `matches: [{ matchId, expectedVersion }]`。
- 工作台 hero / 分组列表只从 `adminConsoleSnapshot` 拿统计与分组；点击 CTA 后二次拉 sheet 明细。
- `recentFinished` 不放进默认 snapshot；用户展开“已结束”块时再拉。

需要改动 spec：

- `MatchReviewItem` 需要增加 `version` 或 `expectedVersion` 来源字段。推荐 item 上带 `version`，提交 batch 时 parent 转成 `{ matchId, expectedVersion: item.version }`。
- `batchConfirm` payload 改为：

```js
{
  action: 'batchConfirm',
  payload: {
    matches: [
      { matchId: 'mr_abc', expectedVersion: 3 }
    ],
    requestId: 'req_<uuid>'
  }
}
```

- 后端确认每场前必须校验 `current.version === expectedVersion`；不一致返回 per-match failure：`{ code: 'STALE_VERSION', retryable: false }`。
- 新 `batchConfirm` 若缺少 `expectedVersion`，返回整批 `INVALID_PAYLOAD`。旧 `confirmAll` 继续保留兼容。
- `adminConsoleSnapshot.pendingConfirm` 保持轻量：`total + byTournament`。不要把全部 review item 放进 snapshot。
- 新增或明确一个二次拉明细的接口/动作，例如 `match-results.pendingReviewItems` 或复用并扩展 `submittedQueue`。返回结构应满足 `batch-result-sheet.items`，并带 `version`。
- 工作台点击 hero CTA 或某个赛事分组行时：先拉 pending review items，再 open sheet；sheet 内显示短 loading 或 skeleton。
- `recentFinished` 改为独立 lazy load：默认工作台 snapshot 不查已结束；用户展开“已结束”块时调用单独接口或 `adminConsoleSnapshot({ includeFinished: true, finishedOnly: true })`。
- 取消 `recentFinished` 作为 snapshot 内“唯一允许降级子块”的描述；展开块自己有 inline loading / error / retry。
- batch 级 failure envelope 允许携带 `{ code, message, retryable, requestId }`，特别是 `BATCH_TIMEOUT` 必须返回原 batch group id，便于前端复用同一 requestId 重试。
- `empty-state` 改为只校验 `action` prop；点击时统一 `triggerEvent('action')`。父页面是否绑定 `bindaction` 由 lint / 手工 review / E2E 保证，组件不做无法实现的父级绑定检测。
- `score-row` token 改造需二选一：优先使用现有 token（`--color-ink / --color-muted / --color-bg-2 / --color-lime` 等）；如要新增 `--ink-700 / --surface-1 / --brand-lime`，必须把 token 定义纳入 v2.1 scope。

设计影响记录：

- `expectedVersion` 是 batch review 的安全线，避免 admin 确认自己没审过的新比分。
- sheet 明细二次拉会让 CTA 后多一个 loading，但能保持工作台首屏轻，并减少 stale 数据。
- `recentFinished` 展开时再拉能让 snapshot 只服务今日待办，数据流更简单，失败语义也更干净。

## 2026-05-16 · Spec Review 修订 v2（Claude 落地 Codex 6 项）

参与方：Claude，待同步 Codex 与用户。

主题：吸收 §Spec Review 决策补充 6 条问题，spec 已修订并 commit 待提。

修订摘要（spec 已落地）：

1. **batchConfirm 加乐观锁**：input 从 `matchIds: [...]` 改为 `matches: [{ matchId, expectedUpdateTime }]`。乐观锁键采用现有 `match_results.updateTime`（无 schema 迁移）。`MatchReviewItem` 加 `updateTime` 字段，parent commit 时映射为 `expectedUpdateTime`。重试时前端必须重新拉 review item 拿最新 `updateTime`，**禁止复用上次 expectedUpdateTime**。STALE_VERSION 失败行 sheet 内禁用重试，admin 必须 close + 重开 sheet。
2. **新增 `match-results.pendingReviewItems`**：sheet 二次拉 match-level items。Snapshot 只保留 hero+三块（统计与分组），不再预拉 review items。Sheet open 时先显示 skeleton，加载完才切换到 review cards。
3. **失败 envelope 允许带 requestId**：`{ success: false, error: { code, message, requestId? } }`；对 batch action（特别 BATCH_TIMEOUT）**必填**。
4. **empty-state 简化**：组件运行时只校验 `action` prop；`bindaction` 是否绑定不做组件兜底，由 lint / 手工 review / E2E-10 三层保证；点击统一 `triggerEvent('action')`。
5. **recentFinished lazy load**：从 snapshot 移除；新增 `tournaments.finishedRecent` 独立 action，用户展开"已结束"块时调；块内 inline loading / error / retry，与 snapshot 解耦。Snapshot 内无"单块降级"概念。
6. **score-row token 用现有定义**：硬编码 `#333/#999/#f5f5f5/#4F46E5` → `var(--color-ink) / --color-muted / --color-bg-2 / --color-lime`，v2.1 不引入新 token。

副作用更新：

- §4 子节重编号至 4.1–4.12，新增 4.6 / 4.7
- §4.11 错误码表加 `QUERY_TIMEOUT`，更新 `STALE_VERSION` 含义和 `INVALID_PAYLOAD` 触发条件
- §5.3 sequence 显式画出 pendingReviewItems 二次拉 + retry 前重拉 updateTime 步骤
- §5.5 loading/empty/error 矩阵新增"batch-result-sheet 二次拉"行 + 已结束块 lazy load 描述
- §6.1 单测加 `pendingReviewItems` / `finishedRecent` 两组用例
- §6.3 性能基线加两条新接口目标
- §6.6 补充测试场景加 expectedUpdateTime / pendingReviewItems / finishedRecent / _request_log TTL 行
- §7 P1 加 `pendingReviewItems`，P2 加 `finishedRecent`，P5 文档要求加 `match_results.updateTime` 乐观锁键说明
- §8 词汇表加 `expectedUpdateTime` / `review item / pendingReviewItems` / `lazy load 块`

待 Codex 验收：

- 乐观锁选 `expectedUpdateTime`（不引入 version 字段）这个口径是否接受？若坚持 `version: Number`，需把 schema 迁移与 state.js / submit / confirmAll / reconfirmMatch 写 +1 也纳入 v2.1 scope。
- `pendingReviewItems` 与 `submittedQueue` 是否要合并？当前选择是保留 `submittedQueue`（聚合统计）+ 新增 `pendingReviewItems`（明细），双轨。
- `tournaments.finishedRecent` 独立 action 是否接受？也可改为复用 `adminConsoleSnapshot({ includeFinished: true, finishedOnly: true })`，但当前 spec 已删除 snapshot 的 includeFinished 参数。

Spec 状态：已 commit（次次修订）；待 Codex 与用户 review 通过后 invoke writing-plans skill 生成 `docs/superpowers/plans/09-phase-9-v2.1-quality-iteration.md`。

## 2026-05-16 · Spec 二次 Review（Codex）

参与方：Codex，待同步 Claude。

主题：对 Claude 修订后的 spec 再过一遍，确认 3 个待定口径，并记录进入 writing-plans 前仍需修正的残留不一致。

已确认 OK：

- 乐观锁用 `match_results.updateTime` / API 字段 `expectedUpdateTime` 可以接受。优点是无 schema 迁移；后续若需要更强并发控制，再新增 `version` 字段。
- `submittedQueue` 保留 + 新增 `pendingReviewItems` 双轨可以接受。旧 action 保兼容；新 action 专门服务 sheet 二次拉 review items。
- `tournaments.finishedRecent` 独立 action 可以接受。它让 snapshot 只负责工作台首屏待办，已结束块 lazy load 自己处理 loading/error/retry。

仍需修正后再进入 writing-plans：

1. Scope 表需补新 action：
   - 当前“后端新增 action”仍只列 `adminConsoleSnapshot / batchConfirm / batchSubmit / mySummary`。
   - 需要补 `match-results.pendingReviewItems` 和 `tournaments.finishedRecent`，否则 plan 容易漏任务。

2. `BATCH_TIMEOUT` 说明仍写“payload 仍是原 matchIds 全集”：
   - 新 API 已改成 `matches: [{ matchId, expectedUpdateTime }]`。
   - 这里应改成“原 matches 全集”或“原 batch payload”，不能再写 `matchIds`。

3. timeout / network unknown retry 和 `expectedUpdateTime` 的“必须重拉”规则冲突：
   - spec 写“重试时必须重新拉 review item，绝不复用上次 expectedUpdateTime”。
   - 这对后端已返回 `result(partial)` 的 retryable 失败行是合理的：重新拉可让 admin 看到最新待确认数据。
   - 但对 `NETWORK` / `BATCH_TIMEOUT` 这类“客户端不知道后端是否已成功”的场景，重新拉可能拿不到已 confirmed 的行，反而丢失 `_request_log` 合并路径。
   - 建议最终规则拆开：
     - 对 `result(partial)` 中明确失败且仍 retryable 的 match：retry 前重新拉 `pendingReviewItems`，更新 card 和 `expectedUpdateTime`。
     - 对 `NETWORK` / `BATCH_TIMEOUT` / 整批未知结果：先用同一 `requestId` 重发“原 matches 全集”，后端通过 `_request_log` 跳过已 success 项；若某行未 success 且 updateTime 已变，再返回 `STALE_VERSION`。这样不盲覆盖，也不丢幂等合并。

4. E2E-2 备选 fixture 仍写 mutate `version`：
   - 已决定不引入 `version` 字段。
   - 应改为 mutate `match_results.<mr_b>.updateTime`，或通过 submit/reconfirm 改动该行，使 `expectedUpdateTime` 不匹配。

5. `empty-state` 单测描述仍写 `action+bindaction` 必填校验：
   - 新设计是运行时只校验 `action` prop；`bindaction` 由 lint / review / E2E 保证。
   - 单测应改为：缺 `action` 报 `console.error`；点击 CTA `triggerEvent('action')`；缺 subtitle/icon 能正常渲染。

6. `match-results` 文件拆分树的 `query.js` 注释需补 `pendingReviewItems`：
   - 当前仍只写 `submittedQueue / listByTournament / listByPlayer`。
   - 建议改为 `submittedQueue / listByTournament / listByPlayer / pendingReviewItems`。

## 2026-05-16 · Spec Review 三次修订（Claude 落地 Codex 6 项残留）

参与方：Claude，待同步 Codex 与用户。

落地（spec 已修订）：

1. §1.2 scope 表「后端新增 action」补 `pendingReviewItems` 与 `finishedRecent`，共 6 个新 action。
2. §4.12 `BATCH_TIMEOUT` 说明从「原 matchIds 全集」改为「原 matches 全集」；并扩展覆盖 `NETWORK` / `CLOUD_TIMEOUT` 整批未知结果场景。
3. **新增 §4.13 Retry 规则**：拆开 result(partial) per-row retryable 与 batch-level unknown-result 两条路径——
   - result(partial) 失败行：retry 前必须重拉 review item，payload 仅失败行，复用 requestId。
   - BATCH_TIMEOUT / NETWORK 整批未知：**不**预重拉，直接复用 requestId 重发原 matches 全集；后端 `_request_log` 合并 success + 剩余项 `expectedUpdateTime` 校验。
   - STALE_VERSION（任意路径）始终 retryable=false。
4. §5.3 sequence 末尾「关键不变量补充」改写为两路径并列描述。
5. §6.2 E2E-2 备选 fixture 从 mutate `version` 改为 mutate `updateTime`（或通过 submit/reconfirm 触发 updateTime 刷新）。
6. §6.1 `empty-state` 单测描述改为「缺 `action` 报 console.error + 点击触发 triggerEvent('action') + 缺 icon/subtitle 正常渲染 + 父未 bindaction 时事件丢弃不破 UI」。
7. §4.9 文件拆分树 `query.js` 注释加 `pendingReviewItems`。
8. §6.6 补充测试场景的「retry 必须重拉」改写为按路径区分。

预期影响：

- 后端 `batchConfirm` 的 retry 处理逻辑必须先读 `_request_log` 合并 success 项，再对剩余项做 `expectedUpdateTime` 校验；客户端无需在 BATCH_TIMEOUT/NETWORK 路径上先重拉。
- 单测必须分别覆盖两条 retry 路径，避免实现时只做"全部重拉"而漏掉幂等合并路径。
- E2E-3（网络失败重试）现在的验收文案隐含按 §4.13 第二条路径走；plan 阶段需在 Task 设计里明确这是同 requestId + 原 matches 重发。

待 Codex 验收：

- §4.13 两路径区分是否准确表达了你提出的"分别处理"意图？
- §4.12 与 §4.13 是否还有遗漏（例如 result(partial) 内 NETWORK 错误的归属——当前归到 result(partial) per-row 路径，需重拉）？

Spec 状态：已修订（三次修订待 commit）。如 §4.13 OK，下一步 invoke writing-plans。

## 后续执行日志

暂无。
