# Appeal Materials - Rank Avatar Removal 2026-07-03

## Appeal Text

- `appeal-text-20260703-rank-no-avatar.txt`
- `appeal-text.txt` has been refreshed to the same latest copy.

## New Screenshots

1. `20260703-devtools-rank-no-avatar.png` - 微信开发者工具裁剪截图，排行榜列表仅展示排名、选手展示名、胜率、积分和趋势，无真实头像、无默认头像。
2. `20260703-devtools-rank-no-avatar-window.png` - 微信开发者工具完整窗口截图，可见当前页面路径为 `pages/rank/index`。

## Remediation Scope

1. Frontend `pages/rank/index` strips `avatarUrl` from rank rows and weekly-star hero state before rendering or caching.
2. Frontend rank WXML no longer binds avatar fields into `<rank-row>`.
3. `components/rank-row` no longer defines or renders an avatar prop/image.
4. Backend ranking identity output returns `avatarUrl: ''` for `points-engine` and `weekly-star`, so ranking APIs and caches no longer provide real or default avatar paths.

## Reviewer-Facing Summary

本次补充整改不是将真实头像替换为默认头像，而是彻底取消排行榜头像展示位。当前排行榜公开列表只保留比赛服务所需的榜单字段，不展示用户头像图片，也不展示默认头像占位。

## Local Verification

- 微信开发者工具自动化打开项目并进入 `pages/rank/index`，当前页面栈为 `pages/rank/index`。
- DevTools 画面截图已保存为本批证据图。
- `miniprogram` 排行榜测试：14 passed。
- `points-engine` 测试：28 passed。
- `weekly-star` 测试：14 passed。
- `npm run audit:privacy`：Privacy adversarial scan passed。
- 针对 `pages/rank` 与 `components/rank-row` 的 WXML/WXSS/组件 JS 检索未命中 `avatar-url`、`star-avatar`、`default-avatar.png`、`<image` 或 avatar 相关展示绑定。
