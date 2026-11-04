/*
 * Safety (step 5, piece 8; decision 2026-10-07: report and block before
 * people outside the team join; reports go to Nico).
 *
 *   POST   /api/blocks/:username        block: you stop seeing each other (posts, comments, likes,
 *                                       notifications, search), follows both ways end
 *   DELETE /api/blocks/:username        unblock
 *   GET    /api/me/blocks               the people you blocked
 *   POST   /api/reports                 { kind: post | comment | account, target, reason, note? }
 *   GET    /api/admin/reports           admins: open reports (?all=1: also handled ones)
 *   POST   /api/admin/reports/:id/done  admins: handled
 *   POST   /api/admin/remove            admins: { kind, target } deletes a post or comment,
 *                                       or hides an account (it disappears for everyone else)
 *
 * Admins are the user names in the worker's ADMINS variable (wrangler.jsonc).
 */

import { fail, isAdmin, json, randomId, setUp, whoIs, type CloudEnv } from './db.ts'

export const REASONS = ['spam', 'nudity', 'hate', 'violence', 'copyright', 'other'] as const
const KINDS = ['post', 'comment', 'account'] as const
/** Reports per person per day (a brake on misuse). */
export const REPORTS_PER_DAY = 30

export async function safetyResponse(request: Request, env: CloudEnv): Promise<Response> {
  const db = env.DB
  if (!db) return fail(503, 'Not set up on this server yet.')
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]
  const method = request.method
  try {
    await setUp(db)
    const who = await whoIs(request, db)
    const me = who?.account ?? null
    if (!me) return fail(401, 'Sign in first.')

    if (parts[1] === 'blocks' && parts.length === 3 && (method === 'POST' || method === 'DELETE')) {
      const target = await db.prepare('SELECT id FROM accounts WHERE username = ?').bind(decodeURIComponent(parts[2]).toLowerCase()).first<{ id: string }>()
      if (!target) return fail(404, 'No one has this user name.')
      if (target.id === me) return fail(400, 'You can’t block yourself.')
      if (method === 'POST') {
        await db.batch([
          db.prepare('INSERT OR IGNORE INTO blocks (blocker, blocked, created) VALUES (?, ?, ?)').bind(me, target.id, Date.now()),
          db.prepare('DELETE FROM follows WHERE (follower = ? AND followee = ?) OR (follower = ? AND followee = ?)').bind(me, target.id, target.id, me),
        ])
      } else await db.prepare('DELETE FROM blocks WHERE blocker = ? AND blocked = ?').bind(me, target.id).run()
      return json({ blocked: method === 'POST' })
    }

    if (parts[1] === 'me' && parts[2] === 'blocks' && method === 'GET') {
      const { results } = await db
        .prepare('SELECT a.username, a.name, a.avatar FROM blocks b JOIN accounts a ON a.id = b.blocked WHERE b.blocker = ? ORDER BY b.created DESC')
        .bind(me)
        .all<{ username: string; name: string; avatar: string | null }>()
      return json({ blocked: results })
    }

    if (parts[1] === 'reports' && parts.length === 2 && method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { kind?: unknown; target?: unknown; reason?: unknown; note?: unknown }
      const kind = KINDS.find((k) => k === body.kind)
      const reason = REASONS.find((r) => r === body.reason)
      const target = typeof body.target === 'string' ? body.target.slice(0, 60) : ''
      if (!kind || !reason || !target) return fail(400, 'Say what you report and why.')
      const today = await db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created > ?').bind(me, Date.now() - 86_400_000).first<{ n: number }>()
      if ((today?.n ?? 0) >= REPORTS_PER_DAY) return fail(429, 'You sent a lot of reports today. Try again tomorrow.')
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
      await db.prepare('INSERT INTO reports (id, reporter, kind, target, reason, note, created) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(randomId(14), me, kind, target, reason, note, Date.now()).run()
      return json({ ok: true })
    }

    // ------------------------------------------------------------ admins
    if (parts[1] === 'admin') {
      const mine = await db.prepare('SELECT username FROM accounts WHERE id = ?').bind(me).first<{ username: string }>()
      if (!isAdmin(env, mine?.username)) return fail(403, 'Only InRL’s team can do this.')

      if (parts[2] === 'reports' && parts.length === 3 && method === 'GET') {
        const all = url.searchParams.get('all') === '1'
        const { results } = await db
          .prepare(
            `SELECT r.*, a.username AS reporter_name FROM reports r JOIN accounts a ON a.id = r.reporter ${all ? '' : 'WHERE r.done = 0'} ORDER BY r.created DESC LIMIT 200`,
          )
          .all<{ id: string; kind: string; target: string; reason: string; note: string; created: number; done: number; reporter_name: string }>()
        // What each report points at, so it can be judged at a glance.
        const items = await Promise.all(
          results.map(async (r) => {
            let what: Record<string, unknown> | null = null
            if (r.kind === 'post') {
              const p = await db.prepare('SELECT p.id, p.caption, p.thumb IS NOT NULL AS pic, a.username FROM posts p JOIN accounts a ON a.id = p.account WHERE p.id = ?').bind(r.target).first<{ id: string; caption: string; pic: number; username: string }>()
              what = p && { caption: p.caption, thumb: p.pic ? `/api/posts/${p.id}/picture` : null, link: `/p/${p.id}`, by: p.username }
            } else if (r.kind === 'comment') {
              const c = await db.prepare('SELECT c.text, c.post, a.username FROM comments c JOIN accounts a ON a.id = c.account WHERE c.id = ?').bind(r.target).first<{ text: string; post: string; username: string }>()
              what = c && { text: c.text, link: `/p/${c.post}`, by: c.username }
            } else {
              const a = await db.prepare('SELECT username, name, hidden FROM accounts WHERE username = ?').bind(r.target).first<{ username: string; name: string; hidden: number }>()
              what = a && { name: a.name, link: `/u/${a.username}`, by: a.username, hidden: !!a.hidden }
            }
            return { id: r.id, kind: r.kind, target: r.target, reason: r.reason, note: r.note, created: r.created, done: !!r.done, reporter: r.reporter_name, what }
          }),
        )
        return json({ reports: items })
      }
      if (parts[2] === 'reports' && parts.length === 5 && parts[4] === 'done' && method === 'POST') {
        await db.prepare('UPDATE reports SET done = 1 WHERE id = ?').bind(parts[3]).run()
        return json({ ok: true })
      }
      if (parts[2] === 'remove' && parts.length === 3 && method === 'POST') {
        const body = (await request.json().catch(() => ({}))) as { kind?: unknown; target?: unknown }
        const target = typeof body.target === 'string' ? body.target : ''
        if (body.kind === 'post') {
          await db.batch([
            db.prepare('DELETE FROM posts WHERE id = ?').bind(target),
            db.prepare('UPDATE markers SET post = NULL WHERE post = ?').bind(target),
            db.prepare('DELETE FROM likes WHERE post = ?').bind(target),
            db.prepare('DELETE FROM comment_likes WHERE comment IN (SELECT id FROM comments WHERE post = ?)').bind(target),
            db.prepare('DELETE FROM comments WHERE post = ?').bind(target),
            db.prepare('DELETE FROM views WHERE post = ?').bind(target),
          ])
        } else if (body.kind === 'comment') {
          const c = await db.prepare('SELECT post FROM comments WHERE id = ?').bind(target).first<{ post: string }>()
          await db.batch([db.prepare('DELETE FROM comments WHERE id = ?').bind(target), db.prepare('DELETE FROM comment_likes WHERE comment = ?').bind(target)])
          if (c) await db.prepare('UPDATE posts SET comments = (SELECT COUNT(*) FROM comments WHERE post = ? AND hidden = 0) WHERE id = ?').bind(c.post, c.post).run()
        } else if (body.kind === 'account') {
          // Hidden like a test account: nobody else sees them any more (their own phone still works).
          await db.prepare('UPDATE accounts SET hidden = 1 WHERE username = ?').bind(target.toLowerCase()).run()
        } else return fail(400, 'Remove what?')
        await db.prepare('UPDATE reports SET done = 1 WHERE kind = ? AND target = ?').bind(body.kind, target).run()
        return json({ ok: true })
      }
    }
    return fail(404, 'Not found')
  } catch (e) {
    if (e instanceof Response) return e
    if (e instanceof SyntaxError) return fail(400, 'Not JSON.')
    return fail(500, e instanceof Error ? e.message : String(e))
  }
}
