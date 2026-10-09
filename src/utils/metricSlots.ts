/**
 * 首页汇总卡片的栅格位置。
 *
 * 卡片位置此前写死在模板里（`col-start-N`），一旦某张卡片被隐藏就会出现空洞，
 * 因此改为按「可见卡片顺序」查表：隐藏任意卡片后，后续卡片自动前移。
 */

/** 地球/地图面板可见时的位置（两行三列） */
const VISUAL_METRIC_SLOTS = [
  'col-span-4 row-span-1 col-start-1 row-start-1',
  'col-span-4 row-span-1 col-start-1 row-start-2',
  'col-span-4 row-span-1 col-start-5 row-start-1',
  'col-span-4 row-span-1 col-start-5 row-start-2',
  'col-span-4 row-span-1 col-start-9 row-start-1',
  'col-span-4 row-span-1 col-start-9 row-start-2',
] as const

/** 无地球/地图面板时的位置（单行多列） */
const FLAT_METRIC_SLOTS = [
  'col-span-1 row-start-1 col-start-1 min-h-18 md:min-h-24 md:row-start-1 md:col-start-1',
  'col-span-1 row-start-2 col-start-1 min-h-18 md:min-h-24 md:row-start-1 md:col-start-2',
  'col-span-1 row-start-1 col-start-2 min-h-18 md:min-h-24 md:row-start-1 md:col-start-3',
  'col-span-1 row-start-2 col-start-2 min-h-18 md:min-h-24 md:row-start-1 md:col-start-4',
  'col-span-1 row-start-1 col-start-3 min-h-18 md:min-h-24 md:row-start-1 md:col-start-5',
  'col-span-1 row-start-2 col-start-3 min-h-18 md:min-h-24 md:row-start-1 md:col-start-6',
] as const

/** 汇总卡片 key，顺序即渲染顺序 */
export type MetricSlotKey = 'memory' | 'disk' | 'finance' | 'traffic' | 'speedUp' | 'speedDown'

/**
 * 解析各汇总卡片的栅格类名。
 * @param canViewPrice 是否可见价格/价值信息（show_price 关闭且非管理员时为 false）
 * @param showVisualPanel 是否渲染地球/地图面板
 */
export function resolveMetricSlots(
  canViewPrice: boolean,
  showVisualPanel: boolean,
): Record<MetricSlotKey, string> {
  const keys: MetricSlotKey[] = canViewPrice
    ? ['memory', 'disk', 'finance', 'traffic', 'speedUp', 'speedDown']
    : ['memory', 'disk', 'traffic', 'speedUp', 'speedDown']

  const positions = showVisualPanel ? VISUAL_METRIC_SLOTS : FLAT_METRIC_SLOTS
  return Object.fromEntries(keys.map((key, index) => [key, positions[index] ?? ''])) as Record<MetricSlotKey, string>
}
