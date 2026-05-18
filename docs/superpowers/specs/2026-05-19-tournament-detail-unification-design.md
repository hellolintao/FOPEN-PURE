# 赛事详情入口统一与权限控制 — 设计文档

- 日期：2026-05-19
- 范围：赛事 Tab、赛事详情页、会员/管理员入口权限、赛事列表权限标签
- 状态：用户已确认，待写实施计划

## 1. 背景与目标

当前小程序存在两个赛事详情体验：

1. 「赛事」Tab 点击赛事进入 `pages/tournament-view/index`，偏只读展示。
2. 「管理」入口进入 `pages/tournament-detail/index`，支持编辑赛事、录入比分、删除赛事等管理能力。

用户期望「赛事」Tab 下也进入和管理中一致的赛事详情页，但页面需要按身份区分管理员、参赛会员、非参赛会员的权限。

目标：

- 「赛事」Tab 点击赛事后直接进入 `pages/tournament-detail/index`。
- `pages/tournament-detail/index` 成为主要赛事详情页，根据身份展示或限制操作。
- 旧 `pages/tournament-view/index` 暂时保留代码，但不再由赛事 Tab 使用。
- 赛事 Tab 列表增加简单权限标签，帮助用户提前理解自己进入详情后的可操作范围。

## 2. 范围

### 范围内

- `miniprogram/pages/match/index.js`：赛事 Tab 列表点击跳转目标。
- `miniprogram/pages/match/index.wxml` / `index.wxss`：列表权限标签展示。
- `miniprogram/pages/tournament-detail/index.js`：补齐参赛会员判断与录入成绩权限。
- `miniprogram/pages/tournament-detail/index.wxml` / `index.wxss`：底部按钮禁用态或点击提示。
- 对应单元测试。

### 范围外

- 不删除 `pages/tournament-view/index`。
- 不重做赛事详情视觉结构。
- 不调整 `tournament-score` 的录分业务规则。
- 不改变云函数权限模型。
- 不改变管理入口现有跳转路径。

## 3. 关键决策

| 决策 | 取值 |
| --- | --- |
| 赛事 Tab 点击目标 | `/pages/tournament-detail/index?id=<tournamentId>` |
| 旧详情页处理 | 保留代码，但赛事 Tab 不再进入 |
| 管理员权限 | 可编辑、可录入成绩、可删除 |
| 参赛会员权限 | 可查看详情、可进入录入成绩 |
| 非参赛会员权限 | 可查看详情；保留“录入成绩”按钮，点击 Toast：`仅参赛者可录入` |
| 赛事列表标签 | 管理员 `可编辑`；参赛会员 `可录分`；非参赛会员 `仅查看` |

## 4. 权限模型

`tournament-detail` 页面需要计算三个布尔值：

- `isAdmin`：沿用当前逻辑，`app.globalData.isAdmin` 或赛事创建者。
- `isParticipant`：当前登录会员的 `_id` 出现在该赛事报名记录的 `playerId` 或 `partnerId` 中。
- `canEnterScore`：`isAdmin || isParticipant`。

页面行为：

| 身份 | 编辑 | 删除 | 录入成绩 |
| --- | --- | --- | --- |
| 管理员 | 显示并可点 | 显示并可点 | 可点 |
| 参赛会员 | 不显示 | 不显示 | 可点 |
| 非参赛会员 | 不显示 | 不显示 | 显示，点击提示 `仅参赛者可录入` |

`onEnterScore()` 不再无条件跳转：

```js
if (!this.data.canEnterScore) {
  wx.showToast({ title: '仅参赛者可录入', icon: 'none' })
  return
}
wx.navigateTo({ url: `/pages/tournament-score/index?tournamentId=${this.data.tournamentId}` })
```

## 5. 数据流

### 5.1 赛事 Tab 列表

`match/index` 当前直接读 `tournaments` 集合。为展示权限标签，需要拿到当前会员身份和赛事报名关系。

数据流：

1. `onShow()` 同步 Tab 选中态。
2. 确保 `app.refreshIdentity()` 已完成，拿到 `currentMember` 和 `isAdmin`。
3. 读取赛事列表。
4. 若当前用户不是管理员且已登录会员，则读取当前会员相关报名记录，建立 `tournamentId -> true` 的参赛 Map。
5. 给每个赛事补充展示字段：
   - `__permissionLabel`
   - `__permissionKind`：`admin` / `participant` / `viewer`

列表标签规则：

- 管理员：`可编辑`
- 参赛会员：`可录分`
- 非参赛会员或未注册用户：`仅查看`

### 5.2 赛事详情页

`tournament-detail` 当前已经加载赛事、报名、对阵、自由拉球。实现时应复用已有 `loadRegistrations()` 结果来判断参赛身份，不新增重复请求。

`loadTournamentDetail()` 仍负责赛事与管理员判断；`loadRegistrations()` 负责报名列表并更新 `isParticipant` / `canEnterScore`。`refresh()` 完成后页面状态应一致。

## 6. 错误处理

- 身份刷新失败：按非管理员、非参赛用户处理，仍可查看赛事详情。
- 报名列表加载失败：保留详情展示，录入成绩按不可进入处理；控制台记录错误。
- 非参赛会员点击“录入成绩”：Toast `仅参赛者可录入`，不跳转。

## 7. 测试策略

新增或更新前端 Jest 测试：

1. `match` 页面点击赛事跳转到 `tournament-detail`。
2. `match` 页面管理员赛事标签为 `可编辑`。
3. `match` 页面参赛会员赛事标签为 `可录分`。
4. `match` 页面非参赛会员赛事标签为 `仅查看`。
5. `tournament-detail` 管理员 `canEnterScore === true`，编辑/删除仍可见。
6. `tournament-detail` 参赛会员可跳转录分页。
7. `tournament-detail` 非参赛会员点击录入成绩时 Toast `仅参赛者可录入`，不跳转。

全量验证继续使用：

```bash
cd miniprogram
npm test -- --runInBand
```

## 8. 实施顺序

1. 给 `match` 和 `tournament-detail` 补目标行为测试。
2. 修改 `match` 跳转目标和列表标签数据映射。
3. 修改 `tournament-detail` 的参赛判断和 `onEnterScore()` 权限分支。
4. 补 WXML/WXSS 中权限标签与录入按钮禁用/提示态。
5. 跑目标测试和全量测试。

