/*
 * The social layer (step 5): the home feed, views, profiles, follows, likes
 * and notifications. Comments and Discover join this module piece by piece
 * (docs/product/step5-plan.md).
 *
 *   GET    /api/feed?tab=foryou|following&offset=N   20 posts at a time (public)
 *   POST   /api/posts/:id/view                       counts a view (once per person per day)
 *   GET    /api/u/:username                          a profile: counts, bio, posts, marker (public)
 *   POST   /api/follows/:username                    follow
 *   DELETE /api/follows/:username                    unfollow
 *   POST   /api/posts/:id/like                       like (DELETE: unlike) → { liked, likes }
 *   GET    /api/discover?q=&offset=N                 popular lately (no q), or people + scenes matching q (public)
 *   GET    /api/notifications                        likes on your posts (grouped per post) and new followers
 *   GET    /api/notifications/new                    → { new }: anything since you last looked (the bell's dot)
 *   POST   /api/notifications/seen                   you looked
 *   PUT    /api/me/avatar                            the profile picture (JPEG, ≤ 400 KB); DELETE removes it
 *   GET    /api/avatars/<file>                       the pictures (public, never change)
 * (Name and bio are PATCH /api/me, accounts.ts.)
 *
 * For You (decision 2026-10-07): every post from everyone, Featured ones
 * first, then by rank (the publishing time, later nudged up by recent likes).
 * Following: posts of the people you follow, newest first. Test accounts
 * (`accounts.hidden`) are only shown to other test accounts, so the
 * automated tests can see each other without showing up for real people.
 */

import { blockedBetween, fail, ID, json, notBlocked, randomId, setUp, whoIs, type CloudEnv, type Database } from './db.ts'
import { markerView } from './publish.ts'

export const PAGE = 20
const DAY = 86_400_000

export interface FeedRow {
  id: string
  caption: string
  pic: number
  objects: number
  created: number
  likes: number
  views: number
  comments: number
  username: string
  name: string
  avatar: string | null
}

export const feedItem = (r: FeedRow) => ({
  id: r.id,
  caption: r.caption,
  thumb: r.pic ? `/api/posts/${r.id}/picture` : null,
  objects: r.objects,
  created: r.created,
  likes: r.likes,
  views: r.views,
  comments: r.comments,
  author: { username: r.username, name: r.name, avatar: r.avatar },
})

// The picture itself is not read here (it is served on its own and cached).
const COLS = 'p.id, p.caption, p.thumb IS NOT NULL AS pic, p.objects, p.created, p.likes, p.views, p.comments, a.username, a.name, a.avatar'

/** Whether the asking account is a test account (sees other test accounts' posts). */
async function isHidden(db: Database, account: string | null) {
  if (!account) return false
  const row = await db.prepare('SELECT hidden FROM accounts WHERE id = ?').bind(account).first<{ hidden: number }>()
  return !!row?.hidden
}

export async function feed(db: Database, tab: 'foryou' | 'following', account: string | null, offset: number) {
  const hidden = (await isHidden(db, account)) ? 1 : 0
  const limit = PAGE + 1
  const { results } =
    tab === 'following'
      ? account
        ? await db
            .prepare(`SELECT ${COLS} FROM posts p JOIN accounts a ON a.id = p.account JOIN follows f ON f.followee = p.account AND f.follower = ? WHERE ${notBlocked('p.account')} ORDER BY p.created DESC LIMIT ? OFFSET ?`)
            .bind(account, account, account, limit, offset)
            .all<FeedRow>()
        : { results: [] as FeedRow[] }
      : await db
          .prepare(`SELECT ${COLS} FROM posts p JOIN accounts a ON a.id = p.account WHERE (a.hidden = 0 OR ? = 1) AND ${notBlocked('p.account')} ORDER BY p.featured DESC, COALESCE(p.rank, p.created) DESC, p.id LIMIT ? OFFSET ?`)
          .bind(hidden, account ?? '', account ?? '', limit, offset)
          .all<FeedRow>()
  return { posts: results.slice(0, PAGE).map(feedItem), more: results.length > PAGE }
}

const AVATAR_MAX = 400 * 1024

interface ProfileRow {
  id: string
  username: string
  name: string
  bio: string
  avatar: string | null
}

/** A profile as people see it (G2 / B1r2): counts, bio, posts (the pinned one first), marker. */
export async function profile(db: Database, username: string, viewer: string | null) {
  const a = await db.prepare('SELECT id, username, name, bio, avatar FROM accounts WHERE username = ?').bind(username.toLowerCase()).first<ProfileRow>()
  if (!a) return null
  // Blocked (piece 8): someone who blocked you isn't found; someone you blocked shows only their name, to unblock.
  if (viewer && (await blockedBetween(db, viewer, a.id))) {
    const mine = await db.prepare('SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?').bind(viewer, a.id).first()
    if (!mine) return null
    return {
      profile: { username: a.username, name: a.name, bio: '', avatar: a.avatar, followers: 0, following: 0, views: 0, me: false, followed: false, blocked: true },
      posts: [],
      pinned: null,
      marker: null,
    }
  }
  const [followers, following, views, followed, posts, marker] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee = ?').bind(a.id).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM follows WHERE follower = ?').bind(a.id).first<{ n: number }>(),
    db.prepare('SELECT COALESCE(SUM(views), 0) AS n FROM posts WHERE account = ?').bind(a.id).first<{ n: number }>(),
    viewer ? db.prepare('SELECT 1 AS n FROM follows WHERE follower = ? AND followee = ?').bind(viewer, a.id).first() : null,
    db
      .prepare('SELECT id, caption, thumb IS NOT NULL AS pic, objects, created, likes, views, comments FROM posts WHERE account = ? ORDER BY created DESC LIMIT 200')
      .bind(a.id)
      .all<{ id: string; caption: string; pic: number; objects: number; created: number; likes: number; views: number; comments: number }>(),
    db.prepare('SELECT * FROM markers WHERE account = ?').bind(a.id).first<Parameters<typeof markerView>[0]>(),
  ])
  const list = posts.results.map((p) => ({ ...p, pic: undefined, thumb: p.pic ? `/api/posts/${p.id}/picture` : null }))
  // Pinned (decision 2026-10-07): the post on the marker, else the newest.
  const pinned = list.find((p) => p.id === marker?.post)?.id ?? list[0]?.id ?? null
  return {
    profile: {
      username: a.username,
      name: a.name,
      bio: a.bio ?? '',
      avatar: a.avatar,
      followers: followers?.n ?? 0,
      following: following?.n ?? 0,
      views: views?.n ?? 0,
      me: viewer === a.id,
      followed: !!followed,
      blocked: false,
    },
    posts: list,
    pinned,
    marker: marker?.ready ? markerView(marker) : null,
  }
}

/**
 * Discover (Figma G3). Without a search: posts popular lately, Featured
 * first, then likes ×3 + comments ×4 + views, fading with age (halved after
 * a week). With a search: people whose user name starts with it or whose
 * name contains it (most followed first), and scenes whose caption
 * contains it.
 */
export async function discover(db: Database, q: string, viewer: string | null, offset: number) {
  const hidden = (await isHidden(db, viewer)) ? 1 : 0
  const now = Date.now()
  const score = `((p.likes * 3 + p.comments * 4 + p.views + 1) * 1.0 / (1 + (? - p.created) / ${7 * DAY}.0))`
  const query = q.trim().toLowerCase().slice(0, 40)
  if (!query) {
    const { results } = await db
      .prepare(`SELECT ${COLS} FROM posts p JOIN accounts a ON a.id = p.account WHERE (a.hidden = 0 OR ? = 1) AND ${notBlocked('p.account')} ORDER BY p.featured DESC, ${score} DESC, p.created DESC LIMIT ? OFFSET ?`)
      .bind(hidden, viewer ?? '', viewer ?? '', now, PAGE + 1, offset)
      .all<FeedRow>()
    return { people: [], posts: results.slice(0, PAGE).map(feedItem), more: results.length > PAGE }
  }
  const like = query.replace(/[\\%_]/g, (c) => `\\${c}`)
  const [people, posts] = await Promise.all([
    db
      .prepare(
        `SELECT a.username, a.name, a.avatar, (SELECT COUNT(*) FROM follows f WHERE f.followee = a.id) AS followers FROM accounts a
         WHERE (a.username LIKE ? ESCAPE '\\' OR LOWER(a.name) LIKE ? ESCAPE '\\') AND (a.hidden = 0 OR ? = 1) AND ${notBlocked('a.id')} ORDER BY followers DESC, a.username LIMIT 20`,
      )
      .bind(`${like}%`, `%${like}%`, hidden, viewer ?? '', viewer ?? '')
      .all<Person & { followers: number }>(),
    db
      .prepare(`SELECT ${COLS} FROM posts p JOIN accounts a ON a.id = p.account WHERE LOWER(p.caption) LIKE ? ESCAPE '\\' AND (a.hidden = 0 OR ? = 1) AND ${notBlocked('p.account')} ORDER BY ${score} DESC LIMIT 40`)
      .bind(`%${like}%`, hidden, viewer ?? '', viewer ?? '', now)
      .all<FeedRow>(),
  ])
  return { people: people.results, posts: posts.results.map(feedItem), more: false }
}

/** Recent likes nudge a post up For You: 2 hours each, up to 2 days (decision 2026-10-07). */
export const LIKE_BOOST = 2 * 3600_000
export const BOOST_MAX = 24

interface Person {
  username: string
  name: string
  avatar: string | null
}

/**
 * Notifications (Figma G5), newest first: likes on your posts grouped per
 * post and day ("a, b and others liked your scene"), new followers (with
 * whether you follow them back) and comments on your posts. Hidden test accounts only show to
 * test accounts.
 */
export async function notifications(db: Database, account: string) {
  const hidden = (await isHidden(db, account)) ? 1 : 0
  const since = Date.now() - 60 * DAY
  const [likes, follows, comments] = await Promise.all([
    db
      .prepare(
        `SELECT l.post, l.created, a.username, a.name, a.avatar, p.thumb IS NOT NULL AS pic FROM likes l JOIN posts p ON p.id = l.post JOIN accounts a ON a.id = l.account
         WHERE p.account = ? AND l.account != ? AND l.created > ? AND (a.hidden = 0 OR ? = 1) AND ${notBlocked('l.account')} ORDER BY l.created DESC LIMIT 300`,
      )
      .bind(account, account, since, hidden, account, account)
      .all<Person & { post: string; created: number; pic: number }>(),
    db
      .prepare(
        `SELECT f.created, a.username, a.name, a.avatar, EXISTS (SELECT 1 FROM follows b WHERE b.follower = ? AND b.followee = f.follower) AS back
         FROM follows f JOIN accounts a ON a.id = f.follower WHERE f.followee = ? AND f.created > ? AND (a.hidden = 0 OR ? = 1) AND ${notBlocked('f.follower')} ORDER BY f.created DESC LIMIT 100`,
      )
      .bind(account, account, since, hidden, account, account)
      .all<Person & { created: number; back: number }>(),
    db
      .prepare(
        `SELECT c.post, c.text, c.created, a.username, a.name, a.avatar, p.thumb IS NOT NULL AS pic FROM comments c JOIN posts p ON p.id = c.post JOIN accounts a ON a.id = c.account
         WHERE p.account = ? AND c.account != ? AND c.hidden = 0 AND c.created > ? AND (a.hidden = 0 OR ? = 1) AND ${notBlocked('c.account')} ORDER BY c.created DESC, c.rowid DESC LIMIT 100`,
      )
      .bind(account, account, since, hidden, account, account)
      .all<Person & { post: string; text: string; created: number; pic: number }>(),
  ])
  const person = (r: Person): Person => ({ username: r.username, name: r.name, avatar: r.avatar })
  type Item =
    | { kind: 'like'; time: number; post: { id: string; thumb: string | null }; people: Person[]; count: number }
    | { kind: 'follow'; time: number; person: Person; followingBack: boolean }
    | { kind: 'comment'; time: number; person: Person; post: { id: string; thumb: string | null }; text: string }
  const items: Item[] = []
  // One line per post per day: the newest likers first.
  const groups = new Map<string, Extract<Item, { kind: 'like' }>>()
  for (const l of likes.results) {
    const key = `${l.post}:${Math.floor(l.created / DAY)}`
    let g = groups.get(key)
    if (!g) {
      g = { kind: 'like', time: l.created, post: { id: l.post, thumb: l.pic ? `/api/posts/${l.post}/picture` : null }, people: [], count: 0 }
      groups.set(key, g)
      items.push(g)
    }
    g.count++
    if (g.people.length < 3) g.people.push(person(l))
  }
  for (const f of follows.results) items.push({ kind: 'follow', time: f.created, person: person(f), followingBack: !!f.back })
  for (const c of comments.results) items.push({ kind: 'comment', time: c.created, person: person(c), post: { id: c.post, thumb: c.pic ? `/api/posts/${c.post}/picture` : null }, text: c.text.slice(0, 120) })
  items.sort((a, b) => b.time - a.time)
  return items.slice(0, 100)
}

/** The newest thing that would show in notifications (0: none). */
async function latestNote(db: Database, account: string) {
  const items = await notifications(db, account)
  return items[0]?.time ?? 0
}

export async function socialResponse(request: Request, env: CloudEnv): Promise<Response> {
  const db = env.DB
  if (!db) return fail(503, 'The feed is not set up on this server yet.')
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]
  const method = request.method
  try {
    // Profile pictures: no database needed.
    if (parts[1] === 'avatars' && parts.length === 3 && (method === 'GET' || method === 'HEAD')) {
      if (!/^[a-z0-9]{8,40}-[a-z0-9]{6,12}\.jpg$/.test(parts[2]) || !env.MEDIA) return fail(404, 'Not found')
      const obj = await env.MEDIA.get(`avatars/${parts[2]}`)
      if (!obj) return fail(404, 'No such picture.')
      return new Response(method === 'HEAD' ? null : obj.body, {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(obj.size), 'Cache-Control': 'public, max-age=31536000, immutable' },
      })
    }

    await setUp(db)
    const who = await whoIs(request, db)

    if (parts[1] === 'discover' && parts.length === 2 && method === 'GET') {
      const offset = Math.max(0, Math.min(10_000, Number(url.searchParams.get('offset')) || 0))
      return json(await discover(db, url.searchParams.get('q') ?? '', who?.account ?? null, offset))
    }

    if (parts[1] === 'posts' && parts.length === 4 && parts[3] === 'like' && (method === 'POST' || method === 'DELETE')) {
      const id = parts[2]
      if (!ID.test(id)) return fail(404, 'Not found')
      if (!who?.account) return fail(401, 'Sign in to like posts.')
      const owner = await db.prepare('SELECT account FROM posts WHERE id = ?').bind(id).first<{ account: string }>()
      if (!owner) return fail(404, 'This post was deleted.')
      if (method === 'POST' && (await blockedBetween(db, who.account, owner.account))) return fail(404, 'This post isn’t available.')
      if (method === 'POST') await db.prepare('INSERT OR IGNORE INTO likes (post, account, created) VALUES (?, ?, ?)').bind(id, who.account, Date.now()).run()
      else await db.prepare('DELETE FROM likes WHERE post = ? AND account = ?').bind(id, who.account).run()
      // The count kept on the post, and its For You rank (publishing time + a little per like).
      await db
        .prepare('UPDATE posts SET likes = (SELECT COUNT(*) FROM likes WHERE post = ?), rank = created + MIN((SELECT COUNT(*) FROM likes WHERE post = ?), ?) * ? WHERE id = ?')
        .bind(id, id, BOOST_MAX, LIKE_BOOST, id)
        .run()
      const row = await db.prepare('SELECT likes FROM posts WHERE id = ?').bind(id).first<{ likes: number }>()
      return json({ liked: method === 'POST', likes: row?.likes ?? 0 })
    }

    if (parts[1] === 'notifications') {
      if (!who?.account) return fail(401, 'Sign in first.')
      if (parts.length === 2 && method === 'GET') return json({ items: await notifications(db, who.account) })
      if (parts[2] === 'new' && method === 'GET') {
        const seen = await db.prepare('SELECT notes_seen FROM accounts WHERE id = ?').bind(who.account).first<{ notes_seen: number }>()
        return json({ new: (await latestNote(db, who.account)) > (seen?.notes_seen ?? 0) })
      }
      if (parts[2] === 'seen' && method === 'POST') {
        await db.prepare('UPDATE accounts SET notes_seen = ? WHERE id = ?').bind(Date.now(), who.account).run()
        return json({ ok: true })
      }
      return fail(404, 'Not found')
    }

    if (parts[1] === 'u' && parts.length === 3 && method === 'GET') {
      const p = await profile(db, decodeURIComponent(parts[2]), who?.account ?? null)
      return p ? json(p) : fail(404, 'No one has this user name.')
    }

    if (parts[1] === 'follows' && parts.length === 3 && (method === 'POST' || method === 'DELETE')) {
      if (!who?.account) return fail(401, 'Sign in to follow people.')
      const target = await db.prepare('SELECT id FROM accounts WHERE username = ?').bind(decodeURIComponent(parts[2]).toLowerCase()).first<{ id: string }>()
      if (!target) return fail(404, 'No one has this user name.')
      if (target.id === who.account) return fail(400, 'You can’t follow yourself.')
      if (method === 'POST' && (await blockedBetween(db, who.account, target.id))) return fail(403, 'You can’t follow this person.')
      if (method === 'POST') await db.prepare('INSERT OR IGNORE INTO follows (follower, followee, created) VALUES (?, ?, ?)').bind(who.account, target.id, Date.now()).run()
      else await db.prepare('DELETE FROM follows WHERE follower = ? AND followee = ?').bind(who.account, target.id).run()
      const followers = await db.prepare('SELECT COUNT(*) AS n FROM follows WHERE followee = ?').bind(target.id).first<{ n: number }>()
      return json({ followed: method === 'POST', followers: followers?.n ?? 0 })
    }

    if (parts[1] === 'me' && parts[2] === 'avatar' && parts.length === 3 && (method === 'PUT' || method === 'DELETE')) {
      if (!who?.account) return fail(401, 'Sign in first.')
      if (!env.MEDIA) return fail(503, 'Pictures are not set up on this server yet.')
      const old = await db.prepare('SELECT avatar FROM accounts WHERE id = ?').bind(who.account).first<{ avatar: string | null }>()
      let avatar: string | null = null
      if (method === 'PUT') {
        const body = await request.arrayBuffer()
        const head = new Uint8Array(body.slice(0, 3))
        if (!body.byteLength || body.byteLength > AVATAR_MAX) return fail(413, 'Picture too big.')
        if (head[0] !== 0xff || head[1] !== 0xd8 || head[2] !== 0xff) return fail(415, 'Send a JPEG picture.')
        const file = `${who.account}-${randomId(8)}.jpg`
        await env.MEDIA.put(`avatars/${file}`, body, { httpMetadata: { contentType: 'image/jpeg' } })
        avatar = `/api/avatars/${file}`
      }
      await db.prepare('UPDATE accounts SET avatar = ? WHERE id = ?').bind(avatar, who.account).run()
      const was = old?.avatar?.match(/^\/api\/avatars\/(.+)$/)?.[1]
      if (was) await env.MEDIA.delete(`avatars/${was}`)
      return json({ avatar })
    }

    if (parts[1] === 'feed' && parts.length === 2 && method === 'GET') {
      const tab = url.searchParams.get('tab') === 'following' ? 'following' : 'foryou'
      const offset = Math.max(0, Math.min(10_000, Number(url.searchParams.get('offset')) || 0))
      return json(await feed(db, tab, who?.account ?? null, offset))
    }

    if (parts[1] === 'posts' && parts.length === 4 && parts[3] === 'view' && method === 'POST') {
      const id = parts[2]
      if (!ID.test(id)) return fail(404, 'Not found')
      if (!who) return json({ counted: false })
      const viewer = who.account ?? who.phone
      const day = Math.floor(Date.now() / DAY)
      const seen = await db.prepare('SELECT 1 FROM views WHERE post = ? AND viewer = ? AND day = ?').bind(id, viewer, day).first()
      if (seen || !(await db.prepare('SELECT 1 FROM posts WHERE id = ?').bind(id).first())) return json({ counted: false })
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO views (post, viewer, day) VALUES (?, ?, ?)').bind(id, viewer, day),
        db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').bind(id),
      ])
      return json({ counted: true })
    }

    return fail(404, 'Not found')
  } catch (e) {
    if (e instanceof Response) return e
    if (e instanceof SyntaxError) return fail(400, 'Not JSON.')
    return fail(500, e instanceof Error ? e.message : String(e))
  }
}
