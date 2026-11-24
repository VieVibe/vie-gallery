import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { Sha256, hashOriginal, receiveOriginal } from '../src/lib/privateSpaceIntegrity'
import { folderContents, type PrivateFile } from '../src/lib/privateSpace'

const reference = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

test('SHA-256 matches the platform implementation across padding boundaries and chunk sizes', () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 4097, 2 * 1024 * 1024 + 13]) {
    const bytes = randomBytes(size)
    for (const step of [1, 57, 65536]) {
      const sha = new Sha256()
      for (let offset = 0; offset < bytes.length; offset += step) sha.update(bytes.subarray(offset, offset + step))
      assert.equal(sha.hex(), reference(bytes), `size ${size}, chunk ${step}`)
    }
  }
})

test('SHA-256 handles the 512 MiB bit-length boundary with constant memory', () => {
  const chunk = new Uint8Array(2 * 1024 * 1024).fill(0x91)
  const sha = new Sha256(), expected = createHash('sha256')
  for (let i = 0; i < 256; i++) { sha.update(chunk); expected.update(chunk) }
  assert.equal(sha.hex(), expected.digest('hex'))
})

test('blob hashing preserves arbitrary raw camera bytes and empty sidecar content', async () => {
  for (const bytes of [randomBytes(2 * 1024 * 1024 + 9), new Uint8Array()]) {
    assert.equal(await hashOriginal(new Blob([bytes])), reference(bytes))
  }
})

test('downloads are byte-identical and preserve XMP UTF-8 bytes', async () => {
  const bytes = new TextEncoder().encode('<?xpacket?><修图参数 曝光="0.35"/>\r\n')
  const blob = await receiveOriginal(new Response(bytes), { size: bytes.length, sha256: reference(bytes) })
  assert.deepEqual(new Uint8Array(await blob!.arrayBuffer()), bytes)
})

test('truncated, oversized and modified downloads never commit the destination', async () => {
  const original = new Uint8Array([0, 1, 2, 3, 255])
  for (const received of [original.slice(0, 4), new Uint8Array([...original, 0]), new Uint8Array([0, 1, 2, 3, 254])]) {
    let closed = false, aborted = false
    await assert.rejects(receiveOriginal(new Response(received), { size: original.length, sha256: reference(original) }, {
      async write() {}, async close() { closed = true }, async abort() { aborted = true }
    }))
    assert.equal(closed, false)
    assert.equal(aborted, true)
  }
})

test('native streaming saves commit only after the entire original passes validation', async () => {
  const bytes = randomBytes(1024 * 1024 + 7)
  const written: Uint8Array[] = []
  let closed = false
  const result = await receiveOriginal(new Response(bytes), { size: bytes.length, sha256: reference(bytes) }, {
    async write(chunk) { assert.equal(closed, false); written.push(chunk) },
    async close() { closed = true },
    async abort() { assert.fail('valid original must not abort') }
  })
  assert.equal(result, null)
  assert.equal(closed, true)
  assert.deepEqual(Buffer.concat(written), bytes)
})

test('folders preserve source paths, case and Chinese file names', () => {
  const paths = ['婚纱照/原片/IMG_0001.CR3', '婚纱照/原片/IMG_0001.xmp', '婚纱照/精修/合照.JPG', '封面.jpg']
  const files = paths.map((path, i) => ({ id: String(i), path } as PrivateFile))
  assert.deepEqual(folderContents(files, '').folders, ['婚纱照'])
  assert.deepEqual(folderContents(files, '婚纱照/原片/').files.map(file => file.path), paths.slice(0, 2))
  assert.equal(folderContents(files, '婚纱照/', 'img_0001.cr3').files[0].path, paths[0])
})
