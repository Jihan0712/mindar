import * as THREE from 'three'
import { PoseSmoother } from './smoothing'

/*
 * Gyroscope fusion for the marker pose.
 *
 * The tracker says where the marker is relative to the camera. That changes
 * when the phone turns AND when the reading wobbles; a filter can't tell the
 * two apart, so it either shakes or lags. The phone's motion sensor (fused
 * gyroscope, via `deviceorientation`) measures the turning directly. So:
 *
 *  1. Each reading is turned into "where the marker is in the room":
 *     room = phoneTurn(at the moment the frame was read) × reading.
 *     A marker lying still stays still here, however the phone turns.
 *  2. That room pose is smoothed (wobble removed, nothing to lag behind,
 *     since turning the phone no longer moves it).
 *  3. For each drawn frame it is turned back into the camera's view with
 *     the phone's turn at that moment: view = phoneTurn(t)⁻¹ × room.
 *
 * When tracking is lost for a moment (motion blur), the room pose is kept
 * and the scene stays put using the gyroscope alone, for up to COAST_MS.
 * Moving the phone sideways (not turning) is still followed by the tracker.
 */

export const COAST_MS = 600

/*
 * Gravity lock. Seen small and head-on, the tracker can't tell which way a
 * print is tilted (Nico's poster, 2026-10-06: the tilt swung ~14° from a
 * step away, 1.5° one step closer). The print's outline still lands right,
 * so prints lying on it look fine, but objects standing out swing. A poster
 * hangs vertically and a print on a table lies flat, and the motion sensor
 * knows where "down" is: so once the marker is clearly on a wall or a table,
 * its facing direction is locked to that, keeping from the tracker where it
 * is and how it is turned on the wall / table.
 */
const ROOM_UP = new THREE.Vector3(0, 0, 1) // the room frame of cameraAttitude(): z up
const LOCK_ENTER = THREE.MathUtils.degToRad(25) // within this of wall/table: lock
const LOCK_LEAVE = THREE.MathUtils.degToRad(35) // beyond this: free again
export type Lock = 'wall' | 'table' | null

/*
 * Wall direction hold. Locked to a wall, the poster can still seem to turn
 * left/right (Nico, 2026-10-06: 3.5° from a step away, after the gravity
 * lock removed up/down). A poster doesn't turn on its wall, so its facing
 * direction is averaged over a few seconds; a clear change that lasts (a
 * T-shirt wearer turning) is followed quickly.
 */
const HOLD_HZ = 0.08 // ~2 s time constant while it holds
const HOLD_BREAK = THREE.MathUtils.degToRad(10) // a change this big…
const HOLD_BREAK_MS = 500 // …lasting this long is real: follow it
/** Hz: how fast the marker's own turning is followed when it is still (vs 0.9 for the camera-space filter). */
export const ROOM_TURN_CUTOFF = 0.3

/** Phone (camera) orientation over time, in a fixed room frame. */
export interface AttitudeSource {
  /** Camera-to-room rotation at time `t` (ms, performance.now clock). False if unknown. */
  at(t: number, out: THREE.Quaternion): boolean
}

/** Keeps the last second of orientation samples and interpolates between them. */
export class AttitudeHistory implements AttitudeSource {
  private readonly samples: { t: number; q: THREE.Quaternion }[] = []

  push(t: number, q: THREE.Quaternion) {
    const last = this.samples[this.samples.length - 1]
    if (last && t <= last.t) return
    // Keep quaternions on the same side so interpolation takes the short way.
    const qq = q.clone()
    if (last && last.q.dot(qq) < 0) qq.set(-qq.x, -qq.y, -qq.z, -qq.w)
    this.samples.push({ t, q: qq })
    while (this.samples.length > 2 && this.samples[0].t < t - 1000) this.samples.shift()
  }

  at(t: number, out: THREE.Quaternion) {
    const s = this.samples
    if (!s.length) return false
    if (t <= s[0].t) return !!out.copy(s[0].q)
    const last = s[s.length - 1]
    if (t >= last.t) {
      // A little ahead of the last sample (sensor ~60 Hz): continue its turn, briefly.
      const prev = s[s.length - 2]
      if (!prev || t - last.t > 100) return !!out.copy(last.q)
      const k = (t - last.t) / (last.t - prev.t)
      const step = prev.q.clone().invert().multiply(last.q)
      const ahead = new THREE.Quaternion().slerp(step, Math.min(k, 2))
      return !!out.copy(last.q).multiply(ahead)
    }
    let i = s.length - 1
    while (i > 0 && s[i - 1].t > t) i--
    const a = s[i - 1]
    const b = s[i]
    return !!out.copy(a.q).slerp(b.q, (t - a.t) / (b.t - a.t))
  }
}

/** Device orientation angles (degrees, W3C) → camera-to-room rotation, for a phone held in `screenAngle`. */
export function cameraAttitude(alpha: number, beta: number, gamma: number, screenAngle: number, out = new THREE.Quaternion()) {
  const D = Math.PI / 180
  // W3C: device-to-earth = Rz(alpha) · Rx(beta) · Ry(gamma); three's 'ZXY' order builds exactly that.
  out.setFromEuler(new THREE.Euler(beta * D, gamma * D, alpha * D, 'ZXY'))
  // The back camera's axes are the screen's (x right, y up, looking out the back);
  // a rotated screen turns them about z.
  if (screenAngle) out.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screenAngle * D))
  return out
}

export class PoseFusion {
  /** In the room frame a still marker never turns: smooth its turning hard (see SmootherOptions). */
  private readonly smoother = new PoseSmoother({ minCutoffTurn: ROOM_TURN_CUTOFF })
  private readonly q = new THREE.Quaternion()
  private readonly rot = new THREE.Matrix4()
  private readonly room = new THREE.Matrix4()
  private readonly attitude: AttitudeSource
  private hasRoom = false
  /** Slow average of the marker's facing direction (room frame), to decide the lock calmly. */
  private readonly avgNormal = new THREE.Vector3()
  lock: Lock = null
  private readonly lp = new THREE.Vector3()
  private readonly lq = new THREE.Quaternion()
  private readonly ls = new THREE.Vector3()
  private readonly ln = new THREE.Vector3()
  /** Wall direction hold: the held facing direction (radians, about up), last reading time, and since when it's been clearly off. */
  private heldAz: number | null = null
  private heldAt = 0
  private offSince: number | null = null
  /** When tracking was lost, or null while tracking. */
  private lostAt: number | null = null

  constructor(attitude: AttitudeSource) {
    this.attitude = attitude
  }

  /** A fresh tracker reading `m` (marker in camera space) from a frame read at `t`. False if the gyroscope has no data yet. */
  reading(m: THREE.Matrix4, t: number, snap: boolean) {
    if (!this.attitude.at(t, this.q)) return false
    this.room.makeRotationFromQuaternion(this.q).multiply(m)
    this.applyGravityLock(snap || !this.hasRoom, t)
    this.smoother.setTarget(this.room, snap || !this.hasRoom, t)
    this.hasRoom = true
    this.lostAt = null
    return true
  }

  /** Locks `this.room`'s facing direction to the wall or the table (see Gravity lock). */
  private applyGravityLock(reset: boolean, t: number) {
    this.room.decompose(this.lp, this.lq, this.ls)
    this.ln.set(0, 0, 1).applyQuaternion(this.lq) // marker normal (out of the print)
    if (reset) this.avgNormal.copy(this.ln)
    else this.avgNormal.lerp(this.ln, 0.05).normalize()
    // Angle of the (averaged) facing direction from horizontal and from up.
    const fromUp = Math.acos(THREE.MathUtils.clamp(this.avgNormal.dot(ROOM_UP), -1, 1))
    const fromWall = Math.abs(Math.PI / 2 - fromUp)
    if (this.lock === 'wall' ? fromWall > LOCK_LEAVE : this.lock === 'table' ? fromUp > LOCK_LEAVE : false) this.lock = null
    if (!this.lock) this.lock = fromWall < LOCK_ENTER ? 'wall' : fromUp < LOCK_ENTER ? 'table' : null
    if (this.lock !== 'wall') this.heldAz = null
    if (!this.lock) return
    const target = this.lock === 'table' ? ROOM_UP.clone() : new THREE.Vector3(this.ln.x, this.ln.y, 0)
    if (target.lengthSq() < 1e-6) return
    target.normalize()
    if (this.lock === 'wall') {
      const az = Math.atan2(target.y, target.x)
      const held = this.holdDirection(az, t, reset)
      target.set(Math.cos(held), Math.sin(held), 0)
    }
    // The smallest turn that makes it face exactly the wall's / table's way.
    this.lq.premultiply(new THREE.Quaternion().setFromUnitVectors(this.ln, target))
    this.room.compose(this.lp, this.lq, this.ls)
  }

  /** Wall direction hold (see above): returns the direction to show. */
  private holdDirection(az: number, t: number, reset: boolean) {
    if (reset || this.heldAz === null) {
      this.heldAz = az
      this.heldAt = t
      this.offSince = null
      return az
    }
    const diff = Math.atan2(Math.sin(az - this.heldAz), Math.cos(az - this.heldAz))
    const dt = Math.min(Math.max((t - this.heldAt) / 1000, 0), 0.1)
    this.heldAt = t
    if (Math.abs(diff) > HOLD_BREAK) {
      this.offSince ??= t
      // A real turn: catch up quickly.
      if (t - this.offSince > HOLD_BREAK_MS) this.heldAz += diff * Math.min(1, dt * 12)
    } else {
      this.offSince = null
      this.heldAz += diff * (1 - Math.exp(-2 * Math.PI * HOLD_HZ * dt))
    }
    return this.heldAz
  }

  lost(t: number) {
    this.lostAt ??= t
  }

  /** Has a room pose, i.e. the gyroscope is in use. */
  get active() {
    return this.hasRoom
  }

  /** Still worth drawing at `t`: tracking, or lost for less than COAST_MS. */
  showing(t: number) {
    return this.hasRoom && (this.lostAt === null || t - this.lostAt < COAST_MS)
  }

  /** The marker in camera space for a picture of the moment `t` (ms). */
  view(t: number, dtMs: number, out: THREE.Matrix4) {
    if (!this.hasRoom || !this.attitude.at(t, this.q)) return false
    this.smoother.update(dtMs, this.room)
    this.rot.makeRotationFromQuaternion(this.q).invert()
    out.multiplyMatrices(this.rot, this.room)
    return true
  }

  reset() {
    this.hasRoom = false
    this.lostAt = null
    this.lock = null
    this.heldAz = null
  }
}
