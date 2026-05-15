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

## 后续执行日志

暂无。
