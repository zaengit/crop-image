import { test, expect } from '@playwright/test'

const TEST_IMAGE = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#dbeafe"/>
  <rect x="80" y="70" width="480" height="340" rx="36" fill="#ffffff"/>
  <circle cx="320" cy="210" r="90" fill="#60a5fa"/>
  <rect x="250" y="300" width="140" height="70" rx="30" fill="#2563eb"/>
</svg>
`)

const PORTRAIT_URL = 'https://gitlab.com/scikit-image/data/-/raw/master/astronaut.png'

test('upload, focus change, and manual generate work in production build', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => {
    browserErrors.push(error.message)
    console.error(`PAGEERROR: ${error.stack ?? error.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`BROWSER CONSOLE: ${message.text()}`)
  })

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('http://127.0.0.1:4173/crop-image/')

  try {
    await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true', { timeout: 10_000 })
  } catch (error) {
    throw new Error(`App did not initialize. Browser errors: ${browserErrors.join(' | ') || 'none captured'}\n${error instanceof Error ? error.message : String(error)}`)
  }

  await page.locator('#file').setInputFiles({
    name: 'smoke.svg',
    mimeType: 'image/svg+xml',
    buffer: TEST_IMAGE,
  })

  await expect(page.locator('#status')).toContainText('Ready — adjust the focal point', { timeout: 30_000 })
  await expect(page.locator('#focus-editor')).toBeVisible()
  await expect(page.locator('#focus-stage')).toBeVisible()
  await expect(page.locator('#grid .card')).toHaveCount(0)

  const stage = page.locator('#focus-stage')
  const box = await stage.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(100)
  expect(box?.height ?? 0).toBeGreaterThan(100)
  await stage.click({ position: { x: 80, y: 80 } })

  await expect(page.locator('#status')).toContainText('click Generate crop', { timeout: 5_000 })
  await expect(page.locator('#grid .card')).toHaveCount(0)

  await page.locator('[data-menu="custom"]').click()
  await page.locator('#custom-width').fill('64')
  await page.locator('#custom-height').fill('64')
  await page.locator('#custom-form button[type="submit"]').click()

  await expect(page.locator('#grid .card')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('#status')).toContainText('Done', { timeout: 10_000 })
  expect(browserErrors).toEqual([])
})

test('auto focus targets a clear face and Face Enhance reports at least one face', async ({ page, request }) => {
  test.setTimeout(180_000)
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      console.error(`FACE TEST BROWSER ${message.type().toUpperCase()}: ${message.text()}`)
    }
  })
  page.on('pageerror', (error) => console.error(`FACE TEST PAGEERROR: ${error.stack ?? error.message}`))

  const portraitResponse = await request.get(PORTRAIT_URL)
  expect(portraitResponse.ok(), `portrait fixture request failed: ${portraitResponse.status()}`).toBeTruthy()
  const portrait = await portraitResponse.body()

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('http://127.0.0.1:4173/crop-image/')
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true', { timeout: 10_000 })

  await page.locator('#file').setInputFiles({
    name: 'astronaut.png',
    mimeType: 'image/png',
    buffer: portrait,
  })

  await expect(page.locator('#status')).toContainText('Ready — adjust the focal point', { timeout: 60_000 })
  await expect(page.locator('#reset-focus')).toHaveAttribute('aria-pressed', 'true')

  const debug = page.locator('#focus-debug-coordinate')
  await expect(debug).toBeVisible()
  const debugText = await debug.innerText()
  const coordinateMatch = debugText.match(/x:\s*([0-9.]+)\s*·\s*y:\s*([0-9.]+)/)
  expect(coordinateMatch, `unable to parse focus coordinate: ${debugText}`).not.toBeNull()
  const x = Number(coordinateMatch![1])
  const y = Number(coordinateMatch![2])

  expect(x).toBeGreaterThan(0.25)
  expect(x).toBeLessThan(0.60)
  expect(y).toBeGreaterThan(0.08)
  expect(y).toBeLessThan(0.42)

  await page.locator('#enhance-manual').click()
  await page.getByRole('button', { name: 'Face enhance' }).click()

  await expect(page.locator('#enhance-status')).toContainText(/AI Face Enhance \([1-9]\d*\) ready/, { timeout: 120_000 })
})
