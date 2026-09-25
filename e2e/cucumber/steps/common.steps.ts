import { expect } from '@playwright/test'
import { Given, Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'
import { openWithQr } from '../../support/editor.js'

When('I press {string}', async function (this: EditorWorld, key: string) {
  await this.page.keyboard.press(key)
})

Given('the editor has a committed QR', async function (this: EditorWorld) {
  await openWithQr(this.page)
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

When('I enter fill mode', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: /Fill region|Filling region/ }).click()
})

Then('fill mode is active', async function (this: EditorWorld) {
  await expect(this.page.getByRole('button', { name: /Fill region|Filling region/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

Then('fill mode is inactive', async function (this: EditorWorld) {
  await expect(this.page.getByRole('button', { name: /Fill region|Filling region/ })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

When('I toggle the region rim and margin', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: /Add Rim/ }).click()
  await this.page.getByRole('button', { name: /Add Margin/ }).click()
})

Then('the rim and margin are active', async function (this: EditorWorld) {
  await expect(this.page.getByRole('button', { name: /Add Rim/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(this.page.getByRole('button', { name: /Add Margin/ })).toHaveAttribute('aria-pressed', 'true')
})

Then('the marker dialog is visible', async function (this: EditorWorld) {
  const markerDialog = this.page.getByRole('dialog', { name: 'Top Left finder marker' })
  await expect(markerDialog).toBeVisible()
  await expect(markerDialog.getByRole('radiogroup', { name: 'Marker shape' })).toBeVisible()
})

Then('the marker dialog is closed', async function (this: EditorWorld) {
  await expect(this.page.getByRole('dialog', { name: 'Top Left finder marker' })).not.toBeVisible()
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
