import * as THREE from 'three'
import { resolveSpatialPreset, type SpatialPreset } from '@vie/gallery-contracts'
import type { PhotoMesh, ViewerContext, ViewerPlugin } from '../core/types'
import { COLLECTION_UNIT as unit, collectionChapter, collectionPose, foldCenter, spaceBlades, spacePoint, tideColumns, tideDepth } from '../lib/collectionLayout'

type Pose = { position: THREE.Vector3; rotation: THREE.Quaternion; scale: number }

export class CollectionStagePlugin implements ViewerPlugin {
  name = 'CollectionStage'
  version = '1.0.0'

  private context!: ViewerContext
  private canvas!: HTMLCanvasElement
  private preset!: SpatialPreset
  private index = 0
  private foldBay = 0
  private time = 0
  private autoplay = false
  private wakeTime = 0
  private suspended = false
  private immersive = false
  private focus: { index: number; amount: number; opened: boolean } | null = null
  private drag: { id: number; x: number; y: number } | null = null
  private aim = new THREE.Vector2()
  private orbit = new THREE.Vector2()
  private eye = new THREE.Vector3()
  private look = new THREE.Vector3()
  private currentLook = new THREE.Vector3()
  private position = new THREE.Vector3()
  private rotation = new THREE.Quaternion()
  private euler = new THREE.Euler()
  private focusPosition = new THREE.Vector3()
  private snapCamera = true
  private from = new Map<PhotoMesh, Pose>()
  private morphTime = 1.2
  private lineVertices = new Float32Array(2400 * 3)
  private guides = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#648a76', transparent: true, opacity: .34, depthWrite: false }))

  install(context: ViewerContext) {
    this.context = context
    this.canvas = context.renderer.domElement
    this.preset = resolveSpatialPreset(context.config)!
    this.autoplay = context.config.camera?.autoRotate ?? true
    this.guides.geometry.setAttribute('position', new THREE.BufferAttribute(this.lineVertices, 3).setUsage(THREE.DynamicDrawUsage))
    this.guides.frustumCulled = false
    context.addToScene(this.guides)
    for (const [name, handler] of this.events) context.on(name, handler)
    this.canvas.addEventListener('pointerdown', this.pointerDown)
    this.canvas.addEventListener('pointermove', this.pointerMove)
    this.canvas.addEventListener('pointerup', this.pointerEnd)
    this.canvas.addEventListener('pointercancel', this.pointerEnd)
    this.canvas.addEventListener('wheel', this.wheel, { passive: false })
    this.canvas.addEventListener('keydown', this.key)
    this.update(0)
  }

  private get events() {
    return [
      ['stage:step', this.step], ['stage:select', this.select], ['stage:focus', this.openPhoto],
      ['stage:autoplay', this.setAutoplay], ['stage:suspend', this.setSuspended], ['stage:immersive', this.setImmersive],
      ['stage:reset', this.reset], ['config:update', this.configChanged], ['photos:loaded', this.photosChanged]
    ] as const
  }

  private reportIndex() {
    this.context.emit('stage:change', { index: this.index, count: this.context.photos.length })
  }

  private photosChanged = () => {
    this.index = Math.max(0, Math.min(this.index, this.context.photos.length - 1))
    this.reportIndex()
  }

  private select = (index: number) => { this.setSelection(index, true) }

  private setSelection(index: number, reposition: boolean) {
    if (!Number.isInteger(index) || index < 0 || index >= this.context.photos.length || index === this.index) return
    const chapter = collectionChapter(index, this.context.photos.length)
    const newChapter = chapter.start !== collectionChapter(this.index, this.context.photos.length).start
    if (newChapter || (reposition && this.preset === 'fold')) {
      this.foldBay = Math.floor((index - chapter.start) / 6)
      this.time = 0
      this.wakeTime = 0
      this.aim.set(0, 0)
    }
    if (newChapter) {
      this.snapCamera = true
      this.from.clear()
    }
    this.index = index
    if (this.suspended && this.focus?.opened) this.focus.index = index
    this.reportIndex()
    this.context.emit('stage:interaction')
  }

  private step = (direction: number) => {
    const count = this.context.photos.length
    if (!this.suspended && !this.focus && count && Number.isFinite(direction)) {
      this.select((this.index + Math.sign(direction) + count) % count)
    }
  }

  private openPhoto = (index: number) => {
    if (this.suspended || this.focus || !Number.isInteger(index) || !this.context.photos[index]) return
    this.setSelection(index, false)
    this.focus = { index, amount: 0, opened: false }
    this.context.emit('stage:interaction')
  }

  private setAutoplay = (enabled: boolean) => { this.autoplay = enabled }
  private setImmersive = (enabled: boolean) => { this.immersive = enabled }
  private setSuspended = (value: boolean) => {
    this.suspended = value
    this.cancelDrag()
    if (value && this.focus && !this.focus.opened) this.focus = null
    this.context.emit('stage:interaction')
  }

  private reset = () => {
    this.select(0)
    this.foldBay = 0
    this.time = 0
    this.wakeTime = 0
    this.aim.set(0, 0)
    this.snapCamera = true
  }

  private configChanged = () => {
    const next = resolveSpatialPreset(this.context.config)
    if (!next || next === this.preset) return
    this.from.clear()
    for (const photo of this.context.photos) {
      if (photo.visible) this.from.set(photo, { position: photo.position.clone(), rotation: photo.quaternion.clone(), scale: photo.scale.x })
    }
    this.preset = next
    this.foldBay = Math.floor((this.index - collectionChapter(this.index, this.context.photos.length).start) / 6)
    this.morphTime = 0
    this.time = 0
    this.wakeTime = 0
    this.aim.set(0, 0)
    this.focus = null
    this.cancelDrag()
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || this.suspended || this.focus) return
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
    this.canvas.setPointerCapture(event.pointerId)
  }

  private pointerMove = (event: PointerEvent) => {
    const drag = this.drag
    if (!drag || drag.id !== event.pointerId) return
    this.moveView((drag.x - event.clientX) * .006, (event.clientY - drag.y) * .004)
    drag.x = event.clientX
    drag.y = event.clientY
  }

  private pointerEnd = (event: PointerEvent) => {
    if (this.drag?.id === event.pointerId) this.cancelDrag()
  }

  private cancelDrag() {
    if (this.drag && this.canvas.hasPointerCapture(this.drag.id)) this.canvas.releasePointerCapture(this.drag.id)
    this.drag = null
  }

  private moveView(horizontal: number, vertical: number) {
    this.aim.set(THREE.MathUtils.clamp(this.aim.x + horizontal, -.91, .91), THREE.MathUtils.clamp(this.aim.y + vertical, -.76, .76))
    this.context.emit('stage:interaction')
  }

  private wheel = (event: WheelEvent) => {
    if (this.suspended || this.focus) return
    event.preventDefault()
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    this.moveView(THREE.MathUtils.clamp(delta * .002, -.24, .24), 0)
  }

  private key = (event: KeyboardEvent) => {
    if (this.suspended || this.focus || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      this.step(event.key === 'ArrowRight' ? 1 : -1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.openPhoto(this.index)
    }
  }

  private frameCamera(camera: THREE.PerspectiveCamera, count: number, compact: boolean, blend: number) {
    const aspect = camera.aspect || 1
    const height = this.canvas.clientHeight || 800
    const preview = this.canvas.dataset?.presentation === 'preview'
    const short = height < 580
    const top = preview || this.immersive ? 20 : short ? 106 : 142
    const bottom = preview || this.immersive ? 20 : (short ? 108 : 142) + (this.canvas.dataset?.hasMore ? 45 : 0)
    const tangent = Math.tan(camera.fov * Math.PI / 360)
    const usableHeight = Math.max(.46, 1 - (top + bottom) / height)
    const centerY = (top - bottom) / height
    const tide = this.preset === 'tide'
    if (this.preset === 'fold' && count > 1) {
      const factor = compact ? .74 : 1
      // Keep room for both faces of the nearest complete bay at every stop.
      const setback = Math.max(9.8, 4 * factor / (aspect * tangent * .86), 2.75 / (tangent * usableHeight))
      const start = 8.75 + setback
      const lastBay = Math.floor((count - 1) / 6)
      const end = start - lastBay * 3.58
      const base = start - Math.min(this.foldBay, lastBay) * 3.58
      const cruise = (base - end) * .5 * (1 - Math.cos(this.time * .22))
      const z = THREE.MathUtils.clamp(base - cruise - this.orbit.x * (start - end), end, start + 1.2)
      this.eye.set(foldCenter(z) * factor, .45 + this.orbit.y * 1.35, z)
      this.look.set(foldCenter(z - setback) * factor, centerY * tangent * setback + this.orbit.y * .5, z - setback)
    } else {
      const columns = tideColumns(count, compact)
      const halfWidth = count === 1 ? 3.45 : tide ? (columns - 1) * 1.11 + 1.1 : compact ? 6.45 : 7.85
      const halfHeight = count === 1 ? 2.65 : tide ? (Math.ceil(count / columns) - 1) * .73 + 1.0 : 5.1
      const distance = Math.max(count === 1 ? 8.4 : 13.6, halfWidth / (aspect * tangent * .93) + 1.15,
        halfHeight / (tangent * usableHeight) + 1.65)
      const yaw = (tide ? -.12 : .04) + (tide ? .20 : .31) * Math.sin(this.time * .38) + this.orbit.x
      this.eye.set(distance * Math.sin(yaw), 1.6 + .85 * Math.sin(this.time * .53) + this.orbit.y * 4.2, distance * Math.cos(yaw))
      this.look.set(0, centerY * tangent * distance, 0)
    }
    this.eye.multiplyScalar(unit)
    this.look.multiplyScalar(unit)
    camera.position.lerp(this.eye, camera.position.distanceToSquared(this.eye) < .25 ? 1 : blend)
    this.currentLook.lerp(this.look, this.currentLook.distanceToSquared(this.look) < .25 ? 1 : blend)
    camera.lookAt(this.currentLook)
    camera.updateMatrixWorld()
    camera.getWorldDirection(this.focusPosition).multiplyScalar(6 * unit).add(camera.position)
  }

  update(delta: number) {
    const { photos } = this.context
    const chapter = collectionChapter(this.index, photos.length)
    const camera = this.context.camera as THREE.PerspectiveCamera
    const reduced = this.context.reducedMotion()
    const dt = Math.min(delta, .05)
    if (this.autoplay && !reduced && !this.suspended && !this.drag && !this.focus && chapter.count > 1) {
      this.time += dt
      if (this.time - this.wakeTime >= 2) {
        this.wakeTime = this.time
        this.context.emit('stage:interaction')
      }
    }
    if (!chapter.count) {
      this.guides.visible = false
      return
    }
    const blend = reduced || this.snapCamera ? 1 : 1 - Math.exp(-dt * 7.4)
    this.orbit.lerp(this.aim, this.orbit.distanceToSquared(this.aim) < 1e-7 ? 1 : blend)
    const compact = camera.aspect < .82
    this.frameCamera(camera, chapter.count, compact, blend)
    this.snapCamera = false
    this.morphTime += reduced ? 1.2 : dt
    if (this.morphTime >= 1.2) this.from.clear()

    const focus = this.focus
    if (focus) {
      const target = focus.opened && !this.suspended ? 0 : 1
      const travel = reduced ? 1 : dt * 2.7
      focus.amount = THREE.MathUtils.clamp(focus.amount + (target ? travel : -travel), 0, 1)
    }

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      const local = i - chapter.start
      photo.visible = local >= 0 && local < chapter.count
      if (!photo.visible) continue
      const zoom = focus ? THREE.MathUtils.smoothstep(focus.amount, 0, 1) : 0
      const pose = collectionPose(this.preset, local, chapter.count, this.time, compact, zoom)
      this.position.set(pose.x * unit, pose.y * unit, pose.z * unit)
      this.rotation.setFromEuler(this.euler.set(pose.rx, pose.ry, pose.rz))
      const { width, height } = (photo.geometry as THREE.PlaneGeometry).parameters
      const fitLimit = chapter.count === 1 ? 5.5 : 2.12
      let scale = Math.min(pose.size * unit / Math.sqrt(width * height), fitLimit * unit / Math.max(width, height))
      if (i === this.index && chapter.count > 1) scale *= 1.04
      if (focus?.index === i) {
        this.position.lerp(this.focusPosition, zoom)
        this.rotation.slerp(camera.quaternion, zoom)
        const viewHeight = 12 * unit * Math.tan(camera.fov * Math.PI / 360)
        const fit = Math.min(viewHeight * .68 / height, viewHeight * camera.aspect * .86 / width)
        scale = THREE.MathUtils.lerp(scale, fit, zoom)
      }
      const before = this.from.get(photo)
      if (before) {
        const progress = THREE.MathUtils.smoothstep(this.morphTime, (local % 7) * .021, 1.2)
        photo.position.lerpVectors(before.position, this.position, progress)
        photo.position.y += 38 * Math.sin(progress * Math.PI)
        photo.quaternion.copy(before.rotation).slerp(this.rotation, progress)
        photo.scale.setScalar(THREE.MathUtils.lerp(before.scale, scale, progress))
      } else {
        photo.position.copy(this.position)
        photo.quaternion.copy(this.rotation)
        photo.scale.setScalar(scale)
      }
      photo.userData.layoutScale = photo.scale.x
      const material = photo.material as THREE.MeshStandardMaterial
      material.opacity = 1
      material.color.set(material.map ? '#000000' : '#d3e0d1')
      material.emissiveIntensity = i === focus?.index ? 1 : 1 - .24 * zoom
      if (material.toneMapped || material.transparent) {
        material.toneMapped = false
        material.transparent = false
        material.needsUpdate = true
      }
    }
    this.drawGuides(chapter.count, compact, focus ? THREE.MathUtils.smoothstep(focus.amount, 0, 1) : 0)
    if (focus && !focus.opened && focus.amount === 1) {
      focus.opened = true
      this.context.emit('stage:open', focus.index)
    } else if (focus?.opened && !this.suspended && focus.amount === 0) this.focus = null
  }

  private drawGuides(count: number, compact: boolean, focus: number) {
    this.guides.visible = count > 1
    if (count <= 1) return
    let offset = 0
    const line = (x: number, y: number, z: number, nextX: number, nextY: number, nextZ: number) => {
      this.lineVertices[offset++] = x * unit
      this.lineVertices[offset++] = y * unit
      this.lineVertices[offset++] = z * unit
      this.lineVertices[offset++] = nextX * unit
      this.lineVertices[offset++] = nextY * unit
      this.lineVertices[offset++] = nextZ * unit
    }
    if (this.preset === 'tide') {
      const columns = tideColumns(count, compact)
      const rows = Math.ceil(count / columns)
      const width = columns * 2.22
      for (let row = 0; row <= rows; row++) {
        const y = (rows / 2 - row) * 1.46
        for (let step = 0; step < 28; step++) {
          const x = (step / 28 - .5) * width, next = x + width / 28
          const z = tideDepth(x, y, this.time), nextZ = tideDepth(next, y, this.time)
          line(x, y + .22 * z, z - .34, next, y + .22 * nextZ, nextZ - .34)
        }
      }
    } else if (this.preset === 'fold') {
      const factor = compact ? .74 : 1
      for (let bay = 0; bay <= Math.ceil(count / 6) + 1; bay++) {
        const z = 12.22 - bay * 3.58, x = foldCenter(z) * factor
        const end = z - 3.58, next = foldCenter(end) * factor
        const width = 4.17 * factor
        line(x - width, -2.83, z, x + width, -2.83, z)
        line(x - width, 2.93, z, x + width, 2.93, z)
        for (const side of [-1, 1]) {
          line(x + side * width, -2.83, z, x + side * width, 2.93, z)
          line(x + side * width, -2.83, z, next + side * width, -2.83, end)
          line(x + side * width, 2.93, z, next + side * width, 2.93, end)
          line(x + side * 1.30 * factor, -2.83, z, next + side * 1.30 * factor, -2.83, end)
        }
      }
    } else {
      const blades = spaceBlades(count)
      for (let blade = 0; blade < blades; blade++) {
        for (let step = 0; step < 20; step++) {
          const u = step / 20, v = (step + 1) / 20
          for (const side of [-1, 1]) {
            const from = spacePoint(blade, blades, u * 1.28 - .16, side * 1.28, this.time, compact, focus)
            const to = spacePoint(blade, blades, v * 1.28 - .16, side * 1.28, this.time, compact, focus)
            line(from.x, from.y, from.z - .36, to.x, to.y, to.z - .36)
          }
          for (const radius of [-.13, 1.14]) {
            const from = spacePoint(blade, blades, radius, (u - .5) * 4.16, this.time, compact, focus)
            const to = spacePoint(blade, blades, radius, (v - .5) * 4.16, this.time, compact, focus)
            line(from.x, from.y, from.z - .42, to.x, to.y, to.z - .42)
          }
        }
      }
    }
    this.guides.geometry.setDrawRange(0, offset / 3)
    this.guides.geometry.attributes.position!.needsUpdate = true
  }

  uninstall() {
    this.cancelDrag()
    for (const [name, handler] of this.events) this.context.off(name, handler)
    this.canvas.removeEventListener('pointerdown', this.pointerDown)
    this.canvas.removeEventListener('pointermove', this.pointerMove)
    this.canvas.removeEventListener('pointerup', this.pointerEnd)
    this.canvas.removeEventListener('pointercancel', this.pointerEnd)
    this.canvas.removeEventListener('wheel', this.wheel)
    this.canvas.removeEventListener('keydown', this.key)
    this.guides.removeFromParent()
    this.guides.geometry.dispose()
    this.guides.material.dispose()
    this.from.clear()
    this.focus = null
    for (const photo of this.context.photos) {
      photo.visible = true
      const material = photo.material as THREE.MeshStandardMaterial
      material.color.set(material.map ? '#ffffff' : '#b8bcc4')
      material.toneMapped = true
      material.emissiveIntensity = .25
      material.needsUpdate = true
    }
  }
}
