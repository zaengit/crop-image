import { test, expect } from '@playwright/test'

const TEST_IMAGE = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
  <rect width="640" height="480" fill="#dbeafe"/>
  <rect x="80" y="70" width="480" height="340" rx="36" fill="#ffffff"/>
  <circle cx="320" cy="210" r="90" fill="#60a5fa"/>
  <rect x="250" y="300" width="140" height="70" rx="30" fill="#2563eb"/>
</svg>
`)

test('upload, focus change, and manual generate work in production build', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('http://127.0.0.1:4173/crop-image/')

  await page.locator('#file').setInputFiles({
    name: 'smoke.svg',
    mimeType: 'image/svg+xml',
    buffer: TEST_IMAGE,
  })

  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30_000 })
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
})
