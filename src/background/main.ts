import { onMessage, sendMessage } from 'webext-bridge/background'
import type OpenAI from 'openai'
import { createTranslationClient, translateHtmlStreamingWithCallback } from '~/logic/translator'
import { extractTranslatedHtml } from '~/logic/prompt-builder'
import { maskUrls, unmaskUrls } from '~/logic/url-mask'
import { ElementExtractor } from '~/logic/element-extractor'
import type { CompletedElement } from '~/logic/element-extractor'
import type { LLMConfig, TranslationSettings } from '~/logic/types'

if (import.meta.hot) {
  // @ts-expect-error for background HMR
  import('/@vite/client')
  import('./contentScriptHMR')
}

browser.runtime.onInstalled.addListener((): void => {
  // eslint-disable-next-line no-console
  console.log('Web AI Translator installed')
})

/** Per-tab AbortController — for full cancellation when user hits restore */
const cancelControllers = new Map<number, AbortController>()

/** Cancel in-flight translation when the tab navigates or refreshes */
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    const ctrl = cancelControllers.get(tabId)
    if (ctrl) {
      ctrl.abort()
      cancelControllers.delete(tabId)
    }
  }
})

/** Clean up when tab is closed */
browser.tabs.onRemoved.addListener((tabId) => {
  const ctrl = cancelControllers.get(tabId)
  if (ctrl) {
    ctrl.abort()
    cancelControllers.delete(tabId)
  }
})
async function getStorageValue<T>(key: string, fallback: T): Promise<T> {
  const result = await browser.storage.local.get(key)
  const raw = result[key]
  if (raw == null)
    return fallback
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T
    }
    catch {
      return raw as T
    }
  }
  return raw as T
}

function safeSendMessage(msg: string, data: any, options: any) {
  try {
    sendMessage(msg as any, data, options)
  }
  catch {
    // content script may have been unloaded (page refresh/navigation)
  }
}

/** Minimal concurrency limiter (zero dependencies) */
function pLimit(concurrency: number) {
  const queue: Array<() => void> = []
  let active = 0

  function next() {
    if (active < concurrency && queue.length > 0) {
      active++
      const run = queue.shift()!
      run()
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--
          next()
        })
      })
      next()
    })
  }
}

function extractWtIds(html: string): string[] {
  return Array.from(html.matchAll(/data-wt-id="(wt-\d+)"/g), m => m[1])
}

onMessage('translate-page', async ({ data, sender }) => {
  const tabId = sender.tabId
  if (!tabId)
    return { success: false, error: 'No tab ID' }

  const config = await getStorageValue<LLMConfig>('llm-config', {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  })

  if (!config.apiKey) {
    return { success: false, error: 'API key not configured. Please go to Settings.' }
  }

  const settings = await getStorageValue<TranslationSettings>('translation-settings', {
    targetLanguage: '简体中文',
  })

  const { chunks } = data
  if (chunks.length === 0)
    return { success: false, error: 'No translatable content found' }

  // Get or create a cancellation controller for this tab
  let cancelCtrl = cancelControllers.get(tabId)
  if (!cancelCtrl) {
    cancelCtrl = new AbortController()
    cancelControllers.set(tabId, cancelCtrl)
  }
  const signal = cancelCtrl.signal

  try {
    // Reuse one client instance for all chunks in this batch
    const client = createTranslationClient(config)
    const limit = pLimit(6)

    let shouldStop = false

    safeSendMessage('translation-progress', {
      status: 'translating',
    }, { context: 'content-script', tabId })

    const tasks = chunks.map(chunk =>
      limit(async () => {
        if (signal.aborted || shouldStop)
          return

        // The extractor lives outside the retry loop (inside translateWithRetryElementwise)
        // so retries never resend elements that already reached the page.
        const extractor = new ElementExtractor()

        // Mask URLs so the LLM doesn't waste output tokens re-emitting them.
        const { masked, restore } = maskUrls(chunk.html)

        try {
          await translateWithRetryElementwise(
            client,
            config.model,
            masked,
            settings.targetLanguage,
            signal,
            extractor,
            (element: CompletedElement) => {
              safeSendMessage('translation-chunk-result', {
                chunkId: chunk.id,
                html: unmaskUrls(element.html, restore),
              }, { context: 'content-script', tabId })
            },
          )
        }
        catch (err: any) {
          if (err.name === 'AbortError') {
            shouldStop = true
            return
          }
          console.warn(`[wt] chunk ${chunk.id} failed:`, err.message)
        }

        // Elements that never arrived (chunk failed, or the LLM dropped/renamed
        // them) must still be reported, or the content script's in-flight
        // tracking deadlocks and scroll-translation stops forever.
        const failedIds = extractWtIds(chunk.html).filter(id => !extractor.hasExtracted(id))
        if (failedIds.length > 0) {
          safeSendMessage('translation-elements-failed', {
            ids: failedIds,
          }, { context: 'content-script', tabId })
        }
      }),
    )

    await Promise.allSettled(tasks)

    if (!signal.aborted && !shouldStop) {
      safeSendMessage('translation-progress', {
        status: 'done',
      }, { context: 'content-script', tabId })
    }

    return { success: true }
  }
  catch (err: any) {
    if (err.name === 'AbortError')
      return { success: false, error: 'Translation cancelled' }

    const errorMsg = err?.message || 'Translation failed'
    safeSendMessage('translation-progress', {
      status: 'error',
      error: errorMsg,
    }, { context: 'content-script', tabId })

    return { success: false, error: errorMsg }
  }
})

onMessage('cancel-translation', async ({ sender }) => {
  const tabId = sender.tabId
  if (tabId) {
    const ctrl = cancelControllers.get(tabId)
    if (ctrl) {
      ctrl.abort()
      cancelControllers.delete(tabId)
    }
  }
})

async function translateWithRetryElementwise(
  client: OpenAI,
  model: string,
  html: string,
  targetLanguage: string,
  signal: AbortSignal,
  extractor: ElementExtractor,
  onElement: (element: CompletedElement) => void,
  retries = 2,
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const accumulated = await translateHtmlStreamingWithCallback(
        client,
        model,
        html,
        targetLanguage,
        (text) => {
          const completed = extractor.extractCompleteElements(text)
          for (const el of completed)
            onElement(el)
        },
        signal,
      )
      // Flush remaining elements from fully-complete text
      const cleaned = extractTranslatedHtml(accumulated)
      const remaining = extractor.extractAllRemaining(cleaned)
      for (const el of remaining)
        onElement(el)
      return
    }
    catch (err: any) {
      if (err.name === 'AbortError')
        throw err
      if (err?.status === 401 || err?.status === 403)
        throw new Error('Invalid API key or access denied')
      if (err?.status === 429 && attempt < retries) {
        const retryAfter = Number.parseInt(err?.headers?.['retry-after'] || '10', 10)
        await new Promise(r => setTimeout(r, retryAfter * 1000))
        continue
      }
      if (attempt === retries)
        throw err
    }
  }
}

browser.commands.onCommand.addListener(async (command) => {
  if (command !== 'translate-page')
    return

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id)
    return

  safeSendMessage('trigger-translation', { action: 'start' }, { context: 'content-script', tabId: tab.id })
})
