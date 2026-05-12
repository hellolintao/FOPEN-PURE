# 数据库迁移脚本

按顺序执行。每个脚本必须**幂等**，重复跑不破坏数据。

## 已应用的迁移

| 编号 | 文件 | 内容 | 应用时间 |
|---|---|---|---|
| 001 | 001-add-new-fields.js | 给 members / tournaments / match_results 补 Phase 1 新字段默认值 | 2026-05-12（members 80 / tournaments 2 / match_results 3） |

## 应用方式

1. 在 cloudfunctions/ 下新建一个临时云函数目录 `migration-runner/`
2. 把待执行的 `XXX-*.js` 复制为该云函数的 `index.js`
3. `bash uploadCloudFunction.sh migration-runner` 上传
4. 在云开发控制台触发一次（"云函数 → 测试" 入口）
5. 看 return 的 stats，确认 updated 数符合预期
6. 把临时云函数删掉
7. 在本表的"应用时间"列填上日期
