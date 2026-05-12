# FOPEN 小程序

FOPEN 是一个网球俱乐部内部使用的微信小程序，技术栈为微信小程序原生前端（WXML/WXSS/JS）+ 微信云开发云函数 + 云数据库。

## 项目文档入口

- 实施计划入口：[docs/superpowers/plans/README.md](docs/superpowers/plans/README.md)
- 当前进度日志：[docs/superpowers/plans/PROGRESS.md](docs/superpowers/plans/PROGRESS.md)
- 产品与技术规格：[docs/superpowers/specs/2026-05-11-tennis-club-miniprogram-design.md](docs/superpowers/specs/2026-05-11-tennis-club-miniprogram-design.md)
- 当前数据库说明：[cloudfunctions/DATABASE_SCHEMA.md](cloudfunctions/DATABASE_SCHEMA.md)

## 当前状态

superpowers 文档已经完成规格与 6 个 Phase 的拆分，但实施进度仍是 `0/6`。继续开发前先阅读计划入口和进度日志，确认当前应该从哪个 Phase 开始。

## 快速命令

```bash
# 查看当前状态
git status && git log --oneline -10

# 上传单个云函数
bash uploadCloudFunction.sh <函数名>

# 跑云函数测试
cd cloudfunctions/<函数名> && npm test
```
