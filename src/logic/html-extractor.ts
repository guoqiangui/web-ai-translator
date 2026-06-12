import type { HtmlChunk } from './types'

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'MATH',
  'IFRAME',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'TEMPLATE',
  'PRE',
  'CODE',
  'KBD',
  'SAMP',
  'VAR',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'BUTTON',
])

const TRANSLATABLE_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LI',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'FIGCAPTION',
  'DD',
  'DT',
  'SUMMARY',
  'CAPTION',
  'LABEL',
  'A',
  'SPAN',
  'EM',
  'STRONG',
  'B',
  'I',
])

const KEEP_ATTRIBUTES = new Set([
  'data-wt-id',
  'href',
  'src',
  'alt',
  'title',
])

const MAX_CHARS_PER_CHUNK = 80000

let idCounter = 0
const elementMap = new Map<string, Element>()
/** IDs currently being translated (sent to background, not yet replaced) */
const inFlightIds = new Set<string>()

export function getElementMap(): Map<string, Element> {
  return elementMap
}

function isInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  const viewH = window.innerHeight
  const viewW = window.innerWidth
  // Use a generous margin (one viewport height ahead) so elements about to
  // scroll into view are pre-translated, avoiding visible gaps.
  const margin = viewH
  return (
    rect.bottom > -margin
    && rect.top < viewH + margin
    && rect.right > 0
    && rect.left < viewW
  )
}

export function resetTranslationState(): void {
  elementMap.clear()
  inFlightIds.clear()
  idCounter = 0
}

function walkAndMark(respectExisting: boolean): string[] {
  const ids: string[] = []

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as Element
        if (SKIP_TAGS.has(el.tagName))
          return NodeFilter.FILTER_REJECT
        if (el.closest('[contenteditable="true"]'))
          return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      },
    },
  )

  let node = walker.nextNode()
  while (node) {
    const el = node as Element

    // If respectExisting and element already has a data-wt-id, skip
    if (respectExisting && el.hasAttribute('data-wt-id')) {
      node = walker.nextNode()
      continue
    }

    if (!isInViewport(el)) {
      node = walker.nextNode()
      continue
    }

    if (TRANSLATABLE_TAGS.has(el.tagName) && hasDirectText(el)) {
      const text = el.textContent?.trim()
      if (text && text.length >= 2) {
        const style = getComputedStyle(el)
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          const id = `wt-${idCounter++}`
          el.setAttribute('data-wt-id', id)
          elementMap.set(id, el)
          inFlightIds.add(id)
          ids.push(id)
        }
      }
    }
    node = walker.nextNode()
  }

  return ids
}

export function markTranslatableElements(): number {
  return walkAndMark(false).length
}

export function markNewVisibleElements(): number {
  return walkAndMark(true).length
}

function hasDirectText(el: Element): boolean {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim())
      return true
  }
  return el.children.length === 0 && !!el.textContent?.trim()
}

/** Extract clean HTML for in-flight elements only. */
export function extractCleanHtml(): string {
  const container = document.createElement('div')

  for (const [id, el] of elementMap) {
    if (!inFlightIds.has(id))
      continue
    const clone = el.cloneNode(true) as Element
    cleanAttributes(clone)
    container.appendChild(clone)
  }

  return container.innerHTML
}

/** Remove IDs from "in-flight" set after they've been translated and replaced. */
export function markIdsCompleted(ids: string[]): void {
  for (const id of ids)
    inFlightIds.delete(id)
}

function cleanAttributes(root: Element): void {
  const attrs = Array.from(root.attributes || [])
  for (const attr of attrs) {
    if (!KEEP_ATTRIBUTES.has(attr.name))
      root.removeAttribute(attr.name)
  }
  for (const child of Array.from(root.children)) {
    cleanAttributes(child)
  }
}

export function splitIntoChunks(html: string): HtmlChunk[] {
  if (!html || html.length <= MAX_CHARS_PER_CHUNK)
    return [{ id: 0, html: html || '' }]

  const container = document.createElement('div')
  container.innerHTML = html

  const chunks: HtmlChunk[] = []
  let currentHtml = ''
  let chunkId = 0

  for (const child of Array.from(container.children)) {
    const childHtml = child.outerHTML
    if (currentHtml.length + childHtml.length > MAX_CHARS_PER_CHUNK && currentHtml.length > 0) {
      chunks.push({ id: chunkId++, html: currentHtml })
      currentHtml = ''
    }
    currentHtml += childHtml
  }

  if (currentHtml)
    chunks.push({ id: chunkId, html: currentHtml })

  return chunks.length > 0 ? chunks : [{ id: 0, html }]
}
