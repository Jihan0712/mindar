import * as THREE from 'three'

/*
 * The selected object's outline in InStudio: a thin white line hugging its
 * silhouette with a soft teal glow outside it (white keeps it readable on
 * dark and teal backgrounds, teal on light ones). Drawn on top, so it shows
 * through objects in front. Editor only; AR never pays for it.
 *
 * How: the object is drawn in white into a small offscreen mask, then a
 * full-screen pass looks around each pixel of the mask: just outside the
 * silhouette → white line, a little further → fading teal.
 */

const TEAL = new THREE.Color('#12a2b8') // teal-500
const MASK_LAYER = 5

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D mask;
  uniform vec2 texel;   // one mask pixel in UV
  uniform float line;   // white line width, mask pixels
  uniform float glow;   // glow width, mask pixels
  uniform vec3 teal;
  varying vec2 vUv;
  void main() {
    float inside = texture2D(mask, vUv).r;
    if (inside > 0.5) discard;
    float near = 0.0; // something within the line width
    float far = 0.0;  // how close the silhouette is, within the glow width
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 0.39269908; // 2π / 16
      vec2 dir = vec2(cos(a), sin(a)) * texel;
      near = max(near, texture2D(mask, vUv + dir * line).r);
      near = max(near, texture2D(mask, vUv + dir * line * 0.5).r);
      far = max(far, texture2D(mask, vUv + dir * glow * 0.5).r * 0.95);
      far = max(far, texture2D(mask, vUv + dir * glow).r * 0.55);
    }
    gl_FragColor = near > 0.5 ? vec4(1.0, 1.0, 1.0, 0.95) : vec4(teal, far);
    #include <colorspace_fragment>
  }
`

export class SelectionOutline {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
  private readonly white = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  private readonly quad: THREE.Mesh
  private readonly quadScene = new THREE.Scene()
  private readonly quadCam = new THREE.Camera()
  private readonly material: THREE.ShaderMaterial
  /** Mask resolution relative to the screen (3/4: smooth edges, still cheap). */
  private readonly k = 0.75

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        mask: { value: this.target.texture },
        texel: { value: new THREE.Vector2() },
        line: { value: 1.6 },
        glow: { value: 5 },
        teal: { value: TEAL },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)
    this.quad.frustumCulled = false
    this.quadScene.add(this.quad)
  }

  setSize(width: number, height: number, pixelRatio: number) {
    const w = Math.max(1, Math.round(width * pixelRatio * this.k))
    const h = Math.max(1, Math.round(height * pixelRatio * this.k))
    this.target.setSize(w, h)
    this.material.uniforms.texel.value.set(1 / w, 1 / h)
    // Same look at any screen density: widths are in CSS pixels.
    this.material.uniforms.line.value = 2 * pixelRatio * this.k
    this.material.uniforms.glow.value = 7 * pixelRatio * this.k
  }

  /** Draws the outline of `node` (part of `scene`) over what the renderer last drew. Call after the main render. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, node: THREE.Object3D, camera: THREE.Camera) {
    // Mask: only this object's meshes (on their own camera layer), in plain white.
    node.traverse((o) => {
      if (o instanceof THREE.Mesh) o.layers.enable(MASK_LAYER) // sprites (sparkles) left out: they'd be squares
    })
    const saved = {
      background: scene.background,
      fog: scene.fog,
      override: scene.overrideMaterial,
      layers: camera.layers.mask,
      clear: renderer.getClearColor(new THREE.Color()),
      clearAlpha: renderer.getClearAlpha(),
      autoClear: renderer.autoClear,
      shadows: renderer.shadowMap.autoUpdate,
    }
    scene.background = null
    scene.fog = null
    scene.overrideMaterial = this.white
    camera.layers.set(MASK_LAYER)
    renderer.shadowMap.autoUpdate = false
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)

    scene.background = saved.background
    scene.fog = saved.fog
    scene.overrideMaterial = saved.override
    camera.layers.mask = saved.layers
    renderer.setClearColor(saved.clear, saved.clearAlpha)
    node.traverse((o) => o.layers.disable(MASK_LAYER))

    // The outline itself, over the finished picture.
    renderer.autoClear = false
    renderer.render(this.quadScene, this.quadCam)
    renderer.autoClear = saved.autoClear
    renderer.shadowMap.autoUpdate = saved.shadows
  }

  dispose() {
    this.target.dispose()
    this.white.dispose()
    this.material.dispose()
    this.quad.geometry.dispose()
  }
}
