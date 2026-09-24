interface TurnstileApi {
  render: (container: HTMLElement, options: {
    'sitekey': string
    'theme'?: 'auto' | 'light' | 'dark'
    'callback': (token: string) => void
    'error-callback'?: () => void
    'expired-callback'?: () => void
  }) => string
  remove: (widgetId: string) => void
  reset: (widgetId: string) => void
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let turnstileScriptPromise: Promise<TurnstileApi> | null = null
let turnstileTokenPromise: Promise<string> | null = null

function getTurnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

function loadTurnstile(): Promise<TurnstileApi> {
  const existing = getTurnstile()
  if (existing)
    return Promise.resolve(existing)
  if (turnstileScriptPromise)
    return turnstileScriptPromise

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.onload = () => {
      const api = getTurnstile()
      if (api)
        resolve(api)
      else
        reject(new Error('Turnstile SDK 加载失败'))
    }
    script.onerror = () => reject(new Error('Turnstile SDK 加载失败'))
    document.head.appendChild(script)
  })
  return turnstileScriptPromise
}

/**
 * 弹出 Turnstile 验证并返回一次性 token。
 * 并发调用会共享同一次验证；token 过期时自动 reset，不要求刷新页面。
 */
export function requestTurnstileToken(siteKey: string): Promise<string> {
  if (turnstileTokenPromise)
    return turnstileTokenPromise

  turnstileTokenPromise = requestTurnstileTokenOnce(siteKey).finally(() => {
    turnstileTokenPromise = null
  })
  return turnstileTokenPromise
}

async function requestTurnstileTokenOnce(siteKey: string): Promise<string> {
  const api = await loadTurnstile()
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('div')
    overlay.className = 'fixed inset-0 z-50 grid place-items-center bg-background/90 px-4 backdrop-blur-md'
    overlay.innerHTML = `
      <div class="w-full max-w-sm rounded-md border border-emerald-600/15 bg-background p-5 shadow-2xl">
        <div class="mb-1 text-base font-semibold">访问验证</div>
        <div class="mb-5 text-sm text-muted-foreground">完成 Cloudflare 验证后继续加载监控数据。</div>
        <div data-turnstile class="min-h-16"></div>
      </div>`
    document.body.appendChild(overlay)
    const container = overlay.querySelector<HTMLElement>('[data-turnstile]')
    if (!container) {
      overlay.remove()
      reject(new Error('Turnstile 容器创建失败'))
      return
    }

    let widgetId = ''
    let settled = false
    const cleanup = () => {
      if (widgetId) {
        try {
          api.remove(widgetId)
        }
        catch {}
      }
      overlay.remove()
    }
    const settle = (fn: () => void) => {
      if (settled)
        return
      settled = true
      fn()
    }

    widgetId = api.render(container, {
      'sitekey': siteKey,
      'theme': 'auto',
      'callback': (token) => {
        settle(() => {
          cleanup()
          resolve(token)
        })
      },
      'error-callback': () => {
        settle(() => {
          cleanup()
          reject(new Error('Turnstile 验证失败'))
        })
      },
      'expired-callback': () => {
        // Token 约 300s 过期：reset 重新发卡，避免用户只能刷新页面
        try {
          api.reset(widgetId)
        }
        catch {
          settle(() => {
            cleanup()
            reject(new Error('Turnstile 验证已过期'))
          })
        }
      },
    })
  })
}
