import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { studioEnvironment } from '../look/environment'
import { studioGradient } from '../scene/backdrop'
import { addLights, buildScene, makeShadowCatcher, MARKER_Z, type SceneHandle } from '../scene/buildScene'
import type { Scene, SceneObject } from '../scene/schema'
import { SelectionOutline } from './outline'
import { AREA, clamp, clampToArea, clampToMarker, isTap, liftPx, SCALE_RANGE, snapAngle, snapOnMarker, snapPosition, stretchToArea, stretchToMarker, twoFinger, type Pt } from './gestures'

/*
 * InStudio's 3D stage (Figma E1r2…E17r2): a grey grid room with the
 * workspace (the marker's square and the space above it) outlined in glowing
 * cyan. Camera gestures follow the InStudio tutorial: one finger turns the
 * view, pinch zooms, two fingers pan, double tap resets.
 *
 * Objects (Nico's rule): tap an object to select it; only the selected
 * object can change. While it is selected, every touch moves it (wherever
 * the fingers are; the view stays still), as in Nico's earlier prototype: one finger moves it left/right and up/down
 * (in the plane facing you); with two fingers, slide both up to push it
 * back or down to bring it forward, pinch to resize, twist to turn.
 * With nothing selected, touches move the camera. Taps still select. Tap another object to
 * switch, tap empty space to let go.
 */

export interface Transform {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: number
}

export interface EditorCallbacks {
  onSelect(id: string | null): void
  /** A gesture finished: save this object's new transform. */
  onTransform(id: string, t: Transform): void
}

const DEG = Math.PI / 180
const TARGET = new THREE.Vector3(0, 0.28, 0)

const HOME_DIR = new THREE.Vector3(0, 0.32, 1).normalize()
const CYAN = 0x2ee6f0
/** Two-finger push/pull: how far it goes per pixel of finger slide, relative to on-screen size (depth reads as shorter). */
const DEPTH_PER_PX = 2

interface Entry {
  key: string
  handle: SceneHandle
  node: THREE.Object3D
}

/** What an object looks like apart from where it is: rebuild when this changes. */
const contentKey = (o: SceneObject) => JSON.stringify({ ...o, transform: undefined })

type Gesture =
  | { kind: 'camera' }
  | {
      kind: 'object'
      id: string
      node: THREE.Object3D
      moved: boolean
      // one finger: drag across the floor at the object's height
      plane?: THREE.Plane
      offset?: THREE.Vector3
      // two fingers: pinch and twist
      a0?: Pt
      b0?: Pt
      scale0?: number
      rotY0?: number
      rotZ0?: number
      y0?: number
      /** Two fingers: where it was, and "away from you" along the floor. */
      p0?: THREE.Vector3
      away?: THREE.Vector3
      /** Marker widths per screen pixel at the object's distance. */
      unitsPerPx?: number
    }

export class EditorStage {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true })
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.01, 60)
  private readonly controls: OrbitControls
  private readonly host: HTMLElement
  private readonly callbacks: EditorCallbacks
  private readonly objects = new Map<string, Entry>()
  private readonly content = new THREE.Group()
  private readonly room = new THREE.Group()
  private roomMats: THREE.MeshBasicMaterial[] = []
  private readonly ring: THREE.Mesh
  private readonly stem: THREE.Mesh
  private selected: string | null = null
  private readonly outline = new SelectionOutline()
  private readonly guideX: THREE.Group
  private readonly guideZ: THREE.Mesh
  private sound = false
  /** The little "pop" when an object is picked: which node, its real size, seconds since. */
  private pop: { node: THREE.Object3D; scale: number; t: number } | null = null
  private readonly home = new THREE.Vector3()
  private readonly pointers = new Map<number, Pt>()
  private gesture: Gesture | null = null
  private down: { p: Pt; t: number } | null = null
  private lastTap: { p: Pt; t: number } | null = null
  private readonly raycaster = new THREE.Raycaster()
  private syncing = Promise.resolve()
  private disposed = false
  /** An object springing back inside the area after being pulled past an edge. */
  private settle: { node: THREE.Object3D; to: THREE.Vector3 } | null = null
  /** How far the picture is shifted up (px) so a bottom sheet doesn't cover the scene. */
  private lift = 0
  private liftTarget = 0
  private readonly onResize = () => this.resize()

  constructor(host: HTMLElement, callbacks: EditorCallbacks) {
    this.host = host
    this.callbacks = callbacks
    const r = this.renderer
    r.setPixelRatio(Math.min(devicePixelRatio, 2))
    r.toneMapping = THREE.NeutralToneMapping
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    host.appendChild(r.domElement)

    this.controls = new OrbitControls(this.camera, r.domElement)
    this.controls.target.copy(TARGET)
    this.controls.enableDamping = true
    this.controls.minDistance = 0.5
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.zoomToCursor = true

    // Chrome needs something to reflect: the Streetwear studio reads best.
    this.scene.environment = studioEnvironment(r, 'streetwear')
    const { hemi, sun } = addLights(this.scene)
    hemi.intensity = 0.9
    sun.intensity = 1.8
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.radius = 3
    sun.shadow.normalBias = 0.003
    this.scene.add(makeShadowCatcher(3.2), this.content, this.room)
    this.buildRoom()

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1, 64),
      new THREE.MeshBasicMaterial({ color: CYAN, depthWrite: false, toneMapped: false }),
    )
    this.ring.rotation.x = -Math.PI / 2
    this.ring.renderOrder = 2
    this.stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 6), this.ring.material)
    this.ring.visible = this.stem.visible = false
    this.scene.add(this.ring, this.stem)

    // Snap guides: faint lines that appear while an object clicks onto them.
    const guideMat = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false })
    const bar = (len: number) => new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, len), guideMat)
    this.guideX = new THREE.Group()
    const gxFloor = bar(AREA.half - AREA.wall)
    gxFloor.position.set(0, 0.003, (AREA.half + AREA.wall) / 2)
    const gxWall = bar(1)
    gxWall.rotation.x = Math.PI / 2
    gxWall.position.set(0, 0.5, AREA.wall + 0.003)
    this.guideX.add(gxFloor, gxWall)
    this.guideZ = bar(AREA.half * 2)
    this.guideZ.rotation.y = Math.PI / 2
    this.guideZ.position.set(0, 0.003, 0)
    this.guideX.visible = this.guideZ.visible = false
    this.scene.add(this.guideX, this.guideZ)

    // Capture phase: decide whether a touch belongs to an object before
    // OrbitControls (listening on the canvas below) sees it.
    host.addEventListener('pointerdown', this.onDown, { capture: true })
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    window.addEventListener('pointercancel', this.onUp)

    this.resize()
    window.addEventListener('resize', this.onResize)
    const timer = new THREE.Timer()
    r.setAnimationLoop((time) => {
      timer.update(time)
      const dt = timer.getDelta()
      for (const e of this.objects.values()) e.handle.update(dt)
      if (this.settle) {
        const { node, to } = this.settle
        node.position.lerp(to, Math.min(1, dt * 14))
        if (node.position.distanceTo(to) < 0.001) {
          node.position.copy(to)
          this.settle = null
        }
      }
      this.updateSelectionMarker()
      this.updateLift(dt)
      this.controls.update()
      this.updatePop(dt)
      r.render(this.scene, this.camera)
      const sel = this.selected ? this.objects.get(this.selected) : undefined
      if (sel) this.outline.render(r, this.scene, sel.node, this.camera)
    })
  }

  /** Grows the picked object ~5% and settles back (≈ 0.25 s): you feel you grabbed it. */
  private updatePop(dt: number) {
    const p = this.pop
    if (!p) return
    p.t += dt
    const d = 0.25
    if (p.t >= d) return this.endPop()
    const k = Math.sin((p.t / d) * Math.PI) * 0.05
    p.node.scale.setScalar(p.scale * (1 + k))
  }

  /** Back to the real size at once (also before a gesture reads the size). */
  private endPop() {
    if (!this.pop) return
    this.pop.node.scale.setScalar(this.pop.scale)
    this.pop = null
  }

  /** Keep the scene visible above a bottom sheet `px` tall (0 = no sheet). */
  setBottomInset(px: number) {
    this.liftTarget = px / 2
  }

  private updateLift(dt: number, force = false) {
    if (this.lift === this.liftTarget && !force) return
    this.lift += (this.liftTarget - this.lift) * Math.min(1, dt * 12)
    if (Math.abs(this.liftTarget - this.lift) < 0.5) this.lift = this.liftTarget
    const { clientWidth: w, clientHeight: h } = this.host
    if (this.lift === 0) this.camera.clearViewOffset()
    else this.camera.setViewOffset(w, h, 0, this.lift, w, h)
  }

  /** The grey grid room and the glowing workspace outline (Figma E1r2). */
  private buildRoom() {
    const grid = document.createElement('canvas')
    grid.width = grid.height = 128
    const g = grid.getContext('2d')!
    g.fillStyle = '#fff'
    g.fillRect(0, 0, 128, 128)
    g.fillStyle = 'rgba(0,0,0,0.13)'
    g.fillRect(0, 0, 128, 2)
    g.fillRect(0, 0, 2, 128)
    const tex = (repeat: [number, number]) => {
      const t = new THREE.CanvasTexture(grid)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(...repeat)
      t.anisotropy = 4
      t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    const floorMat = new THREE.MeshBasicMaterial({ map: tex([24, 24]), toneMapped: false })
    const wallMat = new THREE.MeshBasicMaterial({ map: tex([24, 8]), toneMapped: false })
    this.roomMats = [floorMat, wallMat]
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.002
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(12, 4), wallMat)
    // The marker's square hangs on this wall, just in front of it.
    wall.position.set(0, 2 - 0.002, AREA.wall - 0.02)
    this.room.add(floor, wall)

    // Workspace: the marker's square (1 × 1) on the back wall, and the floor in front of it.
    const h = 0.5
    const top = 1
    const segs: [number, number, number, number, number, number][] = [
      [-h, 0, h, h, 0, h], [h, 0, h, h, 0, -h], [h, 0, -h, -h, 0, -h], [-h, 0, -h, -h, 0, h],
      [-h, 0, -h, -h, top, -h], [h, 0, -h, h, top, -h], [-h, top, -h, h, top, -h],
    ]
    const core = new THREE.MeshBasicMaterial({ color: CYAN, toneMapped: false })
    const glow = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false })
    for (const [x0, y0, z0, x1, y1, z1] of segs) {
      const a = new THREE.Vector3(x0, y0 + 0.002, z0)
      const b = new THREE.Vector3(x1, y1 + 0.002, z1)
      const len = a.distanceTo(b)
      for (const [mat, w] of [[core, 0.006], [glow, 0.024]] as const) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, w, len), mat)
        bar.position.copy(a).lerp(b, 0.5)
        bar.lookAt(b)
        this.room.add(bar)
      }
    }

    // Beyond the square: the rest of the area objects may use, drawn faintly.
    const F = AREA.half
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * F, F - AREA.wall),
      new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.1, depthWrite: false, toneMapped: false }),
    )
    zone.rotation.x = -Math.PI / 2
    zone.position.set(0, 0.001, (F + AREA.wall) / 2)
    const faint = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false })
    const edges: [number, number, number, number][] = [[-F, AREA.wall, -F, F], [-F, F, F, F], [F, F, F, AREA.wall], [-F, AREA.wall, -h, AREA.wall], [h, AREA.wall, F, AREA.wall]]
    for (const [x0, z0, x1, z1] of edges) {
      const a = new THREE.Vector3(x0, 0.002, z0)
      const b = new THREE.Vector3(x1, 0.002, z1)
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, a.distanceTo(b)), faint)
      bar.position.copy(a).lerp(b, 0.5)
      bar.lookAt(b)
      this.room.add(bar)
    }
    this.room.add(zone)
  }

  setBackground(color: string) {
    const c = new THREE.Color(color)
    this.bgColor.copy(c)
    this.scene.background = c
    // The room takes the colour too: lighter floor, the wall a touch darker.
    this.roomMats[0].color.copy(c).lerp(new THREE.Color(0xffffff), 0.12)
    this.roomMats[1].color.copy(c).multiplyScalar(0.96)
    this.scene.fog = new THREE.Fog(c, 1, 2)
    this.updateFog()
    if (this.framing) this.applyFramingLook(true)
  }

  // ------------------------------------------------------------ framing

  private framing = false
  private readonly bgColor = new THREE.Color(0xeeeeee)
  private framed: { aim: THREE.Vector3; from: THREE.Vector3 } | null = null
  private backdrop: THREE.Texture | null = null

  /** The part of the screen a post picture keeps (4:5, centred, decision 2026-10-07), in CSS pixels. */
  pictureBox() {
    const { clientWidth: w, clientHeight: h } = this.host
    const ph = Math.min(h, (w * 5) / 4)
    const pw = (ph * 4) / 5
    return { left: (w - pw) / 2, top: (h - ph) / 2, width: pw, height: ph }
  }

  /** A good starting shot for the post picture: the scene's objects filling the 3:4 picture, seen from the usual angle. */
  private autoFrame() {
    let aim = TARGET.clone()
    let from = this.home.clone().add(TARGET)
    const sphere = new THREE.Box3().setFromObject(this.content).getBoundingSphere(new THREE.Sphere())
    if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
      const { height: ph } = this.pictureBox()
      const halfV = Math.atan((Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * ph) / this.host.clientHeight)
      const halfH = Math.atan(Math.tan(halfV) * 0.8)
      const dist = Math.max(0.6, (sphere.radius * 1.15) / Math.sin(Math.min(halfV, halfH)))
      aim = sphere.center.clone()
      from = this.home.clone().normalize().multiplyScalar(dist).add(aim)
    }
    return { aim, from }
  }

  /** Grid room, workspace and fog off, the backdrop gradient on (or back to the editor look). */
  private applyFramingLook(on: boolean) {
    this.room.visible = !on
    for (const h of [this.ring, this.stem, this.guideX, this.guideZ]) h.visible = false
    this.backdrop?.dispose()
    this.backdrop = null
    if (on) {
      this.scene.fog = null
      this.backdrop = studioGradient(this.bgColor)
      this.scene.background = this.backdrop
    }
  }

  /**
   * "Frame your shot" (decision 2026-10-07): the scene as it will be posted
   * (no grid room, no workspace), auto-framed; fingers only turn / zoom /
   * move the view; snapshot() then keeps exactly this view.
   */
  setFraming(on: boolean) {
    if (on === this.framing) return
    this.framing = on
    this.select(null)
    this.setBottomInset(0)
    this.stopViewMomentum()
    if (on) {
      this.applyFramingLook(true)
      this.framed = this.autoFrame()
      this.controls.minDistance = 0.25
      this.frameReset()
    } else {
      this.applyFramingLook(false)
      this.setBackground(`#${this.bgColor.getHexString()}`)
      this.controls.minDistance = 0.5
      this.resetView()
    }
  }

  /** The framed camera, saved with the post so IN3D opens on the same view. */
  framedView() {
    const target = this.controls.target.clone()
    const off = this.camera.position.clone().sub(target)
    const dist = off.length()
    const { height: ph } = this.pictureBox()
    const halfV = Math.atan((Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * ph) / this.host.clientHeight)
    const hfov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfV) * 0.8))
    const r = (v: number) => Math.round(v * 1e4) / 1e4
    return { target: target.toArray().map(r) as [number, number, number], dir: off.normalize().toArray().map(r) as [number, number, number], dist: r(dist), hfov: r(hfov) }
  }

  /** Back to InRL's own framing. */
  frameReset() {
    if (!this.framed) return
    this.stopViewMomentum()
    this.controls.target.copy(this.framed.aim)
    this.camera.position.copy(this.framed.from)
    this.camera.lookAt(this.framed.aim)
  }

  /** Brings the 3D objects in line with the scene: builds new ones, removes deleted ones, moves the rest. */
  sync(scene: Scene) {
    this.setBackground(scene.background.color)
    this.syncing = this.syncing.then(() => this.doSync(scene))
    return this.syncing
  }

  private async doSync(scene: Scene) {
    const wanted = new Set(scene.objects.map((o) => o.id))
    for (const [id, e] of this.objects) {
      if (!wanted.has(id)) this.remove(id, e)
    }
    for (const obj of scene.objects) {
      const key = contentKey(obj)
      let e = this.objects.get(obj.id)
      // Changed (new text, motion…): rebuild it, staying selected if it was.
      let keepSelected = false
      if (e && e.key !== key) {
        keepSelected = this.selected === obj.id
        this.remove(obj.id, e, keepSelected)
        e = undefined
      }
      if (!e) {
        const handle = await buildScene({ version: 1, id: obj.id, title: '', background: scene.background, objects: [obj] })
        if (this.disposed) return handle.dispose()
        const node = handle.root.children[0]
        if (!node) {
          handle.dispose()
          continue
        }
        e = { key, handle, node }
        this.objects.set(obj.id, e)
        this.content.add(handle.root)
        if (keepSelected) this.selected = obj.id
        // Videos play silently in the editor (allowed without a tap); the sound button unmutes.
        if (handle.videos.length) {
          handle.setMuted(!this.sound)
          void handle.play()
        }
      }
      // Don't fight a finger moving this object, or its spring back from an edge.
      if (this.gesture?.kind === 'object' && this.gesture.id === obj.id) continue
      if (this.settle?.node === e.node) continue
      applyTransform(e.node, obj.transform)
    }
  }

  private remove(id: string, e: Entry, keepSelected = false) {
    this.content.remove(e.handle.root)
    e.handle.dispose()
    this.objects.delete(id)
    if (this.selected === id && !keepSelected) this.select(null)
  }

  select(id: string | null) {
    if (this.selected === id) return
    this.selected = id
    this.endPop()
    const e = id ? this.objects.get(id) : undefined
    if (e) this.pop = { node: e.node, scale: e.node.scale.x, t: 0 }
    this.callbacks.onSelect(id)
  }

  /** Sound on/off for every video. Call from inside a tap: iOS only allows sound after one. */
  setSound(on: boolean) {
    this.sound = on
    for (const e of this.objects.values()) {
      if (!e.handle.videos.length) continue
      e.handle.setMuted(!on)
      void e.handle.play()
    }
  }

  getTransform(id: string): Transform | null {
    const e = this.objects.get(id)
    return e ? readTransform(e.node) : null
  }

  /** Where an object's middle is on screen (CSS pixels); for the automated test. */
  screenPoint(id: string): Pt | null {
    const e = this.objects.get(id)
    if (!e) return null
    const c = new THREE.Box3().setFromObject(e.node).getCenter(new THREE.Vector3()).project(this.camera)
    const rect = this.renderer.domElement.getBoundingClientRect()
    return { x: rect.left + ((c.x + 1) / 2) * rect.width, y: rect.top + ((1 - c.y) / 2) * rect.height }
  }

  /** Shows the snap guides an object is clicking onto. */
  private showGuides(g: { x: boolean; z: boolean; floor: boolean }, onMarker = false) {
    this.guideX.visible = g.x
    this.guideX.children[0].visible = !onMarker
    this.guideZ.visible = g.z
  }

  /** Camera position, for the automated test. */
  cameraPosition() {
    return this.camera.position.toArray()
  }

  /** Stops the view's glide after a swipe (OrbitControls' damping keeps going otherwise). */
  private stopViewMomentum() {
    const c = this.controls as unknown as { _sphericalDelta?: THREE.Spherical; _panOffset?: THREE.Vector3; _scale?: number }
    c._sphericalDelta?.set(0, 0, 0)
    c._panOffset?.set(0, 0, 0)
    if (c._scale !== undefined) c._scale = 1
  }

  resetView() {
    this.stopViewMomentum()
    this.controls.target.copy(TARGET)
    this.camera.position.copy(this.home).add(TARGET)
  }

  /**
   * A picture of the scene (JPEG data URL). For "My scenes": the starting
   * view, without the selection outline or guides, 3:4. While framing: the
   * framed view, 4:5, as the post picture.
   */
  snapshot(width = 240, quality = 0.8): string {
    const r = this.renderer
    const src = r.domElement
    // My scenes' cards are 3:4; post pictures (framing) are 4:5 like everywhere they are shown.
    const tall = this.framing ? 5 / 4 : 4 / 3
    const cropH = Math.min(src.height, Math.round(src.width * tall))
    const cropW = Math.round(cropH / tall)
    const c = document.createElement('canvas')
    c.width = width
    c.height = Math.round(width * tall)
    const draw = () => c.getContext('2d')!.drawImage(src, (src.width - cropW) / 2, (src.height - cropH) / 2, cropW, cropH, 0, 0, c.width, c.height)
    if (this.framing) {
      // The post picture: exactly the framed view (decision 2026-10-07).
      this.camera.clearViewOffset()
      r.render(this.scene, this.camera)
      draw()
      return c.toDataURL('image/jpeg', quality)
    }
    const helpers = [this.ring, this.stem, this.guideX, this.guideZ]
    const shown = helpers.map((h) => h.visible)
    const pos = this.camera.position.clone()
    const target = this.controls.target.clone()
    helpers.forEach((h) => (h.visible = false))
    this.camera.clearViewOffset()
    this.camera.position.copy(this.home).add(TARGET)
    this.camera.lookAt(TARGET)
    r.render(this.scene, this.camera)
    // Read the picture straight after drawing it (the canvas is cleared once shown).
    draw()
    helpers.forEach((h, i) => (h.visible = shown[i]))
    this.camera.position.copy(pos)
    this.controls.target.copy(target)
    this.camera.lookAt(target)
    this.updateLift(0, true)
    return c.toDataURL('image/jpeg', quality)
  }

  // ------------------------------------------------------------ gestures

  /** Every object under the finger, nearest first (surfaces, then the boxes around them). */
  private pickAll(p: Pt): string[] {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((p.x - rect.left) / rect.width) * 2 - 1, -((p.y - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    const box = new THREE.Box3()
    const point = new THREE.Vector3()
    const hits: { id: string; d: number }[] = []
    for (const [id, e] of this.objects) {
      const hit = this.raycaster.intersectObject(e.node, true)[0]
      if (hit) hits.push({ id, d: hit.distance })
      else if (this.raycaster.ray.intersectBox(box.setFromObject(e.node).expandByScalar(0.02), point)) {
        hits.push({ id, d: 1000 + point.distanceTo(this.raycaster.ray.origin) })
      }
    }
    return hits.sort((a, b) => a.d - b.d).map((h) => h.id)
  }

  private floorPoint(p: Pt, plane: THREE.Plane) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((p.x - rect.left) / rect.width) * 2 - 1, -((p.y - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    return this.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
  }

  /** "Away from you" along the floor: the camera's view direction, level. */
  private awayDir() {
    const d = this.camera.getWorldDirection(new THREE.Vector3())
    d.y = 0
    return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(0, 0, -1)
  }

  private startDrag(g: Extract<Gesture, { kind: 'object' }>, p: Pt) {
    // Media on the marker slide across the wall square; everything else in
    // the upright plane through the object, facing you (left/right, up/down).
    g.plane = g.node.userData.onMarker
      ? new THREE.Plane(new THREE.Vector3(0, 0, 1), -MARKER_Z)
      : new THREE.Plane().setFromNormalAndCoplanarPoint(this.awayDir(), g.node.position)
    const hit = this.floorPoint(p, g.plane)
    g.offset = hit ? g.node.position.clone().sub(hit) : new THREE.Vector3()
    g.a0 = g.b0 = undefined
  }

  private startTwist(g: Extract<Gesture, { kind: 'object' }>) {
    const [a, b] = [...this.pointers.values()]
    g.a0 = { ...a }
    g.b0 = { ...b }
    g.scale0 = g.node.scale.x
    g.rotY0 = g.node.rotation.y
    g.rotZ0 = g.node.rotation.z
    g.y0 = g.node.position.y
    g.p0 = g.node.position.clone()
    g.away = this.awayDir()
    const dist = this.camera.position.distanceTo(g.node.getWorldPosition(new THREE.Vector3()))
    g.unitsPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / this.host.clientHeight
    g.plane = undefined
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.target !== this.renderer.domElement || this.framing) return
    const p = { x: e.clientX, y: e.clientY }
    this.pointers.set(e.pointerId, p)
    this.endPop()
    if (this.pointers.size === 1) {
      this.down = { p, t: performance.now() }
      // Nico's rule: while something is selected, every finger gesture,
      // anywhere on the screen, moves that object and the view stays still.
      // With nothing selected, fingers move the view.
      const entry = this.selected ? this.objects.get(this.selected) : undefined
      if (this.selected && entry) {
        this.controls.enabled = false
        this.stopViewMomentum()
        const g: Gesture = { kind: 'object', id: this.selected, node: entry.node, moved: false }
        this.startDrag(g, p)
        this.gesture = g
      } else {
        this.controls.enabled = true
        this.gesture = { kind: 'camera' }
      }
    } else if (this.pointers.size === 2 && this.gesture?.kind === 'object') {
      this.startTwist(this.gesture)
    }
  }

  private readonly onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return
    const p = { x: e.clientX, y: e.clientY }
    this.pointers.set(e.pointerId, p)
    const g = this.gesture
    if (g?.kind !== 'object') return
    if (this.down && !isTap(this.down.p, p, 0)) g.moved = true
    if (this.pointers.size === 1 && g.plane && g.offset) {
      const hit = this.floorPoint(p, g.plane)
      if (hit) {
        if (g.node.userData.onMarker) {
          const [x, y] = snapOnMarker(stretchToMarker([hit.x + g.offset.x, hit.y + g.offset.y, MARKER_Z]))
          g.node.position.x = x
          g.node.position.y = y
          this.showGuides({ x: x === 0, z: false, floor: false }, true)
        } else {
          const { p, guides } = snapPosition(stretchToArea([hit.x + g.offset.x, hit.y + g.offset.y, hit.z + g.offset.z]))
          g.node.position.set(...p)
          this.showGuides(guides)
        }
      }
    } else if (this.pointers.size >= 2 && g.a0 && g.b0) {
      const [a, b] = [...this.pointers.values()]
      const { scale, turn, slide } = twoFinger(g.a0, g.b0, a, b)
      g.node.scale.setScalar(clamp(g.scale0! * scale, ...SCALE_RANGE))
      if (g.node.userData.onMarker) {
        // Flat on the print: twist turns it in the marker's plane; no lifting.
        g.node.rotation.z = snapAngle(g.rotZ0! - turn)
      } else {
        g.node.rotation.y = snapAngle(g.rotY0! - turn)
        // Both fingers up the screen = further away; down = closer.
        const depth = -liftPx(slide.y) * g.unitsPerPx! * DEPTH_PER_PX
        const p = g.p0!.clone().addScaledVector(g.away!, depth)
        const snapped = snapPosition(stretchToArea([p.x, p.y, p.z]))
        g.node.position.set(...snapped.p)
        this.showGuides(snapped.guides)
      }
      g.moved = true
    }
  }

  private readonly onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return
    const p = { x: e.clientX, y: e.clientY }
    this.pointers.delete(e.pointerId)
    const g = this.gesture
    if (this.pointers.size === 1 && g?.kind === 'object') {
      // Lifted one of two fingers: carry on dragging with the other.
      this.startDrag(g, [...this.pointers.values()][0])
      return
    }
    if (this.pointers.size > 0) return

    const tap = this.down && isTap(this.down.p, p, performance.now() - this.down.t)
    if (g?.kind === 'object' && g.moved) {
      // Save the position inside the area; past an edge, spring back to it.
      const t = readTransform(g.node)
      const inside = g.node.userData.onMarker ? clampToMarker(t.position) : clampToArea(t.position)
      if (inside.some((v, i) => v !== t.position[i])) this.settle = { node: g.node, to: new THREE.Vector3(...inside) }
      this.callbacks.onTransform(g.id, { ...t, position: inside })
    }
    if (tap) {
      // A tap selects what is under the finger, nearest first; tapping the
      // same spot again cycles through overlapping objects. Empty space lets go.
      const under = this.pickAll(p)
      const i = this.selected ? under.indexOf(this.selected) : -1
      const hit = under.length ? under[(i + 1) % under.length] : null
      const now = performance.now()
      if (hit) {
        this.select(hit)
        this.lastTap = null
      } else if (this.lastTap && now - this.lastTap.t < 320 && isTap(this.lastTap.p, p, 0)) {
        this.resetView()
        this.lastTap = null
      } else {
        this.lastTap = { p, t: now }
        this.select(null)
      }
    }
    this.gesture = null
    this.down = null
    this.controls.enabled = true
    this.showGuides({ x: false, z: false, floor: false })
  }

  private updateSelectionMarker() {
    const e = this.selected ? this.objects.get(this.selected) : undefined
    // Media on the marker have no floor spot: the outline alone shows the selection.
    this.ring.visible = this.stem.visible = !!e && !e.node.userData.onMarker
    if (!e || e.node.userData.onMarker) return
    const box = new THREE.Box3().setFromObject(e.node)
    if (box.isEmpty()) return
    const size = box.getSize(new THREE.Vector3())
    const r = Math.max(0.06, Math.hypot(size.x, size.z) / 2 + 0.02)
    this.ring.scale.setScalar(r)
    this.ring.position.set(e.node.position.x, 0.004, e.node.position.z)
    const lift = box.min.y
    this.stem.visible = lift > 0.03
    this.stem.scale.y = Math.max(lift, 0.001)
    this.stem.position.set(e.node.position.x, lift / 2, e.node.position.z)
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.host
    this.renderer.setSize(w, h)
    this.outline.setSize(w, h, this.renderer.getPixelRatio())
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.updateLift(0, true) // re-apply the view offset at the new size
    // Step back far enough that the workspace (plus a margin) fits the width.
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const dist = Math.max(1.8, 0.85 / (halfH * this.camera.aspect))
    this.home.copy(HOME_DIR).multiplyScalar(dist)
    this.controls.maxDistance = dist * 1.8
    this.updateFog()
    if (this.framing) {
      this.framed = this.autoFrame()
      this.frameReset()
    } else this.resetView()
  }

  /** The room fades into the background colour behind the workspace, never in front of it. */
  private updateFog() {
    const fog = this.scene.fog as THREE.Fog | null
    if (!fog) return
    fog.near = this.home.length() + 1.5
    fog.far = this.home.length() + 8
  }

  dispose() {
    this.disposed = true
    this.host.removeEventListener('pointerdown', this.onDown, { capture: true })
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    window.removeEventListener('pointercancel', this.onUp)
    window.removeEventListener('resize', this.onResize)
    this.renderer.setAnimationLoop(null)
    this.outline.dispose()
    this.controls.dispose()
    for (const [id, e] of this.objects) this.remove(id, e)
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

function applyTransform(node: THREE.Object3D, t: Transform) {
  node.position.set(...t.position)
  if (node.userData.onMarker) node.position.z = MARKER_Z
  node.rotation.set(t.rotation[0] * DEG, t.rotation[1] * DEG, t.rotation[2] * DEG)
  node.scale.setScalar(t.scale)
}

const round = (v: number, k = 1000) => Math.round(v * k) / k

function readTransform(node: THREE.Object3D): Transform {
  return {
    position: [round(node.position.x), round(node.position.y), round(node.position.z)],
    rotation: [round(node.rotation.x / DEG, 10), round(node.rotation.y / DEG, 10), round(node.rotation.z / DEG, 10)],
    scale: round(node.scale.x),
  }
}
