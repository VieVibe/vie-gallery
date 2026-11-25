import type { PhotoChoreography } from '@vie/gallery-contracts'

export const CHOREOGRAPHY_GROUP_SIZE = 12

const DURATION: Record<PhotoChoreography, number> = { burst: 6.8, domino: 6.4, fans: 7.1 }
const TAU = Math.PI * 2
const SPACING = 2.39
const RETURN_TIME = .9
const HOLD_TIME = .72

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

export function choreographyHold(preset: PhotoChoreography) {
  return DURATION[preset] + HOLD_TIME
}

export function choreographyCycle(preset: PhotoChoreography) {
  return choreographyHold(preset) + RETURN_TIME
}

export function choreographyPose(preset: PhotoChoreography, index: number, count: number, time: number, compact: boolean, reduced: boolean) {
  if (count === 1) return pose(0, 0, 0, 0, 0, 0, 4.8)
  const progress = Math.min(1, time / DURATION[preset])
  const sample = movement[preset]
  const closing = choreographyHold(preset)
  const target = reduced ? grid(index, count) : time <= closing ? sample(index, count, progress)
    : blend(sample(index, count, 1), sample(index, count, 0), ease(time, closing, choreographyCycle(preset)))
  if (compact) target.x *= .77
  return target
}
