import * as THREE from 'three'
import type { PhotoMesh } from './types'

/** One physical strip, using the gallery's own photo meshes and pooled textures. */
export class FilmRibbon {
  private strip = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: '#080909', side: THREE.DoubleSide }))
  private originals = new Map<PhotoMesh, Float32Array>()
  private deformed = new WeakMap<PhotoMesh, number>()
  private signature = ''
  constructor(scene: THREE.Scene) { this.strip.name = 'film-ribbon'; scene.add(this.strip) }

  render(photos: PhotoMesh[], cursor: number, frame: { width: number; height: number; centerY: number }, mobile: boolean, spacing: number, size: number) {
    this.strip.visible = photos.length > 1
    const height = Math.min(frame.height * .88, frame.width * (mobile ? 1.12 : .64)) * size
    const radius = frame.width * (mobile ? 1.5 : 1.65)
    const gap = 14 * spacing
    const keep = new Set(photos)
    for (const photo of this.originals.keys()) if (!keep.has(photo)) this.originals.delete(photo)
    const widths = photos.map(photo => {
      const p = (photo.geometry as THREE.PlaneGeometry).parameters
      return height * p.width / p.height
    })
    const starts: number[] = []
    let length = 0
    for (const width of widths) { starts.push(length + width / 2); length += width + gap }
    const count = photos.length
    if (!count) { this.hide(); return }
    const base = Math.floor(cursor), part = cursor - base
    const index = ((base % count) + count) % count
    const next = (index + 1) % count
    const advance = (widths[index] + widths[next]) / 2 + gap
    const center = starts[index] + part * advance
    const key = `${height}:${radius}:${frame.width}:${frame.centerY}`
    if (key !== this.signature) {
      this.signature = key
      this.buildStrip(radius, height, frame.width * 2.4, frame.centerY)
    }
    for (let i = 0; i < count; i++) {
      const photo = photos[i]
      let distance = starts[i] - center
      distance = ((distance + length / 2) % length + length) % length - length / 2
      if (count === 1) distance = 0
      const angle = distance / radius
      photo.visible = Math.abs(angle) < 1.25
      const geometry = photo.geometry as THREE.PlaneGeometry
      if (!this.originals.has(photo)) this.originals.set(photo, new Float32Array(geometry.attributes.position.array))
      const original = this.originals.get(photo)!
      const scale = height / geometry.parameters.height
      photo.scale.setScalar(scale)
      photo.userData.layoutScale = scale
      photo.position.set(Math.sin(angle) * radius, frame.centerY + distance * .065, 180 + (Math.cos(angle) - 1) * radius)
      photo.rotation.set(0, angle, 0)
      // Bend each printed image onto the same cylinder as the continuous stock.
      const vertices = geometry.attributes.position as THREE.BufferAttribute
      if (this.deformed.get(photo) !== radius / scale) {
        for (let v = 0; v < vertices.count; v++) {
          const x = original[v * 3], localAngle = x * scale / radius
          vertices.setXYZ(v, Math.sin(localAngle) * radius / scale, original[v * 3 + 1] + x * .065,
            (Math.cos(localAngle) - 1) * radius / scale)
        }
        vertices.needsUpdate = true
        geometry.computeVertexNormals(); geometry.computeBoundingSphere()
        this.deformed.set(photo, radius / scale)
      }
      const material = photo.material as THREE.MeshStandardMaterial
      material.color.setScalar(.1); material.emissiveIntensity = .94
      material.opacity = Math.min(1, Math.max(0, (1.25 - Math.abs(angle)) * 8))
      material.transparent = true
      if (material.toneMapped) { material.toneMapped = false; material.needsUpdate = true }
    }
  }

  private buildStrip(radius: number, height: number, extent: number, centerY: number) {
    const positions: number[] = []
    const add = (a: number, b: number, bottom: number, top: number) => {
      for (const [s, y] of [[a,bottom],[b,bottom],[b,top],[a,bottom],[b,top],[a,top]]) {
        const angle = s / radius
        positions.push(Math.sin(angle) * radius, centerY + s * .065 + y, 175 + (Math.cos(angle) - 1) * radius)
      }
    }
    const step = 18
    for (let s = -extent; s < extent; s += step) {
      add(s, s + step, -height / 2 - 7, height / 2 + 7)
      for (const sign of [-1, 1]) {
        const edge = sign * height / 2
        const band = (low: number, high: number, a = s, b = s + step) => add(a, b, edge + sign * low, edge + sign * high)
        band(7, 12); band(23, 28); band(12, 23, s, s + 6)
      }
    }
    this.strip.geometry.dispose()
    this.strip.geometry = new THREE.BufferGeometry()
    this.strip.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.strip.geometry.computeBoundingSphere()
  }

  hide() {
    this.strip.visible = false
    for (const [photo, positions] of this.originals) {
      const geometry = photo.geometry as THREE.BufferGeometry
      geometry.attributes.position.array.set(positions)
      geometry.attributes.position.needsUpdate = true
      geometry.computeVertexNormals(); geometry.computeBoundingSphere()
    }
    this.originals.clear()
    this.deformed = new WeakMap()
  }
  dispose() { this.hide(); this.strip.removeFromParent(); this.strip.geometry.dispose(); this.strip.material.dispose() }
}
