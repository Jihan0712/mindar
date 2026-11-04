import * as THREE from 'three'

/*
 * Die-cut stickers with thickness ("2D assets in 3D space", Designers world).
 * Anything drawn on a canvas (a letter, an emoji, later a user's drawing)
 * becomes a thick cut-out: its outline is traced from the picture's
 * transparency, extruded, and the picture is printed on the front.
 */

type Pt = [number, number]

const MASK_MAX = 160 // outline is traced on a downscaled copy: plenty for a smooth edge

export interface StickerOptions {
  /** Height of the sticker in scene units. */
  height: number
  /** Thickness in scene units. */
  depth: number
  /** Colour of the cut edge and the back (default: white, like vinyl). */
  edgeColor?: string
  /** Colour behind the artwork inside the cut line (default: ink). */
  backing?: string
}

export function stickerFromCanvas(canvas: HTMLCanvasElement, { height, depth, edgeColor = '#f7f5f0', backing = '#141218' }: StickerOptions) {
  // The top-left pixel colours the back (see the UV generator below).
  const cctx = canvas.getContext('2d')!
  cctx.fillStyle = edgeColor
  cctx.fillRect(0, 0, 1, 1)
  const W = canvas.width
  const H = canvas.height
  const k = Math.min(1, MASK_MAX / Math.max(W, H))
  const mw = Math.max(2, Math.round(W * k))
  const mh = Math.max(2, Math.round(H * k))
  const small = document.createElement('canvas')
  small.width = mw
  small.height = mh
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(canvas, 0, 0, mw, mh)
  const data = sctx.getImageData(0, 0, mw, mh).data
  const mask = new Uint8Array(mw * mh)
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0

  const loops = traceContours(solidify(mask, mw, mh), mw, mh)
  if (!loops.length) throw new Error('Sticker has no visible pixels')
  // Keep the outer outline only: a sticker is one piece of vinyl.
  const outline = loops.reduce((best, l) => (Math.abs(area(l)) > Math.abs(area(best)) ? l : best))
  const smooth = chaikin(simplify(outline, 0.6), 2)

  // Fill everything inside the cut line behind the artwork (holes in an "A",
  // the middle of a donut), so the cut-out is one solid printed piece.
  cctx.save()
  cctx.globalCompositeOperation = 'destination-over'
  cctx.fillStyle = backing
  cctx.beginPath()
  smooth.forEach(([px, py], i) => (i ? cctx.lineTo(px / k, py / k) : cctx.moveTo(px / k, py / k)))
  cctx.closePath()
  cctx.fill()
  cctx.restore()

  // Mask pixels → scene units, y up, centred.
  const s = height / mh
  const toScene = ([x, y]: Pt) => new THREE.Vector2((x - mw / 2) * s, (mh / 2 - y) * s)
  const pts = smooth.map(toScene)
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse()
  const shape = new THREE.Shape(pts)

  const sw = mw * s
  const sh = mh * s
  const uvFront = (x: number, y: number) => new THREE.Vector2(x / sw + 0.5, y / sh + 0.5)
  const uvGenerator = {
    generateTopUV(_g: THREE.ExtrudeGeometry, v: number[], a: number, b: number, c: number) {
      // The back is plain: point it at the edge-coloured corner pixel.
      if (v[a * 3 + 2] < depth / 2) return [0, 0, 0].map(() => new THREE.Vector2(0.5 / W, 1 - 0.5 / H))
      return [a, b, c].map((i) => uvFront(v[i * 3], v[i * 3 + 1]))
    },
    generateSideWallUV() {
      return [0, 0, 0, 0].map(() => new THREE.Vector2(0.5 / W, 1 - 0.5 / H))
    },
  }

  const bevel = depth * 0.3
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.6,
    bevelOffset: -bevel * 0.6,
    bevelSegments: 2,
    curveSegments: 1,
    UVGenerator: uvGenerator as unknown as THREE.UVGenerator,
  })
  geo.translate(0, 0, -depth / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  const face = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.3 })
  const edge = new THREE.MeshStandardMaterial({ color: edgeColor, roughness: 0.6 })
  const mesh = new THREE.Mesh(geo, [face, edge])
  mesh.castShadow = true
  return mesh
}

/** Ink used for keylines, like the outline in an illustration. */
export const INK = '#141218'

export type Treatment = 'stripes' | 'dots' | 'checker' | 'marquee' | 'halftone' | 'windows' | 'mural'
export const TREATMENTS: Treatment[] = ['stripes', 'marquee', 'dots', 'mural', 'checker', 'halftone', 'windows']

/**
 * Collage letter artwork (Designers, after deck slide 17): every letter is
 * its own little illustration (stripes, marquee bulbs, polka dots, a mural
 * outline…) with an ink keyline, cut out along that keyline.
 */
export function collageLetterCanvas(ch: string, font: string, treatment: Treatment, base: string, accent: string) {
  const px = 260
  const key = 9 // keyline half-width
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')!
  ctx.font = `${px}px ${font}`
  const m = ctx.measureText(ch)
  const w = Math.ceil(m.actualBoundingBoxLeft + m.actualBoundingBoxRight)
  const asc = Math.ceil(m.actualBoundingBoxAscent)
  const desc = Math.ceil(m.actualBoundingBoxDescent)
  const pad = key + 6
  c.width = w + pad * 2
  c.height = asc + desc + pad * 2
  const x = pad + m.actualBoundingBoxLeft
  const y = pad + asc
  const setFont = (g: CanvasRenderingContext2D) => (g.font = `${px}px ${font}`)

  // 1. Keyline: the letter grown by an ink stroke. This is also the cut line.
  setFont(ctx)
  ctx.lineJoin = 'round'
  ctx.lineWidth = key * 2
  ctx.strokeStyle = INK
  ctx.strokeText(ch, x, y)
  ctx.fillStyle = INK
  ctx.fillText(ch, x, y)

  // 2. The fill pattern, clipped to the letter.
  const fill = document.createElement('canvas')
  fill.width = c.width
  fill.height = c.height
  const f = fill.getContext('2d')!
  paintTreatment(f, treatment, c.width, c.height, base, accent)
  f.globalCompositeOperation = 'destination-in'
  setFont(f)
  f.fillText(ch, x, y)
  ctx.drawImage(fill, 0, 0)

  // 3. Finishing touches that follow the letter's shape.
  if (treatment === 'mural') {
    // White hand-painted line just inside the edge (deck slide 14).
    const line = document.createElement('canvas')
    line.width = c.width
    line.height = c.height
    const l = line.getContext('2d')!
    setFont(l)
    l.lineJoin = 'round'
    l.lineWidth = 22
    l.strokeStyle = '#fff'
    l.strokeText(ch, x, y)
    l.lineWidth = 10
    l.globalCompositeOperation = 'destination-out'
    l.strokeText(ch, x, y)
    l.globalCompositeOperation = 'destination-in'
    l.fillText(ch, x, y)
    ctx.drawImage(line, 0, 0)
  }
  // A soft highlight along the top-left, like printed card catching light.
  const shine = ctx.createLinearGradient(0, 0, c.width * 0.6, c.height)
  shine.addColorStop(0, 'rgba(255,255,255,0.22)')
  shine.addColorStop(0.5, 'rgba(255,255,255,0)')
  const sh = document.createElement('canvas')
  sh.width = c.width
  sh.height = c.height
  const shc = sh.getContext('2d')!
  shc.fillStyle = shine
  shc.fillRect(0, 0, c.width, c.height)
  shc.globalCompositeOperation = 'destination-in'
  setFont(shc)
  shc.fillText(ch, x, y)
  ctx.drawImage(sh, 0, 0)
  return c
}

function paintTreatment(g: CanvasRenderingContext2D, t: Treatment, w: number, h: number, base: string, accent: string) {
  g.fillStyle = base
  g.fillRect(0, 0, w, h)
  g.fillStyle = accent
  switch (t) {
    case 'stripes': {
      g.save()
      g.rotate(-0.5)
      for (let i = -h * 2; i < w * 2; i += 44) g.fillRect(i, -h, 22, h * 4)
      g.restore()
      break
    }
    case 'dots':
      for (let yy = 0, r = 0; yy < h + 40; yy += 38, r++) for (let xx = r % 2 ? 19 : 0; xx < w + 40; xx += 38) {
        g.beginPath()
        g.arc(xx, yy, 10, 0, Math.PI * 2)
        g.fill()
      }
      break
    case 'checker':
      for (let yy = 0; yy < h; yy += 36) for (let xx = 0; xx < w; xx += 36) if (((xx + yy) / 36) % 2 === 0) g.fillRect(xx, yy, 36, 36)
      break
    case 'marquee':
      // Theatre-sign bulbs: warm glow, white core.
      for (let yy = 30; yy < h; yy += 56) for (let xx = 30; xx < w; xx += 56) {
        const glow = g.createRadialGradient(xx, yy, 2, xx, yy, 24)
        glow.addColorStop(0, 'rgba(255,240,170,1)')
        glow.addColorStop(1, 'rgba(255,200,60,0)')
        g.fillStyle = glow
        g.fillRect(xx - 24, yy - 24, 48, 48)
        g.fillStyle = '#fffdf2'
        g.beginPath()
        g.arc(xx, yy, 11, 0, Math.PI * 2)
        g.fill()
      }
      break
    case 'halftone': {
      // Riso-print gradient: dots grow towards the bottom.
      for (let yy = 0; yy < h + 20; yy += 18) for (let xx = 0; xx < w + 20; xx += 18) {
        g.beginPath()
        g.arc(xx + ((yy / 18) % 2) * 9, yy, 1 + (yy / h) * 8, 0, Math.PI * 2)
        g.fill()
      }
      break
    }
    case 'windows':
      // A little building facade.
      for (let yy = 22; yy < h; yy += 50) for (let xx = 18; xx < w; xx += 40) {
        g.fillStyle = accent
        g.fillRect(xx, yy, 22, 30)
        g.fillStyle = INK
        g.fillRect(xx + 10, yy, 2, 30)
      }
      break
    case 'mural':
      g.fillStyle = INK
      g.fillRect(0, 0, w, h)
      break
  }
}

/** Artwork for an image (emoji) cut out with a thin ink keyline around its silhouette. */
export function imageCanvas(img: CanvasImageSource & { width: number; height: number }, size = 260, border = 9, color = INK) {
  const c = document.createElement('canvas')
  c.width = c.height = size + border * 2 + 8
  const ctx = c.getContext('2d')!
  // Silhouette of the image in the border colour, stamped in a ring to grow it.
  const sil = document.createElement('canvas')
  sil.width = sil.height = size
  const s = sil.getContext('2d')!
  s.drawImage(img, 0, 0, size, size)
  s.globalCompositeOperation = 'source-in'
  s.fillStyle = color
  s.fillRect(0, 0, size, size)
  const o = border + 4
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2
    for (const r of [border, border * 0.5]) ctx.drawImage(sil, o + Math.cos(t) * r, o + Math.sin(t) * r)
  }
  ctx.drawImage(sil, o, o)
  ctx.drawImage(img, o, o, size, size)
  return c
}

/**
 * One solid piece: close hairline gaps (grow by a pixel), fill every hole
 * (anything the outside can't reach), then shrink back.
 */
export function solidify(mask: Uint8Array, w: number, h: number) {
  const grow = (m: Uint8Array, on: number) => {
    const out = m.slice()
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (m[y * w + x] === on) continue
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && m[ny * w + nx] === on) {
          out[y * w + x] = on
          break
        }
      }
    }
    return out
  }
  const closed = grow(grow(mask, 1), 1)
  // Flood the outside from the border; whatever it can't reach is inside.
  const outside = new Uint8Array(w * h)
  const stack: number[] = []
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1)
  while (stack.length) {
    const i = stack.pop()!
    if (outside[i] || closed[i]) continue
    outside[i] = 1
    const x = i % w
    const y = (i - x) / w
    if (x > 0) stack.push(i - 1)
    if (x < w - 1) stack.push(i + 1)
    if (y > 0) stack.push(i - w)
    if (y < h - 1) stack.push(i + w)
  }
  const filled = new Uint8Array(w * h)
  for (let i = 0; i < filled.length; i++) filled[i] = outside[i] ? 0 : 1
  return grow(grow(filled, 0), 0)
}

/**
 * Marching squares: outlines of the 1-regions of a binary mask, as closed
 * loops in pixel coordinates (pixel centres at integer + 0.5).
 */
export function traceContours(mask: Uint8Array, w: number, h: number): Pt[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x])
  // Edge midpoints as integer keys on a doubled grid (shifted so -1 cells fit).
  const W2 = 2 * w + 4
  const key = (X: number, Y: number) => (Y + 2) * W2 + (X + 2)
  const links = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    ;(links.get(a) ?? links.set(a, []).get(a)!).push(b)
    ;(links.get(b) ?? links.set(b, []).get(b)!).push(a)
  }
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = at(x, y)
      const tr = at(x + 1, y)
      const br = at(x + 1, y + 1)
      const bl = at(x, y + 1)
      const code = tl * 8 + tr * 4 + br * 2 + bl
      if (code === 0 || code === 15) continue
      const T = key(2 * x + 1, 2 * y)
      const R = key(2 * x + 2, 2 * y + 1)
      const B = key(2 * x + 1, 2 * y + 2)
      const L = key(2 * x, 2 * y + 1)
      switch (code) {
        case 1: case 14: link(L, B); break
        case 2: case 13: link(B, R); break
        case 3: case 12: link(L, R); break
        case 4: case 11: link(T, R); break
        case 6: case 9: link(T, B); break
        case 7: case 8: link(L, T); break
        case 5: link(L, T); link(B, R); break // saddles: keep diagonal pixels apart
        case 10: link(T, R); link(L, B); break
      }
    }
  }
  const toPt = (k: number): Pt => {
    const X = (k % W2) - 2
    const Y = Math.floor(k / W2) - 2
    return [X / 2 + 0.5, Y / 2 + 0.5]
  }
  const used = new Set<number>()
  const loops: Pt[][] = []
  for (const start of links.keys()) {
    if (used.has(start)) continue
    const loop: Pt[] = []
    let prev = -1
    let cur = start
    while (!used.has(cur)) {
      used.add(cur)
      loop.push(toPt(cur))
      const next = links.get(cur)!.find((n) => n !== prev && !used.has(n))
      if (next === undefined) break
      prev = cur
      cur = next
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

function area(l: Pt[]) {
  let a = 0
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) a += l[j][0] * l[i][1] - l[i][0] * l[j][1]
  return a / 2
}

/** Ramer–Douglas–Peucker on a closed loop. */
export function simplify(loop: Pt[], tol: number): Pt[] {
  if (loop.length < 8) return loop
  const rdp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts
    const [ax, ay] = pts[0]
    const [bx, by] = pts[pts.length - 1]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    let max = 0
    let idx = 0
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
      if (d > max) {
        max = d
        idx = i
      }
    }
    if (max <= tol) return [pts[0], pts[pts.length - 1]]
    return [...rdp(pts.slice(0, idx + 1)).slice(0, -1), ...rdp(pts.slice(idx))]
  }
  const half = Math.floor(loop.length / 2)
  const a = rdp(loop.slice(0, half + 1))
  const b = rdp([...loop.slice(half), loop[0]])
  return [...a.slice(0, -1), ...b.slice(0, -1)]
}

/** Corner-cutting smoothing on a closed loop. */
export function chaikin(loop: Pt[], iterations: number): Pt[] {
  let pts = loop
  for (let it = 0; it < iterations; it++) {
    const out: Pt[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    pts = out
  }
  return pts
}
