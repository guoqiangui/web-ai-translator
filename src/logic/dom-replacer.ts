import { getElementMap, markIdsCompleted } from './html-extractor'

const originalHtmlMap = new Map<string, string>()
let stylesInjected = false

export function injectStyles(): void {
  if (stylesInjected)
    return
  const style = document.createElement('style')
  style.textContent = `
    .wt-translated-block {
      cursor: pointer;
      border-left: 3px solid transparent;
      transition: border-color 0.2s ease;
    }
    .wt-translated-block:hover {
      border-left-color: #0ea5e9;
    }
    .wt-showing-original {
      border-left-color: #0ea5e9;
    }
    .wt-original-block {
      color: #6b7280;
      font-size: 0.9em;
      padding: 8px 0 8px 12px;
      margin: 4px 0;
      border-left: 3px solid #d1d5db;
      background: rgba(249, 250, 251, 0.95);
      opacity: 0.85;
      cursor: pointer;
    }
    .wt-original-block:hover {
      opacity: 1;
    }
  `
  document.head.appendChild(style)
  stylesInjected = true
}

export function replaceFromTranslatedHtml(translatedHtml: string): void {
  const elementMap = getElementMap()
  const parser = new DOMParser()
  const doc = parser.parseFromString(`<body>${translatedHtml}</body>`, 'text/html')
  const replacedIds: string[] = []

  for (const translatedEl of Array.from(doc.querySelectorAll('[data-wt-id]'))) {
    const id = translatedEl.getAttribute('data-wt-id')!
    const realEl = elementMap.get(id)
    if (!realEl)
      continue

    if (translatedEl.innerHTML === realEl.innerHTML) {
      replacedIds.push(id)
      continue
    }

    if (!originalHtmlMap.has(id))
      originalHtmlMap.set(id, realEl.innerHTML)

    realEl.innerHTML = translatedEl.innerHTML
    realEl.setAttribute('data-wt-translated', 'true')
    realEl.classList.add('wt-translated-block')

    realEl.removeEventListener('click', handleToggleClick)
    realEl.addEventListener('click', handleToggleClick)
    replacedIds.push(id)
  }

  // Clear from in-flight set so scrolling won't resend these to the LLM
  if (replacedIds.length > 0)
    markIdsCompleted(replacedIds)
}

function handleToggleClick(event: Event): void {
  event.stopPropagation()
  const el = event.currentTarget as Element
  const id = el.getAttribute('data-wt-id')
  if (!id)
    return

  const existing = el.nextElementSibling
  if (existing?.classList.contains('wt-original-block')) {
    existing.remove()
    el.classList.remove('wt-showing-original')
    return
  }

  const originalHtml = originalHtmlMap.get(id)
  if (!originalHtml)
    return

  const originalBlock = document.createElement('div')
  originalBlock.className = 'wt-original-block'
  originalBlock.innerHTML = originalHtml
  originalBlock.addEventListener('click', (e) => {
    e.stopPropagation()
    originalBlock.remove()
    el.classList.remove('wt-showing-original')
  })

  el.after(originalBlock)
  el.classList.add('wt-showing-original')
}

export function restoreAllOriginals(): void {
  const elementMap = getElementMap()

  for (const [id, el] of elementMap) {
    const originalHtml = originalHtmlMap.get(id)
    if (originalHtml !== undefined) {
      el.innerHTML = originalHtml
      el.removeAttribute('data-wt-translated')
      el.classList.remove('wt-translated-block', 'wt-showing-original')
      el.removeEventListener('click', handleToggleClick)
    }

    const next = el.nextElementSibling
    if (next?.classList.contains('wt-original-block'))
      next.remove()
  }

  originalHtmlMap.clear()
}
