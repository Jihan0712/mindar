import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { AttitudeHistory, cameraAttitude, COAST_MS, PoseFusion } from './fusion'

const D = Math.PI / 180
const angleBetween = (a: THREE.Matrix4, b: THREE.Matrix4) =>
  new THREE.Quaternion().setFromRotationMatrix(a).angleTo(new THREE.Quaternion().setFromRotationMatrix(b)) / D

describe('camera attitude from the motion sensor', () => {
  it('flat phone, face up: the back camera looks down', () => {
    const q = cameraAttitude(0, 0, 0, 0)
    expect(new THREE.Vector3(0, 0, -1).applyQuaternion(q).z).toBeCloseTo(-1)
  })
  it('phone upright: the back camera looks at the horizon', () => {
    const q = cameraAttitude(0, 90, 0, 0)
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(q)
    expect(look.z).toBeCloseTo(0)
    expect(Math.hypot(look.x, look.y)).toBeCloseTo(1)
  })
})

describe('AttitudeHistory', () => {
  it('interpolates between samples and runs a little ahead of the last one', () => {
    const h = new AttitudeHistory()
    const turn = (deg: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), deg * D)
    h.push(0, turn(0))
    h.push(16, turn(1))
    const q = new THREE.Quaternion()
    h.at(8, q)
    expect(q.angleTo(turn(0.5)) / D).toBeLessThan(0.01)
    h.at(24, q) // 8 ms after the last sample: keeps turning
    expect(q.angleTo(turn(1.5)) / D).toBeLessThan(0.05)
  })
})

describe('PoseFusion (gyroscope + tracker)', () => {
  // The marker lies still in the room; the phone turns steadily at 60°/s
  // (a brisk turn) and the tracker's readings wobble by ±1° and ±1 % of the
  // marker width, 30 times a second. The motion sensor reports 60 times a second.
  const W0 = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, -2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0.2, 0)), new THREE.Vector3(1, 1, 1))
  const phone = (t: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 60 * D * (t / 1000))
  const truthView = (t: number) => new THREE.Matrix4().makeRotationFromQuaternion(phone(t)).invert().multiply(W0)

  function simulate(lossFrom = Infinity, lossTo = Infinity) {
    const h = new AttitudeHistory()
    const f = new PoseFusion(h)
    const out = new THREE.Matrix4()
    let worst = 0
    let wobbleNoFusion = 0
    let i = 0
    let shownDuringLoss = true // a 400 ms loss is shorter than COAST_MS
    for (let t = 0; t <= 2000; t += 1000 / 60) {
      h.push(t, phone(t))
      const frame = Math.round(t / (1000 / 60))
      if (frame % 2 === 0) {
        if (t >= lossFrom && t < lossTo) f.lost(t)
        else {
          const s = i++ % 2 ? 1 : -1
          const noise = new THREE.Matrix4().compose(new THREE.Vector3(0.01 * s, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s * D), new THREE.Vector3(1, 1, 1))
          const reading = truthView(t).multiply(noise)
          f.reading(reading, t, t === 0)
          if (t > 500) wobbleNoFusion = Math.max(wobbleNoFusion, angleBetween(reading, truthView(t)))
        }
      }
      if (t >= lossFrom && t < lossTo && !f.showing(t)) shownDuringLoss = false
      if (f.view(t, 1000 / 60, out) && t > 500 && !(t >= lossFrom && t < lossTo)) worst = Math.max(worst, angleBetween(out, truthView(t)))
    }
    return { worst, wobbleNoFusion, shownDuringLoss, fusion: f }
  }

  it('keeps the scene on a still marker while the phone turns: no lag, wobble removed', () => {
    const { worst, wobbleNoFusion } = simulate()
    expect(wobbleNoFusion).toBeGreaterThan(0.9) // the raw readings are off by 1°
    expect(worst).toBeLessThan(0.3) // fused: under a third of a degree, even mid-turn
  })

  it('holds the scene with the gyroscope when the marker is lost for a moment (blur), then lets go', () => {
    const { shownDuringLoss, fusion } = simulate(1000, 1400)
    expect(shownDuringLoss).toBe(true)
    fusion.lost(5000)
    expect(fusion.showing(5000 + COAST_MS - 50)).toBe(true)
    expect(fusion.showing(5000 + COAST_MS + 50)).toBe(false)
  })

  it('holds a poster seen head-on steady: tilt wobble of ±2° shrinks to a few tenths', () => {
    // Head-on, the tracker is worst at the print's tilt: readings rock ±2° about a horizontal axis.
    const h = new AttitudeHistory()
    const f = new PoseFusion(h)
    const out = new THREE.Matrix4()
    let worst = 0
    let i = 0
    for (let t = 0; t <= 3000; t += 1000 / 60) {
      h.push(t, new THREE.Quaternion())
      if (Math.round(t / (1000 / 60)) % 2 === 0) {
        const s = Math.sin(i++ * 2.1) // irregular wobble
        const reading = W0.clone().multiply(new THREE.Matrix4().makeRotationX(2 * D * s))
        f.reading(reading, t, t === 0)
      }
      if (f.view(t, 1000 / 60, out) && t > 1500) worst = Math.max(worst, angleBetween(out, W0))
    }
    expect(worst).toBeLessThan(0.4)
  })

  it('locks a poster on the wall to vertical: a 14° tilt swing from the tracker disappears', () => {
    // A poster facing the room horizontally (its normal level), seen by a still phone.
    // The tracker's tilt swings slowly ±14° up/down (head-on ambiguity).
    const poster = new THREE.Matrix4().compose(new THREE.Vector3(0, 2, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), new THREE.Vector3(1, 1, 1))
    const normalOf = (m: THREE.Matrix4) => new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m))
    const h = new AttitudeHistory()
    const f = new PoseFusion(h)
    const out = new THREE.Matrix4()
    let worstUpDown = 0
    for (let t = 0; t <= 6000; t += 1000 / 60) {
      h.push(t, new THREE.Quaternion())
      if (Math.round(t / (1000 / 60)) % 2 === 0) {
        const swing = 14 * D * Math.sin(t / 700)
        f.reading(poster.clone().multiply(new THREE.Matrix4().makeRotationX(swing)), t, t === 0)
      }
      if (f.view(t, 1000 / 60, out) && t > 1000) worstUpDown = Math.max(worstUpDown, Math.abs(Math.asin(normalOf(out).z)) / D)
    }
    expect(f.lock).toBe('wall')
    expect(worstUpDown).toBeLessThan(0.5)
  })

  it('leaves a marker on a slope alone', () => {
    const slope = new THREE.Matrix4().makeRotationX(Math.PI / 4) // 45°: neither wall nor table
    const h = new AttitudeHistory()
    const f = new PoseFusion(h)
    h.push(0, new THREE.Quaternion())
    f.reading(slope, 0, true)
    expect(f.lock).toBe(null)
  })

  it('holds a wall poster\'s left/right direction steady, but follows a real turn', () => {
    const facing = (deg: number) => new THREE.Matrix4().compose(
      new THREE.Vector3(0, 2, 0),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * D).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)),
      new THREE.Vector3(1, 1, 1),
    )
    const azOf = (m: THREE.Matrix4) => {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m))
      return Math.atan2(n.y, n.x) / D
    }
    const h = new AttitudeHistory()
    const f = new PoseFusion(h)
    const out = new THREE.Matrix4()
    let base = 0
    let worst = 0
    let turned = 0
    for (let t = 0; t <= 9000; t += 1000 / 60) {
      h.push(t, new THREE.Quaternion())
      const wobble = 3.5 * Math.sin(t / 450) + 1.5 * Math.sin(t / 130) // what the tracker reports far away
      const real = t < 6000 ? 0 : 30 // at 6 s the wearer turns 30°
      if (Math.round(t / (1000 / 60)) % 2 === 0) f.reading(facing(real + wobble), t, t === 0)
      if (!f.view(t, 1000 / 60, out)) continue
      if (t === 0) base = azOf(out)
      if (t > 2500 && t < 6000) worst = Math.max(worst, Math.abs(azOf(out) - base))
      if (t > 7500) turned = azOf(out) - base
    }
    expect(worst).toBeLessThan(1.2) // ±3.5° wobble held to about 1°
    expect(turned).toBeGreaterThan(25) // the real 30° turn is followed
  })
})
