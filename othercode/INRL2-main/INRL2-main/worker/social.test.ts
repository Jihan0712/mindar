import { describe, expect, it } from 'vitest'
import { accountResponse } from './accounts.ts'
import { phoneOf, setUp } from './db.ts'
import { devBucket, devDatabase } from './devCloud.ts'
import { publishResponse } from './publish.ts'
import { apiRoute } from './routes.ts'
import { PAGE, socialResponse } from './social.ts'

/*
 * The social layer through the API. Accounts are written straight into the
 * database (passkeys are covered by accounts.test.ts) and linked to a phone key.
 */

const ORIGIN = 'https://inrl.example'
const phoneKey = (n: number) => String(n).repeat(48).slice(0, 48)

async function setup() {
  const env = { DB: await devDatabase(), MEDIA: devBucket() }
  await setUp(env.DB)
  const call = async (path: string, init: RequestInit & { phone?: number; json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    if (init.phone !== undefined) headers.set('X-InRL-Owner', phoneKey(init.phone))
    const body = init.json !== undefined ? JSON.stringify(init.json) : init.body
    const req = new Request(`${ORIGIN}${path}`, { ...init, body, headers })
    const route = apiRoute(path.split('?')[0])
    const res = await (route === 'social' ? socialResponse : route === 'accounts' ? accountResponse : publishResponse)(req, env)
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> }
  }
  /** An account signed in on phone n. */
  const person = async (n: number, username: string, hidden = 0) => {
    const id = `acct${username}`.padEnd(16, 'x')
    const phone = await phoneOf(new Request(ORIGIN, { headers: { 'X-InRL-Owner': phoneKey(n) } }))
    await env.DB.prepare('INSERT INTO accounts (id, username, name, created, hidden) VALUES (?, ?, ?, ?, ?)').bind(id, username, username.toUpperCase(), Date.now(), hidden).run()
    await env.DB.prepare('INSERT INTO phones (phone, account, created) VALUES (?, ?, ?)').bind(phone, id, Date.now()).run()
    return id
  }
  const publish = async (n: number, caption: string) => {
    const scene = { version: 1, id: 's', objects: [{ id: 'o1', kind: 'text', text: caption.slice(0, 12) }] }
    const r = await call('/api/posts', { method: 'POST', phone: n, json: { scene, caption } })
    expect(r.status).toBe(200)
    return r.body.post.id as string
  }
  return { env, call, person, publish }
}

describe('feed', () => {
  it('For You shows everyone, newest first, Featured on top, test accounts only to test accounts', async () => {
    const { env, call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'ana')
    await person(3, 'tbot', 1)
    const a = await publish(1, 'first')
    await new Promise((r) => setTimeout(r, 5))
    const b = await publish(2, 'second')
    await new Promise((r) => setTimeout(r, 5))
    const t = await publish(3, 'test post')

    // Signed out (no phone key) and signed in: same public list, without the test account.
    const anon = await call('/api/feed')
    expect(anon.status).toBe(200)
    expect(anon.body.posts.map((p: { id: string }) => p.id)).toEqual([b, a])
    expect(anon.body.posts[0].author).toEqual({ username: 'ana', name: 'ANA', avatar: null })
    expect(anon.body.posts[0].thumb).toBeNull()
    expect((await call('/api/feed', { phone: 1 })).body.posts.map((p: { id: string }) => p.id)).toEqual([b, a])
    // A test account sees real and test posts.
    expect((await call('/api/feed', { phone: 3 })).body.posts.map((p: { id: string }) => p.id)).toEqual([t, b, a])

    await env.DB.prepare('UPDATE posts SET featured = 1 WHERE id = ?').bind(a).run()
    expect((await call('/api/feed')).body.posts.map((p: { id: string }) => p.id)).toEqual([a, b])
  })

  it('pages 20 at a time', async () => {
    const { call, person, publish } = await setup()
    await person(1, 'nico')
    for (let i = 0; i < PAGE + 3; i++) await publish(1, `post ${i}`)
    const one = await call('/api/feed')
    expect(one.body.posts).toHaveLength(PAGE)
    expect(one.body.more).toBe(true)
    const two = await call(`/api/feed?offset=${PAGE}`)
    expect(two.body.posts).toHaveLength(3)
    expect(two.body.more).toBe(false)
    expect(new Set([...one.body.posts, ...two.body.posts].map((p: { id: string }) => p.id)).size).toBe(PAGE + 3)
  })

  it('Following shows only the people you follow', async () => {
    const { env, call, person, publish } = await setup()
    const nico = await person(1, 'nico')
    const ana = await person(2, 'ana')
    await person(3, 'bob')
    const a = await publish(2, 'from ana')
    await publish(3, 'from bob')
    expect((await call('/api/feed?tab=following', { phone: 1 })).body.posts).toEqual([])
    expect((await call('/api/feed?tab=following')).body.posts).toEqual([])
    await env.DB.prepare('INSERT INTO follows (follower, followee, created) VALUES (?, ?, ?)').bind(nico, ana, Date.now()).run()
    expect((await call('/api/feed?tab=following', { phone: 1 })).body.posts.map((p: { id: string }) => p.id)).toEqual([a])
  })
})

describe('views', () => {
  it('counts once per person per day, also before signing in; deleting the post forgets them', async () => {
    const { env, call, person, publish } = await setup()
    await person(1, 'nico')
    const id = await publish(1, 'hello')
    expect((await call(`/api/posts/${id}/view`, { method: 'POST', phone: 2 })).body.counted).toBe(true)
    expect((await call(`/api/posts/${id}/view`, { method: 'POST', phone: 2 })).body.counted).toBe(false)
    expect((await call(`/api/posts/${id}/view`, { method: 'POST', phone: 1 })).body.counted).toBe(true)
    expect((await call(`/api/posts/${id}/view`, { method: 'POST' })).body.counted).toBe(false) // no phone key
    expect((await call(`/api/posts/nosuchpost1/view`, { method: 'POST', phone: 2 })).body.counted).toBe(false)
    const post = await call(`/api/posts/${id}`)
    expect(post.body.post.views).toBe(2)
    expect(post.body.post.likes).toBe(0)
    expect(post.body.marker).toBeNull()
    expect((await call('/api/feed')).body.posts[0].views).toBe(2)

    expect((await call(`/api/posts/${id}`, { method: 'DELETE', phone: 1 })).status).toBe(200)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM views').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('routes', () => {
    expect(apiRoute('/api/feed')).toBe('social')
    expect(apiRoute('/api/posts/abc123def/view')).toBe('social')
    expect(apiRoute('/api/posts/abc123def')).toBe('publish')
    expect(apiRoute('/api/posts')).toBe('publish')
  })
})

describe('profiles and follows', () => {
  it('shows a profile with counts, bio and posts; follows feed Following', async () => {
    const { call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'ana')
    const a1 = await publish(2, 'first')
    await new Promise((r) => setTimeout(r, 5))
    const a2 = await publish(2, 'second')

    // Edit Profile: name and bio.
    expect((await call('/api/me', { method: 'PATCH', phone: 2, json: { bio: 'I make\n\n\n\nscenes' } })).body.account.bio).toBe('I make\n\nscenes')
    expect((await call('/api/me', { method: 'PATCH', phone: 2, json: { name: 'Ana B' } })).body.account).toMatchObject({ name: 'Ana B', bio: 'I make\n\nscenes' })

    let p = await call('/api/u/ana', { phone: 1 })
    expect(p.status).toBe(200)
    expect(p.body.profile).toMatchObject({ username: 'ana', name: 'Ana B', followers: 0, following: 0, me: false, followed: false })
    expect(p.body.posts.map((x: { id: string }) => x.id)).toEqual([a2, a1])
    expect(p.body.pinned).toBe(a2) // no marker: the newest
    expect((await call('/api/u/ana', { phone: 2 })).body.profile.me).toBe(true)
    expect((await call('/api/u/nobody')).status).toBe(404)

    // Follow (twice = once), can't follow yourself, needs an account.
    expect((await call('/api/follows/ana', { method: 'POST', phone: 1 })).body).toEqual({ followed: true, followers: 1 })
    expect((await call('/api/follows/ana', { method: 'POST', phone: 1 })).body.followers).toBe(1)
    expect((await call('/api/follows/nico', { method: 'POST', phone: 1 })).status).toBe(400)
    expect((await call('/api/follows/ana', { method: 'POST', phone: 9 })).status).toBe(401)
    p = await call('/api/u/ana', { phone: 1 })
    expect(p.body.profile).toMatchObject({ followers: 1, followed: true })
    expect((await call('/api/u/nico')).body.profile.following).toBe(1)
    expect((await call(`/api/posts/${a1}`, { phone: 1 })).body.owner).toMatchObject({ username: 'ana', me: false, followed: true })
    expect((await call('/api/feed?tab=following', { phone: 1 })).body.posts.map((x: { id: string }) => x.id)).toEqual([a2, a1])

    // Views add up on the profile.
    await call(`/api/posts/${a1}/view`, { method: 'POST', phone: 1 })
    await call(`/api/posts/${a2}/view`, { method: 'POST', phone: 1 })
    expect((await call('/api/u/ana')).body.profile.views).toBe(2)

    expect((await call('/api/follows/ana', { method: 'DELETE', phone: 1 })).body).toEqual({ followed: false, followers: 0 })
    expect((await call('/api/feed?tab=following', { phone: 1 })).body.posts).toEqual([])
  })

  it('stores a profile picture, replaces it, removes it', async () => {
    const { env, call, person } = await setup()
    await person(1, 'nico')
    const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(7)])
    expect((await call('/api/me/avatar', { method: 'PUT', phone: 1, body: new Uint8Array([1, 2, 3]) })).status).toBe(415)
    expect((await call('/api/me/avatar', { method: 'PUT', phone: 1, body: jpeg(500 * 1024) })).status).toBe(413)
    const one = (await call('/api/me/avatar', { method: 'PUT', phone: 1, body: jpeg(100) })).body.avatar as string
    expect(one).toMatch(/^\/api\/avatars\/[a-z0-9]+-[a-z0-9]+\.jpg$/)
    const got = await socialResponse(new Request(`${ORIGIN}${one}`), env)
    expect(got.status).toBe(200)
    expect(got.headers.get('Content-Type')).toBe('image/jpeg')
    expect((await call('/api/u/nico')).body.profile.avatar).toBe(one)
    const two = (await call('/api/me/avatar', { method: 'PUT', phone: 1, body: jpeg(50) })).body.avatar as string
    expect(two).not.toBe(one)
    expect((await socialResponse(new Request(`${ORIGIN}${one}`), env)).status).toBe(404) // the old one is gone
    expect((await call('/api/feed')).body.posts).toEqual([])
    expect((await call('/api/me/avatar', { method: 'DELETE', phone: 1 })).body.avatar).toBeNull()
    expect((await call('/api/u/nico')).body.profile.avatar).toBeNull()
  })
})

describe('likes and notifications', () => {
  it('likes once per person, counts, nudges For You, forgets them with the post', async () => {
    const { env, call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'ana')
    await person(3, 'bob')
    const old = await publish(1, 'older')
    await new Promise((r) => setTimeout(r, 5))
    const fresh = await publish(1, 'newer')
    expect((await call('/api/feed')).body.posts.map((p: { id: string }) => p.id)).toEqual([fresh, old])

    expect((await call(`/api/posts/${old}/like`, { method: 'POST' })).status).toBe(401)
    expect((await call(`/api/posts/${old}/like`, { method: 'POST', phone: 2 })).body).toEqual({ liked: true, likes: 1 })
    expect((await call(`/api/posts/${old}/like`, { method: 'POST', phone: 2 })).body).toEqual({ liked: true, likes: 1 })
    expect((await call(`/api/posts/${old}/like`, { method: 'POST', phone: 3 })).body.likes).toBe(2)
    expect((await call(`/api/posts/${old}`, { phone: 2 })).body.post).toMatchObject({ likes: 2, liked: true })
    expect((await call(`/api/posts/${fresh}`, { phone: 2 })).body.post.liked).toBe(false)
    // Two likes outweigh a few milliseconds of age.
    expect((await call('/api/feed')).body.posts.map((p: { id: string }) => p.id)).toEqual([old, fresh])
    expect((await call(`/api/posts/${old}/like`, { method: 'DELETE', phone: 3 })).body).toEqual({ liked: false, likes: 1 })
    expect((await call('/api/posts/nosuchpost1/like', { method: 'POST', phone: 2 })).status).toBe(404)

    expect((await call(`/api/posts/${old}`, { method: 'DELETE', phone: 1 })).status).toBe(200)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM likes').first<{ n: number }>()).toEqual({ n: 0 })
  })

  it('groups likes per post, lists followers with Follow Back, and lights the bell until seen', async () => {
    const { call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'ana')
    await person(3, 'bob')
    await person(4, 'tbot', 1)
    const a = await publish(1, 'one')
    const b = await publish(1, 'two')
    expect((await call('/api/notifications/new', { phone: 1 })).body.new).toBe(false)

    await call(`/api/posts/${a}/like`, { method: 'POST', phone: 2 })
    await call(`/api/posts/${a}/like`, { method: 'POST', phone: 3 })
    await call(`/api/posts/${a}/like`, { method: 'POST', phone: 1 }) // your own like: not a notification
    await call(`/api/posts/${a}/like`, { method: 'POST', phone: 4 }) // a test account: hidden from real people
    await new Promise((r) => setTimeout(r, 5))
    await call(`/api/posts/${b}/like`, { method: 'POST', phone: 2 })
    await new Promise((r) => setTimeout(r, 5))
    await call('/api/follows/nico', { method: 'POST', phone: 3 })
    expect((await call('/api/notifications/new', { phone: 1 })).body.new).toBe(true)

    let items = (await call('/api/notifications', { phone: 1 })).body.items
    expect(items.map((i: { kind: string }) => i.kind)).toEqual(['follow', 'like', 'like'])
    expect(items[0]).toMatchObject({ person: { username: 'bob' }, followingBack: false })
    expect(items[1]).toMatchObject({ post: { id: b }, count: 1 })
    expect(items[2]).toMatchObject({ post: { id: a }, count: 2 })
    expect(items[2].people.map((p: { username: string }) => p.username).sort()).toEqual(['ana', 'bob'])

    await call('/api/notifications/seen', { method: 'POST', phone: 1 })
    expect((await call('/api/notifications/new', { phone: 1 })).body.new).toBe(false)
    // Follow Back.
    await call('/api/follows/bob', { method: 'POST', phone: 1 })
    items = (await call('/api/notifications', { phone: 1 })).body.items
    expect(items[0]).toMatchObject({ kind: 'follow', followingBack: true })
    // Bob now gets one, nico's stays quiet.
    expect((await call('/api/notifications/new', { phone: 3 })).body.new).toBe(true)
    expect((await call('/api/notifications/new', { phone: 1 })).body.new).toBe(false)
    expect((await call('/api/notifications')).status).toBe(401)
  })
})

describe('discover', () => {
  it('ranks popular posts, finds people and scenes, keeps test accounts out', async () => {
    const { env, call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'ana_b')
    await person(3, 'tbot', 1)
    const plain = await publish(1, 'just a scene')
    const liked = await publish(2, 'Salto Michel 100%')
    await publish(3, 'Salto from a test')
    await call(`/api/posts/${liked}/like`, { method: 'POST', phone: 1 })
    expect((await call('/api/discover')).body.posts.map((p: { id: string }) => p.id)).toEqual([liked, plain])
    await env.DB.prepare('UPDATE posts SET featured = 1 WHERE id = ?').bind(plain).run()
    expect((await call('/api/discover')).body.posts[0].id).toBe(plain)

    let r = await call('/api/discover?q=Salto')
    expect(r.body.posts.map((p: { id: string }) => p.id)).toEqual([liked]) // not the test account's
    expect(r.body.people).toEqual([])
    r = await call('/api/discover?q=ana')
    expect(r.body.people).toEqual([{ username: 'ana_b', name: 'ANA_B', avatar: null, followers: 0 }])
    expect((await call('/api/discover?q=100%')).body.posts.map((p: { id: string }) => p.id)).toEqual([liked])
    expect((await call('/api/discover?q=_')).body.people.map((p: { username: string }) => p.username)).toEqual(['ana_b']) // "_" is a letter, not a wildcard (nico doesn't match)
    expect((await call('/api/discover?q=tb', { phone: 3 })).body.people.map((p: { username: string }) => p.username)).toEqual(['tbot'])
  })
})
