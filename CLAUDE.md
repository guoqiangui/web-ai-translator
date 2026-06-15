# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser extension (Manifest V3) built on the Vitesse WebExt starter template. Supports Chrome and Firefox. Uses Vue 3 + TypeScript + Vite + UnoCSS + pnpm.

## Commands

```bash
pnpm dev              # Dev mode (Chrome) — runs all three Vite builds in parallel + HMR
pnpm dev-firefox      # Dev mode (Firefox)
pnpm build            # Production build
pnpm lint             # ESLint (flat config, @antfu/eslint-config)
pnpm test             # Vitest unit tests
pnpm test:e2e         # Playwright E2E tests (needs built extension)
pnpm typecheck        # tsc --noEmit
pnpm pack             # Package as .zip, .crx, .xpi
pnpm start:chromium   # Run extension in Chromium via web-ext
pnpm start:firefox    # Run extension in Firefox via web-ext
```

## Architecture

### Multi-context build

A WebExtension has isolated execution contexts. This project uses **three separate Vite configs** because each context has different entry points and output formats:

- `vite.config.mts` — popup, options, sidepanel (standard web pages)
- `vite.config.background.mts` — service worker (no DOM)
- `vite.config.content.mts` — content script (injected into host pages)

### Extension contexts

| Context | Entry | Purpose |
|---------|-------|---------|
| Popup | `src/popup/` | Browser action popup |
| Options | `src/options/` | Full-page settings UI |
| Sidepanel | `src/sidepanel/` | Chrome side panel / Firefox sidebar |
| Content Script | `src/contentScripts/` | Vue app injected into all web pages via Shadow DOM |
| Background | `src/background/` | Service worker — message handling, tab tracking |

All four UI contexts call `setupApp()` from `src/logic/common-setup.ts` for shared plugin initialization.

### Cross-context communication

- **`webext-bridge`** for typed message passing between contexts. Protocol types are declared in `shim.d.ts`.
- **`useWebExtensionStorage`** (`src/composables/`) for reactive state shared across all contexts via `browser.storage.local`.

### Content script isolation

The content script mounts into a Shadow DOM (`open` in dev, `closed` in prod) to prevent CSS leakage. Styles are loaded via `browser.runtime.getURL()`.

### Dynamic manifest

`src/manifest.ts` generates `extension/manifest.json` dynamically, handling Chrome vs Firefox differences (service_worker vs scripts, side_panel vs sidebar_action, CSP for dev).

### Auto-imports

Components in `src/components/` and Vue APIs are auto-imported (unplugin-auto-import + unplugin-vue-components). Icons from Iconify are available as components via unplugin-icons.

### Build-time defines

- `__DEV__` — boolean, true in development
- `__NAME__` — string from package.json name

### Environment variables

- `EXTENSION=firefox` — switches to Firefox manifest features
- `PORT` — overrides default dev server port 3303
- `NODE_ENV` — controls dev vs production builds

## AI Translation Pipeline

This extension translates web page text through an LLM. The flow involves three contexts working together:

### How translation works

1. **Content script** walks the DOM via `TreeWalker`, marks translatable elements with `data-wt-id` attributes, extracts a cleaned HTML copy, and splits it into chunks (max ~5K chars each — small chunks so multiple LLM requests stream in parallel).
2. **Content script** sends chunks to the **background** via `webext-bridge` (`translate-page` message).
3. **Background** translates chunks concurrently (up to 6 in flight via a `pLimit` pool), calling the OpenAI-compatible API for each chunk via `src/logic/translator.ts`. Each chunk's URLs are masked to placeholders first (`url-mask.ts`). It streams each completed element back to the content script (`translation-chunk-result`, URLs restored) and reports any elements it couldn't translate (`translation-elements-failed`).
4. **Content script** maps each translated element back to the real DOM by `data-wt-id` (`replaceFromTranslatedHtml`). Scrolling fires more batches that translate concurrently with in-flight ones; the content script owns completion locally (`completed >= total`) rather than trusting any single batch's `done`.
5. Users can click translated elements to toggle between original and translated text. `restoreAllOriginals()` reverts everything.

### Key modules in `src/logic/`

| Module | Role |
|--------|------|
| `html-extractor.ts` | DOM walker: marks elements with `data-wt-id` (returning the id list per call), extracts clean HTML for a given id set, splits into chunks. Skips SCRIPT/STYLE/SVG/IFRAME/canvas/video/audio/template and contenteditable elements. |
| `translator.ts` | Calls OpenAI-compatible API with the HTML translation prompt. Uses `openai` SDK. |
| `element-extractor.ts` | Incrementally scans the streaming response for complete `data-wt-id` elements, emitting each one as soon as its closing tag arrives. Tracks a resume offset so cost is proportional to newly-arrived text. |
| `url-mask.ts` | Replaces long `href`/`src` URLs with short `__WTURL<n>__` placeholders before translation and restores them after, so the LLM doesn't spend output tokens re-emitting URLs. Per-chunk maps keep it concurrency-safe. |
| `prompt-builder.ts` | Builds the system prompt instructing the LLM to preserve HTML structure, `data-wt-id` attributes, and `__WTURL<n>__` placeholders. Strips markdown fences from responses. |
| `dom-replacer.ts` | Maps translated HTML back to original DOM elements by `data-wt-id` (single `querySelectorAll`, O(n)). Injects CSS styles for the translated/original toggle UI. Stores original HTML per element. |
| `storage.ts` | Reactive wrappers (`useWebExtensionStorage`) for persisting `llm-config` and `translation-settings` in `browser.storage.local`. |
| `types.ts` | `HtmlChunk`, `LLMConfig`, `TranslationSettings`, `TranslationStatus` (`'idle' | 'extracting' | 'translating' | 'done' | 'error'`), `TranslationState`. |

### Retry & error handling

The background service worker retries failed LLM calls up to 2 times. On HTTP 429 it reads the `Retry-After` header. On 401/403 it throws immediately with a descriptive error. Each chunk owns one `ElementExtractor` that lives across retries, so a retry never re-sends elements that already reached the page. Any elements still missing after a chunk exhausts its retries (or that the LLM dropped) are reported via `translation-elements-failed` so the content script can settle its in-flight count instead of deadlocking. Per-tab `AbortController` instances allow cancelling in-flight translation if the user starts a new one.

## Message Protocol

All cross-context messages are typed via `shim.d.ts` declaring `webext-bridge`'s `ProtocolMap`:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `translate-page` | content-script → background | Send HTML chunks for translation |
| `translation-chunk-result` | background → content-script | Return a single translated element (streamed as soon as it completes) |
| `translation-elements-failed` | background → content-script | Report `data-wt-id`s that couldn't be translated, so the content script settles its in-flight count |
| `translation-progress` | background → content-script | Coarse status updates (`translating` / `done` / `error`) |
| `trigger-translation` | popup → content-script | User-initiated translate/restore command |
| `cancel-translation` | content-script → background | Abort in-flight translation for this tab |
| `get-translation-status` | popup → content-script | Query current progress when popup opens |

The keyboard shortcut **Alt+T** (`browser.commands`) also triggers `trigger-translation` via the background.

## Storage & Configuration

User settings persisted via `browser.storage.local` (wrapped in Vue reactivity by `useWebExtensionStorage`):

- **`llm-config`**: `{ baseUrl, apiKey, model }` — defaults to `https://api.openai.com/v1` with `gpt-4o-mini`. Supports any OpenAI-compatible API (DeepSeek, Qwen, Moonshot, etc.).
- **`translation-settings`**: `{ targetLanguage }` — defaults to `简体中文`.

The Options page provides a **"Test Connection"** button that calls `{baseUrl}/models` to verify the API key.

## Output

Built files go to `extension/dist/`. The `extension/` directory is the package root loaded by browsers (contains `manifest.json` + `assets/` + `dist/`).
