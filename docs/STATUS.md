# 项目状态

- 更新时间：2026-08-10
- 当前阶段：M3.5 收尾优化 T-24~T-31 已全部合并验收；整体回归目检与后续任务待排期
- 当前任务：T-32（orchestrator 修复）与 T-33（TTS 专属语音包）待办；可选整体 UI 目检
- 最近完成：T-24~T-31 全部合并（check/smoke 通过）；worktree 清理；ADR-027/T-33 需求落盘
- 下一步：用户确认 T-32/T-33 优先级；随后整体 UI 目检与 M4 分发规划
- 阻塞：无
- 交接提示：新会话先读 `AGENTS.md` → `PLAN.md` → 自己的任务卡（docs/tasks/T-xx.md）

## M1 集成完成记录（2026-08-09）

- 合并：codex/m1-tray（T-01，此前已并入）→ codex/m1-chat（T-02 渲染层 + e95c411 T-03）→ codex/m1-llm（T-03，842f18a）。
- T-03 取舍：保留 m1-llm 842f18a 实现（provider/store/chat + ipc/preload），删除 m1-chat e95c411 重复实现（deepseek.js、json-store.js、message-store.js、settings-store.js），见 ADR-007。
- 接线：main.js 增加 `require('./ipc')`。
- 校验：`npm run check` 通过；`npm run smoke` 通过（需真实用户权限）；T-03 纯 Node 功能验证通过。
- 任务卡：T-01/T-02/T-03 均已标记“已完成”。

## T-04 收尾记录（2026-08-09）

- 人工目检通过：托盘图标/菜单/左键切换、聊天 mock 收发、设置保存、单实例锁、关闭按钮隐藏到托盘（应用不退出）。
- CSP：渲染页补充 Content-Security-Policy，dev 控制台无警告（ADR-008）。
- 关闭按钮：无边框窗口补 ✕；因 Electron 43 的 renderer `window.close()` 绕过 close 事件导致应用退出，改为 petAPI `window.hide` IPC 隐藏窗口并加 `window-all-closed` 兜底（ADR-009）。
- 校验：`npm run check`、`npm run smoke` 通过；window.hide 端到端验证通过（隐藏后窗口未销毁、应用存活）。
- 真实调用：`deepseek-v4-flash`（默认模型）与 `deepseek-chat` 均验证成功，密钥仅经环境变量传入。

## M2 设计完成记录（2026-08-09）

- ADR-010：记忆模型（短期窗口 20 条 + 长期事实记忆 memories.json，无向量库）。
- ADR-011：人格（settings.persona）+ 情绪（内存态状态机）+ system prompt 注入。
- ADR-012：chat service 统一组装上下文；渲染层通过 petAPI.history.get 恢复历史。
- 契约冻结：contracts.js 新增 ChatMessage.sessionId/timestamp、Persona、MoodState、MemoryItem、history.get、DEFAULT_SHORT_TERM_WINDOW、MAX_MEMORIES_IN_CONTEXT。
- 任务卡：T-05（codex/m2-memory）、T-06（codex/m2-persona）、T-07（codex/m2-context），worktree 目录见任务卡。

## M2 集成完成记录（2026-08-09）

- 合并：codex/m2-memory（T-05）→ codex/m2-persona（T-06）→ codex/m2-context（T-07，先在 m2-context worktree 合并 main 完成集成）依次并入 main。
- 集成修正：① chat.js 不再自动创建 memory-store，改由 ipc.js 注入单例（修复测试写用户主目录问题）；② chat.js 适配 mood.js 实际接口（snapshot/applyFeedback/tick），情绪读取与反馈更新生效。
- 校验：`npm run check` 通过；`npm run smoke` 通过（含启动历史恢复与表单端到端断言）；真实模块集成验证通过（人格注入、情绪 60→76 变化、长期记忆注入、历史持久化）。
- 任务卡：T-05/T-06/T-07 均已标记“已完成”，集成待办已核对并记录。

## M2 缺口与 T-08（2026-08-09）

- 缺口：SPEC M2 用户故事 2 要求“用户可在设置中配置人格”，但 T-05~T-07 均未包含设置页 UI 与 persona 持久化（`store.writeSettings` 只允许 apiKey/model/petName）。
- 处理：创建 T-08（codex/m2-settings，设置页人格配置与持久化）并新增 ADR-013；worktree 与分支已就绪。
- 复盘：根因是拆卡按层而非按用户故事，设置触点无人认领；已确立 ADR-014（用户故事→触点清单→任务卡）。

## T-08 集成记录（2026-08-09）

- 合并：codex/m2-settings（T-08，设置页人格配置与持久化）已并入 main；任务卡状态“已完成”。
- 校验：`npm run check` 通过（含设置页 petAPI.settings 集成、persona 读写与清洗断言）；`npm run smoke` 通过；纯 Node 复核通过（写入→重启重读、system prompt 生效、非法值清洗）。

## M2 人工目检记录（2026-08-09）

- 目检通过：历史恢复、人格设置保存/重启后仍在、情绪随积极/消极消息变化、长期记忆抽取与引用（真实 API Key 会话，控制台输出“已保存 N 条长期记忆”）、托盘/关闭/单实例回归。
- 桌面已创建“AI桌宠”快捷方式（指向 electron.exe + 项目目录），用于日常启动/重启。
- 待办：T-09（设置页 API Key/模型 输入框，常开真实模式；当前真实模式需环境变量 DEEPSEEK_API_KEY 启动）。

## T-09 建卡记录（2026-08-09）

- ADR-015：设置页补 API Key 与模型输入；触点清单（UI=index.html/chat.js/chat.css、存储=store.js 清洗、IPC=复用 settings.get/set、校验=check.js）。
- 任务卡与分支：docs/tasks/T-09.md、codex/m2-apikey，worktree E:\codex\AI桌宠-m2-apikey。

## T-09 集成记录（2026-08-09）

- 合并：codex/m2-apikey（T-09）已并入 main；任务卡状态“已完成”（含真实调用验收：设置中的密钥无需环境变量即可调用 deepseek-v4-flash）。
- 校验：`npm run check` 通过（含 API Key/模型输入存在性与读写/清洗断言）；`npm run smoke` 通过；纯 Node 复核通过（写入→重启重读、apiKey 截断 256、非法 model 回退默认）。
- 目检通过：设置页可滚动（修复 `.settings-body` overflow-y）、密钥保存后直接真实对话、重启保留密钥与历史。

## M3 规划完成记录（2026-08-09）

- ADR-016：electron-builder + NSIS 打包与正式图标（assets/）。
- ADR-017：崩溃上报与本地日志（crashReporter + logs/app.log）。
- ADR-018：i18n（zh-CN/en）与无障碍走查。
- ADR-019：API Key 加密存储（safeStorage/DPAPI，旧明文自动迁移）。
- 任务卡：T-10（codex/m3-packaging）、T-11（codex/m3-crash）、T-12（codex/m3-i18n）、T-13（codex/m3-secure）；worktree 目录见任务卡；scripts/check.js 由协调者维护。

## M3 集成记录（2026-08-09，T-11~T-13）

- T-11 崩溃日志：crash.js（uncaughtException/unhandledRejection → logs/app.log，crashReporter 本地 dump）已并入 main。
- T-12 i18n/无障碍：locales zh-CN/en、语言切换与持久化、托盘菜单本地化、对比度修正（主按钮 #4160de）已并入 main。
- T-13 密钥加密：secure-settings.js（safeStorage enc:v1:，明文自动迁移，不可用回退告警；apiKey 原始读写绕过 256 清洗上限，避免密文截断）已并入 main。
- 校验：`npm run check`、`npm run smoke` 通过；合并后集成验证通过（i18n 15 个 data-i18n 节点生效、无 CSP 错误；256 字符密钥密文落盘 enc:v1: 长度 387、get/set 往返一致）。
- T-10 状态：前置工作（assets 图标、electron-builder.yml、tray/main 图标读取）在 worktree 中未提交；依赖变更已获批，待 T-10 合并 main 后执行 npm install + npm run dist 并提交。

## T-10 集成记录（2026-08-09）

- 合并：codex/m3-packaging（T-10）已并入 main；package.json 增加 electron-builder@^26.15.3 与 dist/pack 脚本；electron-builder.yml 与 assets/icon.ico、icon.png 已入库；main.js/tray.js 读取正式图标（内嵌 base64 回退），并与 T-11/T-12 的 initCrash/i18n 共存。
- 产物：AI桌宠-0.1.0-Setup.exe（约 100 MB）与 dist/win-unpacked/；解包冒烟（临时 userData：petAPI/设置/聊天 mock/历史/密钥密文/单实例锁）与静默安装/卸载冒烟（退出码 0）通过。
- 校验：main 安装依赖后 `npm run check`、`npm run smoke` 通过。
- 过程说明：T-10 首次冒烟误写 2 条测试消息到真实历史，已清理恢复（备份在 %TEMP%\ai-pet-messages-backup-16b81fb4396b4178920aedffe64ef103.json）；真实 settings.json 的 apiKey 已由 T-13 自动迁移为密文，属预期行为。

## M3.5 规划完成记录（2026-08-09）

- ADR-020：M3.5 内容增强计划（13 项增强、5 个批次串行）。
- ADR-021：流式回复（SSE）与打字机。
- ADR-022：契约扩展冻结（mood.get、memory.list/delete、history.export/clear、window 接口）。
- ADR-023：扩展能力验证门禁（语音/图片/天气/番茄钟）。
- SPEC：语音输入/输出、任务提醒/日程从非目标转为 M3.5 增强范围；移动端/皮肤市场/云账号仍为非目标。
- 任务卡：T-14~T-23；批次 1~5 见 PLAN.md；worktree 在对应批次启动时创建。

## M3.5 集成记录（2026-08-09，T-14~T-18）

- T-14 流式：provider.chatStream（SSE/onDelta/AbortSignal/超时）、mock 分段、chat.sendStream、IPC chat:send-stream/chat:delta/chat:stream-cancel、打字机与“正在思考…”；分支 7b7cc4c。
- T-15 空闲互动：idle.js（3 分钟触发/90 秒节流/防打扰）、idleEnabled 开关持久化、双语言话术池；分支 dfc011b。
- T-16 情绪可视化：mood.get 通道与渲染层表情/配色（含共享情绪单例包装，避免显示与实际 mood 不一致）；分支 9b438cb。
- T-17 记忆管理页：memory:list/delete/update + 设置页“记忆”子页（memory-store 增加 updateMemory，属边界扩展已记录）；分支 457594b。
- T-18 导出与清除：history:export（showSaveDialog，Markdown/JSON）、history:clear（确认框 + 分范围清空）；分支 37c003a。
- 集成：共享文件冲突全部解决；`npm run check`、`npm run smoke` 通过；合并后集成验证通过（API 齐全、mock 流式 23 段、mood/memory/export 正常、无 CSP 错误）。
- 待办：整体目检；仓库根目录未跟踪的“多线程开发/”（约 5GB）与 scripts/orchestrator/ 删除与否待用户决定。

## T-19 自动集成记录（2026-08-10）

- 方式：orchestrator 全自动闭环（coordinator 直接运行）：resume 验收（边界/check/smoke/任务卡）→ 通过 → 自动合并 40d4a7d → 清理 worktree（保留分支）。
- 修复：npm 版 codex CLI 经 cmd 启动；`--approve-for-me` 替代 `--full-auto`（与 --sandbox 互斥）；任务卡“涉及文件”括号注释剥离避免边界误判；空分支/残留 worktree 自动清理；resume 分支不匹配改为自动处理。
- 校验：main `npm run check`、`npm run smoke` 通过。

## T-20~T-23 自动集成记录（2026-08-10）

- T-20 首次引导与预设人格模板：b2cf869 合并。
- T-21 系统状态与番茄钟：eb66fd7 合并（与 T-20/T-22 共享文件冲突由协调者手工解决）。
- T-22 天气小部件（Open-Meteo 无密钥）：0d853ed 合并。
- T-23 语音与图片验证门禁：系统 TTS 落地，STT/图片验证不可行并记录降级；1e0463f 合并。
- orchestrator 修复：标签正则捕获组、括号注解剥离、resume（branchHasCommits）、空分支/残留 worktree 自动清理、多任务改为一任务一进程。
- 校验：main `npm run check`、`npm run smoke` 通过。
- 待办：M3.5 整体目检；未跟踪的“多线程开发/”（约 5GB）与 scripts/orchestrator/ 去留待用户决定。

## M3.5 整体目检与文档收口（2026-08-10）

- 目检范围：`npm run dev` 全功能走查（M3.5 新增功能 + 旧功能回归）。
- 用户反馈问题（详见 `docs/reports/2026-08-10-M3.5-整体目检与优化方案.md`）：
  1. 全局快捷键功能冗余（可考虑去除）
  2. 人格模板文字描述过多
  3. 系统状态小部件与“陪伴”定位不符（可考虑去除）
  4. 窗口贴边体验差
  5. 天气小部件缺乏实时自动更新的感知
  6. 导出对话应移入工具栏，工具栏需新增最小化按钮
  7. 窗口不可缩放；天气/系统状态小部件遮挡聊天；底部平台/版本信息多余
  8. 番茄钟结束后反复弹窗通知（疑似死循环）
  9. UI 大改列入待办
- 处置：`多线程开发/` 确认属于项目开发内容，暂时保留；`scripts/orchestrator/` 去留待用户决定；ADR-025 与优化方案已落盘，未开始实施。
- 文档收口：T-07 任务卡状态更新为“已完成”；PLAN/STATUS 时间戳与状态同步至 2026-08-10；T-24~T-32 任务卡与线程分配手册已创建。
- 用户确认（2026-08-10）：移除全局快捷键（T-29）、移除系统状态小部件（T-30）、贴边方案 B（T-31）；协调者按 ADR-026 冻结契约（新增 window.minimize、移除 window.setShortcutEnabled）。
- 执行安排（2026-08-10）：用户选择 T-24~T-31 全部并行开始；线程不自行合并 main、不自行 rebase，由协调者按回报顺序验收合并并解决共享文件冲突。

## M3.5 收尾优化合并记录（2026-08-10）

- T-27 番茄钟重复通知修复：34a2679
- T-24 窗口布局与可缩放：39aa346
- T-25 工具栏（导出 + 最小化）：01e35a8
- T-26 天气自动刷新增强：827abb6
- T-28 人格模板文案精简：0415d20
- T-29 全局快捷键移除：875150e
- T-30 系统状态小部件移除：4bbf6cb
- T-31 贴边方案 B：b8cd946
- 验证：8 个分支独立 `npm run check` 全部通过；合并后 main `npm run check` 通过；`npm run smoke` 通过（真实用户权限，含番茄钟幂等回归断言）。
- 说明：用户反馈 T-27 曾多开一个线程，但 reflog 显示该分支仅一次提交，未产生重复分支/重复实现，保留现有实现。
- 清理：8 个任务 worktree 已移除，分支保留；旧 M3.5 worktree（m3x-export/idle/memory-ui/mood-ui/stream/widgets）仍存在，是否清理待用户决定。
- 新增需求：TTS 专属语音包（ADR-027，T-33），待排期。
