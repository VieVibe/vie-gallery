import { expect, test } from '@playwright/test'
import { mockGallery } from './helpers/mockGallery'

test('the collection tour control follows camera settings and retains a manual pause across scene switches', async ({ page }) => {
  await mockGallery(page, { config: {
    layout: { mode: 'grid', params: { composition: 'curated', arrangement: 'tide' } },
    camera: { autoRotate: false }
  } })
  await page.goto('/g/effects-fixture?preview=creator-fixture')
  await page.getByRole('button', { name: '开始浏览' }).click()
  const play = page.getByRole('button', { name: '自动漫游', exact: true })
  const pause = page.getByRole('button', { name: '暂停漫游', exact: true })
  await expect(play).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__!.requestConfig({ camera: { autoRotate: true } }))
  await expect(pause).toHaveAttribute('aria-pressed', 'true')
  await pause.click()
  const fold = page.getByRole('button', { name: '折廊', exact: true })
  await fold.click()
  await expect(fold).toHaveAttribute('aria-pressed', 'true')
  await expect(play).toHaveAttribute('aria-pressed', 'false')
})

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

test('a creator preview opens from its cover and can switch to each choreography', async ({ page }) => {
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
  await expect(dock.getByRole('button')).toHaveText(['潮汐', '折廊', '空间', '破阵重组', '连锁翻面', '双扇开合'])
  await expect(dock.getByRole('button', { name: '潮汐' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.exhibition-header')).toHaveCSS('background-color', 'rgb(245, 248, 241)')
  await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready)).toBeGreaterThanOrEqual(36)
  expect(await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().effectiveConfig.effects.photo?.style)).toBe('none')
  await page.getByRole('button', { name: '下一张作品' }).click()
  for (const [name, arrangement] of [['破阵重组', 'burst'], ['连锁翻面', 'domino'], ['双扇开合', 'fans']]) {
    await dock.getByRole('button', { name, exact: true }).click()
    await expect(dock.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().requested.layout.params?.arrangement)).toBe(arrangement)
    await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready)).toBe(12)
    await expect(page.locator('.stage-counter span').first()).toHaveText('02')
  }
  for (const name of ['折廊', '空间', '潮汐']) {
    await dock.getByRole('button', { name, exact: true }).click()
    await expect(dock.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.stage-counter span').first()).toHaveText('02')
  }
  await page.getByRole('button', { name: '查看当前作品' }).click()
  await expect(page.getByRole('dialog')).toHaveClass(/light-scene/)
  expect(errors).toEqual([])
})

test('a published choreography can be paused and opened on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { errors } = await mockGallery(page, { config: {
    layout: { mode: 'grid', params: { composition: 'curated', arrangement: 'fans' } },
    camera: { autoRotate: true }
  } })
  await page.goto('/g/effects-fixture#s=shared-fixture')
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  await expect(page.getByRole('button', { name: '播放动效', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('navigation', { name: '展示风格' })).toHaveCount(0)
  await page.getByRole('button', { name: '沉浸欣赏' }).click()
  await page.getByRole('button', { name: '下一张作品' }).click()
  await expect(page.locator('.stage-counter span').first()).toHaveText('02')
  await page.getByRole('button', { name: '播放动效', exact: true }).click()
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  await page.getByRole('button', { name: '查看当前作品' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  expect(errors).toEqual([])
})

test('autoplay preloads the next choreography group before showing it', async ({ page }) => {
  await mockGallery(page, { count: 24, config: {
    layout: { mode: 'grid', params: { composition: 'curated', arrangement: 'burst' } },
    camera: { autoRotate: false }
  } })
  await page.goto('/g/effects-fixture#s=shared-fixture')
  const nextTexture = page.waitForRequest('**/fixtures/photo-12.svg', { timeout: 6000 })
  await page.getByRole('button', { name: '播放动效', exact: true }).click()
  await nextTexture
  await expect(page.locator('.stage-counter span').first()).toHaveText('01')
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

test('Fold automatically loads more works and advances the active bay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const { errors } = await mockGallery(page, {
    count: 56,
    config: {
      layout: { mode: 'helix', params: { composition: 'curated', arrangement: 'fold' } },
      camera: { autoRotate: true }
    }
  })
  await page.goto('/g/effects-fixture?preview=creator-fixture')
  await page.getByRole('button', { name: '开始浏览' }).click()
  const counter = page.locator('.stage-counter span')
  await expect(counter.last()).toHaveText('56')
  await expect.poll(async () => Number(await counter.first().textContent())).toBeGreaterThan(1)
  await page.getByRole('button', { name: '暂停漫游', exact: true }).click()
  await expect(page.getByRole('button', { name: '自动漫游', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(errors).toEqual([])
})

test('the embedded Fold preview also loads beyond the first page', async ({ page }) => {
  const { errors } = await mockGallery(page, {
    count: 56,
    config: {
      layout: { mode: 'helix', params: { composition: 'curated', arrangement: 'fold' } },
      camera: { autoRotate: true }
    }
  })
  await page.route('**/fold-preview-host', route => route.fulfill({
    contentType: 'text/html', body: '<iframe src="/g/effects-fixture?embed=preview"></iframe>'
  }))
  const nextPage = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/photos') && url.searchParams.get('page') === '1' && response.ok()
  })
  await page.goto('/fold-preview-host')
  await nextPage
  await expect(page.frameLocator('iframe').locator('canvas[data-presentation="preview"]')).not.toHaveAttribute('data-has-more', 'true')
  expect(errors).toEqual([])
})
