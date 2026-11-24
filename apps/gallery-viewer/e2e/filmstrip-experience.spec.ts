import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { VIEWER_PRESETS } from '@vie/gallery-contracts'
import { mockGallery } from './helpers/mockGallery'

test('filmstrip reuses photos through navigation, layout switches and quality changes', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { errors } = await mockGallery(page, { count: 12, config: VIEWER_PRESETS['film-exhibition'] })
  await page.goto('/g/effects-fixture')
  const shortcut = page.getByRole('button', { name: '胶片', exact: true })
  await expect(shortcut).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready ?? 0)).toBeGreaterThan(0)
  const identities = await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__!.photoMeshIds())
  const counter = page.locator('.stage-counter span').first()
  for (let index = 1; index <= 12; index++) {
    await page.getByRole('button', { name: '下一张作品', exact: true }).click()
    await expect(counter).toHaveText(String(index % 12 + 1).padStart(2, '0'))
  }
  await page.getByRole('button', { name: '查看当前作品' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '翻页', exact: true }).click()
  await shortcut.click()
  await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__!.requestConfig({ quality: 'low' }))
  expect(await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__!.photoMeshIds())).toEqual(identities)
  expect(await page.locator('canvas').count()).toBe(1)
  const snapshot = await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__!.snapshot())
  expect(snapshot.textures.bytes).toBeLessThanOrEqual(snapshot.textures.budget.bytes)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.mouse.move(195, 420)
  await page.mouse.down()
  await page.mouse.move(60, 420, { steps: 10 })
  await page.mouse.up()
  await expect(counter).toHaveText('02')
  await expect(page.locator('.touch-tip')).toHaveText('左右滑动浏览')
  await page.screenshot({ path: info.outputPath('filmstrip-navigation.png') })
  expect(errors).toEqual([])
})

test('filmstrip has desktop, tablet and mobile compositions using local photo assets', async ({ page }, info) => {
  const { errors } = await mockGallery(page, { count: 8, config: VIEWER_PRESETS['film-exhibition'] })
  const names = ['coast', 'forest', 'lake', 'stream']
  await page.route('**/fixtures/photo-*', async route => {
    const index = Number(route.request().url().match(/photo-(\d+)/)?.[1] ?? 0)
    await route.fulfill({ contentType: 'image/png', body: await readFile(new URL(`../../gallery-admin/public/covers/${names[index % 4]}.png`, import.meta.url)) })
  })
  await page.route('**/api/public/g/effects-fixture/photos**', route => route.fulfill({ json: {
    items: Array.from({ length: 8 }, (_, index) => ({ title: ['海岸', '森林', '湖泊', '溪流'][index % 4], sortOrder: index,
      width: 1280, height: 720, thumbnailUrl: `/fixtures/photo-${index}.png`, textureUrl: `/fixtures/photo-${index}.png` })),
    page: 0, pageSize: 50, total: 8,
  } }))
  for (const [width, height] of [[1440, 900], [768, 1024], [390, 844]]) {
    await page.setViewportSize({ width, height })
    await page.goto('/g/effects-fixture')
    await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready ?? 0)).toBeGreaterThan(0)
    await page.waitForTimeout(1600)
    await expect(page.getByRole('button', { name: '胶片', exact: true })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`filmstrip-${width}.png`) })
    if (width === 1440 && process.env.UPDATE_FILMSTRIP_PREVIEW === '1') {
      await page.locator('canvas').screenshot({ path: new URL('../../gallery-admin/public/effect-previews/film-exhibition.jpg', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), type: 'jpeg', quality: 80 })
    }
  }
  expect(errors).toEqual([])
})
