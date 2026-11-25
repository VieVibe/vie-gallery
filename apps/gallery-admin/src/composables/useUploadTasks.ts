import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type {
  UploadTask,
  UploadTaskError,
  UploadTaskPage,
  UploadTaskStatus,
  UploadTaskSummary
} from '@vie/gallery-contracts'
import { apiFetch } from '../api'
import { responseError, StatusError } from '../lib/apiError'

export type { UploadTask, UploadTaskError, UploadTaskPage, UploadTaskStatus, UploadTaskSummary }

export type TaskFilter = 'ALL' | 'ACTIVE' | 'FAILED' | 'COMPLETED'

const ACTIVE_STATUSES: UploadTaskStatus[] = ['QUEUED', 'PROCESSING', 'CANCEL_REQUESTED']

export interface UseUploadTasksOptions {
  onPhotoStatusChange?: () => void | Promise<void>
}

function emptySummary(): UploadTaskSummary {
  return { queued: 0, processing: 0, succeeded: 0, failed: 0, cancelRequested: 0, cancelled: 0 }
}

function normalizeError(value: unknown, raw: Record<string, unknown>): UploadTaskError | null {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : raw.errorCode || raw.errorMessage
    ? { code: raw.errorCode, message: raw.errorMessage, requestId: raw.requestId }
    : null
  if (!source) return null
  return {
    code: typeof source.code === 'string' ? source.code : null,
    message: typeof source.message === 'string' ? source.message : null,
    requestId: typeof source.requestId === 'string' ? source.requestId : null
  }
}

function normalizeTask(value: unknown): UploadTask {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const progress = Number(raw.progress)
  const attempts = Number(raw.attempts)
  const maxAttempts = Number(raw.maxAttempts)
  const status = typeof raw.status === 'string' ? raw.status : 'QUEUED'
  const error = normalizeError(raw.error, raw)
  return {
    id: String(raw.id || raw.taskId || ''),
    galleryId: typeof raw.galleryId === 'string' ? raw.galleryId : undefined,
    photoId: typeof raw.photoId === 'string' ? raw.photoId : null,
    filename: typeof raw.filename === 'string' ? raw.filename : null,
    thumbnailUrl: typeof raw.thumbnailUrl === 'string' ? raw.thumbnailUrl : null,
    photoThumbnailUrl: typeof raw.photoThumbnailUrl === 'string' ? raw.photoThumbnailUrl : null,
    status,
    progress: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0,
    stage: typeof raw.stage === 'string' ? raw.stage : null,
    attempts: Number.isFinite(attempts) ? attempts : 0,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 3,
    retryable: raw.retryable === true || (status === 'FAILED' && attempts < maxAttempts),
    error,
    errorCode: error?.code || null,
    errorMessage: error?.message || null,
    requestId: error?.requestId || (typeof raw.requestId === 'string' ? raw.requestId : null),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    finishedAt: typeof raw.finishedAt === 'string' ? raw.finishedAt : null
  }
}

export function useUploadTasks(
  galleryId: MaybeRefOrGetter<string>,
  enabled: MaybeRefOrGetter<boolean> = true,
  options: UseUploadTasksOptions = {}
) {
  const id = computed(() => toValue(galleryId))
  const isEnabled = computed(() => toValue(enabled))
  const tasks = ref<UploadTask[]>([])
  const summary = ref<UploadTaskSummary>(emptySummary())
  const filter = ref<TaskFilter>('ALL')
  const loading = ref(true)
  const refreshing = ref(false)
  const error = ref<Error | null>(null)
  const isPolling = ref(false)

  let requestVersion = 0
  let pollTimer: number | undefined
  let pendingLoad: { galleryId: string; promise: Promise<void> } | undefined

  const activeTasks = computed(() => tasks.value.filter(task => ACTIVE_STATUSES.includes(task.status)))
  const activeCount = computed(() => summary.value.queued + summary.value.processing + summary.value.cancelRequested)
  const filteredTasks = computed(() => tasks.value.filter(task => {
    if (filter.value === 'ACTIVE') return ACTIVE_STATUSES.includes(task.status)
    if (filter.value === 'FAILED') return task.status === 'FAILED'
    if (filter.value === 'COMPLETED') return ['SUCCEEDED', 'CANCELLED'].includes(task.status)
    return true
  }))

  function clearPoll() {
    if (pollTimer !== undefined) window.clearTimeout(pollTimer)
    pollTimer = undefined
    isPolling.value = false
  }

  function schedulePoll() {
    clearPoll()
    const cause = error.value
    const transient = cause instanceof TypeError || (cause instanceof StatusError && (cause.status ?? 0) >= 500)
    if (!isEnabled.value || (cause ? !transient : !activeCount.value)) return
    const delay = document.hidden ? 8000 : transient ? 5000 : 2500
    isPolling.value = true
    pollTimer = window.setTimeout(() => {
      pollTimer = undefined
      void load(true)
    }, delay)
  }

  async function load(silent = false, afterCurrent = false): Promise<void> {
    const galleryIdValue = id.value
    if (!isEnabled.value || !galleryIdValue) {
      requestVersion++
      pendingLoad = undefined
      clearPoll()
      tasks.value = []
      summary.value = emptySummary()
      loading.value = false
      refreshing.value = false
      error.value = null
      return
    }
    if (pendingLoad?.galleryId === galleryIdValue) {
      await pendingLoad.promise
      if (afterCurrent && galleryIdValue === id.value && isEnabled.value) await load(silent)
      return
    }
    const version = ++requestVersion
    const promise = loadTasks(galleryIdValue, version, silent)
    pendingLoad = { galleryId: galleryIdValue, promise }
    await promise
  }

  async function loadTasks(galleryIdValue: string, version: number, silent: boolean) {
    if (silent) refreshing.value = true
    else loading.value = true
    try {
      const query = new URLSearchParams({
        status: 'QUEUED,PROCESSING,CANCEL_REQUESTED,FAILED,SUCCEEDED,CANCELLED',
        page: '0',
        pageSize: '100'
      })
      const response = await apiFetch(`/api/galleries/${encodeURIComponent(galleryIdValue)}/photo-tasks?${query}`)
      if (!response.ok) throw await responseError(response, '任务列表加载失败，请稍后重试。')
      const data = await response.json() as { items?: unknown[]; summary?: Partial<UploadTaskSummary> } | unknown[]
      if (version !== requestVersion) return
      const items = Array.isArray(data) ? data : data.items || []
      const remoteTasks = items.map(normalizeTask).filter(task => task.id)

      tasks.value = remoteTasks

      const remoteSummary = Array.isArray(data) ? undefined : data.summary
      const previousSummary = summary.value
      const refreshPhotos = activeCount.value > 0 || !!error.value
      error.value = null
      summary.value = {
        queued: Number(remoteSummary?.queued ?? remoteTasks.filter(task => task.status === 'QUEUED').length),
        processing: Number(remoteSummary?.processing ?? remoteTasks.filter(task => task.status === 'PROCESSING').length),
        succeeded: Number(remoteSummary?.succeeded ?? remoteTasks.filter(task => task.status === 'SUCCEEDED').length),
        failed: Number(remoteSummary?.failed ?? remoteTasks.filter(task => task.status === 'FAILED').length),
        cancelRequested: Number(remoteSummary?.cancelRequested ?? remoteTasks.filter(task => task.status === 'CANCEL_REQUESTED').length),
        cancelled: Number(remoteSummary?.cancelled ?? remoteTasks.filter(task => task.status === 'CANCELLED').length)
      }

      const currentActiveCount = activeCount.value
      const photosChanged = refreshPhotos && (
        currentActiveCount === 0 ||
        summary.value.succeeded !== previousSummary.succeeded ||
        summary.value.failed !== previousSummary.failed ||
        summary.value.cancelled !== previousSummary.cancelled
      )
      if (photosChanged) {
        try {
          await options.onPhotoStatusChange?.()
        } catch {
          // A photo refresh failure must not interrupt subsequent task polling.
        }
      }
    } catch (cause) {
      if (version === requestVersion) error.value = cause instanceof Error ? cause : new Error('任务列表加载失败，请稍后重试。')
    } finally {
      if (version === requestVersion) {
        pendingLoad = undefined
        loading.value = false
        refreshing.value = false
        schedulePoll()
      }
    }
  }

  async function retry(task: UploadTask) {
    if (task.status !== 'FAILED' || !task.retryable) return
    const response = await apiFetch(`/api/photos/tasks/${encodeURIComponent(task.id)}/retry`, { method: 'POST' })
    if (!response.ok) throw await responseError(response, '任务重试失败，请稍后重试。')
    await load(true, true)
  }

  async function cancel(task: UploadTask) {
    if (!['QUEUED', 'PROCESSING'].includes(task.status)) return
    const response = await apiFetch(`/api/photos/tasks/${encodeURIComponent(task.id)}/cancel`, { method: 'POST' })
    if (!response.ok) throw await responseError(response, '取消任务失败，请稍后重试。')
    await load(true, true)
  }

  function handleVisibilityChange() {
    if (!document.hidden) void load(true)
    else schedulePoll()
  }

  watch([id, isEnabled], () => void load(), { immediate: true })
  onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange))
  onUnmounted(() => {
    requestVersion += 1
    clearPoll()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return {
    tasks,
    filteredTasks,
    activeTasks,
    summary,
    filter,
    loading,
    refreshing,
    error,
    isPolling,
    load,
    retry,
    cancel
  }
}

