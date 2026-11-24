/**
 * Adapted from ThreeUI Community Character Filmstrip (MIT, Copyright (c) 2026 Meng To).
 * https://github.com/MengTo/threeui/blob/main/src/shaders/character-carousel/sources/character-filmstrip.html
 * License: public/third-party/threeui-LICENSE.txt. No upstream portraits or HTML runtime are used.
 */
export function filmstripPose(delta: number, mobile: boolean, frame = { width: 650, height: 400 }) {
  const distance = Math.abs(delta)
  const focus = Math.exp(-distance * distance * 1.28)
  const side = Math.max(0, 1 - distance / 5)
  // Convert CSS perspective into world units; keep the active work inside the reading area.
  return {
    x: mobile ? (delta * 24 + Math.sin(delta * .9) * 25) * frame.width / 300 : delta * frame.width * .72,
    y: mobile ? -delta * Math.min(frame.height * .78, frame.width * .62) : -distance * 8,
    z: 35 + focus * 145 - distance * 148,
    ry: mobile ? -delta * 5 * Math.PI / 180 : -Math.tanh(delta * 4) * (14 + Math.min(distance, 3) * 5) * Math.PI / 180,
    rz: delta * (mobile ? 1.4 : -.7) * Math.PI / 180,
    scale: (.54 + side * .15 + focus * .54) / 1.23,
  }
}
