import { build } from 'esbuild'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

async function discover(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const files = []
  for (const entry of entries) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await discover(file))
    else if (file.endsWith('.test.ts')) files.push(file)
  }
  return files.sort()
}

const selected = process.argv.slice(2)
const files = selected.length ? selected : [
  ...await discover('packages/gallery-contracts/test'),
  ...await discover('apps/gallery-viewer/test')
]
if (!files.length) throw new Error('No test files selected')
const cacheDir = path.resolve('.cache/viewer-unit')
await mkdir(cacheDir, { recursive: true })
const runDir = await mkdtemp(path.join(cacheDir, 'run-'))
try {
  const outputs = []
  for (const [index, file] of files.entries()) {
    const outfile = path.join(runDir, `${index}.test.mjs`)
    await build({ entryPoints: [file], outfile, bundle: true, platform: 'node', format: 'esm',
      target: 'node18', external: ['three', 'three/*', 'vue', 'node:*'], sourcemap: 'inline' })
    outputs.push(outfile)
  }
  const result = spawnSync(process.execPath, ['--test', ...outputs], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(runDir, { recursive: true, force: true })
}
