# 项目状态

- 更新时间：2026-08-09
- 当前阶段：M2 智能层（人格/情绪 + 短期与长期记忆）
- 当前任务：M2 全部验收通过（含人工目检与真实 API 验证）；待办 T-09（设置页 API Key/模型 输入框）
- 最近完成：M0~M1 全部验收通过；真实 DeepSeek 调用验证；M2 设计；T-05~T-08 开发与集成；M2 人工目检；ADR-013/014
- 下一步：建卡开发 T-09（常开真实模式）；随后规划 M3 打磨（打包/图标/崩溃上报/i18n/无障碍）
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
