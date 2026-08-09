# PLAN.md — 当前执行计划

> 本文是 Codex 每个会话的“施工图”。必须维护四个区块：Progress、Surprises & Discoveries、Decision Log、Outcomes & Retrospective。

## 当前里程碑

**M1：MVP 桌宠（并行模式）——已完成（2026-08-09）**

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

- [x] T-01 托盘与窗口生命周期
- [x] T-02 聊天面板 UI
- [x] T-03 DeepSeek Provider、设置与本地存储
- [x] 协调者合并到 main 并集成验证
- [x] T-04 M1 人工验收与收尾

**M2：智能层——已完成（2026-08-09）**

目标：人格/情绪 + 短期与长期记忆，重启后记得关键上下文。

任务卡：

- `docs/tasks/T-05.md` — 记忆存储与历史接口（codex/m2-memory）
- `docs/tasks/T-06.md` — 人格与情绪引擎（codex/m2-persona）
- `docs/tasks/T-07.md` — 上下文组装与端到端集成（codex/m2-context）
- `docs/tasks/T-08.md` — 设置页人格配置与持久化（codex/m2-settings）
- `docs/tasks/T-09.md` — 设置页 API Key 与模型输入（codex/m2-apikey）

验收标准：

1. 三个 worktree 分支并行开发，契约已由协调者冻结（ADR-010~012）。
2. 合并到 main 后 `npm run check`、`npm run smoke` 通过。
3. 手动 `npm run dev`：重启后历史恢复；人格/情绪设置生效；对话可引用记忆。

任务清单：

- [x] T-05 记忆存储与历史接口
- [x] T-06 人格与情绪引擎
- [x] T-07 上下文组装与端到端集成
- [x] 协调者合并到 main 并集成验证
- [x] T-08 设置页人格配置与持久化
- [x] T-09 设置页 API Key 与模型输入（常开真实模式）

**M3：打磨（进行中）**

目标：打包与正式图标、崩溃日志、i18n/无障碍、密钥加密；打包产物通过测试。

任务卡：

- `docs/tasks/T-10.md` — 打包与正式图标（codex/m3-packaging）
- `docs/tasks/T-11.md` — 崩溃上报与本地日志（codex/m3-crash）
- `docs/tasks/T-12.md` — i18n 与无障碍（codex/m3-i18n）
- `docs/tasks/T-13.md` — API Key 加密存储（codex/m3-secure）

验收标准：

1. 四个 worktree 分支并行开发；scripts/check.js 由协调者维护（任务只读）。
2. `npm run dist` 产出 Windows 安装包，安装/解包后启动冒烟通过。
3. `npm run check`、`npm run smoke` 通过；崩溃日志、i18n/无障碍走查、密钥密文落盘完成。

任务清单：

- [ ] T-10 打包与正式图标
- [ ] T-11 崩溃上报与本地日志
- [ ] T-12 i18n 与无障碍
- [ ] T-13 API Key 加密存储
- [ ] 协调者合并到 main 并集成验证

## Progress

- 2026-08-09：M0 完成（Electron 43.3.0、文档体系、CI）。
- 2026-08-09：M1 并行工作台搭建：任务卡、共享契约、worktree 分支。
- 2026-08-09：M1 集成完成：codex/m1-tray（T-01，此前已并入）→ codex/m1-chat（T-02 渲染层 + 其上的 e95c411 T-03）→ codex/m1-llm（T-03，842f18a）依次合并；T-03 冲突采用 842f18a 并删除 e95c411 重复文件；main.js 增加 `require('./ipc')`。`npm run check`、`npm run smoke` 通过。
- 2026-08-09：T-04 人工验收与收尾完成：`npm run dev` 目检通过（托盘图标/菜单/聊天收发/设置保存/单实例/关闭隐藏到托盘）；渲染页补 CSP（ADR-008）；关闭按钮改用 petAPI `window.hide`，修复 Electron 43 下 `window.close()` 绕过 close 事件导致应用退出的问题（ADR-009）。
- 2026-08-09：真实 DeepSeek 调用验证通过：`deepseek-v4-flash`（契约默认模型）与 `deepseek-chat` 均返回 200 与正确中文回复；密钥经环境变量传入，未入库。首次测试中文乱码为 PowerShell 管道编码问题，改用 UTF-8 脚本文件后正常。
- 2026-08-09：M2 设计完成：ADR-010~012（记忆模型/人格情绪/上下文组装）、SPEC 与 ROADMAP 更新、契约冻结（contracts.js 扩展）、任务卡 T-05~T-07 与 worktree 分支（codex/m2-*）就绪。
- 2026-08-09：M2 集成完成：codex/m2-memory（T-05）→ codex/m2-persona（T-06）→ codex/m2-context（T-07，先在 worktree 中合并 main 完成集成）依次并入 main；`npm run check`、`npm run smoke` 通过；真实模块集成验证通过（历史恢复、短期窗口、长期记忆注入、人格/情绪生效）。
- 2026-08-09：M2 缺口核查：SPEC 要求“用户可配置人格”，但 T-05~T-07 任务边界未含设置页 UI 与 persona 持久化；已建 T-08 与 ADR-013（设置页接入 petAPI.settings）。
- 2026-08-09：M2 复盘（ADR-014）：拆卡按层而非按用户故事，导致“设置人格”触点无人认领；已确立“用户故事→触点清单→任务卡”的拆卡规则。
- 2026-08-09：T-08 合并完成：设置页人格配置（性格标签/语气/背景）接入 petAPI.settings 并持久化（ADR-013）；`npm run check`、`npm run smoke` 与纯 Node 复核（写入/重启重读/prompt 生效/清洗）均通过。
- 2026-08-09：M2 人工目检通过（历史恢复、人格设置保存/重启、情绪变化、记忆引用、托盘/关闭/单实例回归）；真实 API Key 会话验证记忆抽取正常（控制台输出“已保存 N 条长期记忆”）；已创建桌面快捷方式“AI桌宠”便于启动/重启。
- 2026-08-09：T-09 建卡（设置页 API Key/模型，常开真实模式）：完成 SPEC 用户故事 3 的触点清单（UI/存储/校验），新增 ADR-015；worktree 与分支 codex/m2-apikey 就绪。
- 2026-08-09：T-09 合并完成：设置页 API Key（密码框）与模型输入已接入 petAPI.settings；store 增加 apiKey/model 清洗（apiKey ≤ 256、model ≤ 100）；`npm run check`、`npm run smoke` 与纯 Node 复核（写入/重启重读/清洗）均通过；任务卡记录真实调用验收成功（无需环境变量）。
- 2026-08-09：T-09 目检通过（设置页可滚动修复、密钥保存后直接真实对话、重启保留）；设置页不可滚动问题已修复（`.settings-body` 增加 overflow-y）。
- 2026-08-09：M3 规划完成：ADR-016~019（打包/崩溃日志/i18n 与无障碍/密钥加密）、SPEC 与 ROADMAP 更新、任务卡 T-10~T-13 与 worktree 分支（codex/m3-*）就绪。

## Surprises & Discoveries

- 本机未安装 Rust 工具链，M0 选用 Electron；Tauri 留作后续性能优化候选（见 ADR-001）。
- PowerShell 执行策略禁止 `npm.ps1`，需使用 `npm.cmd` 或 `npm run`（脚本本身仍正常）。
- npm audit 显示 Electron 37 有大量高危公告，已升级到 43.3.0（修复版本）。
- Windows PowerShell 读取 UTF-8 文件默认按 ANSI 解码，曾导致文档乱码；今后读写 UTF-8 必须显式指定编码。
- Electron 43 官方二进制下载超时，已用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 镜像解决；后续安装缺二进制时沿用此方法。
- smoke 冒烟测试通过；日志中的 GPU state invalid 提示为 offscreen 渲染常见噪音，不影响退出码。
- git 在沙箱用户下会报 dubious ownership；使用真实用户权限操作时正常。
- m1-chat 分支上除 T-02（ca9e9c7）外还带着一套 T-03 实现（e95c411：deepseek.js、json-store.js/message-store.js/settings-store.js）；T-03 正式实现提交在 m1-llm（842f18a：provider.js、store.js、chat.js 等）。两套无法共存，集成时按用户决定保留 842f18a、删除 e95c411（ADR-007）。
- smoke 在沙箱内会因 Electron 无法写入用户 AppData 缓存而 GPU 进程崩溃；需以真实用户权限运行。
- 集成完成后在纯 Node 下复核 T-03：mock 回复、设置读写、消息持久化、空输入校验均通过。
- Electron 43 下 renderer 的 `window.close()` 不触发主进程可拦截的 BrowserWindow close 事件，窗口直接关闭并触发 `window-all-closed` 导致应用退出（最小复现确认）；关闭按钮改用 IPC hide 并加 `window-all-closed` 兜底（ADR-009）。
- M2 集成发现并修正两处并行期兼容问题：① chat.js 原“服务内部自动创建 memory-store”在 T-05 合入后生效，导致测试写入 `~/.ai-desktop-pet` 并在沙箱/CI 失败，改为由 ipc.js 注入单例；② T-06 mood.js 实际接口为 `snapshot/applyFeedback/tick`，与 chat.js 原探针（getState/update）不一致，已在 chat.js 适配（含情感词反馈猜测，情绪变化体现在下一轮 system prompt）。
- 复盘教训：T-05~T-07 按“存储/逻辑/组装”分层拆卡，把设置页 UI 与 writeSettings 白名单排除在所有边界外，导致 SPEC“人格可配置”直到集成后才被发现缺失；已通过 ADR-014 建立“用户故事→触点清单→任务卡”规则。

## Decision Log

- ADR-001：M0 桌面壳选 Electron。
- ADR-002：LLM 层必须可替换。
- ADR-003：文档即事实来源。
- ADR-004：首发平台 Windows。
- ADR-005：M1 采用多线程 + git worktree 并行开发。
- ADR-006：集成前核对分支内容与任务卡，禁止把未完成工作标记为完成。
- ADR-007：T-03 采用 m1-llm 842f18a 实现，删除 m1-chat e95c411 重复实现。
- ADR-008：渲染页启用 CSP。
- ADR-009：关闭按钮通过 petAPI.window.hide 隐藏到托盘。
- ADR-010：M2 记忆模型——短期窗口 + 长期事实记忆（本地 JSON）。
- ADR-011：M2 人格与情绪。
- ADR-012：M2 上下文组装与渲染层历史恢复。
- ADR-013：设置页接入 petAPI.settings 并持久化人格。
- ADR-014：任务拆分必须按用户故事覆盖全触点。
- ADR-015：设置页补 API Key 与模型输入（常开真实模式）。
- ADR-016：M3 打包与正式图标（electron-builder + NSIS）。
- ADR-017：M3 崩溃上报与本地日志。
- ADR-018：M3 i18n 与无障碍。
- ADR-019：M3 API Key 加密存储（safeStorage）。

详见 `docs/DECISIONS.md`。

## Outcomes & Retrospective

- M0 完成标志已达成：新会话可只读文档冷启动；`npm run check` 与 `npm run smoke` 通过；Electron 窗口可加载。
- M1 集成完成：T-01/T-02/T-03 已合并到 main，`npm run check` 与 `npm run smoke` 通过；mock 模式可发消息、设置可保存/读取、消息可持久化。
- M1 验收完成（含人工目检）：托盘可用、聊天可发消息（mock）、设置可保存、关闭隐藏到托盘、CSP 无警告。
- 下一步：M2 智能层（人格/情绪、短期与长期记忆）规划。
- M2 设计完成：契约冻结、任务卡与 worktree 就绪，三个线程可并行开始。
- M2 集成完成：T-05/T-06/T-07 已合并到 main，check/smoke 与真实模块集成验证通过。
- 复盘：拆卡必须按用户故事覆盖全触点（ADR-014）；本次“人格可配置”缺口由 T-08 补上。
- M2 验收完成（含人工目检与真实 API 验证）：历史恢复、人格设置、情绪变化、记忆引用均正常。
- 待办：T-09（设置页 API Key/模型 输入框，常开真实模式，待建卡）；随后规划 M3 打磨（打包/图标/崩溃上报/i18n/无障碍）。
- T-09 已合并（codex/m2-apikey）：设置页保存密钥后即可直接真实对话；待人工目检后进入 M3 打磨规划。
- T-09 目检通过；M3 规划完成，T-10~T-13 四个线程可并行开始。
