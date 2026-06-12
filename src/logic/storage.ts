import type { LLMConfig, TranslationSettings } from './types'
import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

export const { data: llmConfig, dataReady: llmConfigReady } = useWebExtensionStorage<LLMConfig>(
  'llm-config',
  { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
)

export const { data: translationSettings, dataReady: translationSettingsReady } = useWebExtensionStorage<TranslationSettings>(
  'translation-settings',
  { targetLanguage: '简体中文' },
)
