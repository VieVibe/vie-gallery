import { apiFetch } from '../api'

export interface PrivateSpaceAccess { allowed: boolean; quotaBytes?: number; maxFileBytes?: number }
export interface PrivateFile { id: string; path: string; size: number; sha256: string; verifiedAt: string; previewAvailable: boolean }
export interface UploadReservation { id: string; state: string; uploadUrl: string | null; headers: Record<string, string> }

export async function spaceRequest<T>(path: string, data?: unknown, timeout = 30_000): Promise<T> {
  const response = await apiFetch(`/api/private-space${path}`, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  }, timeout)
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { message?: string }
    throw new Error(error.message || (response.status === 403 ? '这个账号没有私人空间的访问权限。' : '操作失败，请稍后重试。'))
  }
  return response.json() as Promise<T>
}

export function putOriginal(url: string, headers: Record<string, string>, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.timeout = 30 * 60_000
    // No session, CSRF headers, FormData, canvas, or image encoder touches the original.
    Object.entries(headers).forEach(([name, value]) => xhr.setRequestHeader(name, value))
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('原文件上传失败，请重试。'))
    xhr.onerror = () => reject(new Error('上传连接中断，请重新选择文件重试。'))
    xhr.ontimeout = () => reject(new Error('上传超时，请重新选择文件重试。'))
    xhr.send(file)
  })
}

export function folderContents(files: PrivateFile[], prefix: string, query = '') {
  const folders = new Set<string>()
  const direct: PrivateFile[] = []
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue
    const rest = file.path.slice(prefix.length)
    if (query) { if (rest.toLowerCase().includes(query.toLowerCase())) direct.push(file); continue }
    const slash = rest.indexOf('/')
    if (slash >= 0) folders.add(rest.slice(0, slash))
    else direct.push(file)
  }
  return { folders: [...folders].sort((a, b) => a.localeCompare(b, 'zh-CN')), files: direct }
}
