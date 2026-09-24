import { expect } from '@playwright/test'
import { Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'

/** Runs the client-side assembly in the worker and waits for the preview. */
When('I assemble the poster', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  await expect(this.page.getByRole('img', { name: 'Assembled artistic QR poster' })).toBeVisible({ timeout: 30_000 })
})

/** Preview and download must share one object URL of the assembled Blob (no re-encode). */
Then('the preview and download link share one blob URL', async function (this: EditorWorld) {
  expect(
    await this.page.evaluate(() => {
      const image = document.querySelector<HTMLImageElement>('img[alt="Assembled artistic QR poster"]')
      const link = document.querySelector<HTMLAnchorElement>('a[download="poster.png"]')
      return !!image && !!link && image.src === link.href
    }),
  ).toBe(true)
})
