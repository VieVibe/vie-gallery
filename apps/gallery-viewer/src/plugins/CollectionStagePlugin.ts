import * as THREE from 'three'
import { isPhotoChoreography, resolveSpatialPreset, type PhotoChoreography, type SpatialPreset } from '@vie/gallery-contracts'
import type { PhotoMesh, ViewerContext, ViewerPlugin } from '../core/types'
import {
  COLLECTION_UNIT as unit, FOLD_BAY_SPACING, FOLD_FIRST_BAY_Z, FOLD_PHOTOS_PER_BAY,
  collectionChapter, collectionPose, foldCenter, foldPose, spaceBlades, spacePoint, tideColumns, tideDepth
} from '../lib/collectionLayout'
import { CHOREOGRAPHY_GROUP_SIZE, choreographyCycle, choreographyHold, choreographyPose, dragonChapter, dragonSpine } from '../lib/photoChoreography'

type Pose = { position: THREE.Vector3; rotation: THREE.Quaternion; scale: number }
type FoldWindow = { cameraZ: number; nearBay: number; farBay: number; cycle: number; count: number; total: number; compact: boolean; hasMore: boolean }
type FoldBays = { first: number; last: number; primary: number }
const FOLD_HORIZON = 52

function foldBayCount(count: number) {
  return Math.ceil(count / FOLD_PHOTOS_PER_BAY)
}

function foldCycle(count: number) {
  return Math.max(4, foldBayCount(count))
}

function foldDepthFade(depth: number) {
  return 1 - THREE.MathUtils.smoothstep(depth, 32, FOLD_HORIZON - 1)
}

export class CollectionStagePlugin implements ViewerPlugin {
  name = 'CollectionStage'
  version = '1.0.0'

  private context!: ViewerContext
  private canvas!: HTMLCanvasElement
  private preset!: SpatialPreset
  private index = 0
  private foldTravel = 0
  private foldRequestedCount = 0
  private foldLoadCooldown = 0
  private choreographyLoadCooldown = 0
  private foldCopies = new Map<PhotoMesh, THREE.Mesh[]>()
  private time = 0
  private autoplay = false
  private configuredAutoplay = false
  private wakeTime = 0
  private suspended = false
  private immersive = false
  private focus: { index: number; amount: number; opened: boolean; bay?: number } | null = null
  private drag: { id: number; x: number; y: number } | null = null
  private aim = new THREE.Vector2()
  private orbit = new THREE.Vector2()
  private eye = new THREE.Vector3()
  private look = new THREE.Vector3()
  private currentLook = new THREE.Vector3()
  private position = new THREE.Vector3()
  private rotation = new THREE.Quaternion()
  private facing = new THREE.Quaternion()
  private photoLook = new THREE.Matrix4()
  private euler = new THREE.Euler()
  private focusPosition = new THREE.Vector3()
  private guideEnd = new THREE.Vector3()
  private dragonGuide = { time: NaN, count: 0, compact: false }
  private snapCamera = true
  private from = new Map<PhotoMesh, Pose>()
  private morphTime = 1.2
  private lineVertices = new Float32Array(2400 * 3)
  private lineColors = new Float32Array(2400 * 4).fill(1)
  private guides = new THREE.LineSegments(new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: '#648a76', vertexColors: true, transparent: true, opacity: .34, depthWrite: false }))

  install(context: ViewerContext) {
    this.context = context
    this.canvas = context.renderer.domElement
    this.preset = resolveSpatialPreset(context.config)!
    this.autoplay = this.configuredAutoplay = context.config.camera?.autoRotate ?? true
    this.guides.geometry.setAttribute('position', new THREE.BufferAttribute(this.lineVertices, 3).setUsage(THREE.DynamicDrawUsage))
    this.guides.geometry.setAttribute('color', new THREE.BufferAttribute(this.lineColors, 4).setUsage(THREE.DynamicDrawUsage))
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
    this.clearFoldCopies()
    this.reportIndex()
  }

  private select = (index: number) => { this.setSelection(index, true) }

  private totalPhotos(loaded: number) {
    return Math.max(loaded, Number(this.canvas.dataset?.photoTotal) || 0)
  }

  private chapterAt(index: number, count: number) {
    if (this.preset === 'dragon') return dragonChapter(index, count, this.totalPhotos(count))
    return collectionChapter(index, count, isPhotoChoreography(this.preset) ? CHOREOGRAPHY_GROUP_SIZE : undefined)
  }

  private setSelection(index: number, reposition: boolean, direction = 0) {
    if (!Number.isInteger(index) || index < 0 || index >= this.context.photos.length || index === this.index) return
    const count = this.context.photos.length
    const fold = this.preset === 'fold'
    const newChapter = this.chapterAt(index, count).start !== this.chapterAt(this.index, count).start
    const wraps = fold && direction !== 0 && !this.canvas.dataset?.hasMore && Math.sign(index - this.index) !== direction
    if (fold && reposition) {
      const cycle = foldCycle(count)
      const lap = Math.floor(this.foldTravel / cycle) + (wraps ? direction : 0)
      this.foldTravel = Math.max(0, lap) * cycle + Math.floor(index / FOLD_PHOTOS_PER_BAY)
      if (lap < 0) this.snapCamera = true
      this.aim.set(0, 0)
    } else if (!fold && newChapter) {
      this.time = 0
      this.wakeTime = 0
      this.aim.set(0, 0)
    }
    if (newChapter && (!fold || (reposition && !wraps))) {
      this.snapCamera = true
      this.from.clear()
    }
    this.index = index
    if (this.suspended && this.focus?.opened) {
      this.focus.index = index
      this.focus.bay = undefined
    }
    this.reportIndex()
    this.context.emit('stage:interaction')
  }

  private step = (direction: number) => {
    const count = this.context.photos.length
    if (!this.suspended && !this.focus && count && Number.isFinite(direction)) {
      const step = Math.sign(direction)
      this.setSelection((this.index + step + count) % count, true, step)
    }
  }

  private openPhoto = ({ index, surface }: { index: number; surface?: THREE.Mesh }) => {
    if (this.suspended || this.focus || !Number.isInteger(index) || !this.context.photos[index]) return
    this.setSelection(index, false)
    const bay = this.preset === 'fold' && surface
      ? Math.round((FOLD_FIRST_BAY_Z - surface.getWorldPosition(this.position).z / unit) / FOLD_BAY_SPACING)
      : undefined
    this.focus = { index, amount: 0, opened: false, bay }
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
    this.foldTravel = 0
    this.time = 0
    this.wakeTime = 0
    this.aim.set(0, 0)
    this.snapCamera = true
  }

  private configChanged = () => {
    const enabled = this.context.config.camera?.autoRotate ?? true
    if (enabled !== this.configuredAutoplay) this.setAutoplay(enabled)
    this.configuredAutoplay = enabled
    const next = resolveSpatialPreset(this.context.config)
    if (!next || next === this.preset) return
    this.clearFoldCopies()
    this.from.clear()
    const nextTravel = Math.floor(this.index / FOLD_PHOTOS_PER_BAY)
    const offset = ((this.preset === 'fold' ? this.foldTravel : 0) - (next === 'fold' ? nextTravel : 0)) * FOLD_BAY_SPACING * unit
    this.context.camera.position.z += offset
    this.currentLook.z += offset
    for (const photo of this.context.photos) {
      if (!photo.visible) continue
      const position = photo.position.clone()
      position.z += offset
      this.from.set(photo, { position, rotation: photo.quaternion.clone(), scale: photo.scale.x })
    }
    this.preset = next
    this.dragonGuide.time = NaN
    this.guides.material.opacity = .34
    this.snapCamera ||= isPhotoChoreography(next)
    this.foldTravel = nextTravel
    this.choreographyLoadCooldown = 0
    this.morphTime = 0
    this.time = 0
    this.wakeTime = 0
    this.aim.set(0, 0)
    this.focus = null
    this.cancelDrag()
  }

  private pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || this.suspended || this.focus || isPhotoChoreography(this.preset)) return
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
    if (this.suspended || this.focus || isPhotoChoreography(this.preset)) return
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
      this.openPhoto({ index: this.index })
    }
  }

  private frameCamera(camera: THREE.PerspectiveCamera, count: number, compact: boolean, blend: number) {
    const aspect = camera.aspect || 1
    const height = this.canvas.clientHeight || 800
    const preview = this.canvas.dataset?.presentation === 'preview'
    const short = height < 580
    const shortDock = height <= 560 && this.canvas.clientWidth >= 530
    const hasMore = !!this.canvas.dataset?.hasMore
    const dragon = this.preset === 'dragon' && count > 1
    const top = preview || this.immersive ? 20 : dragon && shortDock ? 76 : short ? 106 : 142
    const choreography = isPhotoChoreography(this.preset)
    const bottom = preview ? 20 : this.immersive ? (choreography ? 108 : 20)
      : (dragon && shortDock ? 116 : short ? 108 : 142) + (choreography || hasMore ? 45 : 0)
        + (dragon && hasMore && !shortDock ? 45 : 0)
        + (!shortDock && this.canvas.clientWidth <= 700 && this.canvas.dataset?.presentation !== 'locked' ? 44 : 0)
    const tangent = Math.tan(camera.fov * Math.PI / 360)
    const usableHeight = Math.max(dragon ? .28 : .46, 1 - (top + bottom) / height)
    const centerY = (top - bottom) / height
    const tide = this.preset === 'tide'
    if (choreography) {
      const halfWidth = dragon ? 7.35 : compact ? 4.93 : 6.2
      const halfHeight = dragon ? (compact ? 7.65 : 7.05) : 2.92
      const distance = Math.max(9.8, halfWidth / (aspect * tangent * .96) + 2, halfHeight / (tangent * usableHeight) + 2)
      this.eye.set(dragon ? 2.1 : 0, dragon ? 1.65 : 1.22, distance)
      this.look.set(0, (dragon ? 0 : .24) + centerY * tangent * distance, 0)
    } else if (this.preset === 'fold') {
      const factor = compact ? .74 : 1
      const setback = Math.max(9.8, 4.35 * factor / (aspect * tangent * .86), 2.75 / (tangent * usableHeight))
      const z = FOLD_FIRST_BAY_Z + setback - this.foldTravel * FOLD_BAY_SPACING
      this.eye.set(foldCenter(z) * factor + this.orbit.x, .45 + this.orbit.y * 1.35, z)
      this.look.set(foldCenter(z - setback) * factor + this.orbit.x * 2.15, centerY * tangent * setback + this.orbit.y * .5, z - setback)
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

  private advanceFold(dt: number, count: number, hasMore: boolean) {
    const lastBay = foldBayCount(count) - 1
    const previousBay = Math.floor(this.foldTravel)
    this.foldLoadCooldown -= dt
    if (hasMore && lastBay - previousBay <= 8 && (this.foldRequestedCount !== count || this.foldLoadCooldown <= 0)) {
      this.foldRequestedCount = count
      this.foldLoadCooldown = 8
      this.context.emit('stage:load-more')
    }
    this.foldTravel += dt * .56
    if (hasMore) this.foldTravel = Math.min(this.foldTravel, lastBay)
    const currentBay = Math.floor(this.foldTravel)
    if (currentBay === previousBay) return
    const bay = currentBay % foldCycle(count)
    if (bay > lastBay) return
    this.index = bay * FOLD_PHOTOS_PER_BAY
    this.reportIndex()
  }

  private advanceChoreography(preset: PhotoChoreography, dt: number, chapter: ReturnType<typeof collectionChapter>, hasMore: boolean) {
    const loaded = this.context.photos.length
    const next = chapter.start + chapter.count
    this.choreographyLoadCooldown -= dt
    if (hasMore && loaded - chapter.start <= CHOREOGRAPHY_GROUP_SIZE * 2 && this.choreographyLoadCooldown <= 0) {
      this.choreographyLoadCooldown = 8
      this.context.emit('stage:load-more')
    }
    const cycle = choreographyCycle(preset)
    if (preset === 'dragon') {
      if (this.time + 1e-8 < cycle) return
      this.time = Math.max(0, this.time - cycle)
      this.wakeTime = 0
      if (next >= loaded && (hasMore || chapter.start === 0)) return
      if (hasMore && next + this.chapterAt(next, this.totalPhotos(loaded)).count > loaded) return
    } else {
      if (hasMore && next >= loaded) this.time = Math.min(this.time, choreographyHold(preset))
      if (this.time < cycle) return
      this.time = this.wakeTime = 0
    }
    const index = next < loaded ? next : 0
    if (index !== this.index) {
      this.index = index
      this.reportIndex()
    }
  }

  private foldBays(index: number, window: FoldWindow): FoldBays {
    const { cycle, nearBay, farBay, hasMore } = window
    const bay = Math.floor(index / FOLD_PHOTOS_PER_BAY)
    const first = bay + (hasMore ? 0 : Math.max(0, Math.ceil((nearBay - bay) / cycle)) * cycle)
    const last = hasMore ? Math.min(bay, farBay) : farBay
    const nearest = first + THREE.MathUtils.clamp(Math.round((this.foldTravel - first) / cycle),
      0, Math.max(0, Math.floor((last - first) / cycle))) * cycle
    const primary = this.focus?.index === index ? this.focus.bay ?? nearest : nearest
    return { first, last, primary }
  }

  private foldScale(window: FoldWindow, bay: number, z: number) {
    const lapStart = Math.floor(bay / window.cycle) * window.cycle
    const previousLastBay = lapStart - window.cycle + foldBayCount(window.count) - 1
    // Bring the next lap into view as the last bay of the current lap is presented.
    const reveal = lapStart === 0 ? 1 : THREE.MathUtils.smoothstep(this.foldTravel, previousLastBay, previousLastBay + .65)
    return reveal * foldDepthFade(window.cameraZ - z)
  }

  private placeFoldCopies(photo: PhotoMesh, index: number, window: FoldWindow, bays: FoldBays, scale: number) {
    const copies = this.foldCopies.get(photo) ?? []
    let used = 0
    const back = photo.getObjectByName('photo-back') as THREE.Mesh | undefined
    for (let bay = bays.first; bay <= bays.last; bay += window.cycle) {
      if (bay === bays.primary) continue
      const pose = foldPose(index, window.total, this.time, window.compact, bay)
      const copyScale = scale * this.foldScale(window, bay, pose.z)
      if (copyScale <= 0) continue
      let copy = copies[used++]
      if (!copy) {
        copy = new THREE.Mesh(photo.geometry, photo.material)
        copy.userData = photo.userData
        if (back) {
          const reverse = new THREE.Mesh(back.geometry, back.material)
          reverse.position.copy(back.position)
          reverse.quaternion.copy(back.quaternion)
          reverse.userData = photo.userData
          copy.add(reverse)
        }
        copies.push(copy)
        this.foldCopies.set(photo, copies)
        this.context.addToScene(copy)
      }
      copy.position.set(pose.x * unit, pose.y * unit, pose.z * unit)
      copy.rotation.set(pose.rx, pose.ry, pose.rz)
      copy.scale.setScalar(copyScale)
      copy.visible = true
    }
    for (let i = used; i < copies.length; i++) copies[i]!.visible = false
    if (used) {
      const surfaces = back ? [photo, back] : [photo]
      for (let i = 0; i < used; i++) {
        const copy = copies[i]!
        surfaces.push(copy)
        if (back) surfaces.push(copy.children[0] as THREE.Mesh)
      }
      photo.userData.presentation = surfaces
    } else if (copies.length) delete photo.userData.presentation
  }

  private clearFoldCopies() {
    for (const [photo, copies] of this.foldCopies) {
      delete photo.userData.presentation
      for (const copy of copies) copy.removeFromParent()
    }
    this.foldCopies.clear()
  }

  update(delta: number) {
    const { photos } = this.context
    const choreography = isPhotoChoreography(this.preset) ? this.preset : null
    let chapter = this.chapterAt(this.index, photos.length)
    const fold = this.preset === 'fold'
    const hasMore = !!this.canvas.dataset?.hasMore
    const camera = this.context.camera as THREE.PerspectiveCamera
    const reduced = this.context.reducedMotion()
    const dt = Math.min(delta, .05)
    const motionDelta = choreography === 'dragon' ? delta : dt
    const playbackDelta = choreography ? motionDelta * ((this.context.config.camera?.rotateSpeed ?? .5) / .5) : dt
    const canAdvance = chapter.count > 1 || (fold && photos.length > 0) || (choreography && chapter.count > 0 && (photos.length > 1 || hasMore))
    if (this.autoplay && !reduced && !this.suspended && !this.drag && !this.focus && playbackDelta > 0 && canAdvance && (!choreography || this.morphTime >= 1.2)) {
      this.time += playbackDelta
      if (fold) this.advanceFold(dt, photos.length, hasMore)
      if (choreography) {
        // A new group's visibility must be calculated from its new index in this frame.
        this.advanceChoreography(choreography, dt, chapter, hasMore)
        chapter = this.chapterAt(this.index, photos.length)
      }
      if (this.time - this.wakeTime >= 2) {
        this.wakeTime = this.time
        this.context.emit('stage:interaction')
      }
    }
    const count = fold ? photos.length : chapter.count
    if (!count) {
      this.guides.visible = false
      return
    }
    const blend = reduced || this.snapCamera ? 1 : 1 - Math.exp(-dt * 7.4)
    this.orbit.lerp(this.aim, this.orbit.distanceToSquared(this.aim) < 1e-7 ? 1 : blend)
    const compact = camera.aspect < .82
    this.frameCamera(camera, count, compact, blend)
    this.snapCamera = false
    this.morphTime += reduced ? 1.2 : dt
    if (this.morphTime >= 1.2) this.from.clear()

    const focus = this.focus
    if (focus) {
      const target = focus.opened && !this.suspended ? 0 : 1
      const travel = reduced ? 1 : dt * 2.7
      focus.amount = THREE.MathUtils.clamp(focus.amount + (target ? travel : -travel), 0, 1)
    }

    const cameraZ = camera.position.z / unit
    const cycle = foldCycle(count)
    const lastRevealedLap = Math.floor((this.foldTravel + cycle - foldBayCount(count) + 1) / cycle)
    const window: FoldWindow | null = fold ? {
      cameraZ, count, total: this.totalPhotos(count), compact, hasMore, cycle,
      nearBay: Math.max(0, Math.ceil((FOLD_FIRST_BAY_Z - cameraZ - 2) / FOLD_BAY_SPACING)),
      farBay: Math.min((lastRevealedLap + 1) * cycle - 1,
        Math.floor((FOLD_FIRST_BAY_Z - cameraZ + FOLD_HORIZON) / FOLD_BAY_SPACING))
    } : null
    const zoom = focus ? THREE.MathUtils.smoothstep(focus.amount, 0, 1) : 0
    let preloadFrom = Infinity
    if (choreography && this.autoplay && !reduced && playbackDelta > 0) {
      const next = chapter.start + chapter.count
      if (next < photos.length) preloadFrom = next
      else if (!hasMore && chapter.start > 0) preloadFrom = 0
    }
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      if (i >= preloadFrom && i < preloadFrom + CHOREOGRAPHY_GROUP_SIZE) photo.userData.prefetchTexture = true
      else if (photo.userData.prefetchTexture) delete photo.userData.prefetchTexture
      const local = fold ? i : i - chapter.start
      const bays = window && this.foldBays(i, window)
      photo.visible = window && bays
        ? (bays.first >= window.nearBay && bays.first <= bays.last) || focus?.index === i
        : local >= 0 && local < count
      if (!photo.visible) {
        const copies = this.foldCopies.get(photo)
        if (copies) {
          for (const copy of copies) copy.visible = false
          delete photo.userData.presentation
        }
        continue
      }
      const pose = window && bays ? foldPose(i, window.total, this.time, compact, bays.primary)
        : choreography ? choreographyPose(choreography, local, count, this.time, compact, reduced)
          : collectionPose(this.preset, local, count, this.time, compact, zoom)
      this.position.set(pose.x * unit, pose.y * unit, pose.z * unit)
      this.rotation.setFromEuler(this.euler.set(pose.rx, pose.ry, pose.rz))
      if (choreography === 'dragon') {
        this.photoLook.lookAt(camera.position, this.position, camera.up)
        this.rotation.premultiply(this.facing.setFromRotationMatrix(this.photoLook))
      }
      const { width, height } = (photo.geometry as THREE.PlaneGeometry).parameters
      const fitLimit = count === 1 && !fold ? 5.5 : 2.12
      let scale = choreography ? pose.size * unit / Math.max(width, height / (count === 1 ? .94 : .70))
        : Math.min(pose.size * unit / Math.sqrt(width * height), fitLimit * unit / Math.max(width, height))
      if (i === this.index && count > 1 && !bays && !choreography) scale *= 1.04
      if (window && bays) {
        if (bays.first + window.cycle <= bays.last || this.foldCopies.has(photo)) {
          this.placeFoldCopies(photo, i, window, bays, scale)
        }
        scale *= this.foldScale(window, bays.primary, pose.z)
      }
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
    if (choreography === 'dragon' && count > 1 && this.morphTime >= 1.2) this.drawGuides(count, compact, zoom)
    else if (choreography) this.guides.visible = false
    else this.drawGuides(count, compact, zoom)
    if (focus && !focus.opened && focus.amount === 1) {
      focus.opened = true
      this.context.emit('stage:open', focus.index)
    } else if (focus?.opened && !this.suspended && focus.amount === 0) this.focus = null
  }

  private drawGuides(count: number, compact: boolean, focus: number) {
    const fold = this.preset === 'fold'
    this.guides.visible = fold || count > 1
    if (!this.guides.visible) return
    let offset = 0
    let updateColors = true
    const cameraZ = this.context.camera.position.z / unit
    const line = (x: number, y: number, z: number, nextX: number, nextY: number, nextZ: number, fromAlpha = 1, toAlpha = 1) => {
      const color = offset / 3 * 4
      this.lineColors[color + 3] = fold ? foldDepthFade(cameraZ - z) : fromAlpha
      this.lineColors[color + 7] = fold ? foldDepthFade(cameraZ - nextZ) : toAlpha
      this.lineVertices[offset++] = x * unit
      this.lineVertices[offset++] = y * unit
      this.lineVertices[offset++] = z * unit
      this.lineVertices[offset++] = nextX * unit
      this.lineVertices[offset++] = nextY * unit
      this.lineVertices[offset++] = nextZ * unit
    }
    if (this.preset === 'dragon') {
      const time = this.context.reducedMotion() ? 0 : this.time
      const previous = this.dragonGuide
      this.guides.material.opacity = .34 * (1 - focus)
      if (previous.time === time && previous.count === count && previous.compact === compact) return
      const segments = Math.min(64, count * 6)
      updateColors = previous.count !== count || Number.isNaN(previous.time)
      previous.time = time
      previous.count = count
      previous.compact = compact
      const head = dragonSpine(count, time, compact, 0, this.position)
      const alpha = (progress: number) => 1 - THREE.MathUtils.smoothstep(progress, .62, 1)
      for (let i = 1; i <= segments; i++) {
        const next = dragonSpine(count, time, compact, i / segments, this.guideEnd)
        line(head.x, head.y, head.z - .24, next.x, next.y, next.z - .24, alpha((i - 1) / segments), alpha(i / segments))
        head.copy(next)
      }
    } else if (this.preset === 'tide') {
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
    } else if (fold) {
      const factor = compact ? .74 : 1
      const guideStart = FOLD_FIRST_BAY_Z + FOLD_BAY_SPACING
      const first = Math.floor((guideStart - cameraZ) / FOLD_BAY_SPACING)
      const last = Math.ceil((guideStart - cameraZ + FOLD_HORIZON) / FOLD_BAY_SPACING)
      for (let bay = first; bay <= last; bay++) {
        const z = guideStart - bay * FOLD_BAY_SPACING, x = foldCenter(z) * factor
        const end = z - FOLD_BAY_SPACING, next = foldCenter(end) * factor
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
    const positions = this.guides.geometry.getAttribute('position') as THREE.BufferAttribute
    positions.clearUpdateRanges()
    positions.addUpdateRange(0, offset)
    positions.needsUpdate = true
    if (updateColors) {
      const colors = this.guides.geometry.getAttribute('color') as THREE.BufferAttribute
      colors.clearUpdateRanges()
      colors.addUpdateRange(0, offset / 3 * 4)
      colors.needsUpdate = true
    }
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
    this.clearFoldCopies()
    this.from.clear()
    this.focus = null
    for (const photo of this.context.photos) {
      photo.visible = true
      delete photo.userData.prefetchTexture
      const material = photo.material as THREE.MeshStandardMaterial
      material.color.set(material.map ? '#ffffff' : '#b8bcc4')
      material.toneMapped = true
      material.emissiveIntensity = .25
      material.needsUpdate = true
    }
  }
}
