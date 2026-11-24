import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { FilmRibbon } from '../src/core/FilmRibbon'
import type { PhotoMesh } from '../src/core/types'

test('the continuous ribbon bends pooled photo geometry, then restores it for other layouts', () => {
  const scene = new THREE.Scene()
  const photos = [1.5, .66, 2].map((ratio, index) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(80, 80 / ratio, 24, 24), new THREE.MeshStandardMaterial()) as PhotoMesh
    mesh.userData = { index, url: '', thumbnailUrl: '' }
    return mesh
  })
  const geometry = photos[0].geometry
  const material = photos[0].material
  const before = new Float32Array(geometry.attributes.position.array)
  const ribbon = new FilmRibbon(scene)
  const frame = { width: 700, height: 400, centerY: 0 }
  ribbon.render(photos, 0, frame, false, 1, 1)
  assert.equal(photos[0].geometry, geometry)
  assert.equal(photos[0].material, material)
  assert.notDeepEqual(geometry.attributes.position.array, before)
  const version = geometry.attributes.position.version
  ribbon.render(photos, .7, frame, false, 1, 1)
  assert.equal(geometry.attributes.position.version, version, 'navigation reuses the already bent geometry')
  assert.ok(photos[0].position.x < 0)
  for (const mesh of photos) assert.equal(mesh.scale.x, mesh.scale.y)
  ribbon.hide()
  assert.deepEqual(geometry.attributes.position.array, before)
  ribbon.render(photos, 1, { width: 300, height: 400, centerY: 10 }, true, 1, 1)
  assert.notDeepEqual(geometry.attributes.position.array, before)
  ribbon.dispose()
  assert.deepEqual(geometry.attributes.position.array, before)
  assert.equal(scene.children.length, 0)
})
