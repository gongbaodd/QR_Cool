import { expect } from '@playwright/test'
import { Given, Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'

When('I press {string}', async function (this: EditorWorld, key: string) {
  await this.page.keyboard.press(key)
})

Given('the editor has a committed QR', async function (this: EditorWorld) {
  await this.page.goto('/')
  await this.page.waitForTimeout(1_000)
  await this.page.getByLabel('Text or URL', { exact: true }).fill('https://example.com/qr')
  await expect(this.page.getByRole('img', { name: 'Poster editing preview' })).toBeVisible({ timeout: 30_000 })
  const blank = this.page.getByRole('radio', { name: /Blank full-canvas mask/ })
  if (!(await blank.isVisible())) await this.page.getByRole('button', { name: 'Mask', exact: true }).click()
  await blank.click()
  await expect(this.page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await this.page.keyboard.press('Escape')
})

When('I nudge the QR right', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Move right', exact: true }).click()
})

When('I adjust the QR size and angle from the keyboard', async function (this: EditorWorld) {
  await this.page.getByRole('group', { name: /Poster\./ }).focus()
  await this.page.keyboard.press('-')
  await this.page.keyboard.press(']')
})

Then('the SVG placement scene remains visible', async function (this: EditorWorld) {
  await expect(this.page.locator('svg[aria-label="Poster editing preview"]')).toBeVisible()
})

When('I open the top-left marker settings', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Edit tl marker' }).click()
})

Then('the marker dialog is visible', async function (this: EditorWorld) {
  await expect(this.page.getByRole('dialog', { name: 'TL finder marker' })).toBeVisible()
  await expect(this.page.getByRole('radiogroup', { name: 'Marker shape' })).toBeVisible()
})

Then('the marker dialog is closed', async function (this: EditorWorld) {
  await expect(this.page.getByRole('dialog', { name: 'TL finder marker' })).not.toBeVisible()
})

Then('I see the message {string}', async function (this: EditorWorld, text: string) {
  await expect(this.page.getByText(text, { exact: false })).toBeVisible()
})

Then('the assembled poster is visible', async function (this: EditorWorld) {
  await expect(this.page.getByRole('img', { name: 'Assembled artistic QR poster' })).toBeVisible({ timeout: 30_000 })
})

When('I return to editing', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Return to editing' }).click()
})
