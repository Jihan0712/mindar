import * as THREE from 'three'
import { AttitudeHistory, cameraAttitude, type AttitudeSource } from './fusion'

/*
 * Which way is up, from the phone's orientation sensor, expressed in the AR
 * camera's coordinates (x right, y up the screen, z out of the screen).
 * Also keeps the phone's recent orientation for gyroscope fusion (ar/fusion.ts).
 *
 * Uses the deviceorientation angles rather than raw acceleration, because
 * iOS and Android disagree on the sign of acceleration but agree on angles.
 */

type Status = 'unavailable' | 'pending' | 'granted' | 'denied'

const DEG = Math.PI / 180

type IOSPermission = { requestPermission?: () => Promise<'granted' | 'denied'> }

export class GravitySensor implements AttitudeSource {
  /** Unit vector pointing up, in camera space. Null until the first reading. */
  readonly up = new THREE.Vector3()
  hasReading = false
  status: Status = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window ? 'pending' : 'unavailable'
  /** Readings per second from the sensor (for the test readout). */
  rate = 0
  private readonly history = new AttitudeHistory()
  private readonly q = new THREE.Quaternion()
  private count = 0
  private since = 0

  private readonly onOrientation = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return
    const screenAngle = screen.orientation?.angle ?? 0
    if (e.alpha !== null) this.history.push(e.timeStamp, cameraAttitude(e.alpha, e.beta, e.gamma, screenAngle, this.q))
    this.count++
    if (e.timeStamp - this.since >= 1000) {
      this.rate = Math.round((this.count * 1000) / (e.timeStamp - this.since))
      this.count = 0
      this.since = e.timeStamp
    }
    const b = e.beta * DEG
    const g = e.gamma * DEG
    // Earth's up in device coordinates, from the W3C rotation order Z-X'-Y''.
    this.up.set(-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g))
    // The camera image follows the screen, which may be rotated against the device.
    const angle = (screen.orientation?.angle ?? 0) * DEG
    if (angle) this.up.applyAxisAngle(new THREE.Vector3(0, 0, 1), -angle)
    this.up.normalize()
    this.hasReading = true
  }

  /**
   * iOS only gives sensor access after asking, and the request must start
   * inside a tap. Call this synchronously from the tap handler.
   */
  request(): Promise<void> {
    if (this.status === 'unavailable') return Promise.resolve()
    const ask = (DeviceOrientationEvent as unknown as IOSPermission).requestPermission
    const granted = ask ? ask().then((r) => r === 'granted', () => false) : Promise.resolve(true)
    return granted.then((ok) => {
      this.status = ok ? 'granted' : 'denied'
      if (ok) window.addEventListener('deviceorientation', this.onOrientation)
    })
  }

  at(t: number, out: THREE.Quaternion) {
    return this.history.at(t, out)
  }

  stop() {
    window.removeEventListener('deviceorientation', this.onOrientation)
  }
}

let primed: GravitySensor | null = null

/**
 * Asks for motion access from a tap on one screen (e.g. the Scan button) for
 * a camera that opens on the next screen without another tap.
 */
export function primeGravity() {
  primed = new GravitySensor()
  void primed.request()
}

/** The sensor primed by `primeGravity()`, if any (taken once). */
export function takePrimedGravity(): GravitySensor | null {
  const g = primed
  primed = null
  return g
}
