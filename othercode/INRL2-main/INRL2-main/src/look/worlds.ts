import * as THREE from 'three'
import { Font } from 'three/addons/loaders/FontLoader.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { addFace, bouncyText, cloudShape, puffy, sparkles, type Animated } from './bubblegum'
import { inflateShapes } from './inflate'
import { blankToyTexture, chrome, clay, glass, mulberry32 } from './materials'
import { collageLetterCanvas, imageCanvas, INK, stickerFromCanvas, TREATMENTS } from './sticker'

/*
 * The look test: the same word in each world's typography, plus material
 * samples. Units are marker widths (1 = the printed marker, ~15 cm), Y up,
 * standing on y = 0, like every InRL scene.
 */

export type World = 'streetwear' | 'bubblegum' | 'designers'

export const WORLDS: Record<World, { label: string; variants: string[]; background: string; gradient?: string[] }> = {
  streetwear: { label: 'Streetwear', variants: ['Sharp chrome', 'Liquid chrome'], background: '#0d0e12' },
  bubblegum: { label: 'Bubblegum', variants: ['Candy', 'Foil'], background: '#ffd9ec', gradient: ['#ffd3ec', '#e2cdff', '#c4e8ff'] },
  designers: { label: 'Designers', variants: ['Collage'], background: '#17161c' },
}

export interface LookOptions {
  world: World
  variant: string
  text: string
  /** Picture for the blank toy (Designers), e.g. from the photo picker. */
  photo?: HTMLCanvasElement | null
}

export interface LookContent {
  root: THREE.Group
  update(dt: number): void
  dispose(): void
}

export const TEXT_HEIGHT = 0.24
/** Designers collage colours: [base, pattern], bold and printed-looking. */
export const COLLAGE: [string, string][] = [
  ['#2f6bff', '#9fd8ff'],
  ['#e8352b', '#ffffff'],
  ['#ffc53d', '#ff7a00'],
  ['#e8352b', '#ffffff'],
  ['#18c29c', '#eafff7'],
  ['#ff5fb8', '#ffe0f1'],
  ['#2f6bff', '#ffd23f'],
]
export const TEXT_MAX_WIDTH = 0.95
const TEXT_Z = 0.14
const BACK_Z = -0.24

const fonts = new Map<string, Promise<Font>>()
export function loadFont(name: string) {
  if (!fonts.has(name)) {
    fonts.set(name, fetch(`/look/fonts/${name}.json`).then((r) => {
      if (!r.ok) throw new Error(`Font ${name} failed to load`)
      return r.json()
    }).then((json) => new Font(json)))
  }
  return fonts.get(name)!
}

let stickerFont: Promise<void> | null = null
export function loadStickerFont() {
  stickerFont ??= new FontFace('Bungee', 'url(/look/fonts/Bungee-Regular.ttf)').load().then((f) => {
    document.fonts.add(f)
  })
  return stickerFont
}

const emojiCache = new Map<string, Promise<HTMLImageElement>>()
export function loadEmoji(code: string) {
  if (!emojiCache.has(code)) {
    emojiCache.set(code, new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Emoji ${code} failed to load`))
      img.src = `/look/emoji/${code}.png`
    }))
  }
  return emojiCache.get(code)!
}

export async function buildLook(opts: LookOptions): Promise<LookContent> {
  const root = new THREE.Group()
  root.name = `look:${opts.world}`
  const spinners: { obj: THREE.Object3D; speed: number; bob?: number; base?: number; sway?: number }[] = []
  const animated: Animated[] = []
  let t = 0
  const text = opts.text.trim() || 'InRL'

  if (opts.world === 'streetwear') {
    const liquid = opts.variant === 'Liquid chrome'
    const font = await loadFont(liquid ? 'TitanOne-Regular' : 'UnifrakturCook-Bold')
    const shapes = font.generateShapes(text, 1)
    const geo = liquid
      ? inflateShapes(shapes, { step: 0.035, puff: 0.7 })
      : new THREE.ExtrudeGeometry(shapes, { depth: 0.22, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.03, bevelSegments: 4 })
    root.add(placeText(new THREE.Mesh(geo, chrome())))

    const blob = new THREE.Mesh(liquidBlob(), chrome())
    blob.scale.setScalar(0.1)
    blob.position.set(-0.33, 0.17, BACK_Z)
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glass())
    crystal.scale.set(0.9, 1.6, 0.9)
    crystal.position.set(0.33, 0.19, BACK_Z)
    root.add(blob, crystal)
    spinners.push({ obj: blob, speed: 0.35, bob: 0.015, base: 0.17 }, { obj: crystal, speed: -0.5, bob: 0.012, base: 0.19 })
  }

  if (opts.world === 'bubblegum') {
    const font = await loadFont('TitanOne-Regular')
    const word = bouncyText(font, text, opts.variant === 'Foil')
    const fit = Math.min(TEXT_HEIGHT / word.height, TEXT_MAX_WIDTH / word.width)
    word.object.scale.setScalar(fit)
    word.object.position.set(0, 0.012, TEXT_Z)
    root.add(word.object)
    animated.push(word)
    const sp = sparkles(9, new THREE.Vector3(0, 0.17, TEXT_Z + 0.08), new THREE.Vector3(1.05, 0.32, 0.12), text.length + 3)
    root.add(sp.object)
    animated.push(sp)

    // Characters (deck slide 12): a clay heart and a cloud with faces.
    const heart = puffy(heartShape(), clay('#ff5f8f'))
    heart.scale.setScalar(0.11)
    heart.position.set(-0.36, 0.15, BACK_Z)
    animated.push(addFace(heart, { eyeY: 1.3, eyeGap: 0.36, eyeR: 0.2, mouthY: 0.92, mouthR: 0.2 }))
    const cloud = puffy(cloudShape(), clay('#8ccfff'))
    cloud.scale.setScalar(0.15)
    cloud.position.set(0.34, 0.24, BACK_Z)
    animated.push(addFace(cloud, { eyeY: 0.78, eyeGap: 0.3, eyeR: 0.16, mouthY: 0.5, mouthR: 0.15 }))
    root.add(heart, cloud)
    spinners.push({ obj: heart, speed: 0, sway: 0.45, bob: 0.015, base: 0.15 }, { obj: cloud, speed: 0, sway: 0.4, bob: 0.02, base: 0.24 })
  }

  if (opts.world === 'designers') {
    await loadStickerFont()
    const [bird, peace, star] = await Promise.all(['1f426', '270c', '2b50'].map(loadEmoji))
    const rand = mulberry32([...text].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7))
    const letters = new THREE.Group()
    let x = 0
    const chars = [...text].filter((ch) => ch !== ' ')
    chars.forEach((raw, i) => {
      const ch = raw.toUpperCase()
      const treatment = TREATMENTS[i % TREATMENTS.length]
      const [base, accent] = treatment === 'mural' ? [INK, '#ffffff'] : COLLAGE[i % COLLAGE.length]
      const edgeColor = treatment === 'mural' ? '#2a2730' : '#' + new THREE.Color(base).multiplyScalar(0.6).getHexString()
      const size = 0.3 * (0.9 + rand() * 0.2)
      const sticker = stickerFromCanvas(collageLetterCanvas(ch, 'Bungee', treatment, base, accent), { height: size, depth: 0.035, edgeColor })
      sticker.geometry.computeBoundingBox()
      const bb = sticker.geometry.boundingBox!
      const w = bb.max.x - bb.min.x
      // Neighbours overlap a little, so they sit on alternating layers
      // further apart than their thickness and never cut through each other.
      sticker.position.set(x + w / 2, (rand() - 0.5) * 0.035, (i % 2) * 0.05)
      sticker.rotation.z = (rand() - 0.5) * 0.22
      x += w * 0.9
      letters.add(sticker)
    })
    const fit = Math.min(1, TEXT_MAX_WIDTH / Math.max(x, 0.01))
    letters.scale.setScalar(fit)
    letters.position.set((-x * fit) / 2, 0.17, TEXT_Z - 0.03)
    root.add(letters)

    // A bird perched on the first letter, a peace hand and a star around the word.
    const f = letters.children[0] as THREE.Mesh | undefined
    if (f) {
      const b = stickerFromCanvas(imageCanvas(bird), { height: 0.12, depth: 0.03, edgeColor: '#4a4a55' })
      b.position.set(f.position.x + 0.02, f.position.y + f.geometry.boundingBox!.max.y + 0.05, f.position.z + 0.02)
      b.rotation.z = -0.1
      letters.add(b)
    }
    const hand = stickerFromCanvas(imageCanvas(peace), { height: 0.13, depth: 0.03, edgeColor: '#c98a2e' })
    hand.position.set(0.44, 0.08, TEXT_Z + 0.06)
    hand.rotation.z = -0.25
    const st = stickerFromCanvas(imageCanvas(star), { height: 0.09, depth: 0.03, edgeColor: '#c98a00' })
    st.position.set(-0.36, 0.38, BACK_Z + 0.1)
    st.rotation.z = 0.3
    root.add(hand, st)
    spinners.push({ obj: st, speed: 0.8, bob: 0.01, base: 0.38 })

    const toy = blankToy(opts.photo ?? null)
    toy.position.set(0.12, 0, BACK_Z)
    root.add(toy)
    spinners.push({ obj: toy, speed: 0.4 })
  }

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = false
    }
  })

  return {
    root,
    update(dt) {
      t += dt
      for (const s of spinners) {
        if (s.sway) s.obj.rotation.y = Math.sin(t * 0.8 + (s.base ?? 0) * 10) * s.sway
        else s.obj.rotation.y += s.speed * dt
        if (s.bob && s.base !== undefined) s.obj.position.y = s.base + Math.sin(t * 1.6 + s.base * 20) * s.bob
      }
      for (const a of animated) a.update(t)
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const m of mats) {
            for (const v of Object.values(m)) if (v instanceof THREE.Texture && v.userData.shared !== true) v.dispose()
            m.dispose()
          }
        }
      })
    },
  }
}

/** Centres a text mesh, stands it on the ground and fits it to the text box. */
function placeText(mesh: THREE.Mesh) {
  const geo = mesh.geometry
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2)
  const w = b.max.x - b.min.x
  const h = b.max.y - b.min.y
  const s = Math.min(TEXT_HEIGHT / h, TEXT_MAX_WIDTH / w)
  mesh.scale.setScalar(s)
  mesh.position.set(0, 0.012, TEXT_Z)
  return mesh
}

/** A wobbly molten sphere: smooth sine noise pushed along the normals. */
export function liquidBlob() {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 28)
  geo.deleteAttribute('normal')
  geo.deleteAttribute('uv')
  geo = mergeVertices(geo)
  const pos = geo.getAttribute('position')
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize()
    const n = 0.16 * Math.sin(3.1 * v.x + 1.3) * Math.sin(2.7 * v.y + 0.4) + 0.1 * Math.sin(4.3 * v.z + 2.1 * v.x) + 0.06 * Math.sin(7 * v.y + 3 * v.z)
    v.multiplyScalar(1 + n)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

export function heartShape() {
  const s = new THREE.Shape()
  s.moveTo(0, -1)
  s.bezierCurveTo(-0.35, -0.65, -1.05, -0.25, -1.05, 0.3)
  s.bezierCurveTo(-1.05, 0.8, -0.55, 1.05, -0.25, 1.0)
  s.bezierCurveTo(-0.08, 0.97, 0, 0.82, 0, 0.7)
  s.bezierCurveTo(0, 0.82, 0.08, 0.97, 0.25, 1.0)
  s.bezierCurveTo(0.55, 1.05, 1.05, 0.8, 1.05, 0.3)
  s.bezierCurveTo(1.05, -0.25, 0.35, -0.65, 0, -1)
  return s
}

/**
 * Munny-style blank toy (Designers): big round head, small body, stubby limbs.
 * One material over every part, so a picked photo covers the whole toy.
 * `material` replaces the photo/pattern skin (e.g. matte black for Streetwear).
 */
export function blankToy(photo: HTMLCanvasElement | null, material?: THREE.Material) {
  let mat = material
  if (!mat) {
    let map: THREE.Texture
    if (photo) {
      map = new THREE.CanvasTexture(photo)
      map.colorSpace = THREE.SRGBColorSpace
    } else map = blankToyTexture()
    mat = new THREE.MeshPhysicalMaterial({ map, roughness: 0.5, clearcoat: 0.3 })
  }
  const toy = new THREE.Group()
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 48, 32), mat)
  head.scale.set(1, 0.92, 0.95)
  head.position.y = 0.27
  head.rotation.y = -Math.PI / 2 // put the middle of the picture on the face
  const ears = [-1, 1].map((sx) => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.04, 24, 16), mat)
    ear.position.set(sx * 0.085, 0.36, 0)
    return ear
  })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.06, 8, 24), mat)
  body.position.y = 0.11
  body.rotation.y = -Math.PI / 2
  const arms = [-1, 1].map((sx) => {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.06, 6, 12), mat)
    arm.position.set(sx * 0.075, 0.12, 0)
    arm.rotation.z = sx * 0.5
    return arm
  })
  const legs = [-1, 1].map((sx) => {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.03, 6, 12), mat)
    leg.position.set(sx * 0.032, 0.041, 0)
    return leg
  })
  toy.add(head, ...ears, body, ...arms, ...legs)
  return toy
}
