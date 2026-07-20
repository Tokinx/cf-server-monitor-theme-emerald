# Emerald Theme for CF Server Monitor

基于 Vue 3 + Vite + reka-ui + Tailwind CSS v4 构建的 [CF Server Monitor](https://github.com/huilang-me/CF-Server-Monitor) 主题

## 功能

- 卡片和表格两种节点视图
- 多分组、搜索、地区旗帜和操作系统图标
- CPU、内存、磁盘、流量、网络和 Ping 历史图表
- CF Server Monitor WebSocket 实时更新与断线重连
- 单后端 Turnstile 验证
- 多后端聚合，详情页保留数据源信息
- 深色、浅色和跟随系统主题
- Hash 路由，可部署到 GitHub Pages、Cloudflare Pages、Vercel 或普通静态服务器

## 一键部署

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Tokinx/cf-server-monitor-theme-emerald)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Tokinx/cf-server-monitor-theme-emerald)

部署后在平台设置 `API_BASE`，然后重新部署或保存变量：

- Vercel：设置项目环境变量 `API_BASE=https://monitor.example.com`。`build:vercel` 会自动启用 HTTP 代理，将 `/api`、`/flags`、`/os-icons` 转发到该后端；WebSocket 会直接连接 `API_BASE`，不经过 Vercel Function。后端必须允许 Vercel 站点的 `Origin`。
- Cloudflare Workers：默认不启用代理。直连模式下，在构建环境设置 `API_BASE=https://monitor.example.com`；需要代理时，同时设置构建环境和 Worker 变量 `PROXY_BACKEND=true`，并设置运行时变量 `API_BASE`，此时 WebSocket 也会被转发。
- Cloudflare Pages：默认不启用代理。直连模式下，在构建环境设置 `API_BASE=https://monitor.example.com`；需要代理时设置 Pages 环境变量 `PROXY_BACKEND=true` 和 `API_BASE`，仓库内的 `functions/_middleware.ts` 会代理相同路径。
- GitHub Pages：首次使用前进入仓库 Settings > Pages，将 Build and deployment 的 Source 设置为 `GitHub Actions`；然后启用仓库的 `Deploy GitHub Pages` Action，并在 Settings > Secrets and variables > Actions > Variables 中设置 `API_BASE`。GitHub Pages 不能运行反向代理，因此使用后端直连模式。默认 `GITHUB_TOKEN` 无法代替这次 Pages 启用操作。

`API_BASE` 是 CF Server Monitor Worker 的地址，例如 `https://monitor.example.com`。代理模式只支持单个后端地址。

## 开发

```bash
bun install
cp .env.example .env
bun run dev
```

`.env` 示例：

```dotenv
API_BASE=https://monitor.example.com
PROXY_BACKEND=false
PROXY_WEBSOCKET=true
TITLE=CF Server Monitor
BACKGROUND_IMAGE=
CSP_API=
CSP_STATIC=
BASE_PATH=./
```

`API_BASE` 支持用英文逗号配置多个 Worker。开发模式会把同源 `/api` 请求代理到单个 `API_BASE`，避免本地 CORS 限制。

当设置 `PROXY_BACKEND=true` 时，前端不再把 `API_BASE` 写入浏览器请求地址，而是使用同源 `/api`、`/flags/xxx` 和 `/os-icons/xxx`。这要求部署平台提供反向代理；Vercel、Cloudflare Workers 和 Cloudflare Pages 已提供对应配置。Vercel 的 `build:vercel` 会让 HTTP 使用 Function 代理、WebSocket 直连 `API_BASE`，避开不支持升级的 Function；Cloudflare Worker 和 Pages 的代理会透传 WebSocket 升级，保持实时更新。

## 构建

```bash
bun run lint
bun run build
bun run preview
```

产物位于 `dist/`。纯静态部署时，构建会将 `API_BASE` 写入 `index.html` 的 `meta[name="apiBase"]`。跨域直连部署还需在 CF Server Monitor Worker 中将站点域名加入 `CORS_ALLOWED_ORIGINS`。

GitHub Pages 项目站点可将 `BASE_PATH` 设置为仓库路径，例如 `/cf-server-monitor-theme-emerald/`；自定义域名和其他静态平台通常保留 `./` 即可。

## 运行时约定

- 路由：`/#/`、`/#/server/:id`
- 后端管理入口：`${API_BASE}/#/admin`
- 未配置 `apiBase` 时默认使用当前页面 origin
- `PROXY_BACKEND=true` 时请求使用当前站点的 `/api`、`/flags` 和 `/os-icons`
- 多后端模式下不支持任一源站开启 Turnstile
- 匿名用户仅查询 1 小时以内的历史数据，符合 CF Server Monitor API 权限限制

## 致谢

- [Tokinx/komari-theme-emerald](https://github.com/Tokinx/komari-theme-emerald)
- [huilang-me/CF-Server-Monitor](https://github.com/huilang-me/CF-Server-Monitor)
- [huilang-me/CF-Server-Monitor-theme](https://github.com/huilang-me/CF-Server-Monitor-theme)

## License

[MIT](./LICENSE)
