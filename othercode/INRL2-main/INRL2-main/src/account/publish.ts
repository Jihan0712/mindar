import type { Scene } from '../scene/schema'
import { api, syncScene } from '../studio/cloud'
import { getThumb, loadScene, sceneMeta } from '../studio/scenes'
import { getAccount } from './account'

/*
 * Publishing, phone side (step 3): posts and the personal marker
 * (worker/publish.ts).
 *
 * The marker's artwork is drawn here from the seed the server picked
 * (src/marker/artwork.ts), with a QR code of its link; MindAR's compiler
 * turns it into the tracking file (.mind) right on the phone; both are
 * uploaded. A marker that tracks badly (too few matching points) gets a new
 * design automatically.
 */

export interface MarkerInfo {
  code: string
  seed: string
  version: number
  ready: boolean
  matching: number
  /** The post it shows (null: the newest). */
  post: string | null
  image: string
  mind: string
}

export interface PostSummary {
  id: string
  caption: string
  thumb: string | null
  objects: number
  created: number
  likes?: number
  views?: number
  comments?: number
}

export interface PostFull extends PostSummary {
  scene: Scene
  /** The viewer liked it (GET /api/posts/:id). */
  liked?: boolean
}

export interface Owner {
  username: string
  name: string
  avatar?: string | null
  /** The viewer is the author / follows them (GET /api/posts/:id). */
  me?: boolean
  followed?: boolean
}

/** What scanning a marker shows (GET /api/m/:code). */
export interface MarkerPage {
  marker: MarkerInfo
  owner: Owner | null
  post: PostFull | null
  posts: PostSummary[]
}

const send = <T>(path: string, method: string, body?: unknown) =>
  api<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

/** The editor leaves a bigger picture of the scene here (sessionStorage) when → is tapped. */
export const postPictureKey = (id: string) => `inrl.postpic.${id}`

/** The link a marker's QR code holds. */
export const markerLink = (code: string) => `${location.origin}/m/${code}`

// ------------------------------------------------------------------ posts

export async function myPosts(): Promise<PostSummary[]> {
  return (await api<{ posts: PostSummary[] }>('/api/me/posts')).posts
}

export async function deletePost(id: string) {
  await send(`/api/posts/${id}`, 'DELETE')
}

export async function getPost(id: string): Promise<{ post: PostFull; owner: Owner | null; marker?: MarkerInfo | null }> {
  // As this phone: the answer says whether you are the author or follow them.
  return api<{ post: PostFull; owner: Owner | null; marker?: MarkerInfo | null }>(`/api/posts/${id}`).catch((e: Error) => {
    throw new Error(/no such|not found|404/i.test(e.message) ? 'This post was deleted.' : e.message)
  })
}

/**
 * Publishes a scene as it is now: first makes sure it (and its photos and
 * videos) is in the cloud, then posts a copy with the caption.
 */
export async function publishScene(sceneId: string, caption: string, attach: boolean, picture?: string | null): Promise<PostSummary> {
  await syncScene(sceneId)
  const scene = loadScene(sceneId)
  if (!scene) throw new Error('This scene is not on this phone.')
  if (sceneMeta(sceneId)?.cloud !== 'saved') throw new Error('Your scene could not be uploaded. Check your connection and try again.')
  const { post } = await send<{ post: PostSummary }>('/api/posts', 'POST', { scene, thumb: picture ?? getThumb(sceneId), caption, attach })
  return post
}

// ----------------------------------------------------------------- marker

export async function myMarker(): Promise<MarkerInfo | null> {
  return (await api<{ marker: MarkerInfo | null }>('/api/me/marker')).marker
}

export async function attachToMarker(post: string | null): Promise<MarkerInfo> {
  return (await send<{ marker: MarkerInfo }>('/api/me/marker/post', 'PUT', { post })).marker
}

export async function markerPage(code: string): Promise<MarkerPage> {
  const res = await fetch(`/api/m/${encodeURIComponent(code)}`)
  if (!res.ok) throw new Error(res.status === 404 ? 'This marker doesn’t exist (yet).' : `Could not load this marker (${res.status}).`)
  return res.json()
}

export type MarkerStep = 'drawing' | 'compiling' | 'uploading'

let making: Promise<MarkerInfo> | null = null

/**
 * The account's marker, made if needed (or with `redesign`, a new artwork
 * for the same link). Takes a few seconds the first time: the tracking file
 * is computed on the phone.
 */
export function ensureMarker(onStep?: (step: MarkerStep, percent?: number) => void, redesign = false): Promise<MarkerInfo> {
  making ??= (async () => {
    let marker = await myMarker()
    if (marker?.ready && !redesign) return marker
    for (let attempt = 0; attempt < 3; attempt++) {
      marker = (await send<{ marker: MarkerInfo }>('/api/me/marker', 'POST', { redesign: redesign || attempt > 0 })).marker
      const made = await makeFiles(marker, onStep)
      if (made) return made
    }
    throw new Error('Could not make a marker that tracks well. Try again.')
  })().finally(() => {
    making = null
  })
  return making
}

/** Draws, compiles and uploads one design; null if it would track badly. */
async function makeFiles(marker: MarkerInfo, onStep?: (step: MarkerStep, percent?: number) => void): Promise<MarkerInfo | null> {
  const [{ drawMarker }, { compileMarker, MIN_MATCHING }] = await Promise.all([import('../marker/artwork'), import('../marker/compile')])
  onStep?.('drawing')
  const canvas = await drawMarker({ seed: marker.seed, url: markerLink(marker.code), username: getAccount()?.username ?? '' })
  onStep?.('compiling', 0)
  const compiled = await compileMarker(canvas, (p) => onStep?.('compiling', p))
  if (compiled.matching < MIN_MATCHING) return null
  onStep?.('uploading')
  const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not save the image.'))), 'image/png'))
  await api('/api/me/marker/image', { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } })
  const { marker: done } = await api<{ marker: MarkerInfo }>('/api/me/marker/mind', {
    method: 'PUT',
    body: new Blob([compiled.mind as Uint8Array<ArrayBuffer>]),
    headers: { 'Content-Type': 'application/octet-stream', 'X-InRL-Matching': String(compiled.matching) },
  })
  return done
}
