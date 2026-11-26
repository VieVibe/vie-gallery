import { expect, test, type Page } from '@playwright/test'

const albums = [
  { id: 'winter', name: '冬日海岸', slug: 'winter-coast', visibility: 'PRIVATE', status: 'DRAFT', photoCount: 3, coverThumbnailUrl: '/app/covers/coast.png' },
  { id: 'river', name: '春日河岸', slug: 'spring-river', visibility: 'PASSWORD', status: 'PUBLISHED', photoCount: 12 },
  { id: 'forest', name: '秋日林间', slug: 'autumn-forest', visibility: 'PUBLIC', status: 'ARCHIVED', photoCount: 6, coverThumbnailUrl: '/missing-cover' }
].map((album, i) => ({ ...album, createdAt: `2026-09-0${i + 1}T12:00:00Z`, updatedAt: `2026-10-0${3 - i}T12:00:00Z` }))

async function openLibrary(page: Page) {
  const tenant = { id: 'studio', name: '沿岸工作室', role: 'VIEWER', capabilities: ['GALLERY_READ', 'PHOTO_READ', 'CONFIG_READ'] }
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/me') return route.fulfill({ json: { role: tenant.role, capabilities: tenant.capabilities, tenant, user: { id: 'reader' } } })
    if (path === '/api/me/workspaces') return route.fulfill({ json: [tenant] })
    if (path === '/api/galleries') return route.fulfill({ json: albums })
    if (path === '/api/galleries/river') return route.fulfill({ json: albums[1] })
    if (path.endsWith('/photos')) return route.fulfill({ json: [] })
    return route.fulfill({ json: {} })
  })
  await page.route('**/missing-cover', route => route.fulfill({ status: 404, body: '' }))
  await page.goto('/app/')
  await expect(page.getByRole('heading', { name: albums[0].name })).toBeVisible()
}

test('the library keeps its place when returning from a filtered list', async ({ page }) => {
  await openLibrary(page)
  const published = page.getByRole('button', { name: /已发布.*1/ })
  await published.click()
  const search = page.getByRole('searchbox')
  await search.fill('RIVER')
  await page.getByRole('button', { name: '列表视图' }).click()
  await page.getByRole('button', { name: '更多操作' }).press('ArrowDown')
  await expect(page.getByRole('button', { name: '进入工作区' })).toBeFocused()
  await expect(page.getByRole('button', { name: '重命名' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '春日河岸' }).click()
  await expect(page).toHaveURL(/\/galleries\/river$/)
  await page.goBack()
  await expect(search).toHaveValue('RIVER')
  await expect(published).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '列表视图' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.space-card')).toHaveCount(1)
})

test('sorting, clearing an empty search, and mobile list actions stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openLibrary(page)
  await page.getByLabel('排序方式').selectOption('created')
  await expect(page.locator('.album-card-link').first()).toHaveText('秋日林间')
  const search = page.getByRole('searchbox')
  await search.fill('missing')
  await expect(page.getByRole('heading', { name: '没有匹配的相册' })).toBeVisible()
  await page.getByRole('button', { name: '重置筛选' }).click()
  await expect(search).toBeFocused()
  await expect(page.locator('.space-card')).toHaveCount(3)
  await page.getByRole('button', { name: '列表视图' }).click()
  const album = page.locator('article').filter({ has: page.getByRole('heading', { name: '冬日海岸' }) })
  await expect(album).toContainText('专属链接')
  await album.getByRole('button', { name: '更多操作' }).click()
  await expect(album.getByRole('button', { name: '展厅配置' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('real covers and missing-cover fallbacks survive layout switches', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openLibrary(page)
  const coast = page.locator('.space-card').filter({ has: page.getByRole('heading', { name: '冬日海岸' }) })
  const forest = page.locator('.space-card').filter({ has: page.getByRole('heading', { name: '秋日林间' }) })
  await expect.poll(() => coast.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0)
  await expect(forest.locator('.cover-imprint')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('library-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '列表视图' }).click()
  await expect(coast.locator('img')).toBeVisible()
  await expect(forest.locator('.cover-imprint')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('library-mobile.png') })
})
