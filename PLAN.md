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

- [x] T-10 打包与正式图标
- [x] T-11 崩溃上报与本地日志
- [x] T-12 i18n 与无障碍
- [x] T-13 API Key 加密存储
- [x] 协调者合并到 main 并集成验证

**M3.5：内容增强（规划完成，分 5 个批次串行）**

目标：流式回复、主动互动、情绪可视化、记忆管理、首次引导、窗口体验、扩展能力（验证门禁）。

批次与任务卡：

- 批次 1（对话体验）：`docs/tasks/T-14.md` — 流式回复与打字机（codex/m3x-stream）
- 批次 2（陪伴感）：`docs/tasks/T-15.md` — 空闲主动互动（codex/m3x-idle）；`docs/tasks/T-16.md` — 情绪可视化（codex/m3x-mood-ui）
- 批次 3（记忆与隐私）：`docs/tasks/T-17.md` — 记忆管理页（codex/m3x-memory-ui）；`docs/tasks/T-18.md` — 对话导出与数据清除（codex/m3x-export）
- 批次 4（上手与窗口）：`docs/tasks/T-20.md` — 首次引导与人格模板（codex/m3x-onboarding）；`docs/tasks/T-19.md` — 窗口体验（codex/m3x-window）
- 批次 5（扩展能力，先验证）：`docs/tasks/T-21.md` — 系统状态与番茄钟（codex/m3x-widgets）；`docs/tasks/T-22.md` — 天气小部件（codex/m3x-weather）；`docs/tasks/T-23.md` — 语音与图片（codex/m3x-voice-vision）

验收标准：

1. 每批次完成后 `npm run check`、`npm run smoke` 通过；涉及 UI 用 `npm run dev` 目检。
2. 流式回复真实 API 逐字输出，取消/超时不卡死。
3. 契约扩展（mood/memory/export/window）由协调者先冻结（ADR-022）。
4. 批次 5 以技术验证结论为准，不通过则记录降级。

任务清单：

- [x] T-14 流式回复与打字机体验
- [x] T-15 空闲主动互动
- [x] T-16 情绪可视化
- [x] T-17 记忆管理页
- [x] T-18 对话导出与数据清除
- [x] T-19 窗口体验（贴边/位置记忆/快捷键）
- [x] T-20 首次引导与预设人格模板
- [x] T-21 系统状态与番茄钟
- [x] T-22 天气小部件
- [x] T-23 语音与图片（验证门禁）
- [x] M3.5 整体集成与目检（2026-08-10 完成，发现问题见下方“M3.5 收尾优化”）

**M3.5 收尾优化（任务已立卡，未开始）**

背景：2026-08-10 整体目检后用户反馈 9 类问题，详见 `docs/reports/2026-08-10-M3.5-整体目检与优化方案.md` 与 ADR-025。每个任务一张卡（docs/tasks/T-24~T-32.md），完成后先回报协调者验收，验收通过前不合并 main；orchestrator 修复（T-32）最后执行。

任务清单：

- [ ] T-24 窗口布局：可缩放、小部件不遮挡聊天、移除底部平台/版本信息
- [ ] T-25 工具栏：导出移入工具栏 + 新增最小化按钮（契约已冻结，可分配）
- [ ] T-26 天气：自动刷新 15 分钟 + 更新时间提示 + 失败重试
- [ ] T-27 番茄钟：结束通知重复弹窗修复
- [ ] T-28 人格模板：文案精简（名称 + 一句话，完整描述折叠）
- [ ] T-29 全局快捷键移除（已确认；契约已移除，可分配）
- [ ] T-30 系统状态小部件移除（已确认，可分配）
- [ ] T-31 贴边体验优化（已确认方案 B：靠边吸附不自动隐藏，可分配）
- [ ] T-32 orchestrator 缺陷修复（最后执行；是否入库待用户决定）
- Backlog：UI 大改（M3.6 独立里程碑，M3.5 收尾后评估）

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
- 2026-08-09：T-11/T-12/T-13 合并完成：崩溃日志（crash.js + logs/app.log）、i18n（zh-CN/en + 无障碍对比度修正）、密钥加密（safeStorage enc:v1:）均并入 main；check/smoke 通过，合并后集成验证通过（i18n 15 节点生效、无 CSP 错误；256 字符密钥密文往返一致）。
- 2026-08-09：T-10 依赖变更获批（electron-builder@^26.15.3）；待其合并 main 后执行 dist 打包冒烟。
- 2026-08-09：T-10 合并完成：electron-builder + NSIS 产出 AI桌宠-0.1.0-Setup.exe（约 100 MB）；正式图标 assets/icon.ico、icon.png；解包与静默安装/卸载冒烟通过；依赖已安装（0 漏洞），check/smoke 通过。
- 2026-08-09：M3 整体目检通过；M3.5 内容增强规划完成：ADR-020~023（范围变更与验证门禁）、SPEC 更新（语音/提醒转增强范围）、任务卡 T-14~T-23 与 5 个批次排定。
- 2026-08-09：用户要求 T-18 与 T-20 内容互换（T-18=对话导出与数据清除，T-20=首次引导与人格模板）；批次 3/4 映射已同步；T-14~T-18 五个线程同时开工。
- 2026-08-09：T-14~T-18 五个分支已全部合并到 main：流式（SSE/mock 分段/取消）、空闲互动（idle.js + idleEnabled）、情绪可视化（mood.get + 表情配色）、记忆管理页（memory.list/delete/update）、导出与清除（history.export/clear + 设置页 UI）；共享文件冲突（ipc/preload/chat.js/css/index.html）已全部解决；check/smoke 与合并后集成验证通过。
- 2026-08-10：T-20~T-23 由 orchestrator 全自动完成并合并：T-20 首次引导/人格模板（b2cf869）、T-21 系统状态与番茄钟（eb66fd7，与 T-20/T-22 共享文件冲突由协调者手工合并）、T-22 天气小部件（0d853ed）、T-23 语音（系统 TTS 落地，STT/图片验证不可行并记录降级，1e0463f）；M3.5 十个任务全部完成，待整体目检。
- 2026-08-09：发现仓库根目录存在未跟踪的“多线程开发/”（约 5.07GB，含 12 个 worktree 副本与 node_modules）与 scripts/orchestrator/（自动化实验产物）；均未入库，删除与否待用户决定。
- 2026-08-10：M3.5 整体人工目检完成，用户反馈 9 类体验问题；文档收口完成（T-07 状态、STATUS/PLAN 同步、ADR-025、优化方案落盘）；“多线程开发/”确认属于项目开发内容并暂时保留；orchestrator 去留待用户决定。
- 2026-08-10：M3.5 收尾优化任务卡 T-24~T-32 已建卡，线程分配手册与每任务提示词已落盘；等待用户确认待决项并分配线程。
- 2026-08-10：用户确认移除全局快捷键（T-29）、移除系统状态小部件（T-30）、贴边方案 B（T-31）；协调者按 ADR-026 冻结契约（新增 window.minimize、移除 window.setShortcutEnabled），任务全部可分配。
- 2026-08-10：用户选择 T-24~T-31 全部并行开始；约定：线程完成后先回报协调者，由协调者按回报顺序验收、串行合并并解决共享文件冲突；T-32 最后执行。

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
- 自动化试点发现（T-14）：spawn/followup 下发的子代理三次均未执行任务（只回复“等待任务指派”），连“回复投递测试码”的最小指令也未送达内容；结论为当前环境子代理消息内容不可达，全自动子代理执行不可行。替代方案：协调者直行（A1）或外部线程半自动（B）。
- 自动化方案评估（scripts/orchestrator）：外部编排器（codex exec 多路循环）设计合理，但 `codex` CLI 为 WindowsApps MSIX 打包，在本工具沙箱/提权环境中均被拒绝运行（Access denied）；可行路径为“用户在自己的终端运行 orchestrator，协调者审查日志并合并”，或继续半自动线程模式。
- 2026-08-10 协调者复盘（ADR-024）：近期多次错误决策（git add -A 误纳 5GB 目录、Windows spawn .cmd EINVAL、未核对 codex CLI 参数、单实例锁误判、子代理试点未先探测、大目录未及时忽略、空分支误判 already-merged）；已确立七条防错规则并作为长期规范执行。
- 2026-08-10：T-19 由 orchestrator 全自动完成并合并（40d4a7d）：npm 版 codex CLI 打通（cmd 启动）、--approve-for-me 替代 --full-auto、修复任务卡括号注释导致的边界误判与空分支误判；main check/smoke 通过。
- orchestrator 实战修复（2026-08-10）：① 任务卡标签解析改用正则捕获组（“涉及文件（待验证后确定）：”与“系统状态采集”干扰 includes 判断）；② stripNote 剥离任意位置括号注解；③ branchHasCommits 由 rev-parse 区间改为 rev-list --count（resume 之前从未生效）；④ 空分支/残留 worktree 自动清理、resume 分支不匹配自动处理；⑤ 多 --task 参数解析只保留最后一个（README 声称可重复但实现不支持，已改为一任务一进程）；⑥ T-21 合并与 T-20/T-22 冲突由协调者手工解决。

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
- ADR-020：M3.5 内容增强计划（全量）。
- ADR-021：流式回复（SSE）与打字机体验。
- ADR-022：M3.5 契约扩展冻结（mood/memory/export/window）。
- ADR-023：扩展能力范围与技术验证门禁（语音/图片/天气/番茄钟）。

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
- T-11/T-12/T-13 已合并；T-10 依赖获批、打包待完成；全部完成后进入 M3 整体目检。
- M3 四个任务（T-10~T-13）已全部合并；待整体目检（dev UI 与安装包）后宣告 M3 完成。
- M3 整体目检通过，M3 完成；M3.5 内容增强规划完成，待批次 1（T-14 流式回复）启动。
- T-14~T-18 已合并；待整体目检；随后启动 T-19/T-20 与批次 5（T-21~T-23）。
- M3.5 整体目检完成（2026-08-10）：功能可用但存在体验问题，已形成收尾优化方案并待用户确认优先级；随后进入逐项修复与 UI 大改评估。
