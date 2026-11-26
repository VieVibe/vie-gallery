import { test, expect } from '@playwright/test'
import { mockGallery } from './helpers/mockGallery'

test('photo details can be enlarged, panned with the keyboard and reset on the next photo', async ({ page }) => {
  await mockGallery(page, { defaultView: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/g/effects-fixture')
  const opener = page.getByRole('button', { name: '查看照片 1：Sample 1', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '放大照片' }).click()
  const detail = dialog.getByRole('region', { name: '照片细节' })
  await expect(detail).toBeFocused()
  const x = await detail.evaluate(element => element.scrollLeft)
  expect(x).toBeGreaterThan(0)
  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => detail.evaluate(element => element.scrollLeft)).toBeLessThan(x)
  await expect(dialog).toHaveAccessibleName('Sample 1')
  await dialog.getByRole('button', { name: '下一张' }).click()
  await expect(dialog).toHaveAccessibleName('Sample 2')
  await expect(dialog.getByRole('button', { name: '放大照片' })).toBeEnabled()
  await expect(detail).toHaveCount(0)
  await expect(dialog.locator('.main-image')).toHaveCSS('animation-name', 'none')
  await page.keyboard.press('Escape')
  await expect(opener).toBeFocused()
})

test.describe('touch reading', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('a swipe pans an enlarged image and advances a fitted image', async ({ page }) => {
    await mockGallery(page, { defaultView: true })
    await page.goto('/g/effects-fixture')
    await page.getByRole('button', { name: '查看照片 1：Sample 1', exact: true }).tap()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '放大照片' }).tap()
    const viewport = dialog.locator('.image-wrapper')
    const before = await viewport.evaluate(element => element.scrollLeft)
    const cdp = await page.context().newCDPSession(page)
    async function swipeLeft() {
      const bounds = (await viewport.boundingBox())!
      await cdp.send('Input.synthesizeScrollGesture', {
        x: bounds.x + bounds.width * .75, y: bounds.y + bounds.height / 2,
        xDistance: -108, yDistance: 0, gestureSourceType: 'touch', preventFling: true
      })
    }
    await swipeLeft()
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(before)
    await expect(dialog).toHaveAccessibleName('Sample 1')
    await dialog.getByRole('button', { name: '还原整张照片' }).tap()
    await expect(dialog.getByRole('region', { name: '照片细节' })).toHaveCount(0)
    await swipeLeft()
    await expect(dialog).toHaveAccessibleName('Sample 2')
  })
})

test('share dialog supports keyboard dismissal, focus return and manual copy recovery', async ({ page }, info) => {
  const { errors } = await mockGallery(page)
  await page.addInitScript(() => {
    localStorage.setItem('vie:view-mode', '2d')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } })
  })
  await page.goto('/g/effects-fixture?preview=draft-credential&live=config#s=visitor-link')
  const share = page.getByRole('button', { name: '分享', exact: true })
  await share.click()
  const dialog = page.getByRole('dialog', { name: '把影展分享给朋友' })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.share-cover img')).toHaveAttribute('src', '/fixtures/photo-0.svg')
  await expect(dialog.getByRole('button', { name: '关闭分享' })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await expect(dialog.getByRole('textbox', { name: '展厅链接' })).toHaveValue(/#s=visitor-link$/)
  await expect(dialog.getByRole('textbox', { name: '展厅链接' })).not.toHaveValue(/preview=/)
  await expect(dialog.getByRole('textbox', { name: '展厅链接' })).not.toHaveValue(/live=/)
  await dialog.getByRole('button', { name: '复制链接', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('未能自动复制')
  await expect(dialog.getByRole('textbox', { name: '展厅链接' })).toBeFocused()
  await page.screenshot({ path: info.outputPath('share-desktop.png') })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.screenshot({ path: info.outputPath('share-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(share).toBeFocused()
  expect(errors).toEqual([])
})

test('an earlier copy request cannot change a reopened share dialog', async ({ page }) => {
  await mockGallery(page)
  await page.addInitScript(() => {
    localStorage.setItem('vie:view-mode', '2d')
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => new Promise<void>((_resolve, reject) => {
      Object.assign(window, { rejectPreviousCopy: () => reject(new Error('blocked')) })
    }) } })
  })
  await page.goto('/g/effects-fixture')
  const share = page.getByRole('button', { name: '分享', exact: true })
  await share.click()
  const dialog = page.getByRole('dialog', { name: '把影展分享给朋友' })
  await dialog.getByRole('button', { name: '复制链接', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '正在复制…' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await share.click()
  await page.evaluate(async () => {
    ;(window as unknown as { rejectPreviousCopy: () => void }).rejectPreviousCopy()
    await new Promise(resolve => setTimeout(resolve, 0))
  })
  await expect(dialog.getByRole('status')).toHaveText('收到链接的人将按展厅的访问设置进入。')
  await expect(dialog.getByRole('button', { name: '关闭分享' })).toBeFocused()
  await expect(dialog.getByRole('button', { name: '复制链接', exact: true })).toBeEnabled()
})

test('password entry has labels, preserves retry feedback and opens the gallery', async ({ page }, info) => {
  let unlocked = false
  await mockGallery(page)
  await page.addInitScript(() => localStorage.setItem('vie:view-mode', '2d'))
  await page.route('**/api/public/g/effects-fixture', route => route.fulfill({ json: {
    slug: 'effects-fixture', title: '山川来信', visibility: 'PASSWORD', accessState: unlocked ? 'READY' : 'PASSWORD_REQUIRED', cover: null, photoCount: 12,
  } }))
  await page.route('**/api/auth/csrf', route => route.fulfill({
    headers: { 'Set-Cookie': 'XSRF-TOKEN=visitor-csrf; Path=/' },
    json: { headerName: 'X-XSRF-TOKEN', token: 'visitor-csrf' }
  }))
  await page.route('**/api/public/g/effects-fixture/unlock', async route => {
    const headers = await route.request().allHeaders()
    if (headers['x-xsrf-token'] !== 'visitor-csrf' || !headers.cookie?.includes('XSRF-TOKEN=visitor-csrf')) {
      return route.fulfill({ status: 403, json: { code: 'CSRF_INVALID' } })
    }
    unlocked = route.request().postDataJSON().password === 'correct'
    return unlocked ? route.fulfill({ json: { unlocked: true } }) : route.fulfill({ status: 403, json: { code: 'PASSWORD_INVALID' } })
  })
  await page.goto('/g/effects-fixture')
  await expect(page.getByRole('heading', { name: '山川来信' })).toBeVisible()
  const password = page.getByLabel('访问密码', { exact: true })
  await password.fill('incorrect')
  await page.getByRole('button', { name: '显示密码' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: '进入影展' }).click()
  await expect(page.getByRole('alert')).toHaveText('密码不正确，请重新输入。')
  await expect(password).toHaveAttribute('aria-invalid', 'true')
  await expect(password).toBeFocused()
  await page.screenshot({ path: info.outputPath('password-desktop.png') })
  await page.setViewportSize({ width: 320, height: 700 })
  await page.screenshot({ path: info.outputPath('password-mobile.png') })
  await password.fill('correct')
  await expect(password).toHaveAttribute('aria-invalid', 'false')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: '进入影展' }).click()
  await expect(page.locator('.photo-wall img').first()).toBeVisible()
})

test('gallery controls and editorial photos fit a narrow viewport', async ({ page }, info) => {
  const { errors } = await mockGallery(page)
  await page.addInitScript(() => localStorage.setItem('vie:view-mode', '2d'))
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 })
    await page.goto('/g/effects-fixture')
    await expect(page.locator('.photo-wall img').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '空间漫游', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const tools = await page.locator('.exhibition-tools').boundingBox()
    expect(tools!.x).toBeGreaterThan(40)
    expect(tools!.x + tools!.width).toBeLessThanOrEqual(width)
    await page.screenshot({ path: info.outputPath('editorial-' + width + '.png'), fullPage: true })
  }
  expect(errors).toEqual([])
})

test('spatial controls fit touch screens and respect reduced motion', async ({ page }, info) => {
  const { errors } = await mockGallery(page)
  await page.setViewportSize({ width: 320, height: 740 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/g/effects-fixture')
  const helix = page.getByRole('button', { name: '螺旋', exact: true })
  await expect(helix).toBeVisible()
  await helix.click()
  await expect(page.getByRole('button', { name: '查看当前作品' })).toBeVisible()
  await expect(page.getByRole('button', { name: '自动漫游', exact: true })).toBeHidden()
  for (const selector of ['.composition-dock', '.stage-info', '.stage-navigation']) {
    const bounds = await page.locator(selector).boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
  }
  await page.screenshot({ path: info.outputPath('spatial-mobile.png') })
  await page.getByRole('button', { name: '查看当前作品' }).click()
  await expect(page.getByRole('dialog').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '查看当前作品' })).toBeFocused()
  expect(errors).toEqual([])
})

test('immersive viewing keeps keyboard navigation and restores the viewing controls', async ({ page }, info) => {
  const { errors } = await mockGallery(page, { config: { camera: { autoRotate: false } } })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/g/effects-fixture')
  await page.getByRole('button', { name: '螺旋', exact: true }).click()
  const enter = page.getByRole('button', { name: '沉浸欣赏', exact: true })
  await enter.click()
  const exit = page.getByRole('button', { name: '退出沉浸欣赏', exact: true })
  await expect(exit).toBeFocused()
  await expect(page.locator('.exhibition-header')).toHaveAttribute('inert', '')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.immersive-help')).toContainText('02 / 12')
  await page.screenshot({ path: info.outputPath('immersive-mobile.png') })
  await page.keyboard.press('Escape')
  await expect(enter).toBeFocused()
  await expect(page.locator('.exhibition-header')).not.toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: '查看当前作品' })).toContainText('Sample 2')
  expect(errors).toEqual([])
})

test('lightbox keeps a photographic preview visible while the full image is loading', async ({ page }) => {
  const { errors } = await mockGallery(page, { count: 1 })
  await page.addInitScript(() => localStorage.setItem('vie:view-mode', '2d'))
  await page.route('**/api/public/g/effects-fixture/photos**', route => route.fulfill({ json: {
    items: [{ title: '山川来信', width: 900, height: 600, sortOrder: 0, thumbnailUrl: '/fixtures/photo-0.svg', textureUrl: '/fixtures/full-resolution.svg' }],
    page: 0, pageSize: 50, total: 1,
  } }))
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/fixtures/full-resolution.svg', async route => {
    await gate
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#527465"/></svg>' })
  })
  try {
    await page.goto('/g/effects-fixture')
    await page.getByRole('button', { name: '查看照片 1：山川来信', exact: true }).click()
    await expect(page.locator('.image-preview')).toBeVisible()
    await expect.poll(() => page.locator('.image-preview').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    await expect(page.locator('.image-wrapper')).toHaveAttribute('aria-busy', 'true')
    release()
    await expect(page.locator('.main-image')).toHaveClass(/is-ready/)
    await expect(page.locator('.image-preview')).toHaveCount(0)
    await expect(page.locator('.image-wrapper')).toHaveAttribute('aria-busy', 'false')
    expect(errors).toEqual([])
  } finally { release() }
})

test('lightbox falls back to legacy previews when a WebP cannot be decoded', async ({ page }) => {
  await mockGallery(page, { count: 2, defaultView: true })
  await page.route('**/api/public/g/effects-fixture/photos?**', route => route.fulfill({ json: {
    items: [
      { title: '山川来信', width: 900, height: 600, sortOrder: 0, thumbnailUrl: '/fixtures/photo-0.svg',
        previewUrl: '/fixtures/broken-preview.webp', textureUrl: '/fixtures/full-resolution.svg' },
      { title: '远方', width: 900, height: 600, sortOrder: 1, thumbnailUrl: '/fixtures/photo-1.svg' }
    ],
    page: 0, pageSize: 50, total: 2
  } }))
  await page.route('**/fixtures/broken-preview.webp', route => route.fulfill({ contentType: 'image/webp', body: 'Invalid image' }))
  let release!: () => void
  const fullSize = new Promise<void>(resolve => { release = resolve })
  await page.route('**/fixtures/full-resolution.svg', async route => {
    await fullSize
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"/>' })
  })
  try {
    await page.goto('/g/effects-fixture')
    await page.getByRole('button', { name: '查看照片 1：山川来信', exact: true }).click()
    const dialog = page.getByRole('dialog')
    for (const preview of [dialog.locator('.image-preview'), dialog.getByRole('button', { name: '查看第 1 张：山川来信' }).locator('img')]) {
      await expect(preview).toHaveAttribute('src', '/fixtures/photo-0.svg', { timeout: 5000 })
      await expect.poll(() => preview.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    }
  } finally {
    release()
  }
})
