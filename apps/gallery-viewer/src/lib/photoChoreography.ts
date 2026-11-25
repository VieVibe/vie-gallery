import type { PhotoChoreography } from '@vie/gallery-contracts'
import { CatmullRomCurve3, MathUtils, Vector3 } from 'three'
import { collectionChapter } from './collectionLayout'

export const CHOREOGRAPHY_GROUP_SIZE = 12

const DRAGON_LAP = 20
const DRAGON_HEAD_COUNT = 3
const DURATION = { burst: 6.8, domino: 6.4, fans: 7.1 }
const TAU = Math.PI * 2
const SPACING = 2.39
const RETURN_TIME = .9
const HOLD_TIME = .72

export function dragonChapter(index: number, loaded: number, total: number) {
  const chapter = collectionChapter(index, loaded, CHOREOGRAPHY_GROUP_SIZE)
  const finalCount = total % CHOREOGRAPHY_GROUP_SIZE
  const minimum = DRAGON_HEAD_COUNT + 1
  if (total <= CHOREOGRAPHY_GROUP_SIZE || finalCount === 0 || finalCount >= minimum) return chapter

  const finalStart = total - minimum
  if (index >= finalStart) return { start: finalStart, count: loaded - finalStart }
  if (chapter.start === total - finalCount - CHOREOGRAPHY_GROUP_SIZE) {
    return { start: chapter.start, count: Math.min(loaded, finalStart) - chapter.start }
  }
  return chapter
}

const mix = (from: number, to: number, t: number) => from + (to - from) * t
function ease(time: number, start: number, end: number) {
  const t = Math.max(0, Math.min(1, (time - start) / (end - start)))
  return t * t * (3 - 2 * t)
}

function pose(x: number, y: number, z = 0, rx = 0, ry = 0, rz = 0, size = 2.12) {
  return { x, y, z, rx, ry, rz, size }
}

type Pose = ReturnType<typeof pose>
function blend(from: Pose, to: Pose, t: number): Pose {
  return pose(mix(from.x, to.x, t), mix(from.y, to.y, t), mix(from.z, to.z, t), mix(from.rx, to.rx, t),
    mix(from.ry, to.ry, t), mix(from.rz, to.rz, t), mix(from.size, to.size, t))
}

function gridColumns(count: number) {
  return Math.min(4, Math.ceil(Math.sqrt(count * 1.3)))
}

function grid(index: number, count: number) {
  const columns = gridColumns(count)
  const row = Math.floor(index / columns)
  const rowLength = Math.min(columns, count - row * columns)
  return pose((index % columns - (rowLength - 1) / 2) * SPACING,
    ((Math.ceil(count / columns) - 1) / 2 - row) * 1.61 + .2, -.1)
}

const BURST_SLOTS = [7, 9, 11, 1, 6, 8, 10, 0, 5, 4, 3, 2]
const BURST_FINAL = [[-4.39, 1.56], [-4.48, .22], [-4.36, -1.12], [-2.29, 1.87], [-2.30, -1.48],
  [0, .2], [0, 2.18], [2.29, 1.87], [2.30, -1.48], [4.36, 1.56], [4.46, .22], [4.34, -1.12]] as const

function burst(index: number, count: number, t: number) {
  const start = grid(index, count)
  const pull = pose(start.x * .88, .2 + (start.y - .2) * .82, -.23, 0, 0, (index % 2 ? 1 : -1) * .14, 1.87)
  if (t < .155) return blend(start, pull, ease(t, .045, .155))

  const full = count === CHOREOGRAPHY_GROUP_SIZE
  const slot = full ? BURST_SLOTS[index]! : index
  const orbit = ease(t, .27, .72)
  const track = slot % 2 ? 1 : -1
  const angle = slot * TAU / count + track * orbit * 1.97
  const ring = pose(Math.cos(angle) * (track > 0 ? 4.97 : 3.26), Math.sin(angle) * (track > 0 ? 2.19 : 1.58) + .28,
    Math.sin(angle + track * .72) * 1.92, -.10 * Math.sin(angle), track * .56 * Math.cos(angle), .35 * Math.sin(angle), track > 0 ? 1.78 : 1.91)
  const outgoing = blend(pull, ring, ease(t, .155 + index % 4 * .011, .36 + index % 4 * .009))
  const lead = Math.floor((count - 1) / 2)
  const finalAngle = (index - Number(index > lead)) * TAU / (count - 1)
  const [endX, endY] = full ? BURST_FINAL[index]! : [4.27 * Math.cos(finalAngle), .18 + 1.94 * Math.sin(finalAngle)]
  const destination = index === lead ? pose(0, .2, 1.52, 0, 0, 0, 3.67)
    : pose(endX, endY, -.20, 0, -endX * .034, 0, 1.78)
  return blend(outgoing, destination, ease(t, .68 + index % 3 * .018, .94 + index % 3 * .014))
}

function domino(index: number, count: number, t: number) {
  const columns = gridColumns(count)
  const row = Math.floor(index / columns)
  const column = index % columns
  const start = grid(index, count)
  const direction = column % 2 ? -1 : 1
  const delay = (column + row * .72) * .053
  if (t < .57) {
    const turn = ease(t, .077 + delay, .328 + delay)
    const kick = Math.sin(Math.PI * turn)
    return pose(start.x + direction * .29 * kick, start.y + .29 * kick, start.z + 2.32 * kick,
      -.26 * kick, direction * turn * TAU, .17 * kick, 2.12 + .17 * kick)
  }

  const neighbor = row * columns + (column ^ 1)
  const target = neighbor < Math.min(count, (row + 1) * columns) ? grid(neighbor, count) : start
  const swap = ease(t, .575 + row * .044, .844 + row * .044)
  const crossover = Math.sin(Math.PI * swap)
  return pose(mix(start.x, target.x, swap), start.y + direction * (.34 + row * .05) * crossover,
    start.z + direction * 2.14 * crossover, -.13 * crossover, direction * .69 * crossover, -.18 * direction * crossover)
}

const PAGE_SLOTS = [[-.17, .46], [-1.18, 1.82], [1.12, 1.82], [-1.20, -.92], [1.08, -.92], [0, -1.93]] as const

function fans(index: number, count: number, t: number) {
  const half = Math.ceil(count / 2)
  const side = index < half ? -1 : 1
  const slot = side < 0 ? index : index - half
  const fanCount = side < 0 ? half : count - half
  const stack = pose(side * (.16 + .044 * slot), -.48 + .033 * slot, (count - 1 - index) * .091, -.22,
    side * .13, -.12 + index * .021, 3.69)
  const expansion = ease(t, .06 + slot * .014, .40 + slot * .012)
  const phase = Math.PI * ease(t, .46, .76)
  const angle = (slot - (fanCount - 1) / 2) * .325
  const openFan = pose(side * 2.70 * Math.cos(phase) + Math.sin(angle) * 2.62,
    -1.67 + Math.cos(angle) * 2.58 + side * .31 * Math.sin(phase), side * 1.79 * Math.sin(phase) + slot * .118,
    -.05, side * (.15 * Math.cos(phase) + .49 * Math.sin(phase)), -angle + side * .12 * Math.cos(phase), 2.10)
  const [pageX, pageY] = PAGE_SLOTS[slot]!
  const page = pose(-side * 2.58 + pageX, pageY, slot === 0 ? .97 : -.12, 0, side * .075, 0, slot === 0 ? 3.54 : 1.80)
  return blend(blend(stack, openFan, expansion), page, ease(t, .75 + slot * .013, .91 + slot * .013))
}

const movement = { burst, domino, fans }

function dragonTrack(compact: boolean) {
  const angle = compact ? -1.32 : .11
  const curve = new CatmullRomCurve3(Array.from({ length: 48 }, (_, index) => {
    const phase = index / 48 * TAU
    const x = 6.1 * Math.cos(phase)
    const lift = Math.sin(phase)
    const y = 3.65 * lift + 1.35 * Math.sin(.72 * x) * lift * lift
    return new Vector3(x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle),
      1.55 * Math.sin(phase + .42) + .64 * Math.sin(phase * 2 + .45))
  }), true)
  curve.arcLengthDivisions = 1024
  const segments = 512
  const points = curve.getSpacedPoints(segments)
  const normals = points.map((_, i) => {
    const before = points[(i + segments - 1) % segments]!, after = points[(i + 1) % segments]!
    return new Vector3(before.y - after.y, after.x - before.x, 0).normalize()
  })
  return { points, normals, length: curve.getLength() }
}

let wideDragonTrack: ReturnType<typeof dragonTrack> | undefined
let compactDragonTrack: ReturnType<typeof dragonTrack> | undefined
const DRAGON_NECK = 2.9
const DRAGON_SPACING = 2.2

function dragonHeadCount(count: number) {
  return count <= DRAGON_HEAD_COUNT ? 1 : DRAGON_HEAD_COUNT
}

function dragonWavePhase(time: number, behind: number) {
  return TAU * (time / DRAGON_LAP) * 3 - behind * .61
}

// The photos and the spine sample the same travelling wave, including at the lap seam.
function dragonPoint(time: number, compact: boolean, behind: number, tail: number, target: Vector3) {
  const { points, normals, length } = compact ? (compactDragonTrack ??= dragonTrack(true)) : (wideDragonTrack ??= dragonTrack(false))
  const phase = time / DRAGON_LAP
  const travel = .88 + phase + .013 * Math.sin(TAU * phase * 2)
  const sample = MathUtils.euclideanModulo(travel - behind / length, 1) * (points.length - 1)
  const i = Math.floor(sample)
  const fraction = sample - i
  target.lerpVectors(points[i]!, points[i + 1]!, fraction)
  const wave = dragonWavePhase(time, behind)
  const swing = (.07 + .39 * MathUtils.smoothstep(behind, 0, tail)) * Math.sin(wave)
  target.addScaledVector(normals[i]!, (1 - fraction) * swing)
  target.addScaledVector(normals[i + 1]!, fraction * swing)
  target.z += .18 * Math.cos(wave)
  return target
}

function dragonTail(count: number) {
  return DRAGON_NECK + (count - dragonHeadCount(count) - 1) * DRAGON_SPACING + .7
}

export function dragonSpine(count: number, time: number, compact: boolean, progress: number, target: Vector3) {
  const tail = dragonTail(count)
  return dragonPoint(time, compact, tail * progress, tail, target)
}

const dragonPosition = new Vector3()
const dragonDirection = new Vector3()

function dragon(index: number, count: number, time: number, compact: boolean) {
  const headCount = dragonHeadCount(count)
  const isHead = index < headCount
  const behind = isHead ? 0 : DRAGON_NECK + (index - headCount) * DRAGON_SPACING
  const tail = dragonTail(count)
  const point = dragonPoint(time, compact, behind, tail, dragonPosition)
  const tangent = dragonPoint(time, compact, behind - (isHead ? .62 : .32), tail, dragonDirection).sub(point).normalize()
  const heading = Math.atan2(tangent.y, tangent.x)
  const side = index === 0 ? 0 : index === 1 ? -1 : 1
  const pitch = -.23 * point.y / 4.4 + .12 * tangent.z
  const yaw = .17 * point.x / 6.6 + .16 * Math.cos(heading) + .08
  if (isHead) {
    const wing = (1.32 + .07 * Math.sin(dragonWavePhase(time, 0))) * side
    const forward = side ? -.28 : .72
    return pose(point.x + forward * Math.cos(heading) - wing * Math.sin(heading),
      point.y + forward * Math.sin(heading) + wing * Math.cos(heading), point.z + forward * tangent.z,
      pitch, yaw + side * .13, .13 * Math.sin(heading) + side * .38, side ? 1.57 : 1.92)
  }
  const taper = (index - headCount) / Math.max(1, count - headCount - 1)
  const swing = Math.cos(dragonWavePhase(time, behind))
  return pose(point.x, point.y, point.z, pitch, yaw, .21 * Math.sin(heading) + .13 * taper * swing, 1.56 - .38 * taper)
}

export function choreographyHold(preset: PhotoChoreography) {
  return preset === 'dragon' ? DRAGON_LAP : DURATION[preset] + HOLD_TIME
}

export function choreographyCycle(preset: PhotoChoreography) {
  return choreographyHold(preset) + (preset === 'dragon' ? 0 : RETURN_TIME)
}

export function choreographyPose(preset: PhotoChoreography, index: number, count: number, time: number, compact: boolean, reduced: boolean) {
  if (count === 1) return pose(0, 0, 0, 0, 0, 0, 4.8)
  if (preset === 'dragon') return dragon(index, count, reduced ? 0 : time, compact)
  const progress = Math.min(1, time / DURATION[preset])
  const sample = movement[preset]
  const closing = choreographyHold(preset)
  const target = reduced ? grid(index, count) : time <= closing ? sample(index, count, progress)
    : blend(sample(index, count, 1), sample(index, count, 0), ease(time, closing, choreographyCycle(preset)))
  if (compact) target.x *= .77
  return target
}
