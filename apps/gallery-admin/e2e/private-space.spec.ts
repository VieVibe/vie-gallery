import { test, expect, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const raw = Buffer.from([0, 255, 13, 10, 1, 88, 0, 91])
const checksum = createHash('sha256').update(raw).digest('hex')
const jpg = { id: '11111111-1111-4111-8111-111111111111', path: '精修/合照.JPG', size: raw.length, sha256: checksum, verifiedAt: '2026-10-24T00:00:00Z', previewAvailable: false }
const cr3 = { ...jpg, id: '22222222-2222-4222-8222-222222222222', path: '原片/IMG_0001.CR3' }
const xmp = { ...jpg, id: '33333333-3333-4333-8333-333333333333', path: '原片/IMG_0001.xmp' }

async function mockSpace(page: Page, options: { allowed?: boolean; guest?: boolean; files?: typeof jpg[]; damaged?: boolean } = {}) {
  let loggedIn = !options.guest
  let uploaded: Buffer | null = null
  let requestedHash: string | null = null
  let exportIds: string[] = []
  let dataRequests = 0
  const user = { user: { id: 'owner', email: 'rong@vie.com', displayName: '私人珍藏' }, tenant: { id: 'personal', name: '私人工作区' }, role: 'OWNER', capabilities: ['GALLERY_READ', 'GALLERY_CREATE'] }
  await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }) })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/csrf') return route.fulfill({ json: { token: 'test-csrf' } })
    if (path === '/api/me') return route.fulfill({ status: loggedIn ? 200 : 401, json: loggedIn ? user : { code: 'AUTH_REQUIRED' } })
    if (path === '/api/auth/login') { loggedIn = true; return route.fulfill({ json: user }) }
    if (path === '/api/private-space/access') return route.fulfill({ json: { allowed: options.allowed !== false, quotaBytes: 32 * 1024 ** 3, maxFileBytes: 512 * 1024 ** 2 } })
    if (path === '/api/private-space/files') { dataRequests++; return route.fulfill({ json: options.files || [jpg, cr3, xmp] }) }
    if (path === '/api/private-space/uploads') {
      requestedHash = route.request().postDataJSON().sha256
      return route.fulfill({ json: { id: jpg.id, state: 'UPLOADING', uploadUrl: new URL('/test-oss/upload', route.request().url()).href, headers: { 'Content-Type': 'application/octet-stream' } } })
    }
    if (path.endsWith('/complete')) return route.fulfill({ json: { ...jpg, path: '原件.CR3' } })
    if (path.endsWith('/download')) return route.fulfill({ json: { url: new URL('/test-oss/download', route.request().url()).href } })
    if (path === '/api/private-space/exports') { exportIds = route.request().postDataJSON().ids; return route.fulfill({ json: { url: '/api/private-space/exports/test-ticket' } }) }
    if (path === '/api/private-space/exports/test-ticket') return route.fulfill({ contentType: 'application/zip', headers: { 'Content-Disposition': 'attachment; filename=originals.zip' }, body: Buffer.from('mock-archive') })
    if (path === '/api/galleries' || path === '/api/me/workspaces') return route.fulfill({ json: [] })
    return route.fulfill({ status: 404, json: {} })
  })
  await page.route('**/test-oss/**', async route => {
    if (route.request().method() === 'PUT') {
      uploaded = route.request().postDataBuffer()
      expect(route.request().headers()['content-type']).toBe('application/octet-stream')
      expect(route.request().headers()['x-xsrf-token']).toBeUndefined()
      return route.fulfill({ status: 200, body: '' })
    }
    return route.fulfill({ contentType: 'application/octet-stream', body: options.damaged ? raw.subarray(0, raw.length - 1) : raw })
  })
  return { uploaded: () => uploaded, requestedHash: () => requestedHash, exportIds: () => exportIds, dataRequests: () => dataRequests }
}

test('dedicated account automatically enters the private space on login', async ({ page }) => {
  await mockSpace(page, { guest: true })
  await page.goto('/app/')
  await page.getByLabel('电子邮箱', { exact: true }).fill('rong@vie.com')
  await page.getByLabel('密码', { exact: true }).fill('browser-fixture-password')
  await page.getByRole('button', { name: '登录控制台', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/private-space$/)
  await expect(page.getByRole('heading', { name: '把这一刻，完整留下。' })).toBeVisible()
})

test('folder browsing works on desktop and mobile without horizontal overflow', async ({ page }) => {
  await mockSpace(page)
  await page.goto('/app/')
  await expect(page).toHaveURL(/private-space$/)
  await page.getByRole('button', { name: '原片', exact: true }).click()
  await expect(page.getByText('IMG_0001.CR3', { exact: true })).toBeVisible()
  await expect(page.getByText('IMG_0001.xmp', { exact: true })).toBeVisible()
  await page.screenshot({ path: '.cache/private-space-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText('IMG_0001.CR3', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '.cache/private-space-mobile.png', fullPage: true })
})

test('uploads exactly the original binary and reports success only after verification', async ({ page }) => {
  const mock = await mockSpace(page, { files: [] })
  await page.goto('/app/private-space')
  await expect(page.getByRole('button', { name: '上传原文件', exact: true })).toBeVisible()
  await page.getByLabel('选择原文件', { exact: true }).setInputFiles({ name: '原件.CR3', mimeType: 'application/octet-stream', buffer: raw })
  await expect(page.getByText('原件已保存并校验', { exact: true })).toBeVisible()
  expect(mock.uploaded()).toEqual(raw)
  expect(mock.requestedHash()).toBe(checksum)
  await expect(page.getByText('原件.CR3', { exact: true })).toHaveCount(2)
})

test('single downloads are byte-identical and corrupt transfers are rejected', async ({ page }) => {
  await mockSpace(page)
  await page.goto('/app/private-space')
  await page.getByRole('button', { name: '精修', exact: true }).click()
  const saved = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载原件', exact: true }).click()
  const download = await saved
  expect(download.suggestedFilename()).toBe('合照.JPG')
  expect(await readFile((await download.path())!)).toEqual(raw)
  await expect(page.getByRole('status')).toContainText('原件下载校验通过')
})

test('corrupt transfer is never offered as a completed download', async ({ page }) => {
  await mockSpace(page, { damaged: true })
  let downloads = 0
  page.on('download', () => downloads++)
  await page.goto('/app/private-space')
  await page.getByRole('button', { name: '精修', exact: true }).click()
  await page.getByRole('button', { name: '下载原件', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('下载完整性校验未通过')
  expect(downloads).toBe(0)
})

test('CR3 downloads include the matching XMP sidecar', async ({ page }) => {
  const mock = await mockSpace(page)
  await page.goto('/app/private-space')
  await page.getByRole('button', { name: '原片', exact: true }).click()
  const saved = page.waitForEvent('download')
  await page.locator('.file-row').filter({ hasText: 'IMG_0001.CR3' }).getByRole('button', { name: '下载原件', exact: true }).click()
  await saved
  expect(mock.exportIds()).toEqual([cr3.id, xmp.id])
})

test('CR3 download never pairs with an XMP from a differently capitalized folder', async ({ page }) => {
  const rawPhoto = { ...cr3, path: 'Travel/IMG_0001.CR3' }
  const wrongFolder = { ...xmp, path: 'travel/IMG_0001.XMP' }
  const matchingSidecar = { ...xmp, id: jpg.id, path: 'Travel/IMG_0001.XMP' }
  const mock = await mockSpace(page, { files: [wrongFolder, rawPhoto, matchingSidecar] })
  await page.goto('/app/private-space')
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  const saved = page.waitForEvent('download')
  await page.locator('.file-row').filter({ hasText: 'IMG_0001.CR3' }).getByRole('button', { name: '下载原件', exact: true }).click()
  await saved
  expect(mock.exportIds()).toEqual([rawPhoto.id, matchingSidecar.id])
})

test('other accounts cannot request private file data through the page', async ({ page }) => {
  const mock = await mockSpace(page, { allowed: false })
  await page.goto('/app/private-space')
  await expect(page.getByRole('alert')).toContainText('没有私人空间的访问权限')
  await expect(page.getByRole('button', { name: '上传原文件', exact: true })).toHaveCount(0)
  expect(mock.dataRequests()).toBe(0)
})
