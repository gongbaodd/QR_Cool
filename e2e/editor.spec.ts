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
  await expect(page.getByRole('heading', { name: /Adjust QR/i })).toBeVisible()
  await expect(page.getByRole('group', { name: /Poster canvas/ })).toBeVisible()
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

test('edit, assemble, download, and invalidate', async ({ page }) => {
  await page.goto('/')
  await enterAdjust(page)
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  // nudge controls move the QR without needing numeric inputs
  await page.getByRole('button', { name: 'Move right', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  // keyboard arrow moves via canvas focus
  await page.getByRole('group', { name: /Poster canvas/ }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  // pattern settings are reachable in step 3 and keep the step valid
  await expect(page.getByText('Pattern settings', { exact: true })).toBeVisible()
  await page.getByRole('radiogroup', { name: 'Pixel style', exact: true }).getByText('Dot', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled({ timeout: 15000 })
  // ecc change may enlarge the QR but keeps the step reachable; revert to M for stable assemble
  await page.getByRole('radiogroup', { name: 'Error correction level' }).getByText('H', { exact: true }).click()
  await expect(page.getByLabel('H High ~30%')).toBeChecked()
  await page.getByRole('radiogroup', { name: 'Error correction level' }).getByText('M', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled({ timeout: 15000 })
  await page.getByRole('button', { name: 'Continue to generate', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeVisible()
  // The pipeline must run entirely in the worker; the render API no longer exists.
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (/\/api\/(prepare|assemble)/.test(request.url())) apiCalls.push(request.url())
  })
  await page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  await expect(page.getByText('Artistic margins can affect scanning.', { exact: false })).toBeVisible()
  // Preview and download must share one object URL of the assembled Blob (no re-encode).
  expect(
    await page.evaluate(() => {
      const image = document.querySelector<HTMLImageElement>('img[alt="Assembled artistic QR poster"]')
      const link = document.querySelector<HTMLAnchorElement>('a[download="poster.png"]')
      return !!image && !!link && image.src === link.href
    }),
  ).toBe(true)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download poster.png' }).click()
  const file = await downloaded
  const bytes = await readFile((await file.path())!)
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 1000, height: 1000 })
  await page.getByRole('button', { name: 'Return to editing' }).click()
  await page.getByRole('button', { name: 'Back to adjust' }).click()
  await page.getByRole('button', { name: 'Step 1 Input text' }).click()
  await page.getByLabel('Text or URL', { exact: true }).fill('new content')
  await expect(page.getByRole('link', { name: 'Download poster.png' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Mask search', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled({ timeout: 10000 })
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Adjust QR/i })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Step 1 Input text' }).click()
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

test('step 1 example buttons populate the input', async ({ page }) => {
  await page.goto('/')
  const input = page.getByLabel('Text or URL', { exact: true })
  await page.getByRole('button', { name: 'Use example Hello' }).click()
  await expect(input).toHaveValue('Hello QR / COOL')
  await page.getByRole('button', { name: 'Use example Website' }).click()
  await expect(input).toHaveValue('https://example.com')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByLabel('Mask search', { exact: true })).toHaveValue('E')
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
  await expect(page.getByRole('heading', { name: /Adjust QR/i })).toBeVisible()
  await expect(page.getByRole('group', { name: /Poster canvas/ })).toBeVisible()
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
  await expect(page.getByTestId('icon-gallery')).not.toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: /Adjust QR/i })).toBeVisible()
  await page.getByRole('button', { name: 'Step 2 Mask Search' }).click()
  await expect(page.getByLabel('Mask search', { exact: true })).toBeVisible()
  await expect(page.getByTestId('icon-gallery')).not.toBeVisible()
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

test('fill tool toggles and can be dismissed', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  const fill = page.getByRole('button', { name: 'Fill region' })
  await expect(fill).toBeVisible()
  // blank canvas fill is disabled until a letter mask is chosen
  await expect(page.getByRole('radio', { name: 'Mask font blank' })).toHaveAttribute('aria-checked', 'true')
  await expect(fill).toBeDisabled()
  await page.getByRole('radio', { name: 'Mask font Fathead' }).click()
  await expect(fill).toBeEnabled()
  await expect(fill).toHaveAttribute('aria-pressed', 'false')
  await fill.click()
  await expect(fill).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('Click inside an enclosed area to fill it.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(fill).toHaveAttribute('aria-pressed', 'false')
})

/** Tap on touch devices (hasTouch), click elsewhere; Konva handles both. */
async function tapOrClick(page: import('@playwright/test').Page, x: number, y: number) {
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

function isPointOffscreen(page: import('@playwright/test').Page, x: number, y: number) {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 }
  return x < 0 || y < 0 || x + 20 > vp.width || y + 20 > vp.height
}

/** Scroll so that a canvas-relative point becomes visible (the poster canvas forces page-level overflow on narrow viewports). */
async function scrollCanvasToPoint(page: import('@playwright/test').Page, x: number, y: number) {
  const vp = page.viewportSize() ?? { width: 1280, height: 720 }
  const dx = Math.max(0, Math.floor(x - vp.width + 60))
  const dy = Math.max(0, Math.floor(y - vp.height + 60))
  if (dx === 0 && dy === 0) return
  await page.evaluate(
    ([sx, sy]) => {
      const stageEl = document.querySelector('[data-marker-targets]')
      const scroller = stageEl?.closest('[role="group"]')
      // On narrow viewports the overflow lives at the page level, not in the
      // poster canvas scroll box.
      if (scroller && scroller.scrollWidth > scroller.clientWidth) scroller.scrollBy({ left: sx, top: sy })
      window.scrollBy({ left: sx, top: sy })
    },
    [dx, dy] as unknown as [number, number],
  )
}

/** Tap/click a marker rect (dataset coords) wherever it currently is. */
async function tapMarker(page: import('@playwright/test').Page, rect: { x: number; y: number; size: number }) {
  // Cross-platform design choice: reopen in case the bounding box changed.
  const stageEl = page.locator('[data-marker-targets]').first()
  let box = (await stageEl.locator('canvas').boundingBox())!
  let point = { x: box.x + rect.x + rect.size / 2, y: box.y + rect.y + rect.size / 2 }
  if (isPointOffscreen(page, point.x, point.y)) {
    await scrollCanvasToPoint(page, point.x, point.y)
    box = (await stageEl.locator('canvas').boundingBox())!
    point = { x: box.x + rect.x + rect.size / 2, y: box.y + rect.y + rect.size / 2 }
  }
  await tapOrClick(page, point.x, point.y)
}

test('marker dialogs open from the canvas and expose marker options', async ({ page }) => {
  await page.goto('/')
  await enterAdjust(page)
  await expect(page.getByText('Pattern settings', { exact: true })).toBeVisible()
  // ecc stays in Pattern Settings
  await expect(page.getByRole('radiogroup', { name: 'Error correction level' })).toBeVisible()
  // pixel style stays in Pattern Settings
  await expect(page.getByRole('radiogroup', { name: 'Pixel style', exact: true })).toBeVisible()
  await page.getByRole('radiogroup', { name: 'Pixel style', exact: true }).getByText('Dot', { exact: true }).click()
  // the marker controls moved out of Pattern Settings into marker dialogs
  await expect(page.getByRole('radiogroup', { name: 'Marker shape' })).toHaveCount(0)
  // Open the finder dialog by hovering and clicking the top-left marker.
  const stageContainer = page.locator('[data-marker-targets]').first()
  await stageContainer.waitFor()
  await stageContainer.scrollIntoViewIfNeeded()
  const rects = JSON.parse((await stageContainer.getAttribute('data-marker-targets'))!) as Record<
    string,
    { id: string; x: number; y: number; size: number }
  >[]
  await tapMarker(page, rects.find((rect) => rect.id === 'tl')!)
  const finderDialog = page.getByRole('dialog', { name: 'Finder marker' })
  await expect(finderDialog).toBeVisible()
  // the same accessible radiogroups now live inside the dialog
  await page.getByRole('radiogroup', { name: 'Marker shape' }).locator('label').filter({ hasText: 'Octagon' }).click()
  await expect(page.getByLabel('octagon Octagon')).toBeChecked()
  await page.getByRole('radiogroup', { name: 'Marker inner' }).locator('label').filter({ hasText: 'Plus' }).click()
  await expect(page.getByLabel('plus Plus')).toBeChecked()
  await page.getByRole('button', { name: 'Close marker settings' }).click()
  await expect(finderDialog).not.toBeVisible()
  // The bottom-right alignment marker opens the sub marker dialog.
  await tapMarker(page, rects.find((rect) => rect.id === 'br')!)
  const subDialog = page.getByRole('dialog', { name: 'Sub marker' })
  await expect(subDialog).toBeVisible()
  const subMarker = page.getByRole('radiogroup', { name: 'Sub marker' })
  await subMarker.locator('label').filter({ hasText: 'Round' }).first().click()
  await expect(subMarker.getByLabel('circle Circle')).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(subDialog).not.toBeVisible()
  // rim and seed behavior is unchanged in Pattern Settings
  const rim = page.getByLabel('Add Rim (1 module)')
  await expect(rim).toBeVisible()
  const seed = page.getByLabel('Seed', { exact: true })
  const before = await seed.inputValue()
  await page.getByRole('button', { name: 'New pattern' }).click()
  await expect(seed).not.toHaveValue(before)
  await rim.click()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled({ timeout: 10000 })
  await rim.click()
  await expect(page.getByRole('button', { name: 'Continue to generate', exact: true })).toBeEnabled({ timeout: 10000 })
})

test('canvas nudges and keyboard move the QR', async ({ page }, info) => {
  await page.goto('/')
  await enterAdjust(page)
  const next = page.getByRole('button', { name: 'Continue to generate', exact: true })
  await expect(next).toBeEnabled()
  // show region toggle exists
  const showRegion = page.getByLabel('Show region')
  await expect(showRegion).toBeVisible()
  await showRegion.click()
  await expect(showRegion).not.toBeChecked()
  await showRegion.click()
  await expect(showRegion).toBeChecked()
  // nudge buttons
  for (const label of ['Move left', 'Move up', 'Move down', 'Move right'] as const) {
    await expect(page.getByRole('button', { name: label })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Move right' }).click()
  await expect(next).toBeEnabled()
  await page.getByRole('button', { name: 'Move left' }).click()
  await expect(next).toBeEnabled()
  // keyboard arrows on the canvas group
  const canvas = page.getByRole('group', { name: /Poster canvas/ })
  await canvas.focus()
  await page.keyboard.press('ArrowRight')
  await expect(next).toBeEnabled()
  await page.keyboard.press('ArrowLeft')
  await expect(next).toBeEnabled()
  await page.keyboard.press('ArrowUp')
  await expect(next).toBeEnabled()
  await page.keyboard.press('ArrowDown')
  await expect(next).toBeEnabled()
  // drag via mouse on the stage canvas
  const stageCanvas = page
    .getByRole('group', { name: /Poster canvas/ })
    .locator('canvas')
    .first()
  await stageCanvas.scrollIntoViewIfNeeded()
  const box = (await stageCanvas.boundingBox())!
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 20, center.y + 20, { steps: 6 })
  await page.mouse.up()
  // The QR only fits the region in its placed spot, so dragging it away is
  // reported and dragging it back restores a valid fit.
  await expect(page.getByRole('alert')).toBeVisible()
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x - 20, center.y - 20, { steps: 6 })
  await page.mouse.up()
  await expect(next).toBeEnabled({ timeout: 15000 })
  await page.screenshot({ path: info.outputPath('editor.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
