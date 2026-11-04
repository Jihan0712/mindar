import { z } from 'zod'
import { MOTIONS } from '../studio/motions'

/*
 * The InRL scene format: what the InStudio editor will save and what every
 * viewer (AR on a marker, IN3D, the feed) reads.
 *
 * Units and axes: 1 unit = the marker's width. The scene stands on the
 * marker: +Y is up (out of the marker), the marker's centre is the origin,
 * and +Z points toward the bottom edge of the marker, where the viewer stands.
 */

const vec3 = z.tuple([z.number(), z.number(), z.number()])

export const transformSchema = z.object({
  position: vec3.default([0, 0, 0]),
  /** Degrees, applied in XYZ order. */
  rotation: vec3.default([0, 0, 0]),
  scale: z.number().positive().default(1),
})

const base = {
  id: z.string(),
  /** A small looping movement (studio/motions.ts). Unset: the library item's own, or none. */
  motion: z.enum(MOTIONS).optional(),
  transform: transformSchema.default({ position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 }),
}

/**
 * Where a photo or video goes (InStudio piece 2): on a 3D `screen` (one of
 * SCREEN_TYPES), `floating` in the air as a thin card, or lying on the
 * `marker` itself. For `marker`, the position's x/y place it on the 1 × 1
 * square (y 0–1, z ignored) and rotation[2] turns it in that plane.
 * Without `display`, step-1 behaviour (image `frame`, video `style`) applies.
 */
export const MEDIA_DISPLAYS = ['screen', 'floating', 'marker'] as const
export const SCREEN_TYPES = ['frame', 'chrome', 'phone', 'tablet', 'flat-tv', 'laptop', 'tv', 'polaroid'] as const
const mediaFields = {
  display: z.enum(MEDIA_DISPLAYS).optional(),
  screen: z.enum(SCREEN_TYPES).optional(),
  /** The media's own shape (width / height), kept so it can be re-placed without reloading it. */
  aspect: z.number().positive().optional(),
}

export const modelObjectSchema = z.object({
  ...base,
  kind: z.literal('model'),
  src: z.string(),
  /** Model is resized so its height equals this, in marker widths. */
  height: z.number().positive().default(0.5),
  /** Name of the animation clip to loop, or true for the first clip. */
  animation: z.union([z.string(), z.boolean()]).default(false),
})

export const imageObjectSchema = z.object({
  ...base,
  kind: z.literal('image'),
  src: z.string(),
  /** Width of the picture in marker widths; height follows the image. */
  width: z.number().positive().default(0.5),
  frame: z.boolean().default(true),
  ...mediaFields,
})

export const videoObjectSchema = z.object({
  ...base,
  kind: z.literal('video'),
  src: z.string(),
  width: z.number().positive().default(0.5),
  /** "screen" is a 3D box with the video on its front; "flat" is a bare panel. */
  style: z.enum(['screen', 'flat']).default('screen'),
  loop: z.boolean().default(true),
  /** Whether this video's sound plays (InStudio keeps it to one video per scene). */
  sound: z.boolean().default(true),
  /** A looping GIF from GIPHY (its MP4); silent, and counted apart from videos. */
  gif: z.boolean().default(false),
  ...mediaFields,
})

/** 3D text in one of the worlds' styles (src/studio/library.ts, TEXT_STYLES). */
export const textObjectSchema = z.object({
  ...base,
  kind: z.literal('text'),
  text: z.string().min(1).max(12),
  style: z.enum(['sharp-chrome', 'liquid-chrome', 'candy', 'foil', 'collage']),
})

/** An object from the InStudio library, made in code (src/studio/library.ts). */
export const itemObjectSchema = z.object({
  ...base,
  kind: z.literal('item'),
  item: z.string(),
})

export const sceneObjectSchema = z.discriminatedUnion('kind', [modelObjectSchema, imageObjectSchema, videoObjectSchema, textObjectSchema, itemObjectSchema])

/** InStudio's limit: up to 6 objects per post. */
export const MAX_OBJECTS = 6

export const sceneSchema = z.object({
  version: z.literal(1),
  id: z.string(),
  title: z.string().default(''),
  background: z.object({ color: z.string().default('#E1E8E9') }).default({ color: '#E1E8E9' }),
  music: z.object({ src: z.string(), title: z.string().default(''), artist: z.string().default('') }).optional(),
  /**
   * The post picture's camera (Frame your shot, decision 2026-10-07), so IN3D
   * opens on exactly that view: where it looks (`target`), the unit
   * direction from there to the camera, the distance, and the picture's
   * horizontal field of view in degrees.
   */
  view: z.object({ target: vec3, dir: vec3, dist: z.number().positive(), hfov: z.number().positive() }).optional(),
  objects: z.array(sceneObjectSchema).max(MAX_OBJECTS),
})

export type Scene = z.infer<typeof sceneSchema>
export type SceneObject = z.infer<typeof sceneObjectSchema>

export async function loadScene(url: string): Promise<Scene> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not load scene (${res.status})`)
  return sceneSchema.parse(await res.json())
}
