import * as THREE from 'three'
import type { Font } from 'three/addons/loaders/FontLoader.js'
import { inflateShapes } from './inflate'
import { balloon } from './materials'
import { chaikin, simplify, traceContours } from './sticker'

/*
 * Bubblegum character (deck slides 12–13): every letter its own candy
 * balloon that bobs and squishes, twinkling sparkles, and clay characters
 * with googly eyes and a smile.
 */

export interface Animated {
  object: THREE.Object3D
  update(t: number): void
}

/** [light top, base] per letter: pink, lilac, sky, butter, mint. */
const CANDY: [string, string][] = [
  ['#ffd0e8', '#ff4fa3'],
  ['#ead9ff', '#a46bff'],
  ['#d3f2ff', '#3fb6ff'],
  ['#fff3c4', '#ffae3d'],
  ['#d1f8e6', '#2fcf98'],
]

/**
 * Balloon letters, one mesh each, standing on y = 0 and centred on x = 0, in
 * font units (cap height ≈ 0.7). Scale the returned group to fit.
 */
export function bouncyText(font: Font, text: string, foil: boolean): Animated & { width: number; height: number } {
  const group = new THREE.Group()
  const data = font.data as { resolution: number; glyphs: Record<string, { ha: number }> }
  const letters: { mesh: THREE.Mesh; phase: number; tilt: number }[] = []
  let x = 0
  let height = 0
  const chars = [...text]
  chars.forEach((ch, i) => {
    const glyph = data.glyphs[ch] ?? data.glyphs['?']
    const advance = (glyph?.ha ?? 500) / data.resolution
    if (ch.trim() && glyph) {
      const geo = inflateShapes(font.generateShapes(ch, 1), { step: 0.03, puff: 0.95 })
      geo.computeBoundingBox()
      const b = geo.boundingBox!
      if (!b.isEmpty()) {
        const cx = (b.min.x + b.max.x) / 2
        geo.translate(-cx, -b.min.y, 0)
        const [top, base] = CANDY[i % CANDY.length]
        paintVertical(geo, top, base)
        const mesh = new THREE.Mesh(geo, balloon(foil))
        mesh.position.x = x + cx
        // Alternate slightly forward/back so touching balloons squash into each other, not flicker.
        mesh.position.z = (i % 2) * 0.06
        const tilt = Math.sin(i * 2.3 + 1) * 0.08
        mesh.rotation.z = tilt
        group.add(mesh)
        letters.push({ mesh, phase: i * 0.7, tilt })
        height = Math.max(height, b.max.y - b.min.y)
      }
    }
    x += advance * 0.92
  })
  for (const l of letters) l.mesh.position.x -= x / 2
  return {
    object: group,
    width: x,
    height,
    update(t) {
      for (const { mesh, phase, tilt } of letters) {
        const s = Math.sin(t * 2.4 + phase)
        // Hop, then squash on landing: volume roughly kept.
        mesh.position.y = Math.max(0, s) * 0.05
        const squash = 1 + Math.min(0, s) * 0.06
        mesh.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash))
        mesh.rotation.z = tilt + Math.sin(t * 1.3 + phase) * 0.03
      }
    },
  }
}

/** Vertical two-tone candy gradient (vertex colours), lighter at the top. */
function paintVertical(geo: THREE.BufferGeometry, top: string, base: string) {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  const pos = geo.getAttribute('position')
  const c0 = new THREE.Color(base)
  const c1 = new THREE.Color(top)
  const tmp = new THREE.Color()
  const colors = new Float32Array(pos.count * 3)
  const span = b.max.y - b.min.y || 1
  for (let i = 0; i < pos.count; i++) {
    const t = 0.75 * THREE.MathUtils.smoothstep((pos.getY(i) - b.min.y) / span, 0.3, 1.1)
    tmp.copy(c0).lerp(c1, t)
    colors.set([tmp.r, tmp.g, tmp.b], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

let sparkleTex: THREE.Texture | null = null

/** Four-point twinkles scattered around a box (centre, size), in its parent's units. */
export function sparkles(count: number, center: THREE.Vector3, size: THREE.Vector3, seed = 1): Animated {
  sparkleTex ??= makeSparkleTexture()
  const group = new THREE.Group()
  const items: { s: THREE.Sprite; base: number; phase: number }[] = []
  let r = seed
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({ map: sparkleTex, transparent: true, depthWrite: false, color: i % 3 === 0 ? 0xfff0fa : 0xffffff })
    const s = new THREE.Sprite(mat)
    s.position.set(center.x + (rand() - 0.5) * size.x, center.y + (rand() - 0.5) * size.y, center.z + (rand() - 0.5) * size.z)
    const base = 0.05 + rand() * 0.05
    s.scale.setScalar(base)
    group.add(s)
    items.push({ s, base, phase: rand() * 10 })
  }
  return {
    object: group,
    update(t) {
      for (const { s, base, phase } of items) {
        const k = Math.max(0, Math.sin(t * 2.2 + phase))
        s.scale.setScalar(base * (0.25 + 0.75 * k * k))
        s.material.rotation = t * 0.6 + phase
      }
    },
  }
}

function makeSparkleTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const glow = g.createRadialGradient(64, 64, 0, 64, 64, 60)
  glow.addColorStop(0, 'rgba(255,255,255,0.9)')
  glow.addColorStop(0.25, 'rgba(255,220,245,0.35)')
  glow.addColorStop(1, 'rgba(255,220,245,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, 128, 128)
  g.fillStyle = '#fff'
  g.beginPath()
  g.moveTo(64, 2)
  g.quadraticCurveTo(70, 58, 126, 64)
  g.quadraticCurveTo(70, 70, 64, 126)
  g.quadraticCurveTo(58, 70, 2, 64)
  g.quadraticCurveTo(58, 58, 64, 2)
  g.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.userData.shared = true
  return tex
}

/** A puffy cloud outline (union of circles), in units about 2 wide, base on y = 0. */
export function cloudShape() {
  const W = 220
  const H = 140
  const blobs: [number, number, number][] = [
    [62, 84, 38], [104, 56, 50], [150, 66, 40], [178, 92, 28], [40, 100, 24], [110, 96, 40], [150, 100, 30],
  ]
  const mask = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 < br * br)) mask[y * W + x] = 1
  }
  const loops = traceContours(mask, W, H)
  const outline = chaikin(simplify(loops.reduce((a, b) => (b.length > a.length ? b : a)), 0.8), 2)
  const k = 2 / W
  const pts = outline.map(([x, y]) => new THREE.Vector2((x - W / 2) * k, (H - y) * k))
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse()
  return new THREE.Shape(pts)
}

/** Inflates a shape and stands it on y = 0, centred. */
export function puffy(shape: THREE.Shape, material: THREE.Material, step = 0.05) {
  const geo = inflateShapes([shape], { step, puff: 0.9 })
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, 0)
  return new THREE.Mesh(geo, material)
}

const eyeWhite = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })
const pupilMat = () => new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.15, clearcoat: 1 })

/**
 * Googly eyes and a smile stuck on the front of a mesh (deck slide 12).
 * Positions are in the mesh's own geometry units; the face is placed on the
 * surface found by casting a ray at the front. Pupils wobble, eyes blink.
 */
export function addFace(mesh: THREE.Mesh, { eyeY, eyeGap, eyeR, mouthY, mouthR }: { eyeY: number; eyeGap: number; eyeR: number; mouthY: number; mouthR: number }): Animated {
  const probe = new THREE.Mesh(mesh.geometry)
  const ray = new THREE.Raycaster()
  const surfaceZ = (x: number, y: number) => {
    ray.set(new THREE.Vector3(x, y, 10), new THREE.Vector3(0, 0, -1))
    return ray.intersectObject(probe)[0]?.point.z ?? 0
  }
  const face = new THREE.Group()
  const eyes: { white: THREE.Mesh; pupil: THREE.Mesh; k: number }[] = []
  for (const side of [-1, 1]) {
    const x = side * eyeGap
    const z = surfaceZ(x, eyeY)
    const white = new THREE.Mesh(new THREE.SphereGeometry(eyeR, 24, 16), eyeWhite())
    white.scale.z = 0.55
    white.position.set(x, eyeY, z + eyeR * 0.15)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(eyeR * 0.52, 16, 12), pupilMat())
    pupil.scale.z = 0.4
    pupil.position.set(x, eyeY, z + eyeR * 0.55)
    face.add(white, pupil)
    eyes.push({ white, pupil, k: side })
  }
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(mouthR, mouthR * 0.22, 10, 24, Math.PI),
    new THREE.MeshPhysicalMaterial({ color: 0x5a1236, roughness: 0.35, clearcoat: 0.6 }),
  )
  mouth.rotation.z = Math.PI // arc pointing down: a smile
  mouth.position.set(0, mouthY, surfaceZ(0, mouthY) + mouthR * 0.1)
  face.add(mouth)
  mesh.add(face)
  return {
    object: face,
    update(t) {
      const blink = (t % 4.2) < 0.13 ? 0.12 : 1
      for (const { white, pupil, k } of eyes) {
        white.scale.y = blink
        pupil.visible = blink === 1
        // Googly wobble: pupils roll around inside the eye.
        const a = t * 1.7 + Math.sin(t * 0.9) * 2
        pupil.position.x = white.position.x + Math.cos(a + k * 0.3) * eyeR * 0.3
        pupil.position.y = white.position.y + Math.sin(a * 1.3) * eyeR * 0.25 - eyeR * 0.1
      }
    },
  }
}
