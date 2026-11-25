import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { applySpatialPreset, createDefaultViewerConfig } from '@vie/gallery-contracts'
import { CollectionStagePlugin } from '../src/plugins/CollectionStagePlugin'
import type { PhotoMesh } from '../src/core/types'
import { createViewerContext } from './helpers/viewerContext'

function fixture(width: number, height: number, count: number, reduced = false) {
  const photos = Array.from({ length: count }, (_, index) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 60), new THREE.MeshStandardMaterial()) as PhotoMesh
    mesh.userData = { index, url: '', thumbnailUrl: '' }
    const back = new THREE.Mesh(mesh.geometry, mesh.material)
    back.name = 'photo-back'
    back.rotation.y = Math.PI
    back.userData = mesh.userData
    mesh.add(back)
    return mesh
  })
  const context = createViewerContext(applySpatialPreset(createDefaultViewerConfig(), 'fold'), photos)
  context.scene.add(...photos)
  context.reducedMotion = () => reduced
  context.camera = new THREE.PerspectiveCamera(50, width / height, 1, 6000)
  Object.assign(context.renderer, { domElement: Object.assign(new EventTarget(), { clientHeight: height, clientWidth: width }) })
  const stage = new CollectionStagePlugin()
  stage.install(context)
  return { photos, context, stage }
}

function inFrame(mesh: THREE.Mesh, camera: THREE.Camera) {
  const point = mesh.position.clone().project(camera)
  return mesh.visible && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1
}

function fullyInFrame(mesh: PhotoMesh, camera: THREE.Camera) {
  const { width, height } = (mesh.geometry as THREE.PlaneGeometry).parameters
  mesh.updateMatrixWorld(true)
  return mesh.visible && mesh.scale.x > 1 && [-1, 1].every(x => [-1, 1].every(y => {
    const point = new THREE.Vector3(x * width / 2, y * height / 2, 0).applyMatrix4(mesh.matrixWorld).project(camera)
    return Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1
  }))
}

test('the Fold route keeps works in the mobile viewport and explicit navigation returns to the selected bay', () => {
  const { photos, context, stage } = fixture(390, 844, 50)
  for (let frame = 0; frame < 325; frame++) {
    stage.update(.05)
    if (frame % 10 === 0) {
      assert.ok(photos.filter(photo => inFrame(photo, context.camera)).length >= 3, `empty corridor at frame ${frame}`)
    }
  }
  context.emit('stage:autoplay', false)
  context.emit('stage:select', 1)
  for (let frame = 0; frame < 20; frame++) stage.update(.05)
  assert.ok(inFrame(photos[1]!, context.camera), 'the next work is in front of the camera')
  stage.uninstall()
})

test('Fold moves forward through all pages before returning to the first bay', () => {
  const { photos, context, stage } = fixture(390, 844, 50)
  const pages = fixture(390, 844, 56)
  const canvas = context.renderer.domElement
  Object.assign(canvas, { dataset: { hasMore: 'true', photoTotal: '56' } })
  const framed = new Set<number>()
  const stops = [0]
  let requests = 0
  context.on('stage:change', ({ index }: { index: number }) => stops.push(index))
  context.on('stage:load-more', () => { requests++ })

  for (let frame = 0; frame < 500; frame++) {
    const z = context.camera.position.z
    stage.update(.05)
    assert.ok(context.camera.position.z <= z && z - context.camera.position.z < 25, 'the camera keeps moving forward without a jump')
    for (const photo of photos) if (fullyInFrame(photo, context.camera)) framed.add(photo.userData.index)
    if (frame === 20) {
      assert.equal(requests, 1, 'prefetch the next page before reaching the seam')
      const row = photos[48]!.position.y
      photos.push(...pages.photos.slice(50))
      delete canvas.dataset.hasMore
      context.emit('photos:loaded', photos)
      stage.update(0)
      assert.equal(photos[48]!.position.y, row, 'an existing photograph stays in its row when the next page fills its bay')
    }
    if (stops.length > 2 && stops.at(-1) === 0) break
    if (stops.at(-1)! < 54) assert.ok(photos.every(photo => !photo.userData.presentation), 'the first bay does not reappear before the final bay')
  }

  assert.deepEqual(stops.filter((index, position) => position === 0 || index !== stops[position - 1]), [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 0])
  assert.equal(framed.size, 56)
  stage.uninstall()
  pages.stage.uninstall()
})

test('Fold retries an unavailable page and waits at the last loaded bay', () => {
  const { context, stage } = fixture(390, 844, 50)
  Object.assign(context.renderer.domElement, { dataset: { hasMore: 'true' } })
  let requests = 0
  let active = 0
  context.on('stage:load-more', () => { requests++ })
  context.on('stage:change', ({ index }: { index: number }) => { active = index })
  for (let frame = 0; frame < 400; frame++) stage.update(.05)
  assert.equal(requests, 3)
  assert.equal(active, 48)
  const z = context.camera.position.z
  stage.update(.05)
  assert.equal(context.camera.position.z, z)
  stage.uninstall()
})

for (const count of [1, 2]) {
  test(`Fold keeps a ${count}-photo album in view while the camera crosses consecutive loops`, () => {
    const { photos, context, stage } = fixture(390, 844, count)
    const start = context.camera.position.z
    for (let frame = 0; frame < 500; frame++) {
      stage.update(.05)
      assert.ok(photos.some(photo => (photo.userData.presentation ?? [photo]).some(surface =>
        surface.parent === context.scene && surface.scale.x > .001 && inFrame(surface, context.camera))), `empty corridor at frame ${frame}`)
    }
    assert.ok(start - context.camera.position.z > 2000)
    stage.uninstall()
    assert.ok(photos.every(photo => !photo.userData.presentation))
  })
}

test('Fold opens the photograph from the copy the visitor clicked', () => {
  const { photos: [photo], context, stage } = fixture(390, 844, 1)
  for (let frame = 0; frame < 72; frame++) stage.update(.05)
  const copy = photo!.userData.presentation?.find(surface => surface.parent === context.scene && surface.position.z > photo!.position.z)
  assert.ok(copy)
  const z = copy.position.z
  context.emit('stage:focus', { index: 0, surface: copy })
  stage.update(0)
  assert.equal(photo!.position.z, z)
  stage.uninstall()
})

test('the next and previous controls use adjacent laps at the Fold seam', () => {
  const { context, stage } = fixture(390, 844, 50)
  context.emit('stage:autoplay', false)
  context.emit('stage:select', 49)
  for (let frame = 0; frame < 60; frame++) stage.update(.05)
  const last = context.camera.position.z
  context.emit('stage:step', 1)
  for (let frame = 0; frame < 30; frame++) stage.update(.05)
  assert.ok(last - context.camera.position.z > 0 && last - context.camera.position.z < 400)
  context.emit('stage:step', -1)
  for (let frame = 0; frame < 30; frame++) stage.update(.05)
  assert.ok(Math.abs(context.camera.position.z - last) < 1)
  stage.uninstall()
})

test('the focus follows the current work when the lightbox changes chapter', () => {
  const { photos, context, stage } = fixture(1440, 900, 80, true)
  context.on('stage:open', () => context.emit('stage:suspend', true))
  context.emit('stage:focus', { index: 49 })
  stage.update(.05)
  context.emit('stage:select', 50)
  stage.update(.05)
  const point = photos[50]!.position.clone().project(context.camera)
  assert.ok(Math.abs(point.x) < .001 && Math.abs(point.y) < .001)
  stage.uninstall()
})

test('pausing the tour settles the photograph positions and camera', () => {
  const { photos, context, stage } = fixture(1440, 900, 42)
  for (let frame = 0; frame < 64; frame++) stage.update(.05)
  context.emit('stage:autoplay', false)
  for (let frame = 0; frame < 20; frame++) stage.update(.05)
  const camera = context.camera.position.toArray()
  const position = photos[0]!.position.toArray()
  for (let frame = 0; frame < 10; frame++) stage.update(.05)
  assert.deepEqual(context.camera.position.toArray(), camera)
  assert.deepEqual(photos[0]!.position.toArray(), position)
  stage.uninstall()
})

test('live camera settings reach the collection tour without resetting a manual pause on unrelated edits', () => {
  const { context, stage } = fixture(1440, 900, 42)
  context.config.camera.autoRotate = false
  context.emit('config:update', context.config)
  for (let frame = 0; frame < 20; frame++) stage.update(.05)
  const paused = context.camera.position.toArray()
  for (let frame = 0; frame < 10; frame++) stage.update(.05)
  assert.deepEqual(context.camera.position.toArray(), paused)

  context.config.camera.autoRotate = true
  context.emit('config:update', context.config)
  for (let frame = 0; frame < 30; frame++) stage.update(.05)
  assert.notDeepEqual(context.camera.position.toArray(), paused)

  context.emit('stage:autoplay', false)
  for (let frame = 0; frame < 20; frame++) stage.update(.05)
  const manuallyPaused = context.camera.position.toArray()
  context.emit('config:update', context.config)
  for (let frame = 0; frame < 30; frame++) stage.update(.05)
  assert.deepEqual(context.camera.position.toArray(), manuallyPaused)
  stage.uninstall()
})
