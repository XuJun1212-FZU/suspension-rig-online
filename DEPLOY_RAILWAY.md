# 部署独立浏览器访问版

源码已经具备完整的独立 HTTP 服务。部署成功后，使用平台实际返回的 HTTPS 公网域名；不预先编造域名。

## 服务配置

- 源码仓库：`XuJun1212-FZU/suspension-rig-online`，分支 `main`。
- 使用仓库根目录的 `Dockerfile` 构建，启动 `node scripts/serve.mjs`。
- 挂载一个持久化 Volume 到 `/data`。账号、参数、更新日志存放在 `/data/rig.sqlite`。
- 只运行一个服务实例；多个浏览器共用这一份服务器数据库。
- 启用公网域名和 HTTPS，健康检查路径为 `/healthz`。

## 运行时环境变量

| 名称 | 设置 |
| --- | --- |
| `PUBLIC_ORIGIN` | 实际 HTTPS 公网地址，只有协议和域名，不带路径；如果平台提供 `RAILWAY_PUBLIC_DOMAIN` 可自动使用它 |
| `RIG_SETUP_TOKEN` | 至少 32 个随机字符的初始化密钥，作为私密环境变量配置，不写入 GitHub |
| `DATA_DIR` | `/data` |
| `PORT` | 使用平台分配的监听端口，未分配时默认 `3000` |

Railway 挂载的 Volume 属于 root；本 Docker 镜像使用默认容器用户以兼容该挂载。该服务使用 Railway 的 `X-Real-IP` 头识别来源地址，用于登录限流。`PUBLIC_ORIGIN` 决定 Cookie 的 HTTPS 属性和跨站请求校验，不依据客户端伪造的协议头。

独立 Node 服务主动丢弃 Sites 的身份请求头，不能通过提交 `oai-authenticated-user-email` 等头绕过首次配置。不要为此独立服务设置 `SETUP_OWNER_EMAIL`。

## 首次使用

部署成功后，在实际公网网址设置站点账号、至少 12 位密码，并输入部署者持有的初始化密钥。初始化只允许完成一次。之后其他使用者只需站点账号密码，不需要 ChatGPT 账号。

如果原站点已经保存过数据，迁移前需要保留原数据库记录，迁移到新数据库后再切换大家使用的链接。未迁移时，两套站点不会自动共享数据库。

## 验证

```powershell
node scripts/build.mjs
node scripts/validate-artifact.mjs
node --test tests/server.test.mjs tests/http-server.test.mjs
```

目前本地 16 项检查通过。正式发布后仍需确认外部网络的登录页返回成功、登录后保存参数、退出再进入读取一致，以及服务重启后记录仍在。Docker 构建与公网访问需在实际部署后确认。

参考：[公网访问](https://docs.railway.com/networking/public-networking)、[持久化 Volume](https://docs.railway.com/volumes)、[请求头](https://docs.railway.com/networking/public-networking/specs-and-limits)、[配置文件](https://docs.railway.com/config-as-code)。
