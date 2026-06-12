export function buildHtmlTranslationPrompt(targetLanguage: string): string {
  return `You are a professional translator. Translate the text content in the provided HTML into ${targetLanguage}.

Rules:
1. ONLY translate human-readable text. Do NOT modify any HTML tags, attributes, or structure.
2. Preserve all data-wt-id attributes exactly as they are.
3. Preserve URLs, email addresses, code identifiers, and proper nouns.
4. Match the tone and register of the original.
5. Return ONLY the translated HTML, nothing else — no explanations, no markdown code fences.`
}

export function extractTranslatedHtml(response: string): string {
  let html = response.trim()

  const fenceMatch = html.match(/```(?:html)?\n([^`]*)```/)
  if (fenceMatch)
    html = fenceMatch[1].trim()

  return html
}
