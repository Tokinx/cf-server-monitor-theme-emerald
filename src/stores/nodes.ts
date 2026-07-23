import type { Client, NodeStatus, NodeStatusPing } from '@/utils/rpc'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { parseNodeGroups } from '@/utils/groupHelper'

/** 流量限制类型 */
export type TrafficLimitType = 'up' | 'down' | 'min' | 'max' | 'sum'

export interface PingHistoryPoint {
  time: string
  latency: number | null
  loss: number | null
}

/** 节点完整信息（合并 Client 和 Status） */
export interface NodeData {
  uuid: string
  source_id?: string
  source_index?: number
  // Client 信息
  name: string
  cpu_name: string
  virtualization: string
  arch: string
  cpu_cores: number
  os: string
  boot_time: string
  gpu_name?: string
  ipv4?: string
  ipv6?: string
  region: string
  remark?: string
  public_remark: string
  mem_total: number
  swap_total: number
  disk_total: number
  version?: string
  weight: number
  price: number
  price_configured?: boolean
  billing_cycle: number
  auto_renewal: boolean
  currency: string
  expired_at: string
  group: string
  tags: string
  hidden: boolean
  traffic_limit: number
  traffic_limit_type: TrafficLimitType
  created_at: string
  updated_at: string
  // Status 信息
  online: boolean
  time: string
  cpu: number
  gpu: number
  ram: number
  swap: number
  load: number
  load5: number
  load15: number
  temp: number
  disk: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  net_monthly_up: number
  net_monthly_down: number
  process: number
  connections: number
  connections_udp: number
  uptime: number
  ping?: Record<string, NodeStatusPing>
}

/** WebSocket 连接状态 */
export type WsConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

/** 状态数据（用于更新） */
interface StatusData {
  online: boolean
  time: string
  cpu: number
  gpu: number
  ram: number
  swap: number
  load: number
  load5: number
  load15: number
  temp: number
  disk: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  net_monthly_up: number
  net_monthly_down: number
  process: number
  connections: number
  connections_udp: number
  uptime: number
  ping?: Record<string, NodeStatusPing>
}

const EARTH_SNAPSHOT_INTERVAL_MS = 60_000
const PING_HISTORY_LIMIT = 10

const useNodesStore = defineStore('nodes', () => {
  // ===== 状态 =====
  const nodes = ref<NodeData[]>([])
  const earthNodes = ref<NodeData[]>([])
  const pingHistoryByUuid = ref<Record<string, PingHistoryPoint[]>>({})
  const wsConnectionState = ref<WsConnectionState>('disconnected')
  const wsReconnectAttempts = ref<number>(0)
  let lastEarthSnapshotAt = 0

  // ===== 计算属性 =====
  /** 在线节点数量 */
  const onlineCount = computed(() => nodes.value.filter(n => n.online).length)

  /** 总节点数量 */
  const totalCount = computed(() => nodes.value.length)

  /** 所有分组 */
  const groups = computed(() => {
    const groupSet = new Set<string>()
    nodes.value.forEach((n) => {
      parseNodeGroups(n.group).forEach(group => groupSet.add(group))
    })
    return Array.from(groupSet)
  })

  /** 按 UUID 索引的节点映射 */
  const nodesByUuid = computed(() => {
    const map = new Map<string, NodeData>()
    nodes.value.forEach((n) => {
      map.set(n.uuid, n)
    })
    return map
  })

  // ===== 方法 =====

  /**
   * 从 Client 对象创建节点数据
   */
  function createNodeFromClient(client: Client): NodeData {
    return {
      uuid: client.uuid,
      source_id: client.source_id,
      source_index: client.source_index,
      name: client.name,
      cpu_name: client.cpu_name,
      virtualization: client.virtualization,
      arch: client.arch,
      cpu_cores: client.cpu_cores,
      os: client.os,
      boot_time: client.boot_time,
      gpu_name: client.gpu_name,
      ipv4: client.ipv4,
      ipv6: client.ipv6,
      region: client.region,
      remark: client.remark,
      public_remark: client.public_remark,
      mem_total: client.mem_total,
      swap_total: client.swap_total,
      disk_total: client.disk_total,
      version: client.version,
      weight: client.weight,
      price: client.price,
      price_configured: client.price_configured,
      billing_cycle: client.billing_cycle,
      auto_renewal: client.auto_renewal,
      currency: client.currency,
      expired_at: client.expired_at,
      group: client.group,
      tags: client.tags,
      hidden: client.hidden,
      traffic_limit: client.traffic_limit,
      traffic_limit_type: client.traffic_limit_type as TrafficLimitType,
      created_at: client.created_at,
      updated_at: client.updated_at,
      // Status 默认值
      online: false,
      time: '',
      cpu: 0,
      gpu: 0,
      ram: 0,
      swap: 0,
      load: 0,
      load5: 0,
      load15: 0,
      temp: 0,
      disk: 0,
      net_in: 0,
      net_out: 0,
      net_total_up: 0,
      net_total_down: 0,
      net_monthly_up: 0,
      net_monthly_down: 0,
      process: 0,
      connections: 0,
      connections_udp: 0,
      uptime: 0,
      ping: undefined,
    }
  }

  /**
   * 更新节点的状态数据
   */
  function updateNodeStatus(node: NodeData, status: StatusData): NodeData {
    return {
      ...node,
      online: status.online,
      time: status.time,
      cpu: status.cpu,
      gpu: status.gpu,
      ram: status.ram,
      swap: status.swap,
      load: status.load,
      load5: status.load5,
      load15: status.load15,
      temp: status.temp,
      disk: status.disk,
      net_in: status.net_in,
      net_out: status.net_out,
      net_total_up: status.net_total_up,
      net_total_down: status.net_total_down,
      net_monthly_up: status.net_monthly_up,
      net_monthly_down: status.net_monthly_down,
      process: status.process,
      connections: status.connections,
      connections_udp: status.connections_udp,
      uptime: status.uptime,
      ping: status.ping,
    }
  }

  /**
   * 从 NodeStatus 提取状态数据
   */
  function extractStatusData(status: NodeStatus): StatusData {
    return {
      online: status.online,
      time: status.time,
      cpu: status.cpu,
      gpu: status.gpu,
      ram: status.ram,
      swap: status.swap,
      load: status.load,
      load5: status.load5,
      load15: status.load15,
      temp: status.temp,
      disk: status.disk,
      net_in: status.net_in,
      net_out: status.net_out,
      net_total_up: status.net_total_up,
      net_total_down: status.net_total_down,
      net_monthly_up: status.net_monthly_up,
      net_monthly_down: status.net_monthly_down,
      process: status.process,
      connections: status.connections,
      connections_udp: status.connections_udp,
      uptime: status.uptime,
      ping: status.ping,
    }
  }

  function recordPingSample(uuid: string, status: NodeStatus): void {
    const pingEntries = Object.values(status.ping ?? {})
    const latencyValues = pingEntries
      .map(entry => entry.latest)
      .filter(value => Number.isFinite(value) && value > 0)
    const lossValues = pingEntries
      .map(entry => entry.loss)
      .filter(value => Number.isFinite(value) && value >= 0)

    if (!latencyValues.length && !lossValues.length)
      return

    const point: PingHistoryPoint = {
      time: status.time || new Date().toISOString(),
      latency: latencyValues.length
        ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
        : null,
      loss: lossValues.length
        ? lossValues.reduce((sum, value) => sum + value, 0) / lossValues.length
        : null,
    }
    const history = pingHistoryByUuid.value[uuid] ?? []
    if (history.at(-1)?.time === point.time)
      return

    pingHistoryByUuid.value = {
      ...pingHistoryByUuid.value,
      [uuid]: [...history, point].slice(-PING_HISTORY_LIMIT),
    }
  }

  /**
   * Earth 视图共享采样快照，避免 globe / maps 各自维护定时器。
   */
  function refreshEarthNodes(force = false): void {
    const now = Date.now()
    if (!force && now - lastEarthSnapshotAt < EARTH_SNAPSHOT_INTERVAL_MS)
      return

    earthNodes.value = [...nodes.value]
    lastEarthSnapshotAt = now
  }

  /**
   * 初始化节点数据（首次加载）
   */
  function initNodes(clients: Record<string, Client>, statuses: Record<string, NodeStatus>): void {
    const uuids = Object.keys(clients)
    const existingUuids = new Set(nodes.value.map(n => n.uuid))

    // 更新现有节点或添加新节点
    uuids.forEach((uuid) => {
      const client = clients[uuid]
      if (!client)
        return

      const status = statuses[uuid]
      const index = nodes.value.findIndex(n => n.uuid === uuid)

      if (existingUuids.has(uuid) && index !== -1) {
        // 更新现有节点
        const baseNode = createNodeFromClient(client)
        nodes.value[index] = status
          ? updateNodeStatus(baseNode, extractStatusData(status))
          : baseNode
      }
      else {
        // 添加新节点
        const newNode = createNodeFromClient(client)
        nodes.value.push(status
          ? updateNodeStatus(newNode, extractStatusData(status))
          : newNode,
        )
      }

      if (status)
        recordPingSample(uuid, status)
    })

    // 移除不存在的节点
    const newUuids = new Set(uuids)
    for (let i = nodes.value.length - 1; i >= 0; i--) {
      const node = nodes.value[i]
      if (node && !newUuids.has(node.uuid)) {
        nodes.value.splice(i, 1)
      }
    }

    // 按 weight 降序排序（weight 越大越靠前）
    sortNodesByWeight()
    refreshEarthNodes(true)
  }

  /**
   * 按 weight 升序排序节点（weight 越小越靠前）
   */
  function sortNodesByWeight(): void {
    nodes.value.sort((a, b) => a.weight - b.weight)
  }

  /**
   * 更新节点状态（实时更新）
   */
  function updateNodeStatuses(statuses: Record<string, NodeStatus>, trackPing = true): void {
    let hasChanges = false

    Object.entries(statuses).forEach(([uuid, status]) => {
      const index = nodes.value.findIndex(n => n.uuid === uuid)
      if (index === -1)
        return

      const node = nodes.value[index]
      if (!node)
        return

      nodes.value[index] = updateNodeStatus(node, extractStatusData(status))
      if (trackPing)
        recordPingSample(uuid, status)
      hasChanges = true
    })

    if (hasChanges)
      refreshEarthNodes()
  }

  /**
   * 更新节点基本信息
   */
  function updateNodeClients(clients: Record<string, Client>): void {
    const newUuids = new Set(Object.keys(clients))

    // 更新现有节点信息或添加新节点
    Object.entries(clients).forEach(([uuid, client]) => {
      const index = nodes.value.findIndex(n => n.uuid === uuid)

      if (index !== -1) {
        // 更新现有节点，保留状态信息
        const currentNode = nodes.value[index]
        if (!currentNode)
          return

        const baseNode = createNodeFromClient(client)
        nodes.value[index] = updateNodeStatus(baseNode, {
          online: currentNode.online,
          time: currentNode.time,
          cpu: currentNode.cpu,
          gpu: currentNode.gpu,
          ram: currentNode.ram,
          swap: currentNode.swap,
          load: currentNode.load,
          load5: currentNode.load5,
          load15: currentNode.load15,
          temp: currentNode.temp,
          disk: currentNode.disk,
          net_in: currentNode.net_in,
          net_out: currentNode.net_out,
          net_total_up: currentNode.net_total_up,
          net_total_down: currentNode.net_total_down,
          net_monthly_up: currentNode.net_monthly_up,
          net_monthly_down: currentNode.net_monthly_down,
          process: currentNode.process,
          connections: currentNode.connections,
          connections_udp: currentNode.connections_udp,
          uptime: currentNode.uptime,
          ping: currentNode.ping,
        })
      }
      else {
        // 添加新节点（不带状态）
        nodes.value.push(createNodeFromClient(client))
      }
    })

    // 移除不存在的节点
    for (let i = nodes.value.length - 1; i >= 0; i--) {
      const node = nodes.value[i]
      if (node && !newUuids.has(node.uuid)) {
        nodes.value.splice(i, 1)
      }
    }

    // 按 weight 降序排序
    sortNodesByWeight()
    refreshEarthNodes(true)
  }

  /**
   * 更新 WebSocket 连接状态
   */
  function updateWsState(state: WsConnectionState, attempts?: number): void {
    wsConnectionState.value = state
    if (attempts !== undefined) {
      wsReconnectAttempts.value = attempts
    }
  }

  /**
   * 清空所有节点数据
   */
  function clearNodes(): void {
    nodes.value = []
    pingHistoryByUuid.value = {}
    refreshEarthNodes(true)
  }

  return {
    // 状态
    nodes,
    earthNodes,
    pingHistoryByUuid,
    wsConnectionState,
    wsReconnectAttempts,
    // 计算属性
    onlineCount,
    totalCount,
    groups,
    nodesByUuid,
    // 方法
    initNodes,
    updateNodeStatuses,
    recordPingSample,
    updateNodeClients,
    sortNodesByWeight,
    updateWsState,
    clearNodes,
  }
})

export { useNodesStore }
