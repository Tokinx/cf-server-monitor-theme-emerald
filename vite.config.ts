import { execSync } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { defineConfig, loadEnv } from 'vite'

const AMPERSAND_REGEX = /&/g
const DOUBLE_QUOTE_REGEX = /"/g
const LESS_THAN_REGEX = /</g
const GREATER_THAN_REGEX = />/g
const API_BASE_META_REGEX = /<meta name="apiBase" content="[^"]*"\s*\/?>/
const WEBSOCKET_BASE_META_REGEX = /<meta name="webSocketBase" content="[^"]*"\s*\/?>/
const PROXY_BACKEND_META_REGEX = /<meta name="proxyBackend" content="[^"]*"\s*\/?>/
const PROXY_WEBSOCKET_META_REGEX = /<meta name="proxyWebSocket" content="[^"]*"\s*\/?>/

function getCommitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  }
  catch {
    return 'unknown'
  }
}

function splitList(value: string | undefined): string[] {
  return value?.split(',').map(item => item.trim()).filter(Boolean) ?? []
}

function escapeHtml(value: string): string {
  return value
    .replace(AMPERSAND_REGEX, '&amp;')
    .replace(DOUBLE_QUOTE_REGEX, '&quot;')
    .replace(LESS_THAN_REGEX, '&lt;')
    .replace(GREATER_THAN_REGEX, '&gt;')
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
      return null
    return url.origin
  }
  catch {
    return null
  }
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBases = splitList(env.API_BASE).map(normalizeOrigin).filter((value): value is string => Boolean(value))
  const isVercelBuild = mode === 'vercel'
  const isCloudflareBuild = mode === 'cloudflare'
  const isEdgeOneBuild = mode === 'edgeone'
  // Vercel Functions can proxy HTTP requests, but cannot relay WebSocket upgrades.
  const proxyBackend = isVercelBuild || env.PROXY_BACKEND?.toLowerCase() === 'true'
  const proxyWebSocket = isEdgeOneBuild ? false : env.PROXY_WEBSOCKET?.toLowerCase() !== 'false'
  // Direct WebSocket connections need their own base when HTTP still uses a proxy.
  const webSocketBases = proxyWebSocket ? [] : (proxyBackend ? apiBases.slice(0, 1) : apiBases)
  const cspApi = splitList(env.CSP_API).map(normalizeOrigin).filter((value): value is string => Boolean(value))
  const cspStatic = splitList(env.CSP_STATIC).map(normalizeOrigin).filter((value): value is string => Boolean(value))
  const outboundProxy = env.HTTPS_PROXY || env.HTTP_PROXY
  const outboundProxyAgent = outboundProxy ? new HttpsProxyAgent(outboundProxy) : undefined
  const connectOrigins = new Set<string>([
    ...apiBases,
    ...cspApi,
    'https://api.iconify.design',
    'https://api.unisvg.com',
    'https://api.simplesvg.com',
    'https://api.frankfurter.app',
    'https://api.frankfurter.dev',
    'https://open.er-api.com',
    'https://api.ip.sb',
    'https://ipwho.is',
    'https://api.ipapi.is',
    'https://ipapi.co',
    'https://api.vore.top',
  ])
  for (const origin of [...connectOrigins]) {
    if (origin.startsWith('https://'))
      connectOrigins.add(origin.replace('https://', 'wss://'))
    if (origin.startsWith('http://'))
      connectOrigins.add(origin.replace('http://', 'ws://'))
  }

  return {
    base: env.BASE_PATH || './',
    define: {
      __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version || '1.0.0'),
      __BUILD_GIT_HASH__: JSON.stringify(getCommitHash()),
    },
    plugins: [
      vue(),
      tailwindcss(),
      {
        name: 'cf-server-monitor-runtime-config',
        transformIndexHtml(html) {
          let result = html
          // Cloudflare variables are runtime Worker bindings, so its Worker injects
          // these values when serving HTML instead of baking them into dist/.
          if (command === 'build' && !isCloudflareBuild && apiBases.length) {
            result = result.replace(
              API_BASE_META_REGEX,
              `<meta name="apiBase" content="${escapeHtml(apiBases.join(','))}" />`,
            )
          }
          if (command === 'build' && !isCloudflareBuild) {
            result = result.replace(
              WEBSOCKET_BASE_META_REGEX,
              `<meta name="webSocketBase" content="${escapeHtml(webSocketBases.join(','))}" />`,
            )
            result = result.replace(
              PROXY_BACKEND_META_REGEX,
              `<meta name="proxyBackend" content="${proxyBackend ? 'true' : 'false'}" />`,
            )
            result = result.replace(
              PROXY_WEBSOCKET_META_REGEX,
              `<meta name="proxyWebSocket" content="${proxyWebSocket ? 'true' : 'false'}" />`,
            )
          }
          if (!isCloudflareBuild && (apiBases.length || cspApi.length || cspStatic.length)) {
            const staticOrigins = cspStatic.join(' ')
            const csp = [
              'default-src \'self\'',
              `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${staticOrigins}`,
              `style-src 'self' 'unsafe-inline' https://challenges.cloudflare.com ${staticOrigins}`,
              `img-src 'self' data: https: ${staticOrigins}`,
              `font-src 'self' data: ${staticOrigins}`,
              `connect-src 'self' ${[...connectOrigins].join(' ')}`,
              'frame-src https://challenges.cloudflare.com',
              'object-src \'none\'',
              'base-uri \'self\'',
            ].join('; ')
            result = result.replace('</head>', `<meta http-equiv="Content-Security-Policy" content="${csp}" /></head>`)
          }
          return result
        },
      },
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      proxy: env.API_BASE && apiBases.length === 1
        ? {
            '/api': {
              target: apiBases[0],
              changeOrigin: true,
              ws: true,
              agent: outboundProxyAgent,
            },
            '^/(flags|os-icons|favicon.ico)': {
              target: apiBases[0],
              changeOrigin: true,
              agent: outboundProxyAgent,
              configure(proxy) {
                proxy.on('proxyRes', (response) => {
                  if (response.statusCode && response.statusCode >= 200 && response.statusCode < 400)
                    response.headers['cache-control'] = 'public, max-age=31536000, immutable'
                })
              },
            },
          }
        : undefined,
    },
    build: {
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            'vue-vendor': ['vue', 'vue-router', 'pinia'],
            'echarts': ['echarts', 'vue-echarts'],
            'reka-ui': ['reka-ui'],
            'vueuse': ['@vueuse/core'],
          },
        },
      },
    },
  }
})
