// Incremental SHA-256 keeps CR3 hashing bounded to a small buffer, even for large files.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])
const rotate = (v: number, n: number) => (v >>> n) | (v << (32 - n))

export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  private buffer = new Uint8Array(64)
  private words = new Uint32Array(64)
  private length = 0
  private buffered = 0
  private finished = false

  update(bytes: Uint8Array) {
    if (this.finished) throw new Error('Hash already finalized')
    this.length += bytes.length
    let offset = 0
    while (offset < bytes.length) {
      if (this.buffered === 0 && bytes.length - offset >= 64) {
        this.block(bytes, offset)
        offset += 64
      } else {
        const count = Math.min(64 - this.buffered, bytes.length - offset)
        this.buffer.set(bytes.subarray(offset, offset + count), this.buffered)
        this.buffered += count
        offset += count
        if (this.buffered === 64) { this.block(this.buffer, 0); this.buffered = 0 }
      }
    }
    return this
  }

  hex() {
    if (this.finished) throw new Error('Hash already finalized')
    const length = this.length
    const padding = new Uint8Array(this.buffered < 56 ? 64 - this.buffered : 128 - this.buffered)
    padding[0] = 0x80
    const view = new DataView(padding.buffer)
    view.setUint32(padding.length - 8, Math.floor(length / 0x20000000))
    view.setUint32(padding.length - 4, (length * 8) >>> 0)
    this.update(padding)
    this.finished = true
    return Array.from(this.h, value => value.toString(16).padStart(8, '0')).join('')
  }

  private block(bytes: Uint8Array, offset: number) {
    const w = this.words
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4
      w[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2]
      w[i] = (w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = this.h
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    const values = [a, b, c, d, e, f, g, h]
    for (let i = 0; i < 8; i++) this.h[i] = (this.h[i] + values[i]) >>> 0
  }
}

export async function hashOriginal(file: Blob, progress?: (value: number) => void) {
  const sha = new Sha256()
  const chunk = 2 * 1024 * 1024
  for (let offset = 0; offset < file.size; offset += chunk) {
    sha.update(new Uint8Array(await file.slice(offset, offset + chunk).arrayBuffer()))
    progress?.(Math.min(1, (offset + chunk) / file.size))
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  return sha.hex()
}

export interface Original { size: number; sha256: string }
export interface DownloadSink { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }

// A native save stream is committed only after validation. Other browsers receive
// a Blob only after validation, so a truncated/corrupt transfer cannot be saved as success.
export async function receiveOriginal(response: Response, original: Original, sink?: DownloadSink, progress?: (bytes: number) => void) {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const sha = new Sha256()
  const reader = response.body?.getReader()
  let size = 0
  try {
    if (!response.ok || !reader) throw new Error('原文件下载失败，请重试。')
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > original.size) throw new Error('下载文件大小不一致，已停止保存。')
      sha.update(value)
      if (sink) await sink.write(value)
      else chunks.push(new Uint8Array(value))
      progress?.(size)
    }
    if (size !== original.size || sha.hex() !== original.sha256) throw new Error('下载完整性校验未通过，已停止保存，请重试。')
    if (sink) { await sink.close(); return null }
    return new Blob(chunks, { type: 'application/octet-stream' })
  } catch (error) {
    await reader?.cancel().catch(() => {})
    await sink?.abort().catch(() => {})
    throw error
  } finally { reader?.releaseLock() }
}
