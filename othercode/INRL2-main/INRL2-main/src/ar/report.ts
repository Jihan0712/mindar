import * as THREE from 'three'

/*
 * On-phone measurements of how steady AR is, for the preview's "Copy
 * report". The fake test camera can't reproduce a real iPhone camera
 * (autofocus, noise, blur), so the phone measures itself.
 *
 * Poses are taken in the room frame when the gyroscope is in use (the
 * phone's turning removed), so a phone held still on a still poster should
 * read near zero: anything left is the tracker's own wobble.
 */

interface Sample {
  t: number
  pos: THREE.Vector3 // marker widths
  normal: THREE.Vector3 // the print's facing direction
}

const WINDOW_MS = 10000

export class PoseStats {
  private raw: Sample[] = []
  private shown: Sample[] = []
  losses = 0
  stale = 0
  markerPx = 0
  /** Gravity lock state (wall / table / none), from the fusion. */
  lock = '-'
  private readonly v = new THREE.Vector3()
  private readonly q = new THREE.Quaternion()
  private readonly s = new THREE.Vector3()

  private push(list: Sample[], t: number, m: THREE.Matrix4) {
    m.decompose(this.v, this.q, this.s)
    const size = this.s.x || 1
    list.push({ t, pos: this.v.clone().divideScalar(size), normal: new THREE.Vector3(0, 0, 1).applyQuaternion(this.q) })
    while (list.length && list[0].t < t - WINDOW_MS) list.shift()
  }

  /** A fresh tracker reading (room frame if the gyroscope is on). */
  reading(t: number, m: THREE.Matrix4) {
    this.push(this.raw, t, m)
  }

  /** What was drawn this frame (same frame as the readings). */
  drawn(t: number, m: THREE.Matrix4) {
    this.push(this.shown, t, m)
  }

  report(): string[] {
    const r = wobble(this.raw)
    const d = wobble(this.shown)
    const secs = this.raw.length > 1 ? (this.raw[this.raw.length - 1].t - this.raw[0].t) / 1000 : 0
    return [
      `Readings: ${this.raw.length} in ${secs.toFixed(1)} s (${secs ? Math.round(this.raw.length / secs) : 0}/s), losses ${this.losses}, stale ${this.stale}`,
      `Marker in camera: ~${Math.round(this.markerPx)} px wide · gravity lock: ${this.lock}`,
      `Tilt split (raw → shown): up/down ${r.upDown}° → ${d.upDown}°, left/right ${r.leftRight}° → ${d.leftRight}°`,
      `Tracker wobble (raw): tilt ${r.tilt}° (fast ${r.tiltFast}°), position ${r.pos} (fast ${r.posFast}) marker widths`,
      `Shown wobble (after smoothing): tilt ${d.tilt}° (fast ${d.tiltFast}°), position ${d.pos} (fast ${d.posFast}) marker widths`,
    ]
  }
}

/** Spread of a run of poses: overall, and "fast" (minus a 9-sample moving average). */
export function wobble(list: Sample[]) {
  const fmt = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '-')
  if (list.length < 12) return { tilt: '-', tiltFast: '-', pos: '-', posFast: '-', upDown: '-', leftRight: '-' }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const rms = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length)
  const fast = (a: number[]) => a.map((x, i) => x - mean(a.slice(Math.max(0, i - 4), i + 5))).slice(4, -4)
  const nm = new THREE.Vector3()
  for (const s of list) nm.add(s.normal)
  nm.normalize()
  // Tilt as two angles about the mean facing direction.
  const ax = new THREE.Vector3().crossVectors(nm, Math.abs(nm.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize()
  const ay = new THREE.Vector3().crossVectors(nm, ax)
  const tx = list.map((s) => Math.asin(Math.max(-1, Math.min(1, s.normal.dot(ax)))) * 180 / Math.PI)
  const ty = list.map((s) => Math.asin(Math.max(-1, Math.min(1, s.normal.dot(ay)))) * 180 / Math.PI)
  const px = list.map((s) => s.pos.x)
  const py = list.map((s) => s.pos.y)
  const pz = list.map((s) => s.pos.z)
  const centred = (a: number[]) => a.map((x) => x - mean(a))
  const tilt = Math.hypot(rms(centred(tx)), rms(centred(ty)))
  const tiltFast = Math.hypot(rms(fast(tx)), rms(fast(ty)))
  // Position in 3D (room axes when the gyroscope is on, so no "across / depth" split).
  const pos = Math.hypot(rms(centred(px)), rms(centred(py)), rms(centred(pz)))
  const posFast = Math.hypot(rms(fast(px)), rms(fast(py)), rms(fast(pz)))
  // Room frame (z up): how much the facing direction swings up/down vs left/right.
  const deg = 180 / Math.PI
  const elev = list.map((s) => Math.asin(Math.max(-1, Math.min(1, s.normal.z))) * deg)
  const az = list.map((s) => Math.atan2(s.normal.y, s.normal.x) * deg)
  const azC = az.map((a) => ((a - az[0] + 540) % 360) - 180) // unwrap around the first
  const cosE = Math.cos(mean(elev) / deg)
  return {
    tilt: fmt(tilt, 2),
    tiltFast: fmt(tiltFast, 2),
    pos: fmt(pos),
    posFast: fmt(posFast),
    upDown: fmt(rms(centred(elev)), 2),
    leftRight: fmt(rms(centred(azC)) * cosE, 2),
  }
}
