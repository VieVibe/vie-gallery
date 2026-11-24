import { expect, test } from '@playwright/test'
import { mockGallery } from './helpers/mockGallery'

test('a share link uses its published collection even with an alternate layout in the URL', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockGallery(page, { config: { layout: { mode: 'helix', params: { composition: 'curated', arrangement: 'space' } } } })
  await page.goto('/g/effects-fixture?layout=grid#s=shared-fixture')
  await expect(page.getByRole('button', { name: '查看当前作品' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '展示风格' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().requested.layout.params?.arrangement)).toBe('space')
  await page.goto('/g/effects-fixture?layout=grid')
  await expect(page.getByRole('button', { name: '查看当前作品' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '展示风格' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().requested.layout.params?.arrangement)).toBe('space')
})

test('a creator preview opens from its cover with three light scene choices', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { errors } = await mockGallery(page, {
    count: 42,
    defaultView: true,
    config: {
      layout: { mode: 'grid', params: { composition: 'curated', arrangement: 'tide' } },
      background: { mode: 'solid', color: '#111a17' },
      effects: { photo: { style: 'ripple', intensity: .8, speed: .7 } },
      visitorAllowDownload: true
    }
  })
  await page.goto('/g/effects-fixture?preview=creator-fixture')
  await page.getByRole('button', { name: '开始浏览' }).click()
  const dock = page.getByRole('navigation', { name: '展示风格' })
  await expect(dock.getByRole('button')).toHaveText(['潮汐', '折廊', '空间'])
  await expect(dock.getByRole('button', { name: '潮汐' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.exhibition-header')).toHaveCSS('background-color', 'rgb(245, 248, 241)')
  await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready)).toBeGreaterThanOrEqual(36)
  expect(await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().effectiveConfig.effects.photo?.style)).toBe('none')
  await page.getByRole('button', { name: '下一张作品' }).click()
  for (const name of ['折廊', '空间', '潮汐']) {
    await dock.getByRole('button', { name, exact: true }).click()
    await expect(dock.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.stage-counter span').first()).toHaveText('02')
  }
  await page.getByRole('button', { name: '查看当前作品' }).click()
  await expect(page.getByRole('dialog')).toHaveClass(/light-scene/)
  expect(errors).toEqual([])
})

test('a mobile collection advances in chapters and keeps the active work when changing scenes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { errors } = await mockGallery(page, {
    count: 200,
    config: { layout: { mode: 'helix', params: { composition: 'curated', arrangement: 'fold' } } }
  })
  await page.goto('/g/effects-fixture?preview=creator-fixture')
  await page.getByRole('button', { name: '开始浏览' }).click()
  const dock = page.getByRole('navigation', { name: '展示风格' })
  await expect(dock.getByRole('button', { name: '折廊' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /继续浏览.*150 张/ }).click()
  const counter = page.locator('.stage-counter span').first()
  await expect(counter).toHaveText('51')
  await dock.getByRole('button', { name: '空间', exact: true }).click()
  await expect(dock.getByRole('button', { name: '空间', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(counter).toHaveText('51')
  await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready)).toBeGreaterThanOrEqual(36)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.getByRole('button', { name: '上一张作品' }).click()
  await expect(counter).toHaveText('50')
  expect(errors).toEqual([])
})
