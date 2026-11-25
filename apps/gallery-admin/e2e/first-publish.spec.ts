import { test, expect } from '@playwright/test'

/**
 * 首发布链路（纯前端 + API mock）：
 * 从未打开过配置页的新相册，在工作台一键发布必须成功——
 * publishAll 需要先静默创建推荐场景草稿，再走配置发布 + 画廊发布。
 */
const GALLERY_ID = '22222222-2222-4222-8222-222222222222'
const draftGallery = {
  id: GALLERY_ID, slug: 'first-publish', name: '首发布空间', visibility: 'PUBLIC',
  status: 'DRAFT', publishedAt: null, coverPhotoId: null, coverThumbnailUrl: null,
  createdAt: '2026-10-07T00:00:00Z', updatedAt: '2026-10-07T00:00:00Z',
  photoCount: 1, failedPhotoCount: 0, processingCount: 0, hasUnpublishedConfig: false
}
const readyPhoto = {
  id: 'photo-1', galleryId: GALLERY_ID, title: '', sortOrder: 0, cover: false, status: 'READY',
  createdAt: '2026-10-07T00:00:00Z', byteSize: 204800, width: 1200, height: 800,
  thumbnailUrl: null, originalUrl: null
}

async function mockWorkspace(page: import('@playwright/test').Page, options: {
  hasConfigDraft: boolean
  gallery?: typeof draftGallery
  capabilities?: string[]
  startUploaded?: boolean
}) {
  const gallery = options.gallery ?? draftGallery
  let uploaded = options.startUploaded ?? false
  let published = false
  let configPublished = false
  let savedConfig: unknown = null
  const calls: string[] = []
  await page.route('**/api/auth/csrf', route => route.fulfill({ json: { token: 'e2e-csrf-token' } }))
  await page.route('**/api/me', route => route.fulfill({
    json: { role: 'OWNER', capabilities: options.capabilities ?? ['GALLERY_READ', 'PHOTO_READ', 'PHOTO_WRITE', 'PUBLISH', 'SHARE_MANAGE', 'CONFIG_READ', 'CONFIG_WRITE'], user: { displayName: '新用户' }, tenant: { name: '首发布工作区' } }
  }))
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}$`), route =>
    route.fulfill({
      json: published
        ? { ...gallery, status: 'PUBLISHED', publishedAt: '2026-10-07T01:00:00Z' }
        : uploaded ? { ...gallery, photoCount: Math.max(gallery.photoCount, 1) } : gallery
    }))
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/photos$`), async route => {
    if (route.request().method() !== 'GET') {
      const headers = route.request().headers()
      if (!headers['idempotency-key']) {
        await route.fulfill({ status: 400, json: { message: 'missing idempotency key' } })
        return
      }
      uploaded = true
      await route.fulfill({
        status: 202,
        json: { batchId: 'e2e-batch', items: [{ filename: 'e2e.png', accepted: true, photoId: 'photo-1', taskId: 'task-1', status: 'QUEUED', error: null }] }
      })
      return
    }
    await route.fulfill({ json: uploaded || gallery.photoCount > 0 ? [readyPhoto] : [] })
  })
  await page.route('**/api/galleries/*/photo-tasks**', route => route.fulfill({
    json: { items: [], page: 0, pageSize: 100, total: 0, summary: { queued: 0, processing: 0, succeeded: uploaded ? 1 : 0, failed: 0, cancelRequested: 0, cancelled: 0 } }
  }))
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/publish-readiness`), route => route.fulfill({
    json: {
      galleryStatus: published ? 'PUBLISHED' : 'DRAFT',
      readyPhotoCount: uploaded || gallery.photoCount > 0 ? 1 : 0,
      galleryPublishable: !published,
      configDraftChanged: !options.hasConfigDraft && !configPublished && !published,
      publishedConfigVersionId: null, draftConfigVersionId: null,
      publishedAt: published ? '2026-10-07T01:00:00Z' : null, lastConfigPublishedAt: null,
      blockers: []
    }
  }))
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/viewer-config$`), async route => {
    if (route.request().method() === 'PUT') {
      savedConfig = route.request().postDataJSON()
      calls.push('put-config')
      await route.fulfill({ json: { configJson: (savedConfig as { configJson: string }).configJson, schemaVersion: 1 } })
      return
    }
    if (!options.hasConfigDraft) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'CONFIG_NOT_FOUND' }) })
      return
    }
    await route.fulfill({ json: { configJson: JSON.stringify({ presetName: 'minimal' }), schemaVersion: 1 } })
  })
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/viewer-config/publish$`), async route => {
    calls.push('config-publish')
    configPublished = true
    await route.fulfill({ json: { id: 'version-1', versionNumber: '1', title: null, note: null, isCurrent: true, createdAt: '2026-10-07T00:00:00Z' } })
  })
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/publish$`), async route => {
    calls.push('gallery-publish')
    published = true
    await route.fulfill({ json: { ...gallery, status: 'PUBLISHED', publishedAt: '2026-10-07T01:00:00Z' } })
  })
  return { calls: () => calls, savedConfig: () => savedConfig }
}

test('publishing a never-configured gallery auto-creates the recommended scene draft first', async ({ page }) => {
  const data = await mockWorkspace(page, { hasConfigDraft: false })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await page.getByRole('button', { name: '发布相册', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '分享相册' })).toBeVisible()
  expect(data.calls()).toEqual(['put-config', 'config-publish', 'gallery-publish'])
  const saved = data.savedConfig() as { configJson: string; presetName: string }
  expect(saved.presetName).toBe('jade-flow')
  expect(JSON.parse(saved.configJson).layout.params).toMatchObject({ composition: 'curated', arrangement: 'tide' })
  expect(JSON.parse(saved.configJson).background.color).toBe('#f5f8f1')
})

test('a ready album can be published from the photo workspace without opening spatial settings', async ({ page }) => {
  const data = await mockWorkspace(page, { hasConfigDraft: false, gallery: draftGallery })
  const configRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/viewer-config')) configRequests.push(request.method())
  })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  const publish = page.getByRole('button', { name: '发布相册', exact: true })
  await expect(publish).toBeEnabled()
  await expect(page.getByRole('button', { name: '预览相册' })).toBeEnabled()
  await expect(page.getByRole('region', { name: '选择展示风格' })).toHaveCount(0)
  expect(configRequests).toEqual([])
  await publish.click()
  await expect(page.getByRole('dialog', { name: '分享相册' })).toBeVisible()
  expect(data.calls()).toEqual(['put-config', 'config-publish', 'gallery-publish'])
  await expect(page.getByRole('button', { name: '复制链接', exact: true })).toBeEnabled()
})

test('processing and failed photos surface their upload history', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: false, gallery: { ...draftGallery, processingCount: 2 } })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await expect(page.getByText('2 张照片处理中', { exact: true })).toBeVisible()

  await mockWorkspace(page, { hasConfigDraft: false, gallery: { ...draftGallery, failedPhotoCount: 1 } })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await expect(page.getByText('1 张处理失败', { exact: true })).toBeVisible()
})

test('users without PUBLISH capability have no publish action', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: false, gallery: draftGallery, capabilities: ['GALLERY_READ', 'PHOTO_READ', 'PHOTO_WRITE', 'CONFIG_READ', 'CONFIG_WRITE'] })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await expect(page.getByRole('button', { name: '发布相册' })).toHaveCount(0)
})

test('first upload enables publishing without a page reload', async ({ page }) => {
  const data = await mockWorkspace(page, { hasConfigDraft: false, gallery: { ...draftGallery, photoCount: 0 } })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  const publish = page.getByRole('button', { name: '发布相册', exact: true })
  await expect(publish).toBeDisabled()
  await page.locator('input[type="file"]').setInputFiles([
    { name: 'e2e.png', mimeType: 'image/png', buffer: Buffer.from('a-png-bytes') }
  ])
  await expect(publish).toBeEnabled()
  await publish.click()
  await expect(page.getByRole('dialog', { name: '分享相册' })).toBeVisible()
  await page.getByRole('dialog', { name: '分享相册' }).getByRole('button', { name: '关闭', exact: true }).click()
  expect(data.calls()).toEqual(['put-config', 'config-publish', 'gallery-publish'])
  await expect(page.getByRole('button', { name: '分享', exact: true })).toBeVisible()
})

test('retrying a lost upload receipt reuses its key and only resends the unconfirmed photo', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: true })
  const attempts = { first: [] as string[], second: [] as string[] }
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/photos$`), async route => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fallback()
    const file = request.postDataBuffer()!.includes('first-image') ? 'first' : 'second'
    attempts[file].push(request.headers()['idempotency-key'])
    if (file === 'first' && attempts.first.length === 1) return route.abort('connectionreset')
    return route.fallback()
  })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  const files = ['first-image', 'second-image'].map(content => ({
    name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(content)
  }))
  await page.locator('input[type="file"]').setInputFiles(files)
  const retry = page.getByRole('button', { name: '重试上传' })
  await retry.click()
  await expect(page.getByText('已加入队列 1 张照片，正在后台处理。')).toBeVisible()
  expect(attempts.first).toHaveLength(2)
  expect(attempts.second).toHaveLength(1)
  expect(attempts.first[0]).toBeTruthy()
  expect(attempts.first[1]).toBe(attempts.first[0])
  expect(attempts.second[0]).not.toBe(attempts.first[0])
  await page.locator('input[type="file"]').setInputFiles(files[0])
  await expect.poll(() => attempts.first.length).toBe(3)
  expect(attempts.first[2]).not.toBe(attempts.first[0])
})

test('an incomplete upload receipt offers retry without leaving a queued task', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: true })
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/photos$`), route =>
    route.request().method() === 'POST' ? route.fulfill({ status: 202, json: { items: [] } }) : route.fallback())
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'shore.png', mimeType: 'image/png', buffer: Buffer.from('image')
  })
  await expect(page.getByRole('button', { name: '重试上传' })).toBeEnabled()
  await page.getByText('1 张照片未确认上传', { exact: true }).click()
  await expect(page.getByText('shore.png · 未收到完整的上传回执，请重试。')).toBeVisible()
  await page.getByText('上传进度与记录', { exact: true }).click()
  await expect(page.locator('.task-panel .summary-chip.queued strong')).toHaveText('0')
  await expect(page.locator('.task-panel .task-item')).toHaveCount(0)
})

test('the task list recovers when the first refresh after uploading fails', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: true, gallery: { ...draftGallery, photoCount: 0 } })
  let uploaded = false
  let failedRead = false
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/photos$`), route => {
    if (route.request().method() === 'POST') uploaded = true
    return route.fallback()
  })
  await page.route('**/api/galleries/*/photo-tasks**', route => {
    if (!uploaded) return route.fallback()
    if (!failedRead) {
      failedRead = true
      return route.fulfill({ status: 503, json: { message: '暂时无法读取队列' } })
    }
    return route.fulfill({ json: { items: [{ id: 'task-1', filename: 'shore.png', status: 'SUCCEEDED' }] } })
  })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'shore.png', mimeType: 'image/png', buffer: Buffer.from('image')
  })
  await expect(page.getByText('已加入队列 1 张照片，正在后台处理。')).toBeVisible()
  await page.getByText('上传进度与记录', { exact: true }).click()
  await expect(page.locator('.task-panel .task-item')).toContainText('shore.png', { timeout: 8000 })
})

test('publishing becomes available when the first photo finishes while another is still processing', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: true, gallery: { ...draftGallery, photoCount: 0 } })
  let taskReads = 0
  let uploadCount = 0
  let ready = false
  let releaseFirstRead!: () => void
  const firstRead = new Promise<void>(resolve => { releaseFirstRead = resolve })
  const secondPhoto = { ...readyPhoto, id: 'photo-2', status: 'PROCESSING', sortOrder: 1 }
  await page.route('**/api/galleries/*/photo-tasks**', async route => {
    if (++taskReads === 1) {
      await firstRead
      return route.fulfill({ json: { items: [], summary: {} } })
    }
    ready = taskReads > 2
    return route.fulfill({ json: {
      items: [
        { id: 'task-1', photoId: 'photo-1', filename: 'first.png', status: ready ? 'SUCCEEDED' : 'PROCESSING' },
        { id: 'task-2', photoId: 'photo-2', filename: 'second.png', status: 'PROCESSING' }
      ],
      summary: { processing: ready ? 1 : 2, succeeded: ready ? 1 : 0 }
    } })
  })
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/photos$`), route => {
    if (route.request().method() === 'POST') {
      const number = ++uploadCount
      return route.fulfill({ status: 202, json: { items: [{ accepted: true, photoId: `photo-${number}`, taskId: `task-${number}` }] } })
    }
    return route.fulfill({ json: uploadCount ? [{ ...readyPhoto, status: ready ? 'READY' : 'PROCESSING' }, secondPhoto] : [] })
  })
  await page.route('**/api/galleries/*/publish-readiness', route => route.fulfill({ json: {
    galleryStatus: 'DRAFT', readyPhotoCount: ready ? 1 : 0, galleryPublishable: ready, configDraftChanged: false,
    blockers: ready ? [] : [{ code: 'NO_READY_PHOTOS', message: '照片处理中' }]
  } }))
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await expect.poll(() => taskReads).toBe(1)
  const publish = page.getByRole('button', { name: '发布相册', exact: true })
  await expect(publish).toBeDisabled()
  try {
    await page.locator('input[type="file"]').setInputFiles(['first.png', 'second.png'].map(name => ({
      name, mimeType: 'image/png', buffer: Buffer.from('png-data')
    })))
    await expect.poll(() => uploadCount).toBe(2)
    await expect(page.getByText('已加入处理队列', { exact: true })).toBeVisible()
  } finally { releaseFirstRead() }
  await expect(publish).toBeEnabled({ timeout: 12_000 })
})

test('private publication opens sharing and can create and reuse a visitor link', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: true, gallery: { ...draftGallery, visibility: 'PRIVATE' } })
  let created = 0
  await page.route('**/api/galleries/*/share-links', route => {
    if (route.request().method() === 'POST') {
      created++
      expect(Date.parse(route.request().postDataJSON().expiresAt) - Date.now()).toBeGreaterThan(29 * 86_400_000)
      return route.fulfill({ status: 201, json: { id: 'link-1', rawToken: 'visitor-token' } })
    }
    const legacy = { id: 'legacy-link', status: 'ACTIVE', expiresAt: null }
    return route.fulfill({ json: created ? [legacy, {
      id: 'link-1', status: 'ACTIVE', expiresAt: null, shortUrl: 'https://example.test/s/album-link'
    }] : [legacy] })
  })
  await page.route('**/api/share-links/link-1/short-url', route => route.fulfill({ json: {
    shortCode: 'album-link', shortUrl: 'https://example.test/s/album-link'
  } }))
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await page.getByRole('button', { name: '发布相册', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '分享相册' })
  await dialog.getByRole('button', { name: '生成分享链接' }).click()
  await expect(dialog.getByRole('textbox', { name: '相册链接' })).toHaveValue('https://example.test/s/album-link')
  await page.reload()
  await page.getByRole('button', { name: '分享', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '复制链接' })).toBeEnabled()
  expect(created).toBe(1)
})

test('preview opens the authorized album in a tab that has no opener', async ({ page, context }) => {
  await mockWorkspace(page, { hasConfigDraft: true })
  await page.route('**/api/galleries/*/preview-token', route => route.fulfill({ json: {
    token: 'creator-preview-token', expiresAt: '2026-11-23T12:00:00Z'
  } }))
  await context.route('**/g/first-publish?preview=creator-preview-token', route => route.fulfill({
    contentType: 'text/html; charset=utf-8', body: '<h1>访客相册预览</h1>'
  }))
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  const openedPage = context.waitForEvent('page')
  await page.getByRole('button', { name: '预览相册' }).click()
  const popup = await openedPage
  await expect(popup.getByRole('heading', { name: '访客相册预览' })).toBeVisible()
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  await expect(page.getByText('浏览器拦截了新窗口', { exact: false })).toHaveCount(0)
})

test('gallery retry after config succeeds does not publish another config version', async ({ page }) => {
  const data = await mockWorkspace(page, { hasConfigDraft: false })
  let galleryAttempts = 0
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/publish$`), async route => {
    galleryAttempts++
    if (galleryAttempts === 1) {
      await route.fulfill({ status: 500, json: { message: '服务暂时不可用' } })
      return
    }
    await route.fallback()
  })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await page.getByRole('button', { name: '发布相册', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: /配置版本 v1 已生效，相册发布失败/ })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: '刷新发布状态' }).click()
  await page.getByRole('button', { name: '发布相册', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '分享相册' })).toBeVisible()
  expect(data.calls().filter(call => call === 'config-publish')).toHaveLength(1)
  expect(galleryAttempts).toBe(2)
})

test('a failed readiness refresh disables publishing until the status recovers', async ({ page }) => {
  const data = await mockWorkspace(page, { hasConfigDraft: true })
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  const publish = page.getByRole('button', { name: '发布相册', exact: true })
  await expect(publish).toBeEnabled()
  let readinessUnavailable = true
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/publish-readiness`), route => readinessUnavailable ? route.fulfill({ status: 503, json: { message: '状态服务暂时不可用' } }) : route.fallback())
  await page.getByRole('button', { name: '相册选项' }).click()
  await page.locator('.workspace-menu').getByRole('button', { name: '刷新发布状态' }).click()
  await expect(page.getByRole('alert').filter({ hasText: '状态服务暂时不可用' })).toBeVisible()
  await expect(publish).toBeDisabled()
  expect(data.calls()).toEqual([])
  readinessUnavailable = false
  await page.locator('.workspace-notice').getByRole('button', { name: '刷新发布状态' }).click()
  await expect(publish).toBeEnabled()
})

test('password draft can reach its access settings before publishing', async ({ page }) => {
  await mockWorkspace(page, { hasConfigDraft: true, gallery: { ...draftGallery, visibility: 'PASSWORD' } })
  await page.route(new RegExp(`/api/galleries/${GALLERY_ID}/publish-readiness`), route => route.fulfill({ json: { galleryStatus: 'DRAFT', readyPhotoCount: 1, galleryPublishable: false, configDraftChanged: false, blockers: [{ code: 'PASSWORD_REQUIRED', message: '请先设置展厅访问密码，再发布展厅。' }] } }))
  await page.route('**/api/galleries/*/share-links**', route => route.fulfill({ json: [] }))
  await page.goto(`/app/galleries/${GALLERY_ID}`)
  await expect(page.getByRole('button', { name: '发布相册', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '访问与分享设置' }).click()
  await expect(page.getByRole('dialog', { name: '相册访问设置' })).toBeVisible()
  await expect(page.getByLabel('相册访问密码')).toBeVisible()
})
