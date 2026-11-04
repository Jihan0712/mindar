import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { PlacementTracker } from './placement'

// Camera space: camera at the origin looking down -z, y up the screen.
// A marker 0.5 m in front of the camera whose face is tilted `tiltDeg` from
// horizontal (0 = lying flat, 90 = upright), seen from `viewDeg` above.
function pose(tiltDeg: number, viewDeg = 30) {
  const rad = THREE.MathUtils.degToRad
  // Face normal: up for a flat marker, towards the camera for an upright one.
  const normal = new THREE.Vector3(0, Math.cos(rad(tiltDeg)), Math.sin(rad(tiltDeg)))
  const pos = new THREE.Vector3(0, -Math.sin(rad(viewDeg)), -Math.cos(rad(viewDeg))).multiplyScalar(0.5)
  const x = new THREE.Vector3(1, 0, 0)
  const y = new THREE.Vector3().crossVectors(normal, x)
  return new THREE.Matrix4().makeBasis(x, y, normal).setPosition(pos)
}
const UP = new THREE.Vector3(0, 1, 0)

function run(t: PlacementTracker, m: THREE.Matrix4, fromMs: number, ms: number) {
  for (let now = fromMs; now <= fromMs + ms; now += 16) t.update(m, UP, now)
  return fromMs + ms + 16
}

describe('PlacementTracker', () => {
  it('stands the scene upright quickly on a wall print, and keeps a flat print flat', () => {
    const wall = new PlacementTracker()
    run(wall, pose(90, 10), 0, 600)
    expect(wall.placement).toBe('vertical')
    const table = new PlacementTracker()
    run(table, pose(5, 45), 0, 600)
    expect(table.placement).toBe('flat')
  })

  it('treats a laptop screen leaning back 35° as vertical', () => {
    const t = new PlacementTracker()
    run(t, pose(55, 10), 0, 800)
    expect(t.placement).toBe('vertical')
  })

  it('does not flip on a brief bad reading', () => {
    const t = new PlacementTracker()
    let now = run(t, pose(85, 10), 0, 800)
    now = run(t, pose(5, 10), now, 300) // pose glitch for 0.3 s
    run(t, pose(85, 10), now, 800)
    expect(t.placement).toBe('vertical')
  })

  it('ignores readings when the marker is seen at a steep angle', () => {
    const t = new PlacementTracker()
    let now = run(t, pose(88, 5), 0, 800)
    // Looking at the wall print almost edge-on: a bogus "flat" pose for 2 s.
    const steep = pose(10, 0)
    steep.makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)).setPosition(0, 0, -0.5)
    now = run(t, steep, now, 2000)
    expect(t.placement).toBe('vertical')
  })

  it('switches when a marker is really moved from the wall to a table', () => {
    const t = new PlacementTracker()
    const now = run(t, pose(90, 10), 0, 800)
    run(t, pose(5, 45), now, 2000)
    expect(t.placement).toBe('flat')
  })
})
