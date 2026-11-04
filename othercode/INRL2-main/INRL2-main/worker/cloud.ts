/*
 * Cloud saving (InStudio piece 5): scenes in D1, people's photos and videos
 * in R2, both through this worker.
 *
 * Everything belongs to "this phone": the app makes a private random key
 * once, keeps it on the phone and sends it as the `X-InRL-Owner` header. We
 * only store its SHA-256, so the database never holds the key itself. Once
 * the person signs in, the phone is linked to their account and the same key
 * stands for the account (worker/db.ts `whoIs`, worker/accounts.ts).
 *
 *   GET    /api/scenes                 this phone's scenes (no scene data, just the list)
 *   GET    /api/scenes/:id             one scene
 *   PUT    /api/scenes/:id             save { scene, thumb }
 *   DELETE /api/scenes/:id             delete it and the media only it used
 *   PUT    /api/media/:id              upload a photo or video (up to SINGLE_MAX)
 *   POST   /api/media/:id/parts        start a big upload in parts → { uploadId }
 *   PUT    /api/media/:id/parts/:u/:n  one part → { partNumber, etag }
 *   POST   /api/media/:id/parts/:u     finish { parts }
 *   GET    /api/media/:id              the file, with byte ranges for iPhone video (public:
 *                                      viewers of a scene need it; ids are long and random)
 *
 * The D1 tables are created here on first use, so no Cloudflare API token
 * or migration step is needed. The bucket and database are bound in
 * wrangler.jsonc. In development, vite.config.ts runs this same code with
 * stand-ins (worker/devCloud.ts).
 */

import { parseRange } from './range.ts'
import { fail, ID, json, mediaIds, setUp, usedMedia, whoIs, type Bucket, type CloudEnv, type Database } from './db.ts'

export type { Bucket, CloudEnv, Database, Statement } from './db.ts'
export { mediaIds } from './db.ts'

/** Uploads bigger than this go in parts (a Worker accepts ~100 MB per request at most). */
export const SINGLE_MAX = 25 * 1024 * 1024
/** One photo or video. Matches VIDEO_MAX_MB in src/studio/media.ts, with room for the photo case. */
export const MEDIA_MAX = 160 * 1024 * 1024
/** Everything one phone (or account) can keep in the cloud until plans exist. */
export const OWNER_QUOTA = 3 * 1024 * 1024 * 1024
export const SCENE_MAX = 64 * 1024
export const THUMB_MAX = 200 * 1024
/** Media no scene uses any more are removed after this (keeps undo safe during an editing session). */
const ORPHAN_AFTER_MS = 24 * 3600 * 1000

export async function cloudResponse(request: Request, env: CloudEnv): Promise<Response> {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean) // ['api', 'scenes' | 'media', ...]
  const { DB: db, MEDIA: bucket } = env
  if (!db || !bucket) return fail(503, 'Cloud saving is not set up on this server yet.')
  const method = request.method

  try {
    // Public: the files themselves, for every viewer of a scene. No database needed.
    if (parts[1] === 'media' && parts.length === 3 && (method === 'GET' || method === 'HEAD')) {
      return await serveMedia(request, bucket, parts[2])
    }

    await setUp(db)

    const who = await whoIs(request, db)
    if (!who) return fail(401, 'Missing phone key.')
    const owner = who.owner

    if (parts[1] === 'scenes') {
      const id = parts[2]
      if (!id) {
        if (method !== 'GET') return fail(405, 'Method not allowed')
        await removeOrphans(db, bucket, owner)
        const { results } = await db
          .prepare('SELECT id, title, thumb, objects, updated FROM scenes WHERE owner = ? ORDER BY updated DESC')
          .bind(owner)
          .all()
        return json({ scenes: results })
      }
      if (!ID.test(id) || parts.length > 3) return fail(404, 'Not found')
      const row = await db.prepare('SELECT owner, data, thumb, updated FROM scenes WHERE id = ?').bind(id).first<{ owner: string; data: string; thumb: string | null; updated: number }>()
      if (row && row.owner !== owner) return fail(403, 'This scene belongs to another phone.')

      if (method === 'GET') {
        if (!row) return fail(404, 'No such scene.')
        return json({ scene: JSON.parse(row.data), thumb: row.thumb, updated: row.updated })
      }
      if (method === 'PUT') {
        const text = await request.text()
        if (text.length > SCENE_MAX + THUMB_MAX) return fail(413, 'Scene too big.')
        let body: { scene?: { id?: string; title?: string; objects?: unknown[] }; thumb?: string | null; updated?: number }
        try {
          body = JSON.parse(text)
        } catch {
          return fail(400, 'Not JSON.')
        }
        const scene = body.scene
        if (!scene || scene.id !== id || !Array.isArray(scene.objects)) return fail(400, 'Not a scene.')
        const data = JSON.stringify(scene)
        if (data.length > SCENE_MAX) return fail(413, 'Scene too big.')
        const thumb = typeof body.thumb === 'string' && body.thumb.startsWith('data:image/') && body.thumb.length <= THUMB_MAX ? body.thumb : (row?.thumb ?? null)
        const now = Date.now()
        const updated = typeof body.updated === 'number' && body.updated <= now + 60_000 ? body.updated : now
        await db
          .prepare(
            'INSERT INTO scenes (id, owner, title, data, thumb, objects, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, data = excluded.data, thumb = excluded.thumb, objects = excluded.objects, updated = excluded.updated',
          )
          .bind(id, owner, String(scene.title ?? '').slice(0, 80), data, thumb, scene.objects.length, now, updated)
          .run()
        return json({ ok: true, updated })
      }
      if (method === 'DELETE') {
        if (!row) return json({ ok: true })
        await db.prepare('DELETE FROM scenes WHERE id = ?').bind(id).run()
        // Its photos and videos go too, unless another of the owner's scenes or posts uses them.
        const used = await usedMedia(db, owner)
        const gone = mediaIds(row.data).filter((m) => !used.has(m))
        await deleteMedia(db, bucket, owner, gone)
        return json({ ok: true, removedMedia: gone.length })
      }
      return fail(405, 'Method not allowed')
    }

    if (parts[1] === 'media') {
      const id = parts[2]
      if (!id || !ID.test(id)) return fail(404, 'Not found')
      const existing = await db.prepare('SELECT owner, done FROM media WHERE id = ?').bind(id).first<{ owner: string; done: number }>()
      if (existing && existing.owner !== owner) return fail(403, 'This file belongs to another phone.')
      const type = request.headers.get('Content-Type') ?? 'application/octet-stream'
      const declared = Number(request.headers.get('X-InRL-Size') ?? request.headers.get('Content-Length') ?? 0)

      // Whole file in one request.
      if (method === 'PUT' && parts.length === 3) {
        if (!/^(image|video)\//.test(type)) return fail(415, 'Only photos and videos.')
        if (declared > SINGLE_MAX) return fail(413, 'Too big for one request; upload in parts.')
        await checkQuota(db, owner, declared)
        const body = await request.arrayBuffer()
        if (body.byteLength > SINGLE_MAX) return fail(413, 'Too big for one request; upload in parts.')
        await bucket.put(`media/${id}`, body, { httpMetadata: { contentType: type } })
        await recordMedia(db, id, owner, type, body.byteLength, true)
        return json({ ok: true, url: `/api/media/${id}` })
      }

      // Big file in parts: start.
      if (method === 'POST' && parts.length === 4 && parts[3] === 'parts') {
        if (!/^(image|video)\//.test(type)) return fail(415, 'Only photos and videos.')
        if (!(declared > 0)) return fail(411, 'Say how big the file is (X-InRL-Size).')
        if (declared > MEDIA_MAX) return fail(413, 'That file is too big.')
        await checkQuota(db, owner, declared)
        const up = await bucket.createMultipartUpload(`media/${id}`, { httpMetadata: { contentType: type } })
        await recordMedia(db, id, owner, type, declared, false)
        return json({ uploadId: up.uploadId })
      }
      if (!existing) return fail(404, 'Start the upload first.')
      const uploadId = parts[4] ? decodeURIComponent(parts[4]) : ''

      // One part.
      if (method === 'PUT' && parts.length === 6 && parts[3] === 'parts') {
        const n = Number(parts[5])
        if (!Number.isInteger(n) || n < 1 || n > 10000) return fail(400, 'Bad part number.')
        const body = await request.arrayBuffer()
        if (body.byteLength > SINGLE_MAX) return fail(413, 'Part too big.')
        const part = await bucket.resumeMultipartUpload(`media/${id}`, uploadId).uploadPart(n, body)
        return json(part)
      }
      // Finish.
      if (method === 'POST' && parts.length === 5 && parts[3] === 'parts') {
        const body = (await request.json()) as { parts?: { partNumber: number; etag: string }[] }
        if (!Array.isArray(body.parts) || !body.parts.length) return fail(400, 'No parts.')
        await bucket.resumeMultipartUpload(`media/${id}`, uploadId).complete(body.parts)
        const head = await bucket.head(`media/${id}`)
        await db.prepare('UPDATE media SET done = 1, size = ? WHERE id = ?').bind(head?.size ?? 0, id).run()
        return json({ ok: true, url: `/api/media/${id}` })
      }
      return fail(405, 'Method not allowed')
    }
    return fail(404, 'Not found')
  } catch (e) {
    if (e instanceof Response) return e
    return fail(500, e instanceof Error ? e.message : String(e))
  }
}

async function serveMedia(request: Request, bucket: Bucket, id: string): Promise<Response> {
  if (!ID.test(id)) return fail(404, 'Not found')
  const head = await bucket.head(`media/${id}`)
  if (!head) return fail(404, 'No such file.')
  const headers = new Headers({
    'Content-Type': head.httpMetadata?.contentType ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    // A media id never changes content: cache it for good.
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
  const range = parseRange(request.headers.get('Range'), head.size)
  if (range === 'invalid') {
    headers.set('Content-Range', `bytes */${head.size}`)
    return new Response(null, { status: 416, headers })
  }
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(head.size))
    return new Response(null, { status: 200, headers })
  }
  const obj = await bucket.get(`media/${id}`, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined)
  if (!obj) return fail(404, 'No such file.')
  if (!range) {
    headers.set('Content-Length', String(head.size))
    return new Response(obj.body, { status: 200, headers })
  }
  headers.set('Content-Range', `bytes ${range.start}-${range.end}/${head.size}`)
  headers.set('Content-Length', String(range.end - range.start + 1))
  return new Response(obj.body, { status: 206, headers })
}

async function checkQuota(db: Database, owner: string, adding: number) {
  const row = await db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM media WHERE owner = ?').bind(owner).first<{ used: number }>()
  if ((row?.used ?? 0) + adding > OWNER_QUOTA) throw fail(507, 'Cloud space for this phone is full. Delete a scene to make room.')
}

function recordMedia(db: Database, id: string, owner: string, type: string, size: number, done: boolean) {
  return db
    .prepare('INSERT INTO media (id, owner, type, size, done, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type = excluded.type, size = excluded.size, done = excluded.done')
    .bind(id, owner, type, size, done ? 1 : 0, Date.now())
    .run()
}

async function deleteMedia(db: Database, bucket: Bucket, owner: string, ids: string[]) {
  if (!ids.length) return
  await bucket.delete(ids.map((m) => `media/${m}`))
  await db.batch(ids.map((m) => db.prepare('DELETE FROM media WHERE id = ? AND owner = ?').bind(m, owner)))
}

/** Photos and videos uploaded more than a day ago that none of the owner's scenes or posts use. */
async function removeOrphans(db: Database, bucket: Bucket, owner: string) {
  const media = await db.prepare('SELECT id FROM media WHERE owner = ? AND created < ?').bind(owner, Date.now() - ORPHAN_AFTER_MS).all<{ id: string }>()
  if (!media.results.length) return
  const used = await usedMedia(db, owner)
  await deleteMedia(db, bucket, owner, media.results.map((m) => m.id).filter((m) => !used.has(m)))
}
