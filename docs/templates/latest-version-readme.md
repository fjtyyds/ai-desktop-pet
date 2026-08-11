# AI桌宠 最新版

本目录由 `E:\codex\AI桌宠\scripts\sync-latest.ps1` 自动生成，随项目 main 分支每次合并后同步更新（ADR-042）。

- 版本：{{VERSION}}
- 构建提交：{{COMMIT}}
- 同步时间：{{DATE}}

## 文件清单

| 文件 | 大小 | SHA256 |
| --- | --- | --- |
{{FILE_ROWS}}

## 使用说明

- `*-Setup.exe`：Windows 安装包（NSIS），双击安装；配套 `.blockmap` 与 `latest.yml` 用于自动更新源（GitHub Releases 或本地更新服务器）。
- `*.msix` / `*.msixupload`：Microsoft Store 打包产物（当前为占位身份、未签名，仅用于 Store 提审/侧载验证）。
- 本目录内容为构建产物副本，源码与构建配置以 git 仓库为准；安装与更新链路说明见 `docs/store/`。
