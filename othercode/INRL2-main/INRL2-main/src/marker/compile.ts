/*
 * Compiles a marker picture into MindAR's .mind tracking data, in the
 * browser (MindAR's own compiler: TensorFlow.js on WebGL plus a worker).
 */

/** Below this many matching points a printed marker detects slowly or not at all. */
export const MIN_MATCHING = 250

/** Side, in pixels, the artwork is downscaled to before compiling. */
export const COMPILE_SIZE = 768

export interface CompiledMarker {
  /** The .mind file contents. */
  mind: Uint8Array
  /** Feature points used to find the marker (all scales). */
  matching: number
  /** Feature points used to follow it once found. */
  tracking: number
  /** Compile time in milliseconds. */
  ms: number
}

interface CompiledTarget {
  matchingData: { maximaPoints: unknown[]; minimaPoints: unknown[] }[]
  trackingData: { points: unknown[] }[]
}

function square(image: HTMLCanvasElement, side: number): HTMLCanvasElement {
  if (image.width === side && image.height === side) return image
  const c = document.createElement('canvas')
  c.width = c.height = side
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D is not available')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // Centre-crop to a square, then scale.
  const s = Math.min(image.width, image.height)
  ctx.drawImage(image, (image.width - s) / 2, (image.height - s) / 2, s, s, 0, 0, side, side)
  return c
}

/**
 * Compiles `image` (downscaled to `size`, default COMPILE_SIZE, kept square).
 * `onProgress` gets 0–100. Check `matching >= MIN_MATCHING` before using it.
 */
export async function compileMarker(
  image: HTMLCanvasElement,
  onProgress?: (percent: number) => void,
  size: number = COMPILE_SIZE,
): Promise<CompiledMarker> {
  const t0 = performance.now()
  const input = square(image, Math.min(size, image.width, image.height))
  const { Compiler } = await import('mind-ar/dist/mindar-image.prod.js')
  const compiler = new Compiler()
  // MindAR only reads width, height and drawImage() from its "images", so a canvas works.
  await compiler.compileImageTargets([input as unknown as HTMLImageElement], (p) => onProgress?.(Math.min(100, p)))
  const mind = new Uint8Array(compiler.exportData())
  const t = (compiler as unknown as { data: CompiledTarget[] }).data[0]
  return {
    mind,
    matching: t.matchingData.reduce((n, d) => n + d.maximaPoints.length + d.minimaPoints.length, 0),
    tracking: t.trackingData.reduce((n, d) => n + d.points.length, 0),
    ms: Math.round(performance.now() - t0),
  }
}
