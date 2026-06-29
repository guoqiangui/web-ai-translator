import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { replaceFromTranslatedHtml, restoreAllOriginals } from '../logic/dom-replacer'
import { markTranslatableElements, resetTranslationState } from '../logic/html-extractor'

beforeEach(() => {
  // jsdom returns a 0-sized rect for every element, which fails isInViewport.
  // Force a rect inside the default 1024x768 viewport so the walker marks elements.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 10,
    bottom: 20,
    left: 10,
    right: 20,
    width: 10,
    height: 10,
    x: 10,
    y: 10,
    toJSON: () => ({}),
  } as DOMRect)
})

afterEach(() => {
  restoreAllOriginals()
  resetTranslationState()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('domReplacer — restoring stripped attributes', () => {
  it('restores class on nested descendants the LLM dropped (the anchor/permalink bug)', () => {
    // html-extractor strips class/id/style before sending to the LLM to save
    // tokens, so the translated descendants come back without them. The real DOM
    // subtree still carries them at replace time, so we backfill before swapping.
    document.body.innerHTML = '<h2 id="slash-separated-lists" tabindex="-1">Slash-Separated Lists<a class="anchor" href="#slash-separated-lists"><span class="visuallyhidden">Slash-Separated Lists permalink</span></a></h2>'
    const ids = markTranslatableElements()
    expect(ids).toEqual(['wt-0'])

    replaceFromTranslatedHtml('<h2 data-wt-id="wt-0">斜杠分隔的列表<a href="#slash-separated-lists"><span>斜杠分隔的列表永久链接</span></a></h2>')

    const a = document.querySelector('h2 a')!
    const span = document.querySelector('h2 a span')!
    expect(a.getAttribute('class')).toBe('anchor')
    expect(a.getAttribute('href')).toBe('#slash-separated-lists')
    expect(span.getAttribute('class')).toBe('visuallyhidden')
    expect(span.textContent).toBe('斜杠分隔的列表永久链接')

    // The top-level element keeps its own attributes (only innerHTML is swapped).
    const h2 = document.querySelector('h2')!
    expect(h2.getAttribute('id')).toBe('slash-separated-lists')
    expect(h2.getAttribute('tabindex')).toBe('-1')
  })

  it('does not overwrite attributes the translation already carries', () => {
    // alt/title are sent to the LLM and may come back translated — keep the
    // translated value instead of clobbering it with the original.
    document.body.innerHTML = '<p>Click <a class="btn" href="/page" title="Go to page">here</a></p>'
    expect(markTranslatableElements()).toEqual(['wt-0'])

    replaceFromTranslatedHtml('<p data-wt-id="wt-0">点击<a href="/page" title="前往页面">这里</a></p>')

    const a = document.querySelector('p a')!
    expect(a.getAttribute('class')).toBe('btn') // stripped → restored
    expect(a.getAttribute('title')).toBe('前往页面') // translated → preserved
    expect(a.getAttribute('href')).toBe('/page')
  })

  it('degrades safely when the LLM changes the descendant structure', () => {
    // If the child counts diverge we cannot map attributes reliably, so we skip
    // backfill rather than risk landing them on the wrong element.
    document.body.innerHTML = '<p>Hello <strong class="x">world</strong></p>'
    expect(markTranslatableElements()).toEqual(['wt-0'])

    expect(() => {
      replaceFromTranslatedHtml('<p data-wt-id="wt-0">你好 <strong>世界</strong> <em>额外</em></p>')
    }).not.toThrow()

    expect(document.querySelector('p strong')!.textContent).toBe('世界')
    expect(document.querySelector('p em')!.textContent).toBe('额外')
  })
})
