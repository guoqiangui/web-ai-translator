export interface HtmlChunk {
  id: number
  html: string
}

export interface LLMConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface TranslationSettings {
  targetLanguage: string
}

export type TranslationStatus = 'idle' | 'extracting' | 'translating' | 'done' | 'error'

export interface TranslationState {
  status: TranslationStatus
  totalChunks: number
  completedChunks: number
  error?: string
}
