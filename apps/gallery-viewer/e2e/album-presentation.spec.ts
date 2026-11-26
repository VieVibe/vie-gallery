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

test('the cover is visible while the first photo page and scene config are pending', async ({ page }) => {
  await mockGallery(page, { defaultView: true })
  let releaseDetails!: () => void
  const details = new Promise<void>(resolve => { releaseDetails = resolve })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/public/g/effects-fixture', route => route.fulfill({
    json: {
      slug: 'effects-fixture', title: '山海之间', visibility: 'PUBLIC', accessState: 'READY', photoCount: 12,
      cover: { url: '/fixtures/photo-4.svg', width: 1200, height: 800,
        previewUrl: '/fixtures/photo-4-small.svg', previewWidth: 480,
        displayUrl: '/fixtures/photo-4-display.svg', displayWidth: 960 }
    }
  }))
  await page.route('**/api/public/g/effects-fixture/*', async route => {
    await details
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/viewer-config')) return route.fallback()
    return route.fulfill({ json: { items: [{
      title: '岸边', width: 1200, height: 800, sortOrder: 0,
      thumbnailUrl: '/fixtures/photo-0.svg', previewUrl: '/fixtures/photo-0-small.svg'
    }], page: 0, pageSize: 50, total: 12 } })
  })

  try {
    await page.goto('/g/effects-fixture', { waitUntil: 'domcontentloaded' })
    const cover = page.locator('.album-cover img')
    await expect.poll(() => cover.evaluateAll(nodes => {
      const img = nodes[0] as HTMLImageElement | undefined
      return img?.complete && img.naturalWidth > 0 ? new URL(img.currentSrc).pathname : null
    }), { timeout: 5000 }).toBe('/fixtures/photo-4-small.svg')
    await expect(page.getByRole('button', { name: '开始浏览' })).toBeDisabled()
    const firstCover = await cover.elementHandle()
    releaseDetails()
    await expect(page.getByRole('button', { name: '开始浏览' })).toBeEnabled()
    expect(await cover.evaluate((image, original) => image === original, firstCover)).toBe(true)
    const photo = page.getByRole('button', { name: '查看照片 1：岸边' })
    await expect(photo.locator('img')).toHaveAttribute('src', '/fixtures/photo-0-small.svg')
    await photo.click()
    await expect(page.getByRole('dialog').locator('.main-image')).toHaveAttribute('src', '/fixtures/photo-0.svg')
  } finally {
    releaseDetails()
  }
})

test('the mobile cover tries the larger WebP when the small one is broken', async ({ page }) => {
  await mockGallery(page, { defaultView: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/public/g/effects-fixture', route => route.fulfill({ json: {
    slug: 'effects-fixture', title: '山海之间', visibility: 'PUBLIC', accessState: 'READY', photoCount: 12,
    cover: { url: '/fixtures/photo-4.svg', width: 1200, height: 800,
      previewUrl: '/fixtures/broken-preview.webp', previewWidth: 480,
      displayUrl: '/fixtures/photo-4-display.svg', displayWidth: 960 }
  } }))
  await page.route('**/fixtures/broken-preview.webp', route => route.fulfill({ contentType: 'image/webp', body: 'Invalid image' }))
  await page.goto('/g/effects-fixture')
  const cover = page.locator('.album-cover img')
  await expect.poll(() => cover.evaluateAll(nodes => {
    const img = nodes[0] as HTMLImageElement | undefined
    return img?.complete && img.naturalWidth > 0 ? new URL(img.currentSrc).pathname : null
  }), { timeout: 5000 }).toBe('/fixtures/photo-4-display.svg')
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

test('the thumbnail index fits a phone, keeps reading order and focuses newly loaded photos', async ({ page }) => {
  await mockGallery(page, { count: 51, defaultView: true })
  await page.setViewportSize({ width: 320, height: 720 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/g/effects-fixture#s=visitor-link')
  await page.getByRole('button', { name: '查看全部' }).click()
  const album = page.getByRole('button', { name: '画册', exact: true })
  const thumbnails = page.getByRole('button', { name: '缩略图', exact: true })
  await expect(album).toHaveAttribute('aria-pressed', 'true')
  await thumbnails.focus()
  await page.keyboard.press('Enter')
  await expect(thumbnails).toHaveAttribute('aria-pressed', 'true')
  const first = page.getByRole('button', { name: '查看照片 1：Sample 1', exact: true })
  const second = page.getByRole('button', { name: '查看照片 2：Sample 2', exact: true })
  expect((await first.boundingBox())!.y).toBe((await second.boundingBox())!.y)
  await second.click()
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Sample 2')
  await page.keyboard.press('Escape')
  await expect(second).toBeFocused()
  await page.getByRole('button', { name: '加载更多 · 还有 1 张' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '查看照片 51：Sample 51' })).toBeFocused()
  await expect(thumbnails).toHaveAttribute('aria-pressed', 'true')
  await album.click()
  expect((await second.boundingBox())!.y).toBeGreaterThan((await first.boundingBox())!.y)
  await page.getByRole('button', { name: '回到封面', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Effects fixture' })).toBeFocused()
  expect(await page.evaluate(() => scrollY)).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page).toHaveURL(/#s=visitor-link$/)
})

test('returning from spatial viewing restores the album layout and reading position', async ({ page }) => {
  await mockGallery(page, { defaultView: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/g/effects-fixture')
  await page.getByRole('button', { name: '查看全部' }).click()
  const thumbnailLayout = page.getByRole('button', { name: '缩略图', exact: true })
  await thumbnailLayout.click()
  const photo = page.getByRole('button', { name: '查看照片 12：Sample 12' })
  await photo.scrollIntoViewIfNeeded()
  const position = await page.evaluate(() => scrollY)
  expect(position).toBeGreaterThan(600)

  const enter = page.getByRole('button', { name: '空间漫游', exact: true })
  const bounds = (await enter.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  // Locator clicks scroll sticky elements into view before dispatching the pointer.
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await expect(page.locator('.webgl-canvas')).toBeVisible()
  await page.getByRole('button', { name: '平面展览', exact: true }).click()
  await expect(thumbnailLayout).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(position)
})

test('an expired private link during pagination returns to the share-link prompt', async ({ page }) => {
  await mockGallery(page, { count: 51, defaultView: true })
  await page.route('**/api/public/g/effects-fixture', route => route.fulfill({ json: {
    slug: 'effects-fixture', title: '私人相册', visibility: 'PRIVATE', accessState: 'READY', photoCount: 51
  } }))
  await page.route('**/api/public/g/effects-fixture/photos?**', route => {
    if (new URL(route.request().url()).searchParams.get('page') === '0') return route.fallback()
    return route.fulfill({ status: 404, json: { code: 'SHARE_LINK_EXPIRED' } })
  })
  await page.goto('/g/effects-fixture#s=shared-fixture')
  await page.getByRole('button', { name: '加载更多 · 还有 1 张', exact: true }).click()
  await expect(page.getByRole('heading', { name: '请使用分享链接进入' })).toBeVisible({ timeout: 2500 })
  await expect(page.getByRole('button', { name: '查看照片 1：Sample 1' })).toHaveCount(0)
})
