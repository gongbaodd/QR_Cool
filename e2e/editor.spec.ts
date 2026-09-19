import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

async function uploadAndEnterAdjust(page: import('@playwright/test').Page) {
  await page.getByLabel('Poster PNG', { exact: true }).setInputFiles('source/poster.png')
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Text or URL', { exact: true })).toBeVisible()
}

test('upload, edit, assemble, download, and invalidate', async ({ page }) => {
  await page.goto('/')
  await uploadAndEnterAdjust(page)
  const size = page.getByLabel('QR size', { exact: true })
  const originalSize = Number(await size.inputValue())
  await size.fill(String(originalSize - 29))
  await size.blur()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  const x = page.getByLabel('QR X', { exact: true })
  const original = Number(await x.inputValue())
  await page.getByRole('button', { name: 'Move right', exact: true }).click()
  await expect(x).toHaveValue(String(original + 1))
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  await page.getByLabel('Zoom', { exact: true }).selectOption('2')
  await page.getByRole('group', { name: /Poster canvas/ }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(x).toHaveValue(String(original))
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Continue to generate', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeVisible()
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/assemble'))
  await page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  const body = await response.json()
  await expect(page.getByText('Artistic margins can affect scanning.', { exact: false })).toBeVisible()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download poster.png' }).click()
  const file = await downloaded
  const bytes = await readFile((await file.path())!)
  expect(bytes.equals(Buffer.from(body.artifacts['poster.png'], 'base64'))).toBe(true)
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 688, height: 566 })
  await page.getByRole('button', { name: 'Return to editing' }).click()
  await page.getByRole('button', { name: 'Back to adjust' }).click()
  await page.getByLabel('Text or URL', { exact: true }).fill('new content')
  await expect(page.getByRole('link', { name: 'Download poster.png' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  await page.getByLabel('Text or URL', { exact: true }).fill('line\nline')
  await expect(page.getByText('Use one line only.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeDisabled()
})

test('blank canvas starts an editable poster without an upload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Blank width', { exact: true })).toHaveValue('1000')
  await expect(page.getByLabel('Blank height', { exact: true })).toHaveValue('1000')
  await page.getByLabel('Blank width', { exact: true }).fill('800')
  await page.getByRole('button', { name: 'Use blank canvas', exact: true }).click()
  await expect(page.getByText('blank-poster.png')).toBeVisible()
  await expect(page.getByText('Mask: blank-mask.png')).toBeVisible()
  await expect(page.getByText('800 × 1000')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Text or URL', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
})

test('text mask draws the region from a display font word', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Use blank canvas', exact: true }).click()
  await expect(page.getByText('Mask: blank-mask.png')).toBeVisible()
  await page.getByLabel('Mask text', { exact: true }).fill('QR')
  const bright = await page.getByLabel('Mask text preview').evaluate(node => {
    const canvas = node as HTMLCanvasElement
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 128) count++
    return count
  })
  expect(bright).toBeGreaterThan(100)
  await page.getByLabel('Mask text size', { exact: true }).fill('400')
  await page.getByRole('button', { name: 'Use text as mask', exact: true }).click()
  await expect(page.getByText('Mask: text-mask.png')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
})

test('text mask defaults to full height and warns on words too small for the QR', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Use blank canvas', exact: true }).click()
  await expect(page.getByText('Mask: blank-mask.png')).toBeVisible()
  await expect(page.getByLabel('Mask text size', { exact: true })).toHaveValue('1000')
  await page.getByRole('button', { name: 'Use text as mask', exact: true }).click()
  await expect(page.getByText('Mask: text-mask.png')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
  await page.getByLabel('Mask text', { exact: true }).fill('EXTRAORDINARY')
  await expect(page.getByText('even at full height')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use text as mask', exact: true })).toBeDisabled()
})

test('blank canvas starts an editable poster without an upload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Use blank canvas', exact: true }).click()
  await expect(page.getByText('blank-poster.png')).toBeVisible()
  await page.getByText('Adjust region selection', { exact: true }).click()
  await expect(page.getByText('Mask: blank-mask.png')).toBeVisible()
  await expect(page.getByText('1000 × 1000')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
})

test('text mask draws the region from a display font word', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Use blank canvas', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await page.getByText('Adjust region selection', { exact: true }).click()
  await page.getByLabel('Mask text', { exact: true }).fill('QR')
  const bright = await page.getByLabel('Mask text preview').evaluate(node => {
    const canvas = node as HTMLCanvasElement
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 128) count++
    return count
  })
  expect(bright).toBeGreaterThan(100)
  await page.getByLabel('Mask text size', { exact: true }).fill('400')
  await page.getByRole('button', { name: 'Use text as mask', exact: true }).click()
  await expect(page.getByText('Mask: text-mask.png')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
})

test('text mask defaults to full height and warns on words too small for the QR', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Use blank canvas', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await page.getByText('Adjust region selection', { exact: true }).click()
  await expect(page.getByLabel('Mask text size', { exact: true })).toHaveValue('1000')
  await page.getByRole('button', { name: 'Use text as mask', exact: true }).click()
  await expect(page.getByText('Mask: text-mask.png')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await page.getByLabel('Mask text', { exact: true }).fill('EXTRAORDINARY')
  await expect(page.getByText('even at full height')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use text as mask', exact: true })).toBeDisabled()
})

test('invalid placement retains inputs and reset recovers', async ({ page }) => {
  await page.goto('/')
  await uploadAndEnterAdjust(page)
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  await page.getByLabel('QR X', { exact: true }).fill('0')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Text or URL', { exact: true })).toHaveValue('https://example.com')
  await page.getByRole('button', { name: 'Reset to automatic placement' }).click()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
})

test('pointer coordinates and corner resizing follow the zoom transform', async ({ page }, info) => {
  await page.goto('/')
  await uploadAndEnterAdjust(page)
  const next = page.getByRole('button', { name: 'Continue to generate', exact: true })
  await expect(next).toBeEnabled()
  const size = page.getByLabel('QR size', { exact: true })
  await size.fill('203')
  await expect(next).toBeEnabled()
  for (const zoom of ['0.5', '1']) {
    await page.getByLabel('Zoom', { exact: true }).selectOption(zoom)
    const canvas = page.getByRole('group', { name: /Poster canvas/ }).locator('canvas')
    await canvas.scrollIntoViewIfNeeded()
    const bounds = (await canvas.boundingBox())!
    const scale = bounds.width / 688
    const x = Number(await page.getByLabel('QR X', { exact: true }).inputValue())
    const y = Number(await page.getByLabel('QR Y', { exact: true }).inputValue())
    const qrSize = Number(await size.inputValue())
    const startX = Math.round(bounds.x + (x + qrSize / 2) * scale), startY = Math.round(bounds.y + (y + qrSize / 2) * scale)
    const dx = Math.round(6 * scale), dy = Math.round(4 * scale)
    const movedX = x + Math.round(dx / scale), movedY = y + Math.round(dy / scale)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dx, startY + dy, { steps: 8 })
    await page.mouse.up()
    await expect(page.getByLabel('QR X', { exact: true })).toHaveValue(String(movedX))
    await expect(page.getByLabel('QR Y', { exact: true })).toHaveValue(String(movedY))
    await expect(next).toBeEnabled()
    const cornerX = bounds.x + (movedX + qrSize) * scale, cornerY = bounds.y + (movedY + qrSize) * scale
    await page.mouse.move(cornerX, cornerY)
    await page.mouse.down()
    await page.mouse.move(cornerX - 29 * scale, cornerY - 29 * scale, { steps: 8 })
    await page.mouse.up()
    await expect(size).toHaveValue(String(qrSize - 29))
    await expect(next).toBeEnabled()
  }
  await page.screenshot({ path: info.outputPath('editor.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
