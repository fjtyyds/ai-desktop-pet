# PLAN.md — 当前执行计划

> 本文是 Codex 每个会话的“施工图”。必须维护四个区块：Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective。

## 当前里程碑

**M1：MVP 桌宠（并行模式）**

目标：托盘/窗口、聊天面板 UI、DeepSeek Provider 与存储三路并行开发，最终在 main 集成。

任务卡：

- `docs/tasks/T-01.md` — 托盘与窗口生命周期（codex/m1-tray）
- `docs/tasks/T-02.md` — 聊天面板 UI（codex/m1-chat）
- `docs/tasks/T-03.md` — DeepSeek Provider、设置与本地存储（codex/m1-llm）

验收标准：

1. 三个 worktree 分支各自独立完成并提交。
2. 合并到 main 后 `npm run check`、`npm run smoke` 通过。
3. 手动 `npm run dev`：托盘可用、聊天 UI 可发消息（mock 或真实）、设置可保存。

任务清单：

- [ ] T-01 托盘与窗口生命周期
- [ ] T-02 聊天面板 UI
- [ ] T-03 DeepSeek Provider、设置与本地存储
- [ ] 协调者合并到 main 并集成验证

## Progress

- 2026-08-09：M0 完成（Electron 43.3.0、文档体系、CI）。
- 2026-08-09：M1 并行工作台搭建：任务卡、共享契约、worktree 分支。

## Surprises & Discoveries

- 本机未安装 Rust 工具链，M0 选用 Electron；Tauri 留作后续性能优化候选（见 ADR-001）。
- PowerShell 执行策略禁止 `npm.ps1`，需使用 `npm.cmd` 或 `npm run`（脚本本身仍正常）。
- npm audit 显示 Electron 37 有大量高危公告，已升级到 43.3.0（修复版本）。
- Windows PowerShell 读取 UTF-8 文件默认按 ANSI 解码，曾导致文档乱码；今后读写 UTF-8 必须显式指定编码。
- Electron 43 官方二进制下载超时，已用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 镜像解决；后续安装缺二进制时沿用此方法。
- smoke 冒烟测试通过；日志中的 GPU state invalid 提示为 offscreen 渲染常见噪音，不影响退出码。
- git 在沙箱用户下会报 dubious ownership；使用真实用户权限操作时正常。

## Decision Log

- ADR-001：M0 桌面壳选 Electron。
- ADR-002：LLM 层必须可替换。
- ADR-003：文档即事实来源。
- ADR-004：首发平台 Windows。
- ADR-005：M1 采用多线程 + git worktree 并行开发。

详见 `docs/DECISIONS.md`。

## Outcomes & Retrospective

- M0 完成标志已达成：新会话可只读文档冷启动；`npm run check` 与 `npm run smoke` 通过；Electron 窗口可加载。
- 并行模式开启后，每完成一个 M1 子任务更新本区块。