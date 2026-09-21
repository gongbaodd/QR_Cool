import { expect } from '@playwright/test'
import { Then, When } from '@cucumber/cucumber'
import type { EditorWorld } from '../support/world.js'

const ECC_LABEL: Record<string, string> = {
  L: 'L Low ~7%',
  M: 'M Medium ~15%',
  Q: 'Q Quartile ~25%',
  H: 'H High ~30%',
}

/** Error correction is its own control because its options carry level hints.
 * Switching to "H" may invalidate the placement while the worker re-places
 * the QR, so the settle-and-wait happens only when going back to "M". */
When('I set the error correction level to {string}', async function (this: EditorWorld, level: string) {
  await this.page.getByRole('radiogroup', { name: 'Error correction level' }).getByText(level, { exact: true }).click()
  await expect(this.page.getByLabel(ECC_LABEL[level] ?? '')).toBeChecked()
})

/** Returning to "M" for a stable assemble; wait for the placement to settle. */
When('I set the error correction level back to "M"', async function (this: EditorWorld) {
  const level = 'M'
  await this.page.getByRole('radiogroup', { name: 'Error correction level' }).getByText(level, { exact: true }).click()
  await expect(this.page.getByLabel(ECC_LABEL[level]!)).toBeChecked()
  await this.page.waitForTimeout(1500)
  await expect(this.page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled({
    timeout: 15_000,
  })
})

When(
  'I choose {string} in the {string} option group',
  async function (this: EditorWorld, value: string, group: string) {
    await this.page.getByRole('radiogroup', { name: group }).locator('label').filter({ hasText: value }).first().click()
  },
)

/** Assert the checked state via the hidden input's accessible label, e.g. "H High ~30%". */
Then('the option {string} is checked', async function (this: EditorWorld, label: string) {
  await expect(this.page.getByLabel(label).first()).toBeChecked()
})

/** Scoped variant for labels that collide between groups, e.g. "circle Circle". */
Then(
  'the {string} option in the {string} option group is checked',
  async function (this: EditorWorld, label: string, group: string) {
    await expect(this.page.getByRole('radiogroup', { name: group }).getByLabel(label)).toBeChecked()
  },
)

/** Regenerating the seeded texture must produce a different seed. */
When('I press {string} and remember the seed', async function (this: EditorWorld, name: string) {
  this.seedBefore = await this.page.getByLabel('Seed', { exact: true }).inputValue()
  await this.page.getByRole('button', { name }).click()
})

Then('the seed value changed', async function (this: EditorWorld) {
  const seed = this.page.getByLabel('Seed', { exact: true })
  await expect(seed).not.toHaveValue(this.seedBefore ?? '')
})

/** Toggling an option twice returns to the original state and must stay valid. */
When('I toggle {string} twice', async function (this: EditorWorld, label: string) {
  const control = this.page.getByLabel(label)
  await control.click()
  await expect(this.page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled({
    timeout: 15_000,
  })
  await control.click()
  await expect(this.page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled({
    timeout: 15_000,
  })
})

/** Arrow keys move the QR while the canvas group holds focus. */
When('I press {string} on the poster canvas', async function (this: EditorWorld, key: string) {
  await this.page.getByRole('group', { name: /Poster canvas/ }).focus()
  await this.page.keyboard.press(key)
  await expect(this.page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
})

/** Mouse drag on the stage canvas; positive offsets move down/right. */
When('I drag the QR canvas by {int}, {int}', async function (this: EditorWorld, dx: number, dy: number) {
  const stageCanvas = this.page
    .getByRole('group', { name: /Poster canvas/ })
    .locator('canvas')
    .first()
  await stageCanvas.scrollIntoViewIfNeeded()
  const box = (await stageCanvas.boundingBox())!
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await this.page.mouse.move(center.x, center.y)
  await this.page.mouse.down()
  await this.page.mouse.move(center.x + dx, center.y + dy, { steps: 6 })
  await this.page.mouse.up()
})

Then('an invalid-placement alert is visible', async function (this: EditorWorld) {
  // The QR only fits the region in its placed spot, so dragging it away is reported.
  await expect(this.page.getByRole('alert')).toBeVisible()
})

Then('the page has no horizontal overflow', async function (this: EditorWorld) {
  expect(await this.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

/** Open a marker dialog by hovering and clicking that marker on the QR canvas. */
type MarkerTarget = { id: string; kind: string; x: number; y: number; size: number }

/** Tap on touch devices (hasTouch), click elsewhere; Konva handles both. */
async function tapOrClick(page: EditorWorld['page'], x: number, y: number) {
  if (page.context().browser()?.browserType().name() !== 'firefox') {
    try {
      await page.touchscreen.tap(x, y)
      return
    } catch {
      // fall back to mouse for contexts without touch support
    }
  }
  await page.mouse.move(x, y)
  await page.mouse.click(x, y)
}

async function clickMarker(this: EditorWorld, id: string) {
  const stage = this.page.locator('[data-marker-targets]').first()
  await stage.waitFor()
  const rects = JSON.parse((await stage.getAttribute('data-marker-targets'))!) as MarkerTarget[]
  const hit = rects.find((rect) => rect.id === id)
  if (!hit) throw new Error(`No marker target ${id}`)
  await this.page.locator('canvas').first().scrollIntoViewIfNeeded()
  let box = (await stage.locator('canvas').boundingBox())!
  let point = { x: box.x + hit.x + hit.size / 2, y: box.y + hit.y + hit.size / 2 }
  // The poster canvas scrolls both axes; a marker can sit outside the viewport.
  const vp = this.page.viewportSize() ?? { width: 1280, height: 720 }
  if (point.x > vp.width - 20 || point.y > vp.height - 20) {
    await this.page.evaluate(
      ([sx, sy]) => {
        const stageEl = document.querySelector('[data-marker-targets]')
        const scroller = stageEl?.closest('[role="group"]')
        // On narrow viewports the overflow lives at the page level, not in the
        // poster canvas scroll box.
        const delta: ScrollToOptions = { left: sx, top: sy, behavior: 'instant' }
        if (scroller && scroller.scrollWidth > scroller.clientWidth) scroller.scrollBy(delta)
        window.scrollBy(delta)
      },
      [Math.max(0, point.x - vp.width + 60), Math.max(0, point.y - vp.height + 60)],
    )
    box = (await stage.locator('canvas').boundingBox())!
    point = { x: box.x + hit.x + hit.size / 2, y: box.y + hit.y + hit.size / 2 }
  }
  // Hover first so the highlight state activates, then click to open the dialog.
  await this.page.mouse.move(point.x, point.y)
  await this.page.waitForTimeout(100)
  await tapOrClick(this.page, point.x, point.y)
  await expect(this.page.getByRole('dialog')).toBeVisible()
}

When('I open the finder marker dialog from the top-left marker', async function (this: EditorWorld) {
  await clickMarker.call(this, 'tl')
  await expect(this.page.getByRole('dialog', { name: 'Finder marker' })).toBeVisible()
})

When('I open the sub marker dialog from the bottom-right marker', async function (this: EditorWorld) {
  await clickMarker.call(this, 'br')
  await expect(this.page.getByRole('dialog', { name: 'Sub marker' })).toBeVisible()
})

Then('the {string} option group is visible', async function (this: EditorWorld, group: string) {
  await expect(this.page.getByRole('radiogroup', { name: group })).toBeVisible()
})

When('I close the marker dialog', async function (this: EditorWorld) {
  await this.page.getByRole('button', { name: 'Close marker settings' }).click()
  await expect(this.page.getByRole('dialog')).not.toBeVisible()
})
