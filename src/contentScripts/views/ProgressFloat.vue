<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { TranslationStatus } from '~/logic/types'

const props = defineProps<{
  status: Ref<TranslationStatus>
  total: Ref<number>
  completed: Ref<number>
  error: Ref<string>
}>()

const visible = ref(false)
let hideTimer: ReturnType<typeof setTimeout> | null = null

const progress = computed(() => {
  if (props.total.value === 0)
    return 0
  return Math.round((props.completed.value / props.total.value) * 100)
})

const statusText = computed(() => {
  switch (props.status.value) {
    case 'extracting': return '正在提取页面文本...'
    case 'translating': return `翻译中 ${progress.value}%`
    case 'done': return '翻译完成！点击段落可查看原文'
    case 'error': return `翻译出错: ${props.error.value}`
    default: return ''
  }
})

watch(() => props.status.value, (status) => {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }

  if (status === 'idle') {
    visible.value = false
    return
  }

  visible.value = true

  if (status === 'done') {
    hideTimer = setTimeout(() => {
      visible.value = false
    }, 4000)
  }
})
</script>

<template>
  <div v-if="visible" class="progress-float">
    <div class="progress-content">
      <div class="status-text">
        {{ statusText }}
      </div>
      <div v-if="status.value === 'translating'" class="progress-bar-wrapper">
        <div class="progress-bar" :style="{ width: `${progress}%` }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.progress-float {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 2147483647;
  min-width: 240px;
  max-width: 360px;
  background: #1e293b;
  color: #f1f5f9;
  border-radius: 10px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
  padding: 12px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  animation: wt-slide-in 0.3s ease;
}

@keyframes wt-slide-in {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.status-text {
  margin-bottom: 6px;
  line-height: 1.4;
}

.progress-bar-wrapper {
  height: 4px;
  background: #334155;
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: #0ea5e9;
  border-radius: 2px;
  transition: width 0.3s ease;
}
</style>
