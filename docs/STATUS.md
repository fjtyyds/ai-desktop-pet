# 项目状态

- 更新时间：2026-08-09
- 当前阶段：M1 MVP 桌宠（并行模式）
- 当前任务：M1 集成已完成（T-01/T-02/T-03 已合并到 main）
- 最近完成：M0；M1 并行工作台；T-01/T-02/T-03 集成到 main
- 下一步：`npm run dev` 人工目检（托盘菜单、聊天收发、设置保存）；补全 dev 模式 CSP 警告（打包前）
- 阻塞：无
- 交接提示：新会话先读 `AGENTS.md` → `PLAN.md` → 自己的任务卡（docs/tasks/T-xx.md）

## M1 集成完成记录（2026-08-09）

- 合并：codex/m1-tray（T-01，此前已并入）→ codex/m1-chat（T-02 渲染层 + e95c411 T-03）→ codex/m1-llm（T-03，842f18a）。
- T-03 取舍：保留 m1-llm 842f18a 实现（provider/store/chat + ipc/preload），删除 m1-chat e95c411 重复实现（deepseek.js、json-store.js、message-store.js、settings-store.js），见 ADR-007。
- 接线：main.js 增加 `require('./ipc')`。
- 校验：`npm run check` 通过；`npm run smoke` 通过（需真实用户权限）；T-03 纯 Node 功能验证通过。
- 任务卡：T-01/T-02/T-03 均已标记“已完成”。
