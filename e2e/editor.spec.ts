import { createHash } from 'node:crypto'
import { test, expect } from '@playwright/test'
import { mockIconSearch } from './cucumber/support/icons-mock.js'
import { openWithQr, pngFile, readDownload } from './support/editor.js'

test('SVG placement nudges and keyboard size and angle controls keep preview assets local', async ({ page }) => {
  await openWithQr(page)
  const scene = page.getByRole('img', { name: 'Poster editing preview' })
  const qr = scene.locator('image[data-qr-image]')
  const source = await qr.getAttribute('href')
  const x = Number(await qr.getAttribute('x'))
  await page.getByRole('button', { name: 'Move right', exact: true }).click()
  await expect.poll(async () => Number(await qr.getAttribute('x'))).toBeGreaterThan(x)
  await expect(qr).toHaveAttribute('href', source!)
  await page.getByRole('group', { name: /Poster\./ }).focus()
  await page.keyboard.press('-')
  await page.keyboard.press(']')
  await expect(scene).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Best position', exact: true }).click()
  await expect(scene).toBeVisible()
})

test('draft edits keep committed assets stable and Escape cancels a pointer move', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Draft and pointer lifecycle checks run once in Chromium.')
  await openWithQr(page)
  const input = page.getByLabel('URL', { exact: true })
  const scene = page.getByRole('img', { name: 'Poster editing preview' })
  const qr = scene.locator('image[data-qr-image]')
  const committedQr = await qr.getAttribute('href')

  await input.fill('https://example.com/draft-only')
  await expect(qr).toHaveAttribute('href', committedQr!)
  await input.press('Enter')
  await expect.poll(() => qr.getAttribute('href')).not.toBe(committedQr)
  const updatedQr = await qr.getAttribute('href')
  await expect(page.getByRole('radio', { name: /Blank full-canvas mask/ })).toBeChecked()

  const target = scene.locator('[data-gesture-target]')
  const originalTransform = await target.getAttribute('transform')
  const box = await qr.boundingBox()
  if (!box) throw new Error('QR preview image is not measurable')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 16, { steps: 3 })
  await expect.poll(() => target.getAttribute('transform')).not.toBe(originalTransform)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(target).toHaveAttribute('transform', originalTransform!)
  await expect(qr).toHaveAttribute('href', updatedQr!)

  const resizeHandle = scene.locator('[data-resize-handle]')
  const resizeBox = await resizeHandle.boundingBox()
  if (!resizeBox) throw new Error('QR resize handle is not measurable')
  const beforeResize = await target.getAttribute('transform')
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 28, resizeBox.y + resizeBox.height / 2 + 28, {
    steps: 3,
  })
  await page.mouse.up()
  await expect.poll(() => target.getAttribute('transform')).not.toBe(beforeResize)
  await expect(qr).toHaveAttribute('href', updatedQr!)

  const rotationHandle = scene.locator('[data-rotation-handle]')
  const rotationBox = await rotationHandle.boundingBox()
  if (!rotationBox) throw new Error('QR rotation handle is not measurable')
  const beforeRotation = await target.getAttribute('transform')
  await page.mouse.move(rotationBox.x + rotationBox.width / 2, rotationBox.y + rotationBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rotationBox.x + rotationBox.width / 2 + 48, rotationBox.y + rotationBox.height / 2 + 24, {
    steps: 3,
  })
  await page.mouse.up()
  await expect.poll(() => target.getAttribute('transform')).not.toBe(beforeRotation)
  await expect(qr).toHaveAttribute('href', updatedQr!)
})

test('finder and alignment marker settings use the native dialog and restore focus', async ({ page }) => {
  await openWithQr(page)
  const finder = page.getByRole('button', { name: 'Edit tl marker' })
  await finder.click()
  const markerDialog = page.getByRole('dialog', { name: 'Top Left finder marker' })
  await expect(markerDialog).toBeVisible()
  await expect(markerDialog.getByRole('radiogroup', { name: 'Marker shape' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(markerDialog).not.toBeVisible()
  await expect(finder).toBeFocused()

  const alignment = page.getByRole('button', { name: 'Edit sub marker' })
  await alignment.click()
  const alignmentDialog = page.getByRole('dialog', { name: 'Alignment marker' })
  await expect(alignmentDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(alignmentDialog).not.toBeVisible()
  await expect(alignment).toBeFocused()
})

test('invalid placement remains editable and assembly reports the placement failure', async ({ page }, testInfo) => {
  await openWithQr(page)
  const scene = page.getByRole('img', { name: 'Poster editing preview' })
  const qr = scene.locator('image[data-qr-image]')
  const before = await qr.getAttribute('href')
  if (testInfo.project.name === 'touch') {
    await page.getByRole('group', { name: /Poster\./ }).focus()
    for (let index = 0; index < 60; index++) await page.keyboard.press('Shift+ArrowLeft')
  } else {
    const box = await qr.boundingBox()
    if (!box) throw new Error('QR preview image is not measurable')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(8, 8, { steps: 8 })
    await page.mouse.up()
  }
  const outline = scene.locator('[data-selection-outline]')
  await expect.poll(async () => Number(await outline.getAttribute('x'))).toBeLessThan(0)
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  await expect(page.getByRole('alert', { name: 'Preview error' })).toBeVisible({ timeout: 30_000 })
  await expect(scene).toBeVisible()
  await expect(qr).toHaveAttribute('href', before!)
  await expect.poll(async () => Number(await outline.getAttribute('x'))).toBeLessThan(0)
})

test('fill controls expose their states and auto fill commits enclosed mask areas', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Mask pixel editing runs once in Chromium.')
  await openWithQr(page)
  const customInput = page.getByLabel('Choose custom mask PNG')
  await customInput.setInputFiles(await pngFile({ hole: true, name: 'hole-mask.png' }))
  await expect(page.getByText('Custom mask active: hole-mask.png')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()

  const fill = page.getByRole('button', { name: /Fill region|Filling region/ })
  await fill.click()
  await expect(fill).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(fill).toHaveAttribute('aria-pressed', 'false')

  await page.getByRole('button', { name: 'Auto fill', exact: true }).click()
  await expect(page.getByText(/Filled 1 enclosed area/)).toBeVisible({ timeout: 30_000 })
  const rim = page.getByRole('button', { name: /Add Rim|Rim added/ })
  const rimBefore = await rim.getAttribute('aria-pressed')
  await rim.click()
  await expect(rim).toHaveAttribute('aria-pressed', rimBefore === 'true' ? 'false' : 'true')
  const margin = page.getByRole('button', { name: /Add Margin|Margin added/ })
  const marginBefore = await margin.getAttribute('aria-pressed')
  await margin.click()
  await expect(margin).toHaveAttribute('aria-pressed', marginBefore === 'true' ? 'false' : 'true')
})

test('custom mask accepts a valid PNG and preserves it after rejected uploads', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Upload validation runs once in Chromium.')
  await openWithQr(page)
  const customInput = page.getByLabel('Choose custom mask PNG')
  await customInput.setInputFiles(await pngFile({ name: 'valid-mask.png' }))
  await expect(page.getByText('Custom mask active: valid-mask.png')).toBeVisible({ timeout: 15_000 })

  const panel = page.getByRole('dialog', { name: 'Mask selection' })
  const uploadError = panel.getByRole('alert')
  await customInput.setInputFiles(await pngFile({ width: 16, height: 16, name: 'wrong-size.png' }))
  await expect(uploadError).toContainText('Mask dimensions must match the poster')
  await expect(page.getByText('Custom mask active: valid-mask.png')).toBeVisible()

  await customInput.setInputFiles(await pngFile({ selected: false, name: 'empty-mask.png' }))
  await expect(uploadError).toContainText('no opaque white pixels')
  await expect(page.getByText('Custom mask active: valid-mask.png')).toBeVisible()

  await customInput.setInputFiles({ name: 'not-mask.txt', mimeType: 'text/plain', buffer: Buffer.from('not png') })
  await expect(uploadError).toContainText('Choose a PNG image')
  await expect(page.getByText('Custom mask active: valid-mask.png')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assemble poster', exact: true })).toBeEnabled()
})

test('icon search uses the local mock and selecting a result closes the gallery', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'Icon search uses one deterministic browser run.')
  const queries: string[] = []
  await mockIconSearch(page, queries)
  await openWithQr(page)
  const search = page.getByLabel('Mask text or icon search')
  await search.fill('heart')
  await page.getByRole('button', { name: 'Search icons for “heart”' }).click()
  const gallery = page.getByTestId('icon-gallery')
  await expect(gallery).toBeVisible({ timeout: 15_000 })
  await expect(gallery.getByRole('button', { name: 'Gallery icon heart-0' })).toBeVisible()
  await gallery.getByRole('button', { name: 'Gallery icon heart-0' }).click()
  await expect(gallery).not.toBeVisible()
  expect(queries).toContain('heart')
})

test('mobile disclosure and side panels are modal, exclusive, and restore focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'touch', 'Responsive dialogs are specific to the touch project.')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')

  const disclosure = page.getByRole('button', { name: 'Edit QR content' })
  await disclosure.click()
  await expect(disclosure).toHaveAttribute('aria-expanded', 'true')
  const contentInput = page.getByLabel('URL', { exact: true })
  await expect(contentInput).toBeFocused()
  await contentInput.press('Escape')
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
  await expect(disclosure).toBeFocused()

  const maskTrigger = page.getByRole('button', { name: 'Mask selection' })
  await maskTrigger.click()
  const maskDialog = page.getByRole('dialog', { name: 'Mask selection' })
  await expect(maskDialog).toBeVisible()
  await expect(maskDialog).toHaveJSProperty('open', true)
  expect(await maskDialog.evaluate((dialog) => dialog.matches(':modal'))).toBe(true)
  await expect(maskDialog.getByRole('button', { name: 'Close mask selection' })).toBeVisible()
  await maskDialog.getByRole('button', { name: 'Close mask selection' }).click()
  await expect(maskTrigger).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('dialog#mask-panel')).toHaveJSProperty('open', false)
  await expect(maskTrigger).toBeFocused()

  const settingsTrigger = page.getByRole('button', { name: 'Pattern settings' })
  await settingsTrigger.click()
  const settingsDialog = page.getByRole('dialog', { name: 'Pattern settings' })
  await expect(settingsDialog).toBeVisible()
  await expect(maskDialog).not.toBeVisible()
  await expect(settingsDialog.getByRole('slider', { name: 'Error correction' })).toBeVisible()
  await settingsDialog.getByRole('button', { name: 'Close pattern settings' }).click()
  await expect(page.locator('dialog#pattern-settings-panel')).toHaveJSProperty('open', false)
  await expect(settingsTrigger).toBeFocused()
})

test('assembly downloads the verified Blob and a digest-valid portable recipe', async ({ page }) => {
  const apiCalls: string[] = []
  page.on('request', (request) => {
    if (/\/api\/(?:prepare|assemble|render)/.test(request.url())) apiCalls.push(request.url())
  })
  await openWithQr(page, 'https://example.com/export-check')
  await page.getByRole('button', { name: 'Assemble poster', exact: true }).click()
  const resultImage = page.getByRole('img', { name: 'Assembled artistic QR poster' })
  await expect(resultImage).toBeVisible({ timeout: 30_000 })
  const imageBytes = await page.evaluate(async () => {
    const image = document.querySelector<HTMLImageElement>('img[alt="Assembled artistic QR poster"]')
    if (!image) throw new Error('Assembled poster image is missing')
    const response = await fetch(image.src)
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  })

  const [pngDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /Download PNG/ }).click(),
  ])
  const downloadedPng = await readDownload(pngDownload)
  expect(downloadedPng).toEqual(Buffer.from(imageBytes, 'base64'))
  expect(downloadedPng.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  const [svgDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /Download SVG/ }).click(),
  ])
  expect((await readDownload(svgDownload)).toString('utf8')).toContain('<svg')

  const [recipeDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: /Export recipe JSON/ }).click(),
  ])
  const recipe = JSON.parse((await readDownload(recipeDownload)).toString('utf8'))
  expect(recipe.format).toBe('mahu-qr-recipe')
  expect(recipe.content).toBe('https://example.com/export-check')
  expect(recipe.source.width).toBe(1000)
  for (const key of ['poster', 'regionMask']) {
    const asset = recipe.source[key]
    const bytes = Buffer.from(asset.data, 'base64')
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256)
  }

  await expect(page.getByRole('button', { name: 'Mask selection' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Pattern settings' })).toBeHidden()
  expect(apiCalls).toEqual([])
  await page.getByRole('button', { name: 'Return to editing' }).click()
  await expect(page.getByRole('img', { name: 'Poster editing preview' })).toBeVisible()
  await page.getByRole('button', { name: 'Move right', exact: true }).click()
  await expect(page.getByRole('img', { name: 'Assembled artistic QR poster' })).toHaveCount(0)
})
