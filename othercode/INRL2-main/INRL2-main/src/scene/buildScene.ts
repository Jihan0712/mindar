import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { buildItem, buildText, libraryItem } from '../studio/library'
import { applyMotion, motionPhase } from '../studio/motions'
import { mediaUrl } from '../studio/media'
import { mediaBody } from '../studio/screens'
import { coverCrop, faceAspect } from '../studio/placeMedia'
import type { Scene, SceneObject } from './schema'

/*
 * Turns a saved scene into three.js objects. The same builder serves every
 * viewer, so a post looks identical in AR, in IN3D and in the editor.
 */

export interface SceneHandle {
  root: THREE.Group
  videos: HTMLVideoElement[]
  music: HTMLAudioElement | null
  /** Advance animations; call once per frame with seconds since last frame. */
  update(dt: number): void
  /**
   * Starts every video and the music. Call it from inside a tap handler the
   * first time: iOS only allows sound, and sometimes playback at all, when
   * play() starts from a user gesture. Later calls work without a gesture.
   */
  play(): Promise<void>
  pause(): void
  setMuted(muted: boolean): void
  dispose(): void
}

const DEG = Math.PI / 180
/** Where the marker is in scene space: the back wall of InStudio (z = -0.5), media sit just in front. */
export const MARKER_Z = -0.5 + 0.004
const gltfLoader = new GLTFLoader()
const textureLoader = new THREE.TextureLoader()

export async function buildScene(scene: Scene): Promise<SceneHandle> {
  const root = new THREE.Group()
  root.name = `scene:${scene.id}`
  const videos: HTMLVideoElement[] = []
  const mixers: THREE.AnimationMixer[] = []
  const animations: ((t: number) => void)[] = []
  const silent = new Set<HTMLMediaElement>()
  const disposables: { dispose(): void }[] = []
  let time = 0

  const built = await Promise.all(
    scene.objects.map((obj) => buildObject(obj, { videos, mixers, animations, silent, disposables }).catch((err) => {
      // One broken object must not take the whole post down.
      console.error(`Object "${obj.id}" failed to load`, err)
      return null
    })),
  )
  for (const node of built) if (node) root.add(node)

  let music: HTMLAudioElement | null = null
  if (scene.music) {
    music = new Audio(scene.music.src)
    music.loop = true
    music.preload = 'auto'
  }

  const media = (): HTMLMediaElement[] => (music ? [...videos, music] : videos)

  return {
    root,
    videos,
    music,
    update(dt) {
      time += dt
      for (const m of mixers) m.update(dt)
      for (const a of animations) a(time)
    },
    async play() {
      // Fire every play() synchronously so they all count as part of the tap.
      const results = media().map((m) => m.play())
      await Promise.allSettled(results)
    },
    pause() {
      for (const m of media()) m.pause()
    },
    setMuted(muted) {
      for (const m of media()) m.muted = muted || silent.has(m)
    },
    dispose() {
      for (const m of media()) {
        m.pause()
        m.removeAttribute('src')
        m.load()
      }
      for (const d of disposables) d.dispose()
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose()
          const mats = Array.isArray(o.material) ? o.material : [o.material]
          for (const mat of mats) {
            for (const v of Object.values(mat)) if (v instanceof THREE.Texture && v.userData.shared !== true) v.dispose()
            mat.dispose()
          }
        }
      })
    },
  }
}

interface BuildContext {
  videos: HTMLVideoElement[]
  mixers: THREE.AnimationMixer[]
  animations: ((t: number) => void)[]
  /** Videos whose sound is off: they stay muted even when the scene's sound is on. */
  silent: Set<HTMLMediaElement>
  disposables: { dispose(): void }[]
}

/**
 * Each object is three nested groups: `node` carries where it was placed
 * (the editor moves this), `moving` its motion (spin, float…, see
 * studio/motions.ts), and inside them the object itself.
 */
async function buildObject(obj: SceneObject, ctx: BuildContext): Promise<THREE.Object3D> {
  let inner: THREE.Object3D
  switch (obj.kind) {
    case 'model':
      inner = await buildModel(obj, ctx)
      break
    case 'image':
      inner = await buildImage(obj)
      break
    case 'video':
      inner = await buildVideo(obj, ctx)
      break
    case 'text':
    case 'item': {
      const built = obj.kind === 'text' ? await buildText(obj.text, obj.style) : await buildItem(obj.item)
      if (built.update) ctx.animations.push(built.update)
      inner = built.object
      break
    }
  }
  const node = new THREE.Group()
  const moving = new THREE.Group()
  moving.add(inner)
  node.add(moving)
  const { position, rotation, scale } = obj.transform
  node.position.set(...position)
  node.rotation.set(rotation[0] * DEG, rotation[1] * DEG, rotation[2] * DEG)
  node.scale.setScalar(scale)
  node.name = obj.id
  if ((obj.kind === 'image' || obj.kind === 'video') && obj.display === 'marker') {
    // Lies on the marker: in the editor that is the 1 × 1 square on the back
    // wall; on a flat marker in AR, applyPlacement() lays it on the print.
    node.position.z = MARKER_Z
    node.userData.onMarker = true
    // Several prints on the marker would flicker into each other at the
    // same height: each gets its own tiny lift (from its id, so the editor
    // and AR agree). Local +z is "out of the print" in every placement.
    const layer = [...obj.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8
    inner.position.z += layer * 0.0015
  }
  // The object's motion: chosen in the editor, or the library item's own.
  const motion = obj.motion ?? (obj.kind === 'item' ? libraryItem(obj.item)?.motion : undefined) ?? 'none'
  if (motion !== 'none') {
    const up = node.userData.onMarker ? 'z' : 'y'
    const phase = motionPhase(obj.id)
    ctx.animations.push((t) => applyMotion(moving, motion, t, up, phase))
  }
  node.traverse((o) => {
    o.castShadow = true
  })
  return node
}

async function buildModel(obj: Extract<SceneObject, { kind: 'model' }>, ctx: BuildContext) {
  const gltf = await gltfLoader.loadAsync(obj.src)
  const model = gltf.scene

  // Normalise: requested height, standing on the ground, centred on its spot.
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const s = size.y > 0 ? obj.height / size.y : 1
  model.scale.multiplyScalar(s)
  box.setFromObject(model)
  const center = box.getCenter(new THREE.Vector3())
  model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z))

  if (obj.animation !== false && gltf.animations.length) {
    const clip = typeof obj.animation === 'string'
      ? THREE.AnimationClip.findByName(gltf.animations, obj.animation) ?? gltf.animations[0]
      : gltf.animations[0]
    const mixer = new THREE.AnimationMixer(model)
    mixer.clipAction(clip).play()
    ctx.mixers.push(mixer)
  }

  const holder = new THREE.Group()
  holder.add(model)
  return holder
}

async function buildImage(obj: Extract<SceneObject, { kind: 'image' }>) {
  const tex = await textureLoader.loadAsync(await mediaUrl(obj.src))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const img = tex.image as { width: number; height: number }
  const w = obj.width
  let h = w * (img.height / img.width)
  if (obj.display) {
    h = w / fitTexture(tex, img.width / img.height, obj.display, obj.screen ?? 'frame')
    // Photos keep their own colours: unlit, no tone mapping. Transparent PNGs stay cut out.
    const face = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true, alphaTest: 0.02 })
    return mediaBody(obj.display, obj.screen ?? 'frame', w, h, face)
  }
  return makePanel(w, h, new THREE.MeshBasicMaterial({ map: tex }), obj.frame ? 'frame' : 'none')
}

/** Crops a texture to fill the screen's own shape; returns that shape (width / height). */
function fitTexture(tex: THREE.Texture, mediaA: number, display: NonNullable<Extract<SceneObject, { kind: 'image' }>['display']>, screen: NonNullable<Extract<SceneObject, { kind: 'image' }>['screen']>) {
  const faceA = faceAspect(display, screen, mediaA)
  const { repeat, offset } = coverCrop(mediaA, faceA)
  tex.repeat.set(repeat[0], repeat[1])
  tex.offset.set(offset[0], offset[1])
  return faceA
}

async function buildVideo(obj: Extract<SceneObject, { kind: 'video' }>, ctx: BuildContext) {
  const video = document.createElement('video')
  if (!obj.sound) ctx.silent.add(video)
  video.src = await mediaUrl(obj.src)
  video.crossOrigin = 'anonymous'
  video.loop = obj.loop ?? true // objects made in the editor may not carry defaults yet
  video.muted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.setAttribute('webkit-playsinline', '')
  video.preload = 'auto'
  ctx.videos.push(video)

  const tex = new THREE.VideoTexture(video)
  tex.colorSpace = THREE.SRGBColorSpace
  ctx.disposables.push(tex)

  // Assume portrait 9:16 until the file says otherwise, then resize in place.
  const w = obj.width
  const make = (mediaA: number) => {
    const face = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    if (!obj.display) return makePanel(w, w / mediaA, face, obj.style === 'screen' ? 'screen' : 'none')
    const faceA = fitTexture(tex, mediaA, obj.display, obj.screen ?? 'frame')
    return mediaBody(obj.display, obj.screen ?? 'frame', w, w / faceA, face)
  }
  const group = make(9 / 16)
  video.addEventListener('loadedmetadata', () => {
    if (!video.videoWidth) return
    const fresh = make(video.videoWidth / video.videoHeight)
    group.clear()
    for (const child of [...fresh.children]) group.add(child)
    group.traverse((o) => {
      o.castShadow = true
    })
  })
  return group
}

/**
 * A picture standing upright with its bottom edge on the ground.
 * "frame" adds a thin white border; "screen" a dark device body with depth.
 */
function makePanel(w: number, h: number, face: THREE.Material, style: 'frame' | 'screen' | 'none') {
  const group = new THREE.Group()
  const lift = 0.01
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, h), face)
  front.position.set(0, h / 2 + lift, 0)

  if (style === 'none') {
    group.add(front)
    return group
  }
  const border = style === 'screen' ? w * 0.06 : w * 0.04
  const depth = style === 'screen' ? w * 0.08 : w * 0.02
  const bodyColor = style === 'screen' ? 0x384143 : 0xffffff
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(w + border * 2, h + border * 2, depth),
    new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: style === 'screen' ? 0.3 : 0 }),
  )
  body.position.set(0, (h + border * 2) / 2 + lift, -depth / 2 - 0.001)
  front.position.y = border + h / 2 + lift
  group.add(body, front)
  return group
}

/** Lights shared by the viewers, so materials look the same everywhere. */
export function addLights(target: THREE.Object3D) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9a9c, 2.2)
  const sun = new THREE.DirectionalLight(0xffffff, 2.4)
  sun.position.set(0.6, 1.6, 0.9)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  const cam = sun.shadow.camera as THREE.OrthographicCamera
  // Covers the whole InStudio area (±1 marker width, plus tall objects).
  cam.left = cam.bottom = -1.4
  cam.right = cam.top = 1.4
  cam.near = 0.1
  cam.far = 4
  sun.shadow.bias = -0.002
  target.add(hemi, sun, sun.target)
  return { hemi, sun }
}

/**
 * Invisible ground that only shows shadows, so objects sit on the marker.
 * Pulled towards the camera in depth so it never flickers against a marker
 * picture lying at the same height (IN3D). It writes no depth, so it can
 * never hide what lies on the print (it did at steep angles: a video lying
 * on the marker vanished at ~45°).
 */
export function makeShadowCatcher(size = 3) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShadowMaterial({ opacity: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  return ground
}
