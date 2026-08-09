# 项目状态

- 更新时间：2026-08-09
- 当前阶段：M1 MVP 桌宠（并行模式）
- 当前任务：T-04 已完成，M1 全部验收通过
- 最近完成：M0；M1 并行工作台；T-01/T-02/T-03 集成；T-04 人工验收与收尾
- 下一步：规划并启动 M2 智能层（人格/情绪、短期与长期记忆）
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
