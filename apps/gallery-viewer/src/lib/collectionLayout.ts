import type { SpatialPreset } from '@vie/gallery-contracts'

export const COLLECTION_CHAPTER_SIZE = 50
export const COLLECTION_UNIT = 100
export const FOLD_PHOTOS_PER_BAY = 6
export const FOLD_BAY_SPACING = 3.58
export const FOLD_FIRST_BAY_Z = 8.75
const TAU = Math.PI * 2

export function collectionChapter(index: number, count: number, size = COLLECTION_CHAPTER_SIZE) {
  const start = Math.floor(Math.max(0, Math.min(index, count - 1)) / size) * size
  return { start, count: Math.min(size, count - start) }
}

export function tideColumns(count: number, compact: boolean) {
  return Math.min(count, Math.ceil(Math.sqrt(count * (compact ? .60 : 1.14))))
}

export function tideDepth(x: number, y: number, time: number) {
  return 2.32 * Math.sin(.38 * x + .24 * y - .91 * time) + .42 * Math.sin(.70 * y + .56 * time)
}

export function foldCenter(z: number) {
  return 1.2 * Math.sin((10 - z) * .25)
}

export function foldPose(index: number, count: number, time: number, compact: boolean, positionBay: number) {
  const slot = index % FOLD_PHOTOS_PER_BAY
  const row = Math.floor(slot / 2)
  const rows = Math.ceil(Math.min(FOLD_PHOTOS_PER_BAY, count - index + slot) / 2)
  const side = slot % 2 ? 1 : -1
  const z = FOLD_FIRST_BAY_Z - positionBay * FOLD_BAY_SPACING + (row - (rows - 1) / 2) * .20
  const swing = Math.sin(.92 * time - positionBay * .79 + side * .4)
  const lateral = count === 1 ? 1.9 : 3.15
  const angle = count === 1 ? .72 : 1.02
  return {
    x: (foldCenter(z) + side * (lateral + .37 * swing)) * (compact ? .74 : 1),
    y: ((rows - 1) / 2 - row) * 1.77, z, rx: 0, ry: -side * (angle + .17 * swing), rz: side * .016, size: 1.48
  }
}

export function spaceBlades(count: number) {
  return Math.min(8, count, Math.max(3, Math.ceil(count / 6)))
}

export function spacePoint(blade: number, blades: number, radius: number, side: number, time: number, compact: boolean, focus: number) {
  const phase = time * .98 + .82
  const opening = 1 - .385 * (1 + Math.cos(phase)) - .115 * (1 + Math.cos(phase - blade * .43))
  const spread = opening + (1 - opening) * .70 * focus
  const angle = blade * TAU / blades + time * .12 + (1 - radius) * (.90 - .49 * spread) + side * (.205 + .016 * spread)
  const x = (2.18 + radius * 4.27 + (.72 + .8 * (1 - radius)) * spread) * Math.cos(angle)
  const y = (1.36 + radius * 2.76 + (.53 + .23 * (1 - radius)) * spread) * Math.sin(angle)
  const z = 2.08 - radius * 3.74 + .56 * Math.sin(angle - .55 + time * .43) + (radius - .5) * (spread - .5) * 1.62
  const tilt = -.10 + .045 * Math.sin(time * .46)
  return {
    x: x * (compact ? .82 : 1),
    y: y * Math.cos(tilt) - z * Math.sin(tilt),
    z: y * Math.sin(tilt) + z * Math.cos(tilt),
    angle
  }
}

export function collectionPose(preset: SpatialPreset, index: number, count: number, time: number, compact: boolean, focus = 0) {
  if (count === 1) return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, size: 4.8 }
  if (preset === 'tide') {
    const columns = tideColumns(count, compact)
    const rows = Math.ceil(count / columns)
    const row = Math.floor(index / columns)
    const rowLength = Math.min(columns, count - row * columns)
    const x = (index % columns - (rowLength - 1) / 2) * 2.22
    const y = ((rows - 1) / 2 - row) * 1.46
    const z = tideDepth(x, y, time)
    return { x, y: y + .22 * z, z, rx: .37 * Math.atan((tideDepth(x, y + .1, time) - z) * 10),
      ry: -.82 * Math.atan((tideDepth(x + .1, y, time) - z) * 10), rz: .035 * Math.sin(x * .45 - time), size: 1.42 }
  }
  if (preset === 'fold') {
    return foldPose(index, count, time, compact, Math.floor(index / FOLD_PHOTOS_PER_BAY))
  }
  const blades = spaceBlades(count)
  const blade = index % blades
  const slot = Math.floor(index / blades)
  const slots = Math.floor((count - 1 - blade) / blades) + 1
  const tracks = Math.ceil(slots / 2)
  const radius = tracks > 1 ? Math.floor(slot / 2) / (tracks - 1) : .53
  const side = slots % 2 && slot === slots - 1 ? 0 : slot % 2 ? 1 : -1
  const { x, y, z, angle } = spacePoint(blade, blades, radius, side, time, compact, focus)
  return { x, y, z, rx: -.08 + .22 * Math.sin(angle), ry: .35 * Math.cos(angle), rz: .10 * Math.cos(angle - .3),
    size: .66 + .64 * radius }
}
