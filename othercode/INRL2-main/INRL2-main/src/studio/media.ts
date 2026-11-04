/*
 * People's own photos and videos. A scene refers to one as "media:<id>".
 * A fresh import is kept on the phone in IndexedDB (far too big for
 * localStorage) until cloud saving (src/studio/cloud.ts) has uploaded it;
 * then the phone's copy is removed to free space, and `mediaUrl()` points
 * at the cloud copy (/api/media/<id>) instead.
 */

export type MediaKind = 'image' | 'video'

export interface MediaInfo {
  id: string
  kind: MediaKind
  width: number
  height: number
  /** Seconds, videos only. */
  duration?: number
}

interface Stored extends MediaInfo {
  blob: Blob
}

/** Photos are resized so the long side is at most this (sharp on a 3D screen, light on the phone). */
const PHOTO_MAX = 1600
/** Bigger videos would fill a phone quickly; cloud saving will compress them later. */
export const VIDEO_MAX_MB = 150

const DB = 'inrl'
const STORE = 'media'
let dbp: Promise<IDBDatabase> | null = null

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = run(d.transaction(STORE, mode).objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export const isMediaSrc = (src: string) => src.startsWith('media:')
export const mediaSrc = (id: string) => `media:${id}`

const urls = new Map<string, Promise<string>>()

/** A loadable URL for a scene's `src` (plain URLs pass through). */
export function mediaUrl(src: string): Promise<string> {
  if (!isMediaSrc(src)) return Promise.resolve(src)
  const id = src.slice(6)
  if (!urls.has(id)) {
    urls.set(
      id,
      tx<Stored | undefined>('readonly', (s) => s.get(id)).then(
        (m) => (m ? URL.createObjectURL(m.blob) : cloudMediaUrl(id)),
        () => cloudMediaUrl(id),
      ),
    )
  }
  return urls.get(id)!
}

export const cloudMediaUrl = (id: string) => `/api/media/${id}`

/** The stored file, while it is still on the phone (not yet uploaded). */
export async function localMedia(id: string): Promise<(MediaInfo & { blob: Blob }) | undefined> {
  try {
    return await tx<Stored | undefined>('readonly', (s) => s.get(id))
  } catch {
    return undefined
  }
}

/** Removes the phone's copy (once the cloud has it). Loaded copies keep working this visit. */
export async function forgetLocalMedia(id: string) {
  await tx('readwrite', (s) => s.delete(id))
}

export async function mediaInfo(id: string): Promise<MediaInfo | undefined> {
  const m = await tx<Stored | undefined>('readonly', (s) => s.get(id))
  if (!m) return undefined
  const { blob: _blob, ...info } = m
  void _blob
  return info
}

/** Long and random: anyone with a scene can load its media from the cloud by id. */
const newMediaId = () => `m${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('')}`

/** Prepares a picked file (resize photos, check videos) and stores it. */
export async function importMedia(file: File): Promise<MediaInfo> {
  const kind: MediaKind | null = file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null
  if (!kind) throw new Error('Please pick a photo or a video.')
  const stored = kind === 'image' ? await preparePhoto(file) : await prepareVideo(file)
  await tx('readwrite', (s) => s.put(stored))
  const { blob: _blob, ...info } = stored
  void _blob
  return info
}

async function preparePhoto(file: File): Promise<Stored> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('That photo could not be opened. Try a JPEG or PNG.')
  }
  const k = Math.min(1, PHOTO_MAX / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * k)
  c.height = Math.round(bmp.height * k)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  // Keep transparency for PNGs (cut-outs); JPEG for everything else.
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the photo'))), type, 0.88))
  return { id: newMediaId(), kind: 'image', width: c.width, height: c.height, blob }
}

async function prepareVideo(file: File): Promise<Stored> {
  if (file.size > VIDEO_MAX_MB * 1024 * 1024) throw new Error(`That video is over ${VIDEO_MAX_MB} MB. Try a shorter one.`)
  const url = URL.createObjectURL(file)
  try {
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'metadata'
    v.src = url
    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve()
      v.onerror = () => reject(new Error('That video could not be opened on this phone.'))
    })
    return { id: newMediaId(), kind: 'video', width: v.videoWidth || 9, height: v.videoHeight || 16, duration: v.duration, blob: file }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Deletes stored media no scene uses any more (call with every id still referenced). */
export async function cleanUpMedia(keep: Set<string>) {
  try {
    const ids = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
    for (const id of ids) if (typeof id === 'string' && !keep.has(id)) await tx('readwrite', (s) => s.delete(id))
  } catch {
    // Storage unavailable (private mode): nothing to clean.
  }
}
