# 排行榜头像隐私门禁设计

日期：2026-07-08

## 背景

排行榜之前为通过隐私合规审查，已经在排行榜页剥离头像：云端 `toRankingIdentity` 固定返回空头像，前端 `rank` 页面 `_sanitizeRankRow` 也会移除 `avatarUrl`，`rank-row` 组件只展示姓名、胜率、积分和趋势。

本次需求是在保持未登录/未注册用户看到无头像排行榜的前提下，让已经登录注册并完成统一隐私协议授权的访问者可以在排行榜看到头像。

## 已确认决策

- 头像可见门槛按当前访问者控制：当前访问者已登录注册，且当前会员资料里 `publicProfileConsent === true` 时，排行榜可显示头像。
- 未登录、未注册或未完成公开展示授权的访问者，排行榜继续保持现在的无头像版本。
- 仅修改排行榜相关展示边界，不扩大到其他页面，也不隐藏其他页面已有头像。
- 采用前后端双门禁：云端只为已公开授权的被展示会员返回头像；前端再按当前访问者授权状态决定是否渲染头像。

## 目标

1. 已登录注册且完成统一隐私协议/公开展示授权的访问者，在排行榜可看到允许公开展示的选手头像。
2. 未登录注册的访问者仍看到当前无头像排行榜。
3. 已登录但未同意公开展示授权的访问者仍看到无头像排行榜。
4. 页面缓存不能让未授权访问者看到缓存中的头像。
5. 变更范围限定在排行榜和共享排行榜身份函数，不影响球员详情、赛事报名、H2H 等页面的现有头像策略。

## 非目标

- 不新增登录弹窗或强制登录入口。
- 不改变昵称、积分、胜率、趋势、排名排序规则。
- 不改变微信官方隐私授权 API 的调用流程。
- 不新增云数据库集合或改变排行榜积分缓存结构。
- 不处理周星头像展示；周星继续由现有卡片文案展示，不在本次恢复头像。

## 行为规则

### 访问者门禁

排行榜页新增一个布尔状态：

```text
canViewRankAvatars = !!(currentMember && currentMember._id && currentMember.publicProfileConsent === true)
```

页面 `onShow` 从 `getApp().globalData.currentMember` 同步当前会员后刷新该状态。

### 行数据处理

`_sanitizeRankRow(row)` 保留现有格式化行为，并按访问者门禁处理头像：

- `canViewRankAvatars === true`：保留云端返回的 `avatarUrl`。
- `canViewRankAvatars !== true`：删除 `avatarUrl`。

从本地 `rank:` 页面缓存读取时也必须经过 `_sanitizeRankRow`，避免授权状态变化后复用旧缓存导致头像泄露。

### 云端身份处理

`cloudfunctions/_shared/public-profile.js` 中 `toRankingIdentity(member, options)` 调整为：

- `member.publicProfileConsent === true` 时返回 `member.avatarUrl`，没有头像则返回空字符串。
- 未公开授权时返回空头像。
- 保留 `publicProfileVisible` 字段，供前端或后续接口判断。

`points-engine.rankList` 和 `refreshRankMemberProfiles` 继续通过 `toRankingIdentity` 输出排行榜身份，缓存刷新和缓存回读都走同一套身份规则。

### 组件展示

`rank-row` 增加可选 `avatarUrl` 属性。模板中：

- 有 `avatarUrl` 时，在姓名前显示圆形头像。
- 没有 `avatarUrl` 时，保持当前纯文本布局和列宽，不显示默认头像。

这样未授权访问者看到的就是当前无头像版本，而不是默认头像版本。

## 测试策略

### 前端单元测试

- 未登录访问者加载排行榜时，即使云端或本地缓存有 `avatarUrl`，`rankList` 中也不保留头像。
- `currentMember.publicProfileConsent === true` 的访问者加载排行榜时，保留云端返回的头像。
- `currentMember.publicProfileConsent === false` 的访问者加载排行榜时，不保留头像。
- `rank` 页面 WXML 将 `avatar-url="{{item.avatarUrl}}"` 传给 `rank-row`。
- `rank-row` 组件声明 `avatarUrl` 属性，并且只在头像存在时渲染 `<image>`。

### 云函数单元测试

- `toRankingIdentity` 对公开授权会员保留头像。
- `toRankingIdentity` 对未公开授权会员隐藏头像。
- `points-engine.rankList` 的实时结果和缓存结果都遵循 `toRankingIdentity`，已公开授权选手有头像，未授权选手无头像。

### 回归验收

- 运行 `miniprogram/pages/rank/__tests__/index.test.js`。
- 运行 `miniprogram/components/rank-row/__tests__/index.test.js`。
- 运行 `cloudfunctions/_shared/__tests__/public-profile.test.js`。
- 运行 `cloudfunctions/points-engine/__tests__/index.test.js` 中排行榜相关测试。
- 最后用 WeChat DevTools 检查真实排行榜：未登录状态无头像，登录注册并同意公开展示后可见头像。

## 风险与控制

- 风险：排行榜本地缓存跨授权状态复用。控制：缓存读取和云端返回都在页面渲染前重新 `_sanitizeRankRow`。
- 风险：恢复头像时误影响其他页面。控制：只改排行榜页、`rank-row` 和共享排行榜身份函数，其他页面不动。
- 风险：已撤回公开展示授权的会员头像仍在旧缓存中。控制：云端缓存回读会刷新会员身份；前端访问者门禁也会剥离未授权访问者可见头像。
