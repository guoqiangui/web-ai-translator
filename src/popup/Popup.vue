<script setup lang="ts">
import { sendMessage } from 'webext-bridge/popup'
import { computed, onMounted, reactive, ref } from 'vue'
import { llmConfig } from '~/logic/storage'
import type { TranslationState } from '~/logic/types'

const isConfigured = computed(() => !!llmConfig.value.apiKey)

const state = reactive<TranslationState>({
  status: 'idle',
  totalChunks: 0,
  completedChunks: 0,
})

const isTranslating = computed(() => state.status === 'translating' || state.status === 'extracting')
const isDone = computed(() => state.status === 'done')
const hasError = computed(() => state.status === 'error')

const progress = computed(() => {
  if (state.totalChunks === 0)
    return 0
  return Math.round((state.completedChunks / state.totalChunks) * 100)
})

const statusMessage = ref('')
let pollTimer: ReturnType<typeof setInterval> | null = null

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab?.id ?? null
}

async function pollStatus(tabId: number) {
  try {
    const result = await sendMessage('get-translation-status', {}, { context: 'content-script', tabId })
    state.status = result.status
    state.totalChunks = result.totalChunks
    state.completedChunks = result.completedChunks
    state.error = result.error

    if (result.status === 'done' || result.status === 'error' || result.status === 'idle') {
      stopPolling()
    }
  }
  catch {
    stopPolling()
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(async () => {
  const tabId = await getActiveTabId()
  if (!tabId)
    return

  // Reset to idle before polling — prevents stale status after page refresh.
  // Retry up to 3 times in case the content script hasn't initialized yet.
  state.status = 'idle'
  state.totalChunks = 0
  state.completedChunks = 0
  state.error = undefined

  for (let i = 0; i < 3; i++) {
    try {
      await pollStatus(tabId)
      break
    }
    catch {
      if (i < 2)
        await new Promise(r => setTimeout(r, 300))
    }
  }

  // If translation is still in progress, keep polling.
  if (state.status === 'extracting' || state.status === 'translating') {
    pollTimer = setInterval(() => pollStatus(tabId), 500)
  }
})

async function translatePage() {
  const tabId = await getActiveTabId()
  if (!tabId)
    return

  statusMessage.value = ''
  state.status = 'extracting'
  state.totalChunks = 0
  state.completedChunks = 0
  state.error = undefined

  try {
    // Fire-and-forget — don't await the full translation.
    // Polling keeps the UI updated; NOT awaiting lets the popup close freely on blur.
    stopPolling()
    pollTimer = setInterval(() => pollStatus(tabId), 500)
    sendMessage('trigger-translation', { action: 'start' }, { context: 'content-script', tabId })
      .catch((err: any) => {
        statusMessage.value = err?.message || 'Failed to communicate with page'
        state.status = 'error'
        state.error = statusMessage.value
      })
  }
  catch (err: any) {
    statusMessage.value = err?.message || 'Failed to communicate with page'
    state.status = 'error'
    state.error = statusMessage.value
  }
}

async function restoreOriginals() {
  const tabId = await getActiveTabId()
  if (!tabId)
    return

  stopPolling()
  try {
    await sendMessage('trigger-translation', { action: 'restore' }, { context: 'content-script', tabId })
    state.status = 'idle'
    state.totalChunks = 0
    state.completedChunks = 0
    state.error = undefined
    statusMessage.value = ''
  }
  catch (err: any) {
    statusMessage.value = err?.message || 'Failed to communicate with page'
  }
}

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
</script>

<template>
  <main class="w-[320px] px-4 py-4 text-gray-700">
    <div class="text-base font-bold mb-3">
      Web AI Translator
    </div>

    <div v-if="!isConfigured" class="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-sm text-amber-800">
      请先配置 API Key
      <button class="text-blue-600 underline ml-1" @click="openOptionsPage">
        前往设置
      </button>
    </div>

    <div class="space-y-2">
      <button
        class="btn w-full"
        :disabled="!isConfigured || isTranslating"
        @click="translatePage"
      >
        {{ isTranslating ? '翻译中...' : '翻译此页' }}
      </button>

      <div v-if="isTranslating" class="mt-2">
        <div class="flex justify-between text-xs text-gray-500 mb-1">
          <span>{{ progress }}%</span>
        </div>
        <div class="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div class="h-full bg-teal-500 rounded-full transition-all duration-300" :style="{ width: `${progress}%` }" />
        </div>
      </div>

      <div v-if="isDone" class="text-sm text-green-600 mt-2">
        翻译完成！点击页面中的段落可查看原文。
      </div>

      <button
        v-if="isDone"
        class="btn w-full bg-gray-500 hover:bg-gray-600"
        @click="restoreOriginals"
      >
        恢复原文
      </button>

      <div v-if="hasError" class="text-sm text-red-600 mt-2">
        {{ state.error || statusMessage || '翻译出错' }}
      </div>

      <button
        v-if="hasError"
        class="btn w-full"
        @click="translatePage"
      >
        重试
      </button>
    </div>

    <div class="mt-3 pt-3 border-t border-gray-200 text-center">
      <button class="text-xs text-gray-400 hover:text-gray-600" @click="openOptionsPage">
        设置
      </button>
    </div>
  </main>
</template>
