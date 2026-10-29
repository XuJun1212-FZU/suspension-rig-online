# 悬架试验台架 · 在线登录与共享参数版

基于 `Suspension_Rig_3C_5C_V4.html`，保留原三缸 / 五缸计算、运动演示、双方案对比、JSON 导出和完整打印功能。

在线工作台：[打开网页](https://suspension-rig-workspace.rainycorgi11.chatgpt.site)。首次由站点所有者在网页中设置账号密码，之后成员使用站点账号密码登录。参数和更新日志保存在服务器数据库中。

源码仓库：[XuJun1212-FZU/suspension-rig-online](https://github.com/XuJun1212-FZU/suspension-rig-online)。本仓库保存源代码，生产账号密码、运行时密钥和数据库内容不在仓库中。GitHub 代码上传与现有 Sites 发布分别管理。

## 普通浏览器独立部署

已提供可独立运行的 Node.js 服务、Dockerfile 和 Railway 配置，详情见 [DEPLOY_RAILWAY.md](DEPLOY_RAILWAY.md)。这个运行方式直接显示站点账号密码界面，不依赖 ChatGPT 登录。部署时必须挂载持久化磁盘，才能保留账号、参数和更新日志。独立服务的正式网址需要在托管账号连接并成功部署后生成；上面的旧 Sites 地址不能代替这一步。

本地服务端检查共 23 项通过，含实际 HTTP 服务器、HTTPS 会话、服务重启持久化、密码修改及会话失效、批量账号创建与旧数据兼容；本机未安装 Docker，容器构建需要在部署平台执行验证。

## 已实现

- 服务端验证账号密码；未登录不能读取工作台、参数和更新日志。
- 登录页面和工作台提供“修改密码”窗口，需输入账号、原密码、新密码及确认密码；修改成功后旧密码和旧登录会话失效。
- 支持通过临时运行时私密配置批量增加账号，重复配置不会重置已有账号的密码；实际账号和默认密码不写入源码仓库。
- 30 个数值参数、横梁倾转开关、当前方案视图保存到数据库，全部登录者共用同一份最新参数。
- 点击“保存参数”打开更新日志表单，必填更新人和更新内容；登录账号、时间及版本由服务器记录。
- 参数快照和对应日志作为同一条版本记录提交，服务器确认成功后才显示“已保存”。
- 点击“保存并退出”或“退出登录”，如有修改，可选择保存、放弃修改或继续编辑。
- 直接关闭 / 刷新 / 离开标签页，如有未保存修改，触发浏览器原生离开提示。浏览器不允许在标签页关闭之后再弹出日志表单；需要在离开提示中选择留在页面，再通过“保存参数”完成登记。
- 再次进入时读取数据库最新版本；支持历史日志分页及历史版本参数导出。
- 多个页面同时保存时，旧版本提交会被拒绝，避免覆盖他人的修改。当前输入保留，可先导出 JSON 再读取最新版本。
- 保存请求支持重复提交去重；网络失败不会冒报保存成功。

成员使用各自的站点账号密码登录，共享同一份最新参数；实际更新人另行登记。没有内置生产账号或默认密码。

## 验证与发布

本地源码和构建产物已经生成；10 项服务端集成测试通过。原始 HTML 副本与用户提供文件的 SHA-256 一致。

线上站点已发布，登录页可公开打开，工作台和数据由站点账号密码保护。可视化操作及手机布局尚未完成浏览器验证。用户原始 HTML 和现有个人主页均未修改。

Sites 项目身份已写入 `.openai/hosting.json`；继续发布时复用此身份，不要重复创建。该站点的首次初始化使用 Sites 所有者的 ChatGPT 身份校验，不需要在聊天或源码中提供密码。所有者打开页面后直接设置站点账号和密码。

## 本地使用（Windows，Node.js 24 或以上）

在此项目文件夹运行：

```powershell
node scripts/build.mjs
node scripts/dev.mjs
```

也可以双击 `启动本地工作台.cmd`。终端会显示本地地址和一次性初始化密钥。打开本地地址后，填写自己设置的账号、至少 12 位密码和该密钥，完成首次初始化。不要把密码或初始化密钥提交到 GitHub。

本地数据库位于 `.local/rig.sqlite`，关闭服务后再启动，账号、参数和日志会保留；初始化页面不会再次开放。只有本机能访问本地服务。退出本地服务可在其终端按 Ctrl+C。

本地地址只用于本机，不能替代公网网址。本地数据库与线上 D1 数据库各自独立。

## 通过 GitHub + Cloudflare 发布

GitHub Pages 仅适合静态页面；此项目的账号验证和共享数据库由 Cloudflare Worker + D1 提供。仓库包含手动触发的 GitHub Actions 工作流，不会在普通推送时自动部署。

1. 将本项目源码存放于专用仓库。不要上传 `.local/`、数据库文件、密码或令牌，也不要把压缩包当作站点源码直接上传。
2. 在自己的 Cloudflare 账户创建名为 `suspension-rig-db` 的 D1 数据库，保留实际数据库 ID。
3. 在仓库 Settings → Secrets and variables → Actions 中设置以下项目。

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | 有权限部署 Worker、执行 D1 迁移的 Cloudflare 令牌 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 自己的 Cloudflare 账户 ID |
| Secret | `RIG_SETUP_TOKEN` | 自己生成的高强度随机初始化密钥，建议至少 32 字节 |
| Variable | `CLOUDFLARE_DATABASE_ID` | 已创建的实际 D1 数据库 ID |
| Variable（可选） | `CLOUDFLARE_WORKER_NAME` | 已确定的 Worker 名称；默认 `suspension-rig-online` |

4. 在 Actions → Deploy suspension rig → Run workflow 手动运行。工作流构建、检查、迁移数据库、部署 Worker 并配置初始化密钥。以实际成功输出的网址为准。
5. 打开部署网址，在首次配置页面设置站点账号密码，输入 `RIG_SETUP_TOKEN` 的值。初始化只允许完成一次，之后打开的是登录页面。
6. 使用站点账号登录并验证一次修改、日志提交和重新打开读取。首次上线必须再做实际浏览器验收。

如果使用 Sites 发布，源码包含真实的 `.openai/hosting.json` 项目身份和 D1 迁移；由 Sites 发布工具配置数据库。Sites 的 `SETUP_OWNER_EMAIL` 已作为运行时 Secret 配置，仅站点所有者可以首次设置账号密码。这个 Secret 只能用于 Sites 的受信任身份网关，不能配置到直接对外的普通 Worker 上。

## 检查

不需要安装项目依赖：

```powershell
node scripts/build.mjs
node scripts/validate-artifact.mjs
node --test tests/server.test.mjs
```

10 项检查覆盖：匿名拦截、一次性初始化与密码哈希、登录退出与会话过期、跨登录共享和重启持久化、必填日志和参数校验及 CSRF、并发保存和去重、登录限流、历史分页及导出、异常请求处理、Sites 所有者首次配置权限。测试数据库是临时数据，不会写入生产库。

`tests/preview.mjs` 只用于本机界面调试，使用内存数据库和公开的测试凭据；绝不能作为生产启动命令。真正本地使用运行 `scripts/dev.mjs`；生产入口是构建后的 `dist/server/index.js`。

## 文件

- `web/workspace.html`：原网页完整副本。
- `web/login.html`、`web/login.js`、`web/cloud.css`：登录界面及附加样式。
- `web/app.js`：保存、退出确认、日志页面及云端状态。
- `worker/server.js`：服务端身份验证和数据库 API。
- `drizzle/0000_rig.sql`：数据库结构迁移，不含账号、密码、业务数据。
- `scripts/build.mjs`：将网页和资源嵌入单个 Worker；不对外发布静态工作台。
- `.github/workflows/deploy.yml`：手动触发的生产部署流程。

部署时需使用 HTTPS。会话通过 HttpOnly、Secure、SameSite Cookie 保存，12 小时到期；数据库保存加盐 PBKDF2 密码哈希。令牌保存在部署平台 Secrets 中。

参考：[GitHub Pages 限制](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)、[Cloudflare D1 配置](https://developers.cloudflare.com/d1/get-started/)、[Wrangler 命令](https://developers.cloudflare.com/workers/wrangler/commands/)、[浏览器离开提示的限制](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)。
