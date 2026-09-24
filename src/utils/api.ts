import type { CurrencyCode } from '@/utils/financeHelper'
import type { Client, NodeStatus, NodeStatusPing, PingRecord, PingWindowPoint, StatusRecord } from '@/utils/rpc'
import { isSupportedCurrency, normalizedCurrencyMap } from '@/utils/financeHelper'
import { requestTurnstileToken } from '@/utils/turnstile'

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000
const MB = 1024 * 1024
const LEADING_SLASHES_REGEX = /^\/+/
const TRAILING_SLASHES_REGEX = /\/+$/
const PRICE_NUMBER_REGEX = /-?[\d.,]+/
const BILLING_CYCLE_SUFFIX_REGEX = /\/\s*(?:(\d+(?:\.\d+)?)\s*)?(d(?:ay)?s?|m(?:onth)?s?|q(?:uarter)?s?|y(?:ear)?s?)\s*$/i
const FREE_PRICE_REGEX = /^(?:free|免费)$/i
const ONCE_BILLING_REGEX = /^(?:once|one[-_\s]?time|一次性?)$/i
const COMPACT_BILLING_REGEX = /(?:^|\/)\s*(?:(\d+(?:\.\d+)?)\s*)?([dmqy]|day|days|mo|month|months|quarter|quarters|yr|year|years)\s*$/i
const FIVE_YEAR_REGEX = /五年|5\s*(?:years?|yrs?|y)/i
const FOUR_YEAR_REGEX = /四年|4\s*(?:years?|yrs?|y)/i
const THREE_YEAR_REGEX = /三年|3\s*(?:years?|yrs?|y)/i
const TWO_YEAR_REGEX = /两年|二年|2\s*(?:years?|yrs?|y)/i
const HALF_YEAR_REGEX = /半年|half[-_\s]?year/i
const QUARTER_REGEX = /季|quarter/i
const YEAR_REGEX = /年|annual|year|yr\b/i
const MONTH_REGEX = /月|monthly|month|mo\b/i
const NUMERIC_BILLING_REGEX = /^-?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/
const WHITESPACE_REGEX = /\s+/

/**
 * `/api/servers` has used two billing contracts over its lifetime:
 *
 * - legacy versions put the amount, currency and cycle in one free-form
 *   `price` string (for example `￥30/月` or `$60/3Y`);
 * - current versions expose a normalized amount plus `billing_cycle` and
 *   `currency` fields.
 *
 * The UI keeps a day-based cycle internally, so the current enum values are
 * mapped here once at the HTTP adaptation boundary.
 */
const BILLING_CYCLE_DAYS = {
  month: 30,
  quarter: 90,
  half_year: 180,
  year: 365,
  two_years: 730,
  three_years: 1095,
  four_years: 1460,
  five_years: 1825,
} as const

type BillingCycleKey = keyof typeof BILLING_CYCLE_DAYS

const BILLING_CYCLE_ALIASES: Record<string, BillingCycleKey> = {
  '月': 'month',
  'monthly': 'month',
  'month': 'month',
  'mo': 'month',
  '季': 'quarter',
  '季度': 'quarter',
  'quarterly': 'quarter',
  'quarter': 'quarter',
  '半年': 'half_year',
  'halfyear': 'half_year',
  'half_year': 'half_year',
  'half-year': 'half_year',
  'halfyearly': 'half_year',
  'half-yearly': 'half_year',
  '年': 'year',
  '一年': 'year',
  'annual': 'year',
  'yearly': 'year',
  'year': 'year',
  '两年': 'two_years',
  '二年': 'two_years',
  'two_years': 'two_years',
  'two-years': 'two_years',
  '2 years': 'two_years',
  '三年': 'three_years',
  'three_years': 'three_years',
  'three-years': 'three_years',
  '3 years': 'three_years',
  '四年': 'four_years',
  'four_years': 'four_years',
  'four-years': 'four_years',
  '4 years': 'four_years',
  '五年': 'five_years',
  'five_years': 'five_years',
  'five-years': 'five_years',
  '5 years': 'five_years',
}

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
  /** 一小时延迟窗口配置（points=输出桶数，hours=窗口时长），前端据此对齐首页 ping/loss 数据粒度 */
  latency_window?: {
    points?: number
    hours?: number
  }
  /** 自定义 Ping 运营商名称（旧版后端不返回时回退默认名称） */
  custom_ct_name?: string
  custom_cu_name?: string
  custom_cm_name?: string
  custom_bd_name?: string
  /** 详情页自定义节点名称（旧版后端不返回时回退默认名称） */
  node_1_name?: string
  node_2_name?: string
  node_3_name?: string
  node_4_name?: string
}

export interface SysConfig {
  show_price?: boolean
  show_expire?: boolean
  show_tf?: boolean
  show_time?: boolean
  show_long_history?: boolean
  /** 后端开关：是否在 /api/servers 输出 ping/loss 一小时窗口；关闭时主题回退到单条 ping 数据 */
  show_three_net_details?: boolean
}

/** 一小时延迟窗口中的单个点（2 分钟桶；ct/cu/cm/bd 为探测节点值，false=探测禁用，null=无数据） */
export interface LatencyWindowPoint {
  ts?: number | string
  ct?: number | string | boolean | null
  cu?: number | string | boolean | null
  cm?: number | string | boolean | null
  bd?: number | string | boolean | null
}

export interface CfServer {
  id: string
  name?: string
  server_group?: string
  tags?: string
  price?: string | number | null
  billing_cycle?: string | number | null
  auto_renewal?: boolean | string | number | null
  currency?: string | null
  expire_date?: string | null
  expired_at?: string | null
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
  ping_node_1?: number | string | null
  ping_node_2?: number | string | null
  ping_node_3?: number | string | null
  ping_node_4?: number | string | null
  loss_node_1?: number | string | null
  loss_node_2?: number | string | null
  loss_node_3?: number | string | null
  loss_node_4?: number | string | null
  /** 一小时延迟窗口（旧→新，桶数与区间由 /api/config 的 latency_window 决定），仅 /api/servers 列表返回 */
  ping?: LatencyWindowPoint[]
  loss?: LatencyWindowPoint[]
  ram_total?: number | string
  ram_used?: number | string
  swap_total?: number | string
  swap_used?: number | string
  disk_total?: number | string
  disk_used?: number | string
  cpu_cores?: number | string
  cpu_info?: string
  gpu?: number | string | null
  gpu_info?: string | unknown[]
  arch?: string
  os?: string
  region?: string
  ip_v4?: string
  ip_v6?: string
  boot_time?: string | number
  kernel_version?: string
  agent_version?: string
  last_updated?: number | string
  timestamp?: number | string
  is_online?: boolean
}

export interface LatestReportSample {
  ts?: number | string
  payload?: Record<string, unknown>
  data?: Record<string, unknown>
}

export interface LatestReportUpdate {
  serverId: string
  reportTs?: number | string
  samples?: LatestReportSample[]
  reportAgeMs?: number
}

export interface ServersResponse {
  servers: CfServer[]
  latestReportUpdates?: LatestReportUpdate[]
  stats?: Record<string, unknown>
  regionStats?: Record<string, unknown>
  sysConfig?: SysConfig
}

export type ThemeMode = 'auto' | 'light' | 'dark'
export type NodeViewMode = 'card' | 'list'
export type EarthViewMode = 'earth' | 'earth-stop' | 'maps' | 'cards' | 'hide'
export type BackgroundType = 'image' | 'video'

export interface ThemeSettings {
  defaultThemeMode: ThemeMode
  defaultViewMode: NodeViewMode
  alertEnabled: boolean
  alertTitle: string
  alertContent: string
  earthViewMode: EarthViewMode
  visitorInfoCardEnabled: boolean
  hideAdminEntryWhenLoggedOut: boolean
  disablePageAnimation: boolean
  offlineNodesLast: boolean
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

type PingProviderKey = 'ct' | 'cu' | 'cm' | 'bd'
type PingNodeKey = 'node_1' | 'node_2' | 'node_3' | 'node_4'
type PingTaskKey = PingProviderKey | PingNodeKey

const DEFAULT_PING_TASK_NAMES: Record<PingTaskKey, string> = {
  ct: '电信',
  cu: '联通',
  cm: '移动',
  bd: 'BGP',
  node_1: '节点 1',
  node_2: '节点 2',
  node_3: '节点 3',
  node_4: '节点 4',
}

/** Ping 显示名称，由 /api/config 的自定义名称覆盖，未配置时为默认值 */
let pingTaskNames: Record<PingTaskKey, string> = { ...DEFAULT_PING_TASK_NAMES }

/** /api/config 未返回自定义名称或返回空值时逐项回退默认名称，兼容旧版后端 */
function applyCustomPingNames(config?: SiteConfig): void {
  if (!config)
    return
  pingTaskNames = {
    ...DEFAULT_PING_TASK_NAMES,
    ct: config.custom_ct_name?.trim() || DEFAULT_PING_TASK_NAMES.ct,
    cu: config.custom_cu_name?.trim() || DEFAULT_PING_TASK_NAMES.cu,
    cm: config.custom_cm_name?.trim() || DEFAULT_PING_TASK_NAMES.cm,
    bd: config.custom_bd_name?.trim() || DEFAULT_PING_TASK_NAMES.bd,
    node_1: config.node_1_name?.trim() || DEFAULT_PING_TASK_NAMES.node_1,
    node_2: config.node_2_name?.trim() || DEFAULT_PING_TASK_NAMES.node_2,
    node_3: config.node_3_name?.trim() || DEFAULT_PING_TASK_NAMES.node_3,
    node_4: config.node_4_name?.trim() || DEFAULT_PING_TASK_NAMES.node_4,
  }
}

function enabled(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  defaultViewMode: 'card',
  defaultThemeMode: 'auto',
  alertEnabled: false,
  alertTitle: '',
  alertContent: '',
  earthViewMode: 'earth',
  visitorInfoCardEnabled: true,
  hideAdminEntryWhenLoggedOut: false,
  disablePageAnimation: false,
  offlineNodesLast: false,
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
    defaultThemeMode: themeEnum(options.defaultThemeMode, DEFAULT_THEME_SETTINGS.defaultThemeMode, ['auto', 'light', 'dark']),
    alertEnabled: themeBoolean(options.alertEnabled, DEFAULT_THEME_SETTINGS.alertEnabled),
    alertTitle: themeString(options.alertTitle, DEFAULT_THEME_SETTINGS.alertTitle),
    alertContent: themeString(options.alertContent, DEFAULT_THEME_SETTINGS.alertContent),
    earthViewMode: themeEnum(options.earthViewMode, DEFAULT_THEME_SETTINGS.earthViewMode, ['earth', 'earth-stop', 'maps', 'cards', 'hide']),
    visitorInfoCardEnabled: themeBoolean(options.visitorInfoCardEnabled, DEFAULT_THEME_SETTINGS.visitorInfoCardEnabled),
    hideAdminEntryWhenLoggedOut: themeBoolean(options.hideAdminEntryWhenLoggedOut, DEFAULT_THEME_SETTINGS.hideAdminEntryWhenLoggedOut),
    disablePageAnimation: themeBoolean(options.disablePageAnimation, DEFAULT_THEME_SETTINGS.disablePageAnimation),
    offlineNodesLast: themeBoolean(options.offlineNodesLast, DEFAULT_THEME_SETTINGS.offlineNodesLast),
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

function parseGpuInfo(raw: unknown): Array<{ id?: number | string, name?: string, info?: string }> {
  if (!raw)
    return []
  if (Array.isArray(raw))
    return raw as Array<{ id?: number | string, name?: string, info?: string }>
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    }
    catch { return [] }
  }
  return []
}

function getGpuName(raw: unknown): string {
  const list = parseGpuInfo(raw)
  if (list.length > 0)
    return list.map(g => g.name || g.id || 'GPU').join(' / ')
  return String(raw ?? '')
}

function normalizeGpuInfo(raw: unknown): string {
  if (!raw)
    return ''
  if (typeof raw === 'string') {
    if (raw.startsWith('[') || raw.startsWith('{'))
      return raw
    return JSON.stringify([{ name: raw }])
  }
  if (Array.isArray(raw))
    return JSON.stringify(raw)
  return String(raw)
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

function normalizeBase(value: string): string {
  return value.trim().replace(TRAILING_SLASHES_REGEX, '')
}

export function getApiBases(): string[] {
  return [typeof window === 'undefined' ? '' : window.location.origin]
}

export function getWebSocketBases(): string[] {
  return getApiBases()
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

function getLocalStorageValue(key: string): string {
  if (typeof localStorage === 'undefined')
    return ''

  try {
    return localStorage.getItem(key)?.trim() ?? ''
  }
  catch {
    return ''
  }
}

function getBaseHostname(baseUrl: string): string {
  if (typeof window === 'undefined')
    return ''

  try {
    return new URL(baseUrl, window.location.origin).hostname
  }
  catch {
    return ''
  }
}

function authHeaders(baseUrl: string, initialHeaders?: HeadersInit): Headers {
  const headers = new Headers(initialHeaders)
  const token = getLocalStorageValue('jwt_token')
  if (token)
    headers.set('Authorization', `Bearer ${token}`)

  const host = getBaseHostname(baseUrl)
  const turnstileToken = getLocalStorageValue('turnstile_token')
  const verified = (host ? getLocalStorageValue(`turnstile_verified_${host}`) : '') || getLocalStorageValue('turnstile_verified')
  if (turnstileToken)
    headers.set('X-Turnstile-Token', turnstileToken)
  else if (verified)
    headers.set('X-Turnstile-Verified', verified)
  return headers
}

function clearTurnstileSession(baseUrl: string): void {
  try {
    const host = new URL(baseUrl, window.location.origin).hostname
    localStorage.removeItem(`turnstile_verified_${host}`)
    localStorage.removeItem('turnstile_verified')
    localStorage.removeItem('turnstile_token')
  }
  catch {}
}

function storeTurnstileVerified(baseUrl: string, verified: string): void {
  const host = new URL(baseUrl, window.location.origin).hostname
  localStorage.setItem(`turnstile_verified_${host}`, verified)
  localStorage.setItem('turnstile_verified', verified)
  localStorage.removeItem('turnstile_token')
}

/** 并发 403 共享同一次重新验证，避免一次性 token 被重复消费。 */
let turnstileRefreshPromise: Promise<boolean> | null = null

async function resolveTurnstileSiteKey(apiIndex: number): Promise<string | null> {
  const cached = cachedSiteConfigs[apiIndex] ?? cachedSiteConfigs[0]
  if (cached && enabled(cached.turnstile_enabled) && cached.turnstile_site_key)
    return cached.turnstile_site_key

  // Cold start：本地 verified 已过期被清掉后，裸请求拿 site key（不带 Turnstile 头）
  const bases = getApiBases()
  const baseUrl = bases[apiIndex] ?? bases[0] ?? ''

  try {
    const response = await fetch(`${baseUrl}/api/config`)
    if (!response.ok)
      return null
    const data = await response.json() as SiteConfig
    if (!enabled(data.turnstile_enabled) || !data.turnstile_site_key)
      return null
    if (!cachedSiteConfigs.length)
      cachedSiteConfigs = [data]
    else
      cachedSiteConfigs[apiIndex] = data
    return data.turnstile_site_key
  }
  catch {
    return null
  }
}

/**
 * Turnstile verified 失效后：弹窗重新验证，用 token 换新的 verified，再让调用方重试原请求。
 */
async function refreshTurnstileSession(apiIndex: number): Promise<boolean> {
  if (turnstileRefreshPromise)
    return turnstileRefreshPromise

  turnstileRefreshPromise = (async () => {
    const siteKey = await resolveTurnstileSiteKey(apiIndex)
    if (!siteKey)
      return false

    try {
      const token = await requestTurnstileToken(siteKey)
      localStorage.setItem('turnstile_token', token)
      // allowRetry=false：换票本身失败时不再嵌套弹窗
      await request('/api/config', apiIndex, {}, false)
      return true
    }
    catch {
      return false
    }
  })().finally(() => {
    turnstileRefreshPromise = null
  })

  return turnstileRefreshPromise
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

async function request<T>(
  path: string,
  apiIndex = 0,
  options: RequestInit = {},
  allowTurnstileRetry = true,
): Promise<T> {
  const bases = getApiBases()
  const baseUrl = bases[apiIndex] ?? bases[0] ?? ''
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: authHeaders(baseUrl, options.headers),
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
      clearTurnstileSession(baseUrl)
      if (allowTurnstileRetry && await refreshTurnstileSession(apiIndex))
        return request(path, apiIndex, options, false)
    }
    throw new ApiError(message, response.status, apiIndex)
  }

  if (data && typeof data === 'object' && 'turnstile_verified' in data) {
    const verified = String((data as { turnstile_verified?: unknown }).turnstile_verified || '')
    if (verified)
      storeTurnstileVerified(baseUrl, verified)
  }
  return data as T
}

export async function fetchSiteConfigs(): Promise<SiteConfig[]> {
  const results = await Promise.all(getApiBases().map((_, index) => request<SiteConfig>('/api/config', index)))
  cachedSiteConfigs = results
  applyCustomPingNames(results[0])
  return results
}

export function getCachedSiteConfigs(): SiteConfig[] {
  return cachedSiteConfigs
}

export interface AdaptedServerBilling {
  price: number
  priceConfigured: boolean
  billingCycle: number
  currency: string
  autoRenewal: boolean
}

function parsePriceAmount(value: unknown): { price: number, configured: boolean } {
  const text = String(value ?? '').trim()
  if (!text)
    return { price: 0, configured: false }

  if (FREE_PRICE_REGEX.test(text))
    return { price: -1, configured: true }

  // Only the part before the slash is the amount: "$60/3Y" must be 60, not 603.
  const amountText = text.split('/', 1)[0]?.match(PRICE_NUMBER_REGEX)?.[0]
  if (!amountText)
    return { price: 0, configured: false }

  const price = Number.parseFloat(amountText.replaceAll(',', ''))
  if (!Number.isFinite(price) || (price < 0 && price !== -1))
    return { price: 0, configured: false }

  return { price, configured: true }
}

function parseBillingCycleSuffix(countText: string | undefined, unit: string): number {
  const count = Number(countText || 1)
  const normalizedUnit = unit.toLowerCase()

  if (normalizedUnit.startsWith('y'))
    return count * 365
  if (normalizedUnit.startsWith('q'))
    return count * 90
  if (normalizedUnit.startsWith('m'))
    return count * 30
  return count
}

function parseBillingCycle(value: unknown): number | null {
  if (value === undefined || value === null || value === '')
    return null

  if (typeof value === 'number')
    return Number.isFinite(value) ? value : null

  const text = String(value).trim()
  if (!text)
    return null

  const numericCycle = Number(text)
  if (Number.isFinite(numericCycle))
    return numericCycle

  const normalized = text.toLowerCase().replaceAll(' ', '_')
  const aliasedCycle = BILLING_CYCLE_ALIASES[normalized] ?? BILLING_CYCLE_ALIASES[text.toLowerCase()]
  if (aliasedCycle)
    return BILLING_CYCLE_DAYS[aliasedCycle]

  if (ONCE_BILLING_REGEX.test(text))
    return -1

  const cycleSuffix = text.match(BILLING_CYCLE_SUFFIX_REGEX)
  if (cycleSuffix)
    return parseBillingCycleSuffix(cycleSuffix[1], cycleSuffix[2] ?? '')

  const compactCycle = text.match(COMPACT_BILLING_REGEX)
  if (compactCycle)
    return parseBillingCycleSuffix(compactCycle[1], compactCycle[2] ?? '')

  if (FIVE_YEAR_REGEX.test(text))
    return BILLING_CYCLE_DAYS.five_years
  if (FOUR_YEAR_REGEX.test(text))
    return BILLING_CYCLE_DAYS.four_years
  if (THREE_YEAR_REGEX.test(text))
    return BILLING_CYCLE_DAYS.three_years
  if (TWO_YEAR_REGEX.test(text))
    return BILLING_CYCLE_DAYS.two_years
  if (HALF_YEAR_REGEX.test(text))
    return BILLING_CYCLE_DAYS.half_year
  if (QUARTER_REGEX.test(text))
    return BILLING_CYCLE_DAYS.quarter
  if (YEAR_REGEX.test(text))
    return BILLING_CYCLE_DAYS.year
  if (MONTH_REGEX.test(text))
    return BILLING_CYCLE_DAYS.month

  return null
}

function normalizeCurrencyField(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw)
    return null

  return normalizedCurrencyMap[raw]
    ?? normalizedCurrencyMap[raw.toUpperCase()]
    ?? (isSupportedCurrency(raw) ? raw : null)
}

const ISO_CURRENCY_CODE_REGEX = /^[A-Z]{3}$/i

/** symbol → ISO code（排除 ISO 代码键，按长度降序匹配） */
const REVERSE_SYMBOL_MAP: Record<string, CurrencyCode> = Object.fromEntries(
  Object.entries(normalizedCurrencyMap)
    .filter(([k]) => !ISO_CURRENCY_CODE_REGEX.test(k))
    .map(([symbol, code]) => [symbol, code]),
)
const SORTED_SYMBOL_KEYS = Object.keys(REVERSE_SYMBOL_MAP).sort((a, b) => b.length - a.length)

function detectLegacyCurrency(value: unknown): string {
  const text = String(value ?? '')
  if (!text)
    return 'CNY'

  const upper = text.toUpperCase()

  // 按长度降序匹配符号，确保 "HK$" 优先于 "$"
  for (const symbol of SORTED_SYMBOL_KEYS) {
    if (text.includes(symbol) || (symbol.length > 1 && upper.includes(symbol.toUpperCase())))
      return REVERSE_SYMBOL_MAP[symbol]!
  }

  // 尝试 ISO 代码匹配
  for (const [key, code] of Object.entries(normalizedCurrencyMap)) {
    if (ISO_CURRENCY_CODE_REGEX.test(key) && upper.includes(key))
      return code
  }

  return 'CNY'
}

function parseLegacyBillingCycle(value: unknown): number | null {
  const text = String(value ?? '').trim()
  if (!text)
    return null

  // A current API amount such as "30.00" is not itself a billing cycle.
  if (NUMERIC_BILLING_REGEX.test(text))
    return null

  return parseBillingCycle(text)
}

/** Normalizes both current and legacy CF Server Monitor billing fields. */
export function adaptServerBilling(server: Pick<CfServer, 'price' | 'billing_cycle' | 'currency' | 'auto_renewal'>): AdaptedServerBilling {
  const parsedPrice = parsePriceAmount(server.price)
  const legacyBillingCycle = parseLegacyBillingCycle(server.price) ?? BILLING_CYCLE_DAYS.month
  const explicitBillingCycle = parseBillingCycle(server.billing_cycle)
  const explicitCurrency = normalizeCurrencyField(server.currency)

  return {
    price: parsedPrice.price,
    priceConfigured: parsedPrice.configured,
    billingCycle: explicitBillingCycle ?? legacyBillingCycle,
    currency: explicitCurrency ?? detectLegacyCurrency(server.price),
    autoRenewal: enabled(server.auto_renewal),
  }
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
  if (type === 'min' || type === 'max')
    return type
  return 'sum'
}

function pingEntry(name: string, latency: unknown, loss: unknown): NodeStatusPing {
  const latest = finiteNumber(latency)
  const lossValue = finiteNumber(loss)
  return { name, latest, avg: latest, tail: latest, loss: lossValue, min: latest, max: latest }
}

interface PingTaskDefinition {
  id: number
  key: PingTaskKey
  latencyField: keyof CfServer
  lossField: keyof CfServer
}

const PING_TASKS: PingTaskDefinition[] = [
  { id: 1, key: 'ct', latencyField: 'ping_ct', lossField: 'loss_ct' },
  { id: 2, key: 'cu', latencyField: 'ping_cu', lossField: 'loss_cu' },
  { id: 3, key: 'cm', latencyField: 'ping_cm', lossField: 'loss_cm' },
  { id: 4, key: 'bd', latencyField: 'ping_bd', lossField: 'loss_bd' },
  { id: 5, key: 'node_1', latencyField: 'ping_node_1', lossField: 'loss_node_1' },
  { id: 6, key: 'node_2', latencyField: 'ping_node_2', lossField: 'loss_node_2' },
  { id: 7, key: 'node_3', latencyField: 'ping_node_3', lossField: 'loss_node_3' },
  { id: 8, key: 'node_4', latencyField: 'ping_node_4', lossField: 'loss_node_4' },
]

/**
 * 探测字段是否“存在可用值”。兼容后端省略键、null、""、false、非数字占位；
 * 数值 0 视为存在（丢包 0% 合法）。两端 ping/loss 皆不存在时不展示对应任务。
 */
function isPingFieldPresent(value: unknown): boolean {
  if (value === undefined || value === null || value === '' || value === false)
    return false
  const number = Number.parseFloat(String(value))
  return Number.isFinite(number)
}

function pingFieldPresent(server: CfServer, field: keyof CfServer): boolean {
  return isPingFieldPresent(server[field])
}

const PING_WINDOW_PROVIDER_KEYS = ['ct', 'cu', 'cm', 'bd'] as const

function pingWindowNumber(value: unknown): number | null {
  if (value === false || value === null || value === undefined || value === '')
    return null
  const number = Number.parseFloat(String(value))
  return Number.isFinite(number) ? number : null
}

function buildPingWindowPoint(
  ts: number,
  pingPoint: LatencyWindowPoint | undefined,
  lossPoint: LatencyWindowPoint | undefined,
): PingWindowPoint | null {
  const latencyValues = PING_WINDOW_PROVIDER_KEYS
    .map(key => pingWindowNumber(pingPoint?.[key]))
    .filter((value): value is number => value !== null && value > 0)
  const lossValues = PING_WINDOW_PROVIDER_KEYS
    .map(key => pingWindowNumber(lossPoint?.[key]))
    .filter((value): value is number => value !== null && value >= 0)

  if (!latencyValues.length && !lossValues.length)
    return null

  return {
    time: new Date(ts).toISOString(),
    latency: latencyValues.length
      ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
      : null,
    loss: lossValues.length
      ? lossValues.reduce((sum, value) => sum + value, 0) / lossValues.length
      : null,
  }
}

/** 将 /api/servers 的 ping/loss 窗口（旧→新）按时间戳对齐聚合成延迟/丢包点 */
function buildPingWindow(server: CfServer): PingWindowPoint[] | undefined {
  const ping = Array.isArray(server.ping) ? server.ping : undefined
  const loss = Array.isArray(server.loss) ? server.loss : undefined
  if (!ping?.length && !loss?.length)
    return undefined

  const lossByTs = new Map<number, LatencyWindowPoint>()
  for (const point of loss ?? []) {
    const ts = timestamp(point.ts, 0)
    if (ts > 0)
      lossByTs.set(ts, point)
  }

  const points: PingWindowPoint[] = []
  for (const point of ping ?? []) {
    const ts = timestamp(point.ts, 0)
    if (ts <= 0)
      continue
    const point2 = buildPingWindowPoint(ts, point, lossByTs.get(ts))
    if (point2)
      points.push(point2)
  }

  // 延迟窗口为空但丢包有数据时，以丢包的 ts 生成点
  if (!points.length) {
    for (const point of loss ?? []) {
      const ts = timestamp(point.ts, 0)
      if (ts <= 0)
        continue
      const point2 = buildPingWindowPoint(ts, undefined, point)
      if (point2)
        points.push(point2)
    }
  }

  return points.length ? points : undefined
}

export function adaptServer(server: CfServer, apiIndex: number): AdaptedServer {
  const wire = server as unknown as Record<string, unknown>
  const uuid = getDisplayUuid(apiIndex, server.id)
  const baseUrl = getApiBases()[apiIndex] ?? ''
  sourceRegistry.set(uuid, { apiIndex, baseUrl, serverId: server.id })

  const billing = adaptServerBilling(server)
  const updatedAt = timestamp(wire.report_timestamp ?? server.last_updated ?? server.timestamp, 0)
  const load = String(server.load_avg ?? '').split(WHITESPACE_REGEX).map(finiteNumber)
  const now = Date.now()
  const bootTime = timestamp(server.boot_time, 0)
  const online = server.is_online ?? (updatedAt > 0 && now - updatedAt < ONLINE_THRESHOLD_MS)
  const ping: Record<string, NodeStatusPing> = {}
  for (const task of PING_TASKS) {
    if (pingFieldPresent(server, task.latencyField) || pingFieldPresent(server, task.lossField)) {
      ping[task.key] = pingEntry(
        pingTaskNames[task.key],
        server[task.latencyField],
        server[task.lossField],
      )
    }
  }

  const pingWindow = buildPingWindow(server)

  return {
    client: {
      uuid,
      source_id: server.id,
      source_index: apiIndex,
      name: server.name || server.id,
      cpu_name: server.cpu_info || '-',
      virtualization: '-',
      kernel_version: server.kernel_version || '-',
      arch: server.arch || '-',
      cpu_cores: finiteNumber(server.cpu_cores),
      os: server.os || '-',
      boot_time: bootTime ? new Date(bootTime).toISOString() : '',
      gpu_name: getGpuName(server.gpu_info),
      gpu_info: normalizeGpuInfo(server.gpu_info),
      ipv4: server.ip_v4,
      ipv6: server.ip_v6,
      region: String(server.region || '').toUpperCase(),
      public_remark: '',
      mem_total: finiteNumber(server.ram_total) * MB,
      swap_total: finiteNumber(server.swap_total) * MB,
      disk_total: finiteNumber(server.disk_total) * MB,
      version: server.agent_version,
      weight: finiteNumber(server.sort_order),
      price: billing.price,
      price_configured: billing.priceConfigured,
      billing_cycle: billing.billingCycle,
      auto_renewal: billing.autoRenewal,
      currency: billing.currency,
      expired_at: server.expire_date || server.expired_at || '9999-12-31',
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
      pingWindow,
    },
  }
}

export async function fetchAllServers(): Promise<{
  clients: Record<string, Client>
  statuses: Record<string, NodeStatus>
  latestReportUpdates: Array<{ apiIndex: number, updates: LatestReportUpdate[] }>
  /** 首个带 sysConfig 的响应（多后端取第一个），无则 undefined */
  sysConfig?: SysConfig
}> {
  sourceRegistry.clear()
  const responses = await Promise.all(getApiBases().map((_, index) => request<ServersResponse>('/api/servers', index)))
  const clients: Record<string, Client> = {}
  const statuses: Record<string, NodeStatus> = {}
  const latestReportUpdates: Array<{ apiIndex: number, updates: LatestReportUpdate[] }> = []
  responses.forEach((response, apiIndex) => {
    for (const server of response.servers ?? []) {
      const adapted = adaptServer(server, apiIndex)
      clients[adapted.client.uuid] = adapted.client
      statuses[adapted.client.uuid] = adapted.status
    }
    if (response.latestReportUpdates?.length) {
      latestReportUpdates.push({ apiIndex, updates: response.latestReportUpdates })
    }
  })
  return {
    clients,
    statuses,
    latestReportUpdates,
    sysConfig: responses.find(response => response.sysConfig)?.sysConfig,
  }
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

export async function fetchHistory(uuid: string, hours = 1): Promise<StatusRecord[]> {
  const source = getServerSource(uuid)
  const rows = await request<HistoryRow[]>(`/api/history/all?id=${encodeURIComponent(source.serverId)}&hours=${hours}`, source.apiIndex)
  return (rows ?? []).map(row => rowToStatusRecord(uuid, row))
}

export async function fetchPingHistory(uuid: string, hours = 1): Promise<{
  records: PingRecord[]
  tasks: Array<{ id: number, key: PingTaskKey, name: string, interval: number, loss: number }>
}> {
  const source = getServerSource(uuid)
  const rows = await request<HistoryRow[]>(`/api/history/all?id=${encodeURIComponent(source.serverId)}&hours=${hours}`, source.apiIndex)
  const records: PingRecord[] = []
  const losses = new Map<number, number[]>()
  const availableTasks = new Set<number>()

  for (const row of rows ?? []) {
    const time = new Date(timestamp(row.timestamp)).toISOString()
    for (const task of PING_TASKS) {
      const latencyValue = row[task.latencyField]
      const lossRaw = row[task.lossField]
      const hasLatency = isPingFieldPresent(latencyValue)
      const hasLoss = isPingFieldPresent(lossRaw)
      // 与 adaptServer 一致：ping_x / loss_x 皆不存在（含 null/""/false/非数字）则跳过
      if (!hasLatency && !hasLoss)
        continue

      availableTasks.add(task.id)
      const lossValue = hasLoss ? finiteNumber(lossRaw) : 0
      const latency = hasLatency ? finiteNumber(latencyValue) : 0
      records.push({
        client: uuid,
        task_id: task.id,
        time,
        value: lossValue >= 100 || latency <= 0 ? -1 : latency,
        loss: lossValue,
      })
      if (hasLoss) {
        const taskLosses = losses.get(task.id) ?? []
        taskLosses.push(lossValue)
        losses.set(task.id, taskLosses)
      }
    }
  }

  return {
    records,
    tasks: PING_TASKS.filter(task => availableTasks.has(task.id)).map(task => ({
      id: task.id,
      key: task.key,
      name: pingTaskNames[task.key],
      interval: 60,
      loss: (losses.get(task.id) ?? []).reduce((sum, value) => sum + value, 0) / Math.max(1, losses.get(task.id)?.length ?? 0),
    })),
  }
}

export async function fetchServer(uuid: string): Promise<CfServer> {
  const source = getServerSource(uuid)
  return request<CfServer>(`/api/server?id=${encodeURIComponent(source.serverId)}`, source.apiIndex)
}

export function buildAdminUrl(): string {
  return `${window.location.origin}/admin#/admin`
}

export class CfMonitorApi {
  async getPublicSettings(): Promise<PublicSettings> {
    const configs = cachedSiteConfigs.length ? cachedSiteConfigs : await fetchSiteConfigs()
    const first = configs[0]
    const loggedIn = configs.some(config => config.authorization)
    // 未登录访客最长可看 24h；已登录且开启 show_long_history 时最长可看近 7 天（168h），
    // 多后端聚合模式不支持长历史，回退到 24h
    const historyHours = loggedIn ? (first?.show_long_history && !hasMultipleApiBases() ? 168 : 24) : 24
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
