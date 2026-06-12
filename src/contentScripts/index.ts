import { onMessage, sendMessage } from 'webext-bridge/content-script'
import { createApp, ref } from 'vue'
import ProgressFloat from './views/ProgressFloat.vue'
import { setupApp } from '~/logic/common-setup'
import { extractCleanHtml, markNewVisibleElements, markTranslatableElements, resetTranslationState, splitIntoChunks } from '~/logic/html-extractor'
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
  /** Number of elements currently being translated by the background (has been sent, not yet replaced in DOM). */
  let inFlightElementCount = 0
  let pendingScroll = false

  function sendCurrentBatch() {
    if (inFlightElementCount > 0) {
      // A batch is still in flight — defer until it finishes.
      pendingScroll = true
      return
    }
    pendingScroll = false

    const count = markNewVisibleElements()
    if (count === 0)
      return

    const cleanHtml = extractCleanHtml()
    if (!cleanHtml)
      return

    const chunks = splitIntoChunks(cleanHtml)
    inFlightElementCount = count
    progressTotal.value += count
    if (progressStatus.value === 'done' || progressStatus.value === 'idle')
      progressStatus.value = 'translating'

    sendMessage('translate-page', { chunks }, 'background').then((result) => {
      if (!result.success) {
        progressError.value = result.error || 'Translation failed'
        progressStatus.value = 'error'
        inFlightElementCount = 0
      }
      // inFlightElementCount is decremented per-element in translation-chunk-result;
      // when it hits 0 we process the deferred scroll batch below.
    })
  }

  function onScroll() {
    if (progressStatus.value === 'error')
      return
    if (scrollDebounceTimer)
      clearTimeout(scrollDebounceTimer)
    scrollDebounceTimer = setTimeout(sendCurrentBatch, 600)
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
      inFlightElementCount = 0
      pendingScroll = false
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
    inFlightElementCount = 0
    pendingScroll = false

    const count = markTranslatableElements()
    if (count === 0) {
      progressStatus.value = 'idle'
      return
    }

    const cleanHtml = extractCleanHtml()
    const chunks = splitIntoChunks(cleanHtml)

    inFlightElementCount = count
    progressTotal.value = count
    progressCompleted.value = 0
    progressStatus.value = 'translating'

    sendMessage('translate-page', { chunks }, 'background').then((result) => {
      if (!result.success) {
        progressStatus.value = 'error'
        progressError.value = result.error || 'Translation failed'
        inFlightElementCount = 0
      }
    })

    // Watch for newly scrolled-into-view elements
    window.addEventListener('scroll', onScroll, { passive: true } as any)
  })

  onMessage('translation-chunk-result', ({ data }) => {
    replaceFromTranslatedHtml(data.html)
    progressCompleted.value++
    inFlightElementCount--

    // Last element of this batch arrived — process deferred scroll batch if any.
    if (inFlightElementCount === 0 && pendingScroll)
      sendCurrentBatch()
  })

  onMessage('translation-progress', ({ data }) => {
    progressStatus.value = data.status
    if (data.error)
      progressError.value = data.error
  })
})())
