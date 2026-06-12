import OpenAI from 'openai'
import type { LLMConfig } from './types'
import { buildHtmlTranslationPrompt, extractTranslatedHtml } from './prompt-builder'

/** Create a reusable OpenAI client instance */
export function createTranslationClient(config: LLMConfig): OpenAI {
  return new OpenAI({
    baseURL: config.baseUrl,
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: false,
  })
}

export async function translateHtml(
  config: LLMConfig,
  html: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<string> {
  const client = createTranslationClient(config)

  const completion = await client.chat.completions.create({
    model: config.model,
    messages: [
      { role: 'system', content: buildHtmlTranslationPrompt(targetLanguage) },
      { role: 'user', content: html },
    ],
    temperature: 0.3,
  }, { signal })

  const content = completion.choices[0]?.message?.content
  if (!content)
    throw new Error('Empty response from LLM')

  return extractTranslatedHtml(content)
}

/** Streaming variant — accumulates full response via SSE, then returns cleaned HTML */
export async function translateHtmlStreaming(
  client: OpenAI,
  model: string,
  html: string,
  targetLanguage: string,
  signal?: AbortSignal,
): Promise<string> {
  return translateHtmlStreamingWithCallback(
    client,
    model,
    html,
    targetLanguage,
    () => {}, // no-op callback
    signal,
  )
}

/**
 * Streaming variant with a per-token callback.
 * `onToken` receives the accumulated text after each delta — useful for
 * incremental element extraction during translation.
 */
export async function translateHtmlStreamingWithCallback(
  client: OpenAI,
  model: string,
  html: string,
  targetLanguage: string,
  onToken: (accumulatedText: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildHtmlTranslationPrompt(targetLanguage) },
      { role: 'user', content: html },
    ],
    temperature: 0.3,
    stream: true,
  }, { signal })

  let accumulated = ''
  for await (const chunk of stream) {
    if (signal?.aborted) {
      stream.controller.abort()
      throw new DOMException('Aborted', 'AbortError')
    }
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      accumulated += delta
      onToken(accumulated)
    }
  }

  if (!accumulated)
    throw new Error('Empty response from LLM')

  return extractTranslatedHtml(accumulated)
}
