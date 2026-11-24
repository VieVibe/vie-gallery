import { test, expect } from '@playwright/test'
import { mockGallery } from './helpers/mockGallery'

test('Escape preserves keyboard focus when viewing options are closed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockGallery(page)
  await page.goto('/g/effects-fixture')
  const next = page.getByRole('button', { name: '下一张作品', exact: true })
  const more = page.getByRole('button', { name: '更多观看方式' })
  await next.focus()
  await page.keyboard.press('Escape')
  await expect(next).toBeFocused({ timeout: 1500 })

  await more.click()
  await page.getByRole('button', { name: '收起观看选项' }).focus()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
  await expect(more).toHaveAttribute('aria-expanded', 'false')
})

test('sharing during a photo focus animation keeps only the share dialog open', async ({ page }) => {
  await mockGallery(page, { count: 3, config: { particles: { enabled: false } } })
  await page.goto('/g/effects-fixture')
  await page.getByRole('button', { name: '更多观看方式' }).click()
  await page.getByLabel('照片排列与组合').selectOption('triptych')
  await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__!.freezeTime(0))
  await page.getByRole('button', { name: '查看当前主图' }).click()
  await page.getByRole('button', { name: '分享', exact: true }).click()
  const share = page.getByRole('dialog', { name: '把影展分享给朋友' })
  await expect(share).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__!.requestConfig({}))
  await expect(page.locator('dialog[open]')).toHaveCount(1)
  await expect(share.getByRole('button', { name: '关闭分享' })).toBeFocused()
  await page.getByRole('button', { name: '关闭分享' }).click()
  await expect(page.locator('dialog[open]')).toHaveCount(0)
  await expect(page.getByRole('region', { name: '照片编排' })).toHaveAttribute('data-mode', 'triptych')
})

test('visitor can morph between curated spaces and browse the exhibition', async ({ page }, info) => {
  const { errors } = await mockGallery(page)
  await page.goto('/g/effects-fixture')
  await expect(page.getByRole('button', { name: '螺旋', exact: true })).toBeVisible()
  for (const name of ['螺旋', '环幕', '波浪']) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => window.__VIE_VIEWER_DIAGNOSTICS__?.snapshot().renderedPhotos.ready ?? 0)).toBeGreaterThan(0)
    await page.screenshot({ path: info.outputPath(`${name}.png`) })
  }
  await page.getByRole('button', { name: '平面展览', exact: true }).click()
  await expect(page.locator('.photo-wall img').first()).toBeVisible()
  await page.locator('.photo-wall button').first().click()
  await expect(page.getByRole('dialog').first()).toBeVisible()
  expect(errors).toEqual([])
})
