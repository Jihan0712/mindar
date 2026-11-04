/*
 * Publishing (step 3): posts and personal markers.
 *
 * A post is a copy of a scene at the moment it was published, with a caption.
 * Every account has one marker: InRL artwork made from a seed, with a QR code
 * of the link /m/<code> in the middle. The phone draws the artwork and makes
 * its tracking file (.mind, MindAR's compiler, in the browser) and uploads
 * both; we keep them in R2. A marker shows the post its owner attached, else
 * the newest one.
 *
 *   GET    /api/me/posts                the signed-in account's posts
 *   POST   /api/posts                   publish { scene, thumb, caption, attach }
 *   GET    /api/posts/:id               one post (public)
 *   GET    /api/posts/:id/picture       its picture (public)
 *   DELETE /api/posts/:id
 *   GET    /api/me/marker               → { marker | null }
 *   POST   /api/me/marker               make it (or { redesign: true }: new artwork, same link)
 *   PUT    /api/me/marker/image         the artwork (PNG)
 *   PUT    /api/me/marker/mind          the tracking file (X-InRL-Matching: points)
 *   PUT    /api/me/marker/post          { post: id | null }: what the marker shows
 *   GET    /api/markers/<code>-<v>.png|.mind   the files (public, never change)
 *   GET    /api/m/:code                 what scanning a marker shows (public)
 */

import { SCENE_MAX, THUMB_MAX } from './cloud.ts'
import { accountOwner, blockedBetween, fail, ID, json, mediaIds, randomId, setUp, whoIs, type CloudEnv, type Database } from './db.ts'

export const CAPTION_MAX = 150
const IMAGE_MAX = 4 * 1024 * 1024
const MIND_MAX = 8 * 1024 * 1024
/** Below this many matching points a printed marker is found slowly or not at all (marker guide). */
export const MIN_MATCHING = 250
/** Marker codes: no 0/o, 1/l/i, so a code can be read out or typed. */
export const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const CODE = /^[a-z0-9]{4,16}$/

interface MarkerRow { code: string; account: string; seed: string; version: number; ready: number; matching: number; post: string | null }
interface PostRow { id: string; account: string; caption: string; data: string; thumb: string | null; objects: number; created: number; likes?: number; views?: number; comments?: number }

export function markerView(m: MarkerRow) {
  const base = `/api/markers/${m.code}-${m.version}`
  return { code: m.code, seed: m.seed, version: m.version, ready: !!m.ready, matching: m.matching, post: m.post, image: `${base}.png`, mind: `${base}.mind` }
}

/** Pictures are served on their own (lists stay small; a post never changes, so they cache for good). */
const postSummary = (p: PostRow) => ({
  id: p.id, caption: p.caption, thumb: p.thumb ? `/api/posts/${p.id}/picture` : null, objects: p.objects, created: p.created,
  likes: p.likes ?? 0, views: p.views ?? 0, comments: p.comments ?? 0,
})
const postFull = (p: PostRow) => ({ ...postSummary(p), scene: JSON.parse(p.data) })

async function markerOf(db: Database, account: string) {
  return db.prepare('SELECT * FROM markers WHERE account = ?').bind(account).first<MarkerRow>()
}

export async function publishResponse(request: Request, env: CloudEnv): Promise<Response> {
  const { DB: db, MEDIA: bucket } = env
  if (!db || !bucket) return fail(503, 'Publishing is not set up on this server yet.')
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]
  const method = request.method

  try {
    // Public marker files: no database needed.
    if (parts[1] === 'markers' && parts.length === 3 && (method === 'GET' || method === 'HEAD')) {
      const m = /^([a-z0-9]{4,16})-(\d{1,6})\.(png|mind)$/.exec(parts[2])
      if (!m) return fail(404, 'Not found')
      const obj = await bucket.get(`markers/${parts[2]}`)
      if (!obj) return fail(404, 'No such marker file.')
      return new Response(method === 'HEAD' ? null : obj.body, {
        headers: {
          'Content-Type': m[3] === 'png' ? 'image/png' : 'application/octet-stream',
          'Content-Length': String(obj.size),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    await setUp(db)

    // What scanning a marker shows: public.
    if (parts[1] === 'm' && parts.length === 3 && method === 'GET') {
      const code = parts[2].toLowerCase()
      if (!CODE.test(code)) return fail(404, 'Not found')
      const marker = await db.prepare('SELECT * FROM markers WHERE code = ?').bind(code).first<MarkerRow>()
      if (!marker) return fail(404, 'No such marker.')
      const owner = await db.prepare('SELECT username, name, avatar FROM accounts WHERE id = ?').bind(marker.account).first<{ username: string; name: string; avatar: string | null }>()
      const { results } = await db.prepare('SELECT * FROM posts WHERE account = ? ORDER BY created DESC LIMIT 50').bind(marker.account).all<PostRow>()
      const shown = results.find((p) => p.id === marker.post) ?? results[0] ?? null
      return json({ marker: markerView(marker), owner, post: shown && postFull(shown), posts: results.map(postSummary) })
    }

    if (parts[1] === 'posts' && parts.length === 4 && parts[3] === 'picture' && method === 'GET') {
      const row = await db.prepare('SELECT thumb FROM posts WHERE id = ?').bind(parts[2]).first<{ thumb: string | null }>()
      const m = row?.thumb && /^data:(image\/[a-z]+);base64,(.*)$/.exec(row.thumb)
      if (!m) return fail(404, 'No picture.')
      const bin = atob(m[2])
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      return new Response(bytes, { headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=31536000, immutable' } })
    }

    if (parts[1] === 'posts' && parts.length === 3 && method === 'GET') {
      const row = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(parts[2]).first<PostRow>()
      if (!row) return fail(404, 'No such post.')
      const owner = await db.prepare('SELECT username, name, avatar FROM accounts WHERE id = ?').bind(row.account).first<{ username: string; name: string; avatar: string | null }>()
      // The author's marker (INRL opens it), and whether the viewer is the author or follows them (the "+" on the avatar).
      const m = await markerOf(db, row.account)
      const viewer = (await whoIs(request, db))?.account ?? null
      if (await blockedBetween(db, viewer, row.account)) return fail(404, 'This post isn’t available.')
      const followed = !!viewer && !!(await db.prepare('SELECT 1 FROM follows WHERE follower = ? AND followee = ?').bind(viewer, row.account).first())
      const liked = !!viewer && !!(await db.prepare('SELECT 1 FROM likes WHERE post = ? AND account = ?').bind(row.id, viewer).first())
      return json({ post: { ...postFull(row), liked }, owner: owner && { ...owner, me: viewer === row.account, followed }, marker: m?.ready ? markerView(m) : null })
    }

    const who = await whoIs(request, db)
    if (!who) return fail(401, 'Missing phone key.')
    const account = who.account
    if (!account) return fail(401, 'Sign in first.')

    // ---------------------------------------------------------------- posts
    if (parts[1] === 'me' && parts[2] === 'posts' && parts.length === 3 && method === 'GET') {
      const { results } = await db.prepare('SELECT * FROM posts WHERE account = ? ORDER BY created DESC').bind(account).all<PostRow>()
      return json({ posts: results.map(postSummary) })
    }

    if (parts[1] === 'posts' && parts.length === 2 && method === 'POST') {
      const text = await request.text()
      if (text.length > SCENE_MAX + THUMB_MAX + 4096) return fail(413, 'Post too big.')
      const body = JSON.parse(text) as { scene?: { objects?: unknown[] }; thumb?: unknown; caption?: unknown; attach?: unknown }
      const scene = body.scene
      if (!scene || !Array.isArray(scene.objects) || !scene.objects.length) return fail(400, 'Add something to the scene first.')
      const data = JSON.stringify(scene)
      if (data.length > SCENE_MAX) return fail(413, 'Scene too big.')
      // Its photos and videos must already be in the cloud, and be this account's.
      const ids = mediaIds(data)
      if (ids.length) {
        const { results } = await db
          .prepare(`SELECT id FROM media WHERE owner = ? AND done = 1 AND id IN (${ids.map(() => '?').join(',')})`)
          .bind(accountOwner(account), ...ids)
          .all<{ id: string }>()
        if (results.length !== ids.length) return fail(409, 'Your photos and videos are still uploading. Try again in a moment.')
      }
      const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, CAPTION_MAX) : ''
      const thumb = typeof body.thumb === 'string' && body.thumb.startsWith('data:image/') && body.thumb.length <= THUMB_MAX ? body.thumb : null
      const id = randomId(14)
      const now = Date.now()
      await db
        .prepare('INSERT INTO posts (id, account, caption, data, thumb, objects, created, rank) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, account, caption, data, thumb, scene.objects.length, now, now)
        .run()
      if (body.attach) await db.prepare('UPDATE markers SET post = ?, updated = ? WHERE account = ?').bind(id, now, account).run()
      const row = (await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>())!
      return json({ post: postSummary(row) })
    }

    if (parts[1] === 'posts' && parts.length === 3 && method === 'DELETE') {
      const id = parts[2]
      if (!ID.test(id)) return fail(404, 'Not found')
      await db.batch([
        db.prepare('DELETE FROM posts WHERE id = ? AND account = ?').bind(id, account),
        db.prepare('UPDATE markers SET post = NULL WHERE account = ? AND post = ?').bind(account, id),
        db.prepare('DELETE FROM views WHERE post = ? AND NOT EXISTS (SELECT 1 FROM posts WHERE id = ?)').bind(id, id),
        db.prepare('DELETE FROM likes WHERE post = ? AND NOT EXISTS (SELECT 1 FROM posts WHERE id = ?)').bind(id, id),
        db.prepare('DELETE FROM comment_likes WHERE comment IN (SELECT id FROM comments WHERE post = ?) AND NOT EXISTS (SELECT 1 FROM posts WHERE id = ?)').bind(id, id),
        db.prepare('DELETE FROM comments WHERE post = ? AND NOT EXISTS (SELECT 1 FROM posts WHERE id = ?)').bind(id, id),
      ])
      // Its media go with the next clean-up if nothing else uses them (cloud.ts).
      return json({ ok: true })
    }

    // --------------------------------------------------------------- marker
    if (parts[1] === 'me' && parts[2] === 'marker') {
      const marker = await markerOf(db, account)
      if (parts.length === 3 && method === 'GET') return json({ marker: marker && markerView(marker) })
      if (parts.length === 3 && method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { redesign?: unknown }
        const now = Date.now()
        if (!marker) {
          // A fresh code; retried in the (very unlikely) case it is taken.
          for (let attempt = 0; attempt < 5; attempt++) {
            const code = randomId(7, CODE_ALPHABET)
            if (await db.prepare('SELECT 1 FROM markers WHERE code = ?').bind(code).first()) continue
            await db
              .prepare('INSERT INTO markers (code, account, seed, version, ready, matching, post, created, updated) VALUES (?, ?, ?, 1, 0, 0, NULL, ?, ?)')
              .bind(code, account, randomId(12), now, now)
              .run()
            break
          }
        } else if (body.redesign || !marker.ready) {
          await db.prepare('UPDATE markers SET seed = ?, version = version + 1, ready = 0, updated = ? WHERE account = ?').bind(randomId(12), now, account).run()
        }
        const fresh = await markerOf(db, account)
        if (!fresh) return fail(500, 'Could not make a marker code.')
        return json({ marker: markerView(fresh) })
      }
      if (!marker) return fail(404, 'Make your marker first.')
      if (parts.length === 4 && method === 'PUT' && (parts[3] === 'image' || parts[3] === 'mind')) {
        const isImage = parts[3] === 'image'
        const body = await request.arrayBuffer()
        if (!body.byteLength || body.byteLength > (isImage ? IMAGE_MAX : MIND_MAX)) return fail(413, 'Wrong size.')
        const key = `markers/${marker.code}-${marker.version}.${isImage ? 'png' : 'mind'}`
        await bucket.put(key, body, { httpMetadata: { contentType: isImage ? 'image/png' : 'application/octet-stream' } })
        if (!isImage) {
          const matching = Number(request.headers.get('X-InRL-Matching') ?? 0)
          if (!(matching >= MIN_MATCHING)) return fail(422, 'This artwork would track badly. Make a new design.')
          if (!(await bucket.head(`markers/${marker.code}-${marker.version}.png`))) return fail(409, 'Upload the image first.')
          await db.prepare('UPDATE markers SET ready = 1, matching = ?, updated = ? WHERE account = ?').bind(matching, Date.now(), account).run()
          // Earlier designs' files are no longer reachable from the app.
          if (marker.version > 1) await bucket.delete([`markers/${marker.code}-${marker.version - 1}.png`, `markers/${marker.code}-${marker.version - 1}.mind`])
        }
        return json({ marker: markerView((await markerOf(db, account))!) })
      }
      if (parts.length === 4 && method === 'PUT' && parts[3] === 'post') {
        const body = (await request.json()) as { post?: unknown }
        const post = typeof body.post === 'string' ? body.post : null
        if (post && !(await db.prepare('SELECT 1 FROM posts WHERE id = ? AND account = ?').bind(post, account).first())) return fail(404, 'No such post.')
        await db.prepare('UPDATE markers SET post = ?, updated = ? WHERE account = ?').bind(post, Date.now(), account).run()
        return json({ marker: markerView((await markerOf(db, account))!) })
      }
      return fail(405, 'Method not allowed')
    }

    return fail(404, 'Not found')
  } catch (e) {
    if (e instanceof Response) return e
    if (e instanceof SyntaxError) return fail(400, 'Not JSON.')
    return fail(500, e instanceof Error ? e.message : String(e))
  }
}
