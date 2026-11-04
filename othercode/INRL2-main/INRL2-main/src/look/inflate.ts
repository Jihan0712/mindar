import * as THREE from 'three'
import Delaunator from 'delaunator'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/*
 * "Inflated" geometry: takes flat outlines (letters, a heart…) and puffs them
 * up like a foil balloon. Each point inside the outline is raised by how far
 * it is from the edge, along a circular profile, so thick strokes swell more
 * than thin ones and every edge is rounded, as in the Bubblegum references.
 *
 * Method: sample the outline, scatter a grid of points inside, triangulate
 * (Delaunay), lift by distance-to-edge, mirror for the back.
 */

export interface InflateOptions {
  /** Point spacing, in shape units. Smaller = smoother and heavier. */
  step: number
  /** How puffy: 1 = round as a tube, 0.5 = half as deep. */
  puff?: number
  curveSegments?: number
}

type Pt = [number, number]

export function inflateShapes(shapes: THREE.Shape[], opts: InflateOptions): THREE.BufferGeometry {
  const parts = shapes.map((s) => inflateShape(s, opts)).filter((g): g is THREE.BufferGeometry => g !== null)
  if (!parts.length) return new THREE.BufferGeometry()
  const merged = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return merged
}

export function inflateShape(shape: THREE.Shape, { step, puff = 0.85, curveSegments = 12 }: InflateOptions): THREE.BufferGeometry | null {
  const extracted = shape.extractPoints(curveSegments)
  const loops = [extracted.shape, ...extracted.holes]
    .map((l) => resample(l.map((v) => [v.x, v.y] as Pt), step * 0.5))
    .filter((l) => l.length >= 3)
  if (!loops.length) return null

  const segs = loopSegments(loops)
  const inside = (p: Pt) => pointInLoops(p, loops)
  const dist = (p: Pt) => distToSegments(p, segs)

  // Points: the outline itself, a ring just inside it (keeps edges round),
  // then a staggered grid over the interior.
  const pts: Pt[] = []
  const boundaryCount = loops.reduce((n, l) => n + l.length, 0)
  for (const l of loops) pts.push(...l)

  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const a = l[(i - 1 + l.length) % l.length]
      const b = l[(i + 1) % l.length]
      let nx = -(b[1] - a[1])
      let ny = b[0] - a[0]
      const len = Math.hypot(nx, ny) || 1
      nx /= len
      ny /= len
      for (const k of [0.25, 0.6]) {
        const d = step * k
        let q: Pt = [l[i][0] + nx * d, l[i][1] + ny * d]
        if (!inside(q)) q = [l[i][0] - nx * d, l[i][1] - ny * d]
        if (inside(q) && dist(q) > d * 0.8) pts.push(q)
      }
    }
  }

  const box = new THREE.Box2()
  for (const l of loops) for (const p of l) box.expandByPoint(new THREE.Vector2(p[0], p[1]))
  let row = 0
  for (let y = box.min.y + step / 2; y < box.max.y; y += step * 0.866, row++) {
    for (let x = box.min.x + (row % 2 ? step / 2 : 0); x < box.max.x; x += step) {
      const q: Pt = [x, y]
      if (inside(q) && dist(q) > step * 0.8) pts.push(q)
    }
  }

  const tri = Delaunator.from(pts)
  const faces: number[] = []
  for (let i = 0; i < tri.triangles.length; i += 3) {
    const a = tri.triangles[i]
    const b = tri.triangles[i + 1]
    const c = tri.triangles[i + 2]
    const centroid: Pt = [(pts[a][0] + pts[b][0] + pts[c][0]) / 3, (pts[a][1] + pts[b][1] + pts[c][1]) / 3]
    // Delaunay covers the convex hull; drop triangles outside the outline
    // (between letters' legs, inside holes).
    if (!inside(centroid)) continue
    // Also drop slivers bridging two outline points across a narrow gap.
    if (a < boundaryCount && b < boundaryCount && c < boundaryCount && dist(centroid) < step * 0.05) continue
    faces.push(a, b, c)
  }

  // Height profile: a circle of radius R (the widest point's distance to the
  // edge), so the fattest part becomes a round tube and edges meet vertically.
  const d = pts.map((p, i) => (i < boundaryCount ? 0 : dist(p)))
  const R = Math.max(...d, step)
  const h = d.map((di) => puff * Math.sqrt(Math.max(0, di * (2 * R - di))))

  const n = pts.length
  const pos = new Float32Array(n * 2 * 3)
  const uv = new Float32Array(n * 2 * 2)
  for (let i = 0; i < n; i++) {
    pos.set([pts[i][0], pts[i][1], h[i]], i * 3)
    pos.set([pts[i][0], pts[i][1], -h[i]], (n + i) * 3)
    uv.set([pts[i][0], pts[i][1]], i * 2)
    uv.set([pts[i][0], pts[i][1]], (n + i) * 2)
  }
  const index: number[] = []
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i]
    let b = faces[i + 1]
    let c = faces[i + 2]
    // Wind each front triangle counter-clockwise (facing +z); the back mirrors it.
    const cross = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0])
    if (cross < 0) [b, c] = [c, b]
    index.push(a, b, c)
    index.push(n + a, n + c, n + b)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()

  // Front and back meet at the outline with separate vertices; point those
  // normals straight outwards so the seam is invisible.
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < boundaryCount; i++) {
    for (const j of [i, n + i]) {
      const x = nrm.getX(j)
      const y = nrm.getY(j)
      const len = Math.hypot(x, y) || 1
      nrm.setXYZ(j, x / len, y / len, 0)
    }
  }
  return geo
}

/** Evenly spaced points along a closed outline. */
export function resample(loop: Pt[], spacing: number): Pt[] {
  const pts = loop.slice()
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (first[0] === last[0] && first[1] === last[1]) pts.pop()
  const out: Pt[] = []
  let carry = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    let t = carry
    while (t < len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len])
      t += spacing
    }
    carry = t - len
  }
  return out
}

type Seg = [number, number, number, number]

function loopSegments(loops: Pt[][]): Seg[] {
  const segs: Seg[] = []
  for (const l of loops) for (let i = 0; i < l.length; i++) {
    const a = l[i]
    const b = l[(i + 1) % l.length]
    segs.push([a[0], a[1], b[0], b[1]])
  }
  return segs
}

/** Even-odd rule over all loops, so holes (inside of an "o") count as outside. */
export function pointInLoops(p: Pt, loops: Pt[][]) {
  let inside = false
  for (const l of loops) {
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const [xi, yi] = l[i]
      const [xj, yj] = l[j]
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

function distToSegments(p: Pt, segs: Seg[]) {
  let best = Infinity
  for (const [ax, ay, bx, by] of segs) {
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    let t = l2 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2 : 0
    t = Math.max(0, Math.min(1, t))
    const ex = ax + t * dx - p[0]
    const ey = ay + t * dy - p[1]
    const d2 = ex * ex + ey * ey
    if (d2 < best) best = d2
  }
  return Math.sqrt(best)
}
