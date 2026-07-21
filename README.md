<h1 align="center">Emerald Theme for CF Server Monitor</h1>

<p align="center">基于 Vue 3 + Vite + reka-ui + Tailwind CSS v4 构建的 CF Server Monitor主题</p>

<p align="center">支持一键部署到 Vercel、Cloudflare、EdgeOne、Github Pages，也可自部署到 VPS 或其他静态服务器。</p>

![preview](/docs/preview.png)

## 功能

- 卡片和表格两种节点视图
- 多分组、搜索、地区旗帜和操作系统图标
- CPU、内存、磁盘、流量、网络和 Ping 历史图表
- `CF Server Monitor` WebSocket 实时更新与断线重连
- 单后端 Turnstile 验证
- 多后端聚合，详情页保留数据源信息
- 深色、浅色和跟随系统主题
- Hash 路由，可部署到 `Vercel` `Cloudflare` `EdgeOne` `Github Pages` 或其他静态服务器

## 一键部署

|                 | Vercel                                                                                                                                                    | Cloudflare                                                                                                                                                                    | EdgeOne                                                                                                                                                                                                                   | Github Pages |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
|                 | [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Tokinx/cf-server-monitor-theme-emerald) | [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Tokinx/cf-server-monitor-theme-emerald) | [![使用 EdgeOne Makers 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https://github.com/Tokinx/cf-server-monitor-theme-emerald&env=API_BASE,PROXY_BACKEND) | /            |
| API_BASE        |                                                                                                                                                           | https://monitor.example.com                                                                                                                                                   |
| PROXY_BACKEND   | **true** / false                                                                                                                                          | **true** / false                                                                                                                                                              | **true** / false                                                                                                                                                                                                          | **不支持**   |
| PROXY_WEBSOCKET | **不支持**                                                                                                                                                | true / **false**                                                                                                                                                              | **不支持**                                                                                                                                                                                                                | **不支持**   |

- `API_BASE` 是 CF Server Monitor Worker 的地址，例如 `https://monitor.example.com`。
- `PROXY_BACKEND` 开启后 `/api`、`/flags`、`/os-icons` 将通过代理转发到 `API_BASE`，可起到一定的加速作用
- `PROXY_WEBSOCKET` 开启后 WebSocket 将通过代理转发到 `API_BASE`，可起到一定的加速作用（Vercel、EdgeOne 与 Github Pages 不支持）。
- Cloudflare Workers / Pages 会在返回页面时读取运行时环境变量，无需在 Vite 构建阶段额外注入；在 Cloudflare 控制台修改变量并重新部署后即可生效。

## 主题设置

拷贝&调整下方参数，将其填入到 **CF Server Monitor** 后端设置页面的 `主题自定义配置 JSON` 中并保存。

```
{
  "configuration": [
    {
      "key": "defaultViewMode",
      "value": "card",
      "options": "card,list",
      "description": "节点列表的默认显示模式"
    },
    {
      "key": "alertEnabled",
      "value": "false",
      "options": "",
      "description": "在首页显示自定义公告"
    },
    {
      "key": "alertTitle",
      "value": "",
      "options": "",
      "description": "公告的标题内容"
    },
    {
      "key": "alertContent",
      "value": "",
      "options": "",
      "description": "公告的详细内容（支持简单 Markdown 格式）"
    },
    {
      "key": "earthViewMode",
      "value": "maps",
      "options": "earth,earth-stop,maps,cards,hide",
      "description": "earth：自转地球；earth-stop：静止地球；maps：点状地图；cards：仅显示头部卡片；hide：隐藏整个头部"
    },
    {
      "key": "visitorInfoCardEnabled",
      "value": "true",
      "options": "",
      "description": "显示访客来源、设备和浏览器信息卡片"
    },
    {
      "key": "hideAdminEntryWhenLoggedOut",
      "value": "false",
      "options": "",
      "description": "隐藏顶部管理后台按钮"
    },
    {
      "key": "disablePageAnimation",
      "value": "false",
      "options": "",
      "description": "减少页面过渡动画效果，提升访问速度和响应性"
    },
    {
      "key": "icpEnabled",
      "value": "false",
      "options": "",
      "description": "在页脚显示网站备案号"
    },
    {
      "key": "icpNumber",
      "value": "",
      "options": "",
      "description": "网站备案号（如：京ICP备12345678号）"
    },
    {
      "key": "icpUrl",
      "value": "https://beian.miit.gov.cn/",
      "options": "",
      "description": "点击备案号跳转的链接地址"
    },
    {
      "key": "policeEnabled",
      "value": "false",
      "options": "",
      "description": "在页脚显示公安备案信息"
    },
    {
      "key": "policeNumber",
      "value": "",
      "options": "",
      "description": "公安备案号（如：京公网安备 11010502000000号）"
    },
    {
      "key": "policeUrl",
      "value": "",
      "options": "",
      "description": "点击公安备案号跳转的链接地址，留空则不跳转"
    },
    {
      "key": "backgroundEnabled",
      "value": "false",
      "options": "",
      "description": "启用后可设置自定义图片或视频作为页面背景"
    },
    {
      "key": "backgroundType",
      "value": "image",
      "options": "image,video",
      "description": "选择背景类型：图片或视频"
    },
    {
      "key": "lightBackgroundUrl",
      "value": "",
      "options": "",
      "description": "亮色模式下的背景图片/视频 URL"
    },
    {
      "key": "darkBackgroundUrl",
      "value": "",
      "options": "",
      "description": "暗色模式下的背景图片/视频 URL"
    },
    {
      "key": "backgroundBlur",
      "value": "0",
      "options": "",
      "description": "背景的高斯模糊半径（单位：px），0 表示不模糊"
    },
    {
      "key": "backgroundOverlay",
      "value": "0",
      "options": "",
      "description": "背景遮罩强度（-100 到 100）：负数降低背景透明度，0 表示关闭，正数为黑色遮罩，绝对值越大效果越明显"
    }
  ]
}
```

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
CSP_API=
CSP_STATIC=
BASE_PATH=./
```

`API_BASE` 支持用英文逗号配置多个 Worker。开发模式会把同源 `/api` 请求代理到单个 `API_BASE`，避免本地 CORS 限制。Cloudflare 部署会从 `wrangler.toml`（Pages 则为 `wrangler.pages.toml`）的 `[vars]` 读取这些配置，并在运行时写入页面。

当设置 `PROXY_BACKEND=true` 时，HTTP 请求使用同源 `/api`、`/flags/xxx` 和 `/os-icons/xxx`，这要求部署平台提供反向代理。`PROXY_WEBSOCKET=true` 时，WebSocket 也使用同源 `/api/ws`；Cloudflare Worker 和 Pages 会透传升级请求。`PROXY_WEBSOCKET=false` 时，WebSocket 直连构建时的 `API_BASE`，适用于不支持 WebSocket 代理的 Vercel、EdgeOne 和 GitHub Pages。

## 构建

```bash
bun run lint
bun run build
bun run preview
```

产物位于 `dist/`。纯静态部署时，构建会将 `API_BASE` 写入 `index.html` 的 `meta[name="apiBase"]`；Cloudflare Workers / Pages 则由运行时中间件写入。跨域直连部署还需在 CF Server Monitor Worker 中将站点域名加入 `CORS_ALLOWED_ORIGINS`。

GitHub Pages 项目站点可将 `BASE_PATH` 设置为仓库路径，例如 `/cf-server-monitor-theme-emerald/`；自定义域名和其他静态平台通常保留 `./` 即可。

### 主题开发文档：

- [CF-Server-Monitor项目地址](https://github.com/huilang-me/CF-Server-Monitor)
- [开发指南](https://github.com/huilang-me/CF-Server-Monitor/blob/main/develop.md)
- [前端API文档](https://github.com/huilang-me/CF-Server-Monitor/blob/main/theme-develop.md)
- [后端API文档](https://github.com/huilang-me/CF-Server-Monitor/blob/main/API.md)

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
