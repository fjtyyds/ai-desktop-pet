# PLAN.md — 当前执行计划

> 本文是 Codex 每个会话的“施工图”。必须维护四个区块：Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective。

## 当前里程碑

**M0：工程骨架与防丢失文档体系**

目标：仓库可用、文档可冷启动、最小 Electron 窗口可运行。

验收标准：

1. 新会话只读 `AGENTS.md`、`PLAN.md`、`docs/STATUS.md` 即可接续工作。
2. `npm install` 后 `npm run check` 通过。
3. `npm run dev` 能打开一个透明置顶的小窗口（人工目检）。
4. `npm run smoke` 能自动加载渲染页并以 0 退出。

任务清单：

- [ ] 文档体系（AGENTS.md / PLAN.md / docs/SPEC.md / docs/DECISIONS.md / docs/STATUS.md / ROADMAP.md）
- [ ] Electron 最小壳（主进程 / 预加载 / 渲染页）
- [ ] CI 工作流（.github/workflows/ci.yml）
- [ ] 首次运行验证（check + smoke + dev 目检）
- [ ] 初始 git 提交

## Progress

- 2026-08-09：M0 搭建开始，目标目录 `E:\codex\AI桌宠`。

## Surprises & Discoveries

- 本机未安装 Rust 工具链，M0 选用 Electron；Tauri 留作后续性能优化候选（见 ADR-001）。
- PowerShell 执行策略禁止 `npm.ps1`，需使用 `npm.cmd` 或 `npm run`（脚本本身仍正常）。

## Decision Log

- ADR-001：M0 桌面壳选 Electron。
- ADR-002：LLM 层必须可替换。
- ADR-003：文档即事实来源。
- ADR-004：首发平台 Windows。

详见 `docs/DECISIONS.md`。

## Outcomes & Retrospective

- M0 完成后填写：哪些顺利、哪些踩坑、下次如何更快。
