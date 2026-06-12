<script setup lang="ts">
import { ref } from 'vue'
import { llmConfig, translationSettings } from '~/logic/storage'

const showApiKey = ref(false)
const testStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const testMessage = ref('')

const targetLanguageOptions = [
  '简体中文',
  '繁體中文',
  'English',
  '日本語',
  '한국어',
  'Français',
  'Deutsch',
  'Español',
  'Português',
  'Русский',
  'العربية',
  'हिन्दी',
  'Italiano',
  'Nederlands',
  'Türkçe',
]

async function testConnection() {
  testStatus.value = 'testing'
  testMessage.value = ''

  try {
    const baseUrl = llmConfig.value.baseUrl.replace(/\/+$/, '')
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${llmConfig.value.apiKey}` },
    })

    if (res.ok) {
      testStatus.value = 'success'
      testMessage.value = '连接成功！'
    }
    else if (res.status === 401 || res.status === 403) {
      testStatus.value = 'error'
      testMessage.value = 'API Key 无效'
    }
    else {
      testStatus.value = 'error'
      testMessage.value = `请求失败 (${res.status})`
    }
  }
  catch (err: any) {
    testStatus.value = 'error'
    testMessage.value = err?.message || '无法连接到 API'
  }
}
</script>

<template>
  <main class="max-w-lg mx-auto px-6 py-8 text-gray-700 dark:text-gray-200">
    <h1 class="text-xl font-bold mb-6">
      Web AI Translator 设置
    </h1>

    <section class="mb-8">
      <h2 class="text-base font-semibold mb-4 pb-2 border-b border-gray-200">
        LLM API 配置
      </h2>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">API Base URL</label>
          <input
            v-model="llmConfig.baseUrl"
            type="text"
            placeholder="https://api.openai.com/v1"
            class="form-input"
          >
          <p class="text-xs text-gray-400 mt-1">
            支持 OpenAI 兼容接口（DeepSeek、通义千问、Moonshot 等）
          </p>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">API Key</label>
          <div class="relative">
            <input
              v-model="llmConfig.apiKey"
              :type="showApiKey ? 'text' : 'password'"
              placeholder="sk-..."
              class="form-input pr-16"
            >
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
              @click="showApiKey = !showApiKey"
            >
              {{ showApiKey ? '隐藏' : '显示' }}
            </button>
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">模型名称</label>
          <input
            v-model="llmConfig.model"
            type="text"
            placeholder="gpt-4o-mini"
            class="form-input"
          >
        </div>

        <div class="flex items-center gap-3">
          <button
            class="btn"
            :disabled="!llmConfig.apiKey || testStatus === 'testing'"
            @click="testConnection"
          >
            {{ testStatus === 'testing' ? '测试中...' : '测试连接' }}
          </button>
          <span
            v-if="testMessage"
            class="text-sm"
            :class="testStatus === 'success' ? 'text-green-600' : 'text-red-600'"
          >
            {{ testMessage }}
          </span>
        </div>
      </div>
    </section>

    <section>
      <h2 class="text-base font-semibold mb-4 pb-2 border-b border-gray-200">
        翻译偏好
      </h2>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">目标语言</label>
          <select v-model="translationSettings.targetLanguage" class="form-input">
            <option v-for="lang in targetLanguageOptions" :key="lang" :value="lang">
              {{ lang }}
            </option>
          </select>
        </div>
      </div>
    </section>

    <div class="mt-8 text-xs text-gray-400 text-center">
      快捷键 Alt+T 翻译当前页面
    </div>
  </main>
</template>

<style>
.form-input {
  @apply w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
    focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent
    dark:bg-gray-800 dark:border-gray-600;
}
</style>
