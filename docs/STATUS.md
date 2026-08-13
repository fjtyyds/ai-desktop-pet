# 项目状态

- 更新时间：2026-08-13
- 当前阶段：M5.2 宠物浮窗增强——动画宠物包与任务级进度气泡（ADR-046）
- 当前任务：T-62/T-63 均已验收合并（0e9f5bd / a7b31d8）；待人工目检与 sync-latest
- 最近完成：T-63 任务级进度气泡验收合并（a7b31d8，main check/smoke 全绿）；T-62 动画宠物包验收合并（0e9f5bd）
- 下一步：用户 `npm run dev` 目检（pixel-pet 动画观感 + 任务气泡体验）→ sync-latest 同步最新版 → push 授权后推送
- 阻塞：无（商店/签名资金冻结仍按 ADR-041 处理）
- 最新版：`E:\codex\AI桌宠最新版`（scripts/sync-latest.ps1 自动同步，当前 0.1.0 @ 5da29f6；M5.2 完成后更新）
- 交接提示：新会话先读 `AGENTS.md` → `PLAN.md` → `docs/STATUS.md` → `docs/reports/2026-08-10-工作对接方案.md` → 自己的任务卡（docs/tasks/T-xx.md）

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

## T-33 合并记录（2026-08-10，项目内线程闭环）

- 派发：新总工按闭环 SOP 用 `send-prompt --project E:\codex\AI桌宠` 派发 T-33；worker 线程 16:15 开工、16:20 完成；watcher 16:21 打开并收录反馈（摘要置顶）。
- 分支：codex/m3x-tts-voice（e73fd89，基线 main 0eae4d0），fast-forward 合并入 main。
- 实现：6 套人格（warm/sage/playful/gentle/cool/curious）各配 voice 偏好 + pitch/rate；朗读按 personaTemplate 自动应用，显式选择优先；设置页开关（默认开）与下拉（自动跟随人格 + 6 套固定选择）；关闭回退系统默认 TTS。
- 契约：不改 petAPI；store 仅新增协调者预确认的 `ttsVoicePackEnabled`（bool，默认 true）与 `ttsVoicePackId`（≤40 字符，空=跟随人格）。
- 验证：worker `npm run check`、`npm run smoke` 通过；临时无头 UI 校验 10 项通过；协调者复核 main `npm run check` 全部通过；朗读听感待人工目检。
- 清理：worktree E:\codex\AI桌宠-m3x-tts-voice 已移除，分支保留。

## T-32 关闭记录（2026-08-10）

- 用户决定：`scripts/orchestrator/` 不入库（ADR-028）。
- 处置：保留为本地未跟踪目录；T-32（orchestrator 缺陷修复）不派发、不实施，任务卡标记已关闭。
- 影响：项目路线图不再包含 orchestrator 修复；后续若需自动化闭环能力，另行评估。

## T-37 合并记录（2026-08-10，项目内线程闭环）

- 派发：总工按闭环 SOP 用 `send-prompt --project E:\codex\AI桌宠` 派发 T-37；worker 完成并回报（分支 codex/m3x-autoupdate @ 4ec503a，基线 main fc8a036）。
- 实现：新增 src/main/updater.js（electron-updater 封装：checkForUpdates、update-available/not-available/download-progress/update-downloaded/error、quitAndInstall、日志双写）；main.js 仅 app.isPackaged 时初始化并在启动 3s 后延迟检查，before-quit 执行 quitAndInstall；tray.js 增加“检查更新/Check for Updates”；zh-CN/en 增加 updater.* 文案；check.js 增加 T-37 断言。
- 验证：worker 与协调者 `npm run check` 全部通过；`npm run smoke` 通过（渲染页加载/历史恢复/番茄钟幂等/chat 端到端）；事件链路模拟与打包 app-update.yml 生成确认由 worker 完成。
- 合并：4ec503a fast-forward 合并入 main；worktree E:\codex\AI桌宠-m3x-autoupdate 已清理，分支保留。
- 遗留风险：artifactName 含非 ASCII（AI桌宠）时 latest.yml 引用安全化文件名与真实产物不一致，更新源将 404；已建 T-38 修复，发布前必须完成。

## T-38 合并记录（2026-08-10，项目内线程闭环）

- 派发：总工按闭环 SOP 派发 T-38（发布产物命名 ASCII 化）；worker 完成并回报（分支 codex/m4-artifact-name @ 3315146，基线 main a34593f）。
- 实现：electron-builder.yml 的 nsis.artifactName 改为 `ai-desktop-pet-${version}-Setup.${ext}`（productName 保持 AI桌宠）；check.js 增加 T-38 断言（artifactName 纯 ASCII、productName 不变、dist 产物与 latest.yml 引用静态比对）。
- 验证：worker 与协调者 `npm run check` 全部通过（含静态比对）；`npm run smoke` 通过；本地 `npm run dist -- --publish never` 产出 ai-desktop-pet-0.1.0-Setup.exe（100,568,284 B）与 blockmap，latest.yml 的 url/path 与实际产物完全一致。
- 合并：3315146 fast-forward 合并入 main；worktree E:\codex\AI桌宠-m4-artifact-name 已清理，分支保留。
- 遗留风险：真实更新链路（electron-updater 从 GitHub Releases 拉取）需首次 v 标签发布后才能端到端验证；push/tag 属远程操作，待用户确认。

## T-39 合并记录（2026-08-10，项目内线程闭环）

- 派发：总工按闭环 SOP 派发 T-39（M4 P4 最终打包与安装冒烟）；worker 完成并回报（分支 codex/m4-final-dist @ 0a8f8bc，基线 main 2ebb122）。
- 实现：scripts/check.js 追加 T-39 断言（win-unpacked app-update.yml 存在且 provider/owner/repo 指向 github/fjtyyds/ai-desktop-pet）；任务卡完成记录。
- 验证：worker 与协调者 `npm run check` 全部通过（含 T-38/T-39 断言）；`npm run smoke` 通过；`npm run dist -- --publish never` 成功，产物 ai-desktop-pet-0.1.0-Setup.exe（100,568,325 B）+ blockmap，latest.yml 引用与实际产物一致；app-update.yml 指向 GitHub；静默安装/卸载退出码 0，安装版以临时 userData 启动正常、真实 %APPDATA%\AI桌宠 零污染；安装版更新检查实测“No published versions”（证明更新源已生效）。
- 合并：0a8f8bc fast-forward 合并入 main；worktree E:\codex\AI桌宠-m4-final-dist 已清理，分支保留。
- 遗留风险：真实更新下载/安装链路需首次 v0.1.0 发布（v 标签 + Release，push/tag 属远程操作，待用户确认）；正式代码签名/商店渠道待 M4 P2（SmartScreen 可能提示未知发布者）。

## 目录规范化与归档记录（2026-08-11，ADR-033）

- 移除 6 个已合并 M3.5 worktree（分支保留）：m3x-export/idle/memory-ui/mood-ui/stream/widgets。
- 归档至 `E:\codex\_archive_20260811\`（可恢复，未物理删除）：多线程开发-20260811（约 5GB，12 个 M1~M3 副本）、AI桌宠-m3x-stream-leftover、AI桌宠-m3x-weather-refresh、AI桌宠测0.1.0、probe-artifacts-20260811（探针/音频）、.orchestrator-logs。
- scripts/orchestrator/ 保留本地并加入 .gitignore（ADR-028 延续）。
- 结果：git 工作区干净，worktree 仅剩 main；项目根目录仅源码/文档/配置。

## 商业化上线方案（2026-08-11，ADR-032）

- 调研与方案：`docs/reports/2026-08-11-商业化上线方案.md`（含 20+ 组市场数据来源、竞品分析、优势功能、UI 依据、盈利模式、财务预测与 30 天上线计划）。
- 任务卡：T-40 许可证、T-41 支付、T-42 遥测、T-43 皮肤市场、T-44 UI 大改、T-45 官网/分享、T-46 商店发布准备。

## T-42 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-telemetry @ fd0b3a3（fast-forward 合并）：src/main/telemetry.js 新增；IPC/preload/main/渲染层/设置页/引导接线；store 白名单 telemetryEnabled（默认 false）；check.js 静态+运行时断言。
- 安全验证：上报端点仅由环境变量 AI_PET_TELEMETRY_ENDPOINT 配置、默认空串不发送、无内置真实端点；事件/字段白名单脱敏（无消息正文/apiKey/绝对路径）；一键关闭清除；未向任何真实外部端点发送数据。
- 验证：worker 与协调者 check/smoke 全绿；Electron 端到端（本地端点）验证通过。
- 遗留：license_state_change 埋点待 T-40 合并后接线。

## T-43 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-skins @ 29548a4（merge 到 df99fa2，5 个共享文件冲突已解决）：src/main/skin-store.js、3 套内置默认皮肤、skin:* IPC、设置页“皮肤与配件”子页与 pet-avatar 切换；格式文档 docs/reports/2026-08-11-皮肤包格式.md。
- 安全验证：zip 校验拒绝缺清单/exe/js/超 10MB/路径跳转/加密包；无 child_process/eval/Function 等代码执行机制；内置皮肤不可移除。
- 验证：worker 与协调者 check/smoke 全绿；端到端导入→应用→导出→重导入一致。

## T-40 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-license @ 6ac339b（merge 到 dece63a，3 个共享文件冲突已解决）：src/main/license.js 新增；license:* IPC；设置页“账户/订阅”区块、Pro 门控、首次启动年龄+合规弹窗；store 白名单 licenseTier/licenseKey/licenseExpiresAt/deviceId/complianceAccepted。
- 验证：三态切换持久化、激活码/订单号 mock、过期/吊销/设备绑定、云额度（BYOK 不消耗）、门控与合规弹窗（拒绝后 AI 对话停用）；worker 与协调者 check/smoke 全绿。
- 遗留：真实支付与订单服务端校验待 T-41；license_state_change 遥测埋点已由 T-42 预留，合并后已可接线。

## T-41 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-payment @ 16753c2（fast-forward 合并）：src/main/payment.js 新增；license.js 支付升档/降级联动；payment:create-order/payment:mock-callback IPC/preload；订阅页价格展示与“沙箱购买”按钮；双语文案与 check 断言。
- 安全验证：凭证仅环境变量读取、零硬编码密钥、无真实网关地址/网络请求；非 sandbox 模式拒绝操作；沙箱下单→回调→升档→幂等→验签拒绝→退款降级全链路通过。
- 验证：worker 与协调者 check/smoke 全绿；与 T-44/T-45 合并后复跑 check/smoke 全绿。

## T-45 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-marketing @ f05bd9c（merge 到 c2d89b8，chat.js 导出区冲突按功能共存解决）：分享按钮/菜单、消息长按/右键唤起、Canvas 对话卡片（脱敏、PNG 校验、文件名清洗）、website/ 静态落地页、docs/marketing 社媒素材、check 断言。
- 验证：worker 与协调者 check/smoke 全绿；与 T-41/T-44 合并后复跑 check/smoke 全绿。
- 说明：main 工作区曾存在本卡未提交版本，已 stash 保护并与合并结果核对一致。

## T-44 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-ui @ f1baf8f（merge 到 c6adbe5，chat.js 元素引用/导出区冲突按功能共存解决）：深色玻璃拟态+浅色主题持久化、角色呼吸/眨眼/情绪联动微动画、效率小组件（专注统计/喝水提醒/待办）、减弱动效开关、无障碍回归断言。
- 验证：worker 与协调者 check/smoke 全绿（含 WCAG 对比度断言）；与 T-41/T-45 共存复跑全绿。
- 说明：T-44 在 main 工作区直接提交（异常，未建独立 worktree），已按交接流程将 T-45 残留改动 stash 保护后合并；stash@{0} 与最终合并结果逐文件核对一致，无内容丢失。
- 遗留：UI 观感需人工 `npm run dev` 目检。

## T-46 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-store @ 74e8a30（fast-forward 合并）：docs/store/steam-storekit.md、msstore-kit.md（素材清单/文案/规格/提审待办）、code-signing-eval.md（OV/EV/Azure 对比与推荐）、cloud-sync-eval.md（威胁模型/加密/成本/ADR-035 草案）、scripts/release-dryrun.ps1（本地演练，零远程副作用）、任务卡完成记录。
- 验证：worker 与协调者 check/smoke 全绿；Release 演练（完整构建 + -SkipBuild）PASS；合并后 main 复跑全绿。
- 说明：首次派发线程（019fee79）开工 27 秒后被中断并归档（反馈收集跳过归档线程），已用新线程重新派发完成；本卡为重新派发的产物。
- 遗留：v1.0 发布（push/tag/Release）、商店注册与预算、MSIX 技术验证、签名采购需用户确认后实施；云同步按 ADR-035 草案 v1.0 不实施。

## v0.1.0 Release 记录（2026-08-11）

- 用户授权“自动执行”发布后：main 推送（fc8a036..935dbb3）→ 创建并推送 tag v0.1.0 → CI（check/smoke/dist/release）全绿。
- Release：https://github.com/fjtyyds/ai-desktop-pet/releases/tag/v0.1.0（非草稿、非预发布），资产 ai-desktop-pet-0.1.0-Setup.exe（100,615,906 B）、blockmap（105,784 B）、latest.yml（357 B）。
- 意义：自动更新源首次生效；真实更新下载/安装链路待 v0.1.1 或 v1.0 发布后端到端验证。
- 遗留：SmartScreen 首次发布可能提示未知发布者（签名采购待确认）；商店渠道（Steam/MS Store）素材已就绪，注册与提审待用户资质与预算。

## T-47 合并记录（2026-08-11，项目内线程闭环）

- 分支 codex/m4-msix @ 2fea42e（merge 到 a723513）：docs/store/msix-validation.md 新增验证报告（electron-builder MSIX 支持现状、工具链要求、8 项沙箱兼容性风险、推荐 MSIX+NSIS 并存 3.5~5.5 人日、风险清单）；任务卡完成记录。
- 验证：worker 与协调者 check 全绿；合并后 main check/smoke 全绿。
- 说明：任务卡 add/add 冲突（main 前进入库 vs 分支完成记录）按分支版本解决；分支未触碰任何禁止文件。
- 遗留：MSIX 实施需批准 electron-builder 27 alpha 依赖升级；Store 提审需用户账号/预算；托盘/通知需真实安装包验证。

## T-48 建卡记录（2026-08-11）

- 用户最新请求：设置界面布局重构，参考两张豆包设置页截图（OCR 描述见交接文件 20260811-1301）；注意上下文过长时总工交接。
- ADR-036 落盘；任务卡 docs/tasks/T-48.md 入库；worktree E:\codex\AI桌宠-m4-settings-layout 与分支 codex/m4-settings-layout 已创建（基线 main 2938cb0）。
- 设计：顶部账号卡片（复用 account-section）+ 外观/对话/陪伴与效率/隐私与数据 四组分组列表 + 底部版本页脚；保留全部元素 id 与既有功能。

## T-48 合并记录（2026-08-11，项目内线程闭环）

- worker 完成并回报（分支 codex/m4-settings-layout @ 7b448cf，基线 main 0c95bb3）：settings-home 重构为三段式——账号卡片（account-card + account-upgrade-btn“升级/激活”入口）、四分组列表（settings-groups，行=图标+组名+箭头，aria-expanded/aria-controls，默认收起）、底部固定保存栏 + 版本页脚（settings-version + “由 DeepSeek 大模型提供支持”）；47 个既有元素 id 与事件全部保留；皮肤/记忆跳转行进入既有子页；zh-CN/en 新增 8 个文案 key；check.js 新增 T-48 断言。
- 验证：worker 与协调者 check/smoke 全绿；worker 离屏 DOM 验证（分组展开/收起、版本号 0.1.0、保存端到端）通过；fast-forward 合并入 main（7b448cf），worktree 已清理，分支保留。
- 遗留：分组默认收起；升级按钮当前为滚动聚焦激活码输入框；视觉效果待用户 dev 目检确认。

## T-49 建卡与合并记录（2026-08-11）

- 来源：用户与 T-48 线程直接交流改进方案（超出 T-48 卡边界），worker 提交 d0fbc70（分支 codex/m4-widget-mood，在 main 工作区直接开发，流程违规）。
- 内容：天气（折叠高约 31px）与番茄钟（高约 61px）紧凑化；情绪默认 60→52（平静）、反馈 ±8→±12（上限 24）、无交互回归后确定性小幅呼吸（±5/±0.05，4 分钟周期）。
- 验证：worker 与协调者 check/smoke 全绿；元素 id 保留；52 落在“平静”区间；离屏 DOM 尺寸实测通过。
- 处置：主工作区已恢复 main；ADR-037 + 任务卡 T-49 入库；分支 rebase 后 fast-forward 合并（026c1c5）；无 worktree 需清理。
- 纪律重申：任何任务必须独立 worktree 开发，main 工作区保持 main（T-44/T-45 同类问题第三次发生，已记录）。

## T-50 建卡记录（2026-08-11）

- 用户反馈：①账户与订阅要与其他设置项外观一致（不要单独占大块）；②番茄钟没用，删除。
- ADR-038 落盘；任务卡 docs/tasks/T-50.md 入库；worktree E:\codex\AI桌宠-m4-account-pomodoro 与分支 codex/m4-account-pomodoro 已创建（基线 main ec57384）。
- 范围：账户区改为分组行（第一组，保留全部 id/功能）；番茄钟全链路移除（渲染层/store/主进程通知/遥测/license/文案/check/smoke）；专注统计组件保留（数据源移除后不再增长，另行说明）。

## T-50 合并记录（2026-08-11，项目内线程闭环）

- worker 完成并回报（分支 codex/m4-account-pomodoro @ 714b706，基线 main ff51bec）：account-section 改为 settings-groups 第一组（行式分组，aria 完整，account-upgrade-btn 保留，license/payment id 全保留）；番茄钟全链路移除（面板/设置/store 字段/主进程轮询与系统通知/telemetry 事件/license 权益/文案/check/smoke）。
- 验证：worker 与协调者 check/smoke 全绿（含“番茄钟已移除”断言与存量字段清理断言）；fast-forward 合并入 main（714b706），worktree 已清理，分支保留。
- 兼容：存量 settings.json 的 pomodoro 字段在读写时删除（不迁移）；focusStats 保留但不再增长（ADR-038）。
- 遗留：chat.js 两处历史注释仍提及番茄钟（无功能影响）；视觉效果用户已目检确认（2026-08-11 14:17，效果可以）。

## T-51 建卡记录（2026-08-11）

- 用户授权依次解决待办清单；专注统计去留决策为整体移除（ADR-039）：唯一数据源（番茄钟）已删，组件永不增长，保留会误导用户。
- 范围：focus-widget/chat.js 逻辑/store 字段/license 权益/双语文案/check-smoke 断言全链路移除；喝水提醒与待办保留；存量 focusStats 字段读写时删除。
- 任务卡 docs/tasks/T-51.md 入库；worktree E:\codex\AI桌宠-m4-focus-stats 与分支 codex/m4-focus-stats 已创建（基线 main 41cc892，已推送 origin）。

## T-51 合并记录（2026-08-11，项目内线程闭环）

- worker 完成并回报（分支 codex/m4-focus-stats @ 1e9d73e，基线 main 87cf5a5）：专注统计全链路移除（index.html #focus-widget 与 license-feature-focus、chat.js focus 专属函数/导出/读写、chat.css .focus-* 样式、store focusStats 字段与存量清理、license 权益、双语文案、check 断言改写为“已移除”语义）；待办/喝水组件保留。
- 验证：worker 与协调者 check/smoke 全绿；fast-forward 合并入 main（1e9d73e），worktree 已清理，分支保留。
- 兼容：存量 settings.json 的 focusStats 字段读写时删除（不迁移、不暴露，ADR-039）。

## T-52 建卡记录（2026-08-11）

- 用户批准 MSIX 依赖升级；electron-builder 升级至 27.0.0-alpha.6（dd29cc5，ADR-040）。
- 范围：electron-builder.yml MSIX 配置（nsis 并存）、updater.js process.windowsStore 守卫、appx logo 占位资源、本地双产物构建验证；商店注册/提审待用户账号与预算。

## T-52 合并记录（2026-08-11，项目内线程闭环）

- worker 完成并回报（分支 codex/m4-msix-impl @ 919d837 + 4dddec5，基线 main 324c1f7）：electron-builder.yml 增加 msix 目标（x64，nsis 并存；identityName/publisher 占位、zh-CN/en-US、四段版本、msixupload）；updater.js `process.windowsStore` 守卫；tray.js 商店版“检查更新”提示走 Store；appx 4 个 logo 占位；check.js 新增 T-52 断言并兼容 electron-builder 27 的 latest.yml 列表格式。
- 验证：worker 与协调者 check/smoke 全绿；dist 双产物实测（MSIX 150.5MB/msixupload 150.3MB/NSIS 108.7MB+blockmap+latest.yml 引用一致）；守卫 stub 验证 0 初始化/0 调用；AppxManifest 核验通过；工具链自动下载用户态缓存（无系统级安装）；fast-forward 合并，worktree 已清理，分支保留。
- 遗留：alpha 能力待 27 稳定版重测；占位身份待商店账号回填；真机 MSIX 安装/签名待 T-46/T-47 范围执行。

## T-53 建卡记录（2026-08-11）

- 来源：其他项目线程排查音频时发现本应用日志报 `stopDockPolling is not defined`（最小化窗口时触发）；协调者核实 src/main/main.js:497 调用但全仓无定义（T-25 遗留，T-31 改为 move 防抖后无轮询机制）。
- 修复方向：minimize 处理器清理 dockMoveDebounceTimer（定义 stopDockPolling 或直接 clearTimeout），check.js 增加“调用存在定义”断言。

## T-53 合并记录（2026-08-11，项目内线程闭环）

- worker 完成并回报（分支 codex/m4-dock-fix @ 70a5b75，基线 main 23a6e3d）：方案 a 定义 `stopDockPolling()`（clearTimeout(dockMoveDebounceTimer)，保留 T-25 最小化语义与注释）；check.js 新增递归扫描防回归断言（调用必须有函数声明/定义）。
- 验证：worker 与协调者 check/smoke 全绿；fast-forward 合并入 main（70a5b75），worktree 已清理，分支保留。
- 遗留：无；最小化窗口 ReferenceError 已消除。

## 待办清单收口记录（2026-08-11，ADR-041）

- 用户决策（15:07）：①商店/签名暂无资金支持，冻结；②归档目录 E:\codex\_archive_20260811\ 暂时保留；③TTS 听感维持现状；④T-44 UI 目检通过；⑤v1.0 发布是资金事项的延续，暂缓。
- 影响：无自主可派发卡；闭环 watcher 保持运行；资金到位或用户提供新需求后恢复派活。
- GitHub Release（免费路径）不受资金影响，仍待用户授权（push/tag/Release 边界）。

## 最新版同步机制记录（2026-08-11，ADR-042）

- 用户要求生成可复制的最新版本目录并随每次项目调整更新；新建 scripts/sync-latest.ps1（构建 + 同步 NSIS/MSIX 产物 + 生成 README/latest.json 清单）与 README 模板 docs/templates/latest-version-readme.md。
- 首次执行：main f5ffa63 构建成功（NSIS 103.70MB、MSIX 143.50MB、msixupload 143.31MB），已同步到 E:\codex\AI桌宠最新版；latest.yml 引用与实际产物一致；安装包已含 T-53 修复。
- 协议：每次 main 合并验收后由协调者运行同步脚本（已写入 AGENTS.md 常用命令与验收要求）。
- 备注：首次运行因 PS 5.1 按 GBK 解析无 BOM 脚本误建乱码目录，已重命名为 E:\codex\_stale-sync-mojibake-20260811（约 390MB 产物副本，可恢复；物理删除被环境策略拦截，待手动）。

## T-54 建卡与验收合并记录（2026-08-11，ADR-043）

- 背景：生产 UI 残留开发/测试痕迹（设置页沙箱支付区块、mock 激活码/订单号激活区）；首次引导仅对全新 userData 可见，覆盖安装的已有用户无法回看；check.js 仍要求 UI“必须包含”这些测试桩 token。
- 实施（worker 019ff0ae，codex/m4-newuser）：移除沙箱支付区块与 mock 激活 UI，替换为“Pro 会员即将上线”占位；新增设置页“重新查看新手引导”入口（复用 showOnboarding，不重置语言/API Key/人格）；check.js 改为“不得包含”防回归断言；smoke.js 新增全新档案首启断言。
- 验收：check/smoke 全绿（协调者复跑）；renderer/locales 无测试桩 token（rg 零命中）；主进程未动；真窗口验证首启可达与重新查看入口生效。
- 合并与同步：5da29f6 fast-forward；scripts/sync-latest.ps1 已更新 E:\codex\AI桌宠最新版（0.1.0 @ 5da29f6）。
- 待用户：安装最新版验证（新用户引导 + 设置页重新查看入口 + 无测试痕迹）。

## T-55 建卡与实施记录（2026-08-13，ADR-044）

- 背景：用户希望 AI 桌宠具备 Codex “显示宠物”功能（独立悬浮宠物 + 工作状态气泡 + 自定义宠物包）。
- 实施（codex/m5-pet-overlay，复用 E:\codex\AI桌宠-m4-newuser 工作树）：新增宠物浮窗（src/main/pet-overlay.js + src/renderer/overlay.html/css/js），设置页“外观”组开关与“显示/隐藏宠物”入口、托盘菜单、`/pet` 命令；状态机 idle/working/ready/failed 由聊天页驱动；skin-store 支持 Codex 宠物包（pet.json + spritesheet.webp，8×9 图集，WebP 尺寸校验）；petOverlayEnabled/petOverlayBounds 持久化；双语文案与 check/smoke 断言（含 WebP 解析、宠物包导入/拒绝、浮窗端到端）。
- 验证：npm run check 全绿；npm run smoke 全绿（浮窗状态/皮肤/气泡端到端）；离屏像素验证浮窗气泡与角色区域实际渲染。
- 合并与复验：cb92ec0 fast-forward 合并入 main；main `npm run check`、`npm run smoke` 复跑全绿。
- 待办：人工 `npm run dev` 目检浮窗观感；按 ADR-042 同步最新版（如需）。

## T-56~T-61 建卡与方案记录（2026-08-13，ADR-045）

- 用户要求：T-55 只是起点，先拟定宠物浮窗优化方案，再自动化完善（注意总工交接与任务分配；上下文上限已调高至 500k）。
- 方案：docs/reports/2026-08-13-宠物浮窗优化方案.md + 线程分配手册（docs/reports/2026-08-13-宠物浮窗优化-线程分配手册.md）。
- 预冻结（总工先改）：store.js 新增 petOverlayBubbleSeconds（默认 6，3~20）/petOverlayBubbleEnabled（默认 true）/petOverlayReminders（默认 true）/petOverlayBounds.displayId；contracts.js 补 petAPI.petOverlay.showMain/pushBubble/getConfig 契约说明。
- 任务：T-56 交互增强、T-57 状态机与气泡队列、T-58 情绪与动画联动（批次 1）；T-59 皮肤体验、T-60 系统与性能、T-61 设置与引导（批次 2）。
- 待办：批次 1 派活 → 验收合并 → 批次 2 → 全部完成后目检 + sync-latest。

## T-56~T-61 合并记录（2026-08-13，M5.1 完成）

- T-58 eea3c71、T-57 d3a0dca、T-56 17a82c1（批次 1）fast-forward 合并；T-60 76e7c27、T-61 ee95481（批次 2）fast-forward 合并；T-59 efc7173 以 8c5df99 合并（check/smoke 冲突块经总工机械合并解决，两侧断言均保留）。
- 主进程/渲染层：浮窗新增 showMain/toggleMain、右键菜单、Esc 收起、贴边吸附、多显示器位置记忆、状态事件推送（5s 心跳兜底）、隐藏暂停动画；状态机扩展 speaking/attention + 气泡队列（≤3 条，3~20s 可配）；情绪驱动 waving/jumping/waiting 动画行；Codex pets 目录扫描批量导入 + 9 行预览 + 错误分组；设置页气泡开关/时长/提醒透出 + 首次开启引导气泡。
- 验证：main `npm run check` 全绿（T-56~T-61 断言）；`npm run smoke` 全绿（各卡端到端）。
- 说明：子代理派发存在消息投递异常（t56/t57/t60/t61 未收到任务正文，t59 正常完成），未收到的卡由总工直接实施；已写入分配手册与交接文件。未 push（远程操作待用户授权）。
- 待办：用户 `npm run dev` 目检浮窗新交互；sync-latest 同步最新版。

## T-56 追加修复 + Computer Use 实测记录（2026-08-13）

- Computer Use 实测（@oai/sky + 项目 cua 封装）：`/pet` 唤起浮窗 ✓、浮窗可访问性树 ✓、✕ 按钮收起 ✓、Esc 收起 ✓、双击宠物隐藏/唤回主窗口 ✓（修复后）。
- 发现并修复真实 bug：浮窗宠物区域原用 `-webkit-app-region: drag`，Chromium 吞掉点击/双击，导致 T-56“双击唤起主窗口”失效（实测 tuck ✕ 可点、双击无效）。修复为手动指针拖拽（pet:move-window IPC + moveBy），移除拖拽区，9bd451d 已合并 main；check/smoke 全绿（新增防回归断言：浮窗不得再使用拖拽区）。
- 待人工目检：右键菜单原生弹窗（computer use 无法枚举原生菜单/驱动键盘）；设置页控件与皮肤扫描的 UI 观感（smoke 已覆盖 DOM 级）。
- 说明：computer use 直连 sky 存在“同进程多窗口缓存互相覆盖”问题，后续测试优先用项目 cua 封装（cua.ps1）并以精确窗口标题（^AI 桌宠$）定位。

## T-62/T-63 建卡记录（2026-08-13，ADR-046）

- 用户拍板下一方向：动画宠物包（内置像素小宠 + 可复用生成脚本）与任务级进度气泡（标题/阶段/百分比/结果）。
- 契约冻结：`petAPI.petOverlay.startTask/updateTask/finishTask/getConfig`、IPC `pet:task-start/update/finish`；`pet:status-updated` payload 增加 `task` 字段（无任务为 null）；字段约束 id≤64、title/message≤80、percent 0~100。
- 派发：t62_animpack（codex/m5x-animpack / E:\codex\AI桌宠-m5x-skin）、t63_taskbubble（codex/m5x-taskbubble / E:\codex\AI桌宠-m5x-settings）。

## T-62 验收合并记录（2026-08-13）

- 实施（子代理 t62_animpack，0e9f5bd）：`scripts/make-pet-pack.js`（Electron canvas 像素画生成器，隐藏窗口导出 1024×1152 spritesheet.webp 与 256×256 preview.webp，可复现）；内置 `pixel-pet` 包（pet.json + 图集，9 行状态与 overlay STATE_ROWS 对齐）；check.js 新增 T-62 断言。
- 验收：diff 边界仅卡内文件；worktree `npm run check`、`npm run smoke` 全绿；main 复跑全绿；0e9f5bd fast-forward 合并。
- 待人工目检：pixel-pet 动画观感（`npm run dev` 切换皮肤查看各状态行）。

## T-63 验收合并记录（2026-08-13）

- 实施（总工直接实施，a7b31d8）：`pet-overlay.js` 任务注册表（startTask/updateTask/finishTask + pet:task-* IPC + getConfig 补实现）；运行中任务气泡优先，pushBubble 排队、finishTask 后补放；字段清洗（id≤64/title≤80/percent 0~100）；`skin-store.scanCodexPetsDir` 两遍扫描 + 可选 onProgress；`ipc.js` 注入浮窗并包裹皮肤批量导入；`updater.js`/`main.js` 下载进度回调 → 浮窗任务气泡（仅打包版触发）；overlay 进度条渲染（含不确定进度与 reduceMotion）；双语文案；check/smoke 断言。
- 验收：worktree 与 main `npm run check`、`npm run smoke` 全绿（含 T-63 端到端：start→update→finish、进度条、提醒补放、getConfig）；a7b31d8 fast-forward 合并 main。
- 说明：子代理 t63_taskbubble 在等待中断前未留下提交，按交接纪律改总工直接实施；修复一次 catch 变量作用域回归（T-59 扫描导入）。
- 待人工目检：任务气泡观感（皮肤页批量导入宠物包时观察进度条；更新下载仅打包版可见）。
