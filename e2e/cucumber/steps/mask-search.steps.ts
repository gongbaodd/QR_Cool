import { expect } from '@playwright/test'
import { Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'

/** Types a search term into the mask search field on step 2. */
When('I search for {string}', async function (this: EditorWorld, term: string) {
  const search = this.page.getByLabel('Mask search', { exact: true })
  await search.fill(term)
  // The field keeps 10 characters at most, mirroring the maxlength guard.
  await expect(search).toHaveValue(term.slice(0, 10))
})

/** The preview canvas must render bright (dark-on-light) mask pixels. */
Then('the preview canvas has bright pixels', async function (this: EditorWorld) {
  const bright = await this.page.getByLabel('Mask text preview').evaluate((node) => {
    const canvas = node as HTMLCanvasElement
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 128) count++
    return count
  })
  expect(bright).toBeGreaterThan(100)
})

/** The sidebar grid keeps exactly the fonts from public/fonts (3x4). */
Then('the mask options list exactly {int} fonts', async function (this: EditorWorld, count: number) {
  await expect(this.page.getByRole('radiogroup', { name: 'Mask options' })).toBeVisible()
  await expect(this.page.getByRole('radiogroup', { name: 'Mask options' }).locator('button')).toHaveCount(count)
})

Then('the gallery shows the icon {string}', async function (this: EditorWorld, name: string) {
  await expect(this.page.getByRole('button', { name: new RegExp(name) })).toBeVisible()
})

/** "More icons" opens the modal gallery and searches the current term. */
When('I open the icon gallery', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'More icons' }).click()
  await expect(this.page.getByTestId('icon-gallery')).toBeVisible()
})

/** Alias for reopening — the cached term must come back without a new request. */
When('I open the icon gallery again', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'More icons' }).click()
  await expect(this.page.getByTestId('icon-gallery')).toBeVisible()
})

When('I close the icon gallery', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Close icon gallery' }).click()
  await expect(this.page.getByTestId('icon-gallery')).not.toBeVisible()
  await expect(this.page.getByLabel('Mask text preview')).toBeVisible()
})

Then('the preview canvas is visible', async function (this: EditorWorld) {
  await expect(this.page.getByLabel('Mask text preview')).toBeVisible()
})

/** After closing, the sidebar still counts exactly the 12 fonts; icons never leak into it. */
Then(
  'the sidebar keeps its {int} fonts and exactly one selected option',
  async function (this: EditorWorld, count: number) {
    await expect(this.page.getByRole('radiogroup', { name: 'Mask options' }).locator('button')).toHaveCount(count)
    await expect(
      this.page.getByRole('radiogroup', { name: 'Mask options' }).locator('button[aria-checked="true"]'),
    ).toHaveCount(1)
    await expect(
      this.page.getByRole('radiogroup', { name: 'Mask options' }).getByRole('radio', { name: /Icon heart-0/ }),
    ).toHaveCount(0)
  },
)

Then('the button {string} says {string}', async function (this: EditorWorld, name: string, text: string) {
  await expect(this.page.getByRole('button', { name })).toContainText(text)
})

/** The mock proxy records every query; assert the exact list, comma separated. */
Then(
  'the icon search sent exactly the quer{word} {string}',
  async function (this: EditorWorld, _suffix: string, expected: string) {
    const expectedQueries = expected === '' ? [] : expected.split(', ')
    expect(this.iconQueries).toEqual(expectedQueries)
  },
)

/** Selecting an icon in the gallery closes the modal and uses it as the mask. */
When('I pick the gallery icon {string}', async function (this: EditorWorld, name: string) {
  await this.page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(this.page.getByTestId('icon-gallery')).not.toBeVisible()
  await expect(this.page.getByLabel('Mask text preview')).toBeVisible()
})

/** The fill tool paints enclosed areas of the letter mask. */
Then('the {string} button is pressed', async function (this: EditorWorld, name: string) {
  await expect(this.page.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
})

Then('the {string} button is not pressed', async function (this: EditorWorld, name: string) {
  await expect(this.page.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false')
})
