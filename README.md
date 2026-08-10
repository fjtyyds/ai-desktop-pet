# AI桌宠

Windows 桌面 AI 桌宠：常驻桌面的角色化助手，可与 DeepSeek 对话、记住重要的事，并拥有人格与情绪。

## 功能

- 桌面角色窗口：可拖动、可缩放、可贴边吸附、关闭隐藏到托盘
- 对话：DeepSeek v4 Flash 流式回复（可取消/超时），支持图片理解降级说明
- 记忆：短期上下文 + 长期事实记忆，可查看/修正/删除
- 人格与情绪：6 套预设人格（温暖/博学/元气/温柔/高冷/好奇），情绪随交互变化
- 陪伴：空闲主动互动、番茄钟、天气小部件
- 朗读：按人格切换的神经语音（在线），断网回退系统 TTS
- 隐私：对话与设置仅存本机；API Key 经系统安全存储加密
- 国际化：中文/英文，基础无障碍支持

## 环境要求

- Windows 10/11（首发平台）
- 开发：Node.js 20+（本项目使用 Node 24 验证）

## 开发

```powershell
npm install
npm run dev        # 启动开发窗口
npm run check      # 环境与关键文件检查（每次改动后必须通过）
npm run smoke      # 无头冒烟测试（需真实用户权限）
npm run dist       # 产出 Windows 安装包
```

Electron 二进制下载慢时可使用镜像：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
node node_modules/electron/install.js
```

## 使用

首次启动按引导完成语言、DeepSeek API Key 与人格设置。API Key 只保存在本机（加密存储），不发送到除 DeepSeek 以外的任何服务。

在线服务说明：

- DeepSeek：对话（需用户自备 API Key）
- 神经语音：微软 Edge 在线朗读服务（免费、无需密钥；不可用时自动回退系统 TTS）
- 天气：Open-Meteo（免费、无需密钥）

## 目录结构

```text
src/main        Electron 主进程（窗口、托盘、IPC、TTS、天气）
src/renderer    渲染进程（UI、动画、交互）
src/llm         DeepSeek Provider、人格与情绪、聊天服务
src/storage     本地存储（设置、消息、记忆）
src/shared      共享契约与语言包
scripts         校验脚本
docs            产品规格、决策、状态与任务卡
```

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
