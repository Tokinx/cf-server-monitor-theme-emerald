<script setup lang="ts">
import type { NodeStatusPing } from '@/utils/rpc'
import { getPingToneClass, PING_PROVIDERS } from '@/utils/nodeHelper'

const props = defineProps<{
  ping?: Record<string, NodeStatusPing>
}>()

function getProviderState(key: string, label: string) {
  const ping = props.ping?.[key]
  const latency = ping?.latest ?? 0
  const loss = ping?.loss ?? 100
  const available = latency > 0 && loss < 100

  return {
    label,
    display: available ? `${Math.round(latency)}ms` : '--',
    toneClass: getPingToneClass(latency, available),
    tooltip: available
      ? `${ping?.name ?? label}: ${Math.round(latency)}ms\n丢包 ${loss.toFixed(1)}%`
      : `${ping?.name ?? label}: 暂无响应`,
  }
}
</script>

<template>
  <div class="grid min-w-0 w-full grid-cols-4 gap-x-1 text-center">
    <span v-for="provider in PING_PROVIDERS" :key="provider.key" class="flex min-w-0 flex-col">
      <span class="text-[10px] font-medium text-muted-foreground">{{ provider.label }}</span>
      <span
        class="truncate text-[11px] tabular-nums"
        :class="getProviderState(provider.key, provider.label).toneClass"
      >
        {{ getProviderState(provider.key, provider.label).display }}
      </span>
    </span>
  </div>
</template>
