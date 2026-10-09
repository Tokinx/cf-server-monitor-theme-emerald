import { ref } from 'vue'
import { buildAdminUrl } from '@/utils/api'
import { CHART_TIME_RANGES } from '@/utils/chartTimeRange'

/** CF Server Monitor：`hours > 24` 的历史查询要求管理员登录 */
export const LONG_HISTORY_LOGIN_THRESHOLD_HOURS = 24

export const longHistoryLoginPromptOpen = ref(false)

export function requiresLongHistoryLogin(hours: number): boolean {
  return hours > LONG_HISTORY_LOGIN_THRESHOLD_HOURS
}

/** 未登录时可安全选中的最长预设标签（用于回退 Tab） */
export function getGuestMaxChartTimeRangeLabel(): string {
  const guestRanges = CHART_TIME_RANGES.filter(range => range.hours <= LONG_HISTORY_LOGIN_THRESHOLD_HOURS)
  return guestRanges.at(-1)?.label ?? '24H'
}

export function showLongHistoryLoginPrompt(): void {
  longHistoryLoginPromptOpen.value = true
}

export function dismissLongHistoryLoginPrompt(): void {
  longHistoryLoginPromptOpen.value = false
}

export function confirmLongHistoryLoginRedirect(): void {
  longHistoryLoginPromptOpen.value = false
  location.href = buildAdminUrl()
}
