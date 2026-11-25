import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { normalizeViewerConfig } from '@vie/gallery-contracts'
import { CollectionStagePlugin } from '../src/plugins/CollectionStagePlugin'
import type { PhotoMesh } from '../src/core/types'
import { createViewerContext } from './helpers/viewerContext'

function fixture(width: number, height: number, count: number, reduced = false, arrangement = 'fold', dataset: Record<string, string> = {}) {
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
  const authored = normalizeViewerConfig({ layout: { params: { composition: 'curated', arrangement } }, camera: { autoRotate: true } })
  assert.deepEqual(authored.issues, [])
  const context = createViewerContext(authored.config, photos)
  context.scene.add(...photos)
  context.reducedMotion = () => reduced
  context.camera = new THREE.PerspectiveCamera(50, width / height, 1, 6000)
  Object.assign(context.renderer, { domElement: Object.assign(new EventTarget(), { clientHeight: height, clientWidth: width, dataset }) })
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

for (const arrangement of ['burst', 'domino', 'fans']) {
  test(`${arrangement} moves photographs in depth while leaving the camera fixed`, () => {
    const { photos, context, stage } = fixture(390, 844, 12, false, arrangement)
    const location = context.camera.position.toArray()
    const orientation = context.camera.quaternion.toArray()
    const opening = photos.map(photo => photo.position.z)
    const moved = new Set<number>()
    for (let i = 0; i < 66; i++) {
      stage.update(.05)
      photos.forEach((photo, index) => { if (Math.abs(photo.position.z - opening[index]!) > 25) moved.add(index) })
    }
    assert.deepEqual(context.camera.position.toArray(), location)
    assert.deepEqual(context.camera.quaternion.toArray(), orientation)
    assert.ok(moved.size >= 3)
    assert.ok(photos.filter(photo => inFrame(photo, context.camera)).length >= 10)
    context.emit('stage:autoplay', false)
    const snapshot = () => photos.map(photo => [photo.position.toArray(), photo.quaternion.toArray()])
    const paused = snapshot()
    for (let i = 0; i < 40; i++) stage.update(.05)
    assert.deepEqual(snapshot(), paused)
    stage.uninstall()
  })
}

test('choreography resumes at the next photo group after requesting another page', () => {
  const { photos, context, stage } = fixture(1280, 800, 13, false, 'burst')
  Object.assign(context.renderer.domElement, { dataset: { hasMore: 'true' } })
  let requested = false
  context.on('stage:load-more', () => { requested = true })
  let active = 0
  context.on('stage:change', ({ index }: { index: number }) => { active = index })
  assert.equal(photos.filter(photo => photo.visible).length, 12)
  for (let i = 0; i < 195; i++) stage.update(.05)
  assert.equal(requested, true)
  assert.equal(active, 12)
  assert.ok(photos[12]?.visible)
  assert.equal(photos[0]?.visible, false)
  stage.uninstall()
})

test('reduced motion displays every photograph in a fan group without playing', () => {
  const { photos, context, stage } = fixture(390, 844, 6, true, 'fans')
  const layout = photos.map(photo => photo.position.toArray())
  assert.equal(new Set(layout.map(String)).size, photos.length)
  assert.ok(photos.every(photo => inFrame(photo, context.camera)))
  for (let i = 0; i < 100; i++) stage.update(.05)
  assert.deepEqual(photos.map(photo => photo.position.toArray()), layout)
  stage.uninstall()
})

test('Photo Dragon keeps independent, legible faces in view throughout its 20-second lap', () => {
  const pages = { hasMore: 'true', photoTotal: '60' }
  const viewports = [[1600, 900, { presentation: 'preview' }], [1440, 900], [390, 844],
    [360, 640, pages, 376], [667, 375, pages, 210]] as const
  for (const [width, height, dataset, controlsTop] of viewports) {
    const { photos, context, stage } = fixture(width, height, 12, false, 'dragon', dataset)
    const opening = photos.map(photo => photo.position.clone())
    const ids = photos.map(photo => photo.id)
    let minFacing = 1
    let maxOverlap = 0
    let maxEdge = 0
    let bottom = 0
    let overlapAt = ''
    for (let frame = 0; frame < 250; frame++) {
      const boxes = photos.map(photo => {
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(photo.quaternion)
        minFacing = Math.min(minFacing, normal.dot(context.camera.position.clone().sub(photo.position).normalize()))
        const bounds = new THREE.Box2()
        photo.updateMatrixWorld(true)
        for (const x of [-40, 40]) for (const y of [-30, 30]) {
          const point = new THREE.Vector3(x, y, 0).applyMatrix4(photo.matrixWorld).project(context.camera)
          bounds.expandByPoint(new THREE.Vector2(point.x, point.y))
        }
        return bounds
      })
      for (const box of boxes) {
        maxEdge = Math.max(maxEdge, -box.min.x, -box.min.y, box.max.x, box.max.y)
        bottom = Math.max(bottom, (1 - box.min.y) * height / 2)
      }
      for (const [index, box] of boxes.entries()) for (let otherIndex = index + 1; otherIndex < boxes.length; otherIndex++) {
        const other = boxes[otherIndex]!
        const area = (bounds: THREE.Box2) => bounds.isEmpty() ? 0 : (bounds.max.x - bounds.min.x) * (bounds.max.y - bounds.min.y)
        const overlap = area(box.clone().intersect(other)) / Math.min(area(box), area(other))
        if (overlap > maxOverlap) {
          maxOverlap = overlap
          overlapAt = `${index}/${otherIndex} at ${(frame * .08).toFixed(2)}s`
        }
      }
      if (frame === 124) assert.ok(photos[0]!.position.distanceTo(opening[0]!) > 300)
      stage.update(.08)
    }
    assert.ok(minFacing > .8, `front-face cosine ${minFacing} at ${width}px`)
    assert.ok(maxEdge < .96, `projected edge ${maxEdge} at ${width}px`)
    assert.ok(maxOverlap < .36, `projected overlap ${maxOverlap} between ${overlapAt} at ${width}px`)
    if (controlsTop) assert.ok(bottom < controlsTop, `photos reach y=${bottom} under controls at y=${controlsTop} on ${width}px`)
    assert.deepEqual(photos.map(photo => photo.id), ids)
    assert.ok(photos.every((photo, index) => photo.position.distanceTo(opening[index]!) < .001))
    context.emit('stage:autoplay', false)
    stage.update(.08)
    assert.ok(photos.every((photo, index) => photo.position.distanceTo(opening[index]!) < .001))
    stage.uninstall()
  }
})

test('Photo Dragon leaves room for a head and body in the final group', () => {
  const { photos, context, stage } = fixture(1440, 900, 12, false, 'dragon', { hasMore: 'true', photoTotal: '13' })
  const shown = () => photos.filter(photo => photo.visible).map(photo => photo.userData.index)
  const firstGroup = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  assert.deepEqual(shown(), firstGroup)
  for (let frame = 0; frame < 250; frame++) stage.update(.08)
  assert.deepEqual(shown(), firstGroup)
  const last = photos[0]!.clone()
  last.userData.index = 12
  photos.push(last)
  context.scene.add(last)
  delete context.renderer.domElement.dataset.hasMore
  context.emit('photos:loaded')
  for (let frame = 0; frame < 250; frame++) stage.update(.08)
  assert.deepEqual(shown(), [9, 10, 11, 12])
  const opening = photos[9]!.position.clone()
  for (let frame = 0; frame < 30; frame++) stage.update(.08)
  assert.ok(photos[9]!.position.distanceTo(opening) > 100)
  context.emit('stage:select', 8)
  stage.update(0)
  assert.deepEqual(shown(), firstGroup)
  stage.uninstall()
})

test('short dragons have a leader and followers even with only two or three photos', () => {
  for (const count of [2, 3]) {
    const { photos, context, stage } = fixture(390, 844, count, false, 'dragon')
    for (let frame = 0; frame < 250; frame++) {
      const [head, next] = photos
      const direction = next!.position.clone().sub(head!.position)
      assert.ok(direction.length() > 200, 'the second work follows down the body')
      if (count === 3) {
        const tail = photos[2]!.position.clone().sub(next!.position)
        assert.ok(direction.dot(tail) > 0, 'the third work trails the second')
      }
      assert.ok(photos.every(photo => fullyInFrame(photo, context.camera)))
      stage.update(.08)
    }
    stage.uninstall()
  }
})

test('the dragon reuses its spine while stationary and refreshes it after resume or aspect changes', () => {
  const { context, stage } = fixture(1440, 900, 12, false, 'dragon')
  const guide = context.scene.children.find(child => child instanceof THREE.LineSegments) as THREE.LineSegments
  const positions = guide.geometry.getAttribute('position') as THREE.BufferAttribute
  context.emit('stage:autoplay', false)
  const paused = positions.version
  for (let i = 0; i < 10; i++) stage.update(.05)
  assert.equal(positions.version, paused)
  context.emit('stage:autoplay', true)
  stage.update(.05)
  assert.ok(positions.version > paused)
  context.reducedMotion = () => true
  stage.update(.05)
  const still = positions.version
  stage.update(.05)
  assert.equal(positions.version, still)
  const camera = context.camera as THREE.PerspectiveCamera
  camera.aspect = 390 / 844
  camera.updateProjectionMatrix()
  stage.update(.05)
  assert.ok(positions.version > still)
  stage.uninstall()
})
