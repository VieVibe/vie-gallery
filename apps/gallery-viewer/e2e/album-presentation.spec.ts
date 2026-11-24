import { expect, test } from '@playwright/test'
import { mockGallery } from './helpers/mockGallery'

test('new visitors see the chosen cover and can start reading without starting WebGL', async ({ page }) => {
  await mockGallery(page, { defaultView: true })
  await page.route('**/api/public/g/effects-fixture', route => route.fulfill({
    json: {
      slug: 'effects-fixture', title: '山海之间', visibility: 'PUBLIC', accessState: 'READY', photoCount: 12,
      cover: { url: '/fixtures/photo-4.svg', width: 900, height: 600 }
    }
  }))
  await page.goto('/g/effects-fixture')
  await expect(page.getByRole('heading', { name: '山海之间' })).toBeVisible()
  await expect(page.locator('.album-cover img')).toHaveAttribute('src', '/fixtures/photo-4.svg')
  await expect(page.locator('.webgl-canvas')).toHaveCount(0)
  expect(await page.evaluate(() => performance.getEntriesByName('viewer:engine-module-ready').length)).toBe(0)

  const start = page.getByRole('button', { name: '开始浏览', exact: true })
  await start.click()
  const photo = page.getByRole('dialog')
  await expect(photo).toBeVisible()
  await expect(photo).toHaveAccessibleName('Sample 1')
  await page.keyboard.press('ArrowRight')
  await expect(photo).toContainText('Sample 2')
  await page.keyboard.press('Escape')
  await expect(start).toBeFocused()
})

test('mixed photos keep their order and album navigation preserves the share fragment', async ({ page }) => {
  await mockGallery(page, { defaultView: true })
  await page.route('**/api/public/g/effects-fixture/photos?**', route => route.fulfill({
    json: {
      items: [
        { title: '岸边', width: 0, height: 0, sortOrder: 0, thumbnailUrl: '/fixtures/photo-0.svg' },
        { title: '潮汐', width: 2400, height: 900, sortOrder: 1, thumbnailUrl: '/fixtures/photo-1.svg' },
        { title: '灯塔', width: 600, height: 900, sortOrder: 2, thumbnailUrl: '/fixtures/photo-2.svg' },
        { title: '礁石', width: 600, height: 900, sortOrder: 3, thumbnailUrl: '/fixtures/photo-3.svg' }
      ],
      page: 0, pageSize: 50, total: 4
    }
  }))
  await page.goto('/g/effects-fixture#s=visitor-link')
  await expect(page.locator('.photo-caption')).toHaveText(['岸边', '潮汐', '灯塔', '礁石'])
  const pano = page.getByRole('button', { name: '查看照片 2：潮汐' })
  const landscape = page.getByRole('button', { name: '查看照片 1：岸边' })
  expect((await pano.boundingBox())!.width).toBeGreaterThan((await landscape.boundingBox())!.width)
  await page.setViewportSize({ width: 320, height: 700 })
  await page.getByRole('button', { name: '查看全部' }).click()
  await expect(page.getByRole('heading', { name: '全部照片' })).toBeFocused()
  await expect(page).toHaveURL(/#s=visitor-link$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(pano.locator('img')).toHaveCSS('object-fit', 'contain')
})

test('the enlarged photo reader continues across the next page of an album', async ({ page }) => {
  await mockGallery(page, { count: 51, defaultView: true })
  await page.goto('/g/effects-fixture')
  await page.getByRole('button', { name: '查看照片 50：Sample 50' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.photo-indicator')).toContainText(/50\s*\/\s*51/)
  await page.keyboard.press('ArrowRight')
  await expect(dialog).toHaveAccessibleName('Sample 51')
  await expect(dialog.getByRole('button', { name: '下一张' })).toBeDisabled()
})
