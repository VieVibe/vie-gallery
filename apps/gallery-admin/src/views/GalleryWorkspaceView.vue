<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { ViewerConfigVersion } from '@vie/gallery-contracts'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useToast } from '../composables/useToast'
import { useAuth } from '../composables/useAuth'
import { useGalleryWorkspace, type UploadEntry, type UploadFileResult, type WorkspacePhoto } from '../composables/useGalleryWorkspace'
import { useUploadTasks, type UploadTask } from '../composables/useUploadTasks'
import { usePublishCenter } from '../composables/usePublishCenter'
import { useConfigVersionMetadata } from '../composables/useConfigVersionMetadata'
import { useModalFocus } from '../composables/useModalFocus'
import { apiFetch } from '../api'
import { openCreatorPreview } from '../lib/preview'
import Icon from '../components/Icon.vue'
import BrandMark from '../components/BrandMark.vue'
import ConfirmModal from '../components/ConfirmModal.vue'
import LightboxModal from '../components/LightboxModal.vue'
import GalleryUploadDropzone from '../components/gallery-workspace/GalleryUploadDropzone.vue'
import GalleryPhotoGrid from '../components/gallery-workspace/GalleryPhotoGrid.vue'
import GalleryPhotoList from '../components/gallery-workspace/GalleryPhotoList.vue'
import PhotoThumbnail from '../components/gallery-workspace/PhotoThumbnail.vue'
import UploadTaskCenter from '../components/gallery-workspace/UploadTaskCenter.vue'
import ShareDeliveryPanel from '../components/gallery-workspace/ShareDeliveryPanel.vue'
import VersionMetadataFields from '../components/gallery-config/VersionMetadataFields.vue'

type LightboxPhoto = Omit<WorkspacePhoto, 'title'> & { title?: string }
const QuickStylePicker = defineAsyncComponent(() => import('../components/gallery-workspace/QuickStylePicker.vue'))

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { currentUser, loading: authLoading, can, userDisplayName, userInitial, isOwner, logout, clearUser } = useAuth()
const canPhotoWrite = can('PHOTO_WRITE')
const canPublish = can('PUBLISH')
const canShareManage = can('SHARE_MANAGE')
const canConfig = can('CONFIG_WRITE')
const galleryId = computed(() => String(route.params.id || ''))
const workspace = useGalleryWorkspace(galleryId, computed(() => !!currentUser.value && !authLoading.value))
const workspaceReady = computed(() => !!currentUser.value && !authLoading.value && workspace.gallery.value?.id === galleryId.value)
const taskCenter = useUploadTasks(
  galleryId,
  workspaceReady,
  { onPhotoStatusChange: reloadGalleryAccess }
)
const publishCenter = usePublishCenter(galleryId, workspaceReady)
const versionMetadata = useConfigVersionMetadata()
const showPublishMetadata = ref(false)
const styleSaving = ref(false)
const spatialOpened = ref(false)
const showAlbumOptions = ref(false)
const albumOptionsTrigger = ref<HTMLButtonElement | null>(null)
const albumTitle = ref<HTMLHeadingElement | null>(null)
const toolbarStart = ref<HTMLElement | null>(null)
const toolbarPinned = ref(false)

watch(toolbarStart, (start, _, onCleanup) => {
  toolbarPinned.value = false
  if (!start) return
  const observer = new IntersectionObserver(([entry]) => {
    toolbarPinned.value = !!entry && !entry.isIntersecting && entry.boundingClientRect.top < 0
  })
  observer.observe(start)
  onCleanup(() => observer.disconnect())
})

function returnToAlbum() {
  albumTitle.value?.focus({ preventScroll: true })
  albumTitle.value?.scrollIntoView({ block: 'start' })
}

const publishedShareTrigger = ref<HTMLButtonElement | null>(null)

const photoViewMode = ref<'grid' | 'list'>('grid')
const photoGridRef = ref<{ clearSelection: () => void } | null>(null)
const photoListRef = ref<{ clearSelection: () => void } | null>(null)
const dropzoneRef = ref<{ chooseFiles: () => void } | null>(null)
const failedUploadFiles = ref<UploadFileResult[]>([])
const userMenuOpen = ref(false)
const showLightbox = ref(false)
const lightboxPhotoId = ref<string | null>(null)
const photoToDelete = ref<Pick<WorkspacePhoto, 'id'> | null>(null)
const batchPhotoIdsToDelete = ref<string[]>([])
const showBatchDeleteModal = ref(false)
const deletingBatch = ref(false)
const showShortcutsModal = ref(false)
const showUnpublishModal = ref(false)
const showShareModal = ref(false)
const visitorAllowDownload = ref(false)
const previewOpening = ref(false)
let mounted = true
const { root: shortcutsModalRoot } = useModalFocus(showShortcutsModal, {
  onEscape: () => { showShortcutsModal.value = false }
})

const lightboxPhotos = computed<LightboxPhoto[]>(() => workspace.photos.value.map(photo => ({
  ...photo,
  title: photo.title || undefined
})))
const lightboxIndex = computed(() => Math.max(0, lightboxPhotos.value.findIndex(photo => photo.id === lightboxPhotoId.value)))

function selectLightboxPhoto(index: number) {
  const photo = lightboxPhotos.value[index]
  if (photo) lightboxPhotoId.value = photo.id
}

const albumPublished = computed(() => workspace.gallery.value?.status === 'PUBLISHED')
const coverIndex = computed(() => workspace.photos.value.findIndex(photo => photo.cover && photo.thumbnailUrl))
const coverPhoto = computed(() => workspace.photos.value[coverIndex.value])
const hasReadyPhotos = computed(() => workspace.photos.value.some(photo => photo.status === 'READY'))
const settingsChanged = computed(() => !!publishCenter.readiness.value?.configDraftChanged)
const blockers = computed(() => publishCenter.readiness.value?.blockers ?? [])
const accessNeedsPassword = computed(() => blockers.value.some(blocker => blocker.code === 'PASSWORD_REQUIRED'))
const processingCount = computed(() => workspace.gallery.value?.processingCount ?? 0)
const failedCount = computed(() => workspace.gallery.value?.failedPhotoCount ?? 0)
const publicationBlocked = computed(() => {
  const readiness = publishCenter.readiness.value
  return !canPublish.value || !readiness?.galleryPublishable || readiness.readyPhotoCount < 1 ||
    blockers.value.length > 0 || !!publishCenter.error.value || publishCenter.loading.value ||
    publishCenter.publishing.value || publishCenter.unpublishing.value || workspace.loading.value ||
    workspace.uploading.value || styleSaving.value
})

watch(galleryId, () => {
  spatialOpened.value = false
  styleSaving.value = false
  showAlbumOptions.value = false
  showShareModal.value = false
  failedUploadFiles.value = []
})

watch(() => workspace.error.value, (err) => {
  if (err?.kind === 'unauthorized') {
    clearUser()
    router.push({ name: 'overview' })
  }
})

// 切换视图时清空多选，避免把网格的选中状态带进列表。
watch(photoViewMode, () => {
  photoGridRef.value?.clearSelection()
  photoListRef.value?.clearSelection()
})

// 上传进行中关闭/刷新页面时给出浏览器级提醒。
function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!workspace.uploading.value) return
  event.preventDefault()
  event.returnValue = '照片正在上传，离开将中断上传。'
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  window.addEventListener('keydown', handleWorkspaceKeydown)
})
onUnmounted(() => {
  mounted = false
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('keydown', handleWorkspaceKeydown)
})

// ---- 键盘快捷键（输入框聚焦或弹窗打开时跳过） ----
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable
}

function handleWorkspaceKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target) || showShareModal.value || showBatchDeleteModal.value || showUnpublishModal.value || showPublishMetadata.value) return
  if (event.metaKey || event.ctrlKey || event.altKey) return

  if (event.key === 'Escape') {
    showShortcutsModal.value = false
    userMenuOpen.value = false
    closeAlbumOptions()
    return
  }
  if (showLightbox.value || photoToDelete.value || showShortcutsModal.value) return

  const key = event.key.toLowerCase()
  if (key === 'u' && canPhotoWrite.value) {
    event.preventDefault()
    dropzoneRef.value?.chooseFiles()
  } else if (key === 'g') {
    photoViewMode.value = 'grid'
  } else if (key === 'l') {
    photoViewMode.value = 'list'
  } else if (key === '?') {
    event.preventDefault()
    showShortcutsModal.value = !showShortcutsModal.value
  }
}

function goToOverview() {
  router.push({ name: 'overview' })
}

function goToConfig() {
  router.push({ name: 'gallery-config', params: { id: galleryId.value } })
}

function revealSpatialSettings(event: Event) {
  if ((event.currentTarget as HTMLDetailsElement).open) spatialOpened.value = true
}

function closeAlbumOptions() {
  if (showAlbumOptions.value) albumOptionsTrigger.value?.focus({ preventScroll: true })
  showAlbumOptions.value = false
}

async function openViewer() {
  const gallery = workspace.gallery.value
  if (!gallery || previewOpening.value) return
  previewOpening.value = true
  try {
    await openCreatorPreview(gallery.id, gallery.slug)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '暂时无法打开内部预览，请稍后重试。')
  } finally {
    previewOpening.value = false
  }
}

function openLightbox(index: number) {
  selectLightboxPhoto(index)
  showLightbox.value = true
}

async function handleLogout() {
  await logout()
  toast.info('已安全退出登录')
  router.push('/')
}

function openPublishMetadata() {
  if (publicationBlocked.value) return
  closeAlbumOptions()
  versionMetadata.reset()
  showPublishMetadata.value = true
}

async function handlePublishAll() {
  if (publicationBlocked.value) return
  versionMetadata.reset()
  await confirmPublishAll()
}

async function confirmPublishAll() {
  if (publicationBlocked.value || !versionMetadata.valid.value) return
  const publishingGallery = galleryId.value
  try {
    await publishCenter.publishAll(versionMetadata.toRequest())
    if (!mounted || galleryId.value !== publishingGallery) return
    await workspace.reload()
    if (!mounted || galleryId.value !== publishingGallery) return
    showPublishMetadata.value = false
    versionMetadata.reset()
    toast.success('相册已发布')
    if (canShareManage.value) {
      await nextTick()
      publishedShareTrigger.value?.focus({ preventScroll: true })
      await openShareModal()
    }
  } catch (error) {
    if (!mounted || galleryId.value !== publishingGallery) return
    if (publishCenter.appliedConfigVersion.value) {
      showPublishMetadata.value = false
      versionMetadata.reset()
    }
    toast.error(error instanceof Error ? error.message : '发布失败，请重试。')
  }
}

function promptUnpublish() {
  if (!isOwner.value) return
  closeAlbumOptions()
  showUnpublishModal.value = true
}

async function confirmUnpublish() {
  showUnpublishModal.value = false
  try {
    await publishCenter.unpublish()
    await workspace.reload()
    toast.success('已撤回发布，展厅已恢复为草稿状态。')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '撤回发布失败。')
  }
}

function handleUpload(files: FileList | File[]) {
  return submitUploads(Array.from(files, file => ({ file, idempotencyKey: crypto.randomUUID() })))
}

async function submitUploads(entries: UploadEntry[]) {
  if (!canPhotoWrite.value || workspace.uploading.value) return
  const uploadingGallery = galleryId.value
  const isSameAlbum = () => mounted && galleryId.value === uploadingGallery
  try {
    const summary = await workspace.uploadFiles(entries, async () => {
      if (!isSameAlbum()) return
      await taskCenter.load(true, true)
      if (isSameAlbum()) await reloadGalleryAccess()
    })
    if (!isSameAlbum()) return
    const failedFiles = summary.results.filter(result => !result.ok)
    if (failedFiles.length) {
      failedUploadFiles.value.push(...failedFiles)
      toast.warning(`已加入队列 ${summary.succeeded} 张，${failedFiles.length} 张上传失败（${failedFiles[0]?.message || '网络异常'}）。`)
    } else if (summary.succeeded > 0) {
      toast.success(`已加入队列 ${summary.succeeded} 张照片，正在后台处理。`)
    }
  } catch (error) {
    if (!isSameAlbum()) return
    const message = error instanceof Error ? error.message : '照片上传失败，请重试。'
    failedUploadFiles.value.push(...entries.map(entry => ({ ...entry, ok: false, message })))
    toast.error(message)
  }
}

async function handleRetryFailedUploads() {
  if (!canPhotoWrite.value || !failedUploadFiles.value.length || workspace.uploading.value) return
  const retrying = failedUploadFiles.value
  failedUploadFiles.value = []
  await submitUploads(retrying)
}

function handleInvalidSelection(detail: { message: string; count: number }) {
  toast.warning(`${detail.message}。`)
}

async function handleRetryTask(task: UploadTask) {
  if (!canPhotoWrite.value) return
  try {
    await taskCenter.retry(task)
    await workspace.reload()
    toast.success('任务已重新排队。')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '任务重试失败。')
  }
}

async function handleCancelTask(task: UploadTask) {
  if (!canPhotoWrite.value) return
  try {
    await taskCenter.cancel(task)
    toast.success('已取消任务。')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '取消任务失败。')
  }
}

async function handleSetCover(photo: Pick<WorkspacePhoto, 'id'>) {
  if (!canPhotoWrite.value) return
  try {
    await workspace.setCover(photo)
    toast.success('已设为封面。')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '设置封面失败。')
  }
}

function promptDeletePhoto(photo: Pick<WorkspacePhoto, 'id'>) {
  if (!canPhotoWrite.value) return
  photoToDelete.value = photo
}

function promptBatchDelete(ids: string[]) {
  if (!canPhotoWrite.value || !ids.length) return
  batchPhotoIdsToDelete.value = ids
  showBatchDeleteModal.value = true
}

async function confirmBatchDelete() {
  if (!batchPhotoIdsToDelete.value.length || deletingBatch.value) return
  deletingBatch.value = true
  try {
    const { succeeded, failed } = await workspace.deletePhotos(batchPhotoIdsToDelete.value)
    showBatchDeleteModal.value = false
    photoGridRef.value?.clearSelection()
    photoListRef.value?.clearSelection()
    if (failed === 0) {
      toast.success(`成功从展厅移除 ${succeeded} 张照片。`)
    } else {
      toast.warning(`已移除 ${succeeded} 张照片，${failed} 张操作失败。`)
    }
    batchPhotoIdsToDelete.value = []
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '批量删除失败。')
  } finally {
    deletingBatch.value = false
  }
}

async function handleUpdatePhotoTitle(payload: { photo: { id: string }; title: string }) {
  if (!canPhotoWrite.value) return
  try {
    await workspace.updatePhotoTitle(payload.photo.id, payload.title)
    toast.success('照片标题已更新。')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '更新照片标题失败。')
  }
}

async function handleMovePhoto(payload: { id: string; direction: 'up' | 'down' }) {
  if (!canPhotoWrite.value) return
  try {
    await workspace.movePhoto(payload.id, payload.direction)
    toast.success('照片排序已更新。')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '调整照片排序失败。')
  }
}

function handleListOpen(photo: WorkspacePhoto) {
  const index = workspace.photos.value.findIndex(item => item.id === photo.id)
  if (index !== -1) openLightbox(index)
}

async function handleReorder(payload: { fromIndex: number; toIndex: number }) {
  if (!canPhotoWrite.value) return
  const ids = workspace.photos.value.map(photo => photo.id)
  const { fromIndex, toIndex } = payload
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= ids.length || toIndex >= ids.length) return
  const [moved] = ids.splice(fromIndex, 1)
  if (moved === undefined) return
  ids.splice(toIndex, 0, moved)
  try {
    await workspace.reorderPhotos(ids)
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '调整照片排序失败。')
  }
}

async function handleRetryFailedGrid() {
  if (!canPhotoWrite.value) return
  // Find failed tasks or retryable tasks in taskCenter
  const failedTasks = taskCenter.tasks.value.filter(t => t.status === 'FAILED' && t.retryable)
  if (!failedTasks.length) {
    toast.info('暂无可重试的后台处理任务。')
    return
  }
  let successCount = 0
  for (const task of failedTasks) {
    try {
      await taskCenter.retry(task)
      successCount++
    } catch {
      // Continue retrying others
    }
  }
  if (successCount > 0) {
    await workspace.reload()
    toast.success(`已为 ${successCount} 个失败项重新排队。`)
  } else {
    toast.error('重试失败项失败，请检查网络后重试。')
  }
}

interface PendingPhotoDeletion {
  photo: WorkspacePhoto
  index: number
  timer: number
}

let pendingPhotoDeletion: PendingPhotoDeletion | null = null

function flushPendingPhotoDeletion() {
  const pending = pendingPhotoDeletion
  if (!pending) return
  window.clearTimeout(pending.timer)
  pendingPhotoDeletion = null
  workspace.deletePhoto(pending.photo.id).catch(() => {
    toast.error('删除照片失败，请刷新后重试。')
    workspace.reload()
  })
}

function undoPhotoDeletion() {
  const pending = pendingPhotoDeletion
  if (!pending) return
  window.clearTimeout(pending.timer)
  pendingPhotoDeletion = null
  workspace.restorePhotoLocally(pending.photo, pending.index)
  toast.success('已撤销删除。')
}

async function confirmDeletePhoto() {
  const target = photoToDelete.value
  if (!target) return
  const index = workspace.photos.value.findIndex(photo => photo.id === target.id)
  const photo = index === -1 ? undefined : workspace.photos.value[index]
  if (!photo) {
    photoToDelete.value = null
    return
  }
  photoToDelete.value = null
  showLightbox.value = false

  // 已有等待中的删除先立即执行，避免多次确认互相覆盖。
  flushPendingPhotoDeletion()

  // 乐观移除 + 8 秒撤销窗口，超时才真正调用删除接口（防误删安全网）。
  workspace.removePhotoLocally(target.id)
  const timer = window.setTimeout(() => {
    pendingPhotoDeletion = null
    workspace.deletePhoto(target.id).catch(() => {
      toast.error('删除照片失败，请刷新后重试。')
      workspace.reload()
    })
  }, 8000)
  pendingPhotoDeletion = { photo, index, timer }
  toast.actionable({
    type: 'info',
    message: `已删除「${photo.title || '未命名照片'}」，8 秒内可撤销。`,
    duration: 8000,
    action: { label: '撤销', handler: undoPhotoDeletion }
  })
}

async function loadGalleryConfig() {
  const gId = galleryId.value
  if (!gId) return
  visitorAllowDownload.value = false
  try {
    const res = await apiFetch(`/api/galleries/${gId}/viewer-config`)
    if (!res.ok) return
    const data = await res.json() as {
      configJson?: string
      publishedVersionId?: string | null
      publishedConfigJson?: string | null
    }
    // Prefer published snapshot so share panel matches what visitors see
    if (data.publishedConfigJson) {
      const parsed = JSON.parse(data.publishedConfigJson) as { visitorAllowDownload?: boolean }
      visitorAllowDownload.value = !!parsed.visitorAllowDownload
      return
    }
    if (data.publishedVersionId) {
      const versionRes = await apiFetch(`/api/galleries/${gId}/viewer-config/versions/${data.publishedVersionId}`)
      if (!versionRes.ok) return
      const published = await versionRes.json() as ViewerConfigVersion
      if (published?.configJson) {
        const parsed = JSON.parse(published.configJson) as { visitorAllowDownload?: boolean }
        visitorAllowDownload.value = !!parsed.visitorAllowDownload
      }
      return
    }
    // No published config yet — visitors do not get download
    visitorAllowDownload.value = false
  } catch {
    visitorAllowDownload.value = false
  }
}

async function openShareModal() {
  if (!canShareManage.value) return
  const gallery = workspace.gallery.value
  if (!gallery) return
  closeAlbumOptions()
  showShareModal.value = true
  if (gallery.status === 'PUBLISHED') await loadGalleryConfig()
}

async function reloadGalleryAccess() {
  await workspace.reload()
  await publishCenter.loadReadiness()
}
</script>

<template>
  <div class="album-workspace">
    <header v-if="currentUser" class="workspace-nav">
      <RouterLink to="/" class="workspace-brand"><BrandMark :size="28" /><span>阳光明媚</span></RouterLink>
      <div class="workspace-account" @focusout="!($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node | null) && (userMenuOpen = false)">
        <button class="workspace-user-chip" type="button" :aria-expanded="userMenuOpen" aria-label="账户菜单" @click="userMenuOpen = !userMenuOpen">
          <span class="workspace-avatar">{{ userInitial }}</span>
          <span class="workspace-user-name">{{ userDisplayName }}</span>
          <Icon name="chevron-down" :size="14" />
        </button>
        <div v-if="userMenuOpen" class="workspace-menu">
          <RouterLink v-if="isOwner" to="/members">成员管理</RouterLink>
          <button type="button" @click="handleLogout">退出登录</button>
        </div>
      </div>
    </header>

    <div v-if="authLoading" class="workspace-state" role="status">正在验证登录状态…</div>
    <div v-else-if="!currentUser" class="workspace-state">
      <h1>请先登录</h1>
      <button class="btn btn-primary" type="button" @click="goToOverview">返回登录</button>
    </div>
    <div v-else-if="workspace.error.value" class="workspace-state" role="alert">
      <h1>加载相册失败</h1>
      <p>{{ workspace.error.value.message }}</p>
      <div class="state-actions">
        <button class="btn btn-secondary" type="button" @click="goToOverview">返回相册列表</button>
        <button class="btn btn-primary" type="button" @click="reloadGalleryAccess">重新加载</button>
      </div>
    </div>
    <div v-else-if="workspace.gallery.value?.id !== galleryId" class="workspace-state workspace-loading" role="status">
      <p>正在打开相册…</p>
      <div class="loading-tiles" aria-hidden="true"><span v-for="i in 4" :key="i"></span></div>
    </div>
    <div v-else-if="workspace.gallery.value" class="workspace-body">
      <RouterLink to="/" class="workspace-back"><Icon name="arrow-left" :size="16" />我的相册</RouterLink>

      <section class="workspace-heading" aria-labelledby="workspace-album-title">
        <button v-if="coverPhoto" class="workspace-cover" type="button" aria-label="查看相册封面" @click="openLightbox(coverIndex)">
          <PhotoThumbnail :photo="coverPhoto" compact />
          <span>封面</span>
        </button>
        <div class="workspace-title">
          <h1 id="workspace-album-title" ref="albumTitle" tabindex="-1">{{ workspace.gallery.value.name }}</h1>
          <div class="workspace-meta">
            <span class="workspace-status" :class="{ 'is-published': albumPublished }">
              {{ albumPublished ? '已发布' : workspace.gallery.value.status === 'ARCHIVED' ? '已归档' : '草稿' }}
            </span>
            <span class="workspace-visibility">
              <Icon :name="workspace.gallery.value.visibility === 'PUBLIC' ? 'eye' : 'lock'" :size="15" />
              {{ workspace.gallery.value.visibility === 'PUBLIC' ? '公开访问' : workspace.gallery.value.visibility === 'PASSWORD' ? '密码保护' : '专属链接访问' }}
            </span>
          </div>
        </div>
        <div class="workspace-actions">
          <button class="btn workspace-button secondary" type="button" :disabled="previewOpening || !hasReadyPhotos" @click="openViewer">
            <Icon name="eye" :size="17" />{{ previewOpening ? '正在打开…' : '预览相册' }}
          </button>
          <button v-if="canPublish && !albumPublished" class="btn workspace-button primary" type="button" :disabled="publicationBlocked" @click="handlePublishAll">
            <Icon name="send" :size="16" />{{ publishCenter.publishing.value ? '正在发布…' : '发布相册' }}
          </button>
          <button v-if="canShareManage && albumPublished" ref="publishedShareTrigger" class="btn workspace-button primary" type="button" @click="openShareModal">
            <Icon name="share" :size="17" />分享
          </button>
          <div v-if="canConfig || canShareManage || canPublish" class="workspace-options"
            @focusout="!($event.currentTarget as HTMLElement).contains($event.relatedTarget as Node | null) && (showAlbumOptions = false)">
            <button ref="albumOptionsTrigger" class="btn workspace-button secondary icon-button" type="button" aria-label="相册选项" :aria-expanded="showAlbumOptions" @click="showAlbumOptions = !showAlbumOptions">
              <Icon name="more" :size="20" />
            </button>
            <div v-if="showAlbumOptions" class="workspace-menu">
              <button v-if="canConfig" type="button" @click="goToConfig">空间设计与版本</button>
              <button v-if="canShareManage" type="button" @click="openShareModal">访问与分享设置</button>
              <button v-if="canPublish" type="button" :disabled="publishCenter.loading.value" @click="publishCenter.loadReadiness">刷新发布状态</button>
              <button v-if="canPublish && settingsChanged" type="button" :disabled="publicationBlocked" @click="openPublishMetadata">发布并添加版本说明</button>
              <button v-if="canPublish && isOwner && albumPublished" class="workspace-danger" type="button" :disabled="publishCenter.unpublishing.value || publishCenter.publishing.value" @click="promptUnpublish">撤回发布</button>
            </div>
          </div>
        </div>
      </section>

      <div v-if="canPublish && publishCenter.error.value" class="workspace-notice is-error">
        <p role="alert">{{ publishCenter.error.value }}</p>
        <button class="notice-action" type="button" :disabled="publishCenter.loading.value" @click="publishCenter.loadReadiness">刷新发布状态</button>
      </div>
      <div v-else-if="canPublish && blockers.some(blocker => blocker.code !== 'NO_READY_PHOTOS')" class="workspace-notice is-error">
        <ul role="status"><li v-for="blocker in blockers.filter(item => item.code !== 'NO_READY_PHOTOS')" :key="blocker.code">{{ blocker.message }}</li></ul>
        <button v-if="accessNeedsPassword && canShareManage" class="notice-action" type="button" @click="openShareModal">访问与分享设置</button>
      </div>
      <div v-else-if="canPublish && albumPublished && settingsChanged" class="workspace-notice">
        <p>空间设置有更新待发布</p>
        <button class="notice-action" type="button" :disabled="publicationBlocked" @click="handlePublishAll">
          {{ publishCenter.publishing.value ? '正在发布…' : '发布设置更新' }}
        </button>
      </div>

      <div v-if="canPhotoWrite || taskCenter.tasks.value.length || canConfig" class="workspace-disclosures">
        <details
          v-if="canPhotoWrite || taskCenter.tasks.value.length"
          class="workspace-disclosure"
        >
          <summary>
            <Icon name="clock" :size="17" />
            <span>上传进度与记录</span>
            <span v-if="workspace.uploading.value || processingCount || failedCount" class="disclosure-status" role="status">
              <span v-if="workspace.uploading.value">上传中 {{ workspace.uploadProgress.value }}%</span>
              <span v-if="processingCount">{{ processingCount }} 张照片处理中</span>
              <span v-if="failedCount">{{ failedCount }} 张处理失败</span>
            </span>
            <Icon name="chevron-down" :size="16" class="disclosure-chevron" />
          </summary>
          <UploadTaskCenter
            :tasks="taskCenter.tasks.value"
            :summary="taskCenter.summary.value"
            :loading="taskCenter.loading.value"
            :refreshing="taskCenter.refreshing.value"
            :error="taskCenter.error.value"
            :can-write="canPhotoWrite"
            :filter="taskCenter.filter.value"
            @update:filter="taskCenter.filter.value = $event"
            @refresh="taskCenter.load(true)"
            @retry="handleRetryTask"
            @cancel="handleCancelTask"
          />
        </details>

        <details v-if="canConfig" class="workspace-disclosure workspace-spatial" @toggle="revealSpatialSettings">
          <summary><Icon name="gallery" :size="17" /><span>空间展示</span><Icon name="chevron-down" :size="16" class="disclosure-chevron" /></summary>
          <QuickStylePicker
            v-if="spatialOpened"
            :key="galleryId"
            :gallery-id="galleryId"
            :can-write="canConfig && !publishCenter.publishing.value"
            :photos="workspace.photos.value"
            @busy="styleSaving = $event"
            @saved="publishCenter.loadReadiness"
          />
          <RouterLink class="workspace-config-link" :to="{ name: 'gallery-config', params: { id: galleryId } }">打开空间设计与版本</RouterLink>
        </details>
      </div>

      <section id="workspace-photos" class="photo-panel" aria-labelledby="workspace-photos-title">
        <div ref="toolbarStart" class="toolbar-start" aria-hidden="true"></div>
        <div class="photo-toolbar" :class="{ 'is-pinned': toolbarPinned }">
          <div class="photo-toolbar-title">
            <button v-if="toolbarPinned" class="return-to-album" type="button" aria-label="返回相册操作" title="返回相册操作" @click="returnToAlbum"><Icon name="arrow-up" :size="17" /></button>
            <h2 id="workspace-photos-title">照片 <span class="photo-total">{{ workspace.photos.value.length }}</span></h2>
          </div>
          <div class="photo-tools">
            <GalleryUploadDropzone
              v-if="canPhotoWrite && workspace.photos.value.length"
              ref="dropzoneRef"
              compact
              :uploading="workspace.uploading.value"
              :progress="workspace.uploadProgress.value"
              :status-text="workspace.uploadStatusText.value"
              @files="handleUpload"
              @invalid="handleInvalidSelection"
            />
            <div v-if="workspace.photos.value.length" class="view-toggle" role="group" aria-label="照片视图">
              <button class="view-btn" :class="{ active: photoViewMode === 'grid' }" type="button" :aria-pressed="photoViewMode === 'grid'" aria-label="网格视图" title="网格视图（G）" @click="photoViewMode = 'grid'">
                <Icon name="grid" :size="14" />
              </button>
              <button class="view-btn" :class="{ active: photoViewMode === 'list' }" type="button" :aria-pressed="photoViewMode === 'list'" aria-label="列表视图" title="列表视图（L）" @click="photoViewMode = 'list'">
                <Icon name="list" :size="14" />
              </button>
              <button class="view-btn" type="button" aria-label="键盘快捷键" title="键盘快捷键（?）" @click="showShortcutsModal = true">
                <span class="shortcut-mark">?</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="failedUploadFiles.length" class="workspace-notice is-error">
          <details class="upload-failures">
            <summary>{{ failedUploadFiles.length }} 张照片未确认上传</summary>
            <ul>
              <li v-for="entry in failedUploadFiles" :key="entry.idempotencyKey">{{ entry.file.name }} · {{ entry.message }}</li>
            </ul>
          </details>
          <button class="notice-action" type="button" :disabled="workspace.uploading.value" @click="handleRetryFailedUploads">重试上传</button>
        </div>
        <div v-if="photoViewMode === 'grid'" class="photo-grid-wrapper">
          <GalleryPhotoGrid
            ref="photoGridRef"
            :photos="workspace.photos.value"
            :can-write="canPhotoWrite"
            @reorder="handleReorder"
            @open="openLightbox"
            @set-cover="handleSetCover"
            @delete="promptDeletePhoto"
            @batch-delete="promptBatchDelete"
            @move-photo="handleMovePhoto"
            @retry-failed="handleRetryFailedGrid"
          >
            <template #dropzone>
              <GalleryUploadDropzone
                v-if="canPhotoWrite && !workspace.photos.value.length"
                ref="dropzoneRef"
                :uploading="workspace.uploading.value"
                :progress="workspace.uploadProgress.value"
                :status-text="workspace.uploadStatusText.value"
                @files="handleUpload"
                @invalid="handleInvalidSelection"
              />
            </template>
          </GalleryPhotoGrid>
        </div>
        <div v-else class="photo-list">
          <GalleryUploadDropzone
            v-if="canPhotoWrite && !workspace.photos.value.length"
            ref="dropzoneRef"
            class="list-dropzone"
            :uploading="workspace.uploading.value"
            :progress="workspace.uploadProgress.value"
            :status-text="workspace.uploadStatusText.value"
            @files="handleUpload"
            @invalid="handleInvalidSelection"
          />
          <GalleryPhotoList
            ref="photoListRef"
            :photos="workspace.photos.value"
            :can-write="canPhotoWrite"
            @open="handleListOpen"
            @set-cover="handleSetCover"
            @delete="promptDeletePhoto"
            @batch-delete="promptBatchDelete"
            @move-photo="handleMovePhoto"
            @reorder="handleReorder"
            @update-title="handleUpdatePhotoTitle"
            @retry-failed="handleRetryFailedGrid"
          />
        </div>
      </section>
    </div>

    <ShareDeliveryPanel
      :key="galleryId"
      :show="showShareModal"
      :gallery="workspace.gallery.value"
      :is-owner="isOwner"
      :can-manage="canShareManage"
      :visitor-allow-download="visitorAllowDownload"
      @close="showShareModal = false"
      @open-config="goToConfig"
      @gallery-updated="reloadGalleryAccess"
    />

    <ConfirmModal
      :show="showPublishMetadata"
      title="发布展厅配置"
      message="系统会自动分配配置版本编号。名称和备注仅用于管理，不会影响访客看到的照片。"
      confirm-text="确认发布"
      :loading="publishCenter.publishing.value"
      @confirm="confirmPublishAll"
      @cancel="showPublishMetadata = false; versionMetadata.reset()"
    >
      <VersionMetadataFields
        v-model:title="versionMetadata.title.value"
        v-model:note="versionMetadata.note.value"
        :disabled="publishCenter.publishing.value"
        :error="versionMetadata.error.value"
      />
    </ConfirmModal>

    <ConfirmModal
      :show="showUnpublishModal"
      title="确认撤回展厅发布？"
      message="撤回后，访客将无法再公开访问此展厅，已生成的公开链接将暂时失效。"
      confirm-text="确认撤回"
      danger
      :loading="publishCenter.unpublishing.value"
      @confirm="confirmUnpublish"
      @cancel="showUnpublishModal = false"
    />

    <ConfirmModal
      :show="!!photoToDelete"
      title="确认删除此照片？"
      message="照片将从相册移除。你可以在 8 秒内撤销。"
      confirm-text="确认删除"
      danger
      @confirm="confirmDeletePhoto"
      @cancel="photoToDelete = null"
    />

    <ConfirmModal
      :show="showBatchDeleteModal"
      title="确认批量删除选中的照片？"
      :message="`将从展厅移除选中的 ${batchPhotoIdsToDelete.length} 张照片，此操作不可撤销。`"
      confirm-text="确认删除"
      danger
      :loading="deletingBatch"
      @confirm="confirmBatchDelete"
      @cancel="showBatchDeleteModal = false"
    />

    <LightboxModal
      :show="showLightbox"
      :photos="lightboxPhotos"
      :current-index="lightboxIndex"
      :can-write="canPhotoWrite"
      @close="showLightbox = false"
      @select="selectLightboxPhoto"
      @set-cover="handleSetCover"
      @delete="promptDeletePhoto"
      @update-title="handleUpdatePhotoTitle"
      @move-up="handleMovePhoto({ id: $event.id, direction: 'up' })"
      @move-down="handleMovePhoto({ id: $event.id, direction: 'down' })"
    />

    <Transition name="modal-fade">
      <div v-if="showShortcutsModal" class="shortcuts-backdrop" @click.self="showShortcutsModal = false">
        <div ref="shortcutsModalRoot" class="shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" tabindex="-1">
          <div class="shortcuts-head">
            <h2 id="shortcuts-title">键盘快捷键</h2>
            <button class="shortcuts-close" type="button" aria-label="关闭" @click="showShortcutsModal = false">
              <Icon name="x" :size="16" />
            </button>
          </div>
          <ul class="shortcut-list">
            <li><kbd>U</kbd><span>打开文件选择上传照片</span></li>
            <li><kbd>Ctrl</kbd> + <kbd>V</kbd><span>粘贴剪贴板图片直接上传</span></li>
            <li><kbd>G</kbd><span>切换到网格视图</span></li>
            <li><kbd>L</kbd><span>切换到列表视图</span></li>
            <li><kbd>←</kbd> <kbd>→</kbd><span>灯箱中切换上一张 / 下一张</span></li>
            <li><kbd>Esc</kbd><span>关闭菜单 / 灯箱 / 弹窗</span></li>
            <li><kbd>?</kbd><span>显示本帮助</span></li>
          </ul>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped src="../styles/album-workspace.css"></style>
