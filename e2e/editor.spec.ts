import { test, expect } from '@playwright/test'

async function selectBlankMask(page: import('@playwright/test').Page) {
  const blank = page.getByRole('radio', { name: /Blank full-canvas mask/ })
  if (!(await blank.isVisible())) await page.getByRole('button', { name: 'Mask', exact: true }).click()
  await blank.click()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
}

async function openWithQr(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.waitForTimeout(1_000) // Wait for the production bundle to hydrate controlled inputs.
  await page.getByLabel('Text or URL', { exact: true }).fill('https://example.com/qr')
  await expect(page.getByRole('img', { name: 'Poster editing preview' })).toBeVisible({ timeout: 30_000 })
  await selectBlankMask(page)
  await expect(page.getByText('Assemble to check placement and render the final poster.')).toBeVisible()
}

test('SVG preview keeps placement edits local and exposes keyboard size and angle controls', async ({ page }) => {
  await openWithQr(page)
  const scene = page.getByRole('img', { name: 'Poster editing preview' })
  const qr = scene.locator('image[data-qr-image]')
  const source = await qr.getAttribute('href')
  const x = Number(await qr.getAttribute('x'))
  await page.getByRole('button', { name: 'Move right', exact: true }).click()
  await expect.poll(async () => Number(await qr.getAttribute('x'))).toBeGreaterThan(x)
  expect(await qr.getAttribute('href')).toBe(source)
  await page.getByRole('group', { name: /Poster\./ }).focus()
  await page.keyboard.press('-')
  await page.keyboard.press(']')
  await expect(scene).toBeVisible()
  await expect(page.getByText('Assemble to check placement and render the final poster.')).toBeVisible()
})

test('SVG marker targets open the native marker dialog', async ({ page }) => {
  await openWithQr(page)
  await page.getByRole('button', { name: 'Edit tl marker' }).click()
  const markerDialog = page.getByRole('dialog', { name: 'TL finder marker' })
  await expect(markerDialog).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Marker shape' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(markerDialog).not.toBeVisible()
})

test('invalid placement stays editable and assembly reports the exact failure', async ({ page }, testInfo) => {
  await openWithQr(page)
  const scene = page.getByRole('img', { name: 'Poster editing preview' })
  const qr = scene.locator('image[data-qr-image]')
  const before = await qr.getAttribute('href')
  if (testInfo.project.name === 'touch') {
    await page.getByRole('group', { name: /Poster\./ }).focus()
    for (let index = 0; index < 25; index++) await page.keyboard.press('Shift+ArrowLeft')
  } else {
    const box = await qr.boundingBox()
    if (!box) throw new Error('QR preview image is not measurable')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(8, 8, { steps: 8 })
    await page.mouse.up()
  }
  await expect.poll(async () => Number(await scene.locator('[data-selection-outline]').getAttribute('x'))).toBeLessThan(0)
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 })
  await expect(scene).toBeVisible()
  expect(await qr.getAttribute('href')).toBe(before)
  await expect.poll(async () => Number(await scene.locator('[data-selection-outline]').getAttribute('x'))).toBeLessThan(0)
})

test('assembly returns one verified Blob for preview and download', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(1_000)
  await page.getByLabel('Text or URL', { exact: true }).fill('A')
  await expect(page.getByRole('img', { name: 'Poster editing preview' })).toBeVisible({ timeout: 30_000 })
  await selectBlankMask(page)
  await page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Assembled artistic QR poster' })).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => {
    const image = document.querySelector<HTMLImageElement>('img[alt="Assembled artistic QR poster"]')
    const link = document.querySelector<HTMLAnchorElement>('a[download="poster.png"]')
    return !!image && !!link && image.src === link.href && image.src.startsWith('blob:')
  })).toBe(true)
  await page.getByRole('button', { name: 'Return to editing' }).click()
  await expect(page.getByRole('img', { name: 'Poster editing preview' })).toBeVisible()
})
