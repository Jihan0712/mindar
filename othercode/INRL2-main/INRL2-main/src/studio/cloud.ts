import { sceneSchema, type Scene } from '../scene/schema'
import { forgetLocalMedia, localMedia } from './media'
import { addRemote, deleteScene, getThumb, listScenes, loadScene, saveScene, saveThumb, sceneMeta, setCloudState } from './scenes'

/*
 * Cloud saving, phone side (InStudio piece 5). Every scene is copied to the
 * cloud in the background (worker/cloud.ts): first its new photos and videos
 * (to R2, then removed from the phone to free space), then the scene itself
 * with its small picture (to D1). Offline or on error the scene stays marked
 * "pending" and is retried on the next change, when My scenes opens, or when
 * the phone comes back online.
 *
 * The cloud copy belongs to "this phone": a private random key made once and
 * kept here. Once the person signs in (src/account), the server links this
 * key to their account, so the same key then stands for the account.
 */

const OWNER = 'inrl.owner'
/** Videos bigger than this go up in parts of this size (the server takes up to 25 MB per request). */
const PART = 20 * 1024 * 1024

export function phoneKey(): string {
  try {
    let key = localStorage.getItem(OWNER)
    if (!key) {
      key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(OWNER, key)
    }
    return key
  } catch {
    // No storage (private mode): a key for this visit only.
    return (phoneKey.temp ??= Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join(''))
  }
}
phoneKey.temp = undefined as string | undefined

/** Forgets this phone's key (signing out): the next call makes a fresh one. */
export function newPhoneKey() {
  try {
    localStorage.removeItem(OWNER)
  } catch {
    // nothing kept
  }
  phoneKey.temp = undefined
}

function isTestPhone() {
  try {
    return localStorage.getItem('inrl.test') === '1'
  } catch {
    return false
  }
}

/** Calls our API as this phone (and, once signed in, its account). */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('X-InRL-Owner', phoneKey())
  // The automated tests mark their phones, so the accounts they make stay out of real people's feeds.
  if (isTestPhone()) headers.set('X-InRL-Test', '1')
  const res = await fetch(path, { ...init, headers })
  const body = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `Cloud saving failed (${res.status})`)
  return body
}

// ------------------------------------------------------------- media

const uploading = new Map<string, Promise<void>>()

/** Uploads one phone-stored photo/video if it is still on the phone, then frees the phone's copy. */
function uploadMedia(id: string) {
  if (!uploading.has(id)) {
    const p = (async () => {
      const m = await localMedia(id)
      if (!m) return // already in the cloud
      const type = m.blob.type || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg')
      if (m.blob.size <= PART) {
        await api(`/api/media/${id}`, { method: 'PUT', body: m.blob, headers: { 'Content-Type': type, 'X-InRL-Size': String(m.blob.size) } })
      } else {
        const { uploadId } = await api<{ uploadId: string }>(`/api/media/${id}/parts`, {
          method: 'POST',
          headers: { 'Content-Type': type, 'X-InRL-Size': String(m.blob.size) },
        })
        const base = `/api/media/${id}/parts/${encodeURIComponent(uploadId)}`
        const parts: { partNumber: number; etag: string }[] = []
        for (let at = 0, n = 1; at < m.blob.size; at += PART, n++) {
          const chunk = m.blob.slice(at, at + PART)
          // A dropped connection retries the part a couple of times before giving up.
          for (let attempt = 0; ; attempt++) {
            try {
              parts.push(await api(`${base}/${n}`, { method: 'PUT', body: chunk }))
              break
            } catch (e) {
              if (attempt >= 2) throw e
              await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
            }
          }
        }
        await api(base, { method: 'POST', body: JSON.stringify({ parts }), headers: { 'Content-Type': 'application/json' } })
      }
      await forgetLocalMedia(id)
    })().finally(() => uploading.delete(id))
    uploading.set(id, p)
  }
  return uploading.get(id)!
}

// ------------------------------------------------------------- scenes

const running = new Map<string, Promise<void>>()
const again = new Set<string>()

/**
 * Copies a scene (and its new media) to the cloud. Calls while one is
 * running are folded into one more run when it ends.
 */
export function syncScene(id: string): Promise<void> {
  if (running.has(id)) {
    again.add(id)
    return running.get(id)!
  }
  const p = (async () => {
    do {
      again.delete(id)
      const meta = sceneMeta(id)
      const scene = loadScene(id)
      if (!meta || !scene || meta.remote) return
      if (meta.cloud === 'saved') continue
      try {
        setCloudState(id, 'pending')
        for (const o of scene.objects) if ('src' in o && o.src.startsWith('media:')) await uploadMedia(o.src.slice(6))
        await api(`/api/scenes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scene, thumb: getThumb(id), updated: meta.updated }),
        })
        // Saved, unless it changed again meanwhile (then the loop goes round once more).
        setCloudState(id, 'saved', meta.updated)
      } catch {
        setCloudState(id, 'error', meta.updated)
        return
      }
    } while (again.has(id))
  })().finally(() => running.delete(id))
  running.set(id, p)
  return p
}

/** Everything not yet in the cloud. */
export function syncAll() {
  return Promise.all(listScenes().filter((m) => m.cloud !== 'saved' && !m.remote).map((m) => syncScene(m.id)))
}

/** Adds this phone's cloud scenes that aren't on the phone (e.g. after a Safari clean-up kept the key). */
export async function fetchCloudList() {
  const { scenes } = await api<{ scenes: { id: string; title: string; thumb: string | null; objects: number; updated: number }[] }>('/api/scenes')
  const gone = pendingDeletes()
  addRemote(scenes.filter((s) => !gone.has(s.id)).map((s) => ({ id: s.id, title: s.title, objects: s.objects, updated: s.updated, background: '#E1E8E9' })))
  for (const s of scenes) if (s.thumb && !getThumb(s.id)) saveThumb(s.id, s.thumb)
}

/** A scene that is only in the cloud: brings it onto the phone. */
export async function fetchScene(id: string): Promise<Scene> {
  const body = await api<{ scene: unknown; thumb: string | null; updated: number }>(`/api/scenes/${id}`)
  const scene = sceneSchema.parse(body.scene)
  saveScene(scene, body.updated, 'saved')
  if (body.thumb) saveThumb(id, body.thumb)
  return scene
}

const DELETED = 'inrl.scenes.deleted'

/** Deletes on the phone at once, and in the cloud (retried later if offline). */
export async function removeScene(id: string) {
  deleteScene(id)
  const pending = new Set<string>(JSON.parse(localStorage.getItem(DELETED) ?? '[]'))
  pending.add(id)
  localStorage.setItem(DELETED, JSON.stringify([...pending]))
  await flushDeletes()
}

export async function flushDeletes() {
  let pending: string[]
  try {
    pending = JSON.parse(localStorage.getItem(DELETED) ?? '[]')
  } catch {
    return
  }
  for (const id of pending) {
    try {
      await api(`/api/scenes/${id}`, { method: 'DELETE' })
      const left = (JSON.parse(localStorage.getItem(DELETED) ?? '[]') as string[]).filter((x) => x !== id)
      localStorage.setItem(DELETED, JSON.stringify(left))
    } catch {
      return // offline: next time
    }
  }
}

/** Ids deleted here but not yet in the cloud (so the cloud list doesn't bring them back). */
export function pendingDeletes(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED) ?? '[]'))
  } catch {
    return new Set()
  }
}

// Back online: catch up.
if (typeof window !== 'undefined') window.addEventListener('online', () => void flushDeletes().then(syncAll))
