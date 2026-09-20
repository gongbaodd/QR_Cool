import { expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'

/** Step 3 -> step 4. */
When('I continue to generate', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Continue to generate', exact: true }).click()
  await expect(this.page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeVisible()
})

/** Runs the client-side assembly in the worker and waits for the preview. */
When('I assemble the poster', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  await expect(this.page.getByText('Artistic margins can affect scanning.', { exact: false })).toBeVisible()
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

/** Captures the browser download into world state for size assertions. */
When('I download the poster as {string}', async function (this: EditorWorld, filename: string) {
  const downloaded = this.page.waitForEvent('download')
  await this.page.getByRole('link', { name: `Download ${filename}` }).click()
  const file = await downloaded
  this.downloadedBytes = await readFile((await file.path())!)
})

Then('the download is a {int}x{int} PNG', async function (this: EditorWorld, width: number, height: number) {
  const metadata = await sharp(this.downloadedBytes!).metadata()
  expect(metadata).toMatchObject({ format: 'png', width, height })
})

Then('no render API was called', async function (this: EditorWorld) {
  expect(this.apiCalls).toEqual([])
})

/** Editing the poster again invalidates the assembled result. */
Then('the download link disappears', async function (this: EditorWorld) {
  await expect(this.page.getByRole('link', { name: 'Download poster.png' })).toHaveCount(0)
})

/** Walk steps 1 and 2 again with the new text and confirm step 3 becomes valid. */
Then('the remaining steps validate again', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(this.page.getByLabel('Mask search', { exact: true })).toBeVisible()
  await expect(this.page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 10_000 })
  await this.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(this.page.getByRole('heading', { name: /Adjust QR/i })).toBeVisible()
  await expect(this.page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
})
