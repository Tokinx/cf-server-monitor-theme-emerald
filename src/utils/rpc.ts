import { fetchAllServers, fetchHistory, fetchPingHistory, getRegisteredDisplayUuids } from '@/utils/api'

export interface Client {
  uuid: string
  source_id?: string
  source_index?: number
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
  /** Whether the backend supplied a price. False distinguishes an unset value from a free (0/-1) plan. */
  price_configured?: boolean
  billing_cycle: number
  auto_renewal: boolean
  currency: string
  expired_at: string
  group: string
  tags: string
  hidden: boolean
  traffic_limit: number
  traffic_limit_type: string
  created_at: string
  updated_at: string
}

export interface NodeStatusPing {
  name: string
  latest: number
  avg: number
  tail: number
  loss: number
  min: number
  max: number
}

export interface NodeStatus {
  client: string
  time: string
  cpu: number
  gpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  load5: number
  load15: number
  temp: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  net_monthly_up: number
  net_monthly_down: number
  process: number
  connections: number
  connections_udp: number
  online: boolean
  uptime: number
  ping?: Record<string, NodeStatusPing>
}

export interface StatusRecord {
  client: string
  time: string
  cpu: number
  gpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  load5: number
  load15: number
  temp: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  net_monthly_up: number
  net_monthly_down: number
  process: number
  connections: number
  connections_udp: number
}

export interface PingRecord {
  client: string
  task_id: number
  time: string
  value: number
  loss?: number
}

export class RpcError extends Error {
  code: number
  data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }
}

interface RecordsParams {
  type: 'load' | 'ping'
  uuid?: string
  hours?: number
}

export class RpcClient {
  async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (method === 'rpc.ping')
      return 'pong' as T

    if (method === 'common:getRecords') {
      const options = (params ?? {}) as unknown as RecordsParams
      const hours = options.hours ?? (options.type === 'ping' ? 1 : 0.167)
      const uuids = options.uuid
        ? [options.uuid]
        : getRegisteredDisplayUuids()

      if (options.type === 'ping') {
        const results = await Promise.all(uuids.map(uuid => fetchPingHistory(uuid, hours)))
        return {
          records: results.flatMap(result => result.records),
          tasks: results[0]?.tasks ?? [],
        } as T
      }

      const records = (await Promise.all(uuids.map(uuid => fetchHistory(uuid, hours)))).flat()
      return { records } as T
    }

    if (method === 'public:queryMetrics' || method === 'public:getPingMetricStats')
      throw new RpcError(-32601, 'Method not found')

    throw new RpcError(-32601, `Unsupported compatibility method: ${method}`)
  }

  close(): void {}
}

export class CfHistoryFacade {
  private client = new RpcClient()

  getClient(): RpcClient {
    return this.client
  }

  async ping(): Promise<string> {
    return 'pong'
  }

  async getNodes(): Promise<Record<string, Client>> {
    return (await fetchAllServers()).clients
  }

  async getNodesLatestStatus(): Promise<Record<string, NodeStatus>> {
    return (await fetchAllServers()).statuses
  }

  async getNodeRecentStatus(uuid: string): Promise<{ count: number, records: StatusRecord[] }> {
    const records = await fetchHistory(uuid, 0.167)
    return { count: records.length, records }
  }

  async getLoadRecords(uuid: string, hours = 1): Promise<{ records: StatusRecord[] }> {
    return { records: await fetchHistory(uuid, hours) }
  }

  async getPingRecords(uuid: string, hours = 1): Promise<{ records: PingRecord[] }> {
    return { records: (await fetchPingHistory(uuid, hours)).records }
  }

  close(): void {
    this.client.close()
  }
}

let sharedRpc: CfHistoryFacade | null = null

export function getSharedRpc(): CfHistoryFacade {
  sharedRpc ??= new CfHistoryFacade()
  return sharedRpc
}

export function resetSharedRpc(): void {
  sharedRpc?.close()
  sharedRpc = null
}
