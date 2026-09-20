import { After, AfterAll, Before, BeforeAll, Status } from '@cucumber/cucumber'
import type { Browser } from '@playwright/test'
import { chromium } from '@playwright/test'
import { mockIconSearch } from './icons-mock.js'
import { startServer, stopServer } from './server.js'

// BeforeAll/AfterAll hooks have no World, so the shared browser lives here.
let browser: Browser

BeforeAll(async function () {
  await startServer()
  browser = await chromium.launch()
})

Before(async function ({ pickle }) {
  this.context = await browser.newContext({
    // Mirrors baseURL in playwright.config.ts so relative page.goto('/') works.
    baseURL: 'http://127.0.0.1:3000',
  })
  this.page = await this.context.newPage()
  this.apiCalls = []
  // The pipeline runs entirely client-side; record any render API attempt.
  this.page.on('request', (request) => {
    if (/\/api\/(prepare|assemble)/.test(request.url())) this.apiCalls.push(request.url())
  })
  // Scenarios tagged @icons get the mocked icon proxy instead of paid calls.
  if (pickle.tags.some((tag) => tag.name === '@icons')) {
    this.iconQueries = []
    await mockIconSearch(this.page, this.iconQueries)
  }
})

After(async function ({ result }) {
  if (result?.status === Status.FAILED) {
    const screenshot = await this.page.screenshot({ fullPage: true })
    await this.attach(screenshot, 'image/png')
  }
  await this.context?.close()
})

AfterAll(async function () {
  await browser?.close()
  await stopServer()
})
