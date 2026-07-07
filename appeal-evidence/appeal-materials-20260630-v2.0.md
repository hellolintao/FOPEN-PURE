# 2026-06-30 v2.0 申诉配图材料

## 建议上传顺序

1. `20260630-v2-devtools-00-official-privacy-authorize.png`：微信官方统一用户隐私保护提示，由 `wx.requirePrivacyAuthorize` 触发，不再使用自定义隐私弹窗。
2. `20260630-v2-devtools-00-setting-privacy-account.png`：设置页已提供隐私政策、用户协议、撤回公开展示授权、删除账号资料入口。
3. `20260630-v2-devtools-01-revoke-public-profile-modal.png`：撤回公开展示授权确认弹窗，明确撤回后排行榜、球员详情和赛事页匿名展示。
4. `20260630-v2-devtools-02-delete-account-modal.png`：删除账号资料确认弹窗，证明用户可自助删除当前账号会员资料。
5. `20260630-v2-devtools-04-privacy-policy-user-rights.png`：隐私政策已同步声明 OpenID 不公开展示，并说明撤回公开展示和删除账号资料权利。
6. `20260630-v2-devtools-03-rank-public-display.png`：排行榜公开页仅展示头像、昵称、胜率、积分和趋势，不展示手机号、OpenID 或联系方式。
7. `20260630-v2-devtools-05-tournament-detail-roster-public-display.png`：赛事详情参赛人员区域仅展示赛事必要信息和公开身份。

## 搭配文字

已完成 v2.0 二次隐私整改：注册保存和头像上传前已调用 `wx.requirePrivacyAuthorize`，触发微信官方统一用户隐私保护提示，不再使用自定义隐私授权弹窗；公开/非管理员接口均改为后端脱敏输出，赛事报名、签表、成绩、我的比赛等页面只返回公开身份和必要赛事实绩；设置页新增撤回公开展示授权和删除账号资料能力；隐私政策同步声明 OpenID 不公开展示及用户自助权利。v2.0 小程序已上传，`members`、`tournament-registrations`、`tournament-brackets`、`match-results` 云函数已部署。

## 关联文件

- `appeal-text-20260630-v2.0-data-minimization.txt`：详细整改说明。
- `appeal-text.txt`：200 字内当前申诉原因。
- `upload-record-20260630-v2.0.txt`：v2.0 上传和云函数部署记录。
- `20260630-v2-screenshot-manifest.json`：本批截图生成清单。
