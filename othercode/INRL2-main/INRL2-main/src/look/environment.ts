import * as THREE from 'three'
import type { World } from './worlds'

/*
 * What shiny materials reflect. Chrome has no colour of its own: it is
 * entirely the world around it, so this matters more than any material
 * setting.
 *
 *  - IN3D: a small "photo studio" per world (gradient walls + soft boxes).
 *  - AR: the live camera picture, wrapped around the scene and refreshed a
 *    few times a second, so chrome picks up the real room's colours and light.
 */

interface Studio {
  top: number
  bottom: number
  /** Brightness of the band just above the horizon (what makes chrome read as chrome). */
  horizon: number
  /** Soft boxes: colour (HDR, >1 = brighter than white), position, size. */
  lights: [number, number, [number, number, number], [number, number]][]
}

const STUDIOS: Record<World, Studio> = {
  // Night city: steel-blue sky over a black floor with a sharp bright
  // horizon (the classic chrome look), plus neon strips for coloured rims.
  streetwear: {
    top: 0x5d6678,
    bottom: 0x0b0c10,
    horizon: 0xe8f0ff,
    lights: [
      [0xffffff, 6, [0, 6, 3], [7, 3]],
      [0x00e5ff, 5, [-7, 1.5, 1], [0.8, 7]],
      [0xff2bd6, 5, [7, 1.5, -1], [0.8, 7]],
      [0xffffff, 3, [0, 2.5, -7], [10, 1.2]],
    ],
  },
  // Candy daylight: bright pink and lilac room, big soft sun.
  bubblegum: {
    top: 0xfff0f8,
    bottom: 0xff9fd0,
    horizon: 0xffffff,
    lights: [
      [0xffffff, 3, [2, 6, 3], [6, 6]],
      [0xc8a8ff, 1.6, [-6, 2, 0], [3, 5]],
      [0xffe680, 1.4, [6, 2, -2], [3, 4]],
    ],
  },
  // Flat, even gallery light.
  designers: {
    top: 0xffffff,
    bottom: 0xcfc8ef,
    horizon: 0xffffff,
    lights: [
      [0xffffff, 2.2, [0, 6, 2], [8, 8]],
      [0xffffff, 1.2, [0, 1, 7], [8, 3]],
    ],
  },
}

export function studioEnvironment(renderer: THREE.WebGLRenderer, world: World): THREE.Texture {
  const s = STUDIOS[world]
  const scene = new THREE.Scene()
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(s.top) }, bottom: { value: new THREE.Color(s.bottom) }, horizon: { value: new THREE.Color(s.horizon) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon; varying vec3 vP;
        void main(){
          float y = vP.y;
          vec3 sky = mix(horizon, top, smoothstep(0.0, 0.55, y));
          vec3 ground = mix(horizon * 0.45, bottom, smoothstep(0.0, -0.6, y));
          gl_FragColor = vec4(y > 0.0 ? sky : ground, 1.);
        }`,
    }),
  )
  scene.add(room)
  for (const [color, power, pos, [w, h]] of s.lights) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }))
    panel.position.set(...pos)
    panel.lookAt(0, 0, 0)
    scene.add(panel)
  }
  const pmrem = new THREE.PMREMGenerator(renderer)
  const target = pmrem.fromScene(scene, 0.02)
  pmrem.dispose()
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  return target.texture
}

/**
 * Environment map made from the camera picture. The camera only sees what is
 * in front of the phone, so the picture (and its mirror image) is wrapped all
 * the way round: reflections carry the room's real colours and brightness
 * rather than a true mirror image, the standard trick in web AR.
 */
export class CameraEnvironment {
  texture: THREE.Texture | null = null
  /** How long the last refresh took, for the test readout. */
  lastMs = 0
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly source: THREE.CanvasTexture
  private readonly pmrem: THREE.PMREMGenerator
  private target: THREE.WebGLRenderTarget | null = null
  private last = -Infinity
  private readonly video: HTMLVideoElement
  private readonly intervalMs: number

  constructor(renderer: THREE.WebGLRenderer, video: HTMLVideoElement, intervalMs = 400) {
    this.video = video
    this.intervalMs = intervalMs
    this.canvas.width = 256
    this.canvas.height = 128
    this.ctx = this.canvas.getContext('2d')!
    this.source = new THREE.CanvasTexture(this.canvas)
    this.source.mapping = THREE.EquirectangularReflectionMapping
    this.source.colorSpace = THREE.SRGBColorSpace
    this.pmrem = new THREE.PMREMGenerator(renderer)
  }

  /** Call every frame; refreshes at most every `intervalMs`. Returns true when the map changed. */
  update(now: number): boolean {
    if (now - this.last < this.intervalMs || this.video.readyState < 2) return false
    this.last = now
    const t0 = performance.now()
    const { ctx, video } = this
    const W = this.canvas.width
    const H = this.canvas.height
    // Left half: the picture; right half: its mirror, so the seam matches.
    ctx.drawImage(video, 0, 0, W / 2, H)
    ctx.save()
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, W / 2, H)
    ctx.restore()
    // Plain rooms make chrome look like coloured plastic. Add what a real
    // room nearly always has: brighter light from above, a darker floor and
    // a bright band at eye level, so metal still reads as metal.
    const g = ctx.createLinearGradient(0, 0, 0, H)
    g.addColorStop(0, 'rgba(255,255,255,0.55)')
    g.addColorStop(0.42, 'rgba(255,255,255,0.12)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.45)')
    g.addColorStop(0.56, 'rgba(0,0,0,0.15)')
    g.addColorStop(1, 'rgba(0,0,0,0.6)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    this.source.needsUpdate = true
    const next = this.pmrem.fromEquirectangular(this.source)
    this.target?.dispose()
    this.target = next
    this.texture = next.texture
    this.lastMs = Math.round(performance.now() - t0)
    return true
  }

  dispose() {
    this.target?.dispose()
    this.source.dispose()
    this.pmrem.dispose()
  }
}
