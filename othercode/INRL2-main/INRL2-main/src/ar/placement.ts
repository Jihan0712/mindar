import * as THREE from 'three'

/*
 * How a scene sits on its marker.
 *
 *  flat      marker on a table or floor: the scene stands on it, growing
 *            straight up out of the print.
 *  vertical  marker on a wall, a screen or a T-shirt: the scene stands
 *            upright, centred on the print and in front of it (option B).
 *
 * The same scene works both ways; creators design it once.
 */
export type Placement = 'flat' | 'vertical'

// Tilt of the marker from horizontal decides the placement:
//   flat      below 35° (table, floor, a slightly raised print)
//   vertical  above 50° (walls, T-shirts, laptop screens leaning back up to 40°)
// In between, the current placement is kept.
const FLAT_ABOVE = Math.cos(35 * (Math.PI / 180)) // |cos(normal, up)| above this: flat
const VERTICAL_BELOW = Math.cos(50 * (Math.PI / 180)) // below this: vertical
// The tracker's pose is unreliable when the marker is seen at a steep angle
// or has just been found (it can briefly read a wall print as lying flat,
// which used to flip the scene and leave it stuck). Such readings are ignored,
// the rest are averaged, and a change must hold steadily before it happens.
const MAX_VIEW_ANGLE_COS = Math.cos(55 * (Math.PI / 180))
const SETTLE_MS = 300
const SMOOTHING_MS = 250
const HOLD_MS = 700

export class PlacementTracker {
  placement: Placement = 'flat'
  /** Tilt of the marker from horizontal, in degrees (smoothed), for the test panel. */
  tiltDeg = 0
  private avg: number | null = null
  private pendingSince: number | null = null
  private lastSeen = -Infinity
  private settleUntil = 0
  /** No decision yet since the marker was (re)found: the first one is immediate. */
  private fresh = true
  private readonly normal = new THREE.Vector3()
  private readonly toCamera = new THREE.Vector3()

  /**
   * Call every frame while the marker is visible. `markerMatrix` is the
   * marker's pose in camera space; `up` is gravity's up in camera space.
   * Returns true when the placement changed.
   */
  update(markerMatrix: THREE.Matrix4, up: THREE.Vector3, now = performance.now()): boolean {
    // Just (re)found: let the pose settle before trusting it.
    if (now - this.lastSeen > 200) {
      this.settleUntil = now + SETTLE_MS
      // After a longer absence the phone may be looking at another marker.
      if (now - this.lastSeen > 2000) {
        this.fresh = true
        this.avg = null
      }
    }
    const dt = Math.min(now - this.lastSeen, 100)
    this.lastSeen = now
    if (now < this.settleUntil) return false

    this.normal.setFromMatrixColumn(markerMatrix, 2).normalize()
    this.toCamera.setFromMatrixPosition(markerMatrix).negate().normalize()
    if (Math.abs(this.normal.dot(this.toCamera)) < MAX_VIEW_ANGLE_COS) return false

    const cos = Math.abs(this.normal.dot(up))
    this.avg = this.avg === null ? cos : this.avg + (cos - this.avg) * Math.min(1, dt / SMOOTHING_MS)
    this.tiltDeg = Math.round((Math.acos(Math.min(1, this.avg)) * 180) / Math.PI)

    const wanted: Placement | null = this.avg > FLAT_ABOVE ? 'flat' : this.avg < VERTICAL_BELOW ? 'vertical' : null
    if (wanted && this.fresh) {
      this.fresh = false
      this.pendingSince = null
      if (wanted === this.placement) return false
      this.placement = wanted
      return true
    }
    if (!wanted || wanted === this.placement) {
      this.pendingSince = null
      return false
    }
    this.pendingSince ??= now
    if (now - this.pendingSince < HOLD_MS) return false
    this.placement = wanted
    this.pendingSince = null
    return true
  }
}

/**
 * Positions the scene's container inside the marker anchor (marker space:
 * x right, y up the print, z out of the print).
 *
 * InStudio draws the marker as the 1 × 1 square on the back wall
 * (x ±0.5, y 0–1, z = -0.5) with the floor in front of it, so:
 *  - vertical marker (wall, screen, T-shirt): exactly what the editor shows,
 *    the wall square on the print, the floor sticking out from its bottom edge;
 *  - flat marker (table): the floor lies on the print (the floor square in
 *    front of the wall = the print), and media placed "on the marker" are
 *    laid down onto the print instead of standing at its top edge.
 */
export function applyPlacement(content: THREE.Object3D, sceneRoot: THREE.Object3D, placement: Placement) {
  if (placement === 'flat') {
    // Scenes are authored Y-up; turning them 90° about X stands them on the print.
    content.rotation.set(Math.PI / 2, 0, 0)
    content.position.set(0, 0, 0)
  } else {
    // The editor's wall square (centre at y 0.5, z -0.5) onto the print's centre.
    content.rotation.set(0, 0, 0)
    content.position.set(0, -0.5, 0.5)
  }
  sceneRoot.traverse((o) => {
    if (o.userData.onMarker) placeOnMarker(o, placement)
  })
}

/**
 * Media "on the marker": authored on the wall square (x, y, rotation about z).
 * Flat: the same spot on the print, i.e. the floor at z = 0.5 - y, lying face up.
 */
function placeOnMarker(node: THREE.Object3D, placement: Placement) {
  const wall = (node.userData.wallPose ??= { position: node.position.clone(), rotation: node.rotation.clone() }) as {
    position: THREE.Vector3
    rotation: THREE.Euler
  }
  if (placement === 'vertical') {
    node.position.copy(wall.position)
    node.rotation.copy(wall.rotation)
  } else {
    node.position.set(wall.position.x, 0.004, 0.5 - wall.position.y)
    node.rotation.set(-Math.PI / 2, 0, wall.rotation.z)
  }
}
