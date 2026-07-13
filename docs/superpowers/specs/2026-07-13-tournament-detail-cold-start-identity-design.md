# 赛事详情冷启动身份恢复设计

## 背景

参赛者从微信分享卡冷启动进入 `pages/tournament-detail` 时，`App.onLaunch()` 只初始化云能力，赛事详情随后立即并行加载数据。此时 `globalData.currentMember` 仍为空，页面把实际参赛者误判为游客，已发布赛程底部只显示“分享”。同一时间，线上 `tournament-brackets` 与 `tournament-registrations` 仍可能运行旧的公共身份转换代码，导致赛程出现“选手02”等匿名名称。

## 目标

1. 冷启动时自动恢复当前微信账号绑定的会员身份。
2. 赛事详情必须等待该身份恢复结束，再判断管理员、创建者和参赛者权限。
3. 参赛者从分享链接进入已发布赛程时，底部显示“分享”和“录入成绩”。
4. 管理员仍显示“分享、编辑赛程、录入成绩”；没有会员记录的真实游客仍只显示“分享”。
5. 兼容历史会员字段 `openId` 与 `isAdmin`。
6. 部署当前版本的 `tournament-brackets`、`tournament-registrations`，并上传只包含本次前端修复的小程序包。

## 设计

### 启动身份单例

`App.onLaunch()` 在 `wx.cloud.init()` 后设置：

```js
this.identityReady = this.refreshIdentity()
```

该 Promise 是一次冷启动内唯一的身份恢复请求。页面优先等待已有 `identityReady`，不得重复调用 `members.get`。

### 赛事详情加载顺序

`tournament-detail.refresh()` 先调用 `ensureIdentity()`。`ensureIdentity()` 的顺序为：

1. 若 `globalData.currentMember` 已存在，立即返回。
2. 若 `app.identityReady` 是 Promise，等待它。
3. 否则调用 `app.refreshIdentity()`，并把 Promise 写回 `app.identityReady` 后等待。
4. 身份请求失败或没有会员记录时，继续以游客身份加载公开赛事，不阻断页面。

随后才并行加载赛事、报名、签表、自由拉球和赛果，从而保证 `loadRegistrations()` 能用恢复后的会员 ID 判断 `isParticipant`。

### 历史字段兼容

- `app.refreshIdentity()` 用 `member.admin === true || member.isAdmin === true` 设置 `globalData.isAdmin`。
- `members` 云函数的 `action=get` 同时匹配 `openid` 和 `openId`，与其他云函数的鉴权方式一致。

### 云端身份显示

不扩大公共数据字段。部署当前 `_shared/public-profile.js` 契约：赛事报名和赛程对已有会员记录保留昵称；排行榜头像仍按单独规则限制。若部署后仍出现“选手NN”，再按赛程 ID 检查对应 `playerId` 是否缺少会员记录，本次不擅自保留已删除账号的历史昵称。

## 失败处理

- `members.get` 失败：`refreshIdentity()` 清空身份并返回 `null`；赛事详情继续公开加载，只显示游客权限。
- 会员不存在：保持游客体验，不弹错误提示。
- 赛程相关云函数部署失败：停止小程序上传并报告具体失败，避免前后端契约继续不一致。

## 对抗式验收矩阵

1. 冷启动参赛者：只调用一次身份恢复，出现“录入成绩”。
2. 冷启动管理员：出现“编辑赛程、录入成绩”。
3. 冷启动普通会员但未参赛：仍只有“分享”。
4. 冷启动无会员访客：身份请求返回空，页面正常公开浏览且只有“分享”。
5. 身份请求失败：页面不崩溃、不错误授予权限。
6. 历史 `openId` 会员：可以恢复身份。
7. 历史 `isAdmin` 管理员：可以恢复管理员权限。
8. 同时触发 `onLoad/onShow`：复用同一个 `identityReady`，不重复获取身份。
9. 云端非管理员赛事身份：已有会员昵称不是“选手NN”；缺失会员仍匿名，避免账号删除后的历史姓名泄露。

## 部署边界

- 云函数：`tournament-brackets`、`tournament-registrations`；部署脚本自动打包当前 `_shared`。
- 小程序：版本 `2.3.4`，从隔离 worktree 上传，排除主工作区未提交内容。
- 不部署当前主工作区中未提交的 `members` 内容安全改动；`members` 的 `openId` 兼容修复随本次代码保留，但不作为匿名赛程修复的线上部署依赖。
