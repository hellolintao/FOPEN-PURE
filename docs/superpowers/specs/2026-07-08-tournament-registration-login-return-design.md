# 报名页游客登录回跳设计

- 日期：2026-07-08
- 范围：小程序赛事详情页报名按钮、资料注册页回跳
- 状态：已按用户确认执行

## 1. 背景

报名中的赛事详情页应把游客和会员视为同一个浏览入口：游客也能看到报名按钮。只有当游客主动点击报名按钮时，才进入登录/注册链路。登录或注册完成后返回赛事详情报名区，不自动提交报名。

## 2. 目标

- 游客打开报名中的赛事详情页时，不主动登录、不主动查询当前会员。
- 游客能看到“我要报名”按钮。
- 游客点击“我要报名”时先出现登录弹窗。
- 弹窗确认后才触发微信官方隐私授权和 `members.get` 身份恢复。
- 已注册会员完成登录后返回当前赛事详情报名区，不自动报名。
- 未注册用户进入注册流程，注册后返回当前赛事详情报名区，不自动报名。
- 已登录且资料完整的会员点击“我要报名”仍直接报名。

## 3. 非目标

- 不新增独立报名页。
- 不改变报名接口的后端权限校验。
- 不扩大到排行榜、球员详情、首页等公开浏览页。
- 不在登录/注册完成后自动调用 `selfRegister`。

## 4. 设计

### 4.1 赛事详情页

`tournament-detail` 继续按阶段生成 `registerSelf` 底部动作。按钮显隐不依赖登录态，只依赖赛事是否处于可报名阶段、赛制是否支持自助报名、名额是否可用、当前用户是否已报名。

`onRegisterSelf` 分三段：

1. 已登录且资料完整：保持现有行为，调用 `tournament-registrations.selfRegister`。
2. 未登录：弹出登录提示。用户取消则停留在详情页；用户确认后才执行隐私授权和 `app.refreshIdentity()`。
3. 登录后仍没有完整会员资料：进入 `edit-profile?mode=register&from=tournament-register&tournamentId=<id>`。

资料页通过现有事件通道通知详情页。详情页收到 `registrationIdentityReady` 后只设置 `entry=register` 并刷新页面，让 `scrollToRegistrationSectionIfNeeded` 回到报名区，不调用报名接口。

### 4.2 注册页

`edit-profile` 保持现有 `from=tournament-register` 回跳逻辑。保存成功后优先通过 opener event channel 返回上一页；没有 event channel 时 `redirectTo` 到赛事详情并带 `entry=register`。

## 5. 测试

- `tournament-detail`：游客点击报名先弹登录确认；取消不触发隐私授权、不跳注册页、不调用报名接口。
- `tournament-detail`：游客确认登录后，如果当前微信已绑定会员，只刷新并回到报名区，不自动报名。
- `tournament-detail`：游客确认登录后，如果未注册，进入注册页；注册回调只刷新并回到报名区，不自动报名。
- `tournament-detail`：已登录会员点击报名仍直接调用 `selfRegister`。
- `edit-profile`：保留注册成功后返回赛事详情报名区的事件通道/redirect fallback。

## 6. 验收

- 报名页游客和会员看到一致的报名入口。
- 游客只有点击报名按钮才被要求登录。
- 登录或注册完成后回到赛事详情报名区，用户需要再次点击“我要报名”才会真正报名。
