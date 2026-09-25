import { expect, type Page } from '@playwright/test'
import sharp from 'sharp'

export async function selectBlankMask(page: Page) {
  const blank = page.getByRole('radio', { name: /Blank full-canvas mask/ })
  if (!(await blank.isVisible())) {
    await page.getByRole('button', { name: 'Mask selection' }).click()
    await expect(page.getByRole('dialog', { name: 'Mask selection' })).toBeVisible()
  }
  await blank.click()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  if ((page.viewportSize()?.width ?? 0) <= 900) {
    await page.getByRole('button', { name: 'Close mask selection' }).click()
    await expect(page.locator('dialog#mask-panel')).toHaveJSProperty('open', false)
  } else {
    await page.keyboard.press('Escape')
  }
}

export async function openWithQr(page: Page, content = 'https://example.com/qr') {
  await page.goto('/')
  const mobileDisclosure = page.getByRole('button', { name: 'Edit QR content' })
  if (await mobileDisclosure.isVisible()) {
    await mobileDisclosure.click()
    await expect(mobileDisclosure).toHaveAttribute('aria-expanded', 'true')
  }
  const input = page.getByLabel('URL', { exact: true })
  await expect(input).toBeVisible()
  await input.fill(content)
  await input.press('Enter')
  if ((page.viewportSize()?.width ?? 0) <= 900 && (await mobileDisclosure.getAttribute('aria-expanded')) === 'true') {
    await page.keyboard.press('Escape')
    await expect(mobileDisclosure).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#mobile-content-form')).toHaveJSProperty('inert', true)
  }
  await expect(page.getByRole('img', { name: 'Poster editing preview' })).toBeVisible({ timeout: 30_000 })
  await selectBlankMask(page)
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
}

export async function pngFile(
  options: { width?: number; height?: number; hole?: boolean; selected?: boolean; name?: string } = {},
) {
  const width = options.width ?? 1000
  const height = options.height ?? 1000
  const selected = options.selected ?? true
  const data = Buffer.alloc(width * height * 4)
  if (selected) {
    for (let offset = 0; offset < data.length; offset += 4) {
      data[offset] = 255
      data[offset + 1] = 255
      data[offset + 2] = 255
      data[offset + 3] = 255
    }
  }
  if (options.hole) {
    for (let y = 440; y < 560; y++) {
      for (let x = 440; x < 560; x++) {
        const offset = (y * width + x) * 4
        data[offset] = 0
        data[offset + 1] = 0
        data[offset + 2] = 0
        data[offset + 3] = 255
      }
    }
  }
  const buffer = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  return { name: options.name ?? 'e2e-mask.png', mimeType: 'image/png', buffer }
}

export async function readDownload(download: import('@playwright/test').Download) {
  const stream = await download.createReadStream()
  if (!stream) throw new Error(`Could not read download ${download.suggestedFilename()}`)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
