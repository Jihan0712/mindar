import { MARKER_Z } from '../scene/buildScene'
import type { MediaDisplay, ScreenType } from './screens'

/*
 * Sizes and starting spots for photos and videos in InStudio (marker widths).
 */

export type Format = 'portrait' | 'landscape' | 'square'

/** Phone photos are mostly 9:16 or 3:4, often 16:9, rarely 1:1. */
export function formatOf(aspect: number): Format {
  if (aspect < 0.85) return 'portrait'
  if (aspect > 1.18) return 'landscape'
  return 'square'
}

/**
 * The screen's own picture shape (width / height). Gallery frame and chrome
 * take the shape of the photo; the others have a real device's shape and the
 * picture is cropped to fill it (like a phone's wallpaper).
 */
export const SCREEN_RATIO: Partial<Record<ScreenType, number>> = {
  phone: 9 / 16,
  tablet: 3 / 4,
  'flat-tv': 16 / 9,
  laptop: 16 / 10,
  tv: 4 / 3,
  polaroid: 1,
}

/** Screens offered for each format: the ones made for that shape, then the two that fit any shape. */
export const SCREENS_FOR: Record<Format, ScreenType[]> = {
  portrait: ['phone', 'tablet', 'frame', 'chrome'],
  landscape: ['flat-tv', 'laptop', 'tv', 'frame', 'chrome'],
  square: ['polaroid', 'tv', 'frame', 'chrome'],
}

/** Shape of the visible picture: the screen's own shape, or the media's. */
export function faceAspect(display: MediaDisplay, screen: ScreenType, mediaAspect: number) {
  return display === 'screen' ? (SCREEN_RATIO[screen] ?? mediaAspect) : mediaAspect
}

/**
 * Texture repeat/offset that fills a `faceA`-shaped picture with media of
 * shape `mediaA`, cropping the overflow equally on both sides (CSS "cover").
 */
export function coverCrop(mediaA: number, faceA: number) {
  if (Math.abs(mediaA - faceA) < 1e-3) return { repeat: [1, 1], offset: [0, 0] }
  if (mediaA > faceA) {
    const r = faceA / mediaA
    return { repeat: [r, 1], offset: [(1 - r) / 2, 0] }
  }
  const r = mediaA / faceA
  return { repeat: [1, r], offset: [0, (1 - r) / 2] }
}

/** Width for a picture of this aspect (width / height): on the marker it fills most of the square; elsewhere ~0.6 on the long side. */
export function mediaWidth(display: MediaDisplay, aspect: number) {
  const long = display === 'marker' ? 0.9 : 0.6
  return round(aspect >= 1 ? long : long * aspect)
}

/** Where it starts: centred on the marker, floating a little above the floor, or standing on a free spot. */
export function mediaPosition(display: MediaDisplay, spot: [number, number]): [number, number, number] {
  if (display === 'marker') return [0, 0.5, MARKER_Z]
  return [spot[0], display === 'floating' ? 0.15 : 0, spot[1]]
}

/** Videos cost the most frame rate; keep at most this many per scene for now. */
export const MAX_VIDEOS = 2
/** GIFs are small, silent clips (GIPHY MP4s), much lighter than phone videos. */
export const MAX_GIFS = 4

const round = (v: number) => Math.round(v * 1000) / 1000
