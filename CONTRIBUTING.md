# 贡献指南

感谢参与 AI桌宠 开发。请先阅读 `AGENTS.md` 与 `docs/STATUS.md`。

## 规则

- 一个任务一张任务卡（`docs/tasks/T-xx.md`），一个会话只做一个任务
- 事实只存在于文件：需求/决策/进度分别写入 SPEC/DECISIONS/STATUS/PLAN
- 需求或技术变更先写 ADR，再实施；契约（`src/shared/contracts.js`、`docs/API.md`）由协调者冻结
- 每个改动后 `npm run check` 必须通过；涉及 UI 的改动用 `npm run dev` 人工目检
- 涉及 UI 与主进程的改动建议补 `scripts/check.js` 断言与 `npm run smoke` 回归
- 不提交密钥、日志、用户数据；`.env` 与本地探针文件已忽略

## 提交流程

1. 创建分支（建议 `codex/<task>-<slug>`）
2. 实现并自检（check/smoke）
3. 更新任务卡状态与文档
4. 提交并等待协调者验收合并（不自行合并 main）

## 文档

- `docs/SPEC.md`：产品规格
- `docs/DECISIONS.md`：决策日志（ADR）
- `docs/STATUS.md`：当前状态
- `PLAN.md`：里程碑计划
