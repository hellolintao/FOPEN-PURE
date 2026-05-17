# 资料注册与编辑流程改造 — 设计文档

- 日期：2026-05-17
- 范围：小程序「我的」入口注册流程、edit-profile 页面、members 云函数与校验
- 状态：已批准，待写实施计划

## 1. 背景与目标

当前流程存在三个问题：

1. 「我的」页点「登录/注册」直接以 `微信用户` + 默认头像把会员写入数据库，没有「获取微信信息 → 填写注册信息」的过程。
2. edit-profile 页面用 `wx.chooseMedia` 走相册/拍照，没有用微信小程序原生的「头像昵称填写能力」（`button open-type="chooseAvatar"` / `input type="nickname"`）。
3. 「打法」单选项过于细化（5 个偏专业网球术语），且存在「打法备注」长文本字段，与产品方向不符。

目标：

- 新用户首次点击「登录/注册」时进入 edit-profile 页面以「注册」模式完成姓名、打法、可选头像/手机号的录入。
- 头像与昵称改为调用微信小程序原生组件，遵循微信官方推荐做法。
- 「打法」选项替换为 6 个新的风格选项；移除「打法备注」字段。
- 项目尚未上线，无历史数据迁移负担。

## 2. 范围

### 范围内

- `miniprogram/pages/mine/index.js` 登录入口逻辑
- `miniprogram/pages/edit-profile/index.{js,wxml,wxss,json}` 全面改造
- `cloudfunctions/members/lib/validate.js` 校验规则
- `cloudfunctions/members/index.js` `add` / `update` 字段处理
- 对应单元/集成测试

### 范围外

- 已注册用户的数据迁移（无线上数据）
- 微信手机号一键授权（`open-type="getPhoneNumber"`，本期不做，手机号继续手动选填）
- 「我的」页除登录入口外的视觉/功能调整
- 默认头像图片资源更换（沿用现有 `/images/icons/usercenter.png`；用户后续提供新图后单独 PR 替换）

## 3. 关键决策

| 决策 | 取值 | 备注 |
| --- | --- | --- |
| 注册入口方案 | 复用 `edit-profile` + `mode=register` query | 不新建独立页面 |
| 必填字段（注册模式） | 姓名、打法 | 头像可走默认头像 |
| 必填字段（编辑模式） | 姓名 | 与现状保持一致 |
| 手机号 | 始终选填 | 不接微信一键获取 |
| 打法备注字段 | 整字段删除（前端 + 后端 + 校验） | 无历史数据 |
| 头像组件 | `<button open-type="chooseAvatar" bindchooseavatar>` | 替换 `wx.chooseMedia` |
| 昵称组件 | `<input type="nickname" />` | 触发微信昵称键盘条 |
| 上传通道 | 仍走 `wx.cloud.uploadFile`，路径 `avatar/${ts}.jpg` | 不变 |

## 4. 打法选项

固定 6 项，前端 label 中文，后端值为英文 slug：

| Slug | 中文标签 |
| --- | --- |
| `ice-cow` | 冰上母牛 |
| `vers` | Vers |
| `iron-lady` | 女金刚 |
| `moon-queen` | 月亮女王 |
| `grinder` | 磨女 |
| `slicer` | 削削乐 |

旧值（`baseliner` / `serve-volleyer` / `all-court` / `counter-puncher` / `aggressive-baseliner`）从代码与校验中移除，无需迁移。

## 5. 架构与数据流

### 5.1 入口流程（mine.onLogin）

```
点击 "登录/注册"
  └─ wx.cloud.callFunction members.get
        ├─ 返回 data.length > 0
        │     → 写入 globalData，刷新 mine 显示，Toast "登录成功"
        └─ 返回 data.length === 0
              → wx.navigateTo /pages/edit-profile/index?mode=register
                （不再调用 members.add 用默认值占位）
```

`mine.checkLogin()` 保持不变；仅 `onLogin()` 的「未注册」分支改为跳转。

### 5.2 edit-profile 模式

`onLoad(query)` 读取 `query.mode`：

- `mode === 'register'`
  - 页面标题：`注册`
  - 头像：直接显示默认头像，允许通过原生按钮更换
  - 表单：留空，不调用 `members.get`（避免无意义请求）
  - 主按钮：`完成注册`
  - 取消按钮：隐藏（系统手势返回回到 mine 页，无副作用）
  - 校验：姓名 + 打法必填，手机号格式校验仅在填写时生效
  - 保存：`callFunction members add`；成功后 `wx.reLaunch` 到 `/pages/mine/index`
- 默认（`edit`）
  - 标题：`编辑资料`
  - 行为：与当前一致，但去掉打法备注；保存调 `members update`

### 5.3 头像选择（原生）

```
<button open-type="chooseAvatar" bindchooseavatar="onChooseAvatar">…</button>

onChooseAvatar(e) {
  const tempPath = e.detail.avatarUrl
  this.uploadAvatar(tempPath)   // 沿用现有 wx.cloud.uploadFile 实现
}
```

不再使用 `wx.chooseMedia`。

### 5.4 昵称输入（原生）

```
<input type="nickname" placeholder="请输入姓名"
       value="{{formData.name}}" bindinput="onNameInput" />
```

仅类型从默认改为 `nickname`，事件处理保持不变。微信会在输入框聚焦时在键盘上方显示「使用微信昵称」推荐条。

### 5.5 后端

`cloudfunctions/members/lib/validate.js`：

```js
const VALID_PLAY_STYLES = ['ice-cow', 'vers', 'iron-lady', 'moon-queen', 'grinder', 'slicer']
// 删除 MAX_NOTE_LENGTH 与 playStyleNote 校验
```

`cloudfunctions/members/index.js`：

- `add` / `update` payload 中删除 `playStyleNote` 写入
- `add` 内已有的 `openid` 重复兜底保持不变（同一 openid 多次注册返回已存在记录）

## 6. 错误处理

| 场景 | 处理 |
| --- | --- |
| 注册模式保存失败 | `wx.hideLoading` + `wx.showToast({ title, icon:'none' })`；保留输入；不跳转 |
| `members.get` 网络失败 | 维持当前 `try/catch` 与 Toast；登录态置为未登录 |
| 头像上传失败 | 沿用现有 Toast；表单保留旧头像值 |
| 校验失败（缺姓名/打法） | 前端 Toast，定位错误字段；不发请求 |

## 7. 测试策略

### 7.1 单元测试

- `cloudfunctions/members/lib/__tests__/validate.test.js`（若不存在则新建）
  - 新 6 个 slug 通过校验
  - 旧 slug 被拒绝
  - 任意 `playStyleNote` 输入不再触发长度错误（字段被忽略）

### 7.2 集成测试

- `cloudfunctions/members/__tests__/index.test.js`
  - `add` 在不传 `playStyleNote` 时成功
  - `add` 在 `playStyle` 为新 slug 时成功
  - `update` 不写入 `playStyleNote`

### 7.3 手工 E2E（基于现有 e2e 脚手架）

1. 清空当前 openid 的会员 → 进入「我的」点「登录/注册」 → 跳到注册页 → 选头像、填昵称、选打法 → 点「完成注册」 → 回到「我的」看到头像与姓名。
2. 已注册用户进入「我的」 → 点「编辑资料」 → 修改姓名/打法 → 保存 → 「我的」与下次进入数据一致。
3. 取消注册（关闭/返回小程序）→ 重新进入应仍触发注册流程（数据库无脏数据）。

## 8. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `button open-type="chooseAvatar"` 仅在基础库 2.21.2+ 可用 | `project.config.json` 检查 `libVersion`；若过低，开发文档增加最低版本说明 |
| 注册中途关闭后用户残留状态 | 因不预创建空 member，无脏数据；下次进入会重新触发注册 |
| 默认头像图片后续替换 | 设计为一个常量，集中替换 |
| 旧 slug 与现存导入数据冲突 | 项目未上线、无脏数据 |

## 9. 验收清单

- [ ] 「我的」未登录态点击登录跳转到注册页，未在数据库创建占位记录
- [ ] 注册页主按钮文案为「完成注册」，姓名/打法缺失时拒绝提交
- [ ] 头像按钮点击触发微信原生选择，昵称输入触发「使用微信昵称」键盘条
- [ ] 完成注册后「我的」立即显示新头像、姓名、积分位
- [ ] 编辑资料页不再出现「打法备注」字段
- [ ] 打法 6 个新选项展示与保存正常；旧 slug 不再接受
- [ ] 单元 / 集成测试通过；覆盖率不下降

## 10. 实施期待细化项

- 默认头像常量定义位置（`config.js` 还是 edit-profile 内 const）— 推荐 `config.js` 暴露 `DEFAULT_AVATAR_URL`，便于日后替换图片
- `mine.onLogin` 错误 Toast 文案在实施时按现有 i18n 风格统一
