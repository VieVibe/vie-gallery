import type { PublicPhoto } from '../types/api'

export function albumAspectRatio(width?: number | null, height?: number | null) {
  if (!width || !height || width < 0 || height < 0) return 4 / 3
  const ratio = width / height
  return Number.isFinite(ratio) ? Math.min(2.8, Math.max(0.5, ratio)) : 4 / 3
}

type AlbumPhoto = { photo: PublicPhoto; index: number; ratio: number }

export function albumRows(photos: readonly PublicPhoto[]) {
  const rows: { items: AlbumPhoto[]; ratio: number }[] = []
  let items: AlbumPhoto[] = []
  let ratio = 0

  function finishRow() {
    if (!items.length) return
    rows.push({ items, ratio })
    items = []
    ratio = 0
  }

  photos.forEach((photo, index) => {
    const photoRatio = albumAspectRatio(photo.width, photo.height)
    const isPanorama = photoRatio >= 2.2
    if (isPanorama) finishRow()
    const featurePhoto = !items.length && rows.length % 3 === 2 && photoRatio >= 4 / 3
    items.push({ photo, index, ratio: photoRatio })
    ratio += photoRatio
    if (isPanorama || featurePhoto || items.length === 3 || ratio >= 2.65) finishRow()
  })
  finishRow()
  return rows
}
