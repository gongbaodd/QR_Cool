import { expect } from '@playwright/test'
import { Given, Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'

/** A fresh page on step 1 of the editor. */
Given('the editor is open', async function (this: EditorWorld) {
  await this.page.goto('/')
  await expect(this.page.getByLabel('Text or URL', { exact: true })).toBeVisible()
})

/** Step 1 -> step 2. The continue button enables once the mask preview is ready. */
When('I continue to the mask search step', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(this.page.getByRole('heading', { name: /Mask Search/i })).toBeVisible()
  await expect(this.page.getByLabel('Mask text preview')).toBeVisible()
})

/** Step 2 -> step 3. Waits for the QR placement to become valid. */
When('I continue to the adjust step', async function (this: EditorWorld) {
  await expect(this.page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 10_000 })
  await this.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(this.page.getByRole('heading', { name: /Adjust QR/i })).toBeVisible()
  await expect(this.page.getByRole('group', { name: /Poster canvas/ })).toBeVisible()
})

Given('I finished the first two steps', async function (this: EditorWorld) {
  await this.page.goto('/')
  await this.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(this.page.getByRole('heading', { name: /Mask Search/i })).toBeVisible()
  await expect(this.page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 10_000 })
  await this.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(this.page.getByRole('heading', { name: /Adjust QR/i })).toBeVisible()
})

/** Generic button press by accessible name, e.g. "Move right" or "Fill region". */
When('I click {string}', async function (this: EditorWorld, name: string) {
  await this.page.getByRole('button', { name }).click()
})

/** Click a control by its visible label, e.g. a checkbox such as "Show region". */
When('I toggle {string}', async function (this: EditorWorld, label: string) {
  await this.page.getByLabel(label).click()
})

/** Assert a message, heading, hint or count rendered anywhere on the page. */
Then('I see the message {string}', async function (this: EditorWorld, text: string) {
  await expect(this.page.getByText(text, { exact: false })).toBeVisible()
})

Then('I do not see the message {string}', async function (this: EditorWorld, text: string) {
  await expect(this.page.getByText(text, { exact: false })).toHaveCount(0)
})

Then('the {string} button is enabled', async function (this: EditorWorld, name: string) {
  await expect(this.page.getByRole('button', { name })).toBeEnabled({ timeout: 15_000 })
})

Then('the {string} button is disabled', async function (this: EditorWorld, name: string) {
  await expect(this.page.getByRole('button', { name })).toBeDisabled()
})

/** Jump between wizard steps using the step rail on the left. */
When('I go back to the step {string}', async function (this: EditorWorld, name: string) {
  await this.page.getByRole('button', { name }).click()
})

/** Keyboard interaction outside a field, e.g. Escape closing a modal. */
When('I press {string}', async function (this: EditorWorld, key: string) {
  await this.page.keyboard.press(key)
})

/** A click far outside any control acts as a light dismiss for overlays. */
When('I click at the top-left corner of the page', async function (this: EditorWorld) {
  await this.page.mouse.click(4, 4)
})

Then('the checkbox {string} is checked', async function (this: EditorWorld, label: string) {
  await expect(this.page.getByLabel(label)).toBeChecked()
})

Then('the checkbox {string} is unchecked', async function (this: EditorWorld, label: string) {
  await expect(this.page.getByLabel(label)).not.toBeChecked()
})
