# 决策日志（ADR）

记录格式：状态（Accepted / Proposed / Superseded）、背景、决策、后果。

## ADR-001：桌面壳选 Electron（M0）

- 状态：Accepted
- 背景：本机未安装 Rust 工具链；M0 要尽快产出可运行窗口；团队对 Node 更熟。
- 决策：M0 使用 Electron + 原生 Web 技术；渲染层与业务层解耦，为未来迁移 Tauri 保留可能。
- 后果：包体较大、内存占用高于 Tauri；后续若性能成为痛点，再评估 Tauri 2。

## ADR-002：LLM 层必须可替换

- 状态：Accepted
- 背景：模型价格与能力会变化，DeepSeek v4 Flash 只是起点。
- 决策：所有模型调用走统一 Provider 接口，密钥不硬编码。
- 后果：M1 需要定义请求/响应/错误类型，工作量略增但长期稳定。

## ADR-003：文档即事实来源

- 状态：Accepted
- 背景：Codex 长期项目最大风险是上下文压缩导致需求丢失。
- 决策：需求、决策、进度全部落盘；会话只保留“当前任务”上下文。
- 后果：每次会话前后需要维护文档，但可随时冷启动接续。

## ADR-004：首发平台 Windows

- 状态：Accepted
- 背景：桌宠应用在 Windows 生态最自然；商店与 Steam 上架路径可并行准备。
- 决策：MVP 只面向 Windows 10/11；UI 与业务逻辑保持跨平台写法。
- 后果：macOS/Linux 工作量留到 M5 之后评估。

## ADR-005：M1 采用多线程 + git worktree 并行开发

- 状态：Accepted
- 背景：为提升开发效率，并避免单一超长线程带来的上下文丢失风险。
- 决策：M1 拆为 T-01/T-02/T-03，各自独立 worktree 与分支，任务卡为唯一边界；协调者负责合并与文档汇总。
- 后果：并行效率高，但需要接口冻结与合并纪律；契约统一维护在 `src/shared/contracts.js`。

## ADR-006：集成前核对分支内容与任务卡（M1）

- 状态：Accepted
- 背景：M1 集成时发现 codex/m1-chat 分支提交的是 T-01 托盘实现而非 T-02 聊天 UI；codex/m1-llm 分支与 main 无差异，T-03 无任何提交或未提交文件；T-02/T-03 任务卡仍为“未开始”。
- 决策：合并前必须核对分支 diff、worktree 状态与任务卡状态；文档只记录仓库中真实存在的工作，禁止把未完成任务标记为完成。
- 后果：集成流程增加一次只读核查步骤；若分支内容与任务卡不符，先向协调者报告，不静默合并或补写文档。

## ADR-007：T-03 集成取舍——保留 m1-llm 实现，删除 m1-chat 重复实现（M1）

- 状态：Accepted
- 背景：codex/m1-chat 分支在 T-02 之上还带有 e95c411（一套 T-03 实现：deepseek.js、json-store.js/message-store.js/settings-store.js）；T-03 任务卡指定分支 codex/m1-llm 提交了另一套实现 842f18a（provider.js、store.js、chat.js 等）。两套在 src/llm/index.js、src/llm/mock.js、src/main/ipc.js、src/main/preload.js 上同名冲突，无法共存。
- 决策：M1 采用 codex/m1-llm 842f18a 作为 T-03 正式实现；合并时删除 e95c411 的 4 个专属文件（src/llm/deepseek.js、src/storage/json-store.js、src/storage/message-store.js、src/storage/settings-store.js），冲突文件取 842f18a；main.js 增加 `require('./ipc')` 完成接线。
- 后果：main 中 T-03 与 T-03 线程验收过的实现一致；e95c411 仍保留在 codex/m1-chat 分支历史中，如需复用可从中提取。

## ADR-008：渲染页启用 CSP（M1 收尾）

- 状态：Accepted
- 背景：dev 模式自 M0 起存在 CSP 警告；Electron 安全基线要求限制渲染页可加载来源。
- 决策：在 `src/renderer/index.html` 添加 meta CSP：`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'`。
- 后果：外部资源与内联脚本/样式被阻止；DeepSeek 调用位于主进程，不受影响；后续如需 CDN 或远程资源，需先修订本 ADR。

## ADR-009：关闭按钮通过 petAPI.window.hide 隐藏到托盘（M1 收尾）

- 状态：Accepted
- 背景：无边框窗口没有系统关闭按钮，补齐 ✕ 按钮时发现 Electron 43 下 renderer 调用 `window.close()` 不会触发主进程 `BrowserWindow` 的 close 事件（最小复现：close 事件未触发、`window-all-closed` 直接触发），导致窗口关闭后应用默认退出、托盘一并消失。
- 决策：关闭按钮调用新增契约 `petAPI.window.hide()`（IPC `window:hide`，主进程用 `BrowserWindow.fromWebContents` 隐藏窗口）；同时在 main.js 增加 `window-all-closed` 空监听作为兜底，防止任何路径下窗口销毁导致应用退出。
- 后果：点击 ✕ 保留窗口位置与内存状态、隐藏到托盘；契约新增一个方法，preload/ipc/chat.js 同步更新；后续如恢复使用 `window.close()` 需先验证目标 Electron 版本的 close 事件行为。
