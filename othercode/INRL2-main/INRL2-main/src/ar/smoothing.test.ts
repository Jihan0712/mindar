import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PoseSmoother } from './smoothing'

// A marker 1 unit wide (scale 1) half a metre in front of the camera.
const at = (x: number, angleDeg = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, 0, -0.5), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(angleDeg)), new THREE.Vector3(1, 1, 1))
const xOf = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m).x
const degOf = (m: THREE.Matrix4) => {
  const q = new THREE.Quaternion().setFromRotationMatrix(m)
  return THREE.MathUtils.radToDeg(2 * Math.atan2(q.y, q.w))
}

/** Feeds readings at 30 Hz (the tracker's pace) and renders at 60 Hz. */
function run(s: PoseSmoother, seconds: number, reading: (t: number, i: number) => THREE.Matrix4, each?: (t: number, out: THREE.Matrix4) => void) {
  const out = new THREE.Matrix4()
  let i = 0
  for (let ms = 0; ms <= seconds * 1000; ms += 1000 / 60) {
    if (Math.round(ms / (1000 / 60)) % 2 === 0) s.setTarget(reading(ms / 1000, i++), false, ms)
    s.update(1000 / 60, out)
    each?.(ms / 1000, out)
  }
  return out
}

describe('PoseSmoother (One Euro)', () => {
  it('smooths wobble away when the phone is still', () => {
    const s = new PoseSmoother()
    s.setTarget(at(0), true, 0)
    let maxX = 0
    let maxDeg = 0
    // Readings alternate ±1 % of the marker width and ±1°.
    run(s, 2, (_, i) => at(0.01 * (i % 2 ? 1 : -1), i % 2 ? 1 : -1), (t, out) => {
      if (t > 0.5) {
        maxX = Math.max(maxX, Math.abs(xOf(out)))
        maxDeg = Math.max(maxDeg, Math.abs(degOf(out)))
      }
    })
    expect(maxX).toBeLessThan(0.003)
    expect(maxDeg).toBeLessThan(0.3)
  })

  it('keeps up with a phone turning steadily (no drift behind)', () => {
    const s = new PoseSmoother()
    s.setTarget(at(0), true, 0)
    let lag = 0
    // 30° per second, a calm hand movement.
    run(s, 1.5, (t) => at(0, 30 * t), (t, out) => {
      if (t > 0.5) lag = Math.max(lag, 30 * t - degOf(out))
    })
    expect(lag).toBeLessThan(1.5) // the earlier size-based filters lagged 2.5–4°
  })

  it('keeps up with a phone sliding steadily', () => {
    const s = new PoseSmoother()
    s.setTarget(at(0), true, 0)
    let lag = 0
    // Half a marker width per second.
    run(s, 1.5, (t) => at(0.5 * t), (t, out) => {
      if (t > 0.5) lag = Math.max(lag, 0.5 * t - xOf(out))
    })
    expect(lag).toBeLessThan(0.04)
  })

  it('follows a sudden real move quickly', () => {
    const s = new PoseSmoother()
    s.setTarget(at(0), true, 0)
    const out = run(s, 0.15, () => at(0.3))
    expect(xOf(out)).toBeGreaterThan(0.27)
  })
})
