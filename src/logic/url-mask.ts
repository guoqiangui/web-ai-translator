/**
 * Masks long `href`/`src` URLs with short placeholder tokens before sending
 * HTML to the LLM, then restores them on the way back. URLs are not translated,
 * but the model still has to re-emit every character — and since output is
 * generated serially, a page full of long tracking URLs wastes real time and
 * tokens. Replacing them with a compact token the model copies verbatim avoids
 * that. Each chunk masks independently, so the maps are isolated and the work
 * stays concurrency-safe.
 */

// Serialized innerHTML always quotes attributes with double quotes and escapes
// any embedded quote, so `[^"]*` captures the whole value safely.
const URL_ATTR_RE = /\b(href|src)="([^"]*)"/gi
const PLACEHOLDER_RE = /__WTURL\d+__/g

// Below this length a placeholder (10 chars) saves little, so leave short URLs
// like "#", "/", or "/about" untouched.
const MIN_MASK_LENGTH = 12

export interface UrlMask {
  masked: string
  restore: Map<string, string>
}

export function maskUrls(html: string): UrlMask {
  const restore = new Map<string, string>()
  let i = 0
  const masked = html.replace(URL_ATTR_RE, (full, attr: string, value: string) => {
    if (value.length <= MIN_MASK_LENGTH)
      return full
    const token = `__WTURL${i++}__`
    restore.set(token, value)
    return `${attr}="${token}"`
  })
  return { masked, restore }
}

export function unmaskUrls(html: string, restore: Map<string, string>): string {
  if (restore.size === 0)
    return html
  // A token the model garbled won't be in the map — leave it as-is rather than
  // dropping it, so the breakage is visible instead of silently emptying href.
  return html.replace(PLACEHOLDER_RE, token => restore.get(token) ?? token)
}
