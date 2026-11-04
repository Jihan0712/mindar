import * as THREE from 'three'
import { Controller } from 'mind-ar/dist/mindar-image.prod.js'
import { PoseFusion, type AttitudeSource } from './fusion'
import { PoseStats } from './report'
import { PoseSmoother } from './smoothing'

/*
 * Camera + marker tracking + a three.js renderer whose camera matches the
 * phone's. Anything added to `anchor` sits on the marker.
 *
 * This replaces MindAR's own three.js wrapper, which no longer works with
 * current three.js. The pose maths and the camera fitting are MindAR's
 * (src/image-target/three.js), ported as is.
 */

export interface TrackerOptions {
  container: HTMLElement
  /** Compiled marker file (.mind). Optional: `openCamera()` then `track()` sets it later (scanning). */
  targetSrc?: string
  onFound?: () => void
  onLost?: () => void
  /** Smooth out pose jitter without lagging real movement (default on; see ar/smoothing.ts). */
  antiJitter?: boolean
  /**
   * Show the camera frame the marker pose was measured on, instead of the
   * live video (default on). Tracking takes a moment, so the live picture is
   * always a frame or two ahead of the pose; when the phone moves, the scene
   * slid against the print. Locked, picture and scene always match.
   */
  frameLock?: boolean
  /**
   * The phone's orientation over time (the motion sensor). When given, the
   * pose is fused with the gyroscope (ar/fusion.ts): steadier, no lag when
   * the phone turns, and the scene holds through short losses (blur).
   */
  attitude?: AttitudeSource
  /**
   * Ask the camera for HD (1280 × 720) instead of the browser's default
   * (640 × 480 on iPhone Safari). Twice the detail on the print in each
   * direction: a steadier pose, most of all for markers that fill only part
   * of the picture (a poster seen from a step away). Default off: on
   * Nico's iPhone 13 it dropped tracking to 12–30 fps without making the
   * 3D measurably steadier.
   */
  hd?: boolean
}

// MindAR's defaults; the old INRL viewer converged back to these after tuning.
const FILTER_MIN_CF = 0.001
const FILTER_BETA = 1000
const WARMUP_TOLERANCE = 5
const MISS_TOLERANCE = 5

export class MarkerTracker {
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera()
  readonly renderer: THREE.WebGLRenderer
  /** Marker space: origin at the marker's centre, 1 unit = marker width, +Z out of the marker. */
  readonly anchor = new THREE.Group()
  visible = false
  /** Marker width in MindAR's units (pixels of the compiled image). */
  markerWidth = 1

  private video: HTMLVideoElement | null = null
  private controller: Controller | null = null
  private postMatrix = new THREE.Matrix4()
  private readonly smoother = new PoseSmoother()
  private lastRender = 0
  private readonly onResize = () => this.resize()

  private readonly opts: TrackerOptions
  /** Frame lock: two canvases, one shown (front), one being filled with the frame being tracked (back). */
  private frames: HTMLCanvasElement[] = []
  private frameTimes = [0, 0]
  private front = 0
  private captured = false
  /** When MindAR read the frame being processed now (ms). */
  private readTime = 0
  private readonly fusion: PoseFusion | null
  /** Whether the last drawn frame used the gyroscope (for the test readout). */
  gyroActive = false
  /** Steadiness measurements for the preview's "Copy report". */
  readonly stats = new PoseStats()
  private readonly statQ = new THREE.Quaternion()
  private readonly statM = new THREE.Matrix4()
  private readonly statR = new THREE.Matrix4()

  constructor(opts: TrackerOptions) {
    this.opts = opts
    this.fusion = opts.attitude ? new PoseFusion(opts.attitude) : null
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    const canvas = this.renderer.domElement
    Object.assign(canvas.style, { position: 'absolute', inset: '0', zIndex: '1' })
    opts.container.appendChild(canvas)

    this.anchor.visible = false
    this.anchor.matrixAutoUpdate = false
    this.scene.add(this.anchor)
    window.addEventListener('resize', this.onResize)
  }

  /** Opens the back camera and tracks the marker in `targetSrc`. */
  async start() {
    await this.openCamera()
    await this.track(this.opts.targetSrc!)
  }

  /** Opens the back camera. Throws a readable error if the camera is refused. */
  async openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser cannot open the camera. On iPhone, use Safari.')
    }
    const video = document.createElement('video')
    video.setAttribute('autoplay', '')
    video.setAttribute('muted', '')
    video.setAttribute('playsinline', '')
    video.muted = true
    Object.assign(video.style, { position: 'absolute', zIndex: '0' })
    this.opts.container.appendChild(video)
    this.video = video
    if (this.opts.frameLock !== false) {
      // The live video stays in the page (tracking reads it) but is drawn
      // over by the locked frames.
      this.frames = [0, 1].map((i) => {
        const c = document.createElement('canvas')
        Object.assign(c.style, { position: 'absolute', zIndex: '0', visibility: i === 0 ? 'visible' : 'hidden' })
        this.opts.container.appendChild(c)
        return c
      })
    }

    let stream: MediaStream
    try {
      const constraints: MediaTrackConstraints = { facingMode: 'environment' }
      if (this.opts.hd === true) Object.assign(constraints, { width: { ideal: 1280 }, height: { ideal: 720 } })
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: constraints })
    } catch (err) {
      const name = (err as DOMException)?.name
      throw new Error(
        name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow the camera for this site in Settings → Safari → Camera, then reload.'
          : `The camera could not start (${name ?? 'unknown error'}).`,
      )
    }
    await new Promise<void>((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true })
      video.srcObject = stream
    })
    await video.play().catch(() => {})
    video.setAttribute('width', String(video.videoWidth))
    video.setAttribute('height', String(video.videoHeight))
    this.resize()
  }

  /** Starts tracking a marker (its .mind file) in the open camera. One marker per tracker. */
  async track(targetSrc: string) {
    const video = this.video
    if (!video) throw new Error('Open the camera first.')
    if (this.controller) throw new Error('Already tracking a marker.')
    const controller = new Controller({
      inputWidth: video.videoWidth,
      inputHeight: video.videoHeight,
      maxTrack: 1,
      filterMinCF: FILTER_MIN_CF,
      filterBeta: FILTER_BETA,
      warmupTolerance: WARMUP_TOLERANCE,
      missTolerance: MISS_TOLERANCE,
      onUpdate: (data) => {
        if (data.type === 'processDone') this.presentFrame()
        if (data.type !== 'updateMatrix') return
        this.applyPose(data.worldMatrix)
      },
    })
    this.controller = controller
    this.resize()

    const { dimensions } = await controller.addImageTargets(targetSrc)
    // MindAR reports poses in marker pixels with the origin at a corner.
    // Re-centre and rescale so 1 unit = the marker's width.
    const [mw, mh] = dimensions[0]
    this.markerWidth = mw
    this.postMatrix.compose(
      new THREE.Vector3(mw / 2, mw / 2 + (mh - mw) / 2, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(mw, mw, mw),
    )

    for (const c of this.frames) {
      c.width = video.videoWidth
      c.height = video.videoHeight
    }
    // Note when MindAR reads each frame (gyro fusion) and copy it (frame lock).
    const loader = (controller as unknown as { inputLoader: { loadInput(i: HTMLVideoElement): unknown } }).inputLoader
    const load = loader.loadInput.bind(loader)
    loader.loadInput = (input) => {
      if (this.processing) {
        this.readTime = performance.now()
        if (this.frames.length) this.captureFrame(input)
      }
      return load(input)
    }
    await controller.dummyRun(video)
    this.processing = true
    controller.processVideo(video)
  }

  private processing = false

  /** A pose in the room frame (phone's turning removed) when the motion sensor has data. */
  private toRoom(m: THREE.Matrix4, t: number) {
    if (this.opts.attitude?.at(t, this.statQ)) return this.statR.makeRotationFromQuaternion(this.statQ).multiply(m)
    return this.statR.copy(m)
  }

  private recordReading(m: THREE.Matrix4) {
    const t = this.readTime || performance.now()
    this.stats.reading(t, this.statM.copy(this.toRoom(m, t)))
    this.stats.lock = this.fusion?.lock ?? (this.fusion ? 'none' : 'no gyro')
    // Marker width in camera pixels: focal length × width / distance.
    const proj = this.controller?.getProjectionMatrix()
    const depth = Math.abs(m.elements[14])
    if (proj && depth > 0 && this.controller) this.stats.markerPx = (proj[0] * this.controller.inputWidth) / 2 * (this.markerWidth / depth)
  }

  private captureFrame(video: HTMLVideoElement) {
    const back = this.frames[1 - this.front]
    back.getContext('2d')!.drawImage(video, 0, 0, back.width, back.height)
    this.frameTimes[1 - this.front] = this.readTime
    this.captured = true
  }

  /** The camera picture's size, e.g. "720×1280" (for the test readout). */
  get resolution() {
    return this.video ? `${this.video.videoWidth}×${this.video.videoHeight}` : ''
  }

  /** Camera frames tracked per second (= how often the shown picture changes with frame lock). */
  trackFps = 0
  private tracked = 0
  private trackSince = performance.now()

  /** The tracked frame's pose has been applied: show that same frame. */
  private presentFrame() {
    this.tracked++
    const t = performance.now()
    if (t - this.trackSince >= 1000) {
      this.trackFps = Math.round((this.tracked * 1000) / (t - this.trackSince))
      this.tracked = 0
      this.trackSince = t
    }
    if (!this.captured) return
    this.captured = false
    this.front = 1 - this.front
    this.frames[this.front].style.visibility = 'visible'
    this.frames[1 - this.front].style.visibility = 'hidden'
  }

  private applyPose(worldMatrix: number[] | null) {
    const found = worldMatrix !== null
    if (found) {
      const m = new THREE.Matrix4()
      m.fromArray(worldMatrix)
      m.multiply(this.postMatrix)
      // Raw readings for tests (scripts set window.__poseLog = []).
      ;(window as unknown as { __poseLog?: number[][] }).__poseLog?.push(m.toArray())
      // MindAR keeps repeating its last pose for a few frames after it stops
      // finding the marker; with the gyroscope those stale poses would be
      // wrong (the phone has turned since), so let fusion hold the scene.
      const fresh = (this.controller as unknown as { trackingStates?: { isTracking: boolean }[] })?.trackingStates?.[0]?.isTracking !== false
      if (fresh) this.recordReading(m)
      else this.stats.stale++
      if (this.fusion && !fresh) this.fusion.lost(performance.now())
      else if (!this.fusion?.reading(m, this.readTime || performance.now(), !this.visible)) {
        if (this.opts.antiJitter === false) this.anchor.matrix.copy(m)
        else this.smoother.setTarget(m, !this.visible) // snap when (re)found
      }
      this.anchor.matrixWorldNeedsUpdate = true
    } else {
      this.fusion?.lost(performance.now())
      if (this.visible) this.stats.losses++
    }
    this.anchor.visible = found
    if (found !== this.visible) {
      this.visible = found
      if (found) this.opts.onFound?.()
      else this.opts.onLost?.()
    }
  }

  /** The live camera picture (after start), e.g. to build reflections from. */
  get videoElement() {
    return this.video
  }

  render() {
    const now = performance.now()
    const dt = now - this.lastRender
    // With the gyroscope: the pose for the picture on screen (the locked
    // frame's moment, or now), and held through short losses.
    const fusionTime = this.frames.length ? this.frameTimes[this.front] : now
    this.gyroActive = !!this.fusion?.showing(now) && this.fusion.view(fusionTime, dt, this.anchor.matrix)
    if (this.visible && this.anchor.visible) this.stats.drawn(now, this.toRoom(this.anchor.matrix, fusionTime))
    if (this.gyroActive) {
      this.anchor.visible = true
      this.anchor.matrixWorldNeedsUpdate = true
    } else if (this.fusion?.active) {
      // Lost for longer than the gyroscope can bridge.
      this.anchor.visible = false
    } else if (this.visible && this.opts.antiJitter !== false) {
      this.smoother.update(dt, this.anchor.matrix)
      this.anchor.matrixWorldNeedsUpdate = true
    } else if (!this.visible) this.anchor.visible = false
    this.lastRender = now
    this.renderer.render(this.scene, this.camera)
  }

  /** Fits the camera picture to the screen and matches the 3D camera to it (MindAR's maths). */
  resize() {
    const { video, controller, camera, renderer } = this
    const container = this.opts.container
    if (!video) return
    const cw = container.clientWidth
    const ch = container.clientHeight

    let vw: number, vh: number
    const videoRatio = video.videoWidth / video.videoHeight
    const containerRatio = cw / ch
    if (videoRatio > containerRatio) {
      vh = ch
      vw = vh * videoRatio
    } else {
      vw = cw
      vh = vw / videoRatio
    }
    const box = {
      top: `${-(vh - ch) / 2}px`,
      left: `${-(vw - cw) / 2}px`,
      width: `${vw}px`,
      height: `${vh}px`,
    }
    Object.assign(video.style, box)
    for (const c of this.frames) Object.assign(c.style, box)
    renderer.setSize(cw, ch)
    // Before a marker is loaded (scanning for its QR code) there is no 3D camera to match yet.
    if (!controller) return

    const proj = controller.getProjectionMatrix()
    const inputRatio = controller.inputWidth / controller.inputHeight
    const inputAdjust = inputRatio > containerRatio
      ? video.width / controller.inputWidth
      : video.height / controller.inputHeight
    let videoDisplayHeight: number
    if (inputRatio > containerRatio) {
      videoDisplayHeight = ch * inputAdjust
    } else {
      videoDisplayHeight = (cw / controller.inputWidth) * controller.inputHeight * inputAdjust
    }
    const fovAdjust = ch / videoDisplayHeight

    camera.fov = (2 * Math.atan((1 / proj[5]) * fovAdjust) * 180) / Math.PI
    camera.near = proj[14] / (proj[10] - 1.0)
    camera.far = proj[14] / (proj[10] + 1.0)
    camera.aspect = cw / ch
    camera.updateProjectionMatrix()
  }

  stop() {
    window.removeEventListener('resize', this.onResize)
    this.controller?.stopProcessVideo()
    const stream = this.video?.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
    this.video?.remove()
    for (const c of this.frames) c.remove()
    this.renderer.setAnimationLoop(null)
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
