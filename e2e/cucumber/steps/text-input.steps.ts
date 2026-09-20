import { expect } from '@playwright/test'
import { Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'

/** Types into the "Text or URL" field on step 1. */
When('I enter {string} in the text field', async function (this: EditorWorld, text: string) {
  await this.page.getByLabel('Text or URL', { exact: true }).fill(text)
})

/** Multi-line input needs a doc string so the newline survives Gherkin. */
When('I enter the multi-line text', async function (this: EditorWorld, text: string) {
  await this.page.getByLabel('Text or URL', { exact: true }).fill(text)
})

/** The example chips under the input. */
When('I click the example button {string}', async function (this: EditorWorld, name: string) {
  await this.page.getByRole('button', { name }).click()
})

Then('the text field shows {string}', async function (this: EditorWorld, text: string) {
  await expect(this.page.getByLabel('Text or URL', { exact: true })).toHaveValue(text)
})

/** Websites derive the mask letter from their name; plain text stays blank. */
Then('the mask search field shows {string}', async function (this: EditorWorld, letter: string) {
  await expect(this.page.getByLabel('Mask search', { exact: true })).toHaveValue(letter)
})

Then('the continue button is disabled', async function (this: EditorWorld) {
  await expect(this.page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
})

/** The blank option starts from an empty 1000x1000 canvas without an upload. */
When('I pick the mask font {string}', async function (this: EditorWorld, font: string) {
  await this.page.getByRole('radio', { name: `Mask font ${font}` }).click()
})

Then('the mask font {string} is selected', async function (this: EditorWorld, font: string) {
  await expect(this.page.getByRole('radio', { name: `Mask font ${font}` })).toHaveAttribute('aria-checked', 'true')
})

Then('the poster canvas is visible', async function (this: EditorWorld) {
  await expect(this.page.getByRole('group', { name: /Poster canvas/ })).toBeVisible()
})
