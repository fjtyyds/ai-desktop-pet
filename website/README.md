# AI 桌宠官网落地页（website/）

纯静态站（HTML + CSS），无构建步骤、无外部依赖（不引 CDN/字体/脚本），
手机与桌面自适应，可直接托管到 GitHub Pages 或任意静态托管。

## 本地预览

```powershell
# 方式一：直接打开
start .\index.html

# 方式二：本地静态服务器（推荐，路径与线上一致）
python -m http.server 8080 -d .
# 然后访问 http://localhost:8080
```

## 发布前必改的占位内容

- `index.html` 中“从 GitHub Release 下载”链接：
  当前为 `https://github.com/your-org/ai-desktop-pet/releases/latest`，
  发布 v1.0 后替换为真实仓库地址（`your-org` → 实际组织/用户名）。
- 页脚 GitHub 链接与联系邮箱：`hello@example.com` → 真实地址。
- 定价、皮肤市场价格与权益以正式发布为准，发布前与协调者核对一次。
- 隐私说明上线前需替换为完整隐私政策正文或链接。

## 部署到 GitHub Pages（发布时由协调者执行）

仓库根目录 `Settings → Pages`，选择分支（如 `gh-pages`）或 `main` + `/website`
目录作为发布源，即可直接托管本目录。

## 内容维护

- 页面结构：`index.html`（语义化 section，锚点：features / skin-market / pricing /
  privacy / download / faq）
- 视觉样式：`style.css`（CSS 变量统一色板；两个断点：900px、600px）
- 无 JavaScript：所有交互（FAQ 展开、平滑锚点）均为原生 HTML/CSS。

## 与 T-45 其他产物的关系

- 应用内“对话卡片”尺寸为 1080×1350（4:5），与社媒素材规范
  `docs/marketing/social-copy.md` 对齐。
- 官网文案依据 `docs/reports/2026-08-11-商业化上线方案.md` 的定位与定价体系。
