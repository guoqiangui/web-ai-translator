import type { ProtocolWithReturn } from 'webext-bridge'
import type { HtmlChunk, TranslationState, TranslationStatus } from './src/logic/types'

declare module 'webext-bridge' {
  export interface ProtocolMap {
    'translate-page': ProtocolWithReturn<
      { chunks: HtmlChunk[] },
      { success: boolean, error?: string }
    >
    'translation-chunk-result': { chunkId: number, html: string }
    'translation-elements-failed': { ids: string[] }
    'translation-progress': {
      status: TranslationStatus
      error?: string
    }
    'trigger-translation': { action: 'start' | 'restore' }
    'cancel-translation': Record<string, never>
    'get-translation-status': ProtocolWithReturn<Record<string, never>, TranslationState>
  }
}
