/*
 * The link with the native test app (ios/FloorTest): ARKit finds the floor
 * and tracks the phone; this page draws the scene. The app sends every
 * camera frame here (window.__inrlNative.frame) and listens to postMessage.
 * Matrices are 16 numbers, column-major (three.js Matrix4.fromArray), metres,
 * y up.
 */

export interface NativeFrame {
  cam: number[]
  proj: number[]
  /** The floor under the screen centre, or null. */
  hit: number[] | null
  /** The placed scene's anchor as ARKit keeps it, or null. */
  anchor: number[] | null
  /** The marker artwork ARKit follows (after `trackImage`): its centre (x right, y out of the print, -z towards its top) and estimated width in metres; null until seen. Version 2+. */
  image?: { id: string; m: number[]; w: number; tracked: boolean } | null
  /** "normal", or why tracking is limited. */
  track: string
  planes: number
  /** ARKit's light estimate (1000 = neutral), or null. */
  light: number | null
  /** Low Power Mode is on. Version 2+. */
  lowPower?: boolean
  /** When the app sent it, ms since 1970 (to measure the bridge's delay). */
  sent: number
}

interface NativeHooks {
  frame(f: NativeFrame): void
  raycastResult(id: number, m: number[] | null): void
  error(message: string): void
  /** A QR code in the camera picture (its text). Version 2+. */
  qr(text: string): void
}

declare global {
  interface Window {
    __inrlNativeApp?: { version: number }
    __inrlNative?: NativeHooks
    webkit?: { messageHandlers?: { inrl?: { postMessage(msg: unknown): void } } }
  }
}

/** True inside the test app's web view. */
export const inNativeApp = () => !!window.__inrlNativeApp

/**
 * The app's bridge version: 1 = the first floor test (opens /floor, camera
 * always on); 2 = shows the whole web app, camera only while a page listens
 * ('ready' … 'stop'), opens links `inrlfloor://open?path=…#key`.
 */
export const nativeVersion = () => window.__inrlNativeApp?.version ?? 0

export function post(msg: { type: string; [k: string]: unknown }) {
  window.webkit?.messageHandlers?.inrl?.postMessage(msg)
}

/** Starts receiving frames; returns a stop function. */
export function listen(onFrame: (f: NativeFrame) => void, onError: (m: string) => void, onQr: (text: string) => void = () => {}) {
  window.__inrlNative = {
    frame: onFrame,
    raycastResult: () => {},
    error: onError,
    qr: onQr,
  }
  post({ type: 'ready' })
  return () => {
    delete window.__inrlNative
    post({ type: 'stop' })
  }
}

/** The link that hands this phone's scene key from Safari to the test app. */
export const appLink = (key: string) => `inrlfloor://link#${key}`

/** Opens a page of the web app in the test app (version 2), signed in as this phone. */
export const openInAppLink = (path: string, key: string) => `inrlfloor://open?path=${encodeURIComponent(path)}#${key}`
