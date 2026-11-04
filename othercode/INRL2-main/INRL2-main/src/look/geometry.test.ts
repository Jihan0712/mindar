import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { inflateShape, pointInLoops, resample } from './inflate'
import { solidify, traceContours } from './sticker'

describe('inflate', () => {
  const square = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(1, 1), new THREE.Vector2(0, 1)])

  it('puffs a square into a closed, rounded solid that is deepest in the middle', () => {
    const geo = inflateShape(square, { step: 0.05, puff: 1 })!
    const pos = geo.getAttribute('position')
    let maxZ = 0
    let minZ = 0
    for (let i = 0; i < pos.count; i++) {
      maxZ = Math.max(maxZ, pos.getZ(i))
      minZ = Math.min(minZ, pos.getZ(i))
    }
    // Circle profile of radius 0.5 (half the width) → 0.5 deep each side.
    expect(maxZ).toBeGreaterThan(0.4)
    expect(maxZ).toBeLessThanOrEqual(0.5001)
    expect(minZ).toBeCloseTo(-maxZ)
    expect(geo.index!.count).toBeGreaterThan(300)
  })

  it('leaves holes empty (the inside of an "o")', () => {
    const ring = square.clone()
    ring.holes.push(new THREE.Path([new THREE.Vector2(0.3, 0.3), new THREE.Vector2(0.3, 0.7), new THREE.Vector2(0.7, 0.7), new THREE.Vector2(0.7, 0.3)]))
    const geo = inflateShape(ring, { step: 0.04 })!
    const pos = geo.getAttribute('position')
    const idx = geo.index!
    for (let i = 0; i < idx.count; i += 3) {
      const cx = (pos.getX(idx.getX(i)) + pos.getX(idx.getX(i + 1)) + pos.getX(idx.getX(i + 2))) / 3
      const cy = (pos.getY(idx.getX(i)) + pos.getY(idx.getX(i + 1)) + pos.getY(idx.getX(i + 2))) / 3
      expect(cx > 0.32 && cx < 0.68 && cy > 0.32 && cy < 0.68).toBe(false)
    }
  })

  it('resamples outlines evenly and tests insideness with holes', () => {
    const pts = resample([[0, 0], [1, 0], [1, 1], [0, 1]], 0.1)
    expect(pts.length).toBeGreaterThanOrEqual(39)
    expect(pts.length).toBeLessThanOrEqual(41)
    const outer: [number, number][] = [[0, 0], [2, 0], [2, 2], [0, 2]]
    const hole: [number, number][] = [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]]
    expect(pointInLoops([0.2, 0.2], [outer, hole])).toBe(true)
    expect(pointInLoops([1, 1], [outer, hole])).toBe(false)
  })
})

describe('sticker outline', () => {
  it('traces one closed loop around a filled blob', () => {
    const w = 20
    const h = 20
    const mask = new Uint8Array(w * h)
    for (let y = 5; y < 15; y++) for (let x = 4; x < 16; x++) mask[y * w + x] = 1
    const loops = traceContours(mask, w, h)
    expect(loops).toHaveLength(1)
    const xs = loops[0].map((p) => p[0])
    const ys = loops[0].map((p) => p[1])
    expect(Math.min(...xs)).toBeCloseTo(4, 0)
    expect(Math.max(...xs)).toBeCloseTo(16, 0)
    expect(Math.min(...ys)).toBeCloseTo(5, 0)
    expect(Math.max(...ys)).toBeCloseTo(15, 0)
  })
})

describe('sticker solidify', () => {
  it('fills a ring into one solid piece even with a hairline gap', () => {
    const w = 24
    const h = 24
    const mask = new Uint8Array(w * h)
    for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) {
      const d = Math.hypot(x - 11.5, y - 11.5)
      if (d < 9.5 && d > 4) mask[y * w + x] = 1
    }
    for (let y = 16; y < 22; y++) mask[y * w + 11] = 0 // hairline cut from the hole to the outside
    const loops = traceContours(solidify(mask, w, h), w, h)
    expect(loops).toHaveLength(1)
  })
})
