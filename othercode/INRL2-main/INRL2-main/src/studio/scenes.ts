import { sceneSchema, type Scene } from '../scene/schema'

/*
 * "My scenes" on the phone (InStudio piece 5). Each scene is kept in
 * localStorage under its own key and saved on every change, so closing
 * Safari never loses work; a small index lists them for the My scenes
 * screen. Photos and videos live in IndexedDB until they reach the cloud
 * (src/studio/media.ts), and src/studio/cloud.ts copies every scene to the
 * cloud in the background.
 */

export type CloudState = 'saved' | 'pending' | 'error'

export interface SceneMeta {
  id: string
  title: string
  /** Last change, ms since 1970. */
  updated: number
  /** When it was started (names it until people can title scenes). */
  created?: number
  objects: number
  background: string
  /** Where the cloud copy stands. */
  cloud: CloudState
  /** Only in the cloud so far (its scene is fetched when opened). */
  remote?: boolean
}

const INDEX = 'inrl.scenes'
const OLD_DRAFT = 'inrl.studio.draft'
const sceneKey = (id: string) => `inrl.scene.${id}`
const thumbKey = (id: string) => `inrl.thumb.${id}`

export const newId = () => Math.random().toString(36).slice(2, 10)
/** Scene ids are seen by the cloud: longer, so two phones never pick the same one. */
export const newSceneId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14)

export function emptyScene(id = newSceneId()): Scene {
  return sceneSchema.parse({ version: 1, id, objects: [] })
}

function get(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    // Private mode or full storage: editing still works, it just isn't kept.
    return false
  }
}
function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    // nothing kept anyway
  }
}

// Tells the My scenes screen to redraw (cloud state, thumbnails…).
const events = new EventTarget()
export function onScenesChange(fn: () => void) {
  events.addEventListener('change', fn)
  return () => events.removeEventListener('change', fn)
}
const changed = () => events.dispatchEvent(new Event('change'))

function readIndex(): SceneMeta[] {
  migrateOldDraft()
  try {
    const list = JSON.parse(get(INDEX) ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
function writeIndex(list: SceneMeta[]) {
  set(INDEX, JSON.stringify(list))
  changed()
}

/** What a scene is called until people can title them: "Scene · 6 Oct, 21:05". */
export const sceneName = (m: Pick<SceneMeta, 'title' | 'created' | 'updated'>) =>
  m.title || `Scene · ${new Date(m.created ?? m.updated).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`

/** Newest first. */
export function listScenes(): SceneMeta[] {
  return readIndex().sort((a, b) => b.updated - a.updated)
}

export function sceneMeta(id: string) {
  return readIndex().find((m) => m.id === id)
}

export function loadScene(id: string): Scene | null {
  try {
    const raw = get(sceneKey(id))
    if (raw) return sceneSchema.parse(JSON.parse(raw))
  } catch {
    // Unreadable or from an older format.
  }
  return null
}

function metaOf(scene: Scene, updated: number, cloud: CloudState, created = updated): SceneMeta {
  return { id: scene.id, title: scene.title, updated, created, objects: scene.objects.length, background: scene.background.color, cloud }
}

/** Saves a scene on the phone and marks it for the cloud. */
export function saveScene(scene: Scene, updated = Date.now(), cloud: CloudState = 'pending') {
  set(sceneKey(scene.id), JSON.stringify(scene))
  const all = readIndex()
  const old = all.find((m) => m.id === scene.id)
  writeIndex([metaOf(scene, updated, cloud, old?.created ?? updated), ...all.filter((m) => m.id !== scene.id)])
}

export function createScene(): Scene {
  const scene = emptyScene()
  saveScene(scene)
  return scene
}

export function setCloudState(id: string, cloud: CloudState, onlyIfUpdated?: number) {
  const list = readIndex()
  const m = list.find((x) => x.id === id)
  if (!m || (onlyIfUpdated !== undefined && m.updated !== onlyIfUpdated)) return
  if (m.cloud === cloud) return
  m.cloud = cloud
  writeIndex(list)
}

/** Adds scenes found in the cloud but not on this phone (opened from the cloud when tapped). */
export function addRemote(metas: Omit<SceneMeta, 'cloud' | 'remote'>[]) {
  const list = readIndex()
  const known = new Set(list.map((m) => m.id))
  const fresh = metas.filter((m) => !known.has(m.id)).map((m) => ({ ...m, cloud: 'saved' as const, remote: true }))
  if (fresh.length) writeIndex([...list, ...fresh])
}

export function deleteScene(id: string) {
  remove(sceneKey(id))
  remove(thumbKey(id))
  writeIndex(readIndex().filter((m) => m.id !== id))
}

export function getThumb(id: string) {
  return get(thumbKey(id))
}
let thumbs = 0
/** Goes up whenever a picture changes (so the My scenes screen redraws). */
export const thumbsVersion = () => thumbs
export function saveThumb(id: string, dataUrl: string) {
  if (get(thumbKey(id)) === dataUrl) return
  set(thumbKey(id), dataUrl)
  thumbs++
  changed()
}

/** Every phone-stored photo/video id any scene here uses. */
export function usedMediaIds(): Set<string> {
  const ids = new Set<string>()
  for (const m of readIndex()) {
    for (const o of loadScene(m.id)?.objects ?? []) if ('src' in o && o.src.startsWith('media:')) ids.add(o.src.slice(6))
  }
  return ids
}

/** Before piece 5 the editor kept a single draft: it becomes the first scene. */
function migrateOldDraft() {
  const raw = get(OLD_DRAFT)
  if (!raw) return
  remove(OLD_DRAFT)
  try {
    const scene = sceneSchema.parse(JSON.parse(raw))
    if (!scene.objects.length) return
    const list = JSON.parse(get(INDEX) ?? '[]') as SceneMeta[]
    if (list.some((m) => m.id === scene.id)) return
    set(sceneKey(scene.id), raw)
    set(INDEX, JSON.stringify([metaOf(scene, Date.now(), 'pending'), ...list]))
  } catch {
    // unreadable: nothing to keep
  }
}

/** Signing out: the scenes belong to the account (and are in the cloud), so the phone forgets them. */
export function forgetAllScenes() {
  for (const m of readIndex()) {
    remove(sceneKey(m.id))
    remove(thumbKey(m.id))
  }
  writeIndex([])
}
