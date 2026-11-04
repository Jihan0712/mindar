import * as THREE from 'three'
import { studioGradient } from '../scene/backdrop'
import type { Scene } from '../scene/schema'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { MarkerTracker } from '../ar/MarkerTracker'
import type { GravitySensor } from '../ar/gravity'
import { applyPlacement, PlacementTracker, type Placement } from '../ar/placement'
import { addLights, makeShadowCatcher } from '../scene/buildScene'
import { CameraEnvironment, studioEnvironment } from './environment'
import { WORLDS, type LookContent, type World } from './worlds'

type SceneView = NonNullable<Scene['view']>

/*
 * Where the look test is drawn: IN3D (orbit, studio reflections) or AR on
 * the test marker (camera reflections). Both take the same LookContent and
 * report the same numbers, so the two can be compared directly.
 */

export interface StageStats {
  fps: number
  triangles: number
  drawCalls: number
  reflections: string
  placement?: Placement
  /** AR only: camera frames tracked per second. */
  cameraFps?: number
  /** AR only: the gyroscope is steadying the scene / motion-sensor readings per second. */
  gyro?: boolean
  sensorRate?: number
  /** AR only: camera picture size, e.g. 720×1280. */
  resolution?: string
  /** Slow frames in the last second, and the longest one (ms). */
  hitches?: number
  worstMs?: number
}

export interface Stage {
  setContent(content: LookContent | null): void
  setWorld(world: World): void
  stats(): StageStats
  dispose(): void
}

/** Counts frames; `fps` is refreshed once a second. */
class FpsMeter {
  fps = 0
  /** Frames in the last second that took over 25 ms (a missed screen refresh: what feels jumpy). */
  hitches = 0
  /** Longest frame in the last second, ms. */
  worst = 0
  private frames = 0
  private slow = 0
  private longest = 0
  private last = 0
  private since = performance.now()
  tick() {
    this.frames++
    const t = performance.now()
    if (this.last) {
      const gap = t - this.last
      if (gap > 25) this.slow++
      this.longest = Math.max(this.longest, gap)
    }
    this.last = t
    if (t - this.since >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (t - this.since))
      this.hitches = this.slow
      this.worst = Math.round(this.longest)
      this.frames = this.slow = this.longest = 0
      this.since = t
    }
  }
}

function setupRenderer(r: THREE.WebGLRenderer) {
  r.toneMapping = THREE.NeutralToneMapping
  r.toneMappingExposure = 1
  r.shadowMap.enabled = true
  r.shadowMap.type = THREE.PCFShadowMap
}

/** Shiny materials are lit mostly by their reflections; keep direct light gentle. */
function lookLights(target: THREE.Object3D) {
  const lights = addLights(target)
  lights.hemi.intensity = 0.6
  lights.sun.intensity = 1.6
  // Sharper map + soft edges + normal offset: steadier shadows on a jittering
  // marker, and no speckled "acne" on thin stickers.
  lights.sun.shadow.mapSize.set(2048, 2048)
  lights.sun.shadow.radius = 3
  lights.sun.shadow.normalBias = 0.003
  return lights
}

/** Soft top-to-bottom backdrop (screen-aligned). */
function gradientTexture(stops: string[]) {
  const c = document.createElement('canvas')
  c.width = 2
  c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, 256)
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s))
  g.fillStyle = grad
  g.fillRect(0, 0, 2, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Viewing direction for IN3D: from the front, a little above. */
const HOME_DIR = new THREE.Vector3(0, 0.45, 1).normalize()

export class In3DStage implements Stage {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50)
  private readonly controls: OrbitControls
  private readonly envs = new Map<World, THREE.Texture>()
  private readonly fps = new FpsMeter()
  private readonly host: HTMLElement
  private content: LookContent | null = null
  private triangles = 0
  private drawCalls = 0
  private readonly onResize = () => this.resize()
  private readonly home = new THREE.Vector3()

  /** `markerImage`: the marker drawn under the scene (the look test's); null for posts (no marker in IN3D, decision 2026-10-07). */
  constructor(host: HTMLElement, markerImage: string | null = '/test/marker.png') {
    this.host = host
    const r = this.renderer
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    setupRenderer(r)
    host.appendChild(r.domElement)

    this.controls = new OrbitControls(this.camera, r.domElement)
    this.controls.target.set(0, 0.16, 0)
    this.controls.enableDamping = true
    this.controls.minDistance = 0.4
    this.controls.maxDistance = 4
    this.controls.maxPolarAngle = Math.PI * 0.49
    // A double tap resets the view, or does what the page asks (a post: like, decision 2026-10-07).
    let lastDouble = 0
    const double = (x: number, y: number) => {
      if (performance.now() - lastDouble < 400) return // iPhone may send both events
      lastDouble = performance.now()
      if (this.onDoubleTap) this.onDoubleTap(x, y)
      else this.resetView()
    }
    r.domElement.addEventListener('dblclick', (e) => double(e.clientX, e.clientY))
    // The person turned / zoomed / moved the view (posts show a "reset view" button then).
    // (Only a real move counts, not a tap; damping keeps moving a little after the finger lifts.)
    const from = new THREE.Vector3()
    this.controls.addEventListener('start', () => from.copy(this.camera.position))
    this.controls.addEventListener('change', () => {
      if (from.lengthSq() && this.camera.position.distanceTo(from) > 0.02) {
        from.set(0, 0, 0)
        this.onUserMove?.()
      }
    })
    // iPhone sends no dblclick for touches: two quick one-finger taps.
    let lastTap = 0
    let start: { x: number; y: number; t: number } | null = null
    r.domElement.addEventListener('touchstart', (e) => {
      start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: performance.now() } : null
    })
    r.domElement.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0]
      if (!start || e.touches.length || !t || Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10 || performance.now() - start.t > 250) return
      const now = performance.now()
      if (now - lastTap < 320) {
        double(t.clientX, t.clientY)
        lastTap = 0
      } else lastTap = now
    })

    lookLights(this.scene)
    this.scene.add(makeShadowCatcher(4))
    this.marker.rotation.x = -Math.PI / 2
    this.marker.receiveShadow = true
    this.marker.visible = false
    this.scene.add(this.marker)
    if (markerImage) this.setMarkerImage(markerImage)

    this.resize()
    window.addEventListener('resize', this.onResize)
    const timer = new THREE.Timer()
    r.setAnimationLoop((time) => {
      timer.update(time)
      this.content?.update(timer.getDelta())
      this.controls.update()
      r.render(this.scene, this.camera)
      this.triangles = r.info.render.triangles
      this.drawCalls = r.info.render.calls
      this.fps.tick()
    })
  }

  private readonly marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }))
  private markerSrc = ''

  /** The marker drawn under the scene (posts of different people sit on their own markers). */
  setMarkerImage(src: string) {
    if (src === this.markerSrc) return
    this.markerSrc = src
    void new THREE.TextureLoader().loadAsync(src).then((tex) => {
      if (this.markerSrc !== src) return tex.dispose()
      tex.colorSpace = THREE.SRGBColorSpace
      const mat = this.marker.material as THREE.MeshStandardMaterial
      mat.map?.dispose()
      mat.map = tex
      mat.needsUpdate = true
      this.marker.visible = true
    })
  }

  private startView: SceneView | null = null
  /** Set by the page: what a double tap does instead of resetting the view (x, y: where, in CSS pixels). */
  onDoubleTap: ((x: number, y: number) => void) | null = null
  /** Called when the person starts turning / zooming / moving the view. */
  onUserMove: (() => void) | null = null

  /** Draws the current view into a 2D canvas (to cross-fade from it while the next scene is swapped in). */
  freezeInto(out: HTMLCanvasElement) {
    const src = this.renderer.domElement
    this.renderer.render(this.scene, this.camera)
    out.width = src.width
    out.height = src.height
    out.getContext('2d')?.drawImage(src, 0, 0)
  }

  /** A post's framed camera (from Frame your shot): resetView() then starts there. */
  setStartView(view: SceneView | null | undefined) {
    this.startView = view ?? null
  }

  /** Back to the starting view: the post's framed camera, else framed on the content, else the marker's. */
  resetView() {
    const v = this.startView
    if (v) {
      // Same width of view as the post picture: the picture fills the screen's width.
      const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect)
      const dist = (v.dist * Math.tan(THREE.MathUtils.degToRad(v.hfov / 2))) / Math.tan(halfH)
      this.controls.target.set(...v.target)
      this.camera.position.set(...v.dir).multiplyScalar(dist).add(this.controls.target)
      this.controls.maxDistance = Math.max(4, dist * 1.6)
      return
    }
    const sphere = this.content ? new THREE.Box3().setFromObject(this.content.root).getBoundingSphere(new THREE.Sphere()) : null
    if (sphere && Number.isFinite(sphere.radius) && sphere.radius > 0) {
      const halfV = THREE.MathUtils.degToRad(this.camera.fov / 2)
      const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect)
      // A little room for the overlays at the top and bottom of the screen.
      const dist = Math.max(0.5, (sphere.radius * 1.3) / Math.sin(Math.min(halfV, halfH)))
      this.controls.target.copy(sphere.center)
      this.camera.position.copy(HOME_DIR).multiplyScalar(dist).add(sphere.center)
    } else {
      this.controls.target.set(0, 0.16, 0)
      this.camera.position.copy(this.home).add(this.controls.target)
    }
    this.controls.maxDistance = Math.max(this.controls.maxDistance, this.camera.position.distanceTo(this.controls.target) * 1.6)
  }

  setWorld(world: World) {
    const { background, gradient } = WORLDS[world]
    this.scene.background = gradient ? gradientTexture(gradient) : new THREE.Color(background)
    if (!this.envs.has(world)) this.envs.set(world, studioEnvironment(this.renderer, world))
    this.scene.environment = this.envs.get(world)!
  }

  setContent(content: LookContent | null) {
    if (this.content) this.scene.remove(this.content.root)
    this.content = content
    if (content) this.scene.add(content.root)
  }

  /** A post's own background colour (the same soft gradient as its picture), with studio reflections. */
  setBackground(color: string) {
    this.setWorld('streetwear')
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose()
    this.scene.background = studioGradient(new THREE.Color(color))
  }

  stats(): StageStats {
    return { fps: this.fps.fps, triangles: this.triangles, drawCalls: this.drawCalls, reflections: 'studio', hitches: this.fps.hitches, worstMs: this.fps.worst }
  }

  /** Lines for a "Copy report". */
  report(): string[] {
    const st = this.stats()
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    return [
      `IN3D: ${st.fps} fps, ${st.hitches} slow frames/s (longest ${st.worstMs} ms)`,
      `${st.triangles} triangles, ${st.drawCalls} draw calls, drawing ${size.x}×${size.y} px`,
    ]
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // Step back far enough that the whole marker width fits on a narrow phone.
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const dist = Math.max(1.3, 0.58 / (halfH * this.camera.aspect))
    this.home.copy(HOME_DIR).multiplyScalar(dist)
    this.controls.maxDistance = Math.max(4, dist * 1.6)
    this.resetView()
  }

  dispose() {
    window.removeEventListener('resize', this.onResize)
    this.renderer.setAnimationLoop(null)
    this.controls.dispose()
    for (const e of this.envs.values()) e.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

export interface ArCallbacks {
  onFound(): void
  onLost(): void
}

export class ArStage implements Stage {
  private tracker: MarkerTracker | null = null
  private sun: THREE.DirectionalLight | null = null
  private gravity: GravitySensor | null = null
  private camEnv: CameraEnvironment | null = null
  private readonly holder = new THREE.Group()
  private readonly shadowCatcher = makeShadowCatcher()
  private readonly placementTracker = new PlacementTracker()
  private placement: Placement = 'flat'
  private content: LookContent | null = null
  private readonly fps = new FpsMeter()
  private triangles = 0
  private drawCalls = 0
  private readonly host: HTMLElement
  private readonly callbacks: ArCallbacks

  constructor(host: HTMLElement, callbacks: ArCallbacks) {
    this.host = host
    this.callbacks = callbacks
  }

  /** Opens the camera and starts tracking. Ask for motion access in the tap before calling. */
  async start(gravity: GravitySensor, antiJitter = true, frameLock = true, gyro = true, target = '/test/marker.mind') {
    await this.openCamera(gravity, antiJitter, frameLock, gyro)
    await this.track(target)
  }

  /**
   * Opens the camera and starts drawing, without a marker yet (scanning reads
   * the QR code first, then calls `track()` with that person's marker).
   */
  async openCamera(gravity: GravitySensor, antiJitter = true, frameLock = true, gyro = true) {
    this.gravity = gravity
    const tracker = new MarkerTracker({
      container: this.host,
      antiJitter,
      frameLock,
      attitude: gyro ? gravity : undefined,
      // ?sd in the address: the browser's default camera size, to compare with HD.
      hd: !new URLSearchParams(location.search).has('sd'),
      onFound: () => this.callbacks.onFound(),
      onLost: () => this.callbacks.onLost(),
    })
    this.tracker = tracker
    setupRenderer(tracker.renderer)
    const { sun } = lookLights(this.holder)
    this.sun = sun
    this.holder.add(this.shadowCatcher)
    tracker.anchor.add(this.holder)
    applyPlacement(this.holder, this.contentRoot(), 'flat')

    await tracker.openCamera()
    this.camEnv = new CameraEnvironment(tracker.renderer, tracker.videoElement!)
    const timer = new THREE.Timer()
    tracker.renderer.setAnimationLoop((time) => {
      timer.update(time)
      this.content?.update(timer.getDelta())
      if (this.camEnv?.update(performance.now())) tracker.scene.environment = this.camEnv.texture
      if (tracker.visible && gravity.hasReading && this.placementTracker.update(tracker.anchor.matrix, gravity.up)) {
        this.setPlacement(this.placementTracker.placement)
      }
      tracker.render()
      this.triangles = tracker.renderer.info.render.triangles
      this.drawCalls = tracker.renderer.info.render.calls
      this.fps.tick()
    })
  }

  /** The live camera picture (e.g. to read a QR code from). */
  get video() {
    return this.tracker?.videoElement ?? null
  }

  /** Tracks a marker (its .mind file) in the open camera. */
  async track(target: string) {
    const tracker = this.tracker
    if (!tracker || !this.sun) throw new Error('Open the camera first.')
    await tracker.track(target)
    const cam = this.sun.shadow.camera as THREE.OrthographicCamera
    const k = tracker.markerWidth
    cam.left = cam.bottom = -1.4 * k
    cam.right = cam.top = 1.4 * k
    cam.near = 0.1 * k
    cam.far = 4 * k
    cam.updateProjectionMatrix()
    this.sun.shadow.normalBias = 0.003 * k // world units, so it scales with the marker
  }

  private contentRoot() {
    return this.content?.root ?? new THREE.Group()
  }

  /** How often the scene switched between flat and upright (a switch looks like a jump). */
  private placementSwitches = 0

  private setPlacement(p: Placement) {
    if (p !== this.placement) this.placementSwitches++
    this.placement = p
    applyPlacement(this.holder, this.contentRoot(), p)
    this.shadowCatcher.visible = p === 'flat'
  }

  setWorld() {
    // Reflections come from the camera in AR; nothing to change per world.
  }

  setContent(content: LookContent | null) {
    if (this.content) this.holder.remove(this.content.root)
    this.content = content
    if (content) this.holder.add(content.root)
    this.setPlacement(this.placement)
  }

  stats(): StageStats {
    return {
      fps: this.fps.fps,
      triangles: this.triangles,
      drawCalls: this.drawCalls,
      reflections: this.camEnv?.texture ? `camera (refresh ${this.camEnv.lastMs} ms)` : 'waiting for camera',
      placement: this.placement,
      cameraFps: this.tracker?.trackFps,
      gyro: this.tracker?.gyroActive,
      sensorRate: this.gravity?.rate,
      resolution: this.tracker?.resolution,
      hitches: this.fps.hitches,
      worstMs: this.fps.worst,
    }
  }

  /** Lines for the preview's "Copy report". */
  report(): string[] {
    const st = this.stats()
    return [
      `Frame rate ${st.fps} fps · camera ${st.cameraFps ?? '-'} · ${st.resolution ?? '-'} · gyro ${st.gyro ? 'on' : 'off'} (sensor ${st.sensorRate ?? 0}/s)`,
      `Placement: ${this.placement}, switched ${this.placementSwitches}×`,
      ...(this.tracker?.stats.report() ?? []),
    ]
  }

  dispose() {
    this.camEnv?.dispose()
    this.tracker?.stop()
  }
}
