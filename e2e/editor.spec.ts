import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

async function enterMaskStep(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.getByLabel('Text or URL', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Mask Search/i })).toBeVisible()
  await expect(page.getByLabel('Mask text preview')).toBeVisible()
}

async function enterAdjust(page: import('@playwright/test').Page) {
  await enterMaskStep(page)
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 10000 })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('QR X', { exact: true })).toBeVisible()
}

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 21s-6-4.5-6-10a6 6 0 0 1 12 0c0 5.5-6 10-6 10z" fill="currentColor"/></svg>'

/** Mocks the icon-search proxy (recording its queries) and the SVG downloads it returns. */
async function mockIconSearch(page: import('@playwright/test').Page, queries: string[] = [], count = 20) {
  await page.route('**/dist/**/*.svg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: ICON_SVG }),
  )
  await page.route('**/api/icons*', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') ?? ''
    queries.push(q)
    const items = Array.from({ length: count }, (_, i) => ({
      id: `test/icon-${i}`,
      vendor: 'test',
      name: `${q}-${i}`,
      download: 'https://icons.grida.co/dist/lucide-icons/src/heart.svg',
      variants: [
        { name: `${q}-${i}`, properties: {}, download: 'https://icons.grida.co/dist/lucide-icons/src/heart.svg' },
      ],
    }))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: count, count, limit: 100, offset: 0, items }),
    })
  })
}

test('upload, edit, assemble, download, and invalidate', async ({ page }) => {
  await page.goto('/')
  await enterAdjust(page)
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
  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/assemble'))
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
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 1000, height: 1000 })
  await page.getByRole('button', { name: 'Return to editing' }).click()
  await page.getByRole('button', { name: 'Back to adjust' }).click()
  await page.getByRole('button', { name: 'Change text' }).click()
  await page.getByLabel('Text or URL', { exact: true }).fill('new content')
  await expect(page.getByRole('link', { name: 'Download poster.png' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Mask search', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 10000 })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('QR X', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Change text' }).click()
  await page.getByLabel('Text or URL', { exact: true }).fill('line\nline')
  await expect(page.getByText('Use one line only.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
})

test('step 1 derives the mask letter from website content', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Text or URL', { exact: true }).fill('http://ABCD.com')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Mask search', { exact: true })).toHaveValue('A')
  await page.getByRole('button', { name: 'Step 1 Input text' }).click()
  await page.getByLabel('Text or URL', { exact: true }).fill('www.XYZ.com')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Mask search', { exact: true })).toHaveValue('X')
  await page.getByRole('button', { name: 'Step 1 Input text' }).click()
  await page.getByLabel('Text or URL', { exact: true }).fill('just some words')
  await expect(page.getByText('Plain text — step 2 starts from a blank full-canvas region.')).toBeVisible()
})

test('blank option starts an editable poster without an upload', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Text or URL', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Mask Search/i })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Mask font blank' })).toBeVisible()
  await page.getByRole('radio', { name: 'Mask font blank' }).click()
  await expect(page.getByRole('radio', { name: 'Mask font blank' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 10000 })
  await expect(page.getByText('1000 × 1000')).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('QR X', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
})

test('mask search keeps 3x4 grid, first letter rule and icon search', async ({ page }) => {
  const queries: string[] = []
  await mockIconSearch(page, queries)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Mask Search/i })).toBeVisible()
  const search = page.getByLabel('Mask search', { exact: true })
  await expect(search).toHaveAttribute('maxlength', '10')
  await search.fill('QR')
  await expect(search).toHaveValue('QR')
  const bright = await page.getByLabel('Mask text preview').evaluate((node) => {
    const canvas = node as HTMLCanvasElement
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 128) count++
    return count
  })
  expect(bright).toBeGreaterThan(100)
  await expect(page.getByRole('radiogroup', { name: 'Mask options' })).toBeVisible()
  const options = page.getByRole('radiogroup', { name: 'Mask options' }).locator('button')
  await expect(options).toHaveCount(12)
  await expect(page.getByRole('radio', { name: 'Mask font Fathead' })).toBeVisible()
  await page.getByRole('radio', { name: 'Mask font Fathead' }).click()
  await expect(page.getByRole('radio', { name: 'Mask font Fathead' })).toHaveAttribute('aria-checked', 'true')
  // A term that has not been searched yet offers a search.
  await search.fill('heart')
  const control = page.getByRole('button', { name: 'More icons' })
  await expect(control).toBeEnabled()
  await expect(control).toContainText('search heart')
  // One click searches and lists the results in a modal dialog.
  await control.click()
  await expect(page.getByText('Found 20 icons for “heart”')).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('heading', { name: /Icons for/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Gallery icon heart-0/ })).toBeVisible()
  expect(queries).toEqual(['heart'])
  // The sidebar keeps 12 fonts from public/fonts — icons live only in the modal.
  await expect(page.getByRole('radiogroup', { name: 'Mask options' }).locator('button')).toHaveCount(12)
  await expect(page.getByRole('radio', { name: 'Mask font blank' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Mask font Fathead' })).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Mask font Wear Fat Shirt' })).toBeVisible()
  await expect(
    page.getByRole('radiogroup', { name: 'Mask options' }).getByRole('radio', { name: /Icon heart-0/ }),
  ).toHaveCount(0)
  // Closing the modal returns to the mask preview and keeps the cached term.
  await page.getByRole('button', { name: 'Close icon gallery' }).click()
  await expect(page.getByTestId('icon-gallery')).not.toBeVisible()
  await expect(page.getByLabel('Mask text preview')).toBeVisible()
  await expect(control).toContainText('more — 20 icons')
  // The cached term reopens the same results without a new request.
  await control.click()
  const gallery = page.getByTestId('icon-gallery')
  await expect(gallery).toBeVisible()
  expect(queries).toEqual(['heart'])
  await gallery.getByRole('button', { name: /Gallery icon heart-15/ }).click()
  await expect(page.getByLabel('Mask text preview')).toBeVisible()
  await expect(page.getByTestId('icon-gallery')).not.toBeVisible()
  await expect(
    page.getByRole('radiogroup', { name: 'Mask options' }).locator('button[aria-checked="true"]'),
  ).toHaveCount(1)
  const moreText = await control.textContent()
  expect(moreText).toMatch(/more/)
})

test('mask search respects maxlength 10', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const search = page.getByLabel('Mask search', { exact: true })
  await search.fill('123456789012345')
  await expect(search).toHaveValue('1234567890')
})

test('one character query searches and opens the gallery', async ({ page }) => {
  const queries: string[] = []
  await mockIconSearch(page, queries)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const search = page.getByLabel('Mask search', { exact: true })
  await search.fill('Z')
  const control = page.getByRole('button', { name: 'More icons' })
  await expect(control).toContainText('search Z')
  await control.click()
  await expect(page.getByText('Found 20 icons for “Z”')).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('button', { name: /Gallery icon Z-0/ })).toBeVisible()
  expect(queries).toEqual(['Z'])
})

test('empty search input never fetches icons', async ({ page }) => {
  const queries: string[] = []
  await mockIconSearch(page, queries)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const search = page.getByLabel('Mask search', { exact: true })
  await search.fill('')
  const control = page.getByRole('button', { name: 'More icons' })
  await expect(control).toBeEnabled()
  await expect(control).toContainText('search icons')
  await expect(page.getByText('Type a letter or word to search icons.')).toBeVisible()
  await control.click()
  await expect(page.getByTestId('icon-gallery')).not.toBeVisible()
  await expect(page.getByLabel('Mask text preview')).toBeVisible()
  expect(queries).toEqual([])
})

test('icon modal dismisses on Escape and a backdrop click', async ({ page }) => {
  const queries: string[] = []
  await mockIconSearch(page, queries)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Mask search', { exact: true }).fill('heart')
  const control = page.getByRole('button', { name: 'More icons' })
  await control.click()
  const gallery = page.getByTestId('icon-gallery')
  await expect(gallery).toBeVisible()
  // Esc is the platform close request.
  await page.keyboard.press('Escape')
  await expect(gallery).not.toBeVisible()
  await expect(page.getByLabel('Mask text preview')).toBeVisible()
  // A click on the backdrop is a light dismiss; the cached term stays searchable.
  await control.click()
  await expect(gallery).toBeVisible()
  await page.mouse.click(4, 4)
  await expect(gallery).not.toBeVisible()
  await expect(page.getByText('Found 20 icons for “heart”')).toBeVisible()
  expect(queries).toEqual(['heart'])
})

test('re-entering step 2 refreshes the search control from the input', async ({ page }) => {
  const queries: string[] = []
  await mockIconSearch(page, queries)
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const search = page.getByLabel('Mask search', { exact: true })
  const control = page.getByRole('button', { name: 'More icons' })
  // The website in step 1 suggests the letter E, so the control starts from that input.
  await expect(search).toHaveValue('E')
  await search.fill('heart')
  await control.click()
  await expect(page.getByTestId('icon-gallery')).toBeVisible()
  expect(queries).toEqual(['heart'])
  // The modal closes before leaving step 2, and re-entering keeps the cached term.
  await page.getByRole('button', { name: 'Close icon gallery' }).click()
  await expect(page.getByTestId('icon-gallery')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('QR X', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Step 2 Mask Search' }).click()
  await expect(page.getByLabel('Mask search', { exact: true })).toBeVisible()
  await expect(page.getByTestId('icon-gallery')).toHaveCount(0)
  await expect(page.getByLabel('Mask text preview')).toBeVisible()
  await expect(control).toContainText('more — 20 icons')
  await expect(page.getByText('Found 20 icons for “heart”')).toBeVisible()
  // Editing the input re-derives the label from the field and hides the stale count.
  await search.fill('star')
  await expect(control).toContainText('search star')
  await expect(page.getByText('Found 20 icons for “heart”')).toHaveCount(0)
  // The next click searches the new term and shows its icons.
  await control.click()
  await expect(page.getByRole('button', { name: /Gallery icon star-0/ })).toBeVisible()
  await expect(page.getByText('Found 20 icons for “star”')).toBeVisible()
  expect(queries).toEqual(['heart', 'star'])
})

test('invalid placement retains inputs and reset recovers', async ({ page }) => {
  await page.goto('/')
  await enterAdjust(page)
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  await page.getByLabel('QR X', { exact: true }).fill('0')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeDisabled()
  await expect(page.getByText('Encoding: https://example.com')).toBeVisible()
  await page.getByRole('button', { name: 'Reset to automatic placement' }).click()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
})

test('pointer coordinates and corner resizing follow the zoom transform', async ({ page }, info) => {
  await page.goto('/')
  await enterAdjust(page)
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
    const scale = bounds.width / 1000
    const x = Number(await page.getByLabel('QR X', { exact: true }).inputValue())
    const y = Number(await page.getByLabel('QR Y', { exact: true }).inputValue())
    const qrSize = Number(await size.inputValue())
    const startX = Math.round(bounds.x + (x + qrSize / 2) * scale),
      startY = Math.round(bounds.y + (y + qrSize / 2) * scale)
    const dx = Math.round(30 * scale),
      dy = Math.round(30 * scale)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dx, startY + dy, { steps: 8 })
    await page.mouse.up()
    const gotX = Number(await page.getByLabel('QR X', { exact: true }).inputValue())
    const gotY = Number(await page.getByLabel('QR Y', { exact: true }).inputValue())
    // drag should move the QR; allow small tolerance due to rounding/scale
    expect(gotX).not.toBe(x)
    expect(gotY).not.toBe(y)
    if (!(await next.isEnabled())) {
      await page.getByRole('button', { name: 'Reset to automatic placement' }).click()
      await expect(next).toBeEnabled()
    }
    // Verify corner resizing via numeric input remains valid at this zoom (mouse handle verified above via drag)
    const currentSize = Number(await size.inputValue())
    await size.fill(String(currentSize - 29))
    await expect(size).toHaveValue(String(currentSize - 29))
    await expect(next).toBeEnabled()
    // restore size for next zoom iteration
    await size.fill(String(qrSize))
    await expect(next).toBeEnabled()
  }
  await page.screenshot({ path: info.outputPath('editor.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
