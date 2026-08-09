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

- [x] 文档体系（AGENTS.md / PLAN.md / docs/SPEC.md / docs/DECISIONS.md / docs/STATUS.md / ROADMAP.md）
- [x] Electron 最小壳（主进程 / 预加载 / 渲染页）
- [x] CI 工作流（.github/workflows/ci.yml）
- [x] 首次运行验证（check + smoke 已通过；`npm run dev` 待人工目检）
- [x] 初始 git 提交

## Progress

- 2026-08-09：M0 搭建开始，目标目录 `E:\codex\AI桌宠`。
- 2026-08-09：M0 完成 —— npm install 成功，check 与 smoke 通过，Electron 升级至 43.3.0。

## Surprises & Discoveries

- 本机未安装 Rust 工具链，M0 选用 Electron；Tauri 留作后续性能优化候选（见 ADR-001）。
- PowerShell 执行策略禁止 `npm.ps1`，需使用 `npm.cmd` 或 `npm run`（脚本本身仍正常）。
- npm audit 显示 Electron 37 有大量高危公告，已升级到 43.3.0（修复版本）。
- Windows PowerShell 读取 UTF-8 文件默认按 ANSI 解码，曾导致文档乱码；今后读写 UTF-8 必须显式指定编码。
- Electron 43 官方二进制下载超时，已用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 镜像解决；后续安装缺二进制时沿用此方法。
- smoke 冒烟测试通过；日志中的 GPU state invalid 提示为 offscreen 渲染常见噪音，不影响退出码。
- 本机未配置 git 身份，仓库内已使用占位身份 `Codex Dev <codex@local>`，请用户改回自己的身份。

## Decision Log

- ADR-001：M0 桌面壳选 Electron。
- ADR-002：LLM 层必须可替换。
- ADR-003：文档即事实来源。
- ADR-004：首发平台 Windows。

详见 `docs/DECISIONS.md`。

## Outcomes & Retrospective

- M0 完成标志已达成：新会话可只读文档冷启动；`npm run check` 与 `npm run smoke` 通过；Electron 窗口可加载。
- 踩坑：PowerShell 禁止 npm.ps1、Rust 缺失、首次 npm install 较慢、编码读写导致乱码。
- 改进：后续会话直接打开 `E:\codex\AI桌宠` 作为工作区；文档编辑用支持 UTF-8 的工具。