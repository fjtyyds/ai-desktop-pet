# Microsoft Store 发布素材包（T-46）

> 状态：素材清单与文案模板已就绪（2026-08-11）；**提审不执行**，待用户确认账号/身份核验/定价后另行派发。
> 信息来源：Microsoft Learn（[Store listings](https://learn.microsoft.com/zh-hk/gaming/game-publishing/concepts/store-listing)、[Choose a distribution path](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path)）及官方公告；政策以提交当日为准。

## 1. 渠道事实

| 项目 | 说明 |
| --- | --- |
| 平台 | Microsoft Store（Windows 10/11） |
| 门槛 | Partner Center；个人开发者免费注册（2025-09 起免 $19 注册费，需政府 ID + 自拍核验）；公司 $99 一次性 |
| 分成 | 应用 15%、游戏 12%（以最新条款为准） |
| 签名 | MSIX 提交由微软免费代签；MSI/EXE 提交需 CA 签名证书（见 [code-signing-eval.md](code-signing-eval.md)） |
| 更新 | MSIX：商店内置更新；MSI/EXE：由应用自行负责（现有 electron-updater 可继续使用） |

## 2. 打包路径选择

| 路径 | 说明 | 推荐度 |
| --- | --- | --- |
| MSIX（.msixupload） | electron-builder 的 appx/msix 目标产出；微软代签、内置更新、认证体验好 | 推荐，需技术验证 |
| MSI/EXE 安装程序 | 现有 NSIS 安装包 + 版本化 HTTPS URL；发布者必须用受信任 CA 证书签名，支持静默安装；更新由应用负责 | 备选 |

MSIX 技术验证项（提审前完成，本卡不实施）：

- electron-builder appx/msix 目标构建与 .msixupload 产物。
- MSIX 沙箱下 userData 路径可写性与更新行为（Electron + electron-updater 在 MSIX 中可能受限，需实测）。
- 应用图标/磁贴由 MSIX manifest 提供（复用 assets/icon.ico）。

## 3. 商店文案模板

### 3.1 产品名称

- 中文：AI桌宠（暂定）
- English：AI Desktop Pet（暂定）

### 3.2 Description（≤10,000 字符）

建议结构与 Steam 长描述一致（定位 → 核心功能 → 隐私承诺 → 版本说明），并按商店本地化建议提供 zh-CN 与 en-US 两版。

### 3.3 What's new（≤1,500 字符，首次提交留空）

- v1.0 首发：AI 对话、记忆、人格/情绪、神经语音、效率小组件、皮肤市场、本地优先隐私。

### 3.4 Product features（≤20 条，每条 ≤200 字符）

- 与 DeepSeek 等模型实时对话（流式输出）
- 6 套人格与情绪可视化
- 长期记忆，可查看/编辑/删除
- 神经语音朗读（在线音色，离线回退）
- 天气/番茄钟/喝水提醒/待办小组件
- 皮肤市场：导入/导出，内置 3 套皮肤
- 贴边吸附、位置记忆、深/浅主题
- API Key 加密存储，数据一键导出/清除

### 3.5 关键词

AI、桌宠、desktop pet、陪伴、聊天、效率、效率工具、皮肤、天气、番茄钟

### 3.6 支持信息

- 官网：https://ai-desktop-pet.com（域名待定）
- 支持邮箱：待用户提供

### 3.7 隐私政策

- 必填：Partner Center 提交时必须提供隐私政策 URL；个人开发者可使用微软免费托管的隐私政策（2025 新政），或使用官网 /privacy（内容大纲见 [steam-storekit.md](steam-storekit.md#5-隐私政策内容大纲官网-privacy-待建)）。

## 4. 素材清单

| 素材 | 尺寸 | 格式 | 必需 | 说明 |
| --- | --- | --- | --- | --- |
| Poster Art | 720×1080 或 1440×2160 | PNG | 是（游戏类必需） | 标题置于上 2/3；禁止透明层/发布商 Logo/年龄图标 |
| Box Art | 1080×1080 或 2160×2160 | PNG | 是（游戏类必需） | 同上 |
| Super Hero Art | 1920×1080 或 3840×2160 | PNG | 是 | 16:9 顶部横幅；纯美术无文字（应用可含标题） |
| Desktop Screenshots | 1366×768 起，3840×2160 首选 | PNG | 至少 1 张（建议 ≥4，最多 8） | 真实运行画面；无标题/Logo/年龄图标/按钮图符 |
| Trailer | 1920×1080，MP4/MOV ≤10GB | MP4 | 否（强烈建议） | 封面 1920×1080 PNG；≤15 个视频 |
| 应用图标 | MSIX manifest 提供 | — | 是 | 复用 assets/icon.ico，打包时转换验证 |

### 4.1 截图建议内容（≥4 张）

1. 主窗口 + 桌宠形象（深色玻璃拟态）
2. 流式对话（含“正在思考…”）
3. 效率小组件（专注统计/喝水/待办）
4. 皮肤市场与角色切换
5. 设置页（主题/语言/隐私选项）
6. 记忆管理页

## 5. 年龄分级与认证

- IARC 问卷：内容要点同 Steam（无成人内容；AI 对话与皮肤 UGC 如实申报）。
- 认证测试关注：安装/卸载干净、启动正常、隐私政策可达、无后台滥用。

## 6. 提审待办（本卡不执行）

1. 用户确认：微软账号与身份核验、最终产品名、定价与地区。
2. 技术验证：MSIX 打包与 .msixupload、商店沙箱兼容性、更新链路。
3. 隐私政策 URL 就绪。
4. 完成 IARC 问卷、素材上传与认证提交。
5. 提审（微软审核周期留出缓冲）。

## 7. 参考

- https://learn.microsoft.com/zh-hk/gaming/game-publishing/concepts/store-listing
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path
- https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/
- https://www.electron.build/docs/msix/
