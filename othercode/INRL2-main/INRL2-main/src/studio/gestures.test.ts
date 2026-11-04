import { describe, expect, it } from 'vitest'
import { AREA, clampToArea, freeSpot, isTap, liftPx, rubberBand, snapAngle, snapOnMarker, snapPosition, snapTo, stretchToArea, twoFinger } from './gestures'

describe('InStudio gestures', () => {
  it('keeps objects inside the workspace', () => {
    expect(clampToArea([2, -1, -3])).toEqual([AREA.half, 0, AREA.back])
    expect(AREA.back).toBeGreaterThan(AREA.wall) // never behind the marker on the wall
    expect(clampToArea([0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3])
  })

  it('lets objects go a marker width out, then stretches a little past the edge', () => {
    expect(clampToArea([0.9, 1.4, 0.9])).toEqual([0.9, 1.4, 0.9])
    expect(rubberBand(0.5, -1, 1)).toBe(0.5)
    const past = rubberBand(3, -1, 1)
    expect(past).toBeGreaterThan(1)
    expect(past).toBeLessThan(1.08)
    expect(rubberBand(1.01, -1, 1)).toBeLessThan(rubberBand(1.2, -1, 1))
    expect(stretchToArea([0, 0, -2])[2]).toBeGreaterThan(AREA.back - 0.08)
  })

  it('reads a pinch as a size change', () => {
    const r = twoFinger({ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 })
    expect(r.scale).toBeCloseTo(2)
    expect(r.turn).toBeCloseTo(0)
  })

  it('reads a clockwise twist as a positive turn, across the ±180° seam too', () => {
    const quarter = twoFinger({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 })
    expect(quarter.turn).toBeCloseTo(Math.PI / 2)
    const seam = twoFinger({ x: 0, y: 0 }, { x: -100, y: 1 }, { x: 0, y: 0 }, { x: -100, y: -1 })
    expect(Math.abs(seam.turn)).toBeLessThan(0.1)
  })

  it('reads two fingers sliding together as a lift, without size or turn', () => {
    const r = twoFinger({ x: 100, y: 300 }, { x: 200, y: 300 }, { x: 100, y: 200 }, { x: 200, y: 200 })
    expect(r.slide.y).toBeCloseTo(-100)
    expect(r.scale).toBeCloseTo(1)
    expect(r.turn).toBeCloseTo(0)
    expect(liftPx(8)).toBe(0) // drift while pinching doesn't lift
    expect(liftPx(-100)).toBe(-86)
  })

  it('tells taps from drags', () => {
    expect(isTap({ x: 0, y: 0 }, { x: 4, y: 3 }, 120)).toBe(true)
    expect(isTap({ x: 0, y: 0 }, { x: 40, y: 0 }, 120)).toBe(false)
    expect(isTap({ x: 0, y: 0 }, { x: 0, y: 0 }, 900)).toBe(false)
  })

  it('places new objects where nothing stands yet', () => {
    expect(freeSpot([])).toEqual([0, 0])
    const second = freeSpot([[0, 0]])
    expect(Math.hypot(...second)).toBeGreaterThan(0.2)
  })
})


describe('gentle snapping', () => {
  it('clicks onto a guide only when close', () => {
    expect(snapTo(0.02, 0)).toBe(0)
    expect(snapTo(0.05, 0)).toBe(0.05)
  })
  it('clicks turns onto 15° steps when within 4°', () => {
    const d = Math.PI / 180
    expect(snapAngle(43 * d) / d).toBeCloseTo(45)
    expect(snapAngle(38 * d) / d).toBeCloseTo(38)
    expect(snapAngle(-2 * d)).toBeCloseTo(0)
  })
  it('snaps to the marker centre line and the floor, and says which guide to show', () => {
    const r = snapPosition([0.01, 0.015, 0.4])
    expect(r.p).toEqual([0, 0, 0.4])
    expect(r.guides).toEqual({ x: true, z: false, floor: true })
    expect(snapOnMarker([0.01, 0.51, -0.496])).toEqual([0, 0.5, -0.496])
  })
})
