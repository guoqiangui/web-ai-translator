export interface CompletedElement {
  id: string
  html: string
}

/**
 * Detects complete HTML elements in a streaming text buffer.
 *
 * Only tracks elements with `data-wt-id` attributes — ignores all other markup.
 * Uses tag-name-specific depth tracking so void elements (<br>, <img>) and
 * unrelated tags never interfere.
 */
export class ElementExtractor {
  private extractedIds = new Set<string>()

  reset(): void {
    this.extractedIds.clear()
  }

  hasExtracted(id: string): boolean {
    return this.extractedIds.has(id)
  }

  /**
   * Scan accumulated streaming text for newly-complete elements.
   * Each element is returned at most once across calls.
   */
  extractCompleteElements(accumulatedText: string): CompletedElement[] {
    const results: CompletedElement[] = []
    const markerRegex = /data-wt-id="(wt-\d+)"/g
    let match = markerRegex.exec(accumulatedText)
    while (match !== null) {
      const id = match[1]
      if (this.extractedIds.has(id)) {
        match = markerRegex.exec(accumulatedText)
        continue
      }

      const markerPos = match.index
      const el = tryExtractElement(accumulatedText, markerPos, id)
      if (el) {
        results.push(el)
        this.extractedIds.add(id)
      }
      match = markerRegex.exec(accumulatedText)
    }

    return results
  }

  /**
   * After the full response arrives and markdown fences are stripped,
   * extract any remaining elements (should all be complete by now).
   */
  extractAllRemaining(cleanedText: string): CompletedElement[] {
    // Re-scan the fully-cleaned text — all elements should close now.
    // Use a fresh regex on the cleaned text.
    return this.extractCompleteElements(cleanedText)
  }
}

/**
 * Try to extract a complete element given a data-wt-id marker position.
 * Returns the outerHTML string if complete, or null if the closing tag
 * hasn't arrived yet.
 */
function tryExtractElement(
  text: string,
  markerPos: number,
  _id: string,
): CompletedElement | null {
  // Step 1: Find the enclosing opening tag
  const tagStart = text.lastIndexOf('<', markerPos)
  if (tagStart === -1)
    return null

  // Step 2: Extract tag name (chars between '<' and first space / '>' / '/')
  const tagName = readTagName(text, tagStart + 1)
  if (!tagName)
    return null

  // Step 3: Make sure the opening tag is complete (contains '>')
  const openEnd = text.indexOf('>', markerPos)
  if (openEnd === -1)
    return null // opening tag hasn't fully arrived yet

  // Step 4: Track depth for this specific tag name
  let depth = 1
  let pos = openEnd + 1
  const openStr = `<${tagName}`
  const closeStr = `</${tagName}>`

  while (depth > 0 && pos < text.length) {
    const nextOpen = findValidOpenTag(text, openStr, tagName, pos)
    const nextClose = text.indexOf(closeStr, pos)

    if (nextOpen === -1 && nextClose === -1)
      return null // element not yet complete — no more tags of this type

    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      // Nested opening tag of same type
      depth++
      const gt = text.indexOf('>', nextOpen)
      pos = (gt !== -1) ? gt + 1 : nextOpen + openStr.length
    }
    else if (nextClose !== -1) {
      // Closing tag of same type
      depth--
      pos = nextClose + closeStr.length
      if (depth === 0) {
        return { id: _id, html: text.substring(tagStart, pos) }
      }
    }
    else {
      // Neither found (shouldn't reach here due to -1 check above)
      return null
    }
  }

  return null
}

/**
 * Read a tag name starting at `start` (just after '<').
 * Returns lowercase tag name, or empty string if out of bounds.
 */
function readTagName(text: string, start: number): string {
  let end = start
  while (end < text.length && /[a-z0-9]/i.test(text[end]))
    end++
  return text.substring(start, end).toLowerCase()
}

/**
 * Find the next valid opening tag for a given tag name.
 * "Valid" means the character immediately after `<tagName` is a boundary
 * (space, `>`, `/`, or end of string), preventing `<p` from matching `<pre>`.
 */
function findValidOpenTag(
  text: string,
  openStr: string,
  _tagName: string,
  startPos: number,
): number {
  let pos = text.indexOf(openStr, startPos)
  while (pos !== -1) {
    const after = pos + openStr.length
    const ch = text[after]
    // Valid boundary: space, '>', '/', or end-of-string
    if (ch === undefined || ch === ' ' || ch === '>' || ch === '/') {
      return pos
    }
    pos = text.indexOf(openStr, pos + 1)
  }
  return -1
}
