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
