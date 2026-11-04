import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { addFace, bouncyText, cloudShape, puffy, sparkles, type Animated } from '../look/bubblegum'
import { inflateShapes } from '../look/inflate'
import { chrome, clay, glass, mulberry32 } from '../look/materials'
import { collageLetterCanvas, imageCanvas, INK, stickerFromCanvas, TREATMENTS } from '../look/sticker'
import type { Motion } from './motions'
import { blankToy, COLLAGE, heartShape, liquidBlob, loadEmoji, loadFont, loadStickerFont } from '../look/worlds'

/*
 * InStudio's library: everything a person can place in a scene, browsable by
 * type and by style (docs/design/art-direction.md). Styles are an open list:
 * the three worlds are only the first collections, and an item can carry
 * several styles. All of it is made in code from the look-test recipes, so
 * it costs no downloads.
 *
 * Every builder returns an object standing on y = 0, centred on x = z = 0,
 * in marker widths (1 = the printed marker, ~15 cm). The scene's transform
 * (move, turn, size) is applied on top by the scene builder.
 */

export type ItemType = 'object' | 'character' | 'sticker'

export interface Built {
  object: THREE.Object3D
  /** Idle animation; `t` is seconds since the object was built. */
  update?(t: number): void
}

export interface LibraryItem {
  id: string
  type: ItemType
  /** Keys of STYLES; any number, so items can sit in several collections. */
  styles: string[]
  /** Free words for search later ("heart", "shiny"…). */
  tags: string[]
  name: string
  /** Asset metadata (3d-assets skill): materials used, and Nico's approval. */
  materials: string[]
  approved: boolean
  /** The motion it gets when placed (people can change it). */
  motion?: Motion
  build(): Promise<Built> | Built
}

/** Style collections, in display order. Add new ones here; nothing else assumes three. */
export const STYLES: Record<string, { label: string }> = {
  streetwear: { label: 'Streetwear' },
  bubblegum: { label: 'Bubblegum Pop' },
  designers: { label: 'Designers' },
}

// ---------------------------------------------------------------- 3D text

export const TEXT_STYLES = {
  'sharp-chrome': { styles: ['streetwear'], name: 'Sharp chrome' },
  'liquid-chrome': { styles: ['streetwear'], name: 'Liquid chrome' },
  candy: { styles: ['bubblegum'], name: 'Candy balloon' },
  foil: { styles: ['bubblegum', 'streetwear'], name: 'Foil balloon' },
  collage: { styles: ['designers'], name: 'Collage' },
} as const satisfies Record<string, { styles: readonly string[]; name: string }>

export type TextStyle = keyof typeof TEXT_STYLES
export const TEXT_STYLE_IDS = Object.keys(TEXT_STYLES) as TextStyle[]
export const MAX_TEXT_CHARS = 12

const TEXT_HEIGHT = 0.22
const TEXT_MAX_WIDTH = 0.95

/** Scales an object to the text box and stands it centred on the ground. */
function fitAndGround(obj: THREE.Object3D, height = TEXT_HEIGHT, maxWidth = TEXT_MAX_WIDTH) {
  const box = new THREE.Box3().setFromObject(obj)
  const size = box.getSize(new THREE.Vector3())
  const s = Math.min(height / Math.max(size.y, 1e-6), maxWidth / Math.max(size.x, 1e-6))
  obj.scale.multiplyScalar(s)
  ground(obj)
  return obj
}

/** Moves an object so it stands on y = 0, centred on x = z = 0. */
function ground(obj: THREE.Object3D) {
  obj.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(obj)
  const c = box.getCenter(new THREE.Vector3())
  obj.position.x -= c.x
  obj.position.z -= c.z
  obj.position.y -= box.min.y
  return obj
}

/** A wrapper group, so idle animations can move the inside freely. */
function wrap(inner: THREE.Object3D, update?: (t: number) => void): Built {
  const outer = new THREE.Group()
  outer.add(inner)
  return { object: outer, update }
}

export async function buildText(text: string, style: TextStyle): Promise<Built> {
  const word = text.trim().slice(0, MAX_TEXT_CHARS) || 'InRL'

  if (style === 'sharp-chrome' || style === 'liquid-chrome') {
    const liquid = style === 'liquid-chrome'
    const font = await loadFont(liquid ? 'TitanOne-Regular' : 'UnifrakturCook-Bold')
    const shapes = font.generateShapes(word, 1)
    const geo = liquid
      ? inflateShapes(shapes, { step: 0.035, puff: 0.7 })
      : new THREE.ExtrudeGeometry(shapes, { depth: 0.22, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.03, bevelSegments: 4 })
    return wrap(fitAndGround(new THREE.Mesh(geo, chrome())))
  }

  if (style === 'candy' || style === 'foil') {
    const font = await loadFont('TitanOne-Regular')
    const letters = bouncyText(font, word, style === 'foil')
    const fit = Math.min(TEXT_HEIGHT / letters.height, TEXT_MAX_WIDTH / letters.width)
    letters.object.scale.setScalar(fit)
    letters.object.position.y = 0.012
    const group = new THREE.Group()
    group.add(letters.object)
    const w = letters.width * fit
    const sp = sparkles(Math.min(9, 3 + word.length), new THREE.Vector3(0, TEXT_HEIGHT * 0.7, 0.08), new THREE.Vector3(w + 0.1, TEXT_HEIGHT * 1.3, 0.12), word.length + 3)
    group.add(sp.object)
    return { object: group, update: (t) => (letters.update(t), sp.update(t)) }
  }

  // Designers collage: each letter its own illustrated cut-out.
  await loadStickerFont()
  const rand = mulberry32([...word].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7))
  const letters = new THREE.Group()
  let x = 0
  ;[...word].filter((ch) => ch !== ' ').forEach((raw, i) => {
    const ch = raw.toUpperCase()
    const treatment = TREATMENTS[i % TREATMENTS.length]
    const [base, accent] = treatment === 'mural' ? [INK, '#ffffff'] : COLLAGE[i % COLLAGE.length]
    const edgeColor = treatment === 'mural' ? '#2a2730' : '#' + new THREE.Color(base).multiplyScalar(0.6).getHexString()
    const size = 0.3 * (0.9 + rand() * 0.2)
    const sticker = stickerFromCanvas(collageLetterCanvas(ch, 'Bungee', treatment, base, accent), { height: size, depth: 0.035, edgeColor })
    sticker.geometry.computeBoundingBox()
    const bb = sticker.geometry.boundingBox!
    const w = bb.max.x - bb.min.x
    // Overlapping neighbours sit on alternating layers so they never cut through each other.
    sticker.position.set(x + w / 2, (rand() - 0.5) * 0.035, (i % 2) * 0.05)
    sticker.rotation.z = (rand() - 0.5) * 0.22
    x += w * 0.9
    letters.add(sticker)
  })
  return wrap(fitAndGround(letters, TEXT_HEIGHT * 1.15))
}

// ---------------------------------------------------------------- objects

function starShape(points = 5, outer = 1, inner = 0.48) {
  const s = new THREE.Shape()
  for (let i = 0; i <= points * 2; i++) {
    const r = i % 2 ? inner : outer
    const a = Math.PI / 2 + (i * Math.PI) / points
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  return s
}

/** Soft retro CRT (Designers, deck slide 15): lilac satin body, glossy dark screen. */
function softTv() {
  const g = new THREE.Group()
  const satin = new THREE.MeshPhysicalMaterial({ color: '#b9a8ff', roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color('#ffffff') })
  const body = new THREE.Mesh(new RoundedBoxGeometry(0.26, 0.21, 0.2, 5, 0.045), satin)
  body.position.y = 0.105 + 0.03
  const screen = new THREE.Mesh(
    new RoundedBoxGeometry(0.19, 0.145, 0.02, 4, 0.03),
    new THREE.MeshPhysicalMaterial({ color: '#2b2350', roughness: 0.08, clearcoat: 1, emissive: '#5a4bd6', emissiveIntensity: 0.35 }),
  )
  screen.position.set(-0.015, 0.135, 0.097)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), new THREE.MeshPhysicalMaterial({ color: '#ff8fd0', roughness: 0.3, clearcoat: 1 }))
  knob.position.set(0.105, 0.17, 0.1)
  const knob2 = knob.clone()
  knob2.position.y = 0.12
  const feet = [-1, 1].map((sx) => {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.03, 16), satin)
    f.position.set(sx * 0.08, 0.015, 0)
    return f
  })
  g.add(body, screen, knob, knob2, ...feet)
  return g
}

/** Soft bottle (Designers): a lathe-turned lilac bottle with a pink cap. */
function softBottle() {
  const pts = [
    [0, 0], [0.055, 0], [0.065, 0.01], [0.068, 0.04], [0.068, 0.15], [0.06, 0.18], [0.035, 0.21], [0.028, 0.23], [0.028, 0.245], [0, 0.245],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), new THREE.MeshPhysicalMaterial({ color: '#9fb4ff', roughness: 0.35, clearcoat: 0.6, sheen: 0.3 }))
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.045, 32), new THREE.MeshPhysicalMaterial({ color: '#ff8fd0', roughness: 0.4, clearcoat: 0.5 }))
  cap.position.y = 0.26
  g.add(body, cap)
  return g
}

function chromeTorus() {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.032, 32, 96), chrome())
  ring.position.y = 0.12
  return ring
}

function nightToy() {
  // Streetwear designer toy: matte black vinyl with chrome ears.
  const toy = blankToy(null, new THREE.MeshPhysicalMaterial({ color: '#16161a', roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.4 }))
  const mat = chrome()
  toy.traverse((o) => {
    if (o instanceof THREE.Mesh && o.geometry instanceof THREE.SphereGeometry && o.geometry.parameters.radius < 0.05) o.material = mat
  })
  return toy
}

async function emojiSticker(code: string, edgeColor: string): Promise<Built> {
  const img = await loadEmoji(code)
  const s = stickerFromCanvas(imageCanvas(img), { height: 0.16, depth: 0.03, edgeColor })
  return wrap(ground(s))
}

const STICKERS: [string, string, string][] = [
  ['1f525', 'Fire', '#c94d12'],
  ['2728', 'Sparkles', '#c98a00'],
  ['1f440', 'Eyes', '#6b6b78'],
  ['270c', 'Peace', '#c98a2e'],
  ['2b50', 'Star', '#c98a00'],
  ['1f426', 'Bird', '#4a4a55'],
]

export const LIBRARY: LibraryItem[] = [
  // Streetwear: chrome + glass
  { id: 'chrome-blob', type: 'object', styles: ['streetwear'], tags: ['liquid', 'blob'], name: 'Liquid blob', materials: ['chrome'], approved: false, build: () => {
    const m = new THREE.Mesh(liquidBlob(), chrome())
    m.scale.setScalar(0.1)
    m.position.y = 0.13
    return wrap(m)
  }, motion: 'spin' },
  { id: 'glass-crystal', type: 'object', styles: ['streetwear'], tags: ['crystal'], name: 'Crystal', materials: ['glass'], approved: false, build: () => {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glass())
    m.scale.set(0.9, 1.6, 0.9)
    m.position.y = 0.17
    return wrap(m)
  }, motion: 'spin' },
  { id: 'chrome-heart', type: 'object', styles: ['streetwear'], tags: ['chrome', 'heart'], name: 'Chrome heart', materials: ['chrome'], approved: false, build: () => {
    const m = puffy(heartShape(), chrome())
    m.scale.setScalar(0.11)
    m.position.y = 0.01
    return wrap(m)
  }, motion: 'sway' },
  { id: 'chrome-ring', type: 'object', styles: ['streetwear'], tags: ['chrome', 'ring'], name: 'Chrome ring', materials: ['chrome'], approved: false, build: () => wrap(chromeTorus()), motion: 'spin' },
  { id: 'night-toy', type: 'character', styles: ['streetwear'], tags: ['night', 'toy'], name: 'Night toy', materials: ['vinyl', 'chrome'], approved: false, build: () => wrap(nightToy()) },

  // Bubblegum: clay + inflated
  { id: 'clay-star', type: 'object', styles: ['bubblegum'], tags: ['clay', 'star'], name: 'Clay star', materials: ['clay'], approved: false, build: () => {
    const m = puffy(starShape(), clay('#ffc93d'))
    m.scale.setScalar(0.12)
    return wrap(m)
  }, motion: 'sway' },
  { id: 'clay-heart', type: 'object', styles: ['bubblegum'], tags: ['clay', 'heart'], name: 'Clay heart', materials: ['clay'], approved: false, build: () => {
    const m = puffy(heartShape(), clay('#ff5f8f'))
    m.scale.setScalar(0.11)
    return wrap(m)
  }, motion: 'sway' },
  { id: 'heart-buddy', type: 'character', styles: ['bubblegum'], tags: ['heart', 'buddy'], name: 'Heart buddy', materials: ['clay'], approved: false, build: () => {
    const m = puffy(heartShape(), clay('#ff5f8f'))
    m.scale.setScalar(0.11)
    const face = addFace(m, { eyeY: 1.3, eyeGap: 0.36, eyeR: 0.2, mouthY: 0.92, mouthR: 0.2 })
    return wrap(m, (t) => face.update(t))
  }, motion: 'sway' },
  { id: 'cloud-buddy', type: 'character', styles: ['bubblegum'], tags: ['cloud', 'buddy'], name: 'Cloud buddy', materials: ['clay'], approved: false, build: () => {
    const m = puffy(cloudShape(), clay('#8ccfff'))
    m.scale.setScalar(0.15)
    const face: Animated = addFace(m, { eyeY: 0.78, eyeGap: 0.3, eyeR: 0.16, mouthY: 0.5, mouthR: 0.15 })
    return wrap(m, (t) => face.update(t))
  }, motion: 'float' },

  // Designers: soft tech, custom texture
  { id: 'soft-tv', type: 'object', styles: ['designers'], tags: ['soft', 'tv'], name: 'Soft TV', materials: ['satin'], approved: false, build: () => wrap(softTv()) },
  { id: 'soft-bottle', type: 'object', styles: ['designers'], tags: ['soft', 'bottle'], name: 'Soft bottle', materials: ['satin'], approved: false, build: () => wrap(softBottle()) },
  { id: 'blank-toy', type: 'character', styles: ['designers'], tags: ['blank', 'toy'], name: 'Blank toy', materials: ['custom-texture'], approved: false, build: () => wrap(blankToy(null)) },

  ...STICKERS.map(([code, name, edge]): LibraryItem => ({
    id: `sticker-${code}`, type: 'sticker', styles: ['designers'], tags: ['emoji', name.toLowerCase()], name, materials: ['cut-out'], approved: false,
    build: () => emojiSticker(code, edge),
  })),
]

export const libraryItem = (id: string) => LIBRARY.find((i) => i.id === id)

export async function buildItem(id: string): Promise<Built> {
  const item = libraryItem(id)
  if (!item) throw new Error(`Unknown library item "${id}"`)
  return item.build()
}
