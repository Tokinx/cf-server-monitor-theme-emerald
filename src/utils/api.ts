import type { Client, NodeStatus, NodeStatusPing, PingRecord, StatusRecord } from '@/utils/rpc'

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000
const MB = 1024 * 1024
const LEADING_SLASHES_REGEX = /^\/+/
const TRAILING_SLASHES_REGEX = /\/+$/
const NON_PRICE_CHARACTERS_REGEX = /[^\d.-]/g
const YEAR_SUFFIX_REGEX = /\/y(?:ear)?$/i
const QUARTER_SUFFIX_REGEX = /\/q(?:uarter)?$/i
const WHITESPACE_REGEX = /\s+/

export interface SiteConfig {
  version: string
  last_workers_version?: string | null
  last_agent_version?: string | null
  is_public: boolean | string
  authorization: boolean
  turnstile_enabled: boolean | string
  turnstile_login_enabled?: boolean | string
  turnstile_site_key?: string
  site_title?: string
  verified?: boolean
  turnstile_verified?: string | null
  show_long_history?: boolean
  theme_options?: unknown
}

export interface SysConfig {
  show_price?: boolean
  show_expire?: boolean
  show_tf?: boolean
  show_time?: boolean
  show_long_history?: boolean
}

export interface CfServer {
  id: string
  name?: string
  server_group?: string
  tags?: string
  price?: string
  expire_date?: string
  traffic_limit?: string | number
  traffic_calc_type?: string
  reset_day?: number
  report_interval?: number
  sort_order?: number
  cpu?: number | string
  load_avg?: string
  net_in_speed?: number | string
  net_out_speed?: number | string
  net_rx?: number | string
  net_tx?: number | string
  net_rx_monthly?: number | string
  net_tx_monthly?: number | string
  processes?: number | string
  tcp_conn?: number | string
  udp_conn?: number | string
  ping_ct?: number | string | null
  ping_cu?: number | string | null
  ping_cm?: number | string | null
  ping_bd?: number | string | null
  loss_ct?: number | string | null
  loss_cu?: number | string | null
  loss_cm?: number | string | null
  loss_bd?: number | string | null
  ram_total?: number | string
  ram_used?: number | string
  swap_total?: number | string
  swap_used?: number | string
  disk_total?: number | string
  disk_used?: number | string
  cpu_cores?: number | string
  cpu_info?: string
  gpu?: number | string | null
  gpu_info?: string
  arch?: string
  os?: string
  region?: string
  ip_v4?: string
  ip_v6?: string
  boot_time?: string | number
  agent_version?: string
  last_updated?: number | string
  timestamp?: number | string
  is_online?: boolean
}

export interface ServersResponse {
  servers: CfServer[]
  sysConfig?: SysConfig
}

export type NodeViewMode = 'card' | 'list'
export type EarthViewMode = 'earth' | 'earth-stop' | 'maps' | 'cards' | 'hide'
export type BackgroundType = 'image' | 'video'

export interface ThemeSettings {
  defaultViewMode: NodeViewMode
  alertEnabled: boolean
  alertTitle: string
  alertContent: string
  earthViewMode: EarthViewMode
  visitorInfoCardEnabled: boolean
  hideAdminEntryWhenLoggedOut: boolean
  disablePageAnimation: boolean
  icpEnabled: boolean
  icpNumber: string
  icpUrl: string
  policeEnabled: boolean
  policeNumber: string
  policeUrl: string
  backgroundEnabled: boolean
  backgroundType: BackgroundType
  lightBackgroundUrl: string
  darkBackgroundUrl: string
  backgroundBlur: number
  backgroundOverlay: number
}

export interface PublicSettings {
  allow_cors: boolean
  custom_body: string
  custom_head: string
  description: string
  disable_password_login: boolean
  oauth_enable: boolean
  oauth_provider: string | null
  ping_record_preserve_time: number
  private_site: boolean
  record_enabled: boolean
  record_preserve_time: number
  sitename: string
  theme: string
  themeSettings: ThemeSettings
}

export interface MeInfo {
  logged_in: boolean
  username: string
}

export interface VersionInfo {
  hash: string
  version: string
}

export interface ServerSource {
  apiIndex: number
  baseUrl: string
  serverId: string
}

interface HistoryRow extends Record<string, unknown> {
  timestamp: number | string
}

interface AdaptedServer {
  client: Client
  status: NodeStatus
}

export class ApiError extends Error {
  code?: number
  apiIndex?: number

  constructor(message: string, code?: number, apiIndex?: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.apiIndex = apiIndex
  }
}

/** A browser-only network failure while requesting a backend on another origin. */
export class CorsError extends ApiError {
  origin: string

  constructor(origin: string, apiIndex?: number) {
    super('跨域请求被浏览器拦截', undefined, apiIndex)
    this.name = 'CorsError'
    this.origin = origin
  }
}

const sourceRegistry = new Map<string, ServerSource>()
let cachedSiteConfigs: SiteConfig[] = []

function enabled(value: unknown): boolean {
  return value === true || value === 'true'
}

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  defaultViewMode: 'card',
  alertEnabled: false,
  alertTitle: '',
  alertContent: '',
  earthViewMode: 'earth',
  visitorInfoCardEnabled: true,
  hideAdminEntryWhenLoggedOut: false,
  disablePageAnimation: false,
  icpEnabled: false,
  icpNumber: '',
  icpUrl: 'https://beian.miit.gov.cn/',
  policeEnabled: false,
  policeNumber: '',
  policeUrl: '',
  backgroundEnabled: false,
  backgroundType: 'image',
  lightBackgroundUrl: '',
  darkBackgroundUrl: '',
  backgroundBlur: 0,
  backgroundOverlay: 0,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function themeOptionValues(value: unknown): Record<string, unknown> {
  if (!isRecord(value))
    return {}

  const values: Record<string, unknown> = {}
  const configuration = value.configuration
  if (Array.isArray(configuration)) {
    for (const item of configuration) {
      if (!isRecord(item) || typeof item.key !== 'string')
        continue
      values[item.key] = item.value
    }
  }

  for (const [key, optionValue] of Object.entries(value)) {
    if (key !== 'configuration')
      values[key] = optionValue
  }
  return values
}

function themeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean')
    return value
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true')
      return true
    if (value.toLowerCase() === 'false')
      return false
  }
  return fallback
}

function themeString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function themeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : fallback
}

function themeEnum<T extends string>(value: unknown, fallback: T, values: readonly T[]): T {
  return typeof value === 'string' && (values as readonly string[]).includes(value) ? value as T : fallback
}

/** Converts the CF Server Monitor `theme_options` wire format to UI-safe values. */
export function adaptThemeOptions(value: unknown): ThemeSettings {
  const options = themeOptionValues(value)
  return {
    defaultViewMode: themeEnum(options.defaultViewMode, DEFAULT_THEME_SETTINGS.defaultViewMode, ['card', 'list']),
    alertEnabled: themeBoolean(options.alertEnabled, DEFAULT_THEME_SETTINGS.alertEnabled),
    alertTitle: themeString(options.alertTitle, DEFAULT_THEME_SETTINGS.alertTitle),
    alertContent: themeString(options.alertContent, DEFAULT_THEME_SETTINGS.alertContent),
    earthViewMode: themeEnum(options.earthViewMode, DEFAULT_THEME_SETTINGS.earthViewMode, ['earth', 'earth-stop', 'maps', 'cards', 'hide']),
    visitorInfoCardEnabled: themeBoolean(options.visitorInfoCardEnabled, DEFAULT_THEME_SETTINGS.visitorInfoCardEnabled),
    hideAdminEntryWhenLoggedOut: themeBoolean(options.hideAdminEntryWhenLoggedOut, DEFAULT_THEME_SETTINGS.hideAdminEntryWhenLoggedOut),
    disablePageAnimation: themeBoolean(options.disablePageAnimation, DEFAULT_THEME_SETTINGS.disablePageAnimation),
    icpEnabled: themeBoolean(options.icpEnabled, DEFAULT_THEME_SETTINGS.icpEnabled),
    icpNumber: themeString(options.icpNumber, DEFAULT_THEME_SETTINGS.icpNumber),
    icpUrl: themeString(options.icpUrl, DEFAULT_THEME_SETTINGS.icpUrl),
    policeEnabled: themeBoolean(options.policeEnabled, DEFAULT_THEME_SETTINGS.policeEnabled),
    policeNumber: themeString(options.policeNumber, DEFAULT_THEME_SETTINGS.policeNumber),
    policeUrl: themeString(options.policeUrl, DEFAULT_THEME_SETTINGS.policeUrl),
    backgroundEnabled: themeBoolean(options.backgroundEnabled, DEFAULT_THEME_SETTINGS.backgroundEnabled),
    backgroundType: themeEnum(options.backgroundType, DEFAULT_THEME_SETTINGS.backgroundType, ['image', 'video']),
    lightBackgroundUrl: themeString(options.lightBackgroundUrl, DEFAULT_THEME_SETTINGS.lightBackgroundUrl),
    darkBackgroundUrl: themeString(options.darkBackgroundUrl, DEFAULT_THEME_SETTINGS.darkBackgroundUrl),
    backgroundBlur: themeNumber(options.backgroundBlur, DEFAULT_THEME_SETTINGS.backgroundBlur, 0, 100),
    backgroundOverlay: themeNumber(options.backgroundOverlay, DEFAULT_THEME_SETTINGS.backgroundOverlay, -100, 100),
  }
}

function finiteNumber(value: unknown): number {
  const number = Number.parseFloat(String(value ?? 0))
  return Number.isFinite(number) ? number : 0
}

function numberField(source: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '')
      return finiteNumber(value)
  }
  return 0
}

function timestamp(value: unknown, fallback = Date.now()): number {
  const number = finiteNumber(value)
  if (!number)
    return fallback
  return number < 1e12 ? number * 1000 : number
}

function getMetaContent(name: string): string {
  if (typeof document === 'undefined')
    return ''
  return document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content?.trim() ?? ''
}

function normalizeBase(value: string): string {
  return value.trim().replace(TRAILING_SLASHES_REGEX, '')
}

function getConfiguredApiBases(): string[] {
  return getMetaContent('apiBase').split(',').map(normalizeBase).filter(Boolean)
}

export function isProxyBackendEnabled(): boolean {
  return getMetaContent('proxyBackend').toLowerCase() === 'true'
}

export function isProxyWebSocketEnabled(): boolean {
  return getMetaContent('proxyWebSocket').toLowerCase() !== 'false'
}

export function getApiBases(): string[] {
  if (isProxyBackendEnabled())
    return ['']

  const bases = getConfiguredApiBases()
  if (bases.length)
    return [...new Set(bases)]
  return [typeof window === 'undefined' ? '' : window.location.origin]
}

export function getWebSocketBases(): string[] {
  if (isProxyWebSocketEnabled())
    return getApiBases()

  const configured = getMetaContent('webSocketBase')
  const bases = configured.split(',').map(normalizeBase).filter(Boolean)
  return bases.length ? [...new Set(bases)] : getApiBases()
}

export function getDirectApiAssetUrl(path: string, apiIndex = 0): string {
  const bases = getConfiguredApiBases()
  const base = bases[apiIndex] ?? bases[0] ?? ''
  const cleanPath = path.replace(LEADING_SLASHES_REGEX, '')
  return base ? `${base}/${cleanPath}` : getApiAssetUrl(path, apiIndex)
}

export function getApiAssetUrl(path: string, apiIndex = 0): string {
  const bases = getApiBases()
  const base = bases[apiIndex] ?? bases[0] ?? ''
  const cleanPath = path.replace(LEADING_SLASHES_REGEX, '')
  return base ? `${normalizeBase(base)}/${cleanPath}` : `/${cleanPath}`
}

export function hasMultipleApiBases(): boolean {
  return getApiBases().length > 1
}

export function getServerSource(uuid: string): ServerSource {
  return sourceRegistry.get(uuid) ?? {
    apiIndex: 0,
    baseUrl: getApiBases()[0] ?? '',
    serverId: uuid,
  }
}

export function getRegisteredServerIds(apiIndex: number): string[] {
  return [...sourceRegistry.values()]
    .filter(source => source.apiIndex === apiIndex)
    .map(source => source.serverId)
}

export function getRegisteredDisplayUuids(): string[] {
  return [...sourceRegistry.keys()]
}

export function getDisplayUuid(apiIndex: number, serverId: string): string {
  return hasMultipleApiBases() ? `${apiIndex}:${serverId}` : serverId
}

function authHeaders(baseUrl: string): Record<string, string> {
  const headers: Record<string, string> = {}
  const token = localStorage.getItem('token') || localStorage.getItem('auth_token')
  if (token)
    headers.Authorization = `Bearer ${token}`

  const host = new URL(baseUrl, window.location.origin).hostname
  const turnstileToken = localStorage.getItem('turnstile_token')
  const verified = localStorage.getItem(`turnstile_verified_${host}`) || localStorage.getItem('turnstile_verified')
  if (turnstileToken)
    headers['X-Turnstile-Token'] = turnstileToken
  else if (verified)
    headers['X-Turnstile-Verified'] = verified
  return headers
}

function isCrossOriginRequest(baseUrl: string): boolean {
  if (typeof window === 'undefined')
    return false

  try {
    return new URL(baseUrl, window.location.origin).origin !== window.location.origin
  }
  catch {
    return false
  }
}

async function request<T>(path: string, apiIndex = 0, options: RequestInit = {}): Promise<T> {
  const bases = getApiBases()
  const baseUrl = bases[apiIndex] ?? bases[0] ?? ''
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...authHeaders(baseUrl),
        ...options.headers,
      },
    })
  }
  catch (error) {
    // Fetch intentionally hides CORS details from JavaScript. For a request to
    // another origin, this gives the UI a useful remediation path instead of a
    // generic connection error.
    if (isCrossOriginRequest(baseUrl))
      throw new CorsError(window.location.origin, apiIndex)
    throw error
  }

  let data: unknown
  try {
    data = await response.json()
  }
  catch {
    data = null
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? String((data as { error: unknown }).error)
      : `HTTP ${response.status}`
    if (response.status === 403) {
      const host = new URL(baseUrl, window.location.origin).hostname
      localStorage.removeItem(`turnstile_verified_${host}`)
      localStorage.removeItem('turnstile_verified')
    }
    throw new ApiError(message, response.status, apiIndex)
  }

  if (data && typeof data === 'object' && 'turnstile_verified' in data) {
    const verified = String((data as { turnstile_verified?: unknown }).turnstile_verified || '')
    if (verified) {
      const host = new URL(baseUrl, window.location.origin).hostname
      localStorage.setItem(`turnstile_verified_${host}`, verified)
      localStorage.setItem('turnstile_verified', verified)
      localStorage.removeItem('turnstile_token')
    }
  }
  return data as T
}

export async function fetchSiteConfigs(): Promise<SiteConfig[]> {
  const results = await Promise.all(getApiBases().map((_, index) => request<SiteConfig>('/api/config', index)))
  cachedSiteConfigs = results
  return results
}

export function getCachedSiteConfigs(): SiteConfig[] {
  return cachedSiteConfigs
}

function parsePrice(value: unknown): { price: number, currency: string, billingCycle: number } {
  const text = String(value ?? '').trim()
  const price = finiteNumber(text.replace(NON_PRICE_CHARACTERS_REGEX, ''))
  const currency = text.includes('$') ? 'USD' : text.includes('€') ? 'EUR' : text.includes('£') ? 'GBP' : 'CNY'
  const lower = text.toLowerCase()
  const billingCycle = lower.includes('year') || text.includes('/年') || YEAR_SUFFIX_REGEX.test(text)
    ? 365
    : lower.includes('quarter') || text.includes('/季') || QUARTER_SUFFIX_REGEX.test(text)
      ? 90
      : lower.includes('once') || text.includes('一次') ? -1 : 30
  return { price, currency, billingCycle }
}

function parseTrafficLimit(value: unknown): number {
  const text = String(value ?? '').trim().toUpperCase()
  const amount = finiteNumber(text)
  if (!amount)
    return 0
  if (text.includes('PB'))
    return amount * 1024 ** 5
  if (text.includes('TB'))
    return amount * 1024 ** 4
  if (text.includes('MB'))
    return amount * 1024 ** 2
  if (text.includes('KB'))
    return amount * 1024
  return amount * 1024 ** 3
}

function trafficLimitType(value: unknown): string {
  const type = String(value ?? '').toLowerCase()
  if (type === 'dl' || type === 'down')
    return 'down'
  if (type === 'ul' || type === 'up')
    return 'up'
  return 'sum'
}

function pingEntry(name: string, latency: unknown, loss: unknown): NodeStatusPing {
  const latest = finiteNumber(latency)
  const lossValue = finiteNumber(loss)
  return { name, latest, avg: latest, tail: latest, loss: lossValue, min: latest, max: latest }
}

export function adaptServer(server: CfServer, apiIndex: number): AdaptedServer {
  const wire = server as unknown as Record<string, unknown>
  const uuid = getDisplayUuid(apiIndex, server.id)
  const baseUrl = getApiBases()[apiIndex] ?? ''
  sourceRegistry.set(uuid, { apiIndex, baseUrl, serverId: server.id })

  const price = parsePrice(server.price)
  const updatedAt = timestamp(wire.report_timestamp ?? server.last_updated ?? server.timestamp, 0)
  const load = String(server.load_avg ?? '').split(WHITESPACE_REGEX).map(finiteNumber)
  const now = Date.now()
  const bootTime = timestamp(server.boot_time, 0)
  const online = server.is_online ?? (updatedAt > 0 && now - updatedAt < ONLINE_THRESHOLD_MS)
  const ping: Record<string, NodeStatusPing> = {
    ct: pingEntry('电信', server.ping_ct, server.loss_ct),
    cu: pingEntry('联通', server.ping_cu, server.loss_cu),
    cm: pingEntry('移动', server.ping_cm, server.loss_cm),
    bd: pingEntry('BGP', server.ping_bd, server.loss_bd),
  }

  return {
    client: {
      uuid,
      source_id: server.id,
      source_index: apiIndex,
      name: server.name || server.id,
      cpu_name: server.cpu_info || '-',
      virtualization: '-',
      arch: server.arch || '-',
      cpu_cores: finiteNumber(server.cpu_cores),
      os: server.os || '-',
      boot_time: bootTime ? new Date(bootTime).toISOString() : '',
      gpu_name: server.gpu_info || '',
      ipv4: server.ip_v4,
      ipv6: server.ip_v6,
      region: String(server.region || '').toUpperCase(),
      public_remark: '',
      mem_total: finiteNumber(server.ram_total) * MB,
      swap_total: finiteNumber(server.swap_total) * MB,
      disk_total: finiteNumber(server.disk_total) * MB,
      version: server.agent_version,
      weight: finiteNumber(server.sort_order),
      price: price.price,
      billing_cycle: price.billingCycle,
      auto_renewal: false,
      currency: price.currency,
      expired_at: server.expire_date || '9999-12-31',
      group: server.server_group || '默认分组',
      tags: server.tags || '',
      hidden: false,
      traffic_limit: parseTrafficLimit(server.traffic_limit),
      traffic_limit_type: trafficLimitType(server.traffic_calc_type),
      created_at: '',
      updated_at: updatedAt ? new Date(updatedAt).toISOString() : '',
    },
    status: {
      client: uuid,
      time: updatedAt ? new Date(updatedAt).toISOString() : '',
      cpu: finiteNumber(server.cpu),
      gpu: finiteNumber(server.gpu),
      ram: finiteNumber(server.ram_used) * MB,
      ram_total: finiteNumber(server.ram_total) * MB,
      swap: finiteNumber(server.swap_used) * MB,
      swap_total: finiteNumber(server.swap_total) * MB,
      load: load[0] ?? 0,
      load5: load[1] ?? 0,
      load15: load[2] ?? 0,
      temp: 0,
      disk: finiteNumber(server.disk_used) * MB,
      disk_total: finiteNumber(server.disk_total) * MB,
      net_in: numberField(wire, 'net_in_speed', 'net_in'),
      net_out: numberField(wire, 'net_out_speed', 'net_out'),
      net_total_up: numberField(wire, 'net_tx', 'net_total_up', 'net_tx_monthly'),
      net_total_down: numberField(wire, 'net_rx', 'net_total_down', 'net_rx_monthly'),
      net_monthly_up: numberField(wire, 'net_tx_monthly', 'net_tx'),
      net_monthly_down: numberField(wire, 'net_rx_monthly', 'net_rx'),
      process: finiteNumber(server.processes),
      connections: finiteNumber(server.tcp_conn),
      connections_udp: finiteNumber(server.udp_conn),
      online,
      uptime: Math.max(0, Math.floor((now - bootTime) / 1000)),
      ping,
    },
  }
}

export async function fetchAllServers(): Promise<{ clients: Record<string, Client>, statuses: Record<string, NodeStatus> }> {
  sourceRegistry.clear()
  const responses = await Promise.all(getApiBases().map((_, index) => request<ServersResponse>('/api/servers', index)))
  const clients: Record<string, Client> = {}
  const statuses: Record<string, NodeStatus> = {}
  responses.forEach((response, apiIndex) => {
    for (const server of response.servers ?? []) {
      const adapted = adaptServer(server, apiIndex)
      clients[adapted.client.uuid] = adapted.client
      statuses[adapted.client.uuid] = adapted.status
    }
  })
  return { clients, statuses }
}

function rowToStatusRecord(uuid: string, row: HistoryRow): StatusRecord {
  const wire = row as Record<string, unknown>
  const time = new Date(timestamp(row.timestamp)).toISOString()
  const load = String(row.load_avg ?? '').split(WHITESPACE_REGEX).map(finiteNumber)
  return {
    client: uuid,
    time,
    cpu: finiteNumber(row.cpu),
    gpu: finiteNumber(row.gpu),
    ram: finiteNumber(row.ram_used) * MB,
    ram_total: finiteNumber(row.ram_total) * MB,
    swap: finiteNumber(row.swap_used) * MB,
    swap_total: finiteNumber(row.swap_total) * MB,
    load: load[0] ?? 0,
    load5: load[1] ?? 0,
    load15: load[2] ?? 0,
    temp: 0,
    disk: finiteNumber(row.disk_used) * MB,
    disk_total: finiteNumber(row.disk_total) * MB,
    net_in: numberField(wire, 'net_in_speed', 'net_in'),
    net_out: numberField(wire, 'net_out_speed', 'net_out'),
    net_total_up: numberField(wire, 'net_tx', 'net_total_up', 'net_tx_monthly'),
    net_total_down: numberField(wire, 'net_rx', 'net_total_down', 'net_rx_monthly'),
    net_monthly_up: numberField(wire, 'net_tx_monthly', 'net_tx'),
    net_monthly_down: numberField(wire, 'net_rx_monthly', 'net_rx'),
    process: finiteNumber(row.processes),
    connections: finiteNumber(row.tcp_conn),
    connections_udp: finiteNumber(row.udp_conn),
  }
}

export async function fetchHistory(uuid: string, hours = 0.167): Promise<StatusRecord[]> {
  const source = getServerSource(uuid)
  const rows = await request<HistoryRow[]>(`/api/history/all?id=${encodeURIComponent(source.serverId)}&hours=${hours}`, source.apiIndex)
  return (rows ?? []).map(row => rowToStatusRecord(uuid, row))
}

const PING_TASKS = [
  { id: 1, key: 'ct', name: '电信' },
  { id: 2, key: 'cu', name: '联通' },
  { id: 3, key: 'cm', name: '移动' },
  { id: 4, key: 'bd', name: 'BGP' },
] as const

export async function fetchPingHistory(uuid: string, hours = 1): Promise<{
  records: PingRecord[]
  tasks: Array<{ id: number, name: string, interval: number, loss: number }>
}> {
  const source = getServerSource(uuid)
  const rows = await request<HistoryRow[]>(`/api/history/all?id=${encodeURIComponent(source.serverId)}&hours=${hours}`, source.apiIndex)
  const records: PingRecord[] = []
  const losses = new Map<number, number[]>()

  for (const row of rows ?? []) {
    const time = new Date(timestamp(row.timestamp)).toISOString()
    for (const task of PING_TASKS) {
      const latencyValue = row[`ping_${task.key}`]
      const lossValue = finiteNumber(row[`loss_${task.key}`])
      if (latencyValue === undefined && row[`loss_${task.key}`] === undefined)
        continue
      const latency = finiteNumber(latencyValue)
      records.push({
        client: uuid,
        task_id: task.id,
        time,
        value: lossValue >= 100 || latency <= 0 ? -1 : latency,
        loss: lossValue,
      })
      const taskLosses = losses.get(task.id) ?? []
      taskLosses.push(lossValue)
      losses.set(task.id, taskLosses)
    }
  }

  return {
    records,
    tasks: PING_TASKS.map(task => ({
      id: task.id,
      name: task.name,
      interval: 60,
      loss: (losses.get(task.id) ?? []).reduce((sum, value) => sum + value, 0) / Math.max(1, losses.get(task.id)?.length ?? 0),
    })),
  }
}

export async function fetchServer(uuid: string): Promise<CfServer> {
  const source = getServerSource(uuid)
  return request<CfServer>(`/api/server?id=${encodeURIComponent(source.serverId)}`, source.apiIndex)
}

export function buildAdminUrl(apiIndex = 0): string {
  const bases = getConfiguredApiBases()
  const base = bases[apiIndex] ?? bases[0] ?? window.location.origin
  return `${base}/#/admin`
}

export class CfMonitorApi {
  async getPublicSettings(): Promise<PublicSettings> {
    const configs = cachedSiteConfigs.length ? cachedSiteConfigs : await fetchSiteConfigs()
    const first = configs[0]
    const loggedIn = configs.some(config => config.authorization)
    const historyHours = loggedIn ? (first?.show_long_history ? 168 : 24) : 1
    return {
      allow_cors: true,
      custom_body: '',
      custom_head: '',
      description: '',
      disable_password_login: false,
      oauth_enable: false,
      oauth_provider: null,
      ping_record_preserve_time: historyHours,
      private_site: first ? !enabled(first.is_public) : false,
      record_enabled: true,
      record_preserve_time: historyHours,
      sitename: hasMultipleApiBases() ? document.title : first?.site_title || document.title || 'CF Server Monitor',
      theme: 'emerald',
      themeSettings: adaptThemeOptions(first?.theme_options),
    }
  }

  async getMe(): Promise<MeInfo> {
    const configs = cachedSiteConfigs.length ? cachedSiteConfigs : await fetchSiteConfigs()
    return { logged_in: configs.some(config => config.authorization), username: '' }
  }

  async getVersion(): Promise<VersionInfo> {
    const configs = cachedSiteConfigs.length ? cachedSiteConfigs : await fetchSiteConfigs()
    return { version: configs.map(config => config.version).filter(Boolean).join(' / '), hash: '' }
  }
}

let sharedApi: CfMonitorApi | null = null

export function getSharedApi(): CfMonitorApi {
  sharedApi ??= new CfMonitorApi()
  return sharedApi
}

export function resetSharedApi(): void {
  sharedApi = null
}

export { request as cfRequest, enabled as isEnabledValue }

export default CfMonitorApi
