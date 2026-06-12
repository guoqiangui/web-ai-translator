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

1. **Content script** walks the DOM via `TreeWalker`, marks translatable elements with `data-wt-id` attributes, extracts a cleaned HTML copy, and splits it into chunks (max ~15K chars each).
2. **Content script** sends chunks to the **background** via `webext-bridge` (`translate-page` message).
3. **Background** iterates chunks, calling the OpenAI-compatible API for each chunk via `src/logic/translator.ts`. It streams progress back to the content script (`translation-progress` / `translation-chunk-result`).
4. **Content script** receives translated HTML per chunk and uses `data-wt-id` to map it back to the real DOM elements (`replaceFromTranslatedHtml`).
5. Users can click translated elements to toggle between original and translated text. `restoreAllOriginals()` reverts everything.

### Key modules in `src/logic/`

| Module | Role |
|--------|------|
| `html-extractor.ts` | DOM walker: marks elements with `data-wt-id`, extracts clean HTML, splits into chunks. Skips SCRIPT/STYLE/SVG/IFRAME/canvas/video/audio/template and contenteditable elements. |
| `translator.ts` | Calls OpenAI-compatible API with the HTML translation prompt. Uses `openai` SDK. |
| `prompt-builder.ts` | Builds the system prompt instructing the LLM to preserve HTML structure and `data-wt-id` attributes. Strips markdown fences from responses. |
| `dom-replacer.ts` | Maps translated HTML back to original DOM elements by `data-wt-id`. Injects CSS styles for the translated/original toggle UI. Stores original HTML per element. |
| `storage.ts` | Reactive wrappers (`useWebExtensionStorage`) for persisting `llm-config` and `translation-settings` in `browser.storage.local`. |
| `types.ts` | `HtmlChunk`, `LLMConfig`, `TranslationSettings`, `TranslationStatus` (`'idle' | 'extracting' | 'translating' | 'done' | 'error'`), `TranslationState`. |

### Retry & error handling

The background service worker retries failed LLM calls up to 2 times. On HTTP 429 it reads the `Retry-After` header. On 401/403 it throws immediately with a descriptive error. Per-tab `AbortController` instances allow cancelling in-flight translation if the user starts a new one.

## Message Protocol

All cross-context messages are typed via `shim.d.ts` declaring `webext-bridge`'s `ProtocolMap`:

| Message | Direction | Purpose |
|---------|-----------|---------|
| `translate-page` | content-script → background | Send HTML chunks for translation |
| `translation-chunk-result` | background → content-script | Return a single translated chunk |
| `translation-progress` | background → content-script | Status updates during translation |
| `trigger-translation` | popup → content-script | User-initiated translate/restore command |
| `get-translation-status` | popup → content-script | Query current progress when popup opens |

The keyboard shortcut **Alt+T** (`browser.commands`) also triggers `trigger-translation` via the background.

## Storage & Configuration

User settings persisted via `browser.storage.local` (wrapped in Vue reactivity by `useWebExtensionStorage`):

- **`llm-config`**: `{ baseUrl, apiKey, model }` — defaults to `https://api.openai.com/v1` with `gpt-4o-mini`. Supports any OpenAI-compatible API (DeepSeek, Qwen, Moonshot, etc.).
- **`translation-settings`**: `{ targetLanguage }` — defaults to `简体中文`.

The Options page provides a **"Test Connection"** button that calls `{baseUrl}/models` to verify the API key.

## Output

Built files go to `extension/dist/`. The `extension/` directory is the package root loaded by browsers (contains `manifest.json` + `assets/` + `dist/`).
