# 代码签名评估报告（T-46）

> 状态：评估完成（2026-08-11）；**只出报告，不采购**。
> 目标：降低 GitHub 直装版（NSIS 安装包）的 SmartScreen 提示；MS Store 与 Steam 渠道见“结论”。

## 1. 背景与现状

- 现状：`npm run dist` 产物为未签名 NSIS 安装包（ai-desktop-pet-*-Setup.exe），经 GitHub Releases 分发时 Windows SmartScreen 会提示“未知发布者”。
- 渠道影响：
  - GitHub/官网直装版：需要代码签名（推荐）。
  - Microsoft Store（MSIX 路径）：微软免费代签，**无需自购证书**；若走 MSI/EXE 提审路径则必须使用受信任 CA 证书签名。
  - Steam：经 Steam 客户端分发运行，**不要求 Windows 代码签名**。

## 2. 证书类型对比

| 维度 | OV（组织验证） | EV（扩展验证） | Azure Artifact Signing（原 Trusted Signing） |
| --- | --- | --- | --- |
| 身份核验 | 组织资质文件核验，数天~2 周 | 更严格（电话/文件+人工），1~3 周 | Microsoft Entra 身份核验（组织或个人），数天 |
| 年成本 | $150~300（SSL.com 等促销可低至 ~$75/年） | $300~600+ 另加硬件令牌 | Basic $9.99/月（5,000 次签名/月，超出 $0.005/次）；Premium $99.99/月（100,000 次） |
| 私钥保管 | 软件/云或令牌 | 硬件令牌（USB/HSM）强制 | 微软 HSM 托管，无本地私钥 |
| SmartScreen 影响 | 新证书靠下载量积累信誉，新发布常见提示 | 2024 年起与 OV 相同，**不再即时绕过** SmartScreen | 信任链含微软，提示显著减少，但官方仍不承诺绝对免提示 |
| CI/CD 集成 | 需导入 pfx/云签名服务 | 需令牌守护/云 HSM，运维重 | 原生支持 electron-builder `win.azureSignOptions`，最适合 CI |
| 内核驱动签名 | 不支持 | 支持 | 支持（本项目不需要） |
| 适用场景 | 官网直装、MSI/EXE 提审 | 高信誉/驱动/企业强制场景 | 本项目 GitHub 直装版首选 |

## 3. SmartScreen 机制说明

- SmartScreen 基于“信誉”判断：下载量、签名者历史、证书时间戳等。新证书/新发布出现提示属正常现象，持续发布与稳定下载可逐步消除。
- 微软官方口径：EV 自 2024 年起不再提供即时 SmartScreen 绕过，与 OV 同等待遇。
- 缓解措施：固定发布节奏、每次发布签名+时间戳（RFC 3161）、官网提供 SHA-256 校验值与安装指引、下载源保持单一可信域名。

## 4. 推荐方案

1. **首选：Azure Artifact Signing Basic（$9.99/月）**
   - 成本最低（首年约 $120），无需硬件令牌与私钥管理；
   - 与 CI 原生集成：electron-builder `win.azureSignOptions`（endpoint / certificateProfileName / publisherName / 认证经环境变量注入，不写入仓库）；
   - 适合 GitHub Releases 自动签名，覆盖直装版与未来 MSI/EXE 提审路径。
2. **备选：OV 证书（$150~300/年）**
   - 团队希望脱离 Azure 或需要自有证书时选择；购买后私钥经 CI secret 注入。
3. **不推荐：EV**
   - SmartScreen 无额外收益、成本与运维高；本项目无内核驱动签名需求。
4. **MS Store**：MSIX 路径微软代签，无需本方案；Steam：无需签名。

## 5. 预算与前置条件

| 方案 | 首年预算 | 前置 |
| --- | --- | --- |
| Azure Artifact Signing Basic | ~$120 | Azure 订阅 + 身份核验（1~2 周）、electron-builder 配置 |
| OV | $150~300 | 企业资料（营业执照等）、CA 审核 |
| EV | $400+ | 更严格资料 + 硬件令牌 |

实施（Azure 订阅/证书购买）涉及外部账号与资金，**待用户确认后另行派发**。

## 6. 遗留风险

- SmartScreen 提示无法 100% 消除，首次发布仍可能出现“更多信息/仍要运行”提示。
- Azure Artifact Signing 依赖微软服务可用性与配额（Basic 5,000 次/月，本项目发布频率远低于此）。
- 若未来选择 MSI/EXE 提审路径，签名证书还须满足微软对安装程序与 PE 文件的额外要求（静默安装、时间戳等）。
