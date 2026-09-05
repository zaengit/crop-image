import { test, expect } from '@playwright/test'

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

test('upload, focus change, and manual generate work in production build', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/crop-image/')

  await page.locator('#file').setInputFiles({
    name: 'smoke.png',
    mimeType: 'image/png',
    buffer: ONE_PIXEL_PNG,
  })

  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30_000 })
  await expect(page.locator('#grid .card')).toHaveCount(0)

  const stage = page.locator('#focus-stage')
  await stage.click({ position: { x: 20, y: 20 } })
  await expect(page.locator('#status')).toContainText('click Generate crop', { timeout: 5_000 })
  await expect(page.locator('#grid .card')).toHaveCount(0)

  await page.locator('[data-menu="custom"]').click()
  await page.locator('#custom-width').fill('64')
  await page.locator('#custom-height').fill('64')
  await page.locator('#custom-form button[type="submit"]').click()

  await expect(page.locator('#grid .card')).toHaveCount(1, { timeout: 30_000 })
  await expect(page.locator('#status')).toContainText('Done', { timeout: 10_000 })
})
