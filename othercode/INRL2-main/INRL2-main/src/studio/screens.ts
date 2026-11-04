import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { chrome } from '../look/materials'

/*
 * What a photo or video sits in (InStudio piece 2). `face` is the picture's
 * material, `w` × `h` its size in marker widths. Screens and floating cards
 * stand on y = 0 facing +z; "on the marker" is a flat print centred on the
 * origin in the x/y plane (the scene builder puts it on the marker).
 */

export type MediaDisplay = 'screen' | 'floating' | 'marker'
export type ScreenType = 'frame' | 'chrome' | 'phone' | 'tablet' | 'flat-tv' | 'laptop' | 'tv' | 'polaroid'

export const SCREEN_LABELS: Record<ScreenType, string> = {
  frame: 'Gallery frame',
  chrome: 'Chrome',
  phone: 'Phone',
  tablet: 'Tablet',
  'flat-tv': 'Flat TV',
  laptop: 'Laptop',
  tv: 'Retro TV',
  polaroid: 'Polaroid',
}

const aluminium = () => new THREE.MeshPhysicalMaterial({ color: '#c9cdd2', metalness: 0.85, roughness: 0.32, clearcoat: 0.3 })
const glossBlack = () => new THREE.MeshPhysicalMaterial({ color: '#141418', roughness: 0.25, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.08 })

/** A rounded rectangle with 0–1 UVs across it, centred on the origin. */
export function roundedRect(w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2)
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0)
  s.lineTo(x + w, y + h - r)
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2)
  s.lineTo(x + r, y + h)
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
  s.lineTo(x, y + r)
  s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5)
  const geo = new THREE.ShapeGeometry(s, 8)
  const pos = geo.getAttribute('position')
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h)
  return geo
}

const satin = (color: string) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') })

export function mediaBody(display: MediaDisplay, screen: ScreenType, w: number, h: number, face: THREE.Material): THREE.Group {
  const g = new THREE.Group()
  const m = Math.min(w, h)

  if (display === 'marker') {
    // A print lying on the marker: thin white border, the picture on top.
    const border = m * 0.03
    // The picture must always win over its paper, at any viewing angle: it
    // sits a little above it AND is pulled towards the camera in depth. (The
    // paper used to be the one pulled forward; seen at a steep angle that
    // pull grew larger than the gap and the paper covered the video.)
    const paper = new THREE.Mesh(roundedRect(w + border * 2, h + border * 2, m * 0.04), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }))
    const pic = new THREE.Mesh(roundedRect(w, h, m * 0.025), face)
    face.polygonOffset = true
    face.polygonOffsetFactor = -2
    face.polygonOffsetUnits = -2
    pic.position.z = 0.004
    pic.renderOrder = 1
    g.add(paper, pic)
    return g
  }

  if (display === 'floating') {
    // A thin card with a white back, standing on its bottom edge (lift it to float).
    const d = 0.01
    const card = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(m * 0.05, d / 2)), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }))
    card.position.y = h / 2
    const pic = new THREE.Mesh(roundedRect(w, h, m * 0.05), face)
    pic.position.set(0, h / 2, d / 2 + 0.001)
    g.add(card, pic)
    return g
  }

  // On a screen.
  let bw = w
  let bh = h
  let depth: number
  let body: THREE.Mesh
  let faceX = 0
  let faceY: number
  let radius = m * 0.02
  if (screen === 'phone') {
    const b = m * 0.05
    bw = w + b * 2
    bh = h + b * 3.2
    depth = m * 0.08
    body = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 4, m * 0.12), glossBlack())
    faceY = bh / 2
    radius = m * 0.09
    const pill = new THREE.Mesh(roundedRect(w * 0.3, b * 0.9, b * 0.45), new THREE.MeshBasicMaterial({ color: '#000000' }))
    pill.position.set(0, bh - b * 1.1, depth / 2 + 0.0015)
    g.add(pill)
  } else if (screen === 'tablet') {
    // Even bezel, aluminium body, a small camera dot.
    const b = m * 0.06
    bw = w + b * 2
    bh = h + b * 2
    depth = m * 0.05
    body = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 4, m * 0.07), aluminium())
    const glass = new THREE.Mesh(roundedRect(bw - b * 0.4, bh - b * 0.4, m * 0.06), new THREE.MeshBasicMaterial({ color: '#0b0b0e' }))
    glass.position.set(0, bh / 2, depth / 2 + 0.0008)
    const cam = new THREE.Mesh(new THREE.CircleGeometry(b * 0.18, 16), new THREE.MeshBasicMaterial({ color: '#2a2d35' }))
    cam.position.set(0, bh - b / 2, depth / 2 + 0.0012)
    g.add(glass, cam)
    faceY = bh / 2
    radius = m * 0.03
  } else if (screen === 'flat-tv') {
    // Slim black TV on a pedestal.
    const b = m * 0.025
    bw = w + b * 2
    bh = h + b * 2.4
    depth = m * 0.035
    const lift = Math.max(m * 0.16, 0.03)
    body = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 2, Math.min(b, depth / 2.5)), glossBlack())
    body.position.y = lift + bh / 2
    const neck = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.08, lift + bh * 0.2, depth * 0.8), aluminium())
    neck.position.set(0, (lift + bh * 0.2) / 2, -depth * 0.6)
    const foot = new THREE.Mesh(new RoundedBoxGeometry(bw * 0.38, m * 0.02, m * 0.22, 2, m * 0.008), aluminium())
    foot.position.set(0, m * 0.01, -depth * 0.6)
    g.add(neck, foot)
    faceY = lift + bh / 2 + b * 0.2
    radius = 0.001
  } else if (screen === 'laptop') {
    // Open laptop: the screen leans back from a hinge at the back of the keyboard base.
    const b = m * 0.045
    bw = w + b * 2
    bh = h + b * 2.6
    depth = m * 0.025
    const baseD = bh * 0.72
    const baseT = m * 0.035
    const base = new THREE.Mesh(new RoundedBoxGeometry(bw, baseT, baseD, 2, baseT / 2.5), aluminium())
    base.position.set(0, baseT / 2, baseD / 2 - baseD * 0.15)
    const keys = new THREE.Mesh(roundedRect(bw * 0.86, baseD * 0.42, m * 0.01), new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.8 }))
    keys.rotation.x = -Math.PI / 2
    keys.position.set(0, baseT + 0.0008, baseD * 0.12)
    const pad = new THREE.Mesh(roundedRect(bw * 0.3, baseD * 0.22, m * 0.01), new THREE.MeshStandardMaterial({ color: '#b6bac0', roughness: 0.5 }))
    pad.rotation.x = -Math.PI / 2
    pad.position.set(0, baseT + 0.0008, baseD * 0.46)
    g.add(base, keys, pad)
    // The lid: built upright, then hinged back 14°.
    const lid = new THREE.Group()
    const shell = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 2, Math.min(m * 0.03, depth / 2.5)), aluminium())
    shell.position.y = bh / 2
    const bezel = new THREE.Mesh(roundedRect(bw - b * 0.3, bh - b * 0.3, m * 0.025), new THREE.MeshBasicMaterial({ color: '#0b0b0e' }))
    bezel.position.set(0, bh / 2, depth / 2 + 0.0008)
    const pic = new THREE.Mesh(roundedRect(w, h, 0.001), face)
    pic.position.set(0, bh / 2 + b * 0.3, depth / 2 + 0.0016)
    lid.add(shell, bezel, pic)
    lid.position.set(0, baseT, -baseD * 0.15)
    lid.rotation.x = -0.24
    g.add(lid)
    return g
  } else if (screen === 'polaroid') {
    // Instant photo: white card, wide bottom border, leaning on a small stand.
    const b = m * 0.06
    bw = w + b * 2
    bh = h + b + m * 0.26
    depth = m * 0.012
    body = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 2, depth / 2.5), new THREE.MeshStandardMaterial({ color: '#fbfaf6', roughness: 0.7 }))
    const stand = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.18, bh * 0.6, depth * 1.5), new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 }))
    stand.position.set(0, bh * 0.3, -depth / 2 - bh * 0.1)
    stand.rotation.x = 0.35
    g.add(stand)
    faceY = bh - b - h / 2
    radius = 0.001
  } else if (screen === 'tv') {
    // Soft retro TV (Designers): lilac body, controls panel on the right, feet.
    const b = m * 0.12
    const panel = Math.max(m * 0.22, 0.04)
    bw = w + b * 2 + panel
    bh = h + b * 2
    depth = Math.max(m * 0.5, 0.08)
    const lift = m * 0.07
    body = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 5, Math.min(b * 0.9, depth / 2.2)), satin('#b9a8ff'))
    body.position.y = lift + bh / 2
    faceX = -panel / 2
    faceY = bh / 2 + lift
    radius = m * 0.08
    for (const k of [0.62, 0.38]) {
      const knob = new THREE.Mesh(new THREE.SphereGeometry(panel * 0.22, 16, 12), new THREE.MeshPhysicalMaterial({ color: '#ff8fd0', roughness: 0.3, clearcoat: 1 }))
      knob.position.set(bw / 2 - b * 0.6 - panel * 0.35, lift + bh * k, depth / 2)
      g.add(knob)
    }
    for (const sx of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(lift * 0.6, lift * 0.75, lift, 16), satin('#b9a8ff'))
      foot.position.set(sx * bw * 0.32, lift / 2, 0)
      g.add(foot)
    }
  } else if (screen === 'chrome') {
    const b = m * 0.08
    bw = w + b * 2
    bh = h + b * 2
    depth = m * 0.1
    body = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 5, b * 0.9), chrome())
    faceY = bh / 2
    radius = m * 0.03
  } else {
    // Gallery frame: white frame, off-white mat, a small stand behind.
    const b = m * 0.07
    const mat = m * 0.08
    bw = w + (b + mat) * 2
    bh = h + (b + mat) * 2
    depth = m * 0.05
    body = new THREE.Mesh(new RoundedBoxGeometry(bw, bh, depth, 2, Math.min(b * 0.3, depth / 2.5)), new THREE.MeshStandardMaterial({ color: '#fafafa', roughness: 0.55 }))
    const matte = new THREE.Mesh(roundedRect(w + mat * 2, h + mat * 2, 0.001), new THREE.MeshStandardMaterial({ color: '#f1ede6', roughness: 0.9 }))
    matte.position.set(0, bh / 2, depth / 2 + 0.0008)
    const stand = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.18, bh * 0.7, depth * 0.4), new THREE.MeshStandardMaterial({ color: '#e8e8e8', roughness: 0.6 }))
    stand.position.set(0, bh * 0.35, -depth / 2 - bh * 0.12)
    stand.rotation.x = 0.35
    g.add(matte, stand)
    faceY = bh / 2
    radius = 0.001
  }
  if (!body.position.y) body.position.y = bh / 2
  const pic = new THREE.Mesh(roundedRect(w, h, radius), face)
  pic.position.set(faceX, faceY, depth / 2 + 0.0016)
  g.add(body, pic)
  return g
}
