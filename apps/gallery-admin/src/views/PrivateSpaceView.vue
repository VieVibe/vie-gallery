<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { useAuth } from '../composables/useAuth'
import { folderContents, putOriginal, spaceRequest, type PrivateFile, type PrivateSpaceAccess, type UploadReservation } from '../lib/privateSpace'
import { hashOriginal, receiveOriginal, type DownloadSink } from '../lib/privateSpaceIntegrity'

const auth = useAuth()
const router = useRouter()
const files = ref<PrivateFile[]>([])
const access = ref<PrivateSpaceAccess>({ allowed: false })
const loading = ref(true)
const error = ref('')
const notice = ref('')
const prefix = ref('')
const query = ref('')
const selected = ref(new Set<string>())
const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const previewDialog = ref<HTMLDialogElement | null>(null)
const previewFile = ref<PrivateFile | null>(null)
const previewError = ref(false)
const downloading = ref(false)
const exportFrame = ref<HTMLIFrameElement | null>(null)
type QueueItem = { file: File; path: string; stage: string; progress: number; error: string; done: boolean }
const queue = ref<QueueItem[]>([])
const uploading = ref(false)
const pauseRequested = ref(false)
const contents = computed(() => folderContents(files.value, prefix.value, query.value))
const used = computed(() => files.value.reduce((sum, file) => sum + file.size, 0))
const completed = computed(() => queue.value.filter(item => item.done).length)
const failed = computed(() => queue.value.filter(item => item.error).length)
const breadcrumbs = computed(() => prefix.value.split('/').filter(Boolean))
const visibleSelected = computed(() => contents.value.files.length > 0 && contents.value.files.every(file => selected.value.has(file.id)))

function bytes(value: number) {
  if (value < 1024) return `${value} B`
  const index = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** index).toFixed(index === 1 ? 0 : 1)} ${['B', 'KB', 'MB', 'GB'][index]}`
}
function name(file: PrivateFile) { return file.path.slice(file.path.lastIndexOf('/') + 1) }
function type(file: PrivateFile) { return file.path.split('.').pop()?.toUpperCase() || '文件' }
function message(cause: unknown) { return cause instanceof Error ? cause.message : '操作失败，请重试。' }
function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id); else next.add(id)
  selected.value = next
}
function toggleAll() { selected.value = visibleSelected.value ? new Set() : new Set(contents.value.files.map(file => file.id)) }
function navigate(path: string) { prefix.value = path; query.value = ''; selected.value = new Set() }
watch(query, () => { selected.value = new Set() })

async function load() {
  loading.value = true
  error.value = ''
  try {
    access.value = await spaceRequest<PrivateSpaceAccess>('/access')
    if (!access.value.allowed) throw new Error('这个账号没有私人空间的访问权限，或空间尚未启用。')
    files.value = await spaceRequest<PrivateFile[]>('/files')
  } catch (cause) { error.value = message(cause) }
  finally { loading.value = false }
}

function choose(event: Event) {
  const input = event.target as HTMLInputElement
  if (uploading.value || !input.files?.length) return
  queue.value = Array.from(input.files).map(file => ({ file, path: prefix.value + (file.webkitRelativePath || file.name), stage: '等待上传', progress: 0, error: '', done: false }))
  input.value = ''
  void upload()
}

async function upload() {
  if (uploading.value) return
  uploading.value = true
  pauseRequested.value = false
  error.value = ''
  notice.value = ''
  try {
    for (const item of queue.value) {
      if (pauseRequested.value) break
      if (item.done) continue
      item.error = ''
      item.progress = 0
      try {
        if (item.file.size > (access.value.maxFileBytes || 0)) throw new Error(`单文件上限为 ${bytes(access.value.maxFileBytes || 0)}，原文件不会被压缩。`)
        item.stage = '读取原文件校验值'
        const sha256 = await hashOriginal(item.file, value => { item.progress = value * 15 })
        const reservation = await spaceRequest<UploadReservation>('/uploads', { path: item.path, size: item.file.size, sha256 })
        if (reservation.state !== 'READY') {
          item.stage = '上传原文件'
          await putOriginal(reservation.uploadUrl!, reservation.headers, item.file, value => { item.progress = 15 + value * 75 })
        }
        item.progress = 90
        item.stage = '云端读回校验'
        const saved = await spaceRequest<PrivateFile>(`/uploads/${reservation.id}/complete`, {}, 300_000)
        files.value = [...files.value.filter(file => file.id !== saved.id), saved].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
        item.progress = 100
        item.stage = reservation.state === 'READY' ? '原件已存在，校验一致' : '原件已保存并校验'
        item.done = true
      } catch (cause) { item.error = message(cause); item.stage = '未完成' }
    }
    notice.value = pauseRequested.value ? '已暂停，可继续上传剩余文件。' : failed.value ? '部分文件未完成，可重试失败文件。' : '这一批原件已全部保存，完整性校验通过。'
  } finally { uploading.value = false }
}

function withSidecars(items: PrivateFile[]) {
  const ids = new Set(items.map(file => file.id))
  for (const file of items) {
    if (!/\.cr3$/i.test(file.path)) continue
    const sidecarPath = file.path.replace(/\.cr3$/i, '.xmp')
    const sidecar = files.value.find(other => other.path === sidecarPath)
      ?? files.value.find(other => other.path.replace(/\.xmp$/i, '.xmp') === sidecarPath)
    if (sidecar) ids.add(sidecar.id)
  }
  return [...ids]
}

async function archive(items: PrivateFile[]) {
  if (downloading.value || !items.length) return
  downloading.value = true
  error.value = ''
  try {
    const result = await spaceRequest<{ url: string }>('/exports', { ids: withSidecars(items) })
    // Let the browser stream large ZIPs to disk; never buffer a 19 GB archive in memory.
    if (exportFrame.value) exportFrame.value.src = result.url
    notice.value = '已请求打包下载。请在浏览器下载列表查看结果；压缩包内附有原文件校验清单。'
  } catch (cause) { error.value = message(cause) }
  finally { downloading.value = false }
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function download(file: PrivateFile) {
  if (withSidecars([file]).length > 1) return archive([file])
  if (downloading.value) return
  downloading.value = true
  error.value = ''
  let sink: DownloadSink | undefined
  try {
    const native = window as unknown as { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable(): Promise<DownloadSink> }> }
    if (native.showSaveFilePicker) {
      const handle = await native.showSaveFilePicker({ suggestedName: name(file) })
      sink = await handle.createWritable()
    }
    notice.value = `正在下载并校验：${name(file)}`
    const { url } = await spaceRequest<{ url: string }>(`/files/${file.id}/download`)
    const response = await fetch(url, { credentials: 'omit', cache: 'no-store' })
    const blob = await receiveOriginal(response, file, sink)
    if (blob) saveBlob(blob, name(file))
    notice.value = `原件下载校验通过：${name(file)}`
  } catch (cause) {
    await sink?.abort().catch(() => {})
    if (!(cause instanceof DOMException && cause.name === 'AbortError')) error.value = message(cause)
  } finally { downloading.value = false }
}

function preview(file: PrivateFile) {
  previewFile.value = file; previewError.value = false
  previewDialog.value?.showModal()
}
async function logout() {
  previewDialog.value?.close()
  await auth.logout()
  await router.replace({ name: 'overview' })
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (uploading.value || downloading.value) { event.preventDefault(); event.returnValue = '' }
}
onBeforeRouteLeave(() => !(uploading.value || downloading.value) || window.confirm('文件传输尚未结束，离开可能中断当前文件。确定离开？'))
onMounted(() => { void load(); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => { pauseRequested.value = true; window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <div class="private-space">
    <header class="space-header">
      <div class="space-brand"><BrandMark :size="30" /><span>阳光明媚<span class="brand-divider">/</span>私人空间</span></div>
      <div class="account"><span>{{ auth.currentUser.value?.user?.email }}</span><button class="btn btn-ghost btn-sm" :disabled="uploading || downloading" @click="logout">退出登录</button></div>
    </header>
    <div class="space-body">
      <div class="space-intro">
        <div><p class="eyebrow">只属于你的珍藏</p><h1>把这一刻，完整留下。</h1><p class="intro-copy">原文件独立保存，保留画质、拍摄信息与修图参数。</p></div>
        <div class="capacity"><strong>{{ bytes(used) }}</strong><span v-if="access.quotaBytes"> / {{ bytes(access.quotaBytes) }}</span><p>{{ files.length }} 个原文件 · 仅此账号可访问</p></div>
      </div>

      <p v-if="error" class="feedback error" role="alert">{{ error }} <button class="text-button" @click="load">重新加载</button></p>
      <p v-if="notice" class="feedback notice" role="status">{{ notice }}</p>
      <div v-if="loading" class="empty-state" role="status">正在读取私人空间…</div>
      <template v-else-if="access.allowed">
        <section class="file-browser" aria-label="私人文件">
          <div class="browser-toolbar">
            <nav class="breadcrumbs" aria-label="文件夹路径"><button @click="navigate('')">全部文件</button><template v-for="(part, index) in breadcrumbs" :key="index"><span>/</span><button @click="navigate(breadcrumbs.slice(0, index + 1).join('/') + '/')">{{ part }}</button></template></nav>
            <div class="toolbar-actions"><button class="btn btn-secondary btn-sm" :disabled="uploading" @click="folderInput?.click()">上传文件夹</button><button class="btn btn-primary btn-sm" :disabled="uploading" @click="fileInput?.click()">上传原文件</button></div>
            <input ref="fileInput" class="sr-only" type="file" multiple accept=".cr3,.xmp,.jpg,.jpeg,.png,.tif,.tiff,.psd" aria-label="选择原文件" :disabled="uploading" @change="choose" />
            <input ref="folderInput" class="sr-only" type="file" multiple webkitdirectory aria-label="选择整个文件夹" :disabled="uploading" @change="choose" />
          </div>
          <div class="file-tools"><label class="search"><span>查找</span><input v-model="query" placeholder="文件名或目录" aria-label="查找文件" /></label><div class="download-tools"><span v-if="selected.size">已选 {{ selected.size }} 个</span><button v-if="selected.size" class="text-button" :disabled="downloading" @click="archive(files.filter(file => selected.has(file.id)))">下载所选原件</button><button class="text-button" :disabled="downloading || !files.some(file => file.path.startsWith(prefix))" @click="archive(files.filter(file => file.path.startsWith(prefix)))">下载{{ prefix ? '此文件夹' : '全部原件' }}</button></div></div>
          <div v-if="!contents.folders.length && !contents.files.length" class="empty-state"><h2>{{ query ? '没有找到文件' : '珍贵的原件，从这里收好。' }}</h2><p>{{ query ? '换个文件名试试。' : '上传整个文件夹，保留 CR3、XMP、JPG 与原有目录。' }}</p><p v-if="!query" class="small">单文件最大 {{ bytes(access.maxFileBytes || 0) }}，超出时会提示，不会压缩原件。</p></div>
          <template v-else>
            <div class="file-row column-labels"><input type="checkbox" aria-label="选择当前列表所有文件" :checked="visibleSelected" :disabled="!contents.files.length" @change="toggleAll" /><span>名称</span><span class="size-column">大小</span><span class="status-column">完整性</span><span class="action-column">操作</span></div>
            <div v-for="folder in contents.folders" :key="folder" class="file-row folder-row"><span></span><button class="folder-name" @click="navigate(prefix + folder + '/')"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /></svg><span>{{ folder }}</span></button><span class="size-column">文件夹</span><span class="status-column"></span><button class="text-button action-column" :disabled="downloading" @click="archive(files.filter(file => file.path.startsWith(prefix + folder + '/')))">下载</button></div>
            <div v-for="file in contents.files" :key="file.id" class="file-row">
              <input type="checkbox" :aria-label="`选择 ${file.path}`" :checked="selected.has(file.id)" @change="toggle(file.id)" />
              <div class="file-name"><button v-if="file.previewAvailable" class="thumbnail" :aria-label="`预览 ${name(file)}`" @click="preview(file)"><img :src="`/api/private-space/files/${file.id}/preview`" loading="lazy" alt="" /></button><span v-else class="file-type">{{ type(file) }}</span><div><button v-if="file.previewAvailable" class="name-button" @click="preview(file)">{{ query ? file.path : name(file) }}</button><span v-else class="name-label">{{ query ? file.path : name(file) }}</span><p>{{ type(file) === 'XMP' ? '修图参数 · 与同名原片一起保留' : type(file) === 'CR3' ? '相机原始文件' : '原文件' }}<span class="mobile-size"> · {{ bytes(file.size) }}</span></p></div></div>
              <span class="size-column">{{ bytes(file.size) }}</span><span class="verified status-column" :title="`SHA-256: ${file.sha256}`">✓ 已校验</span><button class="text-button action-column" :disabled="downloading" @click="download(file)">下载原件</button>
            </div>
          </template>
          <footer class="browser-footnote">JPG / PNG 可预览，预览图与原件分开保存。CR3 下载会一并包含已上传的同名 XMP 参数文件。</footer>
        </section>

        <section v-if="queue.length" class="upload-queue" aria-label="上传进度">
          <div class="queue-header"><h2>原件上传 <span>{{ completed }} / {{ queue.length }}</span></h2><button v-if="uploading" class="text-button" :disabled="pauseRequested" @click="pauseRequested = true">{{ pauseRequested ? '当前文件完成后暂停' : '暂停后续上传' }}</button><button v-else-if="completed < queue.length" class="text-button" @click="upload">{{ failed ? '重试未完成文件' : '继续上传' }}</button><button v-else class="text-button" @click="queue = []">收起</button></div>
          <p class="queue-copy">只有云端文件的大小和 SHA-256 均与本地原件一致，才会收入文件列表。传输中请保持页面打开。</p>
          <ol><li v-for="(item, index) in queue" :key="index"><div class="queue-file"><span>{{ item.path }}</span><span :class="{ 'queue-error': item.error }">{{ item.error || item.stage }}</span></div><progress :value="item.progress" max="100" :aria-label="`${item.path} 上传进度`" /></li></ol>
        </section>
      </template>
      <p class="retention-note">临时保存至 2026 年底。撤下功能前先导出核验，原件不会因日期到期自动删除。</p>
    </div>
    <dialog ref="previewDialog" class="preview-dialog" @click="event => { if (event.target === previewDialog) previewDialog?.close() }">
      <div class="preview-header"><div><strong>{{ previewFile ? name(previewFile) : '' }}</strong><p>预览图 · 下载获取完整原件</p></div><button class="btn btn-secondary btn-sm" @click="previewDialog?.close()">关闭</button></div>
      <p v-if="previewError" class="empty-state">预览暂时不可用，仍可下载完整原件。</p><img v-else-if="previewFile" :src="`/api/private-space/files/${previewFile.id}/preview`" alt="照片预览" @error="previewError = true" />
      <button v-if="previewFile" class="btn btn-primary preview-download" :disabled="downloading" @click="download(previewFile)">下载原件 · {{ bytes(previewFile.size) }}</button>
    </dialog>
    <iframe ref="exportFrame" title="原文件打包下载" class="export-frame"></iframe>
  </div>
</template>

<style scoped>
.private-space { min-height: 100dvh; background: var(--bg-app); }
.space-header { min-height: 78px; padding: 20px clamp(20px, 4vw, 64px); border-bottom: 1px solid var(--border-strong); display: flex; justify-content: space-between; align-items: center; gap: 18px; }
.space-brand, .account, .toolbar-actions, .download-tools { display: flex; align-items: center; gap: 16px; }
.space-brand { font-weight: 600; }.brand-divider { color: var(--text-tertiary); margin: 0 16px; font-weight: 400; }.account { font-size: 13px; color: var(--text-secondary); }
.space-body { max-width: 1400px; margin: 0 auto; padding: 56px clamp(20px, 4vw, 64px) 28px; }.space-intro { display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; margin-bottom: 36px; }
.eyebrow { color: var(--brand-deep); font-size: 12px; letter-spacing: .12em; margin: 0 0 12px; }h1 { font-family: var(--font-serif); font-size: clamp(26px, 3vw, 38px); font-weight: 500; margin: 0 0 14px; }.intro-copy { color: var(--text-secondary); font-size: 14px; margin: 0; }.capacity { flex-shrink: 0; color: var(--text-secondary); text-align: right; }.capacity strong { font-size: 24px; color: var(--text-primary); font-weight: 500; }.capacity p { margin: 8px 0 0; font-size: 12px; }
.file-browser { background: var(--bg-surface); border: 1px solid var(--border-strong); border-radius: 8px; overflow: hidden; }.browser-toolbar { min-height: 84px; display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 20px 24px; border-bottom: 1px solid var(--border-subtle); }.breadcrumbs { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 14px; min-width: 0; }.breadcrumbs button { overflow-wrap: anywhere; text-align: left; }.breadcrumbs span { color: var(--text-tertiary); }.breadcrumbs button, .name-button, .folder-name, .text-button { border: 0; padding: 0; background: none; cursor: pointer; font: inherit; color: var(--text-primary); }.text-button { color: var(--brand-deep); font-size: 13px; min-height: 32px; }.text-button:hover, .breadcrumbs button:hover, .name-button:hover { text-decoration: underline; }.text-button:disabled { opacity: .45; cursor: default; text-decoration: none; }
.toolbar-actions { flex-shrink: 0; gap: 8px; }.file-tools { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 16px 24px; }.search { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-secondary); }.search input { border: 1px solid var(--border-strong); border-radius: 5px; padding: 9px 12px; background: var(--bg-surface); width: 230px; max-width: 100%; color: var(--text-primary); }.download-tools { gap: 16px; font-size: 12px; color: var(--text-secondary); }
.file-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) 100px 90px 100px; gap: 14px; align-items: center; min-height: 84px; padding: 14px 24px; border-top: 1px solid var(--border-subtle); font-size: 13px; }.column-labels { min-height: 42px; padding-block: 10px; background: var(--bg-surface-subtle); color: var(--text-secondary); font-size: 12px; }.file-row input[type=checkbox] { width: 16px; height: 16px; accent-color: var(--brand-deep); cursor: pointer; }.file-name { display: flex; align-items: center; gap: 14px; min-width: 0; }.file-name > div { min-width: 0; }.name-button, .name-label { font-size: 14px; text-align: left; overflow-wrap: anywhere; }.file-name p { margin: 6px 0 0; color: var(--text-tertiary); font-size: 11px; }.file-type { width: 48px; height: 50px; background: var(--bg-surface-subtle); border: 1px solid var(--border-subtle); border-radius: 4px; display: grid; place-items: center; font-family: var(--font-mono); font-size: 11px; flex-shrink: 0; }.thumbnail { width: 48px; height: 50px; flex-shrink: 0; border: 0; padding: 0; background: var(--bg-surface-subtle); border-radius: 4px; overflow: hidden; cursor: pointer; }.thumbnail img { width: 100%; height: 100%; object-fit: cover; }.verified { color: var(--brand-deep); font-size: 12px; }.size-column { color: var(--text-secondary); font-variant-numeric: tabular-nums; }.action-column { text-align: right; }.folder-row { min-height: 64px; }.folder-name { display: flex; align-items: center; gap: 15px; min-width: 0; font-size: 14px; text-align: left; }.folder-name svg { width: 35px; height: 32px; fill: var(--brand-lime); stroke: var(--brand-deep); stroke-width: 1; flex-shrink: 0; }.folder-name span { overflow-wrap: anywhere; }
.browser-footnote, .retention-note { font-size: 12px; color: var(--text-secondary); line-height: 1.8; }.browser-footnote { padding: 18px 24px; border-top: 1px solid var(--border-subtle); }.retention-note { margin: 24px 0 0; }.empty-state { text-align: center; padding: 64px 20px; color: var(--text-secondary); }.empty-state h2 { color: var(--text-primary); font-size: 20px; font-weight: 500; margin: 0 0 14px; }.empty-state p { font-size: 14px; line-height: 1.8; }.empty-state .small { font-size: 12px; }.feedback { padding: 14px 18px; border-radius: 5px; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }.error { color: #8b3026; background: #f8e9e5; }.notice { color: var(--brand-deep); background: var(--mint-soft-strong); }
.upload-queue { border: 1px solid var(--border-strong); background: var(--bg-surface); border-radius: 8px; margin-top: 24px; padding: 24px; }.queue-header { display: flex; justify-content: space-between; gap: 16px; align-items: center; }.queue-header h2 { font-size: 16px; font-weight: 500; margin: 0; }.queue-header h2 span { font-size: 13px; color: var(--text-secondary); margin-left: 10px; }.queue-copy { font-size: 12px; line-height: 1.8; color: var(--text-secondary); }.upload-queue ol { list-style: none; margin: 20px 0 0; padding: 0; max-height: 320px; overflow-y: auto; }.upload-queue li { padding: 12px 0; border-top: 1px solid var(--border-subtle); }.queue-file { display: flex; gap: 16px; justify-content: space-between; font-size: 12px; line-height: 1.7; }.queue-file > span:first-child { overflow-wrap: anywhere; min-width: 0; }.queue-file > span:last-child { color: var(--text-secondary); text-align: right; }.queue-file > .queue-error { color: #8b3026 !important; }progress { display: block; width: 100%; height: 4px; margin-top: 10px; accent-color: var(--brand-deep); }
.mobile-size { display: none; }.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }.export-frame { display: none; }.preview-dialog { border: 0; border-radius: 8px; background: var(--bg-surface); padding: 22px; width: min(960px, calc(100vw - 32px)); max-height: 90dvh; }.preview-dialog::backdrop { background: rgba(20, 30, 24, .65); }.preview-header { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; margin-bottom: 16px; }.preview-header strong { font-weight: 500; overflow-wrap: anywhere; }.preview-header p { font-size: 12px; color: var(--text-secondary); margin: 8px 0 0; }.preview-dialog > img { display: block; max-height: 65dvh; max-width: 100%; margin: 0 auto; object-fit: contain; }.preview-download { display: flex; margin: 20px auto 0; }
@media (max-width: 760px) { .space-header { padding: 16px 20px; flex-wrap: wrap; }.space-brand { font-size: 14px; }.account { margin-left: auto; }.space-body { padding-top: 32px; }.space-intro { align-items: flex-start; flex-direction: column; gap: 24px; }.capacity { text-align: left; }.capacity strong { font-size: 20px; }.browser-toolbar { padding: 18px 16px; flex-wrap: wrap; }.toolbar-actions { width: 100%; }.file-tools { padding: 14px 16px; }.search { width: 100%; }.search input { flex: 1; min-width: 0; width: auto; }.download-tools { flex-wrap: wrap; }.file-row { grid-template-columns: 18px minmax(0, 1fr) 70px; gap: 10px; padding: 14px 16px; }.size-column, .status-column { display: none; }.mobile-size { display: inline; }.file-name { gap: 10px; }.name-button, .name-label { font-size: 13px; }.file-type, .thumbnail { width: 36px; height: 44px; }.file-type { font-size: 10px; }.file-row .text-button { font-size: 12px; }.browser-footnote { padding: 16px; }.upload-queue { padding: 18px 16px; }.queue-file { flex-direction: column; gap: 4px; }.queue-file > span:last-child { text-align: left; }.preview-dialog { padding: 16px; } }
</style>
