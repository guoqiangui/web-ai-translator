import { onMessage, sendMessage } from 'webext-bridge/content-script'
import { createApp, ref } from 'vue'
import ProgressFloat from './views/ProgressFloat.vue'
import { setupApp } from '~/logic/common-setup'
import { extractCleanHtml, markIdsCompleted, markNewVisibleElements, markTranslatableElements, resetTranslationState, splitIntoChunks } from '~/logic/html-extractor'
import { injectStyles, replaceFromTranslatedHtml, restoreAllOriginals } from '~/logic/dom-replacer'
import type { TranslationStatus } from '~/logic/types'

void ((() => {
  injectStyles()

  const container = document.createElement('div')
  container.id = `${__NAME__}-progress`
  const root = document.createElement('div')
  const styleEl = document.createElement('link')
  const shadowDOM = container.attachShadow?.({ mode: __DEV__ ? 'open' : 'closed' }) || container
  styleEl.setAttribute('rel', 'stylesheet')
  styleEl.setAttribute('href', browser.runtime.getURL('dist/contentScripts/style.css'))
  shadowDOM.appendChild(styleEl)
  shadowDOM.appendChild(root)
  document.body.appendChild(container)

  const progressStatus = ref<TranslationStatus>('idle')
  const progressTotal = ref(0)
  const progressCompleted = ref(0)
  const progressError = ref('')

  const app = createApp(ProgressFloat, {
    status: progressStatus,
    total: progressTotal,
    completed: progressCompleted,
    error: progressError,
  })
  setupApp(app)
  app.mount(root)

  // ── scroll-driven incremental translation ──

  let scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Dispatch a set of freshly-marked element ids to the background. Batches run
   * concurrently — `walkAndMark` never re-marks an element that already has a
   * `data-wt-id`, so overlapping batches can't double-send.
   */
  function dispatchBatch(ids: string[]) {
    if (ids.length === 0)
      return

    const cleanHtml = extractCleanHtml(ids)
    if (!cleanHtml)
      return

    const chunks = splitIntoChunks(cleanHtml)
    progressTotal.value += ids.length
    if (progressStatus.value !== 'translating')
      progressStatus.value = 'translating'

    sendMessage('translate-page', { chunks }, 'background').then((result) => {
      if (!result.success) {
        progressError.value = result.error || 'Translation failed'
        progressStatus.value = 'error'
      }
    })
  }

  function sendCurrentBatch() {
    dispatchBatch(markNewVisibleElements())
  }

  function onScroll() {
    if (progressStatus.value === 'error')
      return
    if (scrollDebounceTimer)
      clearTimeout(scrollDebounceTimer)
    scrollDebounceTimer = setTimeout(sendCurrentBatch, 600)
  }

  /**
   * Completion is owned by the content script via counts, not by the
   * background's per-call `done` — with concurrent batches an early small batch
   * would otherwise flip the whole page to "done" prematurely.
   */
  function maybeMarkDone() {
    if (progressStatus.value === 'translating' && progressCompleted.value >= progressTotal.value)
      progressStatus.value = 'done'
  }

  // ── message handlers ──

  onMessage('get-translation-status', () => {
    return {
      status: progressStatus.value,
      totalChunks: progressTotal.value,
      completedChunks: progressCompleted.value,
      error: progressError.value || undefined,
    }
  })

  onMessage('trigger-translation', async ({ data }) => {
    if (data.action === 'restore') {
      sendMessage('cancel-translation', {}, 'background').catch(() => {})
      restoreAllOriginals()
      resetTranslationState()
      progressStatus.value = 'idle'
      progressTotal.value = 0
      progressCompleted.value = 0
      progressError.value = ''
      window.removeEventListener('scroll', onScroll, { passive: true } as any)
      return
    }

    // Fresh start
    restoreAllOriginals()
    resetTranslationState()
    progressStatus.value = 'extracting'
    progressError.value = ''
    progressTotal.value = 0
    progressCompleted.value = 0

    const ids = markTranslatableElements()
    if (ids.length === 0) {
      progressStatus.value = 'idle'
      return
    }

    progressStatus.value = 'translating'
    dispatchBatch(ids)

    // Watch for newly scrolled-into-view elements
    window.addEventListener('scroll', onScroll, { passive: true } as any)
  })

  onMessage('translation-chunk-result', ({ data }) => {
    replaceFromTranslatedHtml(data.html)
    progressCompleted.value++
    maybeMarkDone()
  })

  // Elements the background couldn't translate (chunk failed / LLM dropped them).
  // Count them as settled so the page can still reach "done" — otherwise the
  // progress bar hangs below 100% forever.
  onMessage('translation-elements-failed', ({ data }) => {
    markIdsCompleted(data.ids)
    progressCompleted.value += data.ids.length
    maybeMarkDone()
  })

  // Background sends coarse status; trust it only for `error`. Completion is
  // computed locally from counts (see maybeMarkDone) since concurrent batches
  // each emit their own `done`.
  onMessage('translation-progress', ({ data }) => {
    if (data.status === 'error') {
      progressStatus.value = 'error'
      if (data.error)
        progressError.value = data.error
    }
  })
})())
