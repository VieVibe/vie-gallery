import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { applyCuratedStyle, applySpatialPreset, SPATIAL_PALETTE, VIEWER_PRESETS, type SpatialPreset } from '@vie/gallery-contracts'
import { mockGallery } from '../../gallery-viewer/e2e/helpers/mockGallery'

async function studio(page: Page, arrangement: 'helix' | 'book' | 'tunnel' | SpatialPreset = 'helix') {
  const base = VIEWER_PRESETS['jade-flow']
  const config = arrangement === 'tide' || arrangement === 'fold' || arrangement === 'space'
    ? applySpatialPreset(base, arrangement) : applyCuratedStyle(base, arrangement)
  config.camera.autoRotate = false
  let draft = JSON.stringify(config), saves = 0, failSave = false
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mockGallery(page, { config, shared: true, count: 8 })
  const covers = ['coast', 'forest', 'lake', 'stream', 'bamboo', 'courtyard', 'gallery', 'coast']
  await page.context().route('**/fixtures/photo-*', async route => {
    const index = Number(route.request().url().match(/photo-(\d+)/)?.[1] ?? 0)
    const path = new URL(`../public/covers/${covers[index % covers.length]}.png`, import.meta.url)
    await route.fulfill({ contentType: 'image/png', body: await readFile(path) })
  })
  await page.context().route('**/api/public/g/effects-fixture/photos?*', route => route.fulfill({ json: {
    items: covers.map((_, index) => ({ title: ['海岸来信', '林间薄雾', '湖面微光', '溪流慢行', '竹影', '庭院', '光的回廊', '潮汐'][index], width: 1280, height: 720, sortOrder: index,
      thumbnailUrl: `/fixtures/photo-${index}.png`, textureUrl: `/fixtures/photo-${index}.png`, mediumUrl: `/fixtures/photo-${index}.png` })), page: 0, pageSize: 50, total: 8
  } }))
  const gallery = { id: 'studio', slug: 'effects-fixture', name: '山海之间', photoCount: 8, visibility: 'PUBLIC', status: 'DRAFT', createdAt: '2026-10-16T00:00:00Z' }
  await page.route('**/api/me', route => route.fulfill({ json: { role: 'OWNER', capabilities: ['GALLERY_READ', 'PHOTO_READ', 'CONFIG_READ', 'CONFIG_WRITE', 'PUBLISH'], user: { displayName: '林小满' }, tenant: { name: '山海摄影' } } }))
  await page.route('**/api/auth/csrf', route => route.fulfill({ json: { token: 'studio-csrf' } }))
  await page.route('**/api/galleries/studio', route => route.fulfill({ json: gallery }))
  await page.route('**/api/galleries/studio/photos', route => route.fulfill({ json: covers.map((_, index) => ({ id: `photo-${index}`, galleryId: 'studio', title: `山海手记 ${index + 1}`, sortOrder: index, cover: index === 0, status: 'READY', width: 1280, height: 720, thumbnailUrl: `/fixtures/photo-${index}.png` })) }))
  await page.route('**/api/galleries/studio/photo-tasks**', route => route.fulfill({ json: { items: [], total: 0, summary: {} } }))
  await page.route('**/api/galleries/studio/publish-readiness', route => route.fulfill({ json: { galleryStatus: 'DRAFT', readyPhotoCount: 8, galleryPublishable: true, configDraftChanged: true, blockers: [] } }))
  await page.route('**/api/galleries/studio/preview-token', route => route.fulfill({ json: { token: 'studio-preview', expiresAt: '2099-01-01T00:00:00Z' } }))
  await page.route('**/api/galleries/studio/viewer-config', route => {
    if (route.request().method() === 'PUT') {
      saves++
      if (failSave) return route.fulfill({ status: 503 })
      draft = route.request().postDataJSON().configJson
    }
    return route.fulfill({ json: { configJson: draft, schemaVersion: 1 } })
  })
  await page.route('**/api/galleries/studio/viewer-config/versions**', route => route.fulfill({ json: { items: [], total: 0 } }))
  return { draft: () => JSON.parse(draft), saves: () => saves, fail: () => { failSave = true }, errors }
}

test('studio keeps a clear hierarchy and works on desktop, tablet and mobile', async ({ page }) => {
  test.setTimeout(60000)
  const data = await studio(page)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/app/galleries/studio/config')
  await expect(page.getByRole('tab', { name: '风格', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.live-preview')).toHaveClass(/is-ready/)
  const frame = page.frameLocator('iframe[title="展厅实时预览"]')
  await expect.poll(() => frame.locator('canvas.webgl-canvas').evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready ?? 0)).toBeGreaterThan(0)
  // Capture the composed scene after its configured entrance has completed.
  await page.waitForTimeout(1000)
  await page.screenshot({ path: fileURLToPath(new URL('../../../.cache/presentation-studio-desktop.png', import.meta.url)), fullPage: true })
  await page.getByRole('tab', { name: '编排', exact: true }).click()
  await expect(page.getByRole('group', { name: '照片编排', exact: true }).getByRole('button')).toHaveCount(10)
  await expect(page.getByLabel('照片间距', { exact: true })).toBeEnabled()
  await page.screenshot({ path: fileURLToPath(new URL('../../../.cache/presentation-composition-desktop.png', import.meta.url)), fullPage: true })
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.getByRole('tab', { name: '风格', exact: true }).click()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: fileURLToPath(new URL(`../../../.cache/presentation-studio-${width}.png`, import.meta.url)), fullPage: true })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  const folder = new URL('../../../.taste-skill/optimization-2026-10-17/', import.meta.url)
  await mkdir(folder, { recursive: true })
  const tabs = await page.getByRole('tablist', { name: '配置分区' }).boundingBox()
  expect(tabs!.y + tabs!.height).toBeLessThan(600)
  await page.screenshot({ path: fileURLToPath(new URL('config-mobile.png', folder)) })
  await page.getByRole('button', { name: '收起预览', exact: true }).click()
  await expect(page.getByRole('button', { name: '展开预览', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('.live-preview')).toBeHidden()
  expect((await page.getByRole('tablist', { name: '配置分区' }).boundingBox())!.y).toBeLessThan(tabs!.y - 100)
  await page.screenshot({ path: fileURLToPath(new URL('config-mobile-collapsed.png', folder)) })
  await page.getByRole('button', { name: '展开预览', exact: true }).click()
  await expect(page.locator('.live-preview')).toBeVisible()
  expect(data.saves()).toBe(0)
  expect(data.errors).toEqual([])
})

test('quick composition saves a light spatial preset and restores it on reload', async ({ page }) => {
  const data = await studio(page, 'tide')
  await page.goto('/app/galleries/studio')
  await page.locator('.workspace-spatial > summary').click()
  const picker = page.locator('.quick-styles')
  await expect(picker.getByRole('button')).toHaveCount(3)
  await expect(picker.getByRole('button', { name: /^潮汐/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(picker.getByRole('button', { pressed: true })).toHaveCount(1)
  await picker.getByRole('button', { name: /^折廊/ }).click()
  await expect.poll(() => data.draft().layout.params.arrangement).toBe('fold')
  expect(data.draft().background).toEqual(SPATIAL_PALETTE)
  await page.reload()
  await page.locator('.workspace-spatial > summary').click()
  await expect(picker.getByRole('button', { name: /^折廊/ })).toHaveAttribute('aria-pressed', 'true')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(data.errors).toEqual([])
})

test('quick composition restores the saved choice when a save fails', async ({ page }) => {
  const data = await studio(page, 'tide')
  data.fail()
  await page.goto('/app/galleries/studio')
  await page.locator('.workspace-spatial > summary').click()
  const picker = page.locator('.quick-styles')
  await expect(picker.getByRole('button', { name: /^潮汐/ })).toBeEnabled()
  await picker.getByRole('button', { name: /^空间/ }).click()
  await expect(picker.getByRole('status')).toContainText('风格没有保存')
  await expect(picker.getByRole('button', { name: /^潮汐/ })).toHaveAttribute('aria-pressed', 'true')
  expect(data.draft().layout.params.arrangement).toBe('tide')
  expect(data.saves()).toBe(1)
})

test('the creator preview switches live between the three spatial scenes', async ({ page }) => {
  const data = await studio(page, 'tide')
  await page.goto('/app/galleries/studio/config')
  const choices = page.getByRole('region', { name: '默认 3D 展示效果' })
  await expect(choices.getByRole('button')).toHaveCount(3)
  await expect(page.getByRole('tab', { name: '下载权限' })).toBeVisible()
  const preview = page.frameLocator('iframe[title="展厅实时预览"]')
  await expect(preview.locator('.viewer-app-root')).toHaveClass(/is-collection/)
  await choices.getByRole('button', { name: /^空间/ }).click()
  await expect.poll(() => data.draft().layout.params.arrangement).toBe('space')
  await expect.poll(() => preview.locator('canvas').evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().requested.layout.params?.arrangement)).toBe('space')
  await preview.locator('canvas').press('Enter')
  await expect(preview.getByRole('dialog')).toBeVisible()
  await preview.getByRole('button', { name: '关闭大图 (Esc)' }).click()
  await expect(preview.getByRole('dialog')).toHaveCount(0)
  expect(data.errors).toEqual([])
})
