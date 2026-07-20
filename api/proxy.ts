import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import process from 'node:process'

interface VercelRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>
}

interface VercelResponse extends ServerResponse {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
  send: (body: unknown) => void
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
])
const RESPONSE_HEADERS_TO_SKIP = new Set([...HOP_BY_HOP_HEADERS, 'content-encoding'])
const PROXY_PATH_REGEX = /^\/(?:api|flags|os-icons)(?:\/|$)/
const TRAILING_SLASHES_REGEX = /\/+$/

function firstQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD')
    return undefined

  const chunks: Buffer[] = []
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  const apiBase = process.env.API_BASE?.split(',')[0]?.trim()
  const path = firstQueryValue(request.query.path)

  if (!apiBase) {
    response.status(500).json({ error: 'API_BASE is not configured' })
    return
  }

  if (!PROXY_PATH_REGEX.test(path)) {
    response.status(404).json({ error: 'Unsupported proxy path' })
    return
  }

  const target = new URL(path, `${apiBase.replace(TRAILING_SLASHES_REGEX, '')}/`)
  for (const [key, value] of Object.entries(request.query)) {
    if (key === 'path' || value === undefined)
      continue
    for (const item of Array.isArray(value) ? value : [value])
      target.searchParams.append(key, item)
  }

  if (request.headers.upgrade) {
    response.status(426).json({ error: 'WebSocket proxying is not available in Vercel Functions' })
    return
  }

  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key) || value === undefined)
      continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }

  try {
    const body = await readBody(request)
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: body as unknown as BodyInit,
    })

    response.status(upstream.status)
    upstream.headers.forEach((value, key) => {
      // Node Fetch has already decoded the upstream body. Do not forward its old encoding.
      if (!RESPONSE_HEADERS_TO_SKIP.has(key))
        response.setHeader(key, value)
    })
    response.send(Buffer.from(await upstream.arrayBuffer()))
  }
  catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : 'Backend request failed' })
  }
}
