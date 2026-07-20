import type { NodeStatus } from '@/utils/rpc'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import {
  adaptServer,
  buildAdminUrl,
  cfRequest,
  fetchAllServers,
  fetchSiteConfigs,
  getDataUpdateIntervalMs,
  getDisplayUuid,
  getRegisteredServerIds,
  getSharedApi,
  getWebSocketBases,
  hasMultipleApiBases,
  isEnabledValue,
  isProxyWebSocketEnabled,
} from '@/utils/api'

interface TurnstileApi {
  render: (container: HTMLElement, options: {
    'sitekey': string
    'theme'?: 'auto' | 'light' | 'dark'
    'callback': (token: string) => void
    'error-callback'?: () => void
    'expired-callback'?: () => void
  }) => string
  remove: (widgetId: string) => void
}

interface WsMessage {
  type: string
  ts?: number | string
  updates?: Array<{
    serverId: string
    samples?: Array<{
      ts?: number | string
      timestamp?: number | string
      data?: Record<string, unknown>
      payload?: Record<string, unknown>
      metrics?: Record<string, unknown>
    }>
  }>
}

interface LiveSample {
  serverId: string
  ts: number
  data: Record<string, unknown>
}

function normalizeSampleTimestamp(value: unknown, fallback = Date.now()): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0)
    return fallback
  return number < 1e12 ? number * 1000 : number
}

function sampleHasField(data: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some(key => data[key] !== undefined && data[key] !== null && data[key] !== '')
}

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let turnstileScriptPromise: Promise<TurnstileApi> | null = null

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

async function requestTurnstileToken(siteKey: string): Promise<string> {
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
    const cleanup = () => {
      if (widgetId) {
        try {
          api.remove(widgetId)
        }
        catch {}
      }
      overlay.remove()
    }
    widgetId = api.render(container, {
      'sitekey': siteKey,
      'theme': 'auto',
      'callback': (token) => {
        cleanup()
        resolve(token)
      },
      'error-callback': () => {
        cleanup()
        reject(new Error('Turnstile 验证失败'))
      },
      'expired-callback': () => {
        cleanup()
        reject(new Error('Turnstile 验证已过期'))
      },
    })
  })
}

class InitManager {
  private appStore = useAppStore()
  private nodesStore = useNodesStore()
  private sockets: WebSocket[] = []
  private reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private reconnectAttempts = new Map<number, number>()
  private liveUpdateTimer: ReturnType<typeof setInterval> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private liveSampleQueues = new Map<string, LiveSample[]>()
  private livePlaybackTimes = new Map<string, number>()
  private pendingStatuses = new Map<string, NodeStatus>()
  private destroyed = false

  async init(): Promise<void> {
    try {
      let configs = await fetchSiteConfigs()
      const turnstileConfigs = configs.filter(config => isEnabledValue(config.turnstile_enabled))
      if (hasMultipleApiBases() && turnstileConfigs.length)
        throw new Error('多后端聚合模式暂不支持启用 Turnstile 的源站')

      const first = configs[0]
      if (first && isEnabledValue(first.turnstile_enabled) && !first.verified) {
        if (!first.turnstile_site_key)
          throw new Error('源站已启用 Turnstile，但未返回 Site Key')
        const token = await requestTurnstileToken(first.turnstile_site_key)
        localStorage.setItem('turnstile_token', token)
        await cfRequest('/api/config', 0)
        configs = await fetchSiteConfigs()
      }

      const config = configs[0]
      if (config?.site_title && !hasMultipleApiBases())
        document.title = config.site_title

      if (config && !isEnabledValue(config.is_public) && !config.authorization) {
        window.location.href = buildAdminUrl(0)
        return
      }

      this.appStore.publicSettings = await getSharedApi().getPublicSettings()
      this.appStore.updateLoginState(configs.some(item => item.authorization))
      await this.loadNodes()
      const updateInterval = getDataUpdateIntervalMs(this.appStore.publicSettings)
      if (isProxyWebSocketEnabled()) {
        this.connectAllSockets()
        this.liveUpdateTimer = setInterval(() => {
          this.advanceLiveSamples()
          this.flushPendingStatuses()
        }, updateInterval)
      }
      else {
        this.nodesStore.updateWsState('disconnected', 0)
        this.pollTimer = setInterval(() => {
          this.loadNodes().catch(() => {})
        }, updateInterval)
      }
    }
    catch (error) {
      this.appStore.connectionError = true
      throw error
    }
    finally {
      this.appStore.loading = false
    }
  }

  private async loadNodes(): Promise<void> {
    try {
      const { clients, statuses } = await fetchAllServers()
      this.nodesStore.initNodes(clients, statuses)
      this.appStore.connectionError = false
    }
    catch (error) {
      this.appStore.connectionError = true
      throw error
    }
  }

  private connectAllSockets(): void {
    getWebSocketBases().forEach((baseUrl, apiIndex) => this.connectSocket(baseUrl, apiIndex))
  }

  private applyLiveSample(apiIndex: number, sample: LiveSample): void {
    const uuid = getDisplayUuid(apiIndex, sample.serverId)
    const currentNode = this.nodesStore.nodesByUuid.get(uuid)
    const current = this.pendingStatuses.get(uuid) ?? currentNode
    const status = adaptServer({
      id: sample.serverId,
      ...sample.data,
      last_updated: sample.ts,
    }, apiIndex).status

    if (current) {
      if (!sampleHasField(sample.data, 'net_tx', 'net_total_up'))
        status.net_total_up = current.net_total_up
      if (!sampleHasField(sample.data, 'net_rx', 'net_total_down'))
        status.net_total_down = current.net_total_down
      if (!sampleHasField(sample.data, 'net_tx_monthly'))
        status.net_monthly_up = current.net_monthly_up
      if (!sampleHasField(sample.data, 'net_rx_monthly'))
        status.net_monthly_down = current.net_monthly_down
      if (!sampleHasField(sample.data, 'boot_time'))
        status.uptime = current.uptime + 1
      if (!sampleHasField(sample.data, 'ram_total'))
        status.ram_total = currentNode?.mem_total ?? status.ram_total
      if (!sampleHasField(sample.data, 'swap_total'))
        status.swap_total = current.swap_total
      if (!sampleHasField(sample.data, 'disk_total'))
        status.disk_total = current.disk_total
      if (!sampleHasField(
        sample.data,
        'ping_ct',
        'ping_cu',
        'ping_cm',
        'ping_bd',
        'loss_ct',
        'loss_cu',
        'loss_cm',
        'loss_bd',
      )) {
        status.ping = current.ping
      }
    }

    this.queueNodeStatuses({ [uuid]: status })
  }

  private queueNodeStatuses(statuses: Record<string, NodeStatus>): void {
    Object.entries(statuses).forEach(([uuid, status]) => {
      this.pendingStatuses.set(uuid, status)
    })
  }

  private flushPendingStatuses(): void {
    if (!this.pendingStatuses.size)
      return
    const statuses = Object.fromEntries(this.pendingStatuses)
    this.pendingStatuses.clear()
    this.nodesStore.updateNodeStatuses(statuses)
  }

  private enqueueLiveSamples(apiIndex: number, serverId: string, samples: LiveSample[]): void {
    const uuid = getDisplayUuid(apiIndex, serverId)
    const current = this.pendingStatuses.get(uuid) ?? this.nodesStore.nodesByUuid.get(uuid)
    const currentTime = current?.time ? new Date(current.time).getTime() : 0
    const unique = new Map<number, LiveSample>()

    for (const sample of samples) {
      if (sample.ts > currentTime)
        unique.set(sample.ts, sample)
    }

    const incoming = [...unique.values()].sort((a, b) => a.ts - b.ts)
    if (!incoming.length)
      return

    if (incoming.length === 1) {
      this.liveSampleQueues.delete(uuid)
      this.livePlaybackTimes.set(uuid, incoming[0]!.ts)
      this.applyLiveSample(apiIndex, incoming[0]!)
      return
    }

    this.liveSampleQueues.set(uuid, incoming.slice(-600))
    this.livePlaybackTimes.set(uuid, incoming[0]!.ts)
    this.applyLiveSample(apiIndex, incoming[0]!)
    this.liveSampleQueues.get(uuid)?.shift()
  }

  private advanceLiveSamples(): void {
    for (const [uuid, queue] of this.liveSampleQueues) {
      const source = this.nodesStore.nodesByUuid.get(uuid)
      const apiIndex = source?.source_index ?? 0
      const playbackTime = (this.livePlaybackTimes.get(uuid) ?? Date.now()) + 1000
      let selected: LiveSample | undefined

      while (queue.length && queue[0]!.ts <= playbackTime)
        selected = queue.shift()

      if (selected)
        this.applyLiveSample(apiIndex, selected)

      this.livePlaybackTimes.set(uuid, selected?.ts ?? playbackTime)
      if (!queue.length)
        this.liveSampleQueues.delete(uuid)
    }
  }

  private connectSocket(baseUrl: string, apiIndex: number): void {
    if (this.destroyed)
      return
    const url = new URL(`${baseUrl}/api/ws?subscribe=all`, window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    this.sockets[apiIndex] = socket
    this.nodesStore.updateWsState('connecting', this.reconnectAttempts.get(apiIndex) ?? 0)

    socket.addEventListener('open', () => {
      this.reconnectAttempts.set(apiIndex, 0)
      socket.send(JSON.stringify({
        type: 'subscribe',
        scope: 'all',
        ids: getRegisteredServerIds(apiIndex),
      }))
      this.nodesStore.updateWsState('connected', 0)
    })

    socket.addEventListener('message', (event) => {
      let message: WsMessage
      try {
        message = JSON.parse(String(event.data)) as WsMessage
      }
      catch {
        return
      }
      if (message.type !== 'batchUpdate')
        return

      for (const update of message.updates ?? []) {
        const samples = (update.samples ?? []).flatMap((sample) => {
          const data = sample.data ?? sample.payload ?? sample.metrics
          if (!data)
            return []
          return [{
            serverId: update.serverId,
            ts: normalizeSampleTimestamp(
              sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp ?? message.ts,
            ),
            data,
          }]
        })
        this.enqueueLiveSamples(apiIndex, update.serverId, samples)
      }
    })

    socket.addEventListener('close', () => this.scheduleReconnect(baseUrl, apiIndex))
    socket.addEventListener('error', () => socket.close())
  }

  private scheduleReconnect(baseUrl: string, apiIndex: number): void {
    if (this.destroyed || this.reconnectTimers.has(apiIndex))
      return
    const attempts = (this.reconnectAttempts.get(apiIndex) ?? 0) + 1
    this.reconnectAttempts.set(apiIndex, attempts)
    this.nodesStore.updateWsState('reconnecting', attempts)
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5))
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(apiIndex)
      this.connectSocket(baseUrl, apiIndex)
    }, delay)
    this.reconnectTimers.set(apiIndex, timer)
  }

  destroy(): void {
    this.destroyed = true
    this.sockets.forEach(socket => socket?.close())
    this.sockets = []
    this.reconnectTimers.forEach(timer => clearTimeout(timer))
    this.reconnectTimers.clear()
    if (this.liveUpdateTimer)
      clearInterval(this.liveUpdateTimer)
    this.liveUpdateTimer = null
    if (this.pollTimer)
      clearInterval(this.pollTimer)
    this.pollTimer = null
    this.liveSampleQueues.clear()
    this.livePlaybackTimes.clear()
    this.pendingStatuses.clear()
    this.nodesStore.updateWsState('disconnected', 0)
  }
}

let initManager: InitManager | null = null

export async function initApp(): Promise<void> {
  initManager ??= new InitManager()
  await initManager.init()
}

export function destroyInitManager(): void {
  initManager?.destroy()
  initManager = null
}
