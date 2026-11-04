import * as THREE from 'three'

/*
 * The look-test material library, one recipe per world (see
 * docs/design/art-direction.md). Every texture here is generated in code.
 */

/** Liquid chrome with an oil-slick (thin-film) shimmer that shows at grazing angles. */
export function chrome() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.07,
    iridescence: 0.75,
    iridescenceIOR: 1.9,
    iridescenceThicknessRange: [250, 900],
  })
}

/** Glass: reflections and a faint tint, no real refraction (too heavy for phones). */
export function glass() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xe6eeff,
    metalness: 0,
    roughness: 0.03,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    specularIntensity: 1,
    envMapIntensity: 2.2,
    iridescence: 0.5,
    iridescenceIOR: 1.5,
    iridescenceThicknessRange: [300, 700],
  })
}

/** Glossy inflated vinyl. `foil` makes it read like a metallic party balloon. */
export function balloon(foil: boolean) {
  return new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    metalness: foil ? 0.75 : 0.05,
    roughness: foil ? 0.12 : 0.22,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    iridescence: foil ? 0.35 : 0,
  })
}

let fingerprint: THREE.Texture | null = null

/** Plasticine: soft satin with a faint sheen and fingerprint dents. */
export function clay(color: THREE.ColorRepresentation) {
  fingerprint ??= fingerprintNormalMap()
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.62,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffffff),
    normalMap: fingerprint,
    normalScale: new THREE.Vector2(0.55, 0.55),
  })
}

/**
 * A tiling normal map with shallow fingerprint whorls and thumb dents, so
 * clay looks hand-pressed. Built from a height field (sum of ridged rings and
 * soft bumps), converted to normals.
 */
function fingerprintNormalMap(size = 256) {
  const hgt = new Float32Array(size * size)
  const rand = mulberry32(7)
  const prints = Array.from({ length: 5 }, () => ({ x: rand() * size, y: rand() * size, r: size * (0.12 + rand() * 0.1), a: rand() * Math.PI }))
  const dents = Array.from({ length: 14 }, () => ({ x: rand() * size, y: rand() * size, r: size * (0.04 + rand() * 0.08) }))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      for (const p of prints) {
        // Wrap distances so the texture tiles.
        let dx = Math.abs(x - p.x)
        let dy = Math.abs(y - p.y)
        dx = Math.min(dx, size - dx)
        dy = Math.min(dy, size - dy)
        const ex = dx * Math.cos(p.a) + dy * Math.sin(p.a)
        const ey = (-dx * Math.sin(p.a) + dy * Math.cos(p.a)) * 1.35
        const d = Math.hypot(ex, ey)
        if (d < p.r) v += Math.sin(d * 1.15) * 0.5 * (1 - d / p.r)
      }
      for (const dnt of dents) {
        let dx = Math.abs(x - dnt.x)
        let dy = Math.abs(y - dnt.y)
        dx = Math.min(dx, size - dx)
        dy = Math.min(dy, size - dy)
        const d2 = (dx * dx + dy * dy) / (dnt.r * dnt.r)
        if (d2 < 1) v -= (1 - d2) * (1 - d2) * 3
      }
      hgt[y * size + x] = v + (rand() - 0.5) * 0.15
    }
  }
  const img = new ImageData(size, size)
  const h = (x: number, y: number) => hgt[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (h(x - 1, y) - h(x + 1, y)) * 0.5
      const ny = (h(x, y + 1) - h(x, y - 1)) * 0.5
      const len = Math.hypot(nx, ny, 1)
      const i = (y * size + x) * 4
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  const c = document.createElement('canvas')
  c.width = c.height = size
  c.getContext('2d')!.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(2, 2)
  tex.userData.shared = true // reused by every clay material; never disposed
  return tex
}

/** Placeholder for the blank toy until a photo is picked: a soft pastel grid. */
export function blankToyTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#efeaff'
  ctx.fillRect(0, 0, 512, 512)
  ctx.strokeStyle = '#b9b0e8'
  ctx.lineWidth = 6
  for (let i = 0; i <= 512; i += 64) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i, 512)
    ctx.moveTo(0, i)
    ctx.lineTo(512, i)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
