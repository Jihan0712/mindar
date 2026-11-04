import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyMotion, motionPhase, MOTIONS } from './motions'

describe('object motions', () => {
  const g = new THREE.Group()
  const sample = (m: (typeof MOTIONS)[number], up: 'y' | 'z' = 'y') =>
    Array.from({ length: 400 }, (_, i) => {
      applyMotion(g, m, i / 40, up)
      return { p: g.position.clone(), r: g.rotation.clone(), s: g.scale.clone() }
    })

  it('"none" leaves the object exactly where it was placed', () => {
    for (const f of sample('none')) {
      expect(f.p.length()).toBe(0)
      expect(f.s.x).toBe(1)
    }
  })

  it('never sinks below its base, and never strays far from its spot', () => {
    for (const m of MOTIONS) {
      for (const f of sample(m)) {
        expect(f.p.y).toBeGreaterThanOrEqual(-1e-9)
        expect(Math.hypot(f.p.x, f.p.z)).toBeLessThanOrEqual(0.081)
        expect(f.p.y).toBeLessThanOrEqual(0.061)
      }
    }
  })

  it('moves prints on the marker within the print (spin flat, hop off it)', () => {
    for (const f of sample('spin', 'z')) {
      expect(f.r.x).toBe(0)
      expect(f.r.y).toBe(0)
    }
    for (const f of sample('bounce', 'z')) expect(f.p.z).toBeGreaterThanOrEqual(-1e-9)
  })

  it('starts each object at its own point of the loop', () => {
    expect(motionPhase('a')).not.toBe(motionPhase('b'))
  })
})
