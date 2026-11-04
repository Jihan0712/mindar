import { describe, expect, it } from 'vitest'
import { accountResponse } from './accounts.ts'
import { commentsResponse } from './comments.ts'
import { phoneOf, setUp } from './db.ts'
import { devBucket, devDatabase } from './devCloud.ts'
import { publishResponse } from './publish.ts'
import { apiRoute } from './routes.ts'
import { safetyResponse } from './safety.ts'
import { socialResponse } from './social.ts'

const ORIGIN = 'https://inrl.example'
const phoneKey = (n: number) => String(n).repeat(48).slice(0, 48)
const HANDLERS = { comments: commentsResponse, social: socialResponse, safety: safetyResponse, accounts: accountResponse, publish: publishResponse }

async function setup() {
  const env = { DB: await devDatabase(), MEDIA: devBucket(), ADMINS: 'nico, Admin2' }
  await setUp(env.DB)
  const call = async (path: string, init: RequestInit & { phone?: number; json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    if (init.phone !== undefined) headers.set('X-InRL-Owner', phoneKey(init.phone))
    const body = init.json !== undefined ? JSON.stringify(init.json) : init.body
    const route = apiRoute(path.split('?')[0]) ?? 'publish'
    const res = await HANDLERS[route as keyof typeof HANDLERS](new Request(`${ORIGIN}${path}`, { ...init, body, headers }), env)
    return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, any> }
  }
  const person = async (n: number, username: string) => {
    const id = `acct${username}`.padEnd(16, 'x')
    const phone = await phoneOf(new Request(ORIGIN, { headers: { 'X-InRL-Owner': phoneKey(n) } }))
    await env.DB.prepare('INSERT INTO accounts (id, username, name, created) VALUES (?, ?, ?, ?)').bind(id, username, username, Date.now()).run()
    await env.DB.prepare('INSERT INTO phones (phone, account, created) VALUES (?, ?, ?)').bind(phone, id, Date.now()).run()
  }
  const publish = async (n: number, caption = 'hi') => {
    const r = await call('/api/posts', { method: 'POST', phone: n, json: { caption, scene: { version: 1, id: 's', objects: [{ id: 'o', kind: 'text', text: 'hi' }] } } })
    return r.body.post.id as string
  }
  return { env, call, person, publish }
}

describe('blocks', () => {
  it('hides two people from each other everywhere and stops follows, likes and comments', async () => {
    const { call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'troll')
    await person(3, 'ana')
    const mine = await publish(1, 'my scene')
    const theirs = await publish(2, 'troll scene')
    await call('/api/follows/nico', { method: 'POST', phone: 2 })
    await call('/api/follows/troll', { method: 'POST', phone: 1 })
    await call(`/api/posts/${mine}/like`, { method: 'POST', phone: 2 })
    await call(`/api/posts/${mine}/comments`, { method: 'POST', phone: 2, json: { text: 'meh' } })

    expect((await call('/api/blocks/nico', { method: 'POST', phone: 1 })).status).toBe(400)
    expect((await call('/api/blocks/troll', { method: 'POST' })).status).toBe(401)
    expect((await call('/api/blocks/troll', { method: 'POST', phone: 1 })).body).toEqual({ blocked: true })
    expect((await call('/api/me/blocks', { phone: 1 })).body.blocked.map((p: { username: string }) => p.username)).toEqual(['troll'])

    const ids = (r: { body: Record<string, any> }) => r.body.posts.map((p: { id: string }) => p.id)
    // Gone for each other, both ways; others still see both.
    expect(ids(await call('/api/feed', { phone: 1 }))).toEqual([mine])
    expect(ids(await call('/api/feed', { phone: 2 }))).toEqual([theirs])
    expect(ids(await call('/api/feed', { phone: 3 })).sort()).toEqual([mine, theirs].sort())
    expect(ids(await call('/api/discover', { phone: 1 }))).toEqual([mine])
    expect((await call('/api/discover?q=tro', { phone: 1 })).body.people).toEqual([])
    expect((await call(`/api/posts/${theirs}`, { phone: 1 })).status).toBe(404)
    expect((await call(`/api/posts/${mine}`, { phone: 2 })).status).toBe(404)
    expect((await call(`/api/posts/${mine}/comments`, { phone: 1 })).body.comments).toEqual([])
    expect((await call('/api/notifications', { phone: 1 })).body.items).toEqual([])
    // Follows ended both ways; no new follows, likes or comments between them.
    expect((await call('/api/u/nico', { phone: 3 })).body.profile).toMatchObject({ followers: 0, following: 0 })
    expect((await call('/api/follows/nico', { method: 'POST', phone: 2 })).status).toBe(403)
    expect((await call(`/api/posts/${mine}/like`, { method: 'POST', phone: 2 })).status).toBe(404)
    expect((await call(`/api/posts/${mine}/comments`, { method: 'POST', phone: 2, json: { text: 'hey' } })).status).toBe(403)
    // Profiles: the blocked person isn't found; the blocker sees just enough to unblock.
    expect((await call('/api/u/nico', { phone: 2 })).status).toBe(404)
    expect((await call('/api/u/troll', { phone: 1 })).body).toMatchObject({ profile: { blocked: true }, posts: [] })

    expect((await call('/api/blocks/troll', { method: 'DELETE', phone: 1 })).body).toEqual({ blocked: false })
    expect(ids(await call('/api/feed', { phone: 1 })).sort()).toEqual([mine, theirs].sort())
  })
})

describe('reports and admins', () => {
  it('takes reports, shows them to admins only, removes content', async () => {
    const { call, person, publish } = await setup()
    await person(1, 'nico')
    await person(2, 'troll')
    await person(3, 'admin2')
    const post = await publish(2, 'bad scene')
    const comment = (await call(`/api/posts/${post}/comments`, { method: 'POST', phone: 2, json: { text: 'bad words' } })).body.comment.id

    expect((await call('/api/reports', { method: 'POST', phone: 1, json: { kind: 'post', target: post } })).status).toBe(400)
    expect((await call('/api/reports', { method: 'POST', json: { kind: 'post', target: post, reason: 'spam' } })).status).toBe(401)
    expect((await call('/api/reports', { method: 'POST', phone: 1, json: { kind: 'post', target: post, reason: 'hate', note: 'mean' } })).status).toBe(200)
    expect((await call('/api/reports', { method: 'POST', phone: 1, json: { kind: 'comment', target: comment, reason: 'hate' } })).status).toBe(200)
    expect((await call('/api/reports', { method: 'POST', phone: 3, json: { kind: 'account', target: 'troll', reason: 'spam' } })).status).toBe(200)

    expect((await call('/api/me', { phone: 1 })).body.account.admin).toBe(true)
    expect((await call('/api/me', { phone: 2 })).body.account.admin).toBe(false)
    expect((await call('/api/admin/reports', { phone: 2 })).status).toBe(403)
    const list = (await call('/api/admin/reports', { phone: 3 })).body.reports
    expect(list.map((r: { kind: string }) => r.kind).sort()).toEqual(['account', 'comment', 'post'])
    expect(list.find((r: { kind: string }) => r.kind === 'post')).toMatchObject({ reason: 'hate', note: 'mean', reporter: 'nico', what: { caption: 'bad scene', by: 'troll' } })
    expect(list.find((r: { kind: string }) => r.kind === 'comment').what).toMatchObject({ text: 'bad words', link: `/p/${post}` })

    // Removing handles every report about it.
    expect((await call('/api/admin/remove', { method: 'POST', phone: 1, json: { kind: 'comment', target: comment } })).status).toBe(200)
    expect((await call('/api/admin/remove', { method: 'POST', phone: 1, json: { kind: 'post', target: post } })).status).toBe(200)
    expect((await call(`/api/posts/${post}`)).status).toBe(404)
    expect((await call('/api/admin/reports', { phone: 1 })).body.reports.map((r: { kind: string }) => r.kind)).toEqual(['account'])
    const acc = (await call('/api/admin/reports', { phone: 1 })).body.reports[0]
    expect((await call(`/api/admin/reports/${acc.id}/done`, { method: 'POST', phone: 1 })).status).toBe(200)
    expect((await call('/api/admin/reports', { phone: 1 })).body.reports).toEqual([])
    expect((await call('/api/admin/reports?all=1', { phone: 1 })).body.reports).toHaveLength(3)
    // Hiding an account: gone for everyone else.
    const other = await publish(2, 'another')
    await call('/api/admin/remove', { method: 'POST', phone: 1, json: { kind: 'account', target: 'troll' } })
    expect((await call('/api/feed', { phone: 3 })).body.posts.map((p: { id: string }) => p.id)).not.toContain(other)
  })
})
