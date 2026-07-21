interface PagesEnv {
  API_BASE?: string
  PROXY_BACKEND?: string
}

interface PagesContext {
  request: Request
  env: PagesEnv
}

const STATIC_ASSET_PATH_REGEX = /^\/(?:flags|os-icons)(?:\/|$)/
const TRAILING_SLASHES_REGEX = /\/+$/

function enabled(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true'
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function getApiBase(value: string | undefined): string | undefined {
  const apiBase = value?.split(',')[0]?.trim()
  if (!apiBase)
    return undefined

  try {
    const url = new URL(apiBase)
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : undefined
  }
  catch {
    return undefined
  }
}

export async function proxyRequest({ request, env }: PagesContext): Promise<Response> {
  if (!enabled(env.PROXY_BACKEND))
    return errorResponse(404, 'Proxying is disabled for this request')

  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket')
    return errorResponse(426, 'WebSocket proxying is not available in EdgeOne Pages Functions')

  const apiBase = getApiBase(env.API_BASE)
  if (!apiBase)
    return errorResponse(500, 'API_BASE is not configured or invalid')

  const requestUrl = new URL(request.url)
  const target = new URL(requestUrl.pathname + requestUrl.search, `${apiBase.replace(TRAILING_SLASHES_REGEX, '')}/`)
  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('accept-encoding')

  try {
    const upstream = await fetch(new Request(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'follow',
    }))

    if (!STATIC_ASSET_PATH_REGEX.test(requestUrl.pathname) || !upstream.ok)
      return upstream

    const responseHeaders = new Headers(upstream.headers)
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable')
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  }
  catch (error) {
    return errorResponse(502, error instanceof Error ? error.message : 'Backend request failed')
  }
}
