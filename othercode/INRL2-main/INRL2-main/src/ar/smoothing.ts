import * as THREE from 'three'

/*
 * Anti-jitter for the marker pose: a "One Euro" filter (Casiez et al., the
 * standard for noisy trackers). The tracker's reading wobbles by a few
 * millimetres and about a degree from frame to frame. The filter looks at
 * how fast the pose is really changing:
 *  - phone held still → low cut-off: the wobble is smoothed away;
 *  - phone moving → the cut-off rises with the speed, so the scene keeps up
 *    and stays stuck to the print instead of drifting behind.
 * The previous filter adapted to the size of each change instead of speed:
 * it could not tell a slow real movement from wobble, so smoothing it more
 * (for bigger InStudio scenes) made objects drift when the phone moved.
 *
 * Velocity is measured with its sign (per axis, and as a rotation vector),
 * so back-and-forth wobble averages out to "not moving".
 */

const MIN_CUTOFF = 0.9 // Hz, when still: strong smoothing
const BETA_MOVE = 7 // extra Hz per marker width per second
const BETA_TURN = 10 // extra Hz per radian per second
const D_CUTOFF = 1 // Hz, for the speed estimate itself
const RENDER_MS = 16 // render frames ease towards the latest filtered pose (hides 30 Hz steps)

const alpha = (cutoffHz: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dt)
}

export interface SmootherOptions {
  /**
   * Cut-off when still, for turns (Hz). Lower = steadier. Used much lower
   * with gyroscope fusion: then the smoothed pose is the marker's place in
   * the room, which only turns if the marker itself turns (a T-shirt), so
   * heavy smoothing costs no lag when the phone moves. It matters most on
   * posters seen head-on, where the tracker is worst at telling the tilt.
   */
  minCutoffTurn?: number
}

export class PoseSmoother {
  private readonly minCutoffTurn: number

  constructor(opts: SmootherOptions = {}) {
    this.minCutoffTurn = opts.minCutoffTurn ?? MIN_CUTOFF
  }

  readonly position = new THREE.Vector3()
  readonly quaternion = new THREE.Quaternion()
  readonly scale = new THREE.Vector3(1, 1, 1)
  /** Filtered pose (updated on each tracker reading); the render pose eases towards it. */
  private readonly fPos = new THREE.Vector3()
  private readonly fQuat = new THREE.Quaternion()
  /** Filtered velocities: marker widths/s and a rotation vector in rad/s. */
  private readonly vPos = new THREE.Vector3()
  private readonly vTurn = new THREE.Vector3()
  private lastT = 0
  private initialised = false
  private readonly raw = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: new THREE.Vector3() }

  /**
   * New reading from the tracker. `snap` jumps straight to it (e.g. just
   * found). `timeMs` is when it was taken (defaults to now).
   */
  setTarget(m: THREE.Matrix4, snap = false, timeMs = performance.now()) {
    const { pos, quat, scale } = this.raw
    m.decompose(pos, quat, scale)
    this.scale.copy(scale)
    if (snap || !this.initialised) {
      this.fPos.copy(pos)
      this.fQuat.copy(quat)
      this.position.copy(pos)
      this.quaternion.copy(quat)
      this.vPos.set(0, 0, 0)
      this.vTurn.set(0, 0, 0)
      this.lastT = timeMs
      this.initialised = true
      return
    }
    const dt = Math.min(Math.max((timeMs - this.lastT) / 1000, 1 / 240), 0.1)
    this.lastT = timeMs
    const size = this.scale.x || 1

    // Signed velocities of the raw reading against the filtered pose.
    const dPos = pos.clone().sub(this.fPos).divideScalar(size * dt)
    const dq = this.fQuat.clone().invert().multiply(quat)
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w)
    const angle = 2 * Math.acos(Math.min(1, dq.w))
    const s = Math.sqrt(Math.max(1e-12, 1 - dq.w * dq.w))
    const dTurn = new THREE.Vector3(dq.x / s, dq.y / s, dq.z / s).multiplyScalar(angle / dt)
    const ad = alpha(D_CUTOFF, dt)
    this.vPos.lerp(dPos, ad)
    this.vTurn.lerp(dTurn, ad)

    // Faster real movement → higher cut-off → less lag. Shared: moving the
    // phone shifts and turns the marker in the picture at the same time.
    const speedUp = Math.max(BETA_MOVE * this.vPos.length(), BETA_TURN * this.vTurn.length())
    this.fPos.lerp(pos, alpha(MIN_CUTOFF + speedUp, dt))
    this.fQuat.slerp(quat, alpha(this.minCutoffTurn + speedUp, dt))
  }

  /** Advance by `dtMs`; writes the smoothed pose into `out`. */
  update(dtMs: number, out: THREE.Matrix4) {
    if (!this.initialised) return out
    const k = 1 - Math.exp(-Math.min(dtMs, 100) / RENDER_MS)
    this.position.lerp(this.fPos, k)
    this.quaternion.slerp(this.fQuat, k)
    return out.compose(this.position, this.quaternion, this.scale)
  }
}
