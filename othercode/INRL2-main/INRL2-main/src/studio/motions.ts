import * as THREE from 'three'

/*
 * Object motions (InStudio piece 3b): small, looping movements anyone can
 * give an object. The same seven for every style. They play everywhere the
 * scene is drawn (editor, AR, later the feed), on a group between the
 * object's own transform and the object, so they never change where the
 * object was placed.
 *
 * `up` is the object's "out of its base" axis: y for things standing in the
 * scene, z for photos and videos lying on the marker (so they spin flat and
 * hop off the print instead of tipping over).
 */

export const MOTIONS = ['none', 'spin', 'float', 'bounce', 'pulse', 'sway', 'orbit'] as const
export type Motion = (typeof MOTIONS)[number]

export const MOTION_LABELS: Record<Motion, string> = {
  none: 'None',
  spin: 'Spin',
  float: 'Float',
  bounce: 'Bounce',
  pulse: 'Pulse',
  sway: 'Sway',
  orbit: 'Orbit',
}

/** A different start for each object (from its id), so several don't move in lockstep. */
export const motionPhase = (id: string) => ([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11) % 1000) / 1000 * Math.PI * 2

/**
 * Sets `g`'s position / rotation / scale for motion `m` at time `t` (s).
 * Sizes are in the object's own units (marker widths before its scale).
 */
export function applyMotion(g: THREE.Object3D, m: Motion, t: number, up: 'y' | 'z' = 'y', phase = 0) {
  g.position.set(0, 0, 0)
  g.rotation.set(0, 0, 0)
  g.scale.set(1, 1, 1)
  const s = t + phase
  const side = up === 'y' ? 'z' : 'y' // the axis a rocking object tilts about
  switch (m) {
    case 'spin':
      g.rotation[up] = s * 0.7 // ~9 s per turn
      break
    case 'float':
      g.position[up] = 0.025 * (1 + Math.sin(s * 1.6))
      break
    case 'bounce': {
      // Hops 0.06 high, with a little squash when it lands.
      const h = Math.abs(Math.sin(s * 2.4))
      g.position[up] = 0.06 * h
      const squash = 0.08 * Math.pow(1 - h, 6)
      g.scale[up] = 1 - squash
      const other = up === 'y' ? (['x', 'z'] as const) : (['x', 'y'] as const)
      for (const a of other) g.scale[a] = 1 + squash * 0.5
      break
    }
    case 'pulse':
      g.scale.setScalar(1 + 0.06 * Math.sin(s * 2.6))
      break
    case 'sway':
      // Turns gently left and right, with a slight rock.
      g.rotation[up] = 0.4 * Math.sin(s * 0.9)
      g.rotation[side] = 0.06 * Math.sin(s * 1.8)
      break
    case 'orbit': {
      // Circles its spot, 0.08 away, about every 8 s.
      const a = s * 0.8
      if (up === 'y') g.position.set(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08)
      else g.position.set(Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0)
      break
    }
    case 'none':
      break
  }
}
