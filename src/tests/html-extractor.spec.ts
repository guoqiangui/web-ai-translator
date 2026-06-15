import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getElementMap, markTranslatableElements, resetTranslationState } from '../logic/html-extractor'

beforeEach(() => {
  // jsdom returns a 0-sized rect for every element, which fails isInViewport.
  // Force a rect that sits inside the default 1024x768 jsdom viewport so the
  // walker actually marks elements.
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
  resetTranslationState()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('htmlExtractor — nested translatable marking', () => {
  it('marks a block parent but not its inline child (the apple/苹果 bug)', () => {
    // <em> is itself in TRANSLATABLE_TAGS; before the fix it got its own
    // data-wt-id and was translated independently, corrupting the parent's
    // saved original so expanding it showed the translated text.
    document.body.innerHTML = '<p>I like <em>apple</em></p>'
    const ids = markTranslatableElements()
    expect(ids).toEqual(['wt-0'])
    expect(document.querySelector('p')!.getAttribute('data-wt-id')).toBe('wt-0')
    expect(document.querySelector('em')!.hasAttribute('data-wt-id')).toBe(false)
  })

  it('skips every inline descendant type nested in a parent', () => {
    document.body.innerHTML
      = '<p>a <em>b</em> <strong>c</strong> <a href="/x">d</a> <span>e</span></p>'
    const ids = markTranslatableElements()
    expect(ids).toEqual(['wt-0'])
    expect(document.querySelectorAll('[data-wt-id]')).toHaveLength(1)
  })

  it('skips deeply nested translatable descendants', () => {
    document.body.innerHTML = '<p>x <span>y <em>z</em></span></p>'
    const ids = markTranslatableElements()
    expect(ids).toEqual(['wt-0'])
    expect(document.querySelector('span')!.hasAttribute('data-wt-id')).toBe(false)
    expect(document.querySelector('em')!.hasAttribute('data-wt-id')).toBe(false)
  })

  it('still marks independent siblings separately', () => {
    document.body.innerHTML = '<p>one</p><p>two</p>'
    const ids = markTranslatableElements()
    expect(ids).toEqual(['wt-0', 'wt-1'])
  })

  it('marks a top-level inline element with no translatable ancestor', () => {
    // DIV is not translatable, so the <a> is the outermost translatable node.
    document.body.innerHTML = '<div><a href="/x">link text</a></div>'
    const ids = markTranslatableElements()
    expect(ids).toEqual(['wt-0'])
    expect(document.querySelector('a')!.getAttribute('data-wt-id')).toBe('wt-0')
  })
})

describe('htmlExtractor — resetTranslationState', () => {
  it('strips data-wt-id from the DOM so re-translation is not blocked by stale ids', () => {
    document.body.innerHTML = '<p>I like <em>apple</em></p>'
    markTranslatableElements()
    resetTranslationState()

    expect(document.querySelector('p')!.hasAttribute('data-wt-id')).toBe(false)
    expect(document.querySelector('em')!.hasAttribute('data-wt-id')).toBe(false)

    // Second pass (translate → restore → translate) still marks the parent.
    // Without the DOM cleanup, a leftover ancestor id would wrongly skip it.
    const ids = markTranslatableElements()
    expect(ids).toEqual(['wt-0'])
    expect(getElementMap().get('wt-0')).toBe(document.querySelector('p'))
  })
})
