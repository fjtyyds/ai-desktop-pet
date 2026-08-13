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

## ADR-010：M2 记忆模型——短期窗口 + 长期事实记忆（本地 JSON）

- 状态：Accepted
- 背景：M1 仅持久化 messages.json 全量消息；M2 要求“重启后记得关键上下文”。全量历史直接入 Prompt 会超长且成本高，需要短期窗口与可检索的长期事实。
- 决策：
  - 消息升级：每条消息带 sessionId 与 timestamp，旧数据兼容（缺省 sessionId='default'）。
  - 短期记忆：最近 N 条消息窗口，默认 N=20（`contracts.DEFAULT_SHORT_TERM_WINDOW`）。
  - 长期记忆：`src/storage/memory-store.js` 管理 memories.json，条目 `{id, content, sessionId, createdAt, updatedAt, lastUsedAt}`；由聊天服务在对话后异步调用 LLM 抽取关键事实（失败不阻塞回复）。
  - 检索：MVP 用“最近使用时间 + 关键词匹配”的简单相关度，最多取 3 条注入上下文（`contracts.MAX_MEMORIES_IN_CONTEXT`）；不引入向量库。
  - petAPI 新增 `history.get()`：渲染层启动时恢复历史显示。
- 后果：无新增依赖、完全本地；长期记忆质量取决于抽取 prompt；后续需要语义检索时再评估向量存储（修订本 ADR）。

## ADR-011：M2 人格与情绪

- 状态：Accepted
- 背景：M1 只有 petName，回复无角色一致性；“桌宠”需要有可配置人格与可感知的情绪状态。
- 决策：
  - 人格：`settings.persona = { traits: string[], tone: string, backstory: string }`，默认内置“热情友善的 AI 桌宠”；M2 设置页至少开放 traits/tone 输入。
  - 情绪：`src/llm/mood.js` 纯函数状态机，valence 0-100 + 强度，按交互更新（积极/消极反馈、长时间无交互缓慢回归默认），生成情绪描述词。
  - system prompt 由 `src/llm/persona.js` 的 `buildSystemPrompt({ settings, mood })` 生成，由 T-07 注入。
  - 情绪 MVP 仅存内存、不持久化（避免跨线程文件冲突与复杂度）；持久化放到 M2.1 评估。
- 后果：回复风格可配置且有状态；mood 更新需限幅防抖；情绪不跨重启保持（不在 M2 验收内）。

## ADR-012：M2 上下文组装与渲染层历史恢复

- 状态：Accepted
- 背景：M1 的 chat.send 由渲染层传 history 且启动时不显示历史；“记得关键上下文”需要主进程统一组装。
- 决策：
  - chat service 组装 messages：`[system(persona+mood)] + 短期窗口（最近 N 条） + 长期记忆（<=3 条，标注为记忆） + 当前用户消息`。
  - chat.send 保持 `{ text, history? }` 兼容；history 缺省时由主进程从 storage 读取，渲染层不再传全量历史。
  - 每轮成功后：追加消息到 storage；异步触发记忆抽取（失败仅记录，不阻塞 UI）。
  - 渲染层 init 时调用 `petAPI.history.get()` 恢复历史气泡。
- 后果：主进程持有完整对话状态，渲染层更薄；历史恢复补齐 M1 遗留缺口。

## ADR-013：设置页接入 petAPI.settings 并持久化人格（M2 补全）

- 状态：Accepted
- 背景：M2 逻辑层已支持 settings.persona（ADR-011），但设置页仍是 M1 的 localStorage 骨架，`store.writeSettings` 只允许 apiKey/model/petName，用户无法配置人格，SPEC“人格可配置且影响回复”的验收未达成。
- 决策：设置页迁移到 `petAPI.settings.get/set`；`store.writeSettings` 允许 persona 字段并清洗（traits 为字符串数组、tone/backstory 为字符串，非法值丢弃或截断）；localStorage 仅作 petAPI 缺失时的降级。
- 后果：人格设置跨重启生效并进入 system prompt；settings.json 增加 persona 字段；旧 localStorage 数据不再作为主存储。

## ADR-014：任务拆分必须按用户故事覆盖全触点（M2 复盘）

- 状态：Accepted
- 背景：M2 拆卡时把 T-05/T-06/T-07 按“存储/IPC、LLM 逻辑、上下文组装”分层分配，遗漏了 SPEC 用户故事“用户可在设置中配置人格”的完整触点（设置页 UI 与 `writeSettings` 白名单），导致 T-08 只能在集成后补建。根因：
  1. 按层拆分时，设置页（renderer）与设置持久化（store.js）恰好落在所有卡的“禁止触碰”里，没有归属；
  2. 契约冻结只覆盖类型/接口（Persona、settings.persona），未核对运行时接线（writeSettings 白名单、设置页字段）；
  3. SPEC 级验收项只挂在“协调者人工目检”，没有分配到具体任务卡；
  4. 并行边界规则阻止线程顺手补缺，而任务卡也未要求回报“无人认领的功能触点”。
- 决策：后续拆卡前先列出 SPEC 用户故事并逐条映射到任务卡，生成触点清单（UI/存储/IPC/逻辑）确认归属；契约冻结必须包含运行时行为断言（如 writeSettings 白名单、设置页字段）；SPEC 级验收项必须落到具体任务卡；任务卡增加“发现边界外缺口立即记录并回报”的要求。
- 后果：拆卡工作量略增，但能避免“集成后才发现用户故事没做完”的返工；ADR-005 的并行模式保持有效。

## ADR-015：设置页补 API Key 与模型输入（常开真实模式）

- 状态：Accepted
- 背景：SPEC MVP 用户故事 3 要求“用户可在设置中配置 API Key、模型”，但设置页只有宠物名与人格；provider/store 已支持从设置读取 apiKey/model，真实模式只能靠环境变量 `DEEPSEEK_API_KEY` 启动，日常使用不便。
- 决策：设置页新增 API Key（密码框）与模型输入，经 `petAPI.settings.get/set` 读写；`store.writeSettings` 对 apiKey/model 增加长度清洗（如 apiKey ≤ 256、model ≤ 100，非法/超长丢弃或截断）；明文存储保持现状并在 UI 说明“密钥仅保存在本机”，加密/系统凭据管理列入 M3 评估；契约（contracts.js）不变。
- 触点清单（ADR-014）：UI=设置页表单（index.html/chat.js/chat.css）、存储=store.js 清洗与默认值、IPC=已存在 settings.get/set（只读）、校验=scripts/check.js 断言。
- 后果：双击快捷方式即可真实对话，无需环境变量；API Key 仍明文保存在本地 settings.json（MVP 已知限制，已注明）。

## ADR-016：M3 打包与正式图标（electron-builder + NSIS）

- 状态：Accepted
- 背景：M3 需要可分发安装包；当前无打包配置，应用/托盘图标为内嵌 base64 占位图。
- 决策：使用 electron-builder + NSIS 产出 Windows 安装包；新增 `assets/` 存放正式 icon.ico/icon.png，应用与托盘图标统一从 assets 读取（内嵌 base64 保留为开发回退）；`dist/` 输出加入 .gitignore；`package.json` 增加 build 配置与 electron-builder devDependency（依赖变更由协调者批准执行）。
- 触点清单：配置=package.json/electron-builder.yml、资源=assets/、校验=打包产物启动冒烟。
- 后果：产出可分发安装包；代码签名与商店渠道留待 M4 分发前处理。

## ADR-017：M3 崩溃上报与本地日志

- 状态：Accepted
- 背景：桌面应用崩溃后无痕迹，问题难以排查。
- 决策：main 进程启用 Electron `crashReporter` 写入本地 dump；`process` 未捕获异常与 `unhandledRejection` 写入 `userData/logs/app.log`；远程上报不绑定第三方，预留环境变量配置端点（默认关闭）。
- 触点清单：新增 src/main/crash.js、main.js 引入、.gitignore 忽略日志目录。
- 后果：崩溃可本地排查；远程上报留接口、默认不发送。

## ADR-018：M3 i18n 与无障碍

- 状态：Accepted
- 背景：界面与托盘菜单文案硬编码中文；无障碍（ARIA/焦点/对比度）未系统走查。
- 决策：新增 `src/shared/locales/zh-CN.json` 与 `en.json`，渲染层与托盘菜单文案经 locale 函数获取；语言默认跟随系统（非中文环境用 en），设置页提供语言选择并存入 settings；无障碍走查（ARIA、键盘焦点、对比度）作为验收项。
- 触点清单：渲染层 index.html/chat.js、托盘 tray.js、新增 locales、设置页语言选项。
- 后果：文案与逻辑解耦；en 为基础翻译质量，后续可完善。

## ADR-019：M3 API Key 加密存储（safeStorage）

- 状态：Accepted
- 背景：apiKey 目前明文存 settings.json（ADR-013/015 已知限制）。
- 决策：加密边界放在主进程：新增 `src/main/secure-settings.js`，用 Electron `safeStorage`（Windows DPAPI）加密 apiKey 后写入 store；读取时解密；旧明文 apiKey 首次读取自动迁移为密文；`safeStorage` 不可用时回退明文并告警；`store.js` 保持纯 JSON、不感知加密，便于纯 Node 测试。
- 触点清单：主进程加解密封装（新文件）、ipc.js 的 settings.get/set 接入、契约不变、校验=往返一致与迁移。
- 后果：密钥落盘为密文；解密仅在主进程；用户数据迁移到其他机器后 DPAPI 密文无法解密，需重新输入密钥。

## ADR-020：M3.5 内容增强计划（全量）

- 状态：Accepted
- 背景：M3 验收通过后，用户希望继续完善软件内容再进入 M4；共提出 13 项增强（流式回复、主动互动、情绪可视化、记忆管理页、首次引导、人格模板、贴边隐藏、位置记忆、全局快捷键、对话导出、系统状态、天气、语音/图片、番茄钟）。
- 决策：全部纳入 M3.5 内容增强批次；SPEC 非目标中的“语音输入/输出、任务提醒/日程”转为增强范围（移动端、皮肤市场、云账号仍为非目标）；执行分 5 个批次串行推进，每张卡按 ADR-014 触点清单拆解；语音/图片/天气设“技术验证门禁”——验证不通过则记录结论并降级或暂缓，不硬上。
- 触点清单：见各任务卡；涉及契约扩展的由协调者先冻结（ADR-022）。
- 后果：M4 分发顺延至 M3.5 完成后；范围变更已同步 SPEC。

## ADR-021：流式回复（SSE）与打字机体验

- 状态：Accepted
- 背景：当前对话整段等待返回，“活物感”不足；DeepSeek 接口兼容 OpenAI SSE。
- 决策：provider 增加 `stream:true` 的 SSE 解析；chat 服务以事件/回调输出增量；IPC 推送 `chat:chunk`/`chat:done`（或等效流式通道）；渲染层实现“正在思考…”与打字机效果，支持取消与超时；若 DeepSeek 实际不支持 stream，则回退非流式并在任务卡记录。
- 后果：回复体验显著提升；主进程需处理 SSE 缓冲、错误与半截 JSON。

## ADR-022：M3.5 契约扩展冻结（mood/memory/export/window）

- 状态：Accepted
- 背景：情绪可视化、记忆管理、对话导出、贴边/快捷键等需要渲染层访问主进程能力。
- 决策：契约扩展为 `petAPI.mood.get()`、`petAPI.memory.list()/delete(id)`、`petAPI.history.export()/clear()`、`petAPI.window.toggleDock()/setShortcutEnabled()`（以最终任务卡为准）；协调者先冻结契约再实施，任务卡只读。
- 后果：preload/ipc 同步扩展；并行任务以冻结契约为界。

## ADR-023：扩展能力范围与技术验证门禁（语音/图片/天气/番茄钟）

- 状态：Accepted
- 背景：语音输入输出、图片理解、天气小部件、番茄钟均属原 SPEC 非目标或依赖外部能力，风险高。
- 决策：纳入 M3.5 批次 5，但先做技术验证再实现：语音输入验证 Electron/Chromium 的 Web Speech API，语音输出验证系统 TTS；图片理解验证 deepseek-v4-flash 是否接受图片消息（不支持则记录并暂缓）；天气优先免费无密钥接口（如 Open-Meteo），否则改为用户配置 API Key；番茄钟用本地 Notification + 本地状态，无需联网。验证结论写入任务卡后按结论实施或降级。
- 后果：避免承诺无法交付；外部依赖（语音引擎/天气源）以验证结果为准。

## ADR-024：协调者操作防错清单（2026-08-10 复盘）

- 状态：Accepted
- 背景：近期协调过程中出现多次可避免的错误决策：① `git add -A` 把 5GB 未跟踪目录与实验产物纳入合并提交（两次 amend 才修复）；② 修复 orchestrator 时用 Node 直接 spawn `npm.cmd`，Windows 上报 EINVAL（未做行为验证，只做了语法检查）；③ 未提前核对 `codex exec` 实际参数（`--full-auto` 不存在），首轮失败后才从 help 发现；④ 单实例锁被不可见旧实例持有，先误判“无进程”并反复重启，过滤条件过窄；⑤ 子代理试点未先做最小投递探测，浪费三轮才证实消息不可达；⑥ 大目录“多线程开发/”出现后未立即加入 .gitignore；⑦ 自动化脚本审查未覆盖“空分支/残留分支”被误判为 already-merged 的边界。
- 决策：确立以下防错规则并持续执行：
  1. git 操作：禁止 `git add -A` / `git add .`，一律显式路径或 `git add -u`；暂存前先 `git status` 确认 untracked 内容；新出现的大目录立即决定忽略或清理。
  2. 子进程/跨平台：Windows 上启动 `.cmd` 必须经 `cmd.exe /c` 或 `shell:true`；关键改动必须做最小行为验证（不只看语法检查）。
  3. 外部 CLI/工具：采用前先验证实际接口（`--help`/doctor/dry-run），不假设旧参数；配置随验证结果调整。
  4. 进程与锁：按镜像名列进程，不使用过窄命令行过滤；单实例应用“起不来”先怀疑已有实例/锁；注意沙箱会话隔离导致进程不可见，必要时向用户确认托盘/任务栏。
  5. 委托/自动化通道：先做最小内容回显探测，成功后再全量试点；失败及时止损并记录。
  6. 自动化脚本审查：覆盖空分支、残留分支、resume、并发等边界；先 dry-run/selftest 再实跑。
- 后果：减少同类返工；本清单作为协调者长期执行规范，复盘结论同步到 PLAN.md。

## ADR-025：M3.5 整体目检结论与收尾优化方向（2026-08-10）

- 状态：Accepted（优化方向）；其中“全局快捷键/系统状态小部件移除”与“贴边交互预期”待用户最终确认后实施
- 背景：M3.5 十个功能合入后用户进行整体人工目检，反馈 9 类体验问题（详见 `docs/reports/2026-08-10-M3.5-整体目检与优化方案.md`）。
- 决策：
  1. 已定：导出对话移出设置页、改放工具栏；工具栏新增最小化按钮；移除界面底部平台/版本信息；窗口改为可缩放并调整布局，避免天气/系统状态小部件遮挡聊天；天气小部件加强自动刷新感知（缩短间隔、显示更新时间、失败重试）；番茄钟结束通知需排查并修复重复弹窗；UI 大改列入待办。
  2. 待确认：全局快捷键是否移除（倾向移除）；系统状态小部件是否移除（倾向移除）；贴边交互预期行为（自动隐藏 vs 靠边吸附）；人格模板文案精简幅度。
  3. “多线程开发/”（约 5GB，12 个 worktree 副本）确认为项目开发内容，暂时保留，不删除；`scripts/orchestrator/` 去留由用户决定，若入库须先修复已知缺陷。
- 后果：收尾优化按“一个会话一个任务”拆卡实施；涉及契约（如新增 `window.minimize`、移除 `window.setShortcutEnabled`）的变更需协调者先行修订 contracts.js/API.md 后再实施；UI 大改不进本批次，作为独立里程碑评估。

## ADR-026：收尾任务确认与契约变更（2026-08-10）

- 状态：Accepted
- 背景：用户确认三项收尾决策：① 移除全局快捷键（T-29）；② 移除系统状态小部件（T-30）；③ 贴边采用方案 B（靠边吸附、不自动隐藏，T-31）。同时 T-25 需要“最小化到任务栏”能力，现有契约只有 `window.hide`（隐藏到托盘）。
- 决策：
  1. 契约新增 `petAPI.window.minimize()` / IPC `window:minimize`（主进程 `BrowserWindow.minimize`）。
  2. 契约移除 `petAPI.window.setShortcutEnabled()` / IPC `window:set-shortcut`；T-29 实施时同步清理 preload、main、store、renderer 与 locale。
  3. T-30 整体移除系统状态小部件（CPU/内存/电池）及主进程轮询，保留 idle 主动话术。
  4. T-31 贴边改为“靠边吸附不自动隐藏”（方案 B）：拖到屏幕边缘吸附对齐，不缩成细条自动隐藏；位置记忆保留。
- 后果：contracts.js、docs/API.md 已同步冻结；T-25/T-29 线程按新契约实施，任务卡状态更新为“可分配”；T-30/T-31 按确认方案实施。

## ADR-027：TTS 专属语音包（按人格）（2026-08-10）

- 状态：Accepted（需求已确认，待实施）
- 背景：T-23 落地的系统 TTS 朗读语气僵硬，与桌宠“陪伴”定位不符；用户要求为不同性格提供专属语音包。
- 决策：新增任务 T-33——按 6 套预设人格配置语音参数（voice/pitch/rate），朗读时按当前人格模板应用；设置页提供开关与语音包选择；不改 petAPI 契约；如需新增 settings 字段，先经协调者确认 store 白名单。
- 后果：TTS 朗读更贴合人格；实现集中在渲染层，风险低；可与 T-32（orchestrator 修复）独立排期。

## ADR-028：scripts/orchestrator/ 不入库（2026-08-10）

- 状态：Accepted
- 背景：`scripts/orchestrator/` 为自动化实验产物，从未入库；其去留待用户决定，T-32（orchestrator 缺陷修复）也以“是否入库”为前提。2026-08-10 用户明确决定不入库。
- 决策：`scripts/orchestrator/` 保留为本地未跟踪目录，不加入版本库、不提交 main；T-32 任务关闭，不派发、不实施缺陷修复；后续如需自动化闭环能力，另行评估替代方案。
- 后果：项目路线图不再包含 orchestrator 修复；该目录继续占用本地磁盘但不进入 git；未来若改变决策重新入库，需先补齐已知缺陷（多 `--task` 参数、token/时间预算、selftest）并重开任务卡。

## ADR-029：TTS 改用 Edge 在线神经语音（自研最小客户端）（2026-08-10）

- 状态：Accepted
- 背景：T-33 语音包实测听感无差异且生硬（用户验收反馈）。根因：本机 Web Speech 只暴露 SAPI 系统音（Huihui/Kangkang/Yaoyao 等），6 套语音包的 voice 偏好最终都落到同一批系统音，且 Chromium 对 pitch/rate 支持有限；系统 TTS 无法提供“人味”。已实测 `speechSynthesis.getVoices()` 仅 6 个系统音；第三方 npm 包 edge-tts（ESM+TS，Node 拒绝剥离 node_modules 内类型）与 msedge-tts（返回固定 4KB/空流）均不可用。
- 决策：
  1. 新增自研最小 Edge 在线神经语音客户端 `src/main/tts-edge.js`（协议参照 rany2/edge-tts，MIT；已验证可稳定产出 MP3），不依赖第三方 TTS 包；主进程经 wss 连接 speech.platform.bing.com，生成 Sec-MS-GEC 令牌，发送 speech.config + SSML，解析二进制音频帧。
  2. 6 套人格映射 6 个中文神经音色：warm→Xiaoxiao、sage→Yunyang、playful→Yunxi、gentle→Xiaoyi、cool→Yunjian、curious→Yunxia，各配 rate/pitch（已通过官方 voice list 确认全部存在）。
  3. 契约新增 `petAPI.tts.speak({ text, voice, rate, pitch })`（IPC `tts:speak`），主进程返回 audio/mpeg data URL；渲染层用 HTMLAudioElement 播放；失败/离线自动回退 speechSynthesis（保留现有行为）。
  4. CSP 增加 `media-src 'self' data:`；依赖显式新增 `ws`（WebSocket 需自定义头，Node 全局 WebSocket 不支持）。
  5. 不新增 settings 字段：沿用 `ttsVoicePackEnabled`/`ttsVoicePackId`。
- 后果：联网时获得自然、区分度高的神经语音；离线回退系统 TTS（音质降级但可用）；新增网络调用与 MP3 缓存开销（主进程 LRU 缓存）；微软在线服务为免费非正式接口，未来若失效由回退兜底。

## ADR-030：专属语音克隆接入暂缓，skill 保留复用（2026-08-10）

- 状态：Accepted（暂缓）
- 背景：用户提出“智能语音采集 skill，采集分析真人录音生成专属语音包替换默认语音包”；协调者已创建 `voice-pack-creator` skill（采集/分析脚本实测通过），并给出选型（云端 Fish Audio / 本地 GPT-SoVITS）。随后用户决定“先算了吧，继续项目的推进”。
- 决策：暂不实施 app 内专属语音包接入；`voice-pack-creator` skill 保留在 `C:\Users\HP\.codex\skills\voice-pack-creator` 供未来复用；若未来重启该需求，克隆引擎选型届时再定。
- 后果：项目路线图回到 M3.5 收尾 → M4 分发规划；skill 不占用项目仓库；需求与实现步骤已固化在 skill 与交接文档中，无需重复调研。

## ADR-031：自动更新采用 electron-updater + GitHub Releases（2026-08-10）

- 状态：Accepted（评估完成，实施中）
- 背景：M4 P3 需要自动更新方案。候选：electron-updater（GitHub Releases 通道）、商店渠道更新机制、手动下载。
- 决策：
  1. 采用 `electron-updater@6.8.9`（与 electron-builder 26/Electron 43 兼容，npm 安装无冲突）+ GitHub Releases 作为更新源。
  2. `electron-builder.yml` 增加 publish（provider=github, owner=fjtyyds, repo=ai-desktop-pet）；CI 仍用 `--publish never`，Release 由 `softprops/action-gh-release` 上传 exe/blockmap/latest.yml。
  3. 实现范围：打包后自动检查更新（静默失败）、发现更新弹窗确认、下载后重启安装；托盘菜单增加“检查更新”；开发模式（未打包）不检查。
  4. 无渲染层契约变更；更新状态仅用原生 dialog/通知。
- 后果：用户安装正式版后可自动升级；商店/Steam 渠道各自使用平台更新机制，本方案仅覆盖 GitHub 直装版；首次发布需打 v 标签触发 release。

## ADR-032：商业化上线方案（2026-08-11）

- 状态：Accepted（方案已定，待用户确认定价/节奏后实施）
- 背景：M4 P0~P4 完成后需要上线与盈利；用户要求先调研市场与竞品，再给出可盈利、优势明确、有数据依据的上线方案。
- 决策：
  1. 定位为“AI 对话桌宠 × 桌面效率助手 × 个性化皮肤生态”的 Windows 桌面产品，不与手机聊天 App 正面竞争；
  2. 盈利采用混合模式：Pro 订阅（¥15/月、¥128/年）+ 永久买断（¥68）+ 皮肤/配件市场分成（70/30）+ 企业批量授权（¥99/席/年）+ 赞助/联盟；
  3. v1.0 目标 2026-09-01 全渠道上线（GitHub/官网/Steam EA/Microsoft Store）；
  4. 落地任务卡 T-40~T-46（许可证/支付/遥测/皮肤/UI/官网与分享/商店发布），沿用项目内线程闭环执行；
  5. 市场数据与竞品分析见 `docs/reports/2026-08-11-商业化上线方案.md`。
- 后果：项目从“工具打磨”转向“商业产品”；新增付费墙、遥测、商店与支付相关工作；支付/商店涉及外部账号与资金，实施前需用户确认资质。

## ADR-033：项目目录规范化与归档（2026-08-11）

- 状态：Accepted（已执行）
- 背景：仓库根目录存在“多线程开发/”（约 5GB，12 个 M1~M3 旧 worktree 副本）、6 个已合并 M3.5 worktree、多个本地探针/演示文件与实验日志，影响人工审核。
- 决策：
  1. 6 个已合并 M3.5 worktree（m3x-export/idle/memory-ui/mood-ui/stream/widgets）按用户授权移除（分支保留，内容在 git 历史）；
  2. “多线程开发/”、残留目录（m3x-stream 残余、m3x-weather-refresh、测0.1.0）、探针/音频文件、.orchestrator-logs 全部**移动归档**至 `E:\codex\_archive_20260811\`（同卷移动，可恢复，不执行不可逆删除）；
  3. scripts/orchestrator/ 维持 ADR-028 决定（不入库、保留本地），加入 .gitignore，git 状态恢复干净；
  4. 项目根目录仅保留 main worktree 与源码/文档/配置。
- 后果：项目文件夹可人工审核；归档目录保留全部原数据，确认无需后再由用户决定物理删除。

## ADR-034：自主执行边界与总工交接提示词优化（2026-08-11）

- 状态：Accepted
- 背景：用户要求“能保证安全性的所有事项不用确认，自己处理；需要人工处理的事项尽可能减少；遵守持续闭环循环；总工交接时进行提示词优化”。
- 决策：
  1. 按全局 AGENTS.md“自主执行边界”清单执行：本地文件/仓库操作、项目内闭环、只读调研与沙箱可自主；远程副作用、资金、系统级改动、不可恢复删除仍先确认；
  2. 总工交接必须使用优化提示词模板（`docs/reports/2026-08-11-总工交接提示词模板.md`）：自包含角色边界、checkpoint 路径、自主执行边界、当前派发/验收队列、技能清单与“不重复已见反馈”规则；
  3. 持续闭环循环为默认工作模式：派活→等待反馈→验收→合并→更新状态→下一张卡；无自主任务时停止并向用户汇报最小化待决项。
- 后果：减少用户确认次数；交接线程可冷启动直接续跑；安全边界以清单为准。

## ADR-036：设置界面布局重构——豆包式分组列表（2026-08-11，T-48）

- 状态：Accepted
- 背景：用户反馈“设置界面的布局太乱了”，并提供两张豆包设置页截图（OCR 描述见交接文件 20260811-1301）：顶部账号/订阅卡片（含升级按钮）+ 分组列表行（图标+文字+箭头）+ 底部版本与支持信息页脚。当前设置页为单页堆叠表单（账户订阅、API Key、模型、语言、主题、动效、空闲互动、天气、喝水、番茄钟、遥测、宠物名、人格、语音包、记忆、皮肤、保存、清除数据等约 26 项），结构杂乱。
- 决策：
  1. 设置页重构为“顶部账号卡片 + 分组列表 + 版本页脚”三段式；分组建议：外观（主题/语言/动效/皮肤）、对话（API Key/模型/宠物名/人格/语音包）、陪伴与效率（空闲互动/天气/喝水/番茄钟）、隐私与数据（遥测/记忆管理/清除数据），最终分组与命名由工作线程按参考图风格确定并在任务卡完成记录中写明。
  2. 保留全部既有元素 id、事件绑定与功能；账号卡片复用现有 account-section（当前版本/状态/有效期/云额度/Pro 功能/激活码/沙箱购买），皮肤与配件、记忆管理保留为跳转行进入既有子页。
  3. 版本页脚回归：仅保留应用版本号与“由 DeepSeek 大模型提供支持”等支持信息（本次用户最新请求优先于 T-24“移除底部平台/版本信息”中版本部分的旧决定；不恢复平台/系统信息）。
  4. 不新增 settings 字段、不改 petAPI 契约；文案新增走 zh-CN/en locale；scripts/check.js 增加 T-48 断言（分组容器、全部既有 settings 元素 id 存在、页脚版本号）。
- 后果：设置页信息架构清晰、视觉对齐参考图；全部既有功能通过 id 保留与断言回归；后续如用户调整分组命名，仅改 index.html/locales/check.js，成本低。

## ADR-037：小部件紧凑化与情绪中性化（2026-08-11，T-49）

- 状态：Accepted
- 背景：用户目检后反馈（与 T-48 线程直接沟通）：①番茄钟/天气小部件占位过高，挤占聊天区；②情绪默认 60 落在“愉悦”区间，无交互也显示愉悦，缺乏“活物感”；③无交互时情绪长期定格。
- 决策：
  1. 天气小部件紧凑化：padding/图标/温度/按钮收窄（折叠高约 31px）；番茄钟标题与倒计时合并一行（高约 61px）；专注/喝水/待办等其他 widget 不改。
  2. 情绪默认 60→52（“平静”区间 46-55）；反馈幅度 ±8→±12、单次上限 20→24；无交互回归到基线后按 4 分钟周期做确定性伪随机小幅“呼吸”（valence ±5、intensity ±0.05，不跳极端）。
  3. 本需求由用户直接与工作线程沟通产生，超出原 T-48 卡边界，另立 T-49 卡；实施过程未走独立 worktree（T-44/T-45 同类违规复现），记录并重申纪律，不追溯处罚。
- 后果：面板更紧凑、情绪更中性且会缓慢变化；最小字号降至 10px（仅 meta 文本，颜色对比度不变）；check 断言维持既有 id 与功能；后续小改动仍需独立 worktree + 任务卡。

## ADR-038：设置页账户区并入分组列表 + 整体移除番茄钟（2026-08-11，T-50）

- 状态：Accepted
- 背景：用户目检后反馈：①“账户与订阅”区块单独占一大块，与其余设置项外观不一致；②番茄钟小部件“没啥用”，要求删除。
- 决策：
  1. “账户与订阅”从顶部大卡片改为与其他分组一致的行式分组（图标+组名+箭头，点击展开），作为第一组；全部既有 id（account/license/payment）与功能保留。
  2. 番茄钟全链路移除：渲染层小部件与设置项、chat.js 逻辑、store 字段（pomodoroEnabled/pomodoroMinutes/pomodoroNotifyAt/pomodoroNotifyMinutes）、主进程通知轮询/系统通知（ipc.js/main.js）、telemetry 事件 pomodoro_complete、license 权益 pomodoro、双语文案、check/smoke 断言。
  3. 专注统计组件保留（Pro 功能），但其唯一数据源（番茄钟完成）被移除后不再增长；如需一并移除或另接数据源，另行决策。
- 后果：设置页信息结构统一、番茄钟不再出现；存量用户 settings.json 中的 pomodoro 字段在下次写入时被清洗忽略（不迁移、不兼容读取）；check/smoke 相应断言更新；专注统计成为“只读存量”组件（后续处理）。

## ADR-039：整体移除专注统计组件（2026-08-11，T-51）

- 状态：Accepted
- 背景：ADR-038 移除番茄钟后，专注统计（focusStats）唯一数据源（番茄钟完成）消失，组件不再增长；此前决策为“保留组件并另行决策”。用户按待办清单授权逐项解决，本项决策为移除。
- 决策：
  1. 专注统计全链路移除：渲染层 #focus-widget 与 chat.js 逻辑、store focusStats 字段与清洗、license 权益、双语文案、check/smoke 断言；存量 settings.json 的 focusStats 字段读写时删除（不迁移、不兼容读取，同 ADR-038 番茄钟处理）。
  2. 喝水提醒与待办组件保留（数据源独立：喝水由设置定时提醒驱动，待办由用户创建）。
  3. Pro 功能门控列表移除“专注统计”，保留待办。
- 后果：面板/设置不再出现永不增长的“专注统计”，避免误导用户；后续若需专注数据，需重新引入数据源（如与待办联动）并另行决策；store 白名单缩小。

## ADR-040：MSIX 打包实施（electron-builder 27 alpha 线）（2026-08-11，T-52）

- 状态：Accepted
- 背景：T-47 验证报告（docs/store/msix-validation.md）结论：MSIX 目标仅存在于 electron-builder 27.0.0-alpha 线，当前锁定 26.15.3 不可用；商店版若直接用 electron-updater 会走错更新链路（最高风险）。用户按待办清单授权 MSIX 依赖升级审批。
- 决策：
  1. electron-builder 升级至 27.0.0-alpha.6（精确锁定，NSIS 保留并存）；由协调者执行依赖变更并提交。
  2. T-52 实施：electron-builder.yml 增加 MSIX 配置（identityName/publisher 占位、zh-CN/en-US、四段版本、appx logo 占位资源）；updater.js 增加 `process.windowsStore` 守卫，商店版禁用 electron-updater（更新走商店）。
  3. 本地构建验证 MSIX 与 NSIS 双产物；真实商店注册/提审、签名采购需用户账号与预算，另行执行。
- 后果：打包工具链进入 alpha 线（配置面可能演进），T-52 必须回归 NSIS 产物与自动更新链路；如 alpha 不稳定可回退 26.15.3（分支保留）；MSIX 产物可供后续 MS Store 提审准备。

## ADR-041：待办清单收口与资金暂缺下的发布策略（2026-08-11）

- 状态：Accepted
- 背景：总工上岗后向用户汇报剩余待决项（商店/签名/预算、归档删除、TTS 试听、UI 目检、v1.0 发布授权）；用户逐项答复：①暂时没有资金支持；②归档暂时保留；③TTS 先这样吧；④UI 目前可以；⑤v1.0 发布是①的延续，问题仍是无资金。
- 决策：
  1. 商店/签名事项冻结：Steam 开发者账号（$100）、MS Store 开发者账号、代码签名采购（Azure Artifact Signing 或 OV/EV）在资金到位前不实施；MSIX identityName/publisher 继续使用占位（T-52）。
  2. 归档目录 `E:\codex\_archive_20260811\`（约 5.4GB）暂时保留，不物理删除。
  3. TTS 听感维持现状（T-33/T-34/T-36 产物接受，不再调整）。
  4. T-44 UI 目检通过（用户确认，2026-08-11 15:07）。
  5. v1.0 全渠道发布（含商店提审）暂缓；GitHub Release 路径无需资金，待用户另行授权；正式发布仍受“push/tag/Release 需确认”边界约束。
- 后果：项目进入“功能与文档冻结、等待资金/新需求”状态；无自主可派发卡；闭环 watcher 保持运行，用户提供资金或新需求后恢复派活。

## ADR-042：最新版同步机制（scripts/sync-latest.ps1 + E:\codex\AI桌宠最新版）（2026-08-11）

- 状态：Accepted
- 背景：用户要求生成“可复制的最新版本”目录 `E:\codex\AI桌宠最新版`，并随每一次项目调整更新。
- 决策：
  1. 新建 `scripts/sync-latest.ps1`：默认执行 `npm run dist -- --publish never`，将 NSIS 安装包（Setup.exe/blockmap/latest.yml）与 MSIX 产物（msix/msixupload）同步到 `E:\codex\AI桌宠最新版`；`-SkipBuild` 可复用现有 dist。
  2. 同步时清理目标目录旧产物，并生成 `README.md` 与 `latest.json`（版本/提交/时间/SHA256 清单）；README 模板为 `docs/templates/latest-version-readme.md`。
  3. 每次 main 合并验收后，由协调者运行该脚本作为闭环收尾步骤（已写入 AGENTS.md 常用命令与验收要求）。
  4. 脚本保持纯 ASCII（Windows PowerShell 5.1 对无 BOM 的 .ps1 按 ANSI/GBK 解析），中文目标路径用 Unicode 码点构造；首次运行误建的乱码目录已重命名保留于 `E:\codex\_stale-sync-mojibake-20260811`（删除被环境策略拦截，待用户手动）。
- 后果：`E:\codex\AI桌宠最新版` 始终反映 main 最新构建，安装包/商店产物可从该目录直接复制分发；脚本故障仅影响同步，不影响构建产物本身。

## ADR-043：新用户版本收口（2026-08-11）

- 状态：Accepted
- 背景：生产 UI 残留开发/测试痕迹：设置页“沙箱支付（未接入真实网关）”区块与本地 mock 激活码/订单号激活区（license.js 为无后端开发桩）；首次引导（T-20）仅对全新 userData 可见，覆盖安装的已有用户无法回看；check.js 仍要求 UI“必须包含”这些测试桩 token。
- 决策：
  1. 新卡 T-54（codex/m4-newuser）收口：设置页沙箱支付区块整体移除，替换为“Pro 会员即将上线”干净占位；mock 激活/停用 UI 一并替换，renderer 删除 sandboxPurchase/activateLicense/deactivateLicense 流程与绑定。
  2. 主进程 src/main/payment.js、src/main/license.js、IPC/preload 内部桩保留（不暴露 UI），供未来真实支付/许可证后端接入。
  3. 设置页新增“重新查看新手引导”入口，复用 showOnboarding 覆盖层，不重置语言/API Key/人格等已有设置，完成时照常持久化 onboardingDone=true。
  4. scripts/check.js 由“必须包含”改为“不得包含”防回归断言；scripts/smoke.js 新增全新 userData 首启引导可见断言。
  5. 验收通过后由协调者合并 main，并运行 scripts/sync-latest.ps1 更新 E:\codex\AI桌宠最新版。
- 后果：生产安装包不再暴露支付/激活测试桩；全新安装与已有用户均可完整看到三步引导；主进程支付/许可证桩保留，未来接真实网关时复用。

## ADR-044：宠物浮窗（Codex Pets 式独立悬浮宠物）（2026-08-13，T-55）

- 状态：Accepted（已实施）
- 背景：用户看到 OpenAI Codex 的“显示宠物”功能（Settings → Appearance → Pets，`/pet` 命令或托盘切换独立悬浮宠物，宠物显示 Codex 工作状态：运行中/等待输入/待审阅，并支持 ~/.codex/pets 的 pet.json + spritesheet.webp 自定义宠物包），希望 AI 桌宠也具备同等能力。项目已有主窗口内角色形象（T-43 皮肤 + T-44 动效），但没有独立浮窗、状态气泡与动画宠物包。
- 决策：
  1. 新增独立宠物浮窗 `src/main/pet-overlay.js` + `src/renderer/overlay.html/css/js`：240×320 透明置顶小窗，仅显示当前皮肤角色与状态气泡；主聊天窗口隐藏/最小化时仍可悬浮桌面；位置记忆到 `settings.petOverlayBounds`。
  2. 开关与入口：设置页“外观”组新增“宠物浮窗”开关与“显示/隐藏宠物”行；托盘菜单新增“显示宠物/隐藏宠物”；聊天输入框支持 `/pet` 命令（不发给 AI）。设置持久化为 `settings.petOverlayEnabled`（默认 false）。
  3. 状态契约（pet:get-status / pet:set-status）：`idle`（等待聊天，默认）、`working`（LLM 回复中）、`ready`（回复完成）、`failed`（回复出错）；聊天页在发送/完成/失败时上报；ready/failed 气泡 6 秒后自动回落 idle。
  4. 支持导入 Codex 宠物包（`pet.json` + `spritesheet.webp`，8 列×9 行、单元格 64~512px）：扩展 skin-store 允许 `.webp`、校验 WebP 尺寸（VP8X/VP8/VP8L 解析）、按 9 行状态映射动画（idle/running/waiting/failed/review 等）；普通 PNG 皮肤仍可静态显示；标题栏与皮肤列表对图集皮肤做 CSS 裁切预览。
  5. 安全边界沿用 T-43：包内仅允许 .png/.json/.webp、≤10MB、≤50 条目、拒绝路径跳转/加密 zip/符号链接，不执行包内任何代码。
  6. IPC/preload 新增 `petAPI.petOverlay.{getStatus,setStatus,getSkin,toggle,setEnabled,tuckAway,refreshSkin,onSkinUpdated}`；契约写入 contracts.js；check/smoke 增加静态与运行时断言（含 WebP 尺寸解析、宠物包导入与非法图集拒绝）。
- 后果：用户可像 Codex 一样让宠物独立悬浮桌面并看到工作状态；未来可在浮窗上扩展点击唤起主窗口、任务气泡等；皮肤包格式兼容 Codex 生态（可直接导入 hatch-pet 等产出的宠物包）。

## ADR-045：宠物浮窗优化方案与设置预冻结（2026-08-13，T-56~T-61）

- 状态：Accepted（方案已定，分批实施）
- 背景：用户确认 T-55 只是起点，要求先拟定针对宠物浮窗的优化方案，再自动化完善（总工派活闭环）。
- 决策：
  1. 优化拆 6 张卡、2 个并行批次：T-56 交互增强、T-57 状态机与气泡队列、T-58 情绪与动画联动（批次 1）；T-59 皮肤体验、T-60 系统与性能、T-61 设置与引导（批次 2）。
  2. 设置预冻结（协调者先行改 store.js，worker 只读）：`petOverlayBubbleSeconds`（默认 6，允许 3~20）、`petOverlayBubbleEnabled`（默认 true）、`petOverlayReminders`（默认 true）、`petOverlayBounds.displayId`（可选整数，校验显示器存在）。
  3. 契约扩展由各卡提出、总工在对应卡派活前冻结到 contracts.js/docs/API.md；worker 不得自行改契约。
  4. 执行流程：建卡 → 派活（子代理并行）→ 等待回报 → 总工验收（check/smoke/diff 边界）→ 串行合并 main → 更新 PLAN/STATUS → 全部完成后 sync-latest + 人工目检。
  5. 交接纪律：上下文阈值下按 docs/reports/2026-08-11-总工交接提示词模板.md 交接；当前上下文上限已调高至 500k，本轮不强制交接，但每轮写 outputs/ 交接文件。
- 后果：浮窗从“能显示”走向“好用”；设置白名单在批次开始时即为最终形态，避免 worker 反复改 store.js；共享文件冲突由总工在合并阶段解决。
