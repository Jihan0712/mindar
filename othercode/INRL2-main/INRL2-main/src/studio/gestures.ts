/*
 * The maths behind InStudio's touch controls, kept apart from three.js and
 * the DOM so it can be unit-tested.
 */

export interface Pt {
  x: number
  y: number
}

/**
 * Where objects may go, in marker widths. The marker's 1 × 1 square stands
 * against the back wall (z = -0.5); objects stay in front of it, up to 1
 * marker width from the centre to the sides and front, 1.5 high. Further
 * out, the marker would leave the camera's view while looking at them in
 * AR (an iPhone ~40 cm away sees ~2.5 marker widths across).
 */
export const AREA = { half: 1, back: -0.45, wall: -0.5, maxHeight: 1.5 }
export const SCALE_RANGE: [number, number] = [0.3, 3]

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Keeps a position inside the workspace. */
export function clampToArea([x, y, z]: [number, number, number]): [number, number, number] {
  return [clamp(x, -AREA.half, AREA.half), clamp(y, 0, AREA.maxHeight), clamp(z, AREA.back, AREA.half)]
}

/**
 * Past an edge, an object follows the finger less and less (at most `give`
 * further), like iOS scroll views; it springs back to the edge on release.
 */
export function rubberBand(v: number, lo: number, hi: number, give = 0.08) {
  if (v < lo) return lo - give * (1 - Math.exp((v - lo) / give))
  if (v > hi) return hi + give * (1 - Math.exp((hi - v) / give))
  return v
}

/** `clampToArea` with the rubber band on the floor directions (for a moving finger). */
export function stretchToArea([x, y, z]: [number, number, number]): [number, number, number] {
  return [rubberBand(x, -AREA.half, AREA.half), clamp(y, 0, AREA.maxHeight), rubberBand(z, AREA.back, AREA.half)]
}

/** Media lying on the marker stay on its 1 × 1 square (x ±0.5, y 0–1 on the back wall). */
export const MARKER_SQUARE = { half: 0.5, bottom: 0, top: 1 }

export function clampToMarker([x, y, z]: [number, number, number]): [number, number, number] {
  return [clamp(x, -MARKER_SQUARE.half, MARKER_SQUARE.half), clamp(y, MARKER_SQUARE.bottom, MARKER_SQUARE.top), z]
}

export function stretchToMarker([x, y, z]: [number, number, number]): [number, number, number] {
  return [rubberBand(x, -MARKER_SQUARE.half, MARKER_SQUARE.half), rubberBand(y, MARKER_SQUARE.bottom, MARKER_SQUARE.top), z]
}

/**
 * Two-finger change between the start of a gesture and now: how much bigger
 * (ratio of finger spread), how far turned (radians, clockwise on screen is
 * positive because screen y points down) and how far both fingers slid
 * together (`slide`, pixels of the midpoint; negative y = up the screen).
 */
export function twoFinger(a0: Pt, b0: Pt, a1: Pt, b1: Pt) {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y)
  let turn = Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)
  if (turn > Math.PI) turn -= 2 * Math.PI
  if (turn < -Math.PI) turn += 2 * Math.PI
  const slide = { x: (a1.x + b1.x - a0.x - b0.x) / 2, y: (a1.y + b1.y - a0.y - b0.y) / 2 }
  return { scale: d0 > 1 ? d1 / d0 : 1, turn, slide }
}

/** A touch that barely moved and was short is a tap, not a drag. */
export function isTap(start: Pt, end: Pt, ms: number) {
  return ms < 350 && Math.hypot(end.x - start.x, end.y - start.y) < 10
}

/** Where to put a new object: the centre, or the first free spot around it. */
export function freeSpot(taken: [number, number][], minGap = 0.28): [number, number] {
  const spots: [number, number][] = [[0, 0], [-0.33, 0.12], [0.33, 0.12], [0, -0.32], [-0.33, -0.3], [0.33, -0.3], [0, 0.36]]
  for (const s of spots) {
    if (taken.every(([x, z]) => Math.hypot(x - s[0], z - s[1]) >= minGap)) return s
  }
  return [0, 0]
}

/**
 * Fingers drift a little while pinching or twisting; only a clear slide of
 * both fingers (beyond `dead` px) lifts the object, then smoothly from 0.
 */
export function liftPx(slideY: number, dead = 14) {
  return Math.abs(slideY) <= dead ? 0 : slideY - Math.sign(slideY) * dead
}

/*
 * Gentle snapping (piece 4): close to a guide, an object clicks onto it;
 * a little further it moves freely again. Small zones, so it helps without
 * fighting the finger.
 */
export const SNAP = { move: 0.025, turnDeg: 4, stepDeg: 15 }

/** `v` clicks onto `target` when within `zone`. */
export function snapTo(v: number, target: number, zone = SNAP.move) {
  return Math.abs(v - target) <= zone ? target : v
}

/** An angle (radians) clicks onto the nearest 15° step when within 4°. */
export function snapAngle(rad: number) {
  const step = (SNAP.stepDeg * Math.PI) / 180
  const nearest = Math.round(rad / step) * step
  return Math.abs(rad - nearest) <= (SNAP.turnDeg * Math.PI) / 180 ? nearest : rad
}

/** Guides for things standing in the scene: the marker's centre line (x = 0, z = 0) and the floor (y = 0). */
export function snapPosition([x, y, z]: [number, number, number]): { p: [number, number, number]; guides: { x: boolean; z: boolean; floor: boolean } } {
  const sx = snapTo(x, 0)
  const sz = snapTo(z, 0)
  const sy = snapTo(y, 0)
  return { p: [sx, sy, sz], guides: { x: sx === 0, z: sz === 0, floor: sy === 0 && y !== 0 } }
}

/** Prints on the marker: its centre (x = 0, y = 0.5 on the wall square). */
export function snapOnMarker([x, y, z]: [number, number, number]): [number, number, number] {
  return [snapTo(x, 0), snapTo(y, 0.5), z]
}
