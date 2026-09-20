import { setDefaultTimeout, World, setWorldConstructor } from '@cucumber/cucumber'
import type { Browser, BrowserContext, Page } from '@playwright/test'

// Generous step timeout: the app re-renders through a Web Worker and several
// steps wait up to 15 seconds with Playwright's own retry timeouts.
setDefaultTimeout(30_000)

/**
 * Shared state for one scenario.
 * A browser is launched once per run (hooks.ts); every scenario gets a fresh
 * context + page so scenarios cannot leak cookies, routes or mocks.
 */
export class EditorWorld extends World {
  browser!: Browser
  context!: BrowserContext
  page!: Page

  /** Icon-search queries the app sent while the mock proxy was recording. */
  iconQueries: string[] = []

  /** Render API calls observed by the request listener — the pipeline must stay client-side. */
  apiCalls: string[] = []

  /** Bytes of the poster captured through the browser download. */
  downloadedBytes?: Buffer

  /** Seed value read before "New pattern" is pressed, to prove it changes. */
  seedBefore?: string
}

setWorldConstructor(EditorWorld)
