/*
 * Comments (step 5, Figma C12; decision 2026-10-07: add, like, delete your
 * own; the post's author can hide them; "Reply" just starts with @name).
 *
 *   GET    /api/posts/:id/comments        the comments, oldest first (public)
 *   POST   /api/posts/:id/comments        { text } → the new comment
 *   DELETE /api/comments/:id              its writer, or the post's author
 *   POST   /api/comments/:id/hide         the post's author (…/unhide: back)
 *   POST   /api/comments/:id/like         like (DELETE: unlike)
 *
 * Hidden comments only show to their writer and the post's author. The
 * post keeps a count of the visible ones (`posts.comments`). Test accounts
 * only show to test accounts.
 */

import { blockedBetween, fail, ID, json, notBlocked, randomId, setUp, whoIs, type CloudEnv, type Database } from './db.ts'

export const COMMENT_MAX = 300
/** At most this many comments per person per minute (a simple brake on floods). */
export const PER_MINUTE = 8

interface Row {
  id: string
  post: string
  account: string
  text: string
  created: number
  hidden: number
  likes: number
  username: string
  name: string
  avatar: string | null
  liked: number
}

async function recount(db: Database, post: string) {
  await db.prepare('UPDATE posts SET comments = (SELECT COUNT(*) FROM comments WHERE post = ? AND hidden = 0) WHERE id = ?').bind(post, post).run()
  return (await db.prepare('SELECT comments FROM posts WHERE id = ?').bind(post).first<{ comments: number }>())?.comments ?? 0
}

async function hiddenViewer(db: Database, account: string | null) {
  if (!account) return 0
  return (await db.prepare('SELECT hidden FROM accounts WHERE id = ?').bind(account).first<{ hidden: number }>())?.hidden ? 1 : 0
}

export async function listComments(db: Database, post: string, viewer: string | null) {
  const owner = (await db.prepare('SELECT account FROM posts WHERE id = ?').bind(post).first<{ account: string }>())?.account
  if (!owner) return null
  const { results } = await db
    .prepare(
      `SELECT c.*, a.username, a.name, a.avatar, EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment = c.id AND l.account = ?) AS liked
       FROM comments c JOIN accounts a ON a.id = c.account
       WHERE c.post = ? AND (c.hidden = 0 OR c.account = ? OR ? = ?) AND (a.hidden = 0 OR ? = 1) AND ${notBlocked('c.account')}
       ORDER BY c.created, c.rowid LIMIT 500`,
    )
    .bind(viewer ?? '', post, viewer ?? '', viewer ?? '', owner, await hiddenViewer(db, viewer), viewer ?? '', viewer ?? '')
    .all<Row>()
  return {
    comments: results.map((c) => ({
      id: c.id,
      text: c.text,
      created: c.created,
      likes: c.likes,
      liked: !!c.liked,
      hidden: !!c.hidden,
      mine: c.account === viewer,
      author: { username: c.username, name: c.name, avatar: c.avatar },
    })),
    /** The viewer wrote the post: they may hide / delete any comment. */
    moderator: viewer === owner,
  }
}

export async function commentsResponse(request: Request, env: CloudEnv): Promise<Response> {
  const db = env.DB
  if (!db) return fail(503, 'Comments are not set up on this server yet.')
  const parts = new URL(request.url).pathname.split('/').filter(Boolean) // ['api', ...]
  const method = request.method
  try {
    await setUp(db)
    const who = await whoIs(request, db)
    const me = who?.account ?? null

    if (parts[1] === 'posts' && parts[3] === 'comments' && parts.length === 4) {
      const post = parts[2]
      if (!ID.test(post)) return fail(404, 'Not found')
      if (method === 'GET') {
        const list = await listComments(db, post, me)
        return list ? json(list) : fail(404, 'This post was deleted.')
      }
      if (method === 'POST') {
        if (!me) return fail(401, 'Sign in to comment.')
        const owner = await db.prepare('SELECT account FROM posts WHERE id = ?').bind(post).first<{ account: string }>()
        if (!owner) return fail(404, 'This post was deleted.')
        if (await blockedBetween(db, me, owner.account)) return fail(403, 'You can’t comment on this post.')
        const body = (await request.json().catch(() => ({}))) as { text?: unknown }
        const text = typeof body.text === 'string' ? body.text.trim().replace(/\n{3,}/g, '\n\n') : ''
        if (!text) return fail(400, 'Write something first.')
        if (text.length > COMMENT_MAX) return fail(413, `At most ${COMMENT_MAX} characters.`)
        const recent = await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE account = ? AND created > ?').bind(me, Date.now() - 60_000).first<{ n: number }>()
        if ((recent?.n ?? 0) >= PER_MINUTE) return fail(429, 'Slow down a little: try again in a minute.')
        const id = randomId(14)
        await db.prepare('INSERT INTO comments (id, post, account, text, created) VALUES (?, ?, ?, ?, ?)').bind(id, post, me, text, Date.now()).run()
        const count = await recount(db, post)
        const list = await listComments(db, post, me)
        return json({ comment: list?.comments.find((c) => c.id === id), count })
      }
      return fail(405, 'Method not allowed')
    }

    if (parts[1] === 'comments' && parts.length >= 3) {
      const id = parts[2]
      if (!ID.test(id)) return fail(404, 'Not found')
      if (!me) return fail(401, 'Sign in first.')
      const c = await db
        .prepare('SELECT c.id, c.post, c.account, p.account AS owner FROM comments c JOIN posts p ON p.id = c.post WHERE c.id = ?')
        .bind(id)
        .first<{ id: string; post: string; account: string; owner: string }>()
      if (!c) return fail(404, 'This comment was deleted.')

      if (parts.length === 3 && method === 'DELETE') {
        if (me !== c.account && me !== c.owner) return fail(403, 'Only its writer or the post’s author can delete it.')
        await db.batch([db.prepare('DELETE FROM comments WHERE id = ?').bind(id), db.prepare('DELETE FROM comment_likes WHERE comment = ?').bind(id)])
        return json({ ok: true, count: await recount(db, c.post) })
      }
      if (parts.length === 4 && (parts[3] === 'hide' || parts[3] === 'unhide') && method === 'POST') {
        if (me !== c.owner) return fail(403, 'Only the post’s author can hide comments.')
        await db.prepare('UPDATE comments SET hidden = ? WHERE id = ?').bind(parts[3] === 'hide' ? 1 : 0, id).run()
        return json({ hidden: parts[3] === 'hide', count: await recount(db, c.post) })
      }
      if (parts.length === 4 && parts[3] === 'like' && (method === 'POST' || method === 'DELETE')) {
        if (method === 'POST') await db.prepare('INSERT OR IGNORE INTO comment_likes (comment, account, created) VALUES (?, ?, ?)').bind(id, me, Date.now()).run()
        else await db.prepare('DELETE FROM comment_likes WHERE comment = ? AND account = ?').bind(id, me).run()
        await db.prepare('UPDATE comments SET likes = (SELECT COUNT(*) FROM comment_likes WHERE comment = ?) WHERE id = ?').bind(id, id).run()
        const row = await db.prepare('SELECT likes FROM comments WHERE id = ?').bind(id).first<{ likes: number }>()
        return json({ liked: method === 'POST', likes: row?.likes ?? 0 })
      }
    }
    return fail(404, 'Not found')
  } catch (e) {
    if (e instanceof Response) return e
    if (e instanceof SyntaxError) return fail(400, 'Not JSON.')
    return fail(500, e instanceof Error ? e.message : String(e))
  }
}
