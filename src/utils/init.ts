import type { NodeStatus } from '@/utils/rpc'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import {
  adaptServer,
  buildAdminUrl,
  cfRequest,
  fetchAllServers,
  fetchSiteConfigs,
  getDisplayUuid,
  getRegisteredServerIds,
  getServerSource,
  getSharedApi,
  getWebSocketBases,
  hasMultipleApiBases,
  isEnabledValue,
} from '@/utils/api'
import { requestTurnstileToken } from '@/utils/turnstile'

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

const LIVE_UPDATE_INTERVAL_MS = 1000

class InitManager {
  private appStore = useAppStore()
  private nodesStore = useNodesStore()
  private sockets: WebSocket[] = []
  private reconnectTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private reconnectAttempts = new Map<number, number>()
  private detailSockets = new Map<string, WebSocket>()
  private detailReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private detailReconnectAttempts = new Map<string, number>()
  private detailManualClose = new Set<string>()
  private liveUpdateTimer: ReturnType<typeof setInterval> | null = null
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
        window.location.href = buildAdminUrl()
        return
      }

      this.appStore.publicSettings = await getSharedApi().getPublicSettings()
      this.appStore.updateLoginState(configs.some(item => item.authorization))
      const latencyWindow = configs[0]?.latency_window
      this.nodesStore.configurePingHistory({
        points: latencyWindow?.points,
        hours: latencyWindow?.hours,
      })
      await this.loadNodes()
      this.connectAllSockets()
      this.liveUpdateTimer = setInterval(() => {
        this.advanceLiveSamples()
        this.flushPendingStatuses()
      }, LIVE_UPDATE_INTERVAL_MS)
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
      const { clients, statuses, latestReportUpdates, sysConfig } = await fetchAllServers()
      // 后端开关控制：关闭时忽略 ping/loss 窗口并隐藏首页卡片/列表的延迟丢包信息
      const showThreeNetDetails = sysConfig?.show_three_net_details === undefined
        ? true
        : isEnabledValue(sysConfig.show_three_net_details)
      this.nodesStore.configurePingHistory({ showThreeNetDetails })
      this.nodesStore.initNodes(clients, statuses)

      for (const { apiIndex, updates } of latestReportUpdates) {
        for (const update of updates) {
          const rawSamples: LiveSample[] = (update.samples ?? []).map(s => ({
            serverId: update.serverId,
            ts: normalizeSampleTimestamp(s.ts, Date.now()),
            data: s.payload ?? s.data ?? {},
          }))
          if (!rawSamples.length)
            continue

          const sorted = rawSamples.sort((a, b) => a.ts - b.ts)
          const uuid = getDisplayUuid(apiIndex, update.serverId)

          this.applyLiveSample(apiIndex, sorted.at(-1)!)

          if (sorted.length > 1) {
            const historical = sorted.slice(0, -1)
            this.liveSampleQueues.set(uuid, historical)
            this.livePlaybackTimes.set(uuid, historical[0]!.ts)
          }
        }
      }
      this.flushPendingStatuses()

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
      if (!sampleHasField(sample.data, 'disk_used', 'disk'))
        status.disk = current.disk
      if (!sampleHasField(sample.data, 'load_avg')) {
        status.load = current.load
        status.load5 = current.load5
        status.load15 = current.load15
      }
      if (!sampleHasField(sample.data, 'processes'))
        status.process = current.process
      if (!sampleHasField(sample.data, 'tcp_conn'))
        status.connections = current.connections
      if (!sampleHasField(sample.data, 'udp_conn'))
        status.connections_udp = current.connections_udp
      if (!sampleHasField(sample.data, 'gpu'))
        status.gpu = current.gpu
      if (!sampleHasField(sample.data, 'temp'))
        status.temp = current.temp
      if (!sampleHasField(
        sample.data,
        'ping_ct',
        'ping_cu',
        'ping_cm',
        'ping_bd',
        'ping_node_1',
        'ping_node_2',
        'ping_node_3',
        'ping_node_4',
        'loss_ct',
        'loss_cu',
        'loss_cm',
        'loss_bd',
        'loss_node_1',
        'loss_node_2',
        'loss_node_3',
        'loss_node_4',
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

  private parseBatchSamples(message: WsMessage): Array<{ serverId: string, samples: LiveSample[] }> {
    return (message.updates ?? []).map(update => ({
      serverId: update.serverId,
      samples: (update.samples ?? []).flatMap((sample) => {
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
      }),
    }))
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

      for (const { serverId, samples } of this.parseBatchSamples(message))
        this.enqueueLiveSamples(apiIndex, serverId, samples)
    })

    socket.addEventListener('close', () => this.scheduleReconnect(baseUrl, apiIndex))
    socket.addEventListener('error', () => socket.close())
  }

  /**
   * 订阅单台服务器详情页专用 WebSocket（?subscribe=<serverId>）。
   * 返回取消订阅函数；组件卸载或切换节点时调用。
   */
  subscribeNode(uuid: string): () => void {
    const source = getServerSource(uuid)
    const apiIndex = source.apiIndex
    const serverId = source.serverId
    const key = `${apiIndex}:${serverId}`
    this.detailManualClose.delete(key)
    if (!this.detailSockets.has(key)) {
      const baseUrl = getWebSocketBases()[apiIndex] ?? ''
      this.connectDetailSocket(baseUrl, apiIndex, serverId, key)
    }
    return () => this.unsubscribeNode(key)
  }

  private connectDetailSocket(baseUrl: string, apiIndex: number, serverId: string, key: string): void {
    if (this.destroyed || this.detailManualClose.has(key))
      return
    const url = new URL(`${baseUrl}/api/ws?subscribe=${encodeURIComponent(serverId)}`, window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    this.detailSockets.set(key, socket)

    socket.addEventListener('open', () => {
      this.detailReconnectAttempts.set(key, 0)
      socket.send(JSON.stringify({
        type: 'subscribe',
        scope: serverId,
        ids: [serverId],
      }))
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

      for (const { serverId: updateServerId, samples } of this.parseBatchSamples(message)) {
        if (updateServerId !== serverId)
          continue
        this.enqueueLiveSamples(apiIndex, updateServerId, samples)
      }
    })

    socket.addEventListener('close', () => {
      if (!this.detailManualClose.has(key))
        this.scheduleDetailReconnect(baseUrl, apiIndex, serverId, key)
    })
    socket.addEventListener('error', () => socket.close())
  }

  private scheduleDetailReconnect(baseUrl: string, apiIndex: number, serverId: string, key: string): void {
    if (this.destroyed || this.detailReconnectTimers.has(key))
      return
    const attempts = (this.detailReconnectAttempts.get(key) ?? 0) + 1
    this.detailReconnectAttempts.set(key, attempts)
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5))
    const timer = setTimeout(() => {
      this.detailReconnectTimers.delete(key)
      this.connectDetailSocket(baseUrl, apiIndex, serverId, key)
    }, delay)
    this.detailReconnectTimers.set(key, timer)
  }

  private unsubscribeNode(key: string): void {
    this.detailManualClose.add(key)
    const socket = this.detailSockets.get(key)
    if (socket) {
      socket.close()
      this.detailSockets.delete(key)
    }
    const timer = this.detailReconnectTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.detailReconnectTimers.delete(key)
    }
    this.detailReconnectAttempts.delete(key)
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
    this.detailSockets.forEach(socket => socket?.close())
    this.detailSockets.clear()
    this.detailReconnectTimers.forEach(timer => clearTimeout(timer))
    this.detailReconnectTimers.clear()
    this.detailReconnectAttempts.clear()
    this.detailManualClose.clear()
    if (this.liveUpdateTimer)
      clearInterval(this.liveUpdateTimer)
    this.liveUpdateTimer = null
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

export function subscribeNodeLive(uuid: string): () => void {
  return initManager?.subscribeNode(uuid) ?? (() => {})
}
