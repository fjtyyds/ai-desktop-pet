# MSIX 打包与商店沙箱技术验证报告（T-47）

- 状态：已完成（待协调者验收，2026-08-11）
- 性质：只读调研 + 本地临时实验；未注册商店账号、未购买服务、未提交商店
- 结论速览：**MSIX 可做，但 electron-builder 的 MSIX 目标是 beta 且只存在于 27.0.0-alpha 线**；当前项目锁定的 26.15.3（含 26.15.x 全线）没有 MSIX 目标，只有 appx 目标。沙箱兼容性整体可行，**最高风险是自动更新**：electron-updater 官方不支持 MSIX，现有 updater.js 在商店版会走错链路，必须加 `process.windowsStore` 守卫。推荐“MSIX 上架 + NSIS/GitHub 直装并存”。

## 1. 调研方法与证据来源

本地证据（解包/源码，未改动任何文件）：

- 项目锁定 electron-builder / app-builder-lib 26.15.3（package-lock.json），`out/targets/` 只有 AppxTarget，全包无任何 `msix` 字样，schema 无 MsixOptions。
- `npm pack app-builder-lib@26.15.7`（v26 dist-tag）解包：同样无 msix 目标。
- `npm pack app-builder-lib@27.0.0-alpha.6` 解包：含 `dist/targets/win/MsixTarget.js`、`MsixOptions.js`、`templates/msix/appxmanifest.xml`；实现用 makeappx 产出 `.msix`，`makeappx bundle` 产出 `.msixbundle`，7za 打包产出 `.msixupload`。
- electron-updater 6.8.9 全包 0 处 `msix/appx/windowsStore` 处理。
- Electron 43.3.0 已安装；项目源码：存储全部走 `resolveBaseDir()`（`app.getPath('userData')`），单实例锁 `app.requestSingleInstanceLock`，托盘 `new Tray(nativeImage)`，通知用主进程 `Notification`，safeStorage 用 DPAPI，无 `process.windowsStore` 分支、无 `app.setAppUserModelId`、无自启动逻辑。

远程证据（2026-08-11 抓取）：

- electron-builder 官方 MSIX 文档：https://www.electron.build/docs/msix/ （明确 Beta、产物、工具链、签名、更新结论）
- MSIX 目标引入提交：electron-userland/electron-builder#9808（`feat(win): add MSIX target (beta)`，changeset 为 minor）
- electron-builder appx 文档：https://www.electron.build/docs/appx/ （AppX vs NSIS vs MSI 对比、更新结论）
- Electron 官方：autoUpdater（MSIX 直链/JSON feed）、process.windowsStore、safeStorage（Windows=DPAPI）、Notifications（AUMID/ToastActivatorCLSID）
- 微软官方：winapp CLI Electron 打包指南（Windows App SDK 工具链路线）、MSIX 容器化概览（全信任=标准桌面权限、干净卸载）
- 社区佐证：electron/electron#39636（AppX userData 路径）、anthropics/claude-code#25579（MSIX 下 userData 重定向到 `%LOCALAPPDATA%\Packages\<family>\LocalCache\Roaming\`）、Seelen UI 发布记录（MSIX 托盘问题）、super-productivity#7282（Windows 托盘图标问题）

## 2. electron-builder 对 MSIX 的支持现状

### 2.1 支持结论

**支持，但为 beta 且当前版本不可用。** MSIX 目标（`win.target: msix`）由 #9808 引入，官方标注 Beta（“配置面与生成的 manifest 仍在演进，升级后必须重测”）。实际发布线：

| 版本 | MSIX 目标 | 说明 |
| --- | --- | --- |
| 26.15.3（项目锁定，npm latest） | 无 | 仅 appx 目标，产物 `.appx` |
| 26.15.7（npm v26 dist-tag） | 无 | 同上 |
| 27.0.0-alpha.6（npm next） | 有 | `MsixTarget`/`MsixOptions`，产物 `.msix/.msixbundle/.msixupload` |

推论：要用 MSIX 目标必须把 electron-builder 升级到 27.0.0-alpha.x（或等 27 稳定版）。这属于依赖变更，按项目规则需协调者批准（任务卡亦禁止擅改 package.json/package-lock.json）。

### 2.2 与 AppX 目标的差异

| 能力 | appx（26.x 可用） | msix（27 alpha） |
| --- | --- | --- |
| 产物 | `.appx` | `.msix`、`.msixbundle`、`.msixupload` |
| 多架构 bundle | 无 | 有 |
| 商店上传包 | 需手工处理 | 直接产出 `.msixupload` |
| 包完整性（uap10） | 无 | 有（可选） |
| Windows 服务（desktop6） | 无 | 有（本项目不需要） |
| 工具链 | 任意 | 需现代 Windows Kits（winCodeSign ≥ 1.0.0） |

### 2.3 工具链要求（含 Windows App SDK 说明）

- **构建机**：Windows 10/Server 2012 R2（6.3+）及以上原生构建；Linux 不支持；macOS 仅能通过 Parallels Windows VM。
- **核心工具**：Windows Kits 里的 `makeappx.exe`、`makepri.exe`（缩放资产时）、`signtool.exe`。electron-builder 新工具链（winCodeSign 1.0.0/1.1.0/1.3.0）首次构建自动下载 `windows-kits-bundle-10_0_26100_0.zip`（SDK 10.0.26100），可用 `ELECTRON_BUILDER_WINDOWS_KITS_PATH` 指向本机 SDK；legacy winCodeSign-2.6.0 会被拒绝。
- **Windows App SDK**：本项目不依赖 Windows App SDK 运行时；微软官方目前主推的 Electron+MSIX 路线（winapp CLI / `@electron-forge/maker-msix`）属于 Windows App SDK 工具链，要求本机安装 Windows SDK 并手工维护 `Package.appxmanifest`。两路线二选一即可；electron-builder 路线自动化程度更高，但当前只有 beta 版。
- **产物与签名**：`.msix/.msixbundle` 用 SHA-256 签名；商店提审用 `.msixupload`（zip 包，商店代签，无需自购证书）；侧载/企业分发需 CA 或自签证书且 Subject 必须与 `publisher` 一致。
- **身份与资产**：需 `identityName`（3–50 字符）、`publisher`、`publisherDisplayName`；build resources 下 `appx/` 目录放 4 个必选 logo（StoreLogo 50×50、Square150x150Logo、Square44x44Logo、Wide310x150Logo），可选 Badge/Large/Small/Splash；缺省用默认占位资产。
- **其他配置**：`runFullTrust` 自动加入且不可移除；`languages` 默认 en-US（本项目应加 zh-CN）；`minVersion` 默认 10.0.17763.0（Windows 10 1809，商店最低）；版本号需四段（0.1.0 → 0.1.0.0 或 setBuildNumber）。

## 3. 沙箱环境兼容性逐项分析

### 3.1 userData 写入位置与权限 —— 风险：低～中

- 预期行为：MSIX 虚拟化把 `app.getPath('userData')` 重定向到 `%LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalCache\Roaming\<appname>`（Electron issue #39636 与 Claude Desktop #25579 均可佐证），该目录可写、无需管理员。
- 本项目现状：settings/messages/memories/logs/telemetry 全部经 `resolveBaseDir()` → `app.getPath('userData')`，**无代码改动**即可适配。
- 注意点：商店版与 NSIS 直装版的 userData 完全隔离，用户不会继承旧数据（含 API Key、记忆、皮肤），需要首次运行引导/说明；DPAPI 密文也无法跨目录搬运。
- 验证项：安装 MSIX 后启动，确认 `app.getPath('userData')` 实际值、写入/重启重读、`%APPDATA%\AI桌宠` 零污染。

### 3.2 自动更新链路（electron-updater + MSIX）—— 风险：高

- electron-builder 官方明确：**MSIX 自动更新由 Microsoft Store（或 App Installer `.appinstaller`）负责，electron-updater 不支持 MSIX**；本地 electron-updater 6.8.9 源码 0 处 MSIX/AppX 处理佐证。
- 本项目现状：`src/main/updater.js` 用 electron-updater + GitHub Releases（ADR-031），`app.isPackaged` 即初始化并在启动 3 秒后检查；若直接跑在 MSIX 下，会按 GitHub provider 拉 latest.yml、下载 NSIS 包，`quitAndInstall` 也不适用于 MSIX——**预期会报错或安装失败**。
- 处置建议（后续任务）：
  1. `initUpdater` 前加 `if (process.windowsStore) return;`（Electron 43 支持该标志，MSIX 包运行时为 true），托盘“检查更新”在商店版禁用或提示走商店；
  2. 商店版依赖商店更新；
  3. 若未来做 MSIX 侧载/直链分发，可改用 Electron 内置 `autoUpdater` 的 MSIX 分支（支持直链 .msix 与 JSON feed，需 `setFeedURL`），替换 electron-updater。
- 验证项：商店版启动后确认不发起 GitHub 更新请求、托盘菜单行为正确；侧载升级链路面谈。

### 3.3 单实例锁 —— 风险：低

- `app.requestSingleInstanceLock()` 基于用户态锁（用户数据目录/套接字），MSIX 全信任应用与普通桌面进程权限一致；未发现 MSIX 专有失效 issue。
- 项目现状：main.js 已用该 API 且失败即退出，符合预期。
- 验证项：安装版连续启动两次、商店更新前后各验证一次（锁随旧进程退出释放）。

### 3.4 托盘 —— 风险：中

- MSIX 全信任桌面应用可创建托盘图标；但社区有 MSIX 安装版托盘不可见的案例（Seelen UI v2.4.11 “tray not working on MSIX installation”），以及 Windows 版本化构建中托盘图标残留/不可见问题（super-productivity #7282/#8470）。
- 本项目现状：托盘图标用 `nativeImage` 内嵌 base64 回退 + assets 图标，未依赖安装器生成的快捷方式 GUID，理论上风险较低；但**必须用真实 MSIX 安装包目检**（图标显示、左键切换、菜单、隐藏到托盘、更新后是否残留）。

### 3.5 系统通知 —— 风险：低～中

- Windows 通知需要 Start Menu 快捷方式 + AUMID + ToastActivatorCLSID；MSIX 包身份天然提供 AUMID 与磁贴，主进程 `Notification` 预期可用。
- 项目现状：番茄钟用主进程 Notification（轮询消费信号），空闲互动在窗口可见时内联（非系统通知）；未调用 `app.setAppUserModelId`（NSIS 下由 Electron 自动处理，MSIX 下由包身份提供）。
- 验证项：安装版触发番茄钟通知、Windows 通知中心可查、点击行为正常。

### 3.6 safeStorage / DPAPI —— 风险：低（有行为差异）

- Electron 43 在 Windows 使用 DPAPI（`CryptProtectData`），MSIX 全信任应用以标准桌面权限运行，DPAPI 可用；密文绑定“同一用户 + 同一机器”。
- 行为差异：① 商店版与直装版 userData 隔离，商店版用户需重新输入 API Key（旧密文不可迁移）；② MSIX 卸载会清除应用数据（见 3.7），卸载即丢失密钥密文，属预期。
- 验证项：安装版设置 API Key → 重启读取往返一致 → 检查落盘为 `enc:v1:` 密文。

### 3.7 安装/卸载行为 —— 风险：中（产品体验类）

- 安装：按用户安装、静默、免管理员、无自定义安装目录；开始菜单出现磁贴（而非 NSIS 的桌面/开始菜单快捷方式）；运行位置（Program Files 类）只读虚拟化——本项目所有写操作都在 userData，无影响。
- 卸载：**MSIX 卸载会移除全部应用数据**（微软官方：clean removal，无注册表/文件残留），与 NSIS 版“卸载后 %APPDATA% 可能残留”相反。对“本地记忆”型应用是重要行为差异：用户卸载前需有导出/备份引导（现有 history:export 可复用）。
- 更新：商店更新保留包数据，不会丢记忆。
- 验证项：安装→写入数据→卸载→确认 `Packages\<family>` 目录清除；商店更新后数据保留。

### 3.8 其他检查点

- 安装目录只读：本项目无写安装目录的逻辑（asar 内只读），通过。
- 自启动：当前产品无登录自启功能；若未来要做，MSIX 需声明 StartupTask（electron-builder `addAutoLaunchExtension` 或 winstore-startup 包），不能用 `app.setLoginItemSettings` 直改注册表/快捷方式。
- 网络：DeepSeek/Edge TTS/天气/更新均为出站 HTTPS/WSS，runFullTrust 下可联网；商店合规建议显式声明 `internetClient`（必要时 `privateNetworkClientServer`）。
- 崩溃日志/Crashpad：均写 userData，通过。
- 现有 check 断言：T-38/T-39 断言与 NSIS artifactName、app-update.yml 绑定；MSIX 目标是独立 target，需为 msix 新增产物断言，避免与 NSIS 配置互相污染（后续任务处理）。

## 4. 推荐方案与预计工作量

### 4.1 推荐：MSIX 优先（Store）+ NSIS/GitHub 直装并存

| 渠道 | 包型 | 更新 | 签名 |
| --- | --- | --- | --- |
| Microsoft Store | MSIX（.msixupload） | 商店内置更新 | 微软代签 |
| GitHub Releases / 官网 | NSIS（现有） | electron-updater（现有 ADR-031） | 现有签名评估（T-46/code-signing-eval） |

理由：

1. 商店版获得代签、内置更新、认证体验，且与 GitHub 直装版互不影响；
2. 自动更新责任按渠道分离：商店版不跑 electron-updater，直装版保留现有链路，避免“两套更新打架”；
3. MSIX 是 beta 工具链，若真机验证不通过（托盘/通知等），NSIS 渠道仍是可发布兜底，风险可控。

不推荐“只做 MSIX”：依赖升级 + 真机风险集中且无自管更新兜底；也不推荐“只做 AppX 旧目标”：缺 .msixupload 与多架构 bundle，商店路径过时。

### 4.2 实施步骤与工作量估算（供协调者拆卡）

| 步骤 | 内容 | 估算 |
| --- | --- | --- |
| 1 | 协调者批准 electron-builder 升级至 27.0.0-alpha.x（或等稳定版）；electron-builder.yml 增加 msix target、identityName/publisher 占位、languages=[zh-CN,en-US]；assets/appx 生成 4+ 个 logo | 0.5–1 人日 |
| 2 | updater.js/main.js 加 `process.windowsStore` 守卫；托盘商店版更新项处理；启动时输出 userData 路径便于验证 | 0.5–1 人日 |
| 3 | 本地 MSIX 构建 + 开发者证书签名 + `Add-AppxPackage` 安装；逐项真机验证（userData/单实例/托盘/通知/safeStorage/卸载/数据隔离） | 1–2 人日 |
| 4 | CI（GitHub Actions windows-latest）增加 msix 构建与 .msixupload 产物断言（check.js 追加，属协调者维护范围） | 0.5 人日 |
| 5 | Partner Center 名称保留后回填真实身份、隐私 URL；复用 T-46 素材包提交 | 0.5 人日 |
| 6 | 回归：check/smoke、商店版与直装版并存测试、文档（本报告→实施记录） | 0.5 人日 |

合计约 **3.5–5.5 人日**；主要不确定性在 beta 工具链与真机行为，不建议在 09-01 上线前一周才做。

## 5. 风险清单

| # | 风险 | 等级 | 缓解 |
| --- | --- | --- | --- |
| 1 | electron-builder MSIX 目标为 beta，配置/产物可能随版本变化 | 高 | 升级后固定版本并重测；保留 appx 与 NSIS 回退 |
| 2 | 商店版误用 electron-updater 导致更新报错/安装失败 | 高 | `process.windowsStore` 守卫 + 商店版禁用自更新 |
| 3 | MSIX 托盘/通知在真实环境行为未经验证 | 中 | 真机安装冒烟 + 商店认证测试；失败可回退 NSIS 上架评估 |
| 4 | 商店版与直装版 userData 隔离，用户数据不迁移 | 中 | 首次运行说明/迁移引导；文档明示 |
| 5 | MSIX 卸载清除全部数据，用户可能误删记忆 | 中 | 设置页“导出/备份”引导；卸载前提示 |
| 6 | 升级 27 alpha 可能影响现有 NSIS 打包/check 断言 | 中 | 独立分支升级、check/smoke 回归、CI 双 target 验证 |
| 7 | 工具链下载（windows-kits-bundle）依赖网络与缓存 | 低–中 | CI 缓存；失败时用本机 SDK（ELECTRON_BUILDER_WINDOWS_KITS_PATH） |
| 8 | 身份/证书不匹配导致安装失败 | 低 | 商店代签（publisher 由商店回填）；侧载自签仅开发 |
| 9 | 商店审核政策（AI 对话/UGC/隐私/遥测） | 中 | T-46 素材、IARC、隐私 URL、遥测默认关闭说明 |

## 6. 参考链接

- electron-builder MSIX 官方文档：https://www.electron.build/docs/msix/
- electron-builder AppX 官方文档：https://www.electron.build/docs/appx/
- MSIX 目标引入提交：https://github.com/electron-userland/electron-builder/commit/d94a0999a5a77636319be6ce115cea8e9394ee8d
- Electron autoUpdater（MSIX 分支）：https://www.electronjs.org/docs/latest/api/auto-updater
- Electron process.windowsStore：https://www.electronjs.org/docs/latest/api/process
- Electron safeStorage：https://www.electronjs.org/docs/latest/api/safe-storage
- Electron 通知教程：https://www.electronjs.org/docs/latest/tutorial/notifications
- Electron Forge MSIX maker：https://www.electronforge.io/config/makers/msix
- 微软 winapp CLI Electron 打包指南：https://learn.microsoft.com/en-us/windows/apps/dev-tools/winapp-cli/guides/electron-packaging
- MSIX 容器化概览（全信任/干净卸载）：https://github.com/microsoftdocs/msix-docs/blob/main/msix-src/msix-containerization-overview.md
- Electron userData（AppX）issue：https://github.com/electron/electron/issues/39636

## 7. 边界与合规声明

- 本任务只新增 `docs/store/msix-validation.md` 与更新 `docs/tasks/T-47.md`；未触碰 package.json、package-lock.json、electron-builder.yml、.github/**、src/**、scripts/orchestrator/** 及其余 docs/**。
- 本地实验仅：npm pack 到 %TEMP% 解包检查（app-builder-lib@26.15.7 / 27.0.0-alpha.6）、读取 node_modules 与官方/社区文档；未安装 MSIX、未执行真实打包（受“不改依赖/配置”边界约束）、未注册账号、未购买、未提交商店。
- 无密钥/token 写入；无外部副作用。
