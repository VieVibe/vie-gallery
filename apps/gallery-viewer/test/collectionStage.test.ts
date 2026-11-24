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
    return mesh
  })
  const context = createViewerContext(applySpatialPreset(createDefaultViewerConfig(), 'fold'), photos)
  context.reducedMotion = () => reduced
  context.camera = new THREE.PerspectiveCamera(50, width / height, 1, 6000)
  Object.assign(context.renderer, { domElement: Object.assign(new EventTarget(), { clientHeight: height, clientWidth: width }) })
  const stage = new CollectionStagePlugin()
  stage.install(context)
  return { photos, context, stage }
}

function inFrame(mesh: PhotoMesh, camera: THREE.Camera) {
  const point = mesh.position.clone().project(camera)
  return mesh.visible && Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1
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
  context.emit('stage:step', 1)
  for (let frame = 0; frame < 20; frame++) stage.update(.05)
  assert.ok(inFrame(photos[1]!, context.camera), 'the next work is in front of the camera')
  stage.uninstall()
})

test('the focus follows the current work when the lightbox changes chapter', () => {
  const { photos, context, stage } = fixture(1440, 900, 80, true)
  context.on('stage:open', () => context.emit('stage:suspend', true))
  context.emit('stage:focus', 49)
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
