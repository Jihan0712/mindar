/*
 * Reading InRL marker QR codes: which marker a link points to, and a small
 * camera-frame QR reader (jsQR) for the scanner.
 */
import jsQR from 'jsqr'

const CODE = /^[a-z0-9]{4,16}$/

/** The marker code in an InRL marker link (path /m/<code>, any host), else null. */
export function markerCode(text: string): string | null {
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const m = /^\/m\/([^/]+)\/?$/.exec(url.pathname)
  if (!m) return null
  // Some QR generators upper-case links; codes themselves are lower-case.
  const code = m[1].toLowerCase()
  return CODE.test(code) ? code : null
}

/**
 * Reads a QR code from the camera picture (downscaled to ~480 px on the long
 * side, jsQR). Calls alternate between the whole picture and its centre
 * (a square of 75% of the short side, kept sharper): people point the camera
 * at the marker, and in a downscaled full frame the QR can be too small.
 */
export class QrReader {
  private canvas = document.createElement('canvas')
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })
  private maxSide: number
  private centre = true

  constructor(maxSide = 480) {
    this.maxSide = maxSide
  }

  /** The QR's text, or null when there is no readable code in this frame. */
  read(source: HTMLVideoElement | HTMLCanvasElement): string | null {
    const ctx = this.ctx
    if (!ctx) return null
    const video = source instanceof HTMLVideoElement
    if (video && source.readyState < 2) return null
    const w = video ? source.videoWidth : source.width
    const h = video ? source.videoHeight : source.height
    if (!w || !h) return null
    this.centre = !this.centre
    const side = Math.round(Math.min(w, h) * 0.75)
    const [sx, sy, sw, sh] = this.centre ? [(w - side) / 2, (h - side) / 2, side, side] : [0, 0, w, h]
    const scale = Math.min(1, this.maxSide / Math.max(sw, sh))
    const cw = Math.round(sw * scale)
    const ch = Math.round(sh * scale)
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw
      this.canvas.height = ch
    }
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch)
    const img = ctx.getImageData(0, 0, cw, ch)
    // InRL codes are dark on a white card, so skip the inverted pass (twice as fast).
    return jsQR(img.data, cw, ch, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}
