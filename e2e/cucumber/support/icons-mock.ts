/**
 * Mocks the icon-search proxy (`GET /api/icons`) and the SVG downloads its
 * results point to. Every query is recorded in `queries` so steps can assert
 * exactly which requests the app made. Tests never make paid calls.
 */
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 21s-6-4.5-6-10a6 6 0 0 1 12 0c0 5.5-6 10-6 10z" fill="currentColor"/></svg>'

export async function mockIconSearch(
  page: import('@playwright/test').Page,
  queries: string[],
  count = 20,
): Promise<void> {
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
