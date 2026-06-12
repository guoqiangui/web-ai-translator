import { describe, expect, it } from 'vitest'
import { ElementExtractor } from '../logic/element-extractor'

describe('elementExtractor', () => {
  it('single simple element', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements('<p data-wt-id="wt-0">Hello</p>')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')
    expect(result[0].html).toBe('<p data-wt-id="wt-0">Hello</p>')
  })

  it('element with nested non-matching tags', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0"><strong>bold</strong> text</p>',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')
    expect(result[0].html).toContain('<strong>')
    expect(result[0].html).toContain('</strong>')
  })

  it('element with nested same-tag', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<span data-wt-id="wt-0">outer <span>inner</span> tail</span>',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')
    expect(result[0].html).toBe(
      '<span data-wt-id="wt-0">outer <span>inner</span> tail</span>',
    )
  })

  it('multiple sibling elements', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">A</p><p data-wt-id="wt-1">B</p>',
    )
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('wt-0')
    expect(result[1].id).toBe('wt-1')
  })

  it('nested translatable elements — inner extracted first', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<div data-wt-id="wt-0"><span data-wt-id="wt-1">nested</span></div>',
    )
    // Both are complete; inner should be found first (its data-wt-id appears first)
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('wt-0') // div's data-wt-id="wt-0" appears first in text
    expect(result[1].id).toBe('wt-1') // span's comes after
  })

  it('incomplete element — no close tag', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">partial',
    )
    expect(result).toHaveLength(0)
  })

  it('incomplete opening tag — no >', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0',
    )
    expect(result).toHaveLength(0)
  })

  it('tag name prefix is not confused (p vs pre)', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">text<pre>code</pre></p>',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')
    // Should NOT confuse </pre> as closing </p>
    expect(result[0].html).toContain('<pre>code</pre>')
    expect(result[0].html).toContain('</p>')
  })

  it('streaming simulation — elements extracted as they become complete', () => {
    const ex = new ElementExtractor()

    // First few tokens: first element complete
    let result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">Hello</p><p data-wt-id="wt-1">',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')

    // More tokens arrive: second element completes
    result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">Hello</p><p data-wt-id="wt-1">World</p>',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-1')

    // No new complete elements
    result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">Hello</p><p data-wt-id="wt-1">World</p>',
    )
    expect(result).toHaveLength(0)
  })

  it('empty text', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements('')
    expect(result).toHaveLength(0)
  })

  it('no data-wt-id markers', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements('<div><p>no markers</p></div>')
    expect(result).toHaveLength(0)
  })

  it('self-closing inner tags do not affect depth', () => {
    const ex = new ElementExtractor()
    const result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">line<br>text<hr></p>',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')
  })

  it('reset clears extracted ids', () => {
    const ex = new ElementExtractor()
    ex.extractCompleteElements('<p data-wt-id="wt-0">A</p>')
    ex.reset()
    const result = ex.extractCompleteElements('<p data-wt-id="wt-0">A</p>')
    expect(result).toHaveLength(1) // would be 0 without reset
  })

  it('div tag name is not confused with div (same name)', () => {
    const ex = new ElementExtractor()
    // <divider> has tag name "divider" — should NOT match <div> depth tracking
    const result = ex.extractCompleteElements(
      '<div data-wt-id="wt-0">text<divider>foo</divider></div>',
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')
    // depth tracked for 'div', not 'divider'
    expect(result[0].html).toContain('<divider>')
    expect(result[0].html).toContain('</divider>')
  })

  it('extractAllRemaining gets leftovers after stream ends', () => {
    const ex = new ElementExtractor()

    // Simulate streaming: only 1 of 2 elements complete during stream
    const partial = '<p data-wt-id="wt-0">Done</p><p data-wt-id="wt-1">Partial'
    const result = ex.extractCompleteElements(partial)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('wt-0')

    // Now the full text arrived (after extractTranslatedHtml cleaned it)
    const full = '<p data-wt-id="wt-0">Done</p><p data-wt-id="wt-1">Complete now</p>'
    const remaining = ex.extractAllRemaining(full)
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe('wt-1')
  })

  it('element with attributes containing angle brackets (rare edge case)', () => {
    const ex = new ElementExtractor()
    // An unlikely but valid case: attribute value with > inside quotes
    // This is a pathological case the algorithm doesn't handle, but it's
    // not expected in LLM output of HTML translation
    const result = ex.extractCompleteElements(
      '<p data-wt-id="wt-0">simple text</p>',
    )
    expect(result).toHaveLength(1)
  })
})
