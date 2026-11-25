import * as THREE from 'three'
import type { PublicPhoto } from '@vie/gallery-contracts'
import type { PhotoMesh } from './types'
import { TexturePool } from './TexturePool'

/** Owns photo geometry/materials. Identity is the public photo object, including across page append. */
export class PhotoScene {
  private meshes = new Map<PublicPhoto, PhotoMesh>()
  private highTextureOwners = new Map<PublicPhoto, object>()
  private highTextureReady = new Set<PublicPhoto>()
  private highTextureFailed = new Set<PublicPhoto>()
  private frustum = new THREE.Frustum()
  private matrix = new THREE.Matrix4()
  private position = new THREE.Vector3()
  private viewPosition = new THREE.Vector3()
  private disposed = false
  private flatCards = false
  constructor(private scene: THREE.Scene, private pool: TexturePool, private textureReady: (mesh: PhotoMesh) => void = () => {}) {}

  setFlatCards(flat: boolean): void {
    if (this.flatCards === flat) return
    this.flatCards = flat
    for (const mesh of this.meshes.values()) {
      const previous = mesh.geometry as THREE.PlaneGeometry
      mesh.geometry = this.createGeometry(previous.parameters.width, previous.parameters.height)
      const back = mesh.getObjectByName('photo-back') as THREE.Mesh
      back.geometry = mesh.geometry
      previous.dispose()
    }
  }

  private createGeometry(width: number, height: number): THREE.PlaneGeometry {
    const sections = this.flatCards ? 1 : 24
    const geometry = new THREE.PlaneGeometry(width, height, sections, sections)
    geometry.computeBoundingSphere()
    if (!this.flatCards) geometry.boundingSphere!.radius += 5
    return geometry
  }

  sync(photos: PublicPhoto[]): { all: PhotoMesh[]; added: PhotoMesh[]; removed: PhotoMesh[] } {
    const added: PhotoMesh[] = [], removed: PhotoMesh[] = []
    const keep = new Set(photos)
    for (const [photo, mesh] of this.meshes) if (!keep.has(photo)) {
      this.pool.release(photo)
      const highOwner = this.highTextureOwners.get(photo)
      this.highTextureReady.delete(photo)
      if (highOwner) this.pool.release(highOwner)
      this.highTextureOwners.delete(photo); this.highTextureFailed.delete(photo)
      this.remove(mesh); this.meshes.delete(photo); removed.push(mesh)
    }
    const all = photos.map((photo, index) => {
      let mesh = this.meshes.get(photo)
      if (!mesh) {
        const ratio = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 4 / 3
        const width = Math.min(80, 120 * ratio), height = width / ratio
        const material = new THREE.MeshStandardMaterial({ color: '#b8bcc4', side: THREE.FrontSide, metalness: 0, roughness: .7 })
        mesh = Object.assign(new THREE.Mesh(this.createGeometry(width, height), material), {
          userData: { index, url: '', thumbnailUrl: '', textureState: 'placeholder' as const }
        })
        // Two printed faces share one paper-thin surface, without a dark mount.
        const back = new THREE.Mesh(mesh.geometry, material)
        back.name = 'photo-back'
        back.position.z = -.015
        back.rotation.y = Math.PI
        mesh.add(back)
        mesh.userData = { index, url: '', thumbnailUrl: '', textureState: 'placeholder' }
        this.meshes.set(photo, mesh); this.scene.add(mesh); added.push(mesh)
        this.load(photo, mesh)
      }
      Object.assign(mesh.userData, { index, title: photo.title ?? `Photo ${index + 1}`, thumbnailUrl: photo.thumbnailUrl ?? '',
        mediumUrl: photo.mediumUrl, textureUrl: photo.textureUrl, url: photo.mediumUrl ?? photo.thumbnailUrl ?? '' })
      mesh.getObjectByName('photo-back')!.userData = mesh.userData
      return mesh
    })
    return { all, added, removed }
  }
  private load(photo: PublicPhoto, mesh: PhotoMesh): void {
    const urls = [...new Set([photo.previewUrl, photo.thumbnailUrl, photo.textureUrl].filter((url): url is string => !!url))]
    if (!urls.length) return
    const highUrl = photo.textureUrl ?? photo.thumbnailUrl
    this.pool.onChange(photo, texture => {
      if (this.disposed || this.meshes.get(photo) !== mesh) return
      if (!texture) {
        if (!this.highTextureReady.has(photo) || !this.highTextureOwners.has(photo)) {
          this.clearTexture(mesh)
          mesh.userData.textureState = 'placeholder'
        }
        return
      }
      this.applyTexture(mesh, texture)
      if (highUrl && (texture.userData.sourceUrl === highUrl || (urls.length === 1 && urls[0] === highUrl))) {
        this.highTextureReady.add(photo)
      }
      mesh.userData.textureState = 'ready'
      this.textureReady(mesh)
    })
    void this.pool.acquire(photo, urls, Infinity).catch(error => {
      if (this.disposed || this.meshes.get(photo) !== mesh || error?.name === 'AbortError') return
      mesh.userData.textureState = 'failed'
    })
  }
  private loadHighTexture(photo: PublicPhoto, mesh: PhotoMesh, priority: number): void {
    const source = (mesh.material as THREE.MeshStandardMaterial).map?.userData.sourceUrl
    const urls = [...new Set([photo.textureUrl, photo.previewUrl ? photo.thumbnailUrl : null]
      .filter((url): url is string => !!url && url !== source))]
    if (!urls.length) return
    let owner = this.highTextureOwners.get(photo)
    if (!owner) { owner = {}; this.highTextureOwners.set(photo, owner) }
    this.pool.onChange(owner, texture => {
      if (this.disposed || this.meshes.get(photo) !== mesh) return
      if (!texture) {
        if (this.highTextureReady.delete(photo)) {
          this.clearTexture(mesh)
          mesh.userData.textureState = 'placeholder'
          this.load(photo, mesh)
        }
        return
      }
      this.highTextureReady.add(photo)
      this.applyTexture(mesh, texture)
      mesh.userData.textureState = 'ready'
      this.pool.release(photo)
      this.textureReady(mesh)
    })
    void this.pool.acquire(owner, urls, Number.isFinite(priority) ? priority + 1 : priority).catch(error => {
      if (error?.name !== 'AbortError' && this.meshes.get(photo) === mesh) this.highTextureFailed.add(photo)
    })
  }
  private applyTexture(mesh: PhotoMesh, texture: THREE.Texture): void {
    const material = mesh.material as THREE.MeshStandardMaterial
    material.map = texture
    // Preserve a readable photographic base under the darkest scene lighting.
    material.emissiveMap = texture; material.emissive.set('#ffffff'); material.emissiveIntensity = .25
    material.color.set('#ffffff'); material.needsUpdate = true
  }
  private clearTexture(mesh: PhotoMesh): void {
    const material = mesh.material as THREE.MeshStandardMaterial
    material.map = null; material.emissiveMap = null; material.emissive.set('#000000')
    material.color.set('#b8bcc4'); material.needsUpdate = true
  }
  private exceedsPreviewSize(surface: THREE.Mesh, camera: THREE.PerspectiveCamera, viewportHeight: number): boolean {
    const depth = -this.viewPosition.setFromMatrixPosition(surface.matrixWorld).applyMatrix4(camera.matrixWorldInverse).z
    const radius = (surface.geometry.boundingSphere?.radius ?? 0) * surface.matrixWorld.getMaxScaleOnAxis()
    // Project the bounding sphere's diameter into the drawing buffer.
    return depth > 0 && radius * viewportHeight * camera.projectionMatrix.elements[5] > 480 * depth
  }

  updateVisibility(camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    if (this.disposed) return
    camera.updateMatrixWorld(); this.scene.updateMatrixWorld()
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.matrix)
    for (const [photo, mesh] of this.meshes) {
      const surfaces = mesh.userData.presentation ?? [mesh]
      const visible = surfaces.some(surface => surface.visible && this.frustum.intersectsObject(surface))
      mesh.userData.inView = visible
      const nearestSurface = surfaces[0] ?? mesh
      nearestSurface.getWorldPosition(this.position)
      // Load visible thumbnails, then their upgrades, then the next group.
      const distance = this.position.distanceToSquared(camera.position)
      const priority = !visible ? (mesh.userData.prefetchTexture ? 2 : Infinity) : this.flatCards
        ? Math.min(.99, this.position.project(camera).length() / 2)
        : distance / (1 + distance)
      const highOwner = this.highTextureOwners.get(photo)
      const highReady = this.highTextureReady.has(photo)
      const needsUpgrade = visible && !highReady && !this.highTextureFailed.has(photo) && mesh.userData.textureState === 'ready'
        && (photo.previewUrl ? this.exceedsPreviewSize(nearestSurface, camera, viewportHeight) : !this.flatCards)
      this.pool.touch(photo, highOwner && highReady ? Infinity : priority)
      if (highOwner) this.pool.touch(highOwner, highReady || needsUpgrade ? priority + (visible ? 1 : 0) : Infinity)
      else if (needsUpgrade) this.loadHighTexture(photo, mesh, priority)
    }
  }
  retry(photo: PublicPhoto): void {
    const mesh = this.meshes.get(photo)
    if (!mesh || this.disposed) return
    this.pool.release(photo)
    const highOwner = this.highTextureOwners.get(photo)
    this.highTextureReady.delete(photo)
    if (highOwner) this.pool.release(highOwner)
    this.highTextureOwners.delete(photo); this.highTextureFailed.delete(photo)
    this.clearTexture(mesh)
    mesh.userData.textureState = 'placeholder'; this.load(photo, mesh)
  }
  retryFailed(): void { for (const [photo, mesh] of this.meshes) if (mesh.userData.textureState === 'failed') this.retry(photo) }
  private remove(mesh: PhotoMesh): void {
    const geometries = new Set<THREE.BufferGeometry>([mesh.geometry])
    const materials = new Set<THREE.Material>(Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    for (const child of mesh.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
        geometries.add(child.geometry)
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material)
      }
    }
    this.scene.remove(mesh)
    for (const geometry of geometries) geometry.dispose()
    for (const material of materials) material.dispose()
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const [photo, mesh] of this.meshes) {
      this.pool.release(photo)
      const highOwner = this.highTextureOwners.get(photo)
      if (highOwner) this.pool.release(highOwner)
      this.remove(mesh)
    }
    this.meshes.clear()
    this.highTextureOwners.clear(); this.highTextureReady.clear(); this.highTextureFailed.clear()
  }
}
