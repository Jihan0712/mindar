/*
 * A personal InRL marker: sticker-bomb artwork in the design-system palette
 * with the owner's QR code on a white card in the middle.
 *
 * The artwork is what MindAR tracks, so it follows docs/marker-guide.md:
 * strong brightness contrast (every sticker has a white rim and a dark
 * shadow), lots of irregular corners, nothing repeating, detail right to
 * the edges. Everything comes from a PRNG seeded by `seed`, so the same
 * seed always draws the same marker. Canvas 2D only, so it runs on iPhone.
 */
import QRCode from 'qrcode'

export interface MarkerArt {
  seed: string
  url: string
  username: string
  /** Pixel size of the square canvas. Default 1024. */
  size?: number
}

// Design-system colours (docs/design/brand.md).
const T900 = '#063137'
const T700 = '#3F7880'
const T600 = '#5697A0'
const T500 = '#12A2B8'
const SAND = '#E2D4CA'
const YELLOW = '#F0DD2B'
const RED = '#DC191A'
const INK = '#384143'
const WHITE = '#FFFFFF'
const CHIP = '#CED6D8'

/** Brightness as MindAR sees it: the plain average of R, G and B. */
function grey(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  return ((n >> 16) + ((n >> 8) & 255) + (n & 255)) / 3
}
const isLight = (hex: string) => grey(hex) > 150
/** A colour that stands out in brightness against `hex`. */
const ink = (hex: string, rand: () => number) => (isLight(hex) ? (rand() < 0.7 ? T900 : INK) : rand() < 0.7 ? WHITE : YELLOW)

/** Seeded PRNG: a 32-bit string hash feeding mulberry32. */
function prng(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  let a = (h ^ (h >>> 16)) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Theme {
  bg: string
  /** Sticker and shape colours; repeats weight the pick. */
  colors: string[]
  /** Background giant-shape colours. */
  giants: string[]
}

// Each marker leans on one theme, so markers differ at a glance.
const THEMES: Theme[] = [
  { bg: SAND, colors: [T900, T500, RED, YELLOW, T900, WHITE, T700], giants: [T600, CHIP, WHITE, YELLOW] },
  { bg: T900, colors: [YELLOW, T500, WHITE, RED, YELLOW, SAND, T600], giants: [T700, INK, T500, T600] },
  { bg: T500, colors: [T900, YELLOW, WHITE, SAND, T900, RED, INK], giants: [T600, T700, CHIP, T900] },
  { bg: CHIP, colors: [INK, RED, T500, YELLOW, T900, WHITE, RED], giants: [WHITE, T600, SAND, T500] },
  { bg: YELLOW, colors: [T900, RED, T500, WHITE, T900, INK, T700], giants: [WHITE, SAND, T500, T600] },
  { bg: WHITE, colors: [T900, T500, RED, YELLOW, INK, T700, T900], giants: [SAND, CHIP, T500, YELLOW] },
]

type Rand = () => number

// ---- Sticker outlines (centred on 0,0, radius ~1, scaled by the caller) ----

function starPath(r: Rand): Path2D {
  const p = new Path2D()
  const n = 4 + Math.floor(r() * 6)
  const inner = 0.35 + r() * 0.25
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2 - Math.PI / 2
    const rr = k % 2 ? inner : 1
    p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  p.closePath()
  return p
}

function burstPath(r: Rand): Path2D {
  const p = new Path2D()
  const n = 11 + Math.floor(r() * 10)
  for (let k = 0; k < n * 2; k++) {
    const a = (k / (n * 2)) * Math.PI * 2
    const rr = k % 2 ? 0.68 + r() * 0.1 : 0.88 + r() * 0.12
    p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  p.closePath()
  return p
}

function blobPath(r: Rand): Path2D {
  const n = 6 + Math.floor(r() * 5)
  const pts: [number, number][] = []
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    const rr = 0.65 + r() * 0.35
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr])
  }
  const p = new Path2D()
  const mid = (i: number) => {
    const [x0, y0] = pts[i % n]
    const [x1, y1] = pts[(i + 1) % n]
    return [(x0 + x1) / 2, (y0 + y1) / 2]
  }
  const [sx, sy] = mid(0)
  p.moveTo(sx, sy)
  for (let k = 1; k <= n; k++) {
    const [cx, cy] = pts[k % n]
    const [mx, my] = mid(k)
    p.quadraticCurveTo(cx, cy, mx, my)
  }
  p.closePath()
  return p
}

function tornPath(r: Rand): Path2D {
  // Torn paper: an irregular polygon with a jagged edge.
  const p = new Path2D()
  const n = 18 + Math.floor(r() * 14)
  const w = 0.7 + r() * 0.3
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    const rr = (k % 2 ? 0.82 : 1) * (0.85 + r() * 0.15)
    p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * w)
  }
  p.closePath()
  return p
}

function boltPath(): Path2D {
  const pts = [[-0.15, -1], [0.45, -1], [0.1, -0.2], [0.5, -0.2], [-0.35, 1], [-0.05, 0.1], [-0.45, 0.1]]
  const p = new Path2D()
  for (const [x, y] of pts) p.lineTo(x, y)
  p.closePath()
  return p
}

function heartPath(): Path2D {
  const p = new Path2D()
  p.moveTo(0, 0.95)
  p.bezierCurveTo(-1.3, 0.05, -0.9, -1.1, 0, -0.4)
  p.bezierCurveTo(0.9, -1.1, 1.3, 0.05, 0, 0.95)
  p.closePath()
  return p
}

function arrowPath(r: Rand): Path2D {
  const t = 0.18 + r() * 0.12
  const pts = [[-1, -t], [0.2, -t], [0.2, -0.55], [1, 0], [0.2, 0.55], [0.2, t], [-1, t]]
  const p = new Path2D()
  for (const [x, y] of pts) p.lineTo(x, y)
  p.closePath()
  return p
}

function crossPath(r: Rand): Path2D {
  const t = 0.22 + r() * 0.14
  const p = new Path2D()
  p.rect(-1, -t, 2, t * 2)
  p.rect(-t, -1, t * 2, 2)
  return p
}

function trianglePath(r: Rand): Path2D {
  const p = new Path2D()
  const skew = (r() - 0.5) * 0.6
  p.moveTo(skew, -1)
  p.lineTo(0.95, 0.75)
  p.lineTo(-0.95, 0.8)
  p.closePath()
  return p
}

function pillPath(): Path2D {
  const p = new Path2D()
  p.roundRect(-1, -0.42, 2, 0.84, 0.42)
  return p
}

function flowerPath(r: Rand): Path2D {
  const p = new Path2D()
  const n = 5 + Math.floor(r() * 4)
  const pr = 0.36 + r() * 0.08
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2
    p.moveTo(Math.cos(a) * (1 - pr) + pr, Math.sin(a) * (1 - pr))
    p.arc(Math.cos(a) * (1 - pr), Math.sin(a) * (1 - pr), pr, 0, Math.PI * 2)
  }
  p.moveTo(0.5, 0)
  p.arc(0, 0, 0.5, 0, Math.PI * 2)
  return p
}

function circlePath(): Path2D {
  const p = new Path2D()
  p.arc(0, 0, 1, 0, Math.PI * 2)
  return p
}

type Kind = 'star' | 'burst' | 'blob' | 'torn' | 'bolt' | 'heart' | 'arrow' | 'cross' | 'triangle' | 'pill' | 'flower' | 'circle' | 'smiley' | 'eye'
const KINDS: Kind[] = ['star', 'burst', 'blob', 'torn', 'bolt', 'heart', 'arrow', 'cross', 'triangle', 'pill', 'flower', 'circle', 'smiley', 'eye']

function kindPath(kind: Kind, r: Rand): Path2D {
  switch (kind) {
    case 'star': return starPath(r)
    case 'burst': return burstPath(r)
    case 'blob': return blobPath(r)
    case 'torn': return tornPath(r)
    case 'bolt': return boltPath()
    case 'heart': return heartPath()
    case 'arrow': return arrowPath(r)
    case 'cross': return crossPath(r)
    case 'triangle': return trianglePath(r)
    case 'pill': return pillPath()
    case 'flower': return flowerPath(r)
    case 'eye': {
      const p = new Path2D()
      p.moveTo(-1, 0)
      p.quadraticCurveTo(0, -0.95, 1, 0)
      p.quadraticCurveTo(0, 0.95, -1, 0)
      p.closePath()
      return p
    }
    default: return circlePath()
  }
}

/** Something on top of a sticker so it carries detail of its own. */
function stickerDetail(ctx: CanvasRenderingContext2D, kind: Kind, fill: string, size: number, r: Rand) {
  const c = ink(fill, r)
  ctx.fillStyle = c
  ctx.strokeStyle = c
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // Line widths below are in sticker units (the sticker is scaled to radius 1).
  if (kind === 'smiley') {
    ctx.beginPath()
    ctx.ellipse(-0.33, -0.22, 0.11, 0.18, 0, 0, Math.PI * 2)
    ctx.ellipse(0.33, -0.22, 0.11, 0.18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = 0.12
    ctx.beginPath()
    ctx.arc(0, 0.05, 0.52, 0.2 * Math.PI, 0.8 * Math.PI)
    ctx.stroke()
  } else if (kind === 'eye') {
    ctx.beginPath()
    ctx.arc(0, 0, 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = isLight(c) ? T900 : WHITE
    ctx.beginPath()
    ctx.arc(0.08, -0.06, 0.16, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'circle' || kind === 'burst' || kind === 'flower') {
    const mode = r()
    if (mode < 0.4) {
      ctx.lineWidth = 0.1
      ctx.beginPath()
      ctx.arc(0, 0, 0.55, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(0, 0, 0.2, 0, Math.PI * 2)
      ctx.fill()
    } else if (mode < 0.75) {
      // A little spiral.
      ctx.lineWidth = 0.09
      ctx.beginPath()
      for (let t = 0; t < 14; t += 0.25) ctx.lineTo(Math.cos(t) * t * 0.04, Math.sin(t) * t * 0.04)
      ctx.stroke()
    } else {
      starInside(ctx, r)
    }
  } else if (kind === 'pill' || kind === 'torn' || kind === 'blob') {
    // Zigzag or a few dots across.
    if (r() < 0.6) {
      ctx.lineWidth = 0.11
      ctx.beginPath()
      const n = 5 + Math.floor(r() * 4)
      for (let k = 0; k <= n; k++) ctx.lineTo(-0.7 + (1.4 * k) / n, k % 2 ? -0.16 : 0.16)
      ctx.stroke()
    } else {
      for (let k = 0; k < 4; k++) {
        ctx.beginPath()
        ctx.arc(-0.55 + k * 0.37 + (r() - 0.5) * 0.08, (r() - 0.5) * 0.25, 0.08 + r() * 0.07, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  } else if (kind === 'star' && size > 60 && r() < 0.6) {
    ctx.beginPath()
    ctx.arc(0, 0, 0.16, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'heart' && r() < 0.6) {
    ctx.lineWidth = 0.1
    ctx.beginPath()
    ctx.arc(0.32, -0.3, 0.18, Math.PI * 1.1, Math.PI * 1.7)
    ctx.stroke()
  }
}

function starInside(ctx: CanvasRenderingContext2D, r: Rand) {
  ctx.save()
  ctx.scale(0.45, 0.45)
  ctx.fill(starPath(r))
  ctx.restore()
}

interface Box { x0: number; y0: number; x1: number; y1: number }
const inBox = (b: Box, x: number, y: number, pad = 0) => x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad

export async function drawMarker(opts: MarkerArt): Promise<HTMLCanvasElement> {
  const size = opts.size ?? 1024
  const r = prng(opts.seed)
  const pick = <T,>(a: T[]): T => a[Math.floor(r() * a.length)]
  const between = (a: number, b: number) => a + r() * (b - a)

  // Load the wordmark font if the page has it; fall back silently.
  try {
    await document.fonts?.load('700 40px Roboto')
  } catch {
    /* system font is fine */
  }

  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  // Draw in a fixed 1024 space so every size shows the same picture.
  const S = 1024
  ctx.scale(size / S, size / S)

  const theme = pick(THEMES)
  // Per-marker personality: a favourite set of sticker kinds, a density and
  // a main direction for bands and squiggles.
  const favourites = KINDS.filter(() => r() < 0.45)
  while (favourites.length < 4) favourites.push(pick(KINDS))
  const density = between(0.85, 1.2)
  const flow = r() * Math.PI
  const shadow = isLight(theme.bg) ? T900 : '#021417'

  // QR card geometry (needed early so small confetti can avoid it).
  const qr = QRCode.create(opts.url, { errorCorrectionLevel: 'M' })
  const n = qr.modules.size
  const mod = Math.max(6, Math.floor(350 / n))
  const qrPx = mod * n
  const quiet = Math.max(3 * mod, 28)
  const textH = 64
  const cardW = qrPx + quiet * 2
  const cardH = cardW + textH - 14
  const cardX = (S - cardW) / 2
  const cardY = (S - cardH) / 2 - 6
  const card: Box = { x0: cardX, y0: cardY, x1: cardX + cardW, y1: cardY + cardH }

  // 1–2. The base the tracker follows: the recipe of the step-1 test marker
  // (found and followed in every fake-camera test), in this marker's theme:
  // irregular polygons in contrasting brightness, then pen strokes, then
  // small dots and squares. Stickers and squiggles come on top as accents.
  const light = isLight(theme.bg)
  ctx.fillStyle = theme.bg
  ctx.fillRect(0, 0, S, S)
  const polyColors = [...theme.giants, ...theme.colors].filter((c) => c !== theme.bg)
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = pick(polyColors)
    ctx.beginPath()
    const cx = r() * S
    const cy = r() * S
    const rad = 30 + r() * 120
    const k = 5 + Math.floor(r() * 6)
    for (let j = 0; j < k; j++) {
      const a = (j / k) * Math.PI * 2
      const rr = rad * (0.5 + r() * 0.7)
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fill()
  }
  const penColors = light ? [T900, WHITE, INK, YELLOW] : [WHITE, YELLOW, T900, SAND]
  ctx.lineJoin = 'miter'
  ctx.lineCap = 'butt'
  for (let i = 0; i < 160; i++) {
    ctx.strokeStyle = pick(penColors)
    ctx.lineWidth = 2 + r() * 7
    ctx.beginPath()
    let x = r() * S
    let y = r() * S
    ctx.moveTo(x, y)
    for (let k = 0; k < 4; k++) {
      x += (r() - 0.5) * 120
      y += (r() - 0.5) * 120
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = pick(light ? [T900, WHITE, T500, INK] : [WHITE, YELLOW, T500, T900])
    const sz = 3 + r() * 14
    if (r() < 0.5) {
      ctx.beginPath()
      ctx.arc(r() * S, r() * S, sz / 2, 0, Math.PI * 2)
      ctx.fill()
    } else ctx.fillRect(r() * S, r() * S, sz, sz)
  }

  // 3. Stickers: white rim, hard dark shadow, a detail on top.
  const placeSticker = (x: number, y: number, rad: number, kind: Kind) => {
    const fill = pick(theme.colors.filter((c) => c !== theme.bg))
    const path = kindPath(kind, r)
    const rim = Math.max(5, rad * 0.11)
    const off = Math.max(4, rad * 0.09)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(r() * Math.PI * 2)
    ctx.lineJoin = 'round'
    // Shadow (stroke + fill so it includes the rim).
    ctx.save()
    ctx.translate(off, off)
    ctx.scale(rad, rad)
    ctx.fillStyle = ctx.strokeStyle = shadow
    ctx.lineWidth = (rim * 2) / rad
    ctx.stroke(path)
    ctx.fill(path)
    ctx.restore()
    ctx.save()
    ctx.scale(rad, rad)
    // An ink keyline in contrasting brightness (an all-white rim on every
    // sticker repeats the same edge everywhere, which the tracker loses).
    ctx.strokeStyle = ink(fill, r)
    ctx.lineWidth = rim / rad
    ctx.stroke(path)
    ctx.fillStyle = fill
    ctx.fill(path)
    stickerDetail(ctx, kind, fill, rad, r)
    ctx.restore()
    ctx.restore()
  }

  const big = Math.round(between(4, 6) * density)
  for (let i = 0; i < big; i++) {
    placeSticker(between(-30, S + 30), between(-30, S + 30), between(70, 135), r() < 0.75 ? pick(favourites) : pick(KINDS))
  }

  // 4. Bold squiggles, zigzags and spirals with a dark core or outline.
  const lines = Math.round(between(5, 8) * density)
  for (let i = 0; i < lines; i++) {
    ctx.save()
    ctx.translate(between(0, S), between(0, S))
    ctx.rotate(flow + between(-1.2, 1.2))
    const color = pick(theme.colors)
    const w = between(9, 18)
    const style = r()
    const path = new Path2D()
    if (style < 0.45) {
      const len = between(160, 380)
      const amp = between(14, 34)
      const waves = between(1.5, 4)
      for (let x = -len / 2; x <= len / 2; x += 6) path.lineTo(x, Math.sin((x / len) * waves * Math.PI * 2) * amp)
    } else if (style < 0.8) {
      // A hand-drawn zigzag: every tooth a little different.
      const n2 = 4 + Math.floor(r() * 6)
      let x = -n2 * 18
      for (let k = 0; k <= n2; k++) {
        path.lineTo(x, (k % 2 ? -1 : 1) * between(12, 34))
        x += between(22, 50)
      }
    } else {
      for (let t = 0; t < 16; t += 0.2) path.lineTo(Math.cos(t) * t * 4.2, Math.sin(t) * t * 4.2)
    }
    ctx.lineCap = 'round'
    ctx.lineJoin = style >= 0.45 && style < 0.8 ? 'miter' : 'round'
    ctx.strokeStyle = isLight(color) ? T900 : WHITE
    ctx.lineWidth = w + 8
    ctx.stroke(path)
    ctx.strokeStyle = color
    ctx.lineWidth = w
    ctx.stroke(path)
    ctx.restore()
  }

  // 5. Smaller stickers on top.
  const small = Math.round(between(6, 9) * density)
  for (let i = 0; i < small; i++) {
    placeSticker(between(-10, S + 10), between(-10, S + 10), between(26, 62), r() < 0.6 ? pick(favourites) : pick(KINDS))
  }

  // 6. Confetti: dots, sparkles, plus signs, dashes and tiny triangles.
  const confetti = Math.round(120 * density)
  for (let i = 0; i < confetti; i++) {
    const x = between(-5, S + 5)
    const y = between(-5, S + 5)
    if (inBox(card, x, y, 10)) continue
    const s = between(3.5, 13)
    const c = pick([T900, WHITE, YELLOW, INK, T500, RED, T900, WHITE])
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(r() * Math.PI * 2)
    ctx.fillStyle = ctx.strokeStyle = c
    const k = r()
    if (k < 0.4) {
      ctx.beginPath()
      ctx.arc(0, 0, s / 2, 0, Math.PI * 2)
      ctx.fill()
    } else if (k < 0.55) {
      // Four-point sparkle.
      ctx.beginPath()
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * Math.PI * 2
        const rr = j % 2 ? s * 0.25 : s
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
      }
      ctx.fill()
    } else if (k < 0.7) {
      ctx.fillRect(-s, -s * 0.22, s * 2, s * 0.44)
      ctx.fillRect(-s * 0.22, -s, s * 0.44, s * 2)
    } else if (k < 0.85) {
      ctx.lineWidth = Math.max(2.5, s * 0.4)
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(-s, 0)
      ctx.lineTo(s, 0)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(0, -s)
      ctx.lineTo(s * 0.9, s * 0.7)
      ctx.lineTo(-s * 0.9, s * 0.7)
      ctx.fill()
    }
    ctx.restore()
  }

  // 7. The card: hard shadow, white body, QR, @username.
  ctx.save()
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.roundRect(cardX + 10, cardY + 10, cardW, cardH, 24)
  ctx.fill()
  ctx.fillStyle = WHITE
  ctx.strokeStyle = T900
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.roundRect(cardX, cardY, cardW, cardH, 24)
  ctx.fill()
  ctx.stroke()
  const qx = cardX + quiet
  const qy = cardY + quiet
  const modules = new Path2D()
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (qr.modules.get(row, col)) modules.rect(qx + col * mod, qy + row * mod, mod, mod)
    }
  }
  ctx.fillStyle = T900
  ctx.fill(modules)

  // Username, shrunk to fit the card.
  const name = `@${opts.username}`
  const maxW = cardW - 40
  let fs = 38
  const font = (px: number) => `700 ${px}px Roboto, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`
  ctx.font = font(fs)
  while (fs > 18 && ctx.measureText(name).width > maxW) ctx.font = font(--fs)
  let shown = name
  while (shown.length > 2 && ctx.measureText(shown).width > maxW) shown = shown.slice(0, -2) + '…'
  ctx.fillStyle = T900
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(shown, S / 2, qy + qrPx + (cardY + cardH - (qy + qrPx)) / 2 - 2)
  ctx.restore()

  // 8. "InRL" wordmark tag stuck over the card's top edge.
  ctx.save()
  const tagLeft = r() < 0.5
  ctx.translate(tagLeft ? cardX + 70 : cardX + cardW - 70, cardY - 4)
  ctx.rotate(between(-0.16, 0.16))
  ctx.font = `900 30px Roboto, system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif`
  const tw = ctx.measureText('InRL').width + 34
  const tagFill = pick([YELLOW, RED, T500])
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.roundRect(-tw / 2 + 5, -22 + 5, tw, 44, 22)
  ctx.fill()
  ctx.fillStyle = tagFill
  ctx.strokeStyle = WHITE
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.roundRect(-tw / 2, -22, tw, 44, 22)
  ctx.stroke()
  ctx.fill()
  ctx.fillStyle = tagFill === YELLOW ? T900 : WHITE
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('InRL', 0, 2)
  ctx.restore()

  // 9. Cut line.
  ctx.strokeStyle = T900
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, S - 6, S - 6)

  return canvas
}
