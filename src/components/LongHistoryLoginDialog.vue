<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { confirmLongHistoryLoginRedirect, dismissLongHistoryLoginPrompt, longHistoryLoginPromptOpen } from '@/composables/useLongHistoryAuth'
</script>

<template>
  <Dialog v-model:open="longHistoryLoginPromptOpen">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>需要登录</DialogTitle>
        <DialogDescription class="leading-6">
          查看超过 24 小时的历史数据需要管理员登录。请前往后台登录后再选择 2 天、4 天或 7 天范围。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="gap-2 sm:gap-0">
        <Button type="button" variant="outline" @click="dismissLongHistoryLoginPrompt">
          取消
        </Button>
        <Button type="button" @click="confirmLongHistoryLoginRedirect">
          前往登录
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
