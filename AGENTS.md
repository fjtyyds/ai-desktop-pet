# AGENTS.md — AI 桌宠项目操作手册

给 Codex（及其他 AI 工具）的长期项目规则。每次会话开始时请完整阅读本文件、`docs/STATUS.md` 和 `PLAN.md`。

## 项目一句话

基于 Electron 的 Windows 优先 AI 桌宠：桌面角色 + DeepSeek v4 Flash 对话 + 本地记忆，最终开源并上架 GitHub、Microsoft Store、Steam。

## 铁律（防止上下文丢失）

1. 事实只存在于文件里：需求、决策、进度分别写入 `docs/SPEC.md`、`docs/DECISIONS.md`、`docs/STATUS.md`、`PLAN.md`。不要依赖会话记忆。
2. 一个会话只做一个任务，任务边界以 `docs/STATUS.md` 的“当前任务”为准。
3. 开始任务前：先读 `AGENTS.md`、`PLAN.md`、`docs/STATUS.md`；需要时再读 `docs/SPEC.md`、`docs/DECISIONS.md`。
4. 结束或中断会话前：更新 `PLAN.md` 的 Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective 四个区块，更新 `docs/STATUS.md`，然后提交 git。
5. 任何需求或技术变更，先写进 `docs/DECISIONS.md`（ADR），再实施。
6. 不要在一个会话里跨多个里程碑；不要跳过 `npm run check` 直接交付。
7. 发现文档与现实矛盾时，先更新文档并记录决策，不要静默猜测。

## 常用命令

- `npm run dev`：启动开发窗口（人工目检）
- `npm run check`：环境与关键文件检查（每次改动后必须通过）
- `npm run smoke`：无头冒烟测试（自动验证渲染页能加载）
- `npm install`：安装依赖（首次或 package.json 变更后）

## 目录地图

- `src/main` — Electron 主进程（窗口、生命周期、系统能力）
- `src/renderer` — 渲染进程（UI、动画、交互）
- `src/shared` — 未来共享类型/常量（M1 引入）
- `scripts` — 校验与自动化脚本
- `docs` — 产品、决策、状态文档
- `.github/workflows` — CI

## 验收要求

- `npm run check` 必须通过
- 涉及 UI 的改动必须用 `npm run dev` 人工目检
- 里程碑完成时更新 `PLAN.md` 并提交
- 文档与代码同时提交，禁止“只改代码不更新文档”
