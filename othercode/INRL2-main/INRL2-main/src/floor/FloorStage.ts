import * as THREE from 'three'
import { addLights, makeShadowCatcher, type SceneHandle } from '../scene/buildScene'
import { studioEnvironment } from '../look/environment'
import { applyPlacement, type Placement } from '../ar/placement'
import { post, type NativeFrame } from './bridge'

/*
 * Draws a scene standing on the real floor, over the camera picture of the
 * native test app. The app's ARKit gives the camera's position and lens each
 * frame; three.js only draws (transparent background). Scene units are
 * marker widths; on the floor one unit is `unit` metres (pinch to change).
 * Used by the floor test (/floor) and by INRL in a post (PostInrl).
 */

const POP_MS = 380

/** easeOutBack: grows a little past full size, then settles. */
const popCurve = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2

/** Figma A4's aim mark, lying on the surface: a dot, a ring and four arcs, white. Metres. */
function makeReticle() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })
  const flat = (g: THREE.BufferGeometry) => new THREE.Mesh(g.rotateX(-Math.PI / 2), mat)
  const group = new THREE.Group()
  const inner = new THREE.Group()
  inner.add(flat(new THREE.CircleGeometry(0.032, 40)), flat(new THREE.RingGeometry(0.05, 0.064, 48)))
  const arcs = new THREE.Group()
  for (let i = 0; i < 4; i++) arcs.add(flat(new THREE.RingGeometry(0.095, 0.107, 24, 1, i * (Math.PI / 2) + 0.28, Math.PI / 2 - 0.56)))
  group.add(inner, arcs)
  for (const m of [...inner.children, ...arcs.children]) m.renderOrder = 10
  return { group, inner, arcs }
}

const DEFAULT_UNIT = 0.5
const MIN_UNIT = 0.1
const MAX_UNIT = 3

export interface FloorStats {
  fps: number
  /** Camera frames received from the app per second. */
  frames: number
  /** Average / worst delay between the app sending a frame and this page getting it, ms. */
  delay: number
  delayMax: number
  track: string
  planes: number
  /** The phone is in Low Power Mode (drawing capped at 30 fps, videos don't start on their own). */
  lowPower: boolean
}

export class FloorStage {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera()
  /** Where the scene stands: on the floor, turned to face the viewer. */
  private readonly anchor = new THREE.Group()
  /** Scaled so one scene unit = `unit` metres. */
  private readonly content = new THREE.Group()
  /** Holds the scene inside `content`; scaled for the pop when a scene appears. */
  private readonly pop = new THREE.Group()
  private popStart = -1
  private readonly reticle: THREE.Group
  private readonly reticleParts: ReturnType<typeof makeReticle>
  /**
   * On a marker (the app's ARKit follows its artwork): the marker's frame as
   * the web AR pages use it (x right, y up the print, z out of it, 1 unit =
   * its width), then the same flat / upright layout (applyPlacement).
   */
  private readonly markerAnchor = new THREE.Group()
  private readonly markerHolder = new THREE.Group()
  private readonly markerLights: ReturnType<typeof addLights>
  private readonly markerShadow = makeShadowCatcher()
  /** The marker followed (its code) and how it lies; null on a surface. */
  marker: { id: string; w: number; placement: Placement; found: boolean; tracked: boolean } | null = null
  /** Called the first time the followed marker is seen. */
  onMarkerFound: () => void = () => {}
  /** Where the aim mark shows (smoothed). */
  private readonly aim = new THREE.Vector3()
  private readonly lights: ReturnType<typeof addLights>
  private handle: SceneHandle | null = null
  private readonly host: HTMLElement
  private readonly onResize = () => this.resize()

  /** Floor point and turn of the placed scene; null until placed. */
  place: { pos: THREE.Vector3; yaw: number } | null = null
  unit = DEFAULT_UNIT
  /** While a finger moves the scene, ARKit's copy of the anchor is ignored. */
  gesturing = false
  last: NativeFrame | null = null

  private frameCount = 0
  private renderCount = 0
  private delays: number[] = []
  private statsSince = performance.now()
  private readonly current: FloorStats = { fps: 0, frames: 0, delay: 0, delayMax: 0, track: 'starting', planes: 0, lowPower: false }

  constructor(host: HTMLElement) {
    this.host = host
    const r = this.renderer
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    r.setClearColor(0x000000, 0)
    r.toneMapping = THREE.NeutralToneMapping
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    host.appendChild(r.domElement)

    this.camera.matrixAutoUpdate = false
    this.anchor.matrixAutoUpdate = false
    this.anchor.visible = false
    this.scene.environment = studioEnvironment(r, 'streetwear')

    this.lights = addLights(this.content)
    this.lights.hemi.intensity = 0.8
    this.lights.sun.intensity = 1.8
    this.lights.sun.shadow.mapSize.set(2048, 2048)
    this.lights.sun.shadow.radius = 3
    this.content.add(makeShadowCatcher(3))
    this.content.add(this.pop)
    this.anchor.add(this.content)
    this.scene.add(this.anchor)

    this.markerAnchor.matrixAutoUpdate = false
    this.markerAnchor.visible = false
    this.markerLights = addLights(this.markerHolder)
    this.markerLights.hemi.intensity = 0.8
    this.markerLights.sun.intensity = 1.8
    this.markerLights.sun.shadow.mapSize.set(2048, 2048)
    this.markerLights.sun.shadow.radius = 3
    this.markerHolder.add(this.markerShadow)
    this.markerAnchor.add(this.markerHolder)
    this.scene.add(this.markerAnchor)

    // Aim mark on the floor under the screen centre, until the scene is placed.
    this.reticleParts = makeReticle()
    this.reticle = this.reticleParts.group
    this.reticle.matrixAutoUpdate = false
    this.reticle.visible = false
    this.scene.add(this.reticle)

    this.setUnit(this.unit)
    this.resize()
    window.addEventListener('resize', this.onResize)

    const timer = new THREE.Timer()
    r.setAnimationLoop((time) => {
      timer.update(time)
      this.handle?.update(timer.getDelta())
      this.animate(time)
      if (this.last) r.render(this.scene, this.camera)
      this.renderCount++
      this.tickStats()
    })
  }

  /** One camera frame from the app. */
  onFrame(f: NativeFrame) {
    this.last = f
    this.frameCount++
    this.delays.push(Date.now() - f.sent)

    const cam = this.camera
    cam.matrix.fromArray(f.cam)
    cam.matrixWorld.copy(cam.matrix)
    cam.matrixWorldInverse.copy(cam.matrix).invert()
    cam.projectionMatrix.fromArray(f.proj)
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()

    if (!this.place && !this.marker?.found && f.hit) {
      // Glide to the new surface point (raw hits jitter); jump when it moved far (another surface).
      const target = new THREE.Vector3(f.hit[12], f.hit[13], f.hit[14])
      if (!this.reticle.visible || this.aim.distanceTo(target) > 0.3) this.aim.copy(target)
      else this.aim.lerp(target, 0.35)
      this.reticle.matrix.fromArray(f.hit).setPosition(this.aim)
      this.reticle.matrixWorldNeedsUpdate = true
      this.reticle.visible = true
    } else {
      this.reticle.visible = false
    }

    // ARKit refines the anchor as it learns the room; follow it.
    if (this.place && f.anchor && !this.gesturing) {
      const m = f.anchor
      this.place.pos.set(m[12], m[13], m[14])
      this.place.yaw = Math.atan2(-m[2], m[0])
      this.updateAnchor()
    }

    if (this.marker && f.image?.id === this.marker.id) this.onMarkerFrame(f.image)

    if (f.light) this.markerLights.hemi.intensity = 0.8 * THREE.MathUtils.clamp(f.light / 1000, 0.5, 1.5)
    if (f.light) this.lights.hemi.intensity = 0.8 * THREE.MathUtils.clamp(f.light / 1000, 0.5, 1.5)
  }

  /** Drops the scene on the floor under the screen centre, facing the phone. False if no floor yet. */
  placeAtAim(): boolean {
    const f = this.last
    if (!f?.hit) return false
    const pos = this.reticle.visible ? this.aim.clone() : new THREE.Vector3(f.hit[12], f.hit[13], f.hit[14])
    this.place = { pos, yaw: this.yawToCamera(pos) }
    this.updateAnchor()
    this.commit()
    this.popIn()
    post({ type: 'haptic' })
    return true
  }

  /** The scene grows into place (after placing, or when the strip swaps it). */
  popIn() {
    this.popStart = performance.now()
    this.pop.scale.setScalar(0.001)
  }

  private animate(time: number) {
    // The aim mark breathes; the arcs turn slowly.
    const r = this.reticleParts
    if (this.reticle.visible) {
      r.inner.scale.setScalar(1 + 0.06 * Math.sin(time / 260))
      r.arcs.rotation.y = time / 2400
    }
    if (this.popStart >= 0) {
      const t = Math.min(1, (performance.now() - this.popStart) / POP_MS)
      this.pop.scale.setScalar(Math.max(0.001, popCurve(t)))
      if (t >= 1) this.popStart = -1
    }
  }

  /** Back to aiming. */
  unplace() {
    this.place = null
    this.anchor.visible = false
    post({ type: 'clearAnchor' })
  }

  /** The floor point under a screen point (CSS px), on the placed scene's floor height. */
  floorPoint(x: number, y: number): THREE.Vector3 | null {
    if (!this.place || !this.last) return null
    const { clientWidth: w, clientHeight: h } = this.host
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.place.pos.y)
    return ray.ray.intersectPlane(plane, new THREE.Vector3())
  }

  moveTo(x: number, z: number) {
    if (!this.place) return
    this.place.pos.x = x
    this.place.pos.z = z
    this.updateAnchor()
  }

  turnBy(rad: number) {
    if (!this.place) return
    this.place.yaw += rad
    this.updateAnchor()
  }

  setUnit(unit: number) {
    this.unit = THREE.MathUtils.clamp(unit, MIN_UNIT, MAX_UNIT)
    this.content.scale.setScalar(this.unit)
    // Shadow cameras don't inherit the group's scale: size the box in metres.
    const cam = this.lights.sun.shadow.camera as THREE.OrthographicCamera
    const k = this.unit
    cam.left = cam.bottom = -1.4 * k
    cam.right = cam.top = 1.4 * k
    cam.near = 0.1 * k
    cam.far = 4 * k
    cam.updateProjectionMatrix()
    this.lights.sun.shadow.normalBias = 0.003 * k
  }

  /** Tells ARKit where the scene now stands (after placing or a gesture). */
  commit() {
    if (!this.place) return
    this.anchor.updateMatrix()
    post({ type: 'anchor', m: this.anchorMatrix().toArray() })
  }

  /** Shows a scene (replacing the previous one); `pop` makes it grow into place. */
  setContent(handle: SceneHandle | null, pop = false) {
    if (this.handle) this.pop.remove(this.handle.root)
    this.handle = handle
    if (handle) {
      this.pop.add(handle.root)
      this.layout()
    }
    if (pop && (this.place || this.marker?.found)) this.popIn()
  }

  /** Follow this marker (its artwork is tracked by the app): the scene moves onto it once seen. */
  followMarker(id: string) {
    this.marker = { id, w: 0.2, placement: 'flat', found: false, tracked: false }
  }

  /** Back to surfaces: the scene leaves the marker and waits for a tap on a surface. */
  leaveMarker() {
    if (!this.marker) return
    this.marker = null
    this.markerAnchor.visible = false
    this.content.add(this.pop)
    this.layout()
    this.unplace()
  }

  private onMarkerFrame(img: { m: number[]; w: number; tracked: boolean }) {
    const mk = this.marker!
    // ARKit's image frame (y out of the print, -z to its top) → the web AR marker frame (z out, y to its top), scaled to its width.
    this.markerAnchor.matrix
      .fromArray(img.m)
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
      .multiply(new THREE.Matrix4().makeScale(img.w, img.w, img.w))
    this.markerAnchor.matrixWorldNeedsUpdate = true
    mk.w = img.w
    mk.tracked = img.tracked
    // Lying flat (normal near up) or upright, with some hysteresis so it doesn't flip.
    const up = Math.abs(img.m[5])
    const next: Placement = up > 0.77 ? 'flat' : up < 0.57 ? 'vertical' : mk.placement
    const changed = next !== mk.placement
    mk.placement = next
    const cam = this.markerLights.sun.shadow.camera as THREE.OrthographicCamera
    cam.left = cam.bottom = -1.4 * img.w
    cam.right = cam.top = 1.4 * img.w
    cam.near = 0.1 * img.w
    cam.far = 4 * img.w
    cam.updateProjectionMatrix()
    this.markerLights.sun.shadow.normalBias = 0.003 * img.w
    if (!mk.found) {
      mk.found = true
      // One scene at a time: the surface scene leaves, the marker's arrives.
      this.place = null
      this.anchor.visible = false
      post({ type: 'clearAnchor' })
      this.markerHolder.add(this.pop)
      this.markerAnchor.visible = true
      this.layout()
      this.popIn()
      post({ type: 'haptic' })
      this.onMarkerFound()
    } else if (changed) {
      this.layout()
    }
  }

  /** Lays the scene out for where it stands: on a marker (flat or upright), or on a surface (as authored). */
  private layout() {
    const root = this.handle?.root ?? new THREE.Group()
    if (this.marker?.found) {
      applyPlacement(this.markerHolder, root, this.marker.placement)
      this.markerShadow.visible = this.marker.placement === 'flat'
    } else {
      // Media "on the marker" go back to the wall square (their authored place).
      applyPlacement(new THREE.Group(), root, 'vertical')
    }
  }

  stats(): FloorStats {
    return this.current
  }

  private anchorMatrix() {
    const p = this.place!
    return new THREE.Matrix4().compose(p.pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw), new THREE.Vector3(1, 1, 1))
  }

  private updateAnchor() {
    this.anchor.matrix.copy(this.anchorMatrix())
    this.anchor.matrixWorldNeedsUpdate = true
    this.anchor.visible = true
  }

  /** Turn so the scene's front (+z) faces the phone. */
  private yawToCamera(pos: THREE.Vector3) {
    const c = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld)
    return Math.atan2(c.x - pos.x, c.z - pos.z)
  }

  private tickStats() {
    const t = performance.now()
    if (t - this.statsSince < 1000) return
    const s = (t - this.statsSince) / 1000
    const d = this.delays
    this.current.fps = Math.round(this.renderCount / s)
    this.current.frames = Math.round(this.frameCount / s)
    this.current.delay = d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : 0
    this.current.delayMax = d.length ? Math.round(Math.max(...d)) : 0
    this.current.track = this.last?.track ?? 'starting'
    this.current.planes = this.last?.planes ?? 0
    this.current.lowPower = !!this.last?.lowPower
    this.renderCount = this.frameCount = 0
    this.delays = []
    this.statsSince = t
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host
    this.renderer.setSize(w, h)
  }

  dispose() {
    window.removeEventListener('resize', this.onResize)
    this.renderer.setAnimationLoop(null)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
