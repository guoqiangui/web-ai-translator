import type { Browser } from 'webextension-polyfill'

declare global {
  const __DEV__: boolean
  /** Extension name, defined in packageJson.name */
  const __NAME__: string
  const browser: Browser
}

export {}
