# AGENTS.md — AI 桌宠项目操作手册

给 Codex（及其他 AI 工具）的长期项目规则。每次会话开始时请完整阅读本文件、`docs/STATUS.md` 和 `PLAN.md`。

## 项目一句话

基于 Electron 的 Windows 优先 AI 桌宠：桌面角色 + DeepSeek v4 Flash 对话 + 本地记忆，最终开源并上架 GitHub、Microsoft Store、Steam。

## 铁律（防止上下文丢失）

1. 事实只存在于文件里：需求、决策、进度分别写入 `docs/SPEC.md`、`docs/DECISIONS.md`、`docs/STATUS.md`、`PLAN.md`。不要依赖会话记忆。
2. 一个会话只做一个任务，任务边界以任务卡（`docs/tasks/T-xx.md`）为准。
3. 开始任务前：先读 `AGENTS.md`、`PLAN.md`、`docs/STATUS.md`、自己的任务卡；需要时再读 `docs/SPEC.md`、`docs/DECISIONS.md`。
4. 结束或中断会话前：更新任务卡状态、`PLAN.md`、`docs/STATUS.md`，然后提交 git。
5. 任何需求或技术变更，先写进 `docs/DECISIONS.md`（ADR），再实施。
6. 不要在一个会话里跨多个任务；不要跳过 `npm run check` 直接交付。
7. 发现文档与现实矛盾时，先更新文档并记录决策，不要静默猜测。
8. 新增任务不得表面迎合式“完成”（ADR-050）：实施前先质疑需求假设、核对真实信号与用户实际使用场景；实施后做批判性自检（功能是否真实、会不会误报/打扰、是否只是装饰或假进度），并把自检结论写进任务卡完成记录。

## 常用命令

- `npm run dev`：启动开发窗口（人工目检）
- `npm run check`：环境与关键文件检查（每次改动后必须通过）
- `npm run smoke`：无头冒烟测试（自动验证渲染页能加载）
- `npm install`：安装依赖（首次或 package.json 变更后）
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\sync-latest.ps1`：构建并同步“最新版”到 `E:\codex\AI桌宠最新版`（-SkipBuild 复用现有 dist；每次 main 合并验收后由协调者执行，ADR-042；同步后自动把桌面“AI桌宠”快捷方式替换为最新构建，ADR-055）
- 若 `npm run check` 提示 Electron 未安装（二进制缺失）：`$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'; node node_modules/electron/install.js`

## 并行开发模式（M1 起）

- 每个任务一张任务卡，位于 `docs/tasks/`；一个线程只做一张卡。
- 每个任务使用独立 git worktree 与分支（`codex/m1-*`），工作树统一建在项目根内 `.worktrees/<任务分支>`（实测 git worktree 支持嵌套；禁止在 E:\codex 根目录或项目外创建任务文件夹，ADR-049）。
- 只允许修改任务卡“涉及文件”列出的内容；其他文件只读。
- 依赖（package.json）变更只允许 T-03 或协调者执行。
- 子任务完成后，由协调者在 main 分支合并并更新 STATUS.md/PLAN.md；子线程只更新自己的任务卡。
- 各任务必须遵守 `src/shared/contracts.js` 的接口契约；修改契约需先经协调者。
- 新 worktree 首次使用时需运行 `npm install`（或复用主工作树 node_modules junction；二进制下载慢时使用上面的镜像命令）。

## 目录地图

- `src/main` — Electron 主进程（窗口、生命周期、系统能力、IPC）
- `src/renderer` — 渲染进程（UI、动画、交互）
- `src/shared` — 共享类型/契约（协调者维护）
- `src/llm` — LLM Provider（T-03 新建）
- `src/storage` — 本地存储（T-03 新建）
- `scripts` — 校验与自动化脚本
- `docs` — 产品、决策、状态、任务卡
- `.worktrees` — 任务临时工作树（gitignore，验收合并后清理，ADR-049）
- `.github/workflows` — CI

## 验收要求

- `npm run check` 必须通过
- 本仓库文档均为 UTF-8；PowerShell 读取/写入时必须显式指定 UTF-8 编码，避免乱码
- 涉及 UI 的改动必须用 `npm run dev` 人工目检
- 里程碑完成时更新 `PLAN.md` 并提交
- 文档与代码同时提交，禁止“只改代码不更新文档”
- main 合并验收后运行 `scripts\sync-latest.ps1` 同步 `E:\codex\AI桌宠最新版`（ADR-042），并确认桌面“AI桌宠”快捷方式已替换为最新构建（ADR-055）

## 自主执行与交接（2026-08-11）

- 自主执行边界见全局 `C:\Users\HP\.codex\AGENTS.md`（ADR-034）：本地操作/项目内闭环/沙箱可自主；push/发布/资金/系统级改动/不可恢复删除仍需确认。
- 总工交接必须使用优化提示词模板：`docs/reports/2026-08-11-总工交接提示词模板.md`。
- 总工交接必须保持项目上下文（ADR-047）：`send-prompt` 必须带 `--project "E:\codex\AI桌宠"`，禁止创建“不在项目中工作”的项目外总工线程；新总工上岗前核对线程属于本项目，否则重交。
- 持续闭环循环为默认工作模式：派活 → 等待反馈 → 验收 → 合并 → 更新状态 → 下一张卡。
